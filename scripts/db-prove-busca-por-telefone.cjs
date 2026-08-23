#!/usr/bin/env node
/**
 * Prova a migration 20260961000000_busca_de_pedido_por_telefone.sql.
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado — nem os
 * pedidos de teste, nem o backfill, nem o CREATE OR REPLACE das funcoes. Isso so
 * e verdade porque a migration NAO tem BEGIN/COMMIT embutido: se alguem
 * acrescentar um, este script passa a gravar de verdade sem avisar. Por isso a
 * primeira coisa que ele faz e RECUSAR a migration se achar controle de
 * transacao dentro dela.
 *
 * 🔴 ESTE SCRIPT SO RODA UMA VEZ, POR CONSTRUCAO. Ele exige que o defeito
 * REPRODUZA antes de provar o conserto. Depois de aplicada, o passo 1 falha de
 * proposito, e quem prova passa a ser estado real medido em conexao nova.
 *
 * O QUE ELE PROVA, E POR QUE CADA CASO EXISTE
 *
 * 1. CONTROLE NEGATIVO — antes da migration, um pedido novo nasce com
 *    `customer_phone` NULO, e o predicado que a busca do painel usa
 *    (`customer_phone ILIKE '%...%'`) nao acha esse pedido. Sem este passo, um
 *    "achou" depois nao prova nada.
 *
 * 2. O CONTROLE DO CONTROLE — na MESMA rodada, a busca por NOME acha o mesmo
 *    pedido. Isso separa "a coluna do telefone esta vazia" de "a busca inteira
 *    esta quebrada", que sao diagnosticos diferentes com consertos diferentes.
 *
 * 3. 🔴 A INVARIANTE DO OTP, e este e o caso que podia matar a correcao.
 *    `generate_order_otp_v1`/`v2` casam o telefone com
 *    `coalesce(o.customer_phone, o.customer_data->>'whatsapp', '')`. Preencher a
 *    coluna muda o primeiro argumento do coalesce — entao a prova calcula esse
 *    coalesce para TODAS as linhas ANTES e DEPOIS e exige que o multiconjunto
 *    seja IDENTICO. Se o backfill usasse qualquer fonte diferente de
 *    `customer_data->>'whatsapp'`, esta assercao cairia. E' ela que autoriza a
 *    frase "zero mudanca no OTP" — nao o comentario do cabecalho.
 *
 * 4. O BACKFILL nao inventa e nao sobrescreve: linha que ja tinha a coluna
 *    preenchida continua com o valor dela; linha nula passa a ter exatamente o
 *    `customer_data->>'whatsapp'`; linha sem whatsapp nenhum continua nula.
 *
 * 5. DEPOIS — pedido novo nasce com a coluna preenchida, nas DUAS RPCs, e o
 *    predicado da busca passa a achar.
 *
 * 6. NAO PERDEU O QUE A MIGRATION ANTERIOR GANHOU. Esta migration reescreve as
 *    MESMAS duas funcoes da 20260960, entao a guarda de variacao obrigatoria tem
 *    de continuar recusando. Um CREATE OR REPLACE que "esquece" a guarda passaria
 *    em todos os outros casos deste arquivo.
 *
 * 7. OS ATRIBUTOS sobrevivem: `SECURITY DEFINER` e `search_path` conferidos em
 *    `pg_proc` depois do REPLACE.
 *
 * 8. REVERSAO — reaplicando o corpo da 20260960 (o de antes), pedido novo volta
 *    a nascer com a coluna nula. E isso que prova que quem decidiu foi a mudanca
 *    do INSERT, e nao outra coisa do cenario.
 *
 * Uso:  node scripts/db-prove-busca-por-telefone.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");
const MIGRATION = "20260961000000_busca_de_pedido_por_telefone.sql";
const ANTERIOR = "20260960000000_variacao_obrigatoria_no_servidor.sql";

const PRECO_BASE = 100;
const PRECO_VARIACAO = 150;
const FRETE = 20;
const TELEFONE = "34988887777";
const NOME = "PROVA TELEFONE";
const RPCS = ["create_marketplace_order_v23", "create_marketplace_order_v24"];

let passou = 0;
let falhou = 0;
let seq = 0;

function conferir(nome, cond, detalhe) {
  if (cond) {
    passou++;
    console.log(`  ok    ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
  return Boolean(cond);
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
 * 🔴 `END` NAO ESTA E NAO PODE ENTRAR NESTA LISTA. O `END;` que fecha o corpo
 * plpgsql e obrigatorio — a propria migration que este script prova tem dois —
 * entao incluir `END` daria falso positivo em TODA migration que define funcao.
 */
const CONTROLE_DE_TRANSACAO = [
  "BEGIN;",
  "BEGIN WORK;",
  "BEGIN TRANSACTION;",
  "START TRANSACTION;",
  "COMMIT;",
  "COMMIT WORK;",
  "COMMIT TRANSACTION;",
  "ROLLBACK;",
  "ROLLBACK WORK;",
  "ROLLBACK TRANSACTION;",
];

function recusarSeTiverTransacao(sql, nomeDoArquivo) {
  const achados = sql
    .split(/\r?\n/)
    .map((l, i) => [i + 1, l.trim().toUpperCase()])
    // startsWith, nao ===: `COMMIT; -- fecha` escaparia da igualdade exata.
    .filter(([, l]) => CONTROLE_DE_TRANSACAO.some((c) => l.startsWith(c)));
  if (achados.length > 0) {
    const lista = achados.map(([n, l]) => `   linha ${n}: ${l}`).join("\n");
    console.error(
      `\n🔴 ${nomeDoArquivo} tem controle de transacao:\n${lista}\n\nCom ele, o ROLLBACK desta prova vira no-op e a mudanca fica gravada mesmo assim.`,
    );
    process.exit(2);
  }
}

async function criarPedido(client, { rpc, itens, total }) {
  const sp = `sp_${seq++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const { rows } = await client.query(
      `SELECT public.${rpc}(
         $1::jsonb, $2::numeric, $3::numeric, 'pix'::text, NULL::uuid, NULL::text,
         $4::text, $5::text, NULL::text, NULL::jsonb, NULL::text, NULL::text
       ) AS id`,
      [JSON.stringify(itens), total, FRETE, NOME, TELEFONE],
    );
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: true, id: rows[0].id };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: false, erro: e.message, detalhe: e.detail };
  }
}

async function telefoneDoPedido(client, id) {
  const { rows } = await client.query(
    "SELECT customer_phone FROM public.marketplace_orders WHERE id = $1",
    [id],
  );
  return rows.length ? rows[0].customer_phone : undefined;
}

/** O MESMO predicado que a RPC de busca do painel usa para o telefone. */
async function achaPorTelefone(client, id, termo) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM public.marketplace_orders
      WHERE id = $1 AND customer_phone ILIKE '%' || $2 || '%'`,
    [id, termo],
  );
  return rows[0].n > 0;
}

/** O MESMO predicado que a RPC de busca usa para o nome — o controle. */
async function achaPorNome(client, id, termo) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM public.marketplace_orders
      WHERE id = $1 AND unaccent(customer_name) ILIKE unaccent('%' || $2 || '%')`,
    [id, termo],
  );
  return rows[0].n > 0;
}

/** A expressao EXATA que o OTP usa para casar telefone, para TODAS as linhas. */
async function assinaturaDoOtp(client) {
  const { rows } = await client.query(
    `SELECT id,
            regexp_replace(
              coalesce(customer_phone, customer_data->>'whatsapp', ''),
              '[^0-9]', '', 'g') AS chave
       FROM public.marketplace_orders
      ORDER BY id`,
  );
  return rows.map((r) => `${r.id}:${r.chave}`).join("|");
}

async function atributos(client) {
  const { rows } = await client.query(
    `SELECT p.proname, p.prosecdef, p.proconfig
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY($1)
      ORDER BY p.proname`,
    [RPCS],
  );
  return rows;
}

async function main() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sqlMigration = fs.readFileSync(
    path.join(RAIZ, "supabase", "migrations", MIGRATION),
    "utf8",
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sqlAnterior = fs.readFileSync(
    path.join(RAIZ, "supabase", "migrations", ANTERIOR),
    "utf8",
  );
  recusarSeTiverTransacao(sqlMigration, MIGRATION);
  recusarSeTiverTransacao(sqlAnterior, ANTERIOR);

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE public.store_config SET free_shipping_min = 0, shipping_fee = $1 WHERE id = 1",
      [FRETE],
    );

    const novoProduto = async (nome) =>
      (
        await client.query(
          `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria, ativo, frete_gratis)
           VALUES ($1, 10, $2, 500, 'teste', true, false) RETURNING id`,
          [nome, PRECO_BASE],
        )
      ).rows[0].id;

    const prodSimples = await novoProduto("PROVA TELEFONE — simples");
    const prodComVar = await novoProduto("PROVA TELEFONE — com variacao");
    await client.query(
      `INSERT INTO public.product_variants (product_id, name, value, price_override, stock_increment, active)
       VALUES ($1, 'Tamanho', 'M', $2, 7, true)`,
      [prodComVar, PRECO_VARIACAO],
    );

    const item = [{ product_id: prodSimples, variant_id: null, quantity: 1 }];
    const semVariacao = [
      { product_id: prodComVar, variant_id: null, quantity: 1 },
    ];
    const total = PRECO_BASE + FRETE;

    // -----------------------------------------------------------------------
    console.log(
      "1. CONTROLE NEGATIVO — antes, o telefone nao vai para a coluna",
    );
    // Map, nao objeto: com chave vinda de variavel o eslint acusa
    // `security/detect-object-injection`, e a catraca reprova aviso novo.
    const antes = new Map();
    for (const rpc of RPCS) {
      const r = await criarPedido(client, { rpc, itens: item, total });
      antes.set(rpc, r.id);
      conferir(`${rpc.slice(-3)}: o pedido e criado`, r.ok === true, r.erro);
      const tel = r.ok ? await telefoneDoPedido(client, r.id) : "??";
      conferir(
        `${rpc.slice(-3)}: customer_phone nasce NULO (o defeito reproduz)`,
        tel === null,
        `customer_phone=${JSON.stringify(tel)}`,
      );
      conferir(
        `${rpc.slice(-3)}: a busca por telefone NAO acha`,
        r.ok && (await achaPorTelefone(client, r.id, TELEFONE)) === false,
        "achou",
      );
    }

    console.log(
      "\n2. O CONTROLE DO CONTROLE — a busca por NOME acha o mesmo pedido",
    );
    for (const rpc of RPCS) {
      conferir(
        `${rpc.slice(-3)}: acha por nome (logo a busca nao esta quebrada)`,
        await achaPorNome(client, antes.get(rpc), "PROVA"),
        "nao achou nem por nome",
      );
    }

    console.log("\n3. a assinatura do OTP, ANTES");
    const otpAntes = await assinaturaDoOtp(client);
    conferir(
      "colheu a chave de casamento do OTP para todas as linhas",
      otpAntes.length > 0,
      "vazia",
    );

    // -----------------------------------------------------------------------
    console.log(`\n4. aplicando ${MIGRATION} NA TRANSACAO`);
    await client.query(sqlMigration);

    console.log("\n5. 🔴 A INVARIANTE DO OTP — a chave de casamento NAO mudou");
    const otpDepois = await assinaturaDoOtp(client);
    conferir(
      "coalesce(customer_phone, customer_data->>'whatsapp','') identico linha a linha",
      otpAntes === otpDepois,
      "a chave do OTP MUDOU — o backfill usou fonte diferente do jsonb",
    );

    console.log("\n6. O BACKFILL — preencheu o que faltava, sem inventar");
    const bf = (
      await client.query(
        `SELECT count(*) FILTER (WHERE customer_phone IS NULL
                                   AND customer_data->>'whatsapp' IS NOT NULL)::int AS ainda_nulos,
                count(*) FILTER (WHERE customer_phone IS NOT NULL
                                   AND customer_phone IS DISTINCT FROM customer_data->>'whatsapp')::int AS divergentes
           FROM public.marketplace_orders`,
      )
    ).rows[0];
    conferir(
      "nao sobrou linha com whatsapp no jsonb e coluna nula",
      bf.ainda_nulos === 0,
      `ainda_nulos=${bf.ainda_nulos}`,
    );
    console.log(
      `  (nota: ${bf.divergentes} linha(s) com coluna diferente do jsonb — sao as que JA tinham a coluna preenchida e o backfill nao tocou)`,
    );

    console.log("\n7. DEPOIS — o telefone vai para a coluna, e a busca acha");
    for (const rpc of RPCS) {
      const r = await criarPedido(client, { rpc, itens: item, total });
      conferir(`${rpc.slice(-3)}: o pedido e criado`, r.ok === true, r.erro);
      const tel = r.ok ? await telefoneDoPedido(client, r.id) : "??";
      conferir(
        `${rpc.slice(-3)}: customer_phone = o telefone que a tela mandou`,
        tel === TELEFONE,
        `customer_phone=${JSON.stringify(tel)}`,
      );
      conferir(
        `${rpc.slice(-3)}: a busca por telefone ACHA`,
        r.ok && (await achaPorTelefone(client, r.id, TELEFONE)) === true,
        "nao achou",
      );
      const j = (
        await client.query(
          "SELECT customer_data->>'whatsapp' AS w FROM public.marketplace_orders WHERE id = $1",
          [r.id],
        )
      ).rows[0].w;
      conferir(
        `${rpc.slice(-3)}: coluna e jsonb saem do MESMO valor (o OTP nao pode divergir)`,
        j === tel,
        `jsonb=${JSON.stringify(j)} coluna=${JSON.stringify(tel)}`,
      );
    }

    console.log("\n8. NAO PERDEU A GUARDA DA MIGRATION ANTERIOR");
    for (const rpc of RPCS) {
      const r = await criarPedido(client, {
        rpc,
        itens: semVariacao,
        total,
      });
      conferir(
        `${rpc.slice(-3)}: comprar sem escolher variacao continua RECUSADO`,
        r.ok === false &&
          /variant_id ausente em produto com variacao ativa/.test(
            r.detalhe || "",
          ),
        r.ok ? "foi ACEITO" : JSON.stringify(r.detalhe),
      );
    }

    console.log("\n9. os atributos sobreviveram ao CREATE OR REPLACE");
    const attrs = await atributos(client);
    conferir(
      "as duas RPCs continuam existindo",
      attrs.length === 2,
      `${attrs.length}`,
    );
    conferir(
      "as duas continuam SECURITY DEFINER",
      attrs.every((a) => a.prosecdef === true),
      JSON.stringify(attrs.map((a) => a.prosecdef)),
    );
    conferir(
      "as duas continuam com search_path=public",
      attrs.every(
        (a) =>
          JSON.stringify(a.proconfig) ===
          JSON.stringify(["search_path=public"]),
      ),
      JSON.stringify(attrs.map((a) => a.proconfig)),
    );

    console.log("\n10. REVERSAO — sem a mudanca, a coluna volta a nascer nula");
    await client.query(sqlAnterior);
    for (const rpc of RPCS) {
      const r = await criarPedido(client, { rpc, itens: item, total });
      const tel = r.ok ? await telefoneDoPedido(client, r.id) : "??";
      conferir(
        `${rpc.slice(-3)}: nula de novo — quem decidiu foi o INSERT`,
        tel === null,
        `customer_phone=${JSON.stringify(tel)}`,
      );
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  console.log(
    "ROLLBACK executado: nada foi gravado — nem as RPCs, nem o backfill, nem os pedidos.",
  );
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
