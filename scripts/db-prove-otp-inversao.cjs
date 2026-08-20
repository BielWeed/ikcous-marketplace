#!/usr/bin/env node
/**
 * Prova as duas migrations da inversao do OTP sem comitar nada no banco:
 *
 *   20260820000000_otp_v2_devolve_o_codigo.sql
 *   20260820000100_otp_sem_fila_nem_gatilho.sql
 *
 * POR QUE ESTE SCRIPT EXISTE, SE JA HA O db-apply
 *   O `db-apply.cjs` verifica marcador de TEXTO no corpo de funcao. A segunda
 *   migration nao cria funcao nenhuma — ela APAGA um gatilho e REVOGA grants —,
 *   e o mapa `VERIFICACOES` nao tem como expressar ausencia. Sem este script,
 *   ela seria aplicada e o db-apply imprimiria "Tudo aplicado e verificado"
 *   sem ter conferido uma linha (INFRA-370, #204).
 *
 *   E o que se prova aqui e mais forte que marcador de texto: a v2 e EXECUTADA,
 *   com dados reais de um pedido, e o que se afere e o comportamento dela.
 *
 * TUDO DENTRO DE UMA TRANSACAO QUE TERMINA EM ROLLBACK
 *   As duas migrations foram conferidas: nenhuma tem BEGIN/COMMIT proprio. Se
 *   tivessem, o COMMIT delas fecharia a transacao aqui e o ROLLBACK final
 *   viraria no-op — foi assim que uma migration gravou em producao em
 *   05/08/2026.
 *
 *   Depois do ROLLBACK, o script reconfere o estado FORA da transacao: v2 tem
 *   de ter sumido, o gatilho tem de ter voltado, e a v1 tem de ter recuperado
 *   o EXECUTE de anon. Prova que nao ficou residuo.
 *
 * O QUE ELE NAO PROVA
 *   Que o e-mail chega. Isso depende do SMTP da loja e da edge function
 *   publicada, e so se prova com um pedido comitado de verdade, no ar.
 *
 * USO:
 *   node scripts/db-prove-otp-inversao.cjs              prova por ROLLBACK (antes)
 *   node scripts/db-prove-otp-inversao.cjs --verificar   confere o estado (depois)
 *
 * O modo `--verificar` nao aplica nada: ele afere o banco COMO ESTA contra o
 * estado final esperado. E o contrapeso da cegueira do db-apply — ele imprimiu
 * "Tudo aplicado e verificado" logo depois de dizer "sem verificacao registrada,
 * pulando", porque a migration B nao cria funcao e o mapa dele so sabe procurar
 * marcador de texto em corpo de funcao (INFRA-370, #204).
 *
 * Sai com codigo 0 so se TODAS as asseracoes passarem.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIR = path.join(PROJECT_ROOT, "supabase", "migrations");
const MIGRACAO_A = "20260820000000_otp_v2_devolve_o_codigo.sql";
const MIGRACAO_B = "20260820000100_otp_sem_fila_nem_gatilho.sql";

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

function lerMigration(nome) {
  const caminho = path.join(DIR, nome);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(caminho, "utf8");
  // A trava que faz o ROLLBACK valer alguma coisa.
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
    throw new Error(
      `${nome} tem BEGIN/COMMIT proprio: o ROLLBACK desta prova viraria no-op.`,
    );
  }
  return sql;
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

/** Mascara e-mail: o endereco de quem comprou nao vai para a saida do script. */
const mascarar = (e) => String(e ?? "").replace(/^(.).*?(@.*)$/, "$1***$2");

/**
 * Confere o estado final, sem aplicar nada. Roda DEPOIS do apply.
 *
 * Aqui a v2 nao e executada de proposito: no banco de verdade, cada chamada bem
 * sucedida grava um codigo e queima a janela de 60 segundos de um pedido real.
 * O comportamento ja foi provado na transacao que terminou em ROLLBACK; o que
 * falta conferir e' o que ficou de pe.
 */
async function verificarEstadoFinal(client) {
  titulo("Estado final (nada e aplicado neste modo)");
  const { rows } = await client.query(`
    SELECT
      to_regprocedure('public.generate_order_otp_v2(text,text,text)') IS NOT NULL AS v2_existe,
      (SELECT t.typname FROM pg_proc p JOIN pg_type t ON t.oid = p.prorettype
        WHERE p.oid = 'public.generate_order_otp_v2(text,text,text)'::regprocedure) AS v2_retorno,
      has_function_privilege('anon',
        'public.generate_order_otp_v2(text,text,text)', 'EXECUTE') AS v2_anon,
      has_function_privilege('authenticated',
        'public.generate_order_otp_v2(text,text,text)', 'EXECUTE') AS v2_auth,
      has_function_privilege('service_role',
        'public.generate_order_otp_v2(text,text,text)', 'EXECUTE') AS v2_servico,
      EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgrelid = 'public.otp_verifications'::regclass
                 AND tgname = 'on_otp_created_send_email' AND NOT tgisinternal) AS gatilho,
      to_regprocedure('public.handle_new_otp_verification()') IS NOT NULL AS handler,
      to_regprocedure('public.generate_order_otp_v1(text,text,text)') IS NOT NULL AS v1_existe,
      has_function_privilege('anon',
        'public.generate_order_otp_v1(text,text,text)', 'EXECUTE') AS v1_anon,
      has_function_privilege('authenticated',
        'public.generate_order_otp_v1(text,text,text)', 'EXECUTE') AS v1_auth,
      (SELECT count(*) FROM supabase_migrations.schema_migrations
        WHERE version IN ('20260820000000', '20260820000100')) AS no_ledger
  `);
  const e = rows[0];
  ok("a v2 existe e devolve jsonb", e.v2_existe === true && e.v2_retorno === "jsonb");
  ok("so service_role executa a v2", e.v2_servico === true && e.v2_anon === false && e.v2_auth === false);
  ok("o gatilho on_otp_created_send_email nao existe mais", e.gatilho === false);
  ok("a funcao handle_new_otp_verification nao existe mais", e.handler === false);
  ok("a v1 continua existindo (caminho de volta)", e.v1_existe === true);
  ok("nem anon nem authenticated executam a v1", e.v1_anon === false && e.v1_auth === false);
  ok("as duas migrations estao registradas no ledger", Number(e.no_ledger) === 2, String(e.no_ledger));
}

async function main() {
  if (process.argv.includes("--verificar")) {
    const client = new Client({
      connectionString: lerDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      await verificarEstadoFinal(client);
    } catch (e) {
      falhas += 1;
      console.error(`\nERRO: ${e.message}`);
    } finally {
      await client.end();
    }
    console.log(`\n=== Resultado: ${passes} asseracoes OK, ${falhas} falha(s) ===`);
    process.exit(falhas === 0 ? 0 : 1);
  }

  const sqlA = lerMigration(MIGRACAO_A);
  const sqlB = lerMigration(MIGRACAO_B);

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const q = (sql, params) => client.query(sql, params);

  try {
    titulo("0. Estado ANTES (fora da transacao)");
    const antes = await q(`
      SELECT
        to_regprocedure('public.generate_order_otp_v2(text,text,text)') IS NOT NULL AS v2_existe,
        EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.otp_verifications'::regclass
                   AND tgname = 'on_otp_created_send_email' AND NOT tgisinternal) AS gatilho,
        has_function_privilege('anon',
          'public.generate_order_otp_v1(text,text,text)', 'EXECUTE') AS v1_anon
    `);
    const e0 = antes.rows[0];
    console.log(`  v2 existe .................. ${e0.v2_existe}`);
    console.log(`  gatilho on_otp_created ..... ${e0.gatilho}`);
    console.log(`  v1 executavel por anon ..... ${e0.v1_anon}`);
    ok("a v2 ainda NAO existe (nada foi aplicado antes)", e0.v2_existe === false);
    ok("o caminho antigo esta de pe (gatilho + EXECUTE da v1)", e0.gatilho && e0.v1_anon);

    // Um pedido real para exercitar a v2. So leitura: o INSERT do codigo que a
    // funcao faz morre no ROLLBACK junto com o resto.
    const alvo = await q(`
      SELECT o.id,
             regexp_replace(coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
                            '[^0-9]', '', 'g') AS fone,
             coalesce(o.customer_data->>'email', u.email) AS mail
        FROM public.marketplace_orders o
        LEFT JOIN auth.users u ON u.id = o.user_id
       WHERE coalesce(o.customer_phone, o.customer_data->>'whatsapp', '') <> ''
         AND coalesce(o.customer_data->>'email', u.email, '') <> ''
       LIMIT 1
    `);
    if (alvo.rowCount === 0) {
      throw new Error(
        "Nenhum pedido com e-mail E telefone: sem massa para exercitar a v2.",
      );
    }
    const pedido = alvo.rows[0];
    // Sufixo longo o bastante para casar um pedido so.
    const fragmento = String(pedido.id).slice(-12);
    console.log(
      `  pedido de prova ............ ...${fragmento} / ${mascarar(pedido.mail)}`,
    );

    await q("BEGIN");

    titulo("1. Aplica a migration A (generate_order_otp_v2)");
    await q(sqlA);
    console.log("  aplicada dentro da transacao");

    const defA = await q(`
      SELECT t.typname AS retorno, p.prosecdef,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico
        FROM pg_proc p JOIN pg_type t ON t.oid = p.prorettype
       WHERE p.oid = 'public.generate_order_otp_v2(text,text,text)'::regprocedure
    `);
    const d = defA.rows[0];
    ok("a v2 devolve jsonb (a v1 devolvia boolean)", d.retorno === "jsonb", d.retorno);
    ok("a v2 e SECURITY DEFINER", d.prosecdef === true);
    ok("anon NAO executa a v2 (ela devolve o codigo em texto claro)", d.anon === false);
    ok("authenticated NAO executa a v2", d.auth === false);
    ok("service_role executa a v2 (e quem a edge function usa)", d.servico === true);

    titulo("2. Comportamento da v2");

    const errado = await q(
      "SELECT public.generate_order_otp_v2($1, $2, $3) AS r",
      ["nao-existe@exemplo.invalido", "34900000000", "abcdef"],
    );
    ok(
      "dados que nao conferem -> ok:false / nao_confere",
      errado.rows[0].r?.ok === false && errado.rows[0].r?.motivo === "nao_confere",
      JSON.stringify(errado.rows[0].r),
    );

    const semFone = await q(
      "SELECT public.generate_order_otp_v2($1, $2, $3) AS r",
      [pedido.mail, "  ", fragmento],
    );
    ok(
      "e-mail sem WhatsApp NAO abre o fluxo (AUTH-010, #118)",
      semFone.rows[0].r?.ok === false,
      JSON.stringify(semFone.rows[0].r),
    );

    const curinga = await q(
      "SELECT public.generate_order_otp_v2($1, $2, $3) AS r",
      [pedido.mail, pedido.fone, "%%%%%%"],
    );
    ok(
      "fragmento com curinga (%) e recusado, nao casa pedido qualquer",
      curinga.rows[0].r?.ok === false,
      JSON.stringify(curinga.rows[0].r),
    );

    const curto = await q(
      "SELECT public.generate_order_otp_v2($1, $2, $3) AS r",
      [pedido.mail, pedido.fone, "abc"],
    );
    ok(
      "fragmento curto (menos de 6) e recusado",
      curto.rows[0].r?.ok === false,
      JSON.stringify(curto.rows[0].r),
    );

    const certo = await q(
      "SELECT public.generate_order_otp_v2($1, $2, $3) AS r",
      [pedido.mail, pedido.fone, fragmento],
    );
    const r = certo.rows[0].r;
    ok("dados certos -> ok:true", r?.ok === true, JSON.stringify(r));
    ok(
      "a resposta TRAZ o codigo (a razao de a v2 existir)",
      typeof r?.otp_code === "string" && /^\d{6}$/.test(r.otp_code),
    );
    ok("a resposta traz o e-mail de destino", r?.email === pedido.mail);

    const gravado = await q(
      `SELECT order_id, otp_code, expires_at > NOW() AS valido
         FROM public.otp_verifications WHERE otp_code = $1`,
      [r?.otp_code ?? ""],
    );
    ok(
      "o codigo ficou gravado, amarrado ao pedido certo e ainda valido",
      gravado.rowCount === 1 &&
        gravado.rows[0].order_id === pedido.id &&
        gravado.rows[0].valido === true,
    );

    const repetido = await q(
      "SELECT public.generate_order_otp_v2($1, $2, $3) AS r",
      [pedido.mail, pedido.fone, fragmento],
    );
    const rep = repetido.rows[0].r;
    ok(
      "segunda chamada em seguida -> muito_recente (freio da cota do Gmail)",
      rep?.ok === false && rep?.motivo === "muito_recente",
      JSON.stringify(rep),
    );
    ok(
      "o freio diz quantos segundos esperar",
      Number(rep?.espere_segundos) > 0 && Number(rep?.espere_segundos) <= 60,
      String(rep?.espere_segundos),
    );

    titulo("3. Aplica a migration B (o caminho antigo sai de cena)");
    await q(sqlB);
    console.log("  aplicada dentro da transacao");

    const depois = await q(`
      SELECT
        EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.otp_verifications'::regclass
                   AND tgname = 'on_otp_created_send_email' AND NOT tgisinternal) AS gatilho,
        to_regprocedure('public.handle_new_otp_verification()') IS NOT NULL AS handler,
        to_regprocedure('public.generate_order_otp_v1(text,text,text)') IS NOT NULL AS v1_existe,
        has_function_privilege('anon',
          'public.generate_order_otp_v1(text,text,text)', 'EXECUTE') AS v1_anon,
        has_function_privilege('authenticated',
          'public.generate_order_otp_v1(text,text,text)', 'EXECUTE') AS v1_auth,
        has_function_privilege('service_role',
          'public.generate_order_otp_v1(text,text,text)', 'EXECUTE') AS v1_servico
    `);
    const f = depois.rows[0];
    ok("o gatilho on_otp_created_send_email sumiu", f.gatilho === false);
    ok("a funcao handle_new_otp_verification sumiu", f.handler === false);
    ok("a v1 CONTINUA existindo (caminho de volta se o front precisar reverter)", f.v1_existe === true);
    ok("anon perdeu o EXECUTE da v1 (ninguem grava codigo sem envio)", f.v1_anon === false);
    ok("authenticated perdeu o EXECUTE da v1", f.v1_auth === false);
    ok("service_role mantem a v1 (e o que permite reverter)", f.v1_servico === true);

    titulo("4. ROLLBACK");
    await q("ROLLBACK");
    console.log("  desfeito");

    const volta = await q(`
      SELECT
        to_regprocedure('public.generate_order_otp_v2(text,text,text)') IS NOT NULL AS v2_existe,
        EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.otp_verifications'::regclass
                   AND tgname = 'on_otp_created_send_email' AND NOT tgisinternal) AS gatilho,
        has_function_privilege('anon',
          'public.generate_order_otp_v1(text,text,text)', 'EXECUTE') AS v1_anon,
        (SELECT count(*) FROM public.otp_verifications) AS codigos
    `);
    const v = volta.rows[0];
    ok("a v2 nao existe mais: nada ficou gravado", v.v2_existe === false);
    ok("o gatilho voltou", v.gatilho === true);
    ok("a v1 voltou a ser executavel por anon", v.v1_anon === true);
    ok(
      "nenhum codigo de verificacao sobrou na tabela",
      Number(v.codigos) === 0,
      String(v.codigos),
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

  console.log(`\n=== Resultado: ${passes} asseracoes OK, ${falhas} falha(s) ===`);
  process.exit(falhas === 0 ? 0 : 1);
}

main();
