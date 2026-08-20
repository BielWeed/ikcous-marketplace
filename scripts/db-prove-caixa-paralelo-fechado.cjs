#!/usr/bin/env node
/**
 * Prova a migration que fecha o caixa paralelo esquecido: a v1 de
 * create_marketplace_order (sem sufixo) — sem comitar nada no banco.
 *
 *   supabase/migrations/20260825000000_revoke_execute_create_marketplace_order_v1.sql
 *
 * O BURACO
 *   create_marketplace_order (v1) e' uma implementacao completa e propria de
 *   criar pedido, com regras piores que as de hoje (estoque pode ficar
 *   negativo, cupom de porcentagem e' tratado como reais, grava em colunas
 *   mortas). Ninguem no app chama ela, mas `anon` e `authenticated` ainda tem
 *   EXECUTE — qualquer requisicao HTTP ao PostgREST alcanca.
 *
 * TUDO DENTRO DE UMA TRANSACAO QUE TERMINA EM ROLLBACK
 *   A migration foi conferida: nao tem BEGIN/COMMIT proprio (o script se
 *   recusa a rodar se tiver -- senao o COMMIT dela fecharia esta transacao e
 *   o ROLLBACK final viraria no-op).
 *
 * POR QUE RESET ROLE e RESET ALL antes do BEGIN
 *   O pooler do Supabase mantem estado de sessao entre conexoes -- nao so
 *   SET ROLE, tambem default_transaction_read_only, que ja produziu um falso
 *   negativo numa prova de seguranca deste projeto. RESET ALL limpa os dois.
 *
 * POR QUE SAVEPOINT em volta de cada chamada
 *   Uma query que falha deixa a transacao "abortada" ate um ROLLBACK (ou
 *   ROLLBACK TO SAVEPOINT). O roteiro PRECISA que algumas chamadas falhem
 *   (isso e' o que prova a correcao) -- cada uma roda isolada num savepoint,
 *   criado DEPOIS do SET ROLE / set_config, para a troca de papel e de claim
 *   sobreviver a um ROLLBACK TO SAVEPOINT.
 *
 * O ROTEIRO
 *   1. Le um produto real com estoque de sobra e um usuario real de
 *      auth.users (papel padrao da conexao, sem RLS -- so leitura).
 *   2. ANTES da migration: authenticated chama a v1 -- tem de alcancar o
 *      INSERT dentro do corpo da funcao (passar da checagem de "Não
 *      autenticado."). ACHADO, nao suposicao do plano original: a coluna
 *      `total` de marketplace_orders e' NOT NULL sem default desde o
 *      baseline de 06/08/2026, e a v1 grava so em `total_amount` (coluna
 *      morta) -- entao o INSERT sempre falha com violacao de NOT NULL, para
 *      QUALQUER chamador que passe da barreira de permissao e de
 *      autenticacao. A v1 nunca conseguiu, de fato, criar um pedido nesta
 *      base -- mas a prova que importa continua de pe: o erro muda de
 *      "quebrei dentro do corpo, numa constraint de schema" (ANTES) para
 *      "nem entrei no corpo, permission denied" (DEPOIS). anon tenta o
 *      mesmo ANTES -- tem de falhar com "Não autenticado." (mais cedo no
 *      corpo, porque auth.uid() e' nulo). Se qualquer um dos dois falhar com
 *      "permission denied" nesta etapa, a permissao de execucao ja nao
 *      existe e o buraco nao e' o descrito -- o script para e reporta.
 *   3. Migration aplicada dentro da transacao.
 *   4. DEPOIS: authenticated e anon tentam a v1 de novo -- OS DOIS TEM DE
 *      FALHAR com "permission denied for function create_marketplace_order".
 *   5. Nao regride o caminho vivo: authenticated cria um pedido pela v23 e
 *      outro pela v24, depois da migration -- os dois TEM DE FUNCIONAR.
 *   6. A v22 continua executavel -- chama uma vez e confirma.
 *   7. ROLLBACK. Nada fica gravado.
 *
 * USO:  node scripts/db-prove-caixa-paralelo-fechado.cjs
 * Sai com codigo 0 so se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260825000000_revoke_execute_create_marketplace_order_v1.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // O caminho vem de PROJECT_ROOT + uma das duas strings literais acima.
    // Nada aqui e' entrada de usuario, entao o alerta e' falso positivo.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

function lerMigration() {
  // MIGRATION e' constante de modulo, montada de __dirname. Falso positivo.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(MIGRATION, "utf8");
  // A trava que faz o ROLLBACK desta prova valer alguma coisa.
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
    throw new Error(
      "A migration tem BEGIN/COMMIT próprio: o ROLLBACK desta prova viraria no-op.",
    );
  }
  return sql;
}

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
}

/**
 * Tenta uma query isolada num SAVEPOINT: a falha esperada (não autenticado,
 * ou permissão negada) aborta só o savepoint, o resto da transação continua
 * utilizável.
 */
let contadorSavepoint = 0;
async function tentar(client, sql, params, rotulo) {
  const sp = `sp_caixa_paralelo_${++contadorSavepoint}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const r = await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { negado: false, id: r.rows[0]?.create_marketplace_order ?? r.rows[0], rotulo };
  } catch (erro) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return { negado: true, mensagem: erro.message, rotulo };
  }
}

async function trocarPara(client, papel) {
  // O pooler mantém SET ROLE entre conexões — nunca trocar sem antes limpar.
  await client.query("RESET ROLE");
  if (papel) await client.query(`SET ROLE ${papel}`);
}

async function definirClaims(client, userId) {
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "",
  ]);
}

async function main() {
  const migrationSql = lerMigration();

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  // Limpa estado que o pooler pode ter deixado de uma conexão anterior.
  await client.query("RESET ROLE");
  await client.query("RESET ALL");
  await client.query("BEGIN");

  try {
    const { rows: prodRows } = await client.query(
      `SELECT id, nome, preco_venda, estoque FROM public.produtos
        WHERE ativo = true AND deleted_at IS NULL
          AND COALESCE(frete_gratis, false) = false AND estoque >= 8
        ORDER BY preco_venda DESC LIMIT 1`,
    );
    if (prodRows.length === 0) {
      throw new Error(
        "Nenhum produto ativo com estoque >= 8 encontrado — sem massa para provar.",
      );
    }
    const produto = prodRows[0];

    const { rows: userRows } = await client.query(
      "SELECT id FROM auth.users ORDER BY created_at LIMIT 1",
    );
    if (userRows.length === 0) {
      throw new Error("Nenhum usuário em auth.users — sem massa para provar.");
    }
    const userId = userRows[0].id;

    // Trava free_shipping_min alto dentro da transação para um frete
    // previsível — desfeito pelo ROLLBACK final, nada fica gravado.
    await client.query(
      "UPDATE public.store_config SET free_shipping_min = 999999 WHERE id = 1",
    );
    const { rows: cfgRows } = await client.query(
      "SELECT shipping_fee FROM public.store_config WHERE id = 1",
    );
    const frete = Number(cfgRows[0].shipping_fee);
    const subtotal = Number(produto.preco_venda);
    const total = subtotal + frete;

    console.log(
      `Produto de prova: ${produto.nome} (R$ ${subtotal.toFixed(2)}, estoque ${produto.estoque}) · frete R$ ${frete.toFixed(2)} · usuário ${userId.slice(0, 8)}…\n`,
    );

    const itens = JSON.stringify([
      { product_id: produto.id, variant_id: null, quantity: 1 },
    ]);
    const chamarV1 = (client) =>
      tentar(
        client,
        `SELECT public.create_marketplace_order($1::jsonb, 'whatsapp', NULL, NULL, 'Prova caixa paralelo', '5534999999999', 'ROLLBACK - prova')`,
        [itens],
        "create_marketplace_order (v1)",
      );

    console.log("=== 1. ANTES da migration: a permissão de execução existe? ===");
    await trocarPara(client, "authenticated");
    await definirClaims(client, userId);
    const v1AntesAuth = await chamarV1(client);
    conferir(
      'ANTES da migration, authenticated alcança o INSERT dentro do corpo da v1 (falha em NOT NULL de "total", não em permissão nem em autenticação)',
      v1AntesAuth.negado &&
        /null value in column "total"/i.test(v1AntesAuth.mensagem) &&
        !/Não autenticado\./.test(v1AntesAuth.mensagem),
      v1AntesAuth.negado ? v1AntesAuth.mensagem : "não foi negado (inesperado — deveria falhar por NOT NULL de total)",
    );

    await trocarPara(client, "anon");
    await definirClaims(client, null);
    const v1AntesAnon = await chamarV1(client);
    conferir(
      "ANTES da migration, anon é barrado pelo corpo da função (\"Não autenticado.\"), não pela permissão",
      v1AntesAnon.negado && /Não autenticado\./.test(v1AntesAnon.mensagem),
      v1AntesAnon.negado ? v1AntesAnon.mensagem : "não foi negado",
    );

    if (
      /permission denied/i.test(v1AntesAuth.mensagem || "") ||
      /permission denied/i.test(v1AntesAnon.mensagem || "")
    ) {
      throw new Error(
        "ANTES da migration já apareceu 'permission denied': o buraco não é o descrito (a permissão de execução já não existe). Pare e investigue.",
      );
    }
    if (!v1AntesAuth.negado || !/null value in column "total"/i.test(v1AntesAuth.mensagem)) {
      throw new Error(
        "authenticated não alcançou o INSERT da v1 pela via esperada (erro de NOT NULL em total). O comportamento do banco mudou desde que a tarefa foi escrita. Pare e investigue.",
      );
    }

    console.log("\n=== 2. Migration aplicada (dentro da transação) ===");
    await trocarPara(client, null);
    await client.query(migrationSql);
    console.log("  aplicada dentro da transação");

    console.log(
      "\n=== 3. DEPOIS: authenticated e anon são barrados por permission denied ===",
    );
    await trocarPara(client, "authenticated");
    await definirClaims(client, userId);
    const v1DepoisAuth = await chamarV1(client);
    conferir(
      "DEPOIS da migration, authenticated é barrado por permission denied na v1",
      v1DepoisAuth.negado &&
        /permission denied for function create_marketplace_order/i.test(
          v1DepoisAuth.mensagem,
        ),
      v1DepoisAuth.negado ? v1DepoisAuth.mensagem : "não foi negado",
    );

    await trocarPara(client, "anon");
    await definirClaims(client, null);
    const v1DepoisAnon = await chamarV1(client);
    conferir(
      "DEPOIS da migration, anon é barrado por permission denied na v1",
      v1DepoisAnon.negado &&
        /permission denied for function create_marketplace_order/i.test(
          v1DepoisAnon.mensagem,
        ),
      v1DepoisAnon.negado ? v1DepoisAnon.mensagem : "não foi negado",
    );

    console.log(
      "\n=== 4. O caminho vivo (v23 e v24) não regrediu ===",
    );
    await trocarPara(client, "authenticated");
    await definirClaims(client, userId);
    const v23Depois = await tentar(
      client,
      `SELECT public.create_marketplace_order_v23(
         $1::jsonb, $2::numeric, 0, 'whatsapp', NULL, NULL,
         'Prova caixa paralelo v23', '5534999999999', 'ROLLBACK - prova',
         NULL, NULL, NULL)`,
      [itens, total],
      "create_marketplace_order_v23",
    );
    conferir(
      "DEPOIS da migration, authenticated ainda cria pedido pela v23 (pagamento na entrega)",
      !v23Depois.negado,
      v23Depois.negado ? v23Depois.mensagem : "criado",
    );

    const v24Depois = await tentar(
      client,
      `SELECT public.create_marketplace_order_v24(
         $1::jsonb, $2::numeric, 0, 'whatsapp', NULL, NULL,
         'Prova caixa paralelo v24', '5534999999999', 'ROLLBACK - prova',
         NULL, NULL, NULL)`,
      [itens, total],
      "create_marketplace_order_v24",
    );
    conferir(
      "DEPOIS da migration, authenticated ainda cria pedido pela v24 (pagamento online)",
      !v24Depois.negado,
      v24Depois.negado ? v24Depois.mensagem : "criado",
    );

    console.log("\n=== 5. A v22 (encaminhador) continua executável ===");
    const v22Depois = await tentar(
      client,
      `SELECT public.create_marketplace_order_v22(
         $1::jsonb, $2::numeric, 0, 'whatsapp', NULL, NULL,
         'Prova caixa paralelo v22', '5534999999999', 'ROLLBACK - prova',
         NULL)`,
      [itens, total],
      "create_marketplace_order_v22",
    );
    conferir(
      "DEPOIS da migration, a v22 continua executável e cria pedido",
      !v22Depois.negado,
      v22Depois.negado ? v22Depois.mensagem : "criado",
    );
  } finally {
    await trocarPara(client, null).catch(() => {});
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
