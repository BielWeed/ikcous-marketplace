#!/usr/bin/env node
/**
 * Prova a migration 20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql
 * e a reversao rollback-manual-20260951000000_*.sql, na MESMA transacao.
 *
 * TUDO termina em ROLLBACK. Nada e gravado — nem o produto, nem a cotacao, nem
 * os pedidos, nem o CREATE OR REPLACE das duas RPCs. Isso so e verdade porque
 * nenhum dos dois arquivos tem controle de transacao embutido, e a primeira
 * coisa que este script faz e RECUSAR os dois se achar.
 *
 * 🔴 O QUE ESTA PROVA PRECISA RESPONDER, E POR QUE O RISCO E' ASSIMETRICO
 *
 *   Deixar passar fraude custa a diferenca do frete. **Recusar cliente honesto
 *   custa a venda inteira, e ninguem percebe de imediato** — o pedido some no
 *   ultimo clique e o comprador vai embora. Por isso o caso 3 (carrinho
 *   legitimo continua passando) pesa mais que os de recusa, e por isso ele e
 *   medido ANTES e DEPOIS: uma trava que recusa todo mundo tambem "recusa
 *   fraude", e passaria numa prova que so olhasse o caso adulterado.
 *
 *   1. CONTROLE NEGATIVO — antes da migration, o carrinho TROCADO passa. Sem
 *      isso, "depois recusa" nao distingue conserto de defeito que nunca houve.
 *   2. LINHA DE BASE — antes da migration, o carrinho legitimo passa.
 *   3. 🔴 DEPOIS, o legitimo CONTINUA passando. O caso mais importante.
 *   4. DEPOIS, o trocado e RECUSADO.
 *   5. DEPOIS, os MESMOS itens em ORDEM DIFERENTE no `cart_hash` passam. E a
 *      razao de o desenho comparar CONJUNTO e nao TEXTO: a serializacao vem do
 *      JavaScript (getCartHash), e exigir que o banco reproduza a ordem dele
 *      transformaria detalhe de formatacao em recusa de pedido honesto.
 *   6. Atributos e conjunto de assinaturas preservados nas DUAS RPCs.
 *   7. 🔴 A VOLTA, que tambem e a sabotagem do instrumento: aplica a reversao e
 *      exige que o carrinho trocado volte a PASSAR. Isso prova as duas coisas de
 *      uma vez — que a reversao desfaz, e que era a TRAVA quem estava decidindo
 *      nos casos 4 e 5, nao outra coisa do cenario.
 *
 * 🔴 TUDO SINTETIZADO: `shipping_quotes_cache` tem 0 linhas neste banco (a loja
 * esta em taxa fixa, e o ramo de transportadora nem e alcancado nessa
 * configuracao). Prova de mundo sintetizado e onde "ninguem foi recusado" e "a
 * trava nao rodou" ficam indistinguiveis — e' por isso que cada rodada tem, ao
 * mesmo tempo, algo que TEM de passar e algo que TEM de ser recusado.
 *
 * As DUAS RPCs sao exercitadas em todos os casos: `useOrders.ts:1060` escolhe
 * entre elas, e v24 e o caminho do pagamento online. Consertar uma so deixa
 * metade do caminho do dinheiro aberto.
 *
 * USO:  node scripts/db-prove-frete-do-proprio-carrinho.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");
const MIGRATION = "20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql";
const REVERSAO =
  "rollback-manual-20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql";

const CEP_ORIGEM = "38400000";
const CEP_DESTINO = "69000000";
const OPCAO = "melhorenvio-pac";
const FRETE = 25;
const PRECO_A = 100;
const PRECO_B = 50;

let passou = 0;
let falhou = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok    ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
  return Boolean(condicao);
}

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(RAIZ, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL nao encontrada em .env.local nem .env.");
}

/**
 * Controle de transacao no topo de um SQL — o que invalidaria o ROLLBACK final.
 *
 * 🔴 `END` NAO ESTA E NAO PODE ENTRAR: o `END;` que fecha corpo plpgsql e
 * obrigatorio, e os dois arquivos aqui definem funcao. Incluir `END` daria
 * falso positivo em toda migration que define funcao — sem este comentario, o
 * proximo editor acrescenta, quebra tudo e reverte sem entender a trava.
 */
const CONTROLE_DE_TRANSACAO = [
  "BEGIN;",
  "BEGIN WORK;",
  "BEGIN TRANSACTION;",
  "COMMIT;",
  "COMMIT WORK;",
  "COMMIT TRANSACTION;",
  "ROLLBACK;",
  "ROLLBACK WORK;",
  "ROLLBACK TRANSACTION;",
  "START TRANSACTION",
];

function normalizar(linha) {
  return linha.trim().replace(/\s+/g, " ").replace(/ ;/g, ";").toUpperCase();
}

function ehControleDeTransacao(linha) {
  const n = normalizar(linha);
  return CONTROLE_DE_TRANSACAO.some((inicio) => n.startsWith(inicio));
}

/** Positivo E negativo: um so aprovaria trava que barra tudo, ou que nao barra nada. */
function provarATrava() {
  const deveBarrar = [
    "BEGIN;",
    "  begin ;",
    "BEGIN WORK;",
    "BEGIN TRANSACTION;",
    "COMMIT;",
    "COMMIT WORK;",
    "COMMIT TRANSACTION;",
    "  commit work ;",
    "ROLLBACK;",
    "START TRANSACTION;",
  ];
  const devePassar = [
    "END;",
    "    END;",
    "END IF;",
    "BEGIN",
    "    BEGIN",
    "-- COMMIT; num comentario",
  ];
  const passouIndevido = deveBarrar.filter((l) => !ehControleDeTransacao(l));
  const barrouIndevido = devePassar.filter(ehControleDeTransacao);
  if (passouIndevido.length || barrouIndevido.length) {
    throw new Error(
      `a trava de transacao nao discrimina. Passou: ${JSON.stringify(passouIndevido)}. Barrou: ${JSON.stringify(barrouIndevido)}.`,
    );
  }
  console.log(
    `  ok    trava de transacao: barra ${deveBarrar.length} formas, deixa passar ${devePassar.length} legitimas`,
  );
}

function lerSql(caminho, rotulo) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(caminho, "utf8");
  const controle = sql.split("\n").filter(ehControleDeTransacao);
  if (controle.length > 0) {
    throw new Error(
      `${rotulo} tem controle de transacao no topo (${controle.length} linha(s)). Com ele o ROLLBACK desta prova vira no-op e a mudanca ficaria GRAVADA. Recusando.`,
    );
  }
  return sql;
}

async function estadoDasRpcs(client) {
  const { rows } = await client.query(
    `SELECT p.oid::regprocedure::text AS assinatura,
            p.prosecdef,
            p.proconfig,
            pg_get_function_result(p.oid) AS retorno,
            (p.prosrc ~ 'itens_da_cotacao') AS tem_trava,
            -- 🔴 O CORPO INTEIRO, e nao so o marcador. Levantado pela revisao de
            -- contexto limpo em 22/08/2026: coletar assinatura, prosecdef,
            -- proconfig, retorno e um marcador NAO detecta uma reversao que
            -- restaure um corpo MAIS ANTIGO — ela passaria nos 20 casos. Sem o
            -- prosrc aqui, "voltou ao estado anterior" e afirmacao, nao medida.
            p.prosrc
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname LIKE 'create_marketplace_order_%'
      ORDER BY 1`,
  );
  return rows;
}

let seq = 0;

/**
 * Cria o pedido como CONVIDADO (auth.uid() e NULL fora do PostgREST), dentro de
 * um SAVEPOINT: metade dos casos ESPERA excecao, e excecao aborta a transacao
 * inteira no Postgres — sem savepoint, a primeira recusa derrubaria o resto.
 */
async function criarPedido(client, { rpc, itens, total }) {
  const sp = `sp_${seq++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const { rows } = await client.query(
      `SELECT public.${rpc}(
         $1::jsonb, $2::numeric, $3::numeric, 'pix'::text, NULL::uuid, NULL::text,
         'PROVA FRETE'::text, '34999999999'::text, NULL::text, NULL::jsonb,
         $4::text, $5::text
       ) AS id`,
      [JSON.stringify(itens), total, FRETE, CEP_DESTINO, OPCAO],
    );
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: true, id: rows[0].id };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    // `e.detail` separado de `e.message` de proposito: o texto que a cliente le
    // vem na MESSAGE e nao muda nesta migration; quem diz a quem depura POR QUE
    // a venda caiu e' o DETAIL. Ate 22/08/2026 este script descartava o detail,
    // e com isso a unica mudanca de texto da migration ficava sem assercao
    // nenhuma — levantado pela revisao de contexto limpo.
    return { ok: false, erro: e.message, detalhe: e.detail };
  }
}

/** Deixa no cache UMA cotacao, com o carrinho que o teste quiser. */
async function gravarCotacao(client, cartHash) {
  await client.query(
    "DELETE FROM public.shipping_quotes_cache WHERE destination_cep = $1",
    [CEP_DESTINO],
  );
  await client.query(
    `INSERT INTO public.shipping_quotes_cache
       (origin_cep, destination_cep, cart_hash, options, created_at)
     VALUES ($1, $2, $3, $4::jsonb, now())`,
    [
      CEP_ORIGEM,
      CEP_DESTINO,
      cartHash,
      JSON.stringify([
        { id: OPCAO, name: "PAC", price: FRETE, deliveryDays: 7 },
      ]),
    ],
  );
}

/** A recusa TEM de ser a do frete, nao qualquer erro — senao o caso passa por acidente. */
function recusouPorFrete(r) {
  return r.ok === false && /cota[cç][aã]o de frete expirou/i.test(r.erro);
}

async function main() {
  console.log("\n0. A TRAVA DE TRANSACAO SE PROVA ANTES DE SER USADA");
  provarATrava();
  const sqlMigration = lerSql(
    path.join(RAIZ, "supabase", "migrations", MIGRATION),
    MIGRATION,
  );
  const sqlReversao = lerSql(path.join(RAIZ, REVERSAO), REVERSAO);

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("RESET ALL");
  await client.query("BEGIN");

  try {
    const antesDasRpcs = await estadoDasRpcs(client);
    if (antesDasRpcs.some((r) => r.tem_trava)) {
      console.error(
        "\n🔴 RECUSANDO: as RPCs JA tem a trava do carrinho neste banco.\n" +
          "   Esta prova exige que o defeito REPRODUZA antes de provar o conserto.\n" +
          "   Isso e a trava funcionando, nao regressao — a migration provavelmente\n" +
          "   ja foi aplicada. Daqui para a frente quem prova e estado real medido\n" +
          "   em conexao nova.",
      );
      await client.query("ROLLBACK");
      await client.end();
      process.exit(2);
    }

    // ---- cenario, com numeros LITERAIS deste arquivo ---------------------
    // O total esperado nao pode sair da mesma formula que a funcao usa: seria
    // comparar o codigo com ele mesmo. Por isso `store_config` e fixado aqui.
    await client.query(
      `UPDATE public.store_config
          SET origin_cep = $1, free_shipping_min = 0, shipping_fee = 999
        WHERE id = 1`,
      [CEP_ORIGEM],
    );

    const prodA = (
      await client.query(
        `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria, ativo, frete_gratis)
         VALUES ('PROVA FRETE A', 10, $1, 500, 'teste', true, false) RETURNING id`,
        [PRECO_A],
      )
    ).rows[0].id;
    const prodB = (
      await client.query(
        `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria, ativo, frete_gratis)
         VALUES ('PROVA FRETE B', 10, $1, 500, 'teste', true, false) RETURNING id`,
        [PRECO_B],
      )
    ).rows[0].id;

    // A cotacao guardada e de UM carrinho: 2 unidades do produto A.
    const hashDoCarrinhoCotado = `${prodA}::2`;
    await gravarCotacao(client, hashDoCarrinhoCotado);

    const carrinhoLegitimo = [
      { product_id: prodA, variant_id: null, quantity: 2 },
    ];
    const totalLegitimo = PRECO_A * 2 + FRETE; // 225, literal

    // O golpe: cotou com 2 unidades, fecha o pedido com 5. O preco do frete
    // continua o da cotacao pequena, entao a trava de 5 centavos NAO ve nada
    // errado — o total bate com o que a propria funcao calcula.
    const carrinhoTrocado = [
      { product_id: prodA, variant_id: null, quantity: 5 },
    ];
    const totalTrocado = PRECO_A * 5 + FRETE; // 525, literal

    console.log(
      "\n1. CONTROLE NEGATIVO — antes da migration, o carrinho TROCADO passa",
    );
    for (const rpc of [
      "create_marketplace_order_v23",
      "create_marketplace_order_v24",
    ]) {
      const r = await criarPedido(client, {
        rpc,
        itens: carrinhoTrocado,
        total: totalTrocado,
      });
      conferir(
        `antes/${rpc.slice(-3)}: carrinho trocado e ACEITO (o defeito reproduz)`,
        r.ok === true,
        r.ok ? undefined : r.erro,
      );
    }

    console.log(
      "\n2. LINHA DE BASE — antes da migration, o carrinho LEGITIMO passa",
    );
    for (const rpc of [
      "create_marketplace_order_v23",
      "create_marketplace_order_v24",
    ]) {
      const r = await criarPedido(client, {
        rpc,
        itens: carrinhoLegitimo,
        total: totalLegitimo,
      });
      conferir(
        `antes/${rpc.slice(-3)}: carrinho legitimo e aceito`,
        r.ok === true,
        r.ok ? undefined : r.erro,
      );
    }

    console.log(
      "\n3. Aplicando a migration (dentro da transacao, sera desfeita)",
    );
    await client.query(sqlMigration);
    console.log("  ok    a migration roda sem erro");

    console.log(
      "\n4. 🔴 O CASO QUE MAIS IMPORTA — o legitimo CONTINUA passando",
    );
    for (const rpc of [
      "create_marketplace_order_v23",
      "create_marketplace_order_v24",
    ]) {
      const r = await criarPedido(client, {
        rpc,
        itens: carrinhoLegitimo,
        total: totalLegitimo,
      });
      conferir(
        `depois/${rpc.slice(-3)}: carrinho legitimo CONTINUA aceito`,
        r.ok === true,
        r.ok ? undefined : r.erro,
      );
    }

    console.log(
      "\n5. DEPOIS, o carrinho TROCADO e recusado — e pelo motivo certo",
    );
    for (const rpc of [
      "create_marketplace_order_v23",
      "create_marketplace_order_v24",
    ]) {
      const r = await criarPedido(client, {
        rpc,
        itens: carrinhoTrocado,
        total: totalTrocado,
      });
      conferir(
        `depois/${rpc.slice(-3)}: carrinho trocado e RECUSADO pela cotacao`,
        recusouPorFrete(r),
        r.ok ? "o pedido foi criado" : r.erro,
      );
      // A migration troca o DETAIL para dizer que a cotacao pode ter sido de
      // OUTRO carrinho. E a unica mudanca de texto que ela faz, e e o unico
      // lugar que conta a quem depura por que a venda caiu. Sem esta asserção,
      // apagar essa troca nao derrubaria teste nenhum.
      conferir(
        `depois/${rpc.slice(-3)}: o DETAIL avisa que a cotacao pode ser de outro carrinho`,
        typeof r.detalhe === "string" && /OUTRO carrinho/.test(r.detalhe),
        `detail veio: ${JSON.stringify(r.detalhe)}`,
      );
    }

    console.log("\n6. ORDEM DIFERENTE no cart_hash nao pode recusar ninguem");
    // Mesmos itens, escritos na ordem inversa da que o pedido envia.
    await gravarCotacao(client, `${prodB}::1,${prodA}::2`);
    const carrinhoDoisItens = [
      { product_id: prodA, variant_id: null, quantity: 2 },
      { product_id: prodB, variant_id: null, quantity: 1 },
    ];
    const totalDoisItens = PRECO_A * 2 + PRECO_B * 1 + FRETE; // 275, literal
    for (const rpc of [
      "create_marketplace_order_v23",
      "create_marketplace_order_v24",
    ]) {
      const r = await criarPedido(client, {
        rpc,
        itens: carrinhoDoisItens,
        total: totalDoisItens,
      });
      conferir(
        `depois/${rpc.slice(-3)}: mesmos itens em ORDEM inversa sao aceitos`,
        r.ok === true,
        r.ok ? undefined : r.erro,
      );
    }
    await gravarCotacao(client, hashDoCarrinhoCotado);

    console.log(
      "\n7. OS ATRIBUTOS SOBREVIVERAM ao CREATE OR REPLACE, nas DUAS",
    );
    const depoisDasRpcs = await estadoDasRpcs(client);
    conferir(
      "conjunto de assinaturas inalterado (conjunto, nao contagem)",
      JSON.stringify(antesDasRpcs.map((r) => r.assinatura)) ===
        JSON.stringify(depoisDasRpcs.map((r) => r.assinatura)),
      `antes ${JSON.stringify(antesDasRpcs.map((r) => r.assinatura))} vs depois ${JSON.stringify(depoisDasRpcs.map((r) => r.assinatura))}`,
    );
    for (const v of ["v23", "v24"]) {
      const a = antesDasRpcs.find((r) => r.assinatura.includes(`_${v}(`));
      const d = depoisDasRpcs.find((r) => r.assinatura.includes(`_${v}(`));
      conferir(
        `${v}: SECURITY DEFINER, search_path e retorno preservados`,
        d.prosecdef === a.prosecdef &&
          JSON.stringify(d.proconfig) === JSON.stringify(a.proconfig) &&
          d.retorno === a.retorno,
        `antes secdef=${a.prosecdef} cfg=${JSON.stringify(a.proconfig)} ret=${a.retorno} | depois secdef=${d.prosecdef} cfg=${JSON.stringify(d.proconfig)} ret=${d.retorno}`,
      );
      conferir(
        `${v}: ficou com a trava do carrinho no corpo`,
        d.tem_trava === true,
      );
    }

    console.log(
      "\n8. 🔴 A VOLTA — e a sabotagem que prova quem estava decidindo",
    );
    conferir(
      "antes de reverter: as duas RPCs TEM a trava (ha o que desfazer)",
      depoisDasRpcs.filter((r) => r.tem_trava).length === 2,
      `com trava: ${depoisDasRpcs.filter((r) => r.tem_trava).length}`,
    );
    await client.query(sqlReversao);
    const revertidas = await estadoDasRpcs(client);
    conferir(
      "depois de reverter: nenhuma RPC tem mais a trava",
      revertidas.every((r) => r.tem_trava === false),
    );
    // 🔴 O CORPO, byte a byte, e nao "o marcador sumiu". Sem esta asserção uma
    // reversão que restaurasse uma versão ANTIGA das funções — perdendo a
    // correção de cupom ou a reserva de 30 min da v24 — passaria em tudo.
    for (const v of ["v23", "v24"]) {
      const a = antesDasRpcs.find((r) => r.assinatura.includes(`_${v}(`));
      const d = revertidas.find((r) => r.assinatura.includes(`_${v}(`));
      conferir(
        `${v}: o corpo revertido e IDENTICO ao de antes, caractere a caractere`,
        d.prosrc === a.prosrc,
        `tamanhos: antes ${a.prosrc.length}, depois ${d.prosrc.length}`,
      );
    }
    conferir(
      "depois de reverter: assinaturas e atributos continuam intactos",
      JSON.stringify(revertidas.map((r) => r.assinatura)) ===
        JSON.stringify(antesDasRpcs.map((r) => r.assinatura)) &&
        revertidas.every((r) => r.prosecdef === true) &&
        revertidas.every(
          (r) =>
            JSON.stringify(r.proconfig) ===
            JSON.stringify(["search_path=public"]),
        ),
    );
    // A prova de que era A TRAVA decidindo, e nao outra coisa do cenario:
    // com ela fora, o MESMO carrinho trocado volta a ser aceito.
    for (const rpc of [
      "create_marketplace_order_v23",
      "create_marketplace_order_v24",
    ]) {
      const r = await criarPedido(client, {
        rpc,
        itens: carrinhoTrocado,
        total: totalTrocado,
      });
      conferir(
        `revertido/${rpc.slice(-3)}: o carrinho trocado volta a ser ACEITO`,
        r.ok === true,
        r.ok ? undefined : r.erro,
      );
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  console.log(
    "ROLLBACK executado: nada foi gravado — nem as RPCs, nem o cenario, nem os pedidos.",
  );
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
