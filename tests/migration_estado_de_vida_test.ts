import { createHash } from "node:crypto";
// @ts-nocheck
// A LOJA TEM ESTADO DE VIDA — prova offline do trio 20261460000000 + rollback comum + rollback destrutivo
// (plano L8, Lote 1, 26/11/2026: ativa / adormecida / encerrada na caderneta da frota).
//
// O DEFEITO QUE ESTE TESTE FIXA: a caderneta so sabia "ativa ou nao". Uma loja que parou de pagar (adormecida) ou saiu
// (encerrada) so podia sumir (`ativa = false`), e o porteiro a tratava como endereco desconhecido. O estado novo tem de:
//   - nascer sem apagar nem reescrever nada (toda loja que ja existe nasce `ativa`);
//   - fazer a `resolver_loja` de hoje (v1, a do porteiro em producao) IGNORAR loja nao ativa, sem mudar mais nada no corpo;
//   - abrir a `resolver_loja_com_estado` (v2) que diz o estado SEM entregar a URL e a chave do banco de loja fora do ar;
//   - manter as travas da v1 (SECURITY DEFINER, search_path vazio, VOLATILE, so o anon executa, chave conferida antes);
//   - ter rollback que devolve a v1 BYTE A BYTE ao corpo da 20261141 e preserva o dado.
// A decisao real (papeis, chave, estados, rollback, pre-voo, mutantes) fica com
// tests/banco/a-loja-tem-estado-de-vida-viva.cjs, no Postgres efemero do CI.
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
const RAIZ = `${DIR}..`;
const NOME = "20261460000000_a_loja_tem_estado_de_vida.sql";
const LER = (n) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${n}`).replace(/\r/g, "");
const migration = LER(NOME);
const rollback = LER(`rollback-manual-${NOME}`);
const destrutivo = LER(`rollback-manual-destrutivo-${NOME}`);
const caderneta = LER("20261141000000_caderneta_da_frota.sql");

const norm = (s) => s.replace(/\s+/g, " ").trim();
// `bruto` tira so os comentarios de linha (literais e corpos ficam); `codigo` tira tambem literais e corpos (so estrutura).
const bruto = (s) => norm(s.replace(/--.*$/gm, ""));
const codigo = (s) => norm(removerRuido(s));
const md5 = (s) => createHash("md5").update(s).digest("hex");

/** O texto entre `AS $$` e `$$;` do CREATE OR REPLACE FUNCTION `nome` (o que o Postgres guarda em prosrc). */
function corpo(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  assert(i >= 0, `${nome} nao encontrada`);
  const abre = sql.indexOf("AS $$", i) + "AS $$".length;
  return sql.slice(abre, sql.indexOf("$$;", abre));
}
/** O statement inteiro do CREATE OR REPLACE FUNCTION `nome`, do CREATE ate o `$$;`. */
function bloco(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  assert(i >= 0, `${nome} nao encontrada`);
  const fim = sql.indexOf("$$;", sql.indexOf("AS $$", i)) + "$$;".length;
  return sql.slice(i, fim);
}
const V1 = "public.resolver_loja";
const V2 = "public.resolver_loja_com_estado";
const CORPO_V1_ANTIGO = corpo(caderneta, V1);
const MD5_V1_ANTIGO = md5(CORPO_V1_ANTIGO);
// A UNICA troca permitida no corpo da v1: o filtro do estado, entre o `AND fl.ativa` e o `;`.
const FILTRO_NOVO_V1 =
  "\n     -- 20261460000000: loja adormecida ou encerrada nao resolve pela v1 (o porteiro que usa a v1 a trata como endereco desconhecido).\n     AND fl.estado = 'ativa'";

Deno.test("avaliarFase0 nao recusa o par migration + rollback comum", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum dos tres arquivos abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback comum", rollback],
    ["rollback destrutivo", destrutivo],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${nome} contem controle de transacao`);
  }
});

Deno.test("o pre-voo e' o primeiro comando depois dos SET LOCAL (lock_timeout de 5 s), recusa com B1_BASELINE_DIVERGENT e o pos-voo vem no fim", () => {
  const iPre = migration.indexOf("DO $preflight_20261460000000$");
  const iPos = migration.indexOf("DO $posvoo_20261460000000$");
  assert(iPre > 0 && iPos > iPre, "pre-voo e pos-voo presentes, nessa ordem");
  const antes = codigo(migration.slice(0, iPre))
    .replace(/SET LOCAL [^;]+;/g, "")
    .trim();
  assertEquals(antes, "", "nada alem de SET LOCAL antes do pre-voo");
  assertStringIncludes(migration, "SET LOCAL lock_timeout = '5s';");
  assertStringIncludes(migration, "SET LOCAL statement_timeout = '30s';");
  assertStringIncludes(migration, "B1_BASELINE_DIVERGENT");
  // O pre-voo conhece o corpo VIVO da 20261141 (md5 calculado do arquivo da caderneta) e o corpo que esta migration deixa.
  const pre = migration.slice(
    iPre,
    migration.indexOf("$preflight_20261460000000$;", iPre),
  );
  assertStringIncludes(pre, `'${MD5_V1_ANTIGO}'`);
  assertStringIncludes(pre, `'${md5(corpo(migration, V1))}'`);
  assertStringIncludes(pre, `'${md5(corpo(migration, V2))}'`);
  const pos = migration.slice(iPos);
  assertStringIncludes(pos, `'${md5(corpo(migration, V1))}'`);
  assertStringIncludes(pos, `'${md5(corpo(migration, V2))}'`);
  assertStringIncludes(migration, "NOTIFY pgrst, 'reload schema';");
});

Deno.test("as tres colunas nascem com ADD COLUMN IF NOT EXISTS, o CHECK dos tres estados nasce junto com a coluna, e nenhuma linha e' escrita ou apagada", () => {
  const m = bruto(migration);
  assertStringIncludes(
    m,
    "ALTER TABLE public.frota_lojas ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'ativa' CONSTRAINT frota_lojas_estado_check CHECK (estado IN ('ativa', 'adormecida', 'encerrada')), ADD COLUMN IF NOT EXISTS estado_desde timestamptz NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS estado_sha text;",
  );
  const c = codigo(migration);
  assert(
    !/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN|DROP\s+FUNCTION|DROP\s+CONSTRAINT)\b/i.test(
      c,
    ),
    "a migration escreve, apaga ou derruba algo",
  );
  assert(!/CASCADE/i.test(c), "sem CASCADE");
});

Deno.test("v1 (resolver_loja): mesma assinatura e mesmo cabecalho da 20261141, e o corpo e' o da 20261141 com UMA troca so: o filtro do estado", () => {
  const novo = bloco(migration, V1);
  const antigo = bloco(caderneta, V1);
  // Cabecalho (assinatura, RETURNS TABLE, linguagem, SECURITY DEFINER, VOLATILE, search_path) identico.
  assertEquals(
    novo.slice(0, novo.indexOf("AS $$")),
    antigo.slice(0, antigo.indexOf("AS $$")),
  );
  const corpoNovo = corpo(migration, V1);
  assertEquals(
    corpoNovo.split(FILTRO_NOVO_V1).length,
    2,
    "o filtro aparece uma vez",
  );
  assertEquals(
    corpoNovo.replace(FILTRO_NOVO_V1, ""),
    CORPO_V1_ANTIGO,
    "fora o filtro, o corpo e' o da 20261141 byte a byte",
  );
  assertStringIncludes(corpoNovo, "     AND fl.ativa\n");
});

Deno.test("v2 (resolver_loja_com_estado): as mesmas travas da v1 (SECURITY DEFINER, VOLATILE, search_path vazio, chave conferida antes, so o anon executa)", () => {
  const b = bloco(migration, V2);
  const cabecalho = norm(b.slice(0, b.indexOf("AS $$")));
  assertEquals(
    cabecalho,
    norm(`CREATE OR REPLACE FUNCTION public.resolver_loja_com_estado(p_host text, p_chave text)
      RETURNS TABLE ( id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text, estado text )
      LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = ''`),
  );
  assert(!/\b(STABLE|IMMUTABLE)\b/.test(cabecalho), "nunca STABLE/IMMUTABLE");
  const c = norm(corpo(migration, V2));
  // A mesma porta da chave da v1 (zero linhas, sem erro, antes de qualquer leitura da caderneta).
  assertStringIncludes(
    c,
    norm(
      "IF NOT EXISTS ( SELECT 1 FROM public.frota_segredo fs WHERE fs.id = 1 AND fs.hash = extensions.crypt(p_chave, fs.hash) ) THEN RETURN;",
    ),
  );
  assert(
    c.indexOf("extensions.crypt") < c.indexOf("public.frota_lojas"),
    "a chave e' conferida antes de ler a caderneta",
  );
  const m = bruto(migration);
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.resolver_loja_com_estado(text, text) FROM PUBLIC, authenticated, service_role;",
  );
  assertStringIncludes(
    m,
    "GRANT EXECUTE ON FUNCTION public.resolver_loja_com_estado(text, text) TO anon;",
  );
  const grants = [...m.matchAll(/GRANT [^;]+;/g)].map((x) => x[0]);
  assertEquals(
    grants,
    [
      "GRANT EXECUTE ON FUNCTION public.resolver_loja_com_estado(text, text) TO anon;",
    ],
    "o unico GRANT da migration e' o EXECUTE da v2 ao anon",
  );
});

Deno.test("v2: loja fora do ar devolve id, nome, ref e estado, mas a URL e a chave do banco dela saem NULAS; ativa = false continua sem linha", () => {
  const c = norm(corpo(migration, V2));
  assertStringIncludes(
    c,
    norm(`SELECT fl.id, fl.nome, fl.dominio_publico, fl.project_ref,
      CASE WHEN fl.estado = 'ativa' THEN fl.supabase_url END,
      CASE WHEN fl.estado = 'ativa' THEN fl.publishable_key END,
      fl.estado
      FROM public.frota_lojas fl
      WHERE lower(fl.dominio_publico) = lower(p_host)
      AND fl.ativa;`),
  );
  // A v2 nao filtra por estado (ela existe para DIZER o estado) e nunca entrega URL ou chave fora do CASE.
  assert(!/AND fl\.estado/.test(c), "a v2 nao pode esconder a loja fora do ar");
  assertEquals(c.split("fl.supabase_url").length - 1, 1);
  assertEquals(c.split("fl.publishable_key").length - 1, 1);
});

Deno.test("rollback comum: devolve a v1 BYTE A BYTE ao bloco da 20261141, derruba so a v2 e PRESERVA colunas, CHECK e linhas", () => {
  assertStringIncludes(rollback, bloco(caderneta, V1));
  assertEquals(md5(corpo(rollback, V1)), MD5_V1_ANTIGO);
  assertStringIncludes(
    bruto(rollback),
    "DROP FUNCTION IF EXISTS public.resolver_loja_com_estado(text, text);",
  );
  const c = codigo(rollback);
  assert(
    !/\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+CONSTRAINT|DELETE\s+FROM|TRUNCATE|UPDATE\s+public\.|INSERT\s+INTO|CASCADE)\b/i.test(
      c,
    ),
    "o rollback comum apaga dado ou estrutura de dado",
  );
  assert(
    !/\bGRANT\b|\bREVOKE\b/.test(c),
    "o rollback comum nao mexe em ACL (CREATE OR REPLACE preserva)",
  );
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(rollback, `'${MD5_V1_ANTIGO}'`);
  assertStringIncludes(rollback, `'${md5(corpo(migration, V1))}'`);
});

Deno.test("rollback destrutivo: exige a confirmacao escrita E o rollback comum antes, e so entao tira o CHECK e as tres colunas (sem CASCADE)", () => {
  const d = bruto(destrutivo);
  assertStringIncludes(d, "app.confirmo_apagar_estado_de_vida");
  assertStringIncludes(destrutivo, "ESTADO_DE_VIDA_SO_COM_O_DONO");
  assertStringIncludes(destrutivo, "ESTADO_DE_VIDA_ROLLBACK_COMUM_PRIMEIRO");
  assertStringIncludes(
    d,
    "ALTER TABLE public.frota_lojas DROP CONSTRAINT IF EXISTS frota_lojas_estado_check, DROP COLUMN IF EXISTS estado_sha, DROP COLUMN IF EXISTS estado_desde, DROP COLUMN IF EXISTS estado;",
  );
  assert(!/CASCADE/i.test(d), "DROP sem CASCADE");
  assert(
    !/DROP\s+TABLE|DROP\s+FUNCTION/i.test(codigo(destrutivo)),
    "o destrutivo so tira o que a migration criou na tabela",
  );
  const iDrop = destrutivo.indexOf(
    "DROP CONSTRAINT IF EXISTS frota_lojas_estado_check",
  );
  assert(iDrop > 0, "o DROP do CHECK existe");
  assert(destrutivo.indexOf("ESTADO_DE_VIDA_SO_COM_O_DONO") < iDrop);
  assert(destrutivo.indexOf("ESTADO_DE_VIDA_ROLLBACK_COMUM_PRIMEIRO") < iDrop);
  // "rollback comum antes" = a v2 ausente e a v1 com o corpo da 20261141.
  assertStringIncludes(destrutivo, `'${MD5_V1_ANTIGO}'`);
  assertStringIncludes(
    destrutivo,
    "to_regprocedure('public.resolver_loja_com_estado(text, text)')",
  );
});

Deno.test("a v2 entra na lista de portas do visitante (so anon, volatil, SECURITY DEFINER, necessaria) e a v1 continua igual", async () => {
  const lista = JSON.parse(
    await Deno.readTextFile(
      `${RAIZ}/tests/banco/portas-do-visitante-permitidas.json`,
    ),
  ).funcoes;
  const achar = (f) => lista.filter((l) => l.funcao === f);
  for (const f of [
    "public.resolver_loja(p_host text, p_chave text)",
    "public.resolver_loja_com_estado(p_host text, p_chave text)",
  ]) {
    const l = achar(f);
    assertEquals(l.length, 1, f);
    assertEquals(l[0].executa, ["anon"], f);
    assertEquals(l[0].tipo, "volatil", f);
    assertEquals(l[0].secdef, true, f);
    assertEquals(l[0].situacao, "necessaria", f);
  }
});

Deno.test("prova de catalogo: lote de UMA migration em provasDeObjetos (182a depois, 182b antes), consultas no disco, rol fechado e prova viva no rpc-ci", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lotes = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261460000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].versoes, ["20261460000000"]);
  assertEquals(
    lotes[0].consulta,
    "182a-conferir-o-estado-de-vida-da-loja-aplicado",
  );
  assertEquals(
    lotes[0].ausenciaConfirmadaPor,
    "182b-antes-o-estado-de-vida-da-loja-ausente",
  );
  assert(!("backfillLedger" in lotes[0]) && !("nuncaAplicar" in lotes[0]));
  for (const n of [lotes[0].consulta, lotes[0].ausenciaConfirmadaPor])
    await Deno.stat(`${RAIZ}/scripts/publicacao/consultas/${n}.sql`);
  const rpc = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  assertStringIncludes(
    rpc,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/a-loja-tem-estado-de-vida-viva.cjs",
  );
});

Deno.test("rollback destrutivo: com caderneta semeada RECUSA (CADERNETA_SEMEADA) depois das travas dele e antes do ALTER; so apaga com ikcous.apagar_caderneta = 'sim'", () => {
  // Plano caderneta-fora-do-dekxab (26/11/2026), T4: o banco da IKCOUS passa a guardar a caderneta de PRODUÇÃO; o destrutivo
  // rodado lá apagaria o estado de cada loja da frota. A confirmação APAGAR deste arquivo não basta: é preciso a da caderneta.
  const iDono = destrutivo.indexOf("ESTADO_DE_VIDA_SO_COM_O_DONO");
  const iComum = destrutivo.indexOf("ESTADO_DE_VIDA_ROLLBACK_COMUM_PRIMEIRO");
  const ini = destrutivo.indexOf("DO $caderneta_semeada$");
  const fim = destrutivo.indexOf("END $caderneta_semeada$;");
  const iAlter = destrutivo.indexOf("ALTER TABLE public.frota_lojas");
  assert(ini >= 0 && fim > ini, "bloco da caderneta semeada presente");
  assert(
    iDono < ini && iComum < ini,
    "as travas do arquivo vem antes (a mensagem delas nao muda)",
  );
  assert(fim < iAlter, "a trava vem antes do ALTER");
  const bloco = destrutivo.slice(ini, fim);
  assertStringIncludes(
    bloco,
    "IF COALESCE(current_setting('ikcous.apagar_caderneta', true), '') = 'sim' THEN",
  );
  assertStringIncludes(bloco, "RAISE EXCEPTION 'CADERNETA_SEMEADA:");
  assertStringIncludes(
    destrutivo,
    "SET LOCAL ikcous.apagar_caderneta = 'sim';",
  );
});
