#!/usr/bin/env node
/**
 * Prova a migration 20260960000000_variacao_obrigatoria_no_servidor.sql.
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado — nem os
 * produtos de teste, nem os pedidos, nem o CREATE OR REPLACE das funcoes. Isso
 * so e verdade porque a migration NAO tem BEGIN/COMMIT embutido: se alguem
 * acrescentar um, este script passa a gravar de verdade sem avisar. Por isso a
 * primeira coisa que ele faz e RECUSAR a migration se achar controle de
 * transacao dentro dela.
 *
 * 🔴 ESTE SCRIPT SO RODA UMA VEZ, POR CONSTRUCAO — e isso e a trava
 * funcionando, nao regressao. Ele exige que o defeito REPRODUZA antes de provar
 * o conserto. Depois que a migration estiver aplicada no banco, o defeito nao
 * reproduz mais e o passo 1 falha de proposito. A partir dai quem prova e
 * estado real medido em conexao nova, nunca a re-execucao deste arquivo.
 *
 * O QUE ELE PRECISA PROVAR, E POR QUE CADA CASO EXISTE
 *
 * 1. CONTROLE NEGATIVO — antes da migration, comprar um produto COM variacao
 *    mandando `variant_id: null` e ACEITO. Sem este passo, um "recusou" depois
 *    nao prova nada: podia estar recusando por outro motivo o tempo todo.
 *
 * 2. O DEFEITO E DE DINHEIRO, E ISSO SE MEDE, NAO SE AFIRMA. O mesmo produto
 *    custa PRECO_BASE pelo caminho furado e PRECO_VARIACAO pelo caminho certo.
 *    O script fecha os DOIS pedidos antes da migration e compara os totais
 *    gravados: a diferenca literal (50) e o dinheiro que sai da lojista a cada
 *    venda que escapa. E confere que a baixa caiu no `estoque` do produto
 *    enquanto o `stock_increment` da variacao NAO se mexeu — que e a segunda
 *    perda, a de vender de novo o tamanho que ja acabou.
 *
 * 3. OS SOBREVIVENTES. Uma trava que recusa tudo tambem faria o passo 5 passar.
 *    Entao antes E depois da migration os tres caminhos legitimos sao exercidos:
 *      (a) produto COM variacao, mandando o `variant_id` certo;
 *      (b) produto SEM variacao nenhuma, mandando null;
 *      (c) produto cujas variacoes existem mas estao todas INATIVAS, mandando
 *          null — este e o caso que decidiu o predicado da guarda. Ela pergunta
 *          por `active = true`, exatamente o mesmo predicado que o ramo de cima
 *          usa para ACEITAR uma variacao. Se a guarda perguntasse so por
 *          "existe variacao", este produto ficaria sem nenhum caminho de compra:
 *          o ramo da variacao o recusa (nenhuma ativa) e o ramo do produto base
 *          tambem. Ele e o morador do estado que a trava filtra, e a prova
 *          precisa dele de pe.
 *
 * 4. DEPOIS da migration, o mesmo item do passo 1 e RECUSADO — com a mensagem
 *    que a cliente le E o DETAIL que quem depura le, os dois assertados. Texto
 *    de excecao sem assercao e comentario: some na primeira edicao.
 *
 * 4b. PRODUTO INATIVO com variacao ativa (passo 5b): a guarda dispara ANTES
 *    do teste de produto disponivel, entao ela precisa exigir tambem
 *    `p.ativo = true` — senao um produto FORA da vitrine recebe "Escolha uma
 *    variacao", instrucao impossivel de seguir. A recusa certa e' a de
 *    sempre, "produto nao disponivel", e o teste confere que NAO e' a
 *    mensagem da guarda.
 *
 * 5. AS DUAS RPCs. `v23` e `v24` (a do pagamento online) tem o mesmo caminho de
 *    validacao. Consertar uma so deixa metade do caminho do dinheiro aberto,
 *    entao todo caso roda contra as duas.
 *
 * 6. OS ATRIBUTOS SOBREVIVEM AO CREATE OR REPLACE. `SECURITY DEFINER` e
 *    `search_path` sao conferidos em `pg_proc` depois da migration. Se
 *    `SECURITY DEFINER` cair, a funcao que grava pedido e movimenta estoque
 *    passa a rodar com a permissao do navegador da cliente.
 *
 * 7. REVERSAO — reaplicando o corpo da 20260951000000 (o de antes da guarda), o
 *    MESMO item volta a ser aceito. E isto que prova que quem decidiu foi A
 *    GUARDA, e nao qualquer outra coisa do cenario.
 *
 * Uso:  node scripts/db-prove-variacao-obrigatoria.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");
const MIGRATION = "20260960000000_variacao_obrigatoria_no_servidor.sql";
const ANTERIOR = "20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql";

// Numeros LITERAIS deste arquivo. O total esperado nao pode sair da mesma
// formula que a funcao usa — seria comparar o codigo com ele mesmo.
const PRECO_BASE = 100;
const PRECO_VARIACAO = 150;
const FRETE = 20;
const ESTOQUE_PRODUTO = 500;
const ESTOQUE_VARIACAO = 7;
const DIFERENCA_ESPERADA = 50; // PRECO_VARIACAO - PRECO_BASE

const RPCS = ["create_marketplace_order_v23", "create_marketplace_order_v24"];

let passou = 0;
let falhou = 0;
let seq = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok   ${nome}`);
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
 * Controle de transacao no TOPO da migration — o que invalidaria o ROLLBACK
 * desta prova e faria o script gravar de verdade anunciando que nao gravou.
 *
 * 🔴 `END` NAO ESTA E NAO PODE ENTRAR NESTA LISTA. O `END;` que fecha o corpo
 * plpgsql e obrigatorio — a propria migration que este script prova tem dois —
 * entao incluir `END` daria falso positivo em TODA migration que define funcao.
 * Isto esta escrito aqui de proposito: sem o motivo, o proximo editor
 * acrescenta `END`, tudo quebra, e ele reverte sem entender o que era a trava.
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
    // startsWith, nao ===: `COMMIT; -- fecha` escapava da igualdade exata e a
    // trava inteira de "nada foi gravado" dependia dela.
    .filter(([, l]) => CONTROLE_DE_TRANSACAO.some((c) => l.startsWith(c)));
  if (achados.length > 0) {
    const lista = achados.map(([n, l]) => `   linha ${n}: ${l}`).join("\n");
    console.error(
      `\n🔴 ${nomeDoArquivo} tem controle de transacao:\n${lista}\n\nCom ele, o ROLLBACK desta prova vira no-op e a mudanca fica gravada mesmo assim. Tire o BEGIN/COMMIT da migration.`,
    );
    process.exit(2);
  }
}

/**
 * Cada tentativa vai num SAVEPOINT proprio: uma recusa esperada aborta a
 * subtransacao, nao a transacao inteira. Sem isso a primeira recusa derrubaria
 * todo o resto do script.
 */
async function criarPedido(client, { rpc, itens, total }) {
  const sp = `sp_${seq++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const { rows } = await client.query(
      `SELECT public.${rpc}(
         $1::jsonb, $2::numeric, $3::numeric, 'pix'::text, NULL::uuid, NULL::text,
         'PROVA VARIACAO'::text, '34999999999'::text, NULL::text, NULL::jsonb,
         NULL::text, NULL::text
       ) AS id`,
      [JSON.stringify(itens), total, FRETE],
    );
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: true, id: rows[0].id };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    // `e.detail` separado de `e.message` de proposito: a cliente le a MESSAGE;
    // quem depura le o DETAIL. Os dois sao assertados nesta prova.
    return { ok: false, erro: e.message, detalhe: e.detail };
  }
}

/**
 * A tabela e `marketplace_orders` e a coluna e `total` — nao `orders.total_amount`.
 * Lido do proprio INSERT da RPC (linha 300 da migration), que e a unica fonte
 * que nao pode divergir do que a funcao grava.
 */
async function totalGravado(client, id) {
  const { rows } = await client.query(
    "SELECT total FROM public.marketplace_orders WHERE id = $1",
    [id],
  );
  return rows.length ? Number(rows[0].total) : null;
}

async function estoques(client, produtoId, varianteId) {
  const p = await client.query(
    "SELECT estoque FROM public.produtos WHERE id = $1",
    [produtoId],
  );
  const v = await client.query(
    "SELECT stock_increment FROM public.product_variants WHERE id = $1",
    [varianteId],
  );
  return {
    produto: Number(p.rows[0].estoque),
    variacao: Number(v.rows[0].stock_increment),
  };
}

async function atributosDasRpcs(client) {
  const { rows } = await client.query(
    `SELECT p.proname, p.prosecdef, p.proconfig,
            pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY($1)
      ORDER BY p.proname`,
    [RPCS],
  );
  return rows.map((r) => ({
    assinatura: `${r.proname}(${r.args})`,
    prosecdef: r.prosecdef,
    proconfig: r.proconfig,
  }));
}

async function main() {
  // Os dois caminhos sao montados a partir de constantes deste arquivo
  // (MIGRATION e ANTERIOR, literais no topo), nao de entrada de fora.
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

    // A 20260951 esta no codigo e NAO no banco (medido em 23/08/2026 com
    // db-reconcilia-ledger.cjs --listar-pendentes). A linha de base desta prova
    // tem que ser o corpo SEM a guarda mas COM a trava do frete, senao o
    // "antes" seria um terceiro estado que nao existe em lugar nenhum.
    await client.query(sqlAnterior);
    console.log("linha de base: corpo da 20260951 aplicado NA TRANSACAO.\n");

    await client.query(
      `UPDATE public.store_config
          SET free_shipping_min = 0, shipping_fee = $1
        WHERE id = 1`,
      [FRETE],
    );

    const novoProduto = async (nome, ativo = true) =>
      (
        await client.query(
          `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria, ativo, frete_gratis)
           VALUES ($1, 10, $2, $3, 'teste', $4, false) RETURNING id`,
          [nome, PRECO_BASE, ESTOQUE_PRODUTO, ativo],
        )
      ).rows[0].id;

    // `name` e o GRUPO ("Tamanho") e `value` e a OPCAO ("M") — as duas NOT NULL
    // no esquema. Conferido em 20260806000000_baseline_do_schema_vivo.sql:4042.
    const novaVariacao = async (produtoId, valor, ativa) =>
      (
        await client.query(
          `INSERT INTO public.product_variants (product_id, name, value, price_override, stock_increment, active)
           VALUES ($1, 'Tamanho', $2, $3, $4, $5) RETURNING id`,
          [produtoId, valor, PRECO_VARIACAO, ESTOQUE_VARIACAO, ativa],
        )
      ).rows[0].id;

    const prodComVar = await novoProduto("PROVA VARIACAO — com variacao");
    const varAtiva = await novaVariacao(prodComVar, "M", true);
    const prodSemVar = await novoProduto("PROVA VARIACAO — sem variacao");
    const prodInativa = await novoProduto("PROVA VARIACAO — variacao inativa");
    await novaVariacao(prodInativa, "M", false);
    // ANOTADO 1 da revisao: a guarda dispara ANTES do teste de produto
    // disponivel — sem o `p.ativo = true` dela, produto FORA da vitrine com
    // variacao ativa recebia "Escolha uma variacao", uma instrucao
    // impossivel de seguir. Este produto e o morador desse estado.
    const prodInativoComVarAtiva = await novoProduto(
      "PROVA VARIACAO — produto inativo, variacao ativa",
      false,
    );
    await novaVariacao(prodInativoComVarAtiva, "M", true);

    const semVariacao = (id) => [
      { product_id: id, variant_id: null, quantity: 1 },
    ];
    const comVariacao = (id, vid) => [
      { product_id: id, variant_id: vid, quantity: 1 },
    ];
    const totalPeloBase = PRECO_BASE + FRETE; // 120, literal
    const totalPelaVariacao = PRECO_VARIACAO + FRETE; // 170, literal

    // ---------------------------------------------------------------------
    console.log("1. CONTROLE NEGATIVO — antes, o item SEM variacao e ACEITO");
    // Map, nao objeto: com chave vinda de variavel o eslint acusa
    // `security/detect-object-injection`, e a catraca reprova aviso novo.
    const antesIds = new Map();
    for (const rpc of RPCS) {
      const r = await criarPedido(client, {
        rpc,
        itens: semVariacao(prodComVar),
        total: totalPeloBase,
      });
      antesIds.set(rpc, r.id);
      conferir(
        `antes/${rpc.slice(-3)}: produto COM variacao comprado SEM variacao e aceito (o defeito reproduz)`,
        r.ok === true,
        r.ok ? undefined : r.erro,
      );
    }

    console.log("\n2. O TAMANHO DA PERDA, medido — preco e estoque");
    const depoisDoFurado = await estoques(client, prodComVar, varAtiva);
    conferir(
      `a baixa caiu no estoque do PRODUTO (${ESTOQUE_PRODUTO} -> ${depoisDoFurado.produto}, duas vendas)`,
      depoisDoFurado.produto === ESTOQUE_PRODUTO - 2,
      `estoque=${depoisDoFurado.produto}`,
    );
    conferir(
      `o estoque da VARIACAO nao se mexeu (${ESTOQUE_VARIACAO}) — o tamanho que acabou continua a venda`,
      depoisDoFurado.variacao === ESTOQUE_VARIACAO,
      `stock_increment=${depoisDoFurado.variacao}`,
    );
    const rCerto = await criarPedido(client, {
      rpc: RPCS[0],
      itens: comVariacao(prodComVar, varAtiva),
      total: totalPelaVariacao,
    });
    conferir(
      "o MESMO produto pelo caminho certo e aceito",
      rCerto.ok === true,
      rCerto.ok ? undefined : rCerto.erro,
    );
    const totalFurado = await totalGravado(client, antesIds.get(RPCS[0]));
    const totalCerto = rCerto.ok ? await totalGravado(client, rCerto.id) : null;
    conferir(
      `o pedido furado cobrou ${totalFurado} e o certo ${totalCerto} — ${DIFERENCA_ESPERADA} a menos por venda, do bolso da lojista`,
      totalCerto !== null && totalCerto - totalFurado === DIFERENCA_ESPERADA,
      `furado=${totalFurado} certo=${totalCerto}`,
    );

    console.log("\n3. SOBREVIVENTES ANTES — os tres caminhos legitimos passam");
    for (const rpc of RPCS) {
      const a = await criarPedido(client, {
        rpc,
        itens: comVariacao(prodComVar, varAtiva),
        total: totalPelaVariacao,
      });
      conferir(
        `antes/${rpc.slice(-3)}: (a) com o variant_id certo`,
        a.ok === true,
        a.erro,
      );
      const b = await criarPedido(client, {
        rpc,
        itens: semVariacao(prodSemVar),
        total: totalPeloBase,
      });
      conferir(
        `antes/${rpc.slice(-3)}: (b) produto SEM variacao nenhuma`,
        b.ok === true,
        b.erro,
      );
      const c = await criarPedido(client, {
        rpc,
        itens: semVariacao(prodInativa),
        total: totalPeloBase,
      });
      conferir(
        `antes/${rpc.slice(-3)}: (c) produto com variacao INATIVA`,
        c.ok === true,
        c.erro,
      );
    }

    // ---------------------------------------------------------------------
    console.log(`\n4. aplicando ${MIGRATION} NA TRANSACAO`);
    await client.query(sqlMigration);

    console.log(
      "\n5. DEPOIS — o item sem variacao e RECUSADO, com os dois textos",
    );
    for (const rpc of RPCS) {
      const r = await criarPedido(client, {
        rpc,
        itens: semVariacao(prodComVar),
        total: totalPeloBase,
      });
      conferir(
        `depois/${rpc.slice(-3)}: recusado`,
        r.ok === false,
        "foi aceito",
      );
      conferir(
        `depois/${rpc.slice(-3)}: a MESSAGE e a que a cliente le, com o nome do produto`,
        r.ok === false &&
          /Escolha uma varia..o para o produto PROVA VARIACAO — com variacao\./.test(
            r.erro || "",
          ),
        JSON.stringify(r.erro),
      );
      conferir(
        `depois/${rpc.slice(-3)}: o DETAIL diz a quem depura o que foi recusado`,
        r.ok === false &&
          /variant_id ausente em produto com variacao ativa/.test(
            r.detalhe || "",
          ),
        JSON.stringify(r.detalhe),
      );
    }

    console.log(
      "\n5b. PRODUTO INATIVO com variacao ativa — a guarda NAO intercepta",
    );
    // ANOTADO 1: antes deste diff, a guarda perguntava so por `v.active =
    // true` e disparava aqui, dando "Escolha uma variacao" para um produto
    // que nem esta na vitrine. Com `p.ativo = true` na guarda, ela e' pulada
    // e a recusa volta a ser a de produto indisponivel — a mesma de antes
    // deste commit inteiro.
    for (const rpc of RPCS) {
      const r = await criarPedido(client, {
        rpc,
        itens: semVariacao(prodInativoComVarAtiva),
        total: totalPeloBase,
      });
      conferir(
        `depois/${rpc.slice(-3)}: produto INATIVO com variacao ativa e recusado`,
        r.ok === false,
        "foi aceito",
      );
      conferir(
        `depois/${rpc.slice(-3)}: a recusa e' de produto INDISPONIVEL, nao "Escolha uma variacao"`,
        r.ok === false &&
          /n.o dispon.vel/.test(r.erro || "") &&
          !/Escolha uma varia/.test(r.erro || ""),
        JSON.stringify(r.erro),
      );
    }

    console.log(
      "\n6. SOBREVIVENTES DEPOIS — a trava DISCRIMINA, nao recusa tudo",
    );
    for (const rpc of RPCS) {
      const a = await criarPedido(client, {
        rpc,
        itens: comVariacao(prodComVar, varAtiva),
        total: totalPelaVariacao,
      });
      conferir(
        `depois/${rpc.slice(-3)}: (a) com o variant_id certo CONTINUA passando`,
        a.ok === true,
        a.erro,
      );
      const b = await criarPedido(client, {
        rpc,
        itens: semVariacao(prodSemVar),
        total: totalPeloBase,
      });
      conferir(
        `depois/${rpc.slice(-3)}: (b) produto SEM variacao CONTINUA passando`,
        b.ok === true,
        b.erro,
      );
      const c = await criarPedido(client, {
        rpc,
        itens: semVariacao(prodInativa),
        total: totalPeloBase,
      });
      conferir(
        `depois/${rpc.slice(-3)}: (c) variacao INATIVA CONTINUA passando — o sobrevivente de pe`,
        c.ok === true,
        c.erro,
      );
    }

    console.log("\n7. o estoque da variacao agora DESCE pelo caminho certo");
    const antesDaBaixa = await estoques(client, prodComVar, varAtiva);
    await criarPedido(client, {
      rpc: RPCS[0],
      itens: comVariacao(prodComVar, varAtiva),
      total: totalPelaVariacao,
    });
    const depoisDaBaixa = await estoques(client, prodComVar, varAtiva);
    conferir(
      `stock_increment ${antesDaBaixa.variacao} -> ${depoisDaBaixa.variacao}`,
      depoisDaBaixa.variacao === antesDaBaixa.variacao - 1,
      `${antesDaBaixa.variacao} -> ${depoisDaBaixa.variacao}`,
    );

    console.log("\n8. os atributos sobreviveram ao CREATE OR REPLACE");
    const attrs = await atributosDasRpcs(client);
    conferir(
      "as DUAS RPCs continuam existindo, com a mesma assinatura",
      attrs.length === 2,
      JSON.stringify(attrs.map((a) => a.assinatura)),
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

    console.log(
      "\n9. REVERSAO — sem a guarda, o mesmo item volta a ser aceito",
    );
    await client.query(sqlAnterior);
    for (const rpc of RPCS) {
      const r = await criarPedido(client, {
        rpc,
        itens: semVariacao(prodComVar),
        total: totalPeloBase,
      });
      conferir(
        `revertido/${rpc.slice(-3)}: aceito de novo — quem decidiu era A GUARDA`,
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
    "ROLLBACK executado: nada foi gravado — nem as RPCs, nem os produtos, nem os pedidos.",
  );
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
