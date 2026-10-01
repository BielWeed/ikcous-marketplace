// @ts-nocheck
// O BALCÃO SABE SE O PIX ESTÁ PRONTO — prova offline do par
// 20261186000000 + rollback. A edge `cobrar-pix-no-balcao` (acao
// "prontidao") pergunta a `public.pix_do_balcao_pronto()` se as migrations
// 20261184000000 (iniciar_venda_presencial_pix + os dois gatilhos) e
// 20261185000000 (anular_venda_presencial) estão neste banco ANTES de a tela
// oferecer o PIX com QR — a venda reserva estoque, então "pronto" falso é
// pior que "não pronto". A função só LÊ o catálogo; quem a executa é só o
// service_role (a edge), nunca anon nem authenticated. Exige também que
// authenticated EXECUTE as duas funções e que os dois gatilhos disparem em
// sessão normal (tgenabled 'O' ou 'A'; 'R' só dispara em réplica).
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261186000000_o_balcao_sabe_se_o_pix_esta_pronto.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const ASSINATURA = "public.pix_do_balcao_pronto()";

const inicioDoCorpo = migration.indexOf("$function$");
const fimDoCorpo = migration.lastIndexOf("$function$");
const corpoCru =
  inicioDoCorpo >= 0 && fimDoCorpo > inicioDoCorpo
    ? migration.slice(inicioDoCorpo + 10, fimDoCorpo)
    : "";
const corpo = norm(corpoCru);
/** O corpo sem comentários nem strings: só o que o Postgres EXECUTA. */
const corpoExecutavel = norm(removerRuido(corpoCru));
/** Cabeçalho da função: de CREATE até o início do corpo. */
const cabecalho = norm(
  migration.slice(
    migration.search(
      // eslint-disable-next-line security/detect-unsafe-regex -- texto SQL fixo deste repositório, sem entrada externa.
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.pix_do_balcao_pronto\s*\(/i,
    ),
    inicioDoCorpo,
  ),
);
/** A migration sem comentários, strings e corpos: o SQL "de fora". */
const migrationExecutavel = norm(removerRuido(migration));

Deno.test("par migration+rollback aceito e sem BEGIN/COMMIT", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("cabeçalho: devolve boolean, STABLE, SECURITY INVOKER, search_path fechado", () => {
  assert(
    corpoCru,
    "corpo da função não encontrado entre $function$ … $function$",
  );
  assertStringIncludes(cabecalho, "RETURNS boolean");
  assert(/\bSTABLE\b/i.test(cabecalho), `sem STABLE: ${cabecalho}`);
  assertStringIncludes(cabecalho, "SECURITY INVOKER");
  assert(!/\bVOLATILE\b/i.test(cabecalho), "VOLATILE não é só leitura");
  assert(
    !/SECURITY\s+DEFINER/i.test(cabecalho),
    "SECURITY DEFINER não: lê o catálogo como quem chama",
  );
  assertStringIncludes(cabecalho, "SET search_path = pg_catalog, pg_temp");
});

Deno.test("só leitura: o corpo não escreve, não executa dinâmico, não trava, não avisa", () => {
  for (const proibido of [
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "MERGE",
    "CREATE",
    "ALTER",
    "DROP",
    "GRANT",
    "REVOKE",
    "COPY",
    "EXECUTE",
    "PERFORM",
    "LOCK",
    "NOTIFY",
    "nextval",
    "setval",
    "set_config",
    "pg_advisory",
    "pg_notify",
    "dblink",
  ]) {
    /* eslint-disable-next-line security/detect-non-literal-regexp --
     * palavra desta mesma lista, nunca entrada externa. */
    const re = new RegExp(`\\b${proibido}\\b`, "i");
    assert(
      !re.test(corpoExecutavel),
      `o corpo usa ${proibido}: ${corpoExecutavel}`,
    );
  }
});

/** Quantas vezes `trecho` aparece em `texto`. */
const ocorrencias = (texto, trecho) => texto.split(trecho).length - 1;

Deno.test("checa as duas funções das 84/85, o EXECUTE de authenticated nelas e os dois gatilhos da 84 — todos exigidos (E, nunca OU)", () => {
  for (const funcao of [
    "public.iniciar_venda_presencial_pix(jsonb,uuid,uuid,text,text,numeric,text)",
    "public.anular_venda_presencial(uuid,text)",
  ]) {
    assertStringIncludes(corpo, `to_regprocedure('${funcao}') IS NOT NULL`);
    // A tela do lojista chama as duas como authenticated: sem esse direito o
    // balcão falha na mão do caixa. Pelo OID (to_regprocedure), nunca pelo
    // texto: com o texto, função ausente LANÇA erro em vez de dar falso.
    assertStringIncludes(
      corpo,
      `has_function_privilege('authenticated', to_regprocedure('${funcao}'), 'EXECUTE')`,
    );
  }
  // OID nulo deixa has_function_privilege nulo: o resultado inteiro é
  // forçado a falso, nunca devolve NULL.
  assert(
    /^SELECT COALESCE\(/i.test(corpoExecutavel),
    `sem COALESCE externo: ${corpoExecutavel}`,
  );
  assert(
    /,\s*false\s*\)\s*;?$/i.test(corpoExecutavel),
    `o COALESCE não termina em false: ${corpoExecutavel}`,
  );
  assertStringIncludes(corpo, "pg_catalog.pg_trigger");
  assertStringIncludes(corpo, "'public.marketplace_orders'");
  for (const gatilho of [
    "tr_venda_do_balcao_paga_e_entregue",
    "tr_venda_do_balcao_guarda_o_status",
  ]) {
    assertStringIncludes(corpo, `'${gatilho}'`);
  }
  // Só conta gatilho que dispara em sessão normal: 'O' (origin/local) ou 'A'
  // (always). 'R' (só réplica) e 'D' (desligado) NÃO disparam no balcão.
  assertEquals(
    ocorrencias(corpo, "tgenabled IN ('O', 'A')"),
    2,
    "cada um dos dois gatilhos exige tgenabled IN ('O', 'A')",
  );
  assert(
    !/tgenabled\s*<>/i.test(corpo),
    "tgenabled <> aceita 'R' (só réplica), que não dispara",
  );
  assert(
    !/\bOR\b/i.test(corpoExecutavel),
    "condição com OU: uma peça faltando ainda daria 'pronto'",
  );
});

Deno.test("EXECUTE só para service_role (a edge); anon e authenticated nunca", () => {
  assertStringIncludes(
    migrationExecutavel,
    `REVOKE ALL ON FUNCTION ${ASSINATURA} FROM PUBLIC, anon, authenticated, service_role;`,
  );
  assertStringIncludes(
    migrationExecutavel,
    `GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO service_role;`,
  );
  const grants = migrationExecutavel.match(/\bGRANT\b[^;]*;/gi) || [];
  assertEquals(
    grants,
    [`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO service_role;`],
    "o único GRANT é o EXECUTE do service_role",
  );
  const revokePos = migrationExecutavel.indexOf(
    `REVOKE ALL ON FUNCTION ${ASSINATURA}`,
  );
  const grantPos = migrationExecutavel.indexOf(
    `GRANT EXECUTE ON FUNCTION ${ASSINATURA}`,
  );
  assert(revokePos >= 0 && revokePos < grantPos, "REVOKE antes do GRANT");
});

Deno.test("não recria nem mexe nas peças das 84/85: só cria a função de prontidão", () => {
  const criacoes =
    migrationExecutavel.match(
      // eslint-disable-next-line security/detect-unsafe-regex -- texto SQL fixo deste repositório, sem entrada externa.
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+[a-z_.]+/gi,
    ) || [];
  assertEquals(
    criacoes.map((c) => norm(c).split(" ").pop()),
    ["public.pix_do_balcao_pronto"],
  );
  for (const proibido of [
    /\bCREATE\s+TRIGGER\b/i,
    /\bDROP\s+TRIGGER\b/i,
    /\bALTER\b/i,
    /\bDROP\s+FUNCTION\b/i,
  ]) {
    assert(!proibido.test(migrationExecutavel), `a migration usa ${proibido}`);
  }
});

Deno.test("rollback: derruba só a função de prontidão", () => {
  const rollbackExecutavel = norm(removerRuido(rollback));
  assertEquals(
    rollbackExecutavel,
    `DROP FUNCTION IF EXISTS ${ASSINATURA};`,
    "o rollback não toca em nada das 84/85",
  );
});
