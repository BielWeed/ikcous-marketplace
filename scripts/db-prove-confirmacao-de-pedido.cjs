#!/usr/bin/env node
/**
 * Prova a migration 20260821000000_confirmacao_de_pedido_uma_vez.sql sem
 * comitar nada (PEDIDO-070, #106).
 *
 * O QUE ELE PROVA, dentro de UMA transacao que termina em ROLLBACK:
 *   1. A coluna e as duas funcoes nascem, com as permissoes certas — nem `anon`
 *      nem `authenticated` alcancam nenhuma das duas.
 *   2. A primeira reivindicacao devolve true e carimba a coluna.
 *   3. A SEGUNDA devolve false. E' esta asseracao que representa o defeito real:
 *      navegador repete (dois toques, recarregar, StrictMode montando duas
 *      vezes), e cada e-mail repetido come uma das ~100 mensagens diarias da
 *      conta de Gmail da loja.
 *   4. Pedido inexistente devolve false, e nao erro.
 *   5. `liberar` devolve a coluna a NULL e uma nova reivindicacao volta a ser
 *      possivel — o caminho de quando o SMTP recusa a mensagem.
 *   6. A reivindicacao de um pedido NAO afeta outro.
 *
 * E DEPOIS DO ROLLBACK reconfere, FORA da transacao, que nada ficou.
 *
 * `--verificar` afere o estado final depois de aplicar, sem aplicar nada. E' o
 * contrapeso da cegueira do db-apply, que so sabe procurar marcador de texto em
 * corpo de funcao e nada afere sobre coluna nova ou grant (INFRA-370, #204).
 *
 * USO:
 *   node scripts/db-prove-confirmacao-de-pedido.cjs
 *   node scripts/db-prove-confirmacao-de-pedido.cjs --verificar
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRACAO = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260821000000_confirmacao_de_pedido_uma_vez.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL nao encontrada.");
}

let falhas = 0;
let passes = 0;
function ok(descricao, condicao, detalhe = "") {
  if (condicao) {
    passes += 1;
    console.log(`  OK   ${descricao}`);
  } else {
    falhas += 1;
    console.log(`  FALHA ${descricao}${detalhe ? ` -> ${detalhe}` : ""}`);
  }
}
const titulo = (t) => console.log(`\n=== ${t} ===`);

const PERMISSOES = `
  SELECT
    has_function_privilege('anon',
      'public.reivindicar_email_de_confirmacao(uuid)', 'EXECUTE') AS reiv_anon,
    has_function_privilege('authenticated',
      'public.reivindicar_email_de_confirmacao(uuid)', 'EXECUTE') AS reiv_auth,
    has_function_privilege('service_role',
      'public.reivindicar_email_de_confirmacao(uuid)', 'EXECUTE') AS reiv_servico,
    has_function_privilege('anon',
      'public.liberar_email_de_confirmacao(uuid)', 'EXECUTE') AS lib_anon,
    has_function_privilege('authenticated',
      'public.liberar_email_de_confirmacao(uuid)', 'EXECUTE') AS lib_auth,
    has_function_privilege('service_role',
      'public.liberar_email_de_confirmacao(uuid)', 'EXECUTE') AS lib_servico
`;

const EXISTENCIA = `
  SELECT
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'marketplace_orders'
               AND column_name = 'confirmation_email_sent_at') AS coluna,
    to_regprocedure('public.reivindicar_email_de_confirmacao(uuid)') IS NOT NULL AS reivindicar,
    to_regprocedure('public.liberar_email_de_confirmacao(uuid)') IS NOT NULL AS liberar
`;

function conferirPermissoes(p) {
  ok(
    "nem anon nem authenticated reivindicam (queimariam o e-mail alheio)",
    p.reiv_anon === false && p.reiv_auth === false,
  );
  ok(
    "service_role reivindica (e quem a edge function usa)",
    p.reiv_servico === true,
  );
  ok(
    "nem anon nem authenticated liberam (forcariam reenvio ate esgotar a cota)",
    p.lib_anon === false && p.lib_auth === false,
  );
  ok("service_role libera", p.lib_servico === true);
}

async function verificarEstadoFinal(client) {
  titulo("Estado final (nada e aplicado neste modo)");
  const e = (await client.query(EXISTENCIA)).rows[0];
  ok("a coluna confirmation_email_sent_at existe", e.coluna === true);
  ok("a reivindicar_email_de_confirmacao existe", e.reivindicar === true);
  ok("a liberar_email_de_confirmacao existe", e.liberar === true);
  conferirPermissoes((await client.query(PERMISSOES)).rows[0]);
  const l = await client.query(
    `SELECT count(*) n FROM supabase_migrations.schema_migrations WHERE version = '20260821000000'`,
  );
  ok("a migration esta registrada no ledger", Number(l.rows[0].n) === 1);
}

async function main() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(MIGRACAO, "utf8");
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
    throw new Error(
      "A migration tem BEGIN/COMMIT proprio: o ROLLBACK desta prova viraria no-op.",
    );
  }

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const q = (texto, params) => client.query(texto, params);

  if (process.argv.includes("--verificar")) {
    try {
      await verificarEstadoFinal(client);
    } catch (e) {
      falhas += 1;
      console.error(`\nERRO: ${e.message}`);
    } finally {
      await client.end();
    }
    console.log(
      `\n=== Resultado: ${passes} asseracoes OK, ${falhas} falha(s) ===`,
    );
    process.exit(falhas === 0 ? 0 : 1);
  }

  try {
    titulo("0. Estado ANTES (fora da transacao)");
    const antes = (await q(EXISTENCIA)).rows[0];
    console.log(`  coluna ...... ${antes.coluna}`);
    console.log(`  reivindicar . ${antes.reivindicar}`);
    console.log(`  liberar ..... ${antes.liberar}`);
    ok(
      "nada disso existe ainda (a migration nao foi aplicada antes)",
      antes.coluna === false &&
        antes.reivindicar === false &&
        antes.liberar === false,
    );

    // Dois pedidos reais, so' para ter id valido. O carimbo que a funcao grava
    // morre no ROLLBACK junto com o resto.
    const alvos = await q(
      "SELECT id FROM public.marketplace_orders ORDER BY created_at DESC LIMIT 2",
    );
    if (alvos.rowCount < 2) {
      throw new Error("Menos de 2 pedidos no banco: sem massa para a prova.");
    }
    const [pedidoA, pedidoB] = alvos.rows.map((r) => r.id);

    await q("BEGIN");

    titulo("1. Aplica a migration");
    await q(sql);
    console.log("  aplicada dentro da transacao");

    const depois = (await q(EXISTENCIA)).rows[0];
    ok("a coluna nasceu", depois.coluna === true);
    ok("as duas funcoes nasceram", depois.reivindicar && depois.liberar);
    conferirPermissoes((await q(PERMISSOES)).rows[0]);

    titulo("2. A reserva, que e a razao de tudo isto existir");

    const primeira = await q(
      "SELECT public.reivindicar_email_de_confirmacao($1) AS r",
      [pedidoA],
    );
    ok("a PRIMEIRA reivindicacao devolve true", primeira.rows[0].r === true);

    const carimbo = await q(
      "SELECT confirmation_email_sent_at IS NOT NULL AS marcado FROM public.marketplace_orders WHERE id = $1",
      [pedidoA],
    );
    ok("e ela carimba a coluna", carimbo.rows[0].marcado === true);

    const segunda = await q(
      "SELECT public.reivindicar_email_de_confirmacao($1) AS r",
      [pedidoA],
    );
    ok(
      "a SEGUNDA devolve false (e o que impede o e-mail repetido)",
      segunda.rows[0].r === false,
    );

    const terceira = await q(
      "SELECT public.reivindicar_email_de_confirmacao($1) AS r",
      [pedidoA],
    );
    ok("a terceira tambem devolve false", terceira.rows[0].r === false);

    const outro = await q(
      "SELECT public.reivindicar_email_de_confirmacao($1) AS r",
      [pedidoB],
    );
    ok("reservar um pedido NAO reserva os outros", outro.rows[0].r === true);

    const inexistente = await q(
      "SELECT public.reivindicar_email_de_confirmacao($1) AS r",
      ["00000000-0000-4000-8000-000000000000"],
    );
    ok(
      "pedido inexistente devolve false, e nao erro",
      inexistente.rows[0].r === false,
    );

    titulo("3. Devolver a reserva quando o SMTP recusa");

    await q("SELECT public.liberar_email_de_confirmacao($1)", [pedidoA]);
    const solto = await q(
      "SELECT confirmation_email_sent_at IS NULL AS livre FROM public.marketplace_orders WHERE id = $1",
      [pedidoA],
    );
    ok("liberar devolve a coluna a NULL", solto.rows[0].livre === true);

    const denovo = await q(
      "SELECT public.reivindicar_email_de_confirmacao($1) AS r",
      [pedidoA],
    );
    ok("e uma nova tentativa volta a ser possivel", denovo.rows[0].r === true);

    titulo("4. ROLLBACK");
    await q("ROLLBACK");
    console.log("  desfeito");

    const volta = (await q(EXISTENCIA)).rows[0];
    ok("a coluna nao existe mais", volta.coluna === false);
    ok(
      "as duas funcoes nao existem mais",
      volta.reivindicar === false && volta.liberar === false,
    );
  } catch (e) {
    falhas += 1;
    console.error(`\nERRO: ${e.message}`);
    try {
      await client.query("ROLLBACK");
      console.error("(transacao desfeita)");
    } catch {
      /* ja estava fora de transacao */
    }
  } finally {
    await client.end();
  }

  console.log(
    `\n=== Resultado: ${passes} asseracoes OK, ${falhas} falha(s) ===`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main();
