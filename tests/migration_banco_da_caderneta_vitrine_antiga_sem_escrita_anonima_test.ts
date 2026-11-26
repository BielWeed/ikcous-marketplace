// @ts-nocheck
// O BANCO DA CADERNETA FECHA A ESCRITA ANÔNIMA NA VITRINE ANTIGA — prova offline dos três scripts de
// scripts/frota/banco-da-caderneta/ (aplicar, conferir, rollback) e da seção do runbook (26/11/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: no projeto antigo (dekxab), que hoje hospeda a caderneta central da frota, a view
// public.vw_produtos_public (sem security_invoker: roda como o dono, isenta do RLS; auto-atualizável) ficou com a ACL
// {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
// (medida em 26/11): qualquer um com a chave pública escreve e apaga produto por ela. Nas lojas atuais isso foi fechado
// pela 20260821000100 (INSERT/UPDATE/DELETE) e pela 20261090000000 (TRUNCATE/TRIGGER/MAINTAIN); o dekxab não recebe
// migrations dos canais e ficou para trás. Os scripts deste lote levam o dekxab ao MESMO estado das lojas.
//
// Não é migration e nada aqui roda em banco: o teste lê os arquivos e confere a forma. A ACL NÃO separa o dekxab das
// lojas (a "já aplicada" é idêntica à delas); quem separa é a primeira trava dos dois pré-voos: o banco tem de ter a
// caderneta SEMEADA (frota_lojas e frota_segredo com linha). As tabelas sozinhas não bastam: a 20261141 e as da
// caderneta também vão ao banco de cada loja, mas lá nascem e ficam vazias. A prova no banco é o pré-voo e o pós-voo
// do próprio script, aplicado pela sessão.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const {
  contarStatements,
} = require("../scripts/publicacao/conferir-banco.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const LER = (p) => Deno.readTextFileSync(`${RAIZ}/${p}`).replace(/\r/g, "");
const PASTA = "scripts/frota/banco-da-caderneta";
const aplicar = LER(`${PASTA}/vitrine-antiga-sem-escrita-anonima.sql`);
const conferir = LER(
  `${PASTA}/vitrine-antiga-sem-escrita-anonima-conferir.sql`,
);
const rollback = LER(
  `${PASTA}/rollback-manual-vitrine-antiga-sem-escrita-anonima.sql`,
);
const runbook = LER("docs/runbooks/estado-de-vida-da-loja.md");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const codigo = (s) => norm(removerRuido(s));
const semComentarios = (s) => s.replace(/--.*$/gm, "");

/** A ACL medida no dekxab em 26/11/2026 — o estado que o pré-voo exige e que o rollback reproduz. */
const ANTES =
  "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}";
/** Letras de privilégio de tabela do PG 17 (aclitem), na ordem em que o Postgres as imprime. */
const LETRA = new Map([
  ["INSERT", "a"],
  ["SELECT", "r"],
  ["UPDATE", "w"],
  ["DELETE", "d"],
  ["TRUNCATE", "D"],
  ["REFERENCES", "x"],
  ["TRIGGER", "t"],
  ["MAINTAIN", "m"],
]);
const ORDEM = "arwdDxtm";

// Um comando por pedaço (split em ";") e espaço já normalizado: a regex não precisa de \s+ nem de grupo
// opcional com quantificador dentro (sem retrocesso explosivo).
const RE_REVOKE =
  /\bREVOKE ([A-Z, ]+?) ON (TABLE )?public\.vw_produtos_public FROM ([a-z_, ]+)$/;
const RE_GRANT =
  /\bGRANT ([A-Z, ]+?) ON (TABLE )?public\.vw_produtos_public TO ([a-z_, ]+)$/;

/** Lista de privilégios de um GRANT/REVOKE em public.vw_produtos_public, ordenada. */
function privilegiosDe(sql, verbo) {
  const re = verbo === "REVOKE" ? RE_REVOKE : RE_GRANT;
  const lista = (s) =>
    s
      .split(",")
      .map((p) => p.trim())
      .sort();
  return semComentarios(sql)
    .split(";")
    .map((pedaco) => norm(pedaco).match(re))
    .filter(Boolean)
    .map((m) => ({ privs: lista(m[1]), papeis: lista(m[3]) }));
}

/** A ACL que sobra depois de tirar `privs` de anon e authenticated, mantendo a ordem das entradas (o Postgres atualiza no lugar). */
function aclSem(acl, privs) {
  const tirar = new Set(privs.map((p) => LETRA.get(p)));
  return acl.replace(
    /(anon|authenticated)=([a-zA-Z]+)\//g,
    (_, papel, letras) =>
      `${papel}=${[...ORDEM].filter((l) => letras.includes(l) && !tirar.has(l)).join("")}/`,
  );
}

const [REV] = privilegiosDe(aplicar, "REVOKE");
const DEPOIS = aclSem(ANTES, REV?.privs ?? []);

Deno.test("aplicar: UMA escrita so, o REVOKE em public.vw_produtos_public de anon e authenticated, entre pre-voo e pos-voo", () => {
  const revokes = privilegiosDe(aplicar, "REVOKE");
  assertEquals(revokes.length, 1, "um REVOKE so");
  assertEquals(revokes[0].papeis, ["anon", "authenticated"]);
  const stmt = `REVOKE ${["INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "MAINTAIN"].join(", ")} ON public.vw_produtos_public FROM anon, authenticated;`;
  assertEquals(
    codigo(aplicar),
    norm(
      `SET LOCAL lock_timeout = ''; SET LOCAL statement_timeout = ''; DO ; ${stmt} DO ; NOTIFY pgrst, '';`,
    ),
  );
  const c = codigo(aplicar);
  assert(!/\bGRANT\b/.test(c), "nenhum GRANT");
  assert(!/CASCADE/i.test(c), "sem CASCADE");
  assert(
    !/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|DROP\s+|ALTER\s+|CREATE\s+)/i.test(
      c,
    ),
    "o script escreve dado ou mexe em objeto",
  );
});

Deno.test("o recorte e' o mesmo que as lojas receberam na view: 20260821000100 + 20261090000000 (SELECT e REFERENCES ficam)", () => {
  const lojas = new Set();
  for (const n of [
    "20260821000100_revoke_escrita_anonima_vw_produtos_public.sql",
    "20261090000000_anon_nao_nasce_com_poder_de_escrever_em_produtos.sql",
  ]) {
    for (const r of privilegiosDe(LER(`supabase/migrations/${n}`), "REVOKE")) {
      for (const p of r.privs) lojas.add(p);
    }
  }
  assertEquals(REV.privs, [...lojas].sort());
  assert(!REV.privs.includes("SELECT"), "a vitrine antiga continua lendo");
  assert(!REV.privs.includes("REFERENCES"), "REFERENCES fica, como nas lojas");
  assertEquals(
    DEPOIS,
    "{postgres=arwdDxtm/postgres,anon=rx/postgres,authenticated=rx/postgres,service_role=arwdDxtm/postgres}",
  );
});

Deno.test("nenhum dos tres scripts abre ou fecha transacao (quem aplica abre)", () => {
  for (const [nome, sql] of [
    ["aplicar", aplicar],
    ["conferir", conferir],
    ["rollback", rollback],
  ]) {
    assertEquals(
      detectarTransacaoExplicita(removerRuido(sql)).achados,
      [],
      `${nome} contem controle de transacao`,
    );
  }
  for (const sql of [aplicar, rollback]) {
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
  }
});

Deno.test("pre-voo: primeiro comando depois dos SET LOCAL, so le catalogo e RECUSA fora da ACL medida (ou da ja aplicada)", () => {
  const iPre = aplicar.indexOf("DO $preflight_vitrine_antiga$");
  // O comando no inicio da linha (o cabecalho cita o REVOKE em comentario).
  const iRevoke = aplicar.indexOf("\nREVOKE INSERT");
  const iPos = aplicar.indexOf("DO $posvoo_vitrine_antiga$");
  assert(
    iPre > 0 && iRevoke > iPre && iPos > iRevoke,
    "pre-voo -> REVOKE -> pos-voo",
  );
  assertEquals(
    codigo(aplicar.slice(0, iPre))
      .replace(/SET LOCAL [^;]+;/g, "")
      .trim(),
    "",
    "nada alem de SET LOCAL antes do pre-voo",
  );
  const pre = semComentarios(aplicar.slice(iPre, iRevoke));
  assertStringIncludes(pre, "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT");
  // A ACL literal medida, comparada como texto (byte a byte), e a do estado ja aplicado (reaplicar e' no-op).
  assertStringIncludes(pre, `'${ANTES}'`);
  assertStringIncludes(pre, `'${DEPOIS}'`);
  assertStringIncludes(pre, "relacl::text");
  // View de verdade, do postgres, sem privilegio de coluna (o REVOKE de tabela levaria grant de coluna junto e o rollback nao devolveria).
  assertStringIncludes(pre, "relkind");
  assertStringIncludes(pre, "attacl");
  assertStringIncludes(pre, "pg_get_userbyid(c.relowner)");
  // Quem aplica concede em nome do dono (senao o REVOKE vira aviso e no-op, e o GRANT do rollback sairia com outro concedente).
  assertStringIncludes(pre, "pg_has_role(current_user");
  // So catalogo: nenhuma linha de produto lida.
  assert(
    !/\bFROM\s+public\.(vw_produtos_public|produtos)\b/i.test(pre),
    "o pre-voo le linha",
  );
});

Deno.test("pos-voo: recusa se a ACL nao ficou EXATAMENTE a esperada e se anon/authenticated ainda alcancam escrita ou perderam a leitura", () => {
  const pos = semComentarios(
    aplicar.slice(aplicar.indexOf("DO $posvoo_vitrine_antiga$")),
  );
  assertStringIncludes(pos, "POSVOO_VITRINE_ANTIGA");
  assertStringIncludes(pos, `'${DEPOIS}'`);
  for (const papel of ["anon", "authenticated"]) {
    assertStringIncludes(
      pos,
      `has_table_privilege('${papel}', v_view, 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN')`,
    );
    assertStringIncludes(
      pos,
      `has_any_column_privilege('${papel}', v_view, 'INSERT, UPDATE')`,
    );
    assertStringIncludes(
      pos,
      `has_table_privilege('${papel}', v_view, 'SELECT')`,
    );
  }
  assertStringIncludes(aplicar, "NOTIFY pgrst, 'reload schema';");
});

/** O pedaço do pré-voo (do DO até o comando de escrita, no início da linha). */
function preVoo(sql, marcaDo, marcaEscrita) {
  const i = sql.indexOf(marcaDo);
  const j = sql.indexOf(marcaEscrita);
  assert(i > 0 && j > i, `pre-voo ${marcaDo} antes de ${marcaEscrita.trim()}`);
  return semComentarios(sql.slice(i, j));
}
const PRE_APLICAR = ["DO $preflight_vitrine_antiga$", "\nREVOKE INSERT"];
const PRE_ROLLBACK = [
  "DO $preflight_rollback_vitrine_antiga$",
  "\nGRANT INSERT",
];
const TRAVA_TABELAS =
  "IF to_regclass('public.frota_lojas') IS NULL OR to_regclass('public.frota_segredo') IS NULL THEN";
const TRAVA_SEMEADA =
  "IF NOT EXISTS (SELECT 1 FROM public.frota_segredo) OR NOT EXISTS (SELECT 1 FROM public.frota_lojas) THEN";

Deno.test("pre-voo (aplicar E rollback): ANTES de tudo confere que o banco e' o da caderneta semeada, nao uma loja atual", () => {
  for (const [nome, sql, marcas] of [
    ["aplicar", aplicar, PRE_APLICAR],
    ["rollback", rollback, PRE_ROLLBACK],
  ]) {
    const pre = preVoo(sql, ...marcas);
    const corpo = pre.slice(pre.indexOf("\nBEGIN") + "\nBEGIN".length);
    // 1a trava: a primeira coisa do corpo, com a primeira recusa do pré-voo.
    assertEquals(
      corpo.indexOf("IF "),
      corpo.indexOf(TRAVA_TABELAS),
      `${nome}: a trava das tabelas da caderneta e' o primeiro IF`,
    );
    assertEquals(
      corpo.indexOf("RAISE EXCEPTION"),
      corpo.indexOf(
        "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: este banco não é o da caderneta (sem public.frota_lojas/frota_segredo)",
      ),
      `${nome}: a primeira recusa e' a do banco errado`,
    );
    // 2a trava: as tabelas existem em toda loja (a 20261141 vai a cada canal); só a caderneta de produção tem linha.
    const iSemeada = corpo.indexOf(TRAVA_SEMEADA);
    assert(
      iSemeada > corpo.indexOf(TRAVA_TABELAS),
      `${nome}: caderneta semeada, depois de saber que as tabelas existem`,
    );
    const iSegundoIf = corpo.indexOf("IF ", corpo.indexOf(TRAVA_TABELAS) + 3);
    assertEquals(
      iSemeada,
      iSegundoIf,
      `${nome}: a caderneta semeada e' o segundo IF`,
    );
    assertStringIncludes(
      corpo.slice(iSemeada),
      "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a caderneta deste banco está vazia",
    );
  }
});

Deno.test("so a view alvo: nenhum outro objeto citado no codigo dos tres scripts (nada de outras views, TRUNCATE geral nem net)", () => {
  // A caderneta só aparece no pré-voo (a trava do banco certo): fora dele, a view é o único objeto.
  for (const [nome, sql, marcas] of [
    ["aplicar", aplicar, PRE_APLICAR],
    ["rollback", rollback, PRE_ROLLBACK],
  ]) {
    const cadernetaNoPre = new Set(
      [...preVoo(sql, ...marcas).matchAll(/\bpublic\.(frota_[a-z_]+)/g)].map(
        (m) => m[1],
      ),
    );
    assertEquals(
      [...cadernetaNoPre].sort(),
      ["frota_lojas", "frota_segredo"],
      `${nome}: caderneta citada no pre-voo`,
    );
  }
  const semPreVoo = (sql, [marcaDo, marcaEscrita]) =>
    sql.slice(0, sql.indexOf(marcaDo)) + sql.slice(sql.indexOf(marcaEscrita));
  for (const [nome, sql] of [
    ["aplicar", semPreVoo(aplicar, PRE_APLICAR)],
    ["conferir", conferir],
    ["rollback", semPreVoo(rollback, PRE_ROLLBACK)],
  ]) {
    const cod = semComentarios(sql);
    const objetos = new Set(
      [...cod.matchAll(/\bpublic\.([a-z_]+)/g)].map((m) => m[1]),
    );
    assertEquals(
      [...objetos],
      ["vw_produtos_public"],
      `${nome}: objetos citados`,
    );
    assert(
      !/\bnet\.|vw_produtos_admin|security_invoker\s*=/i.test(cod),
      `${nome}: mexe em outra coisa`,
    );
  }
});

Deno.test("rollback: pre-voo, UM GRANT simetrico ao REVOKE (mesmos privilegios, mesma view, mesmos papeis, sem GRANT OPTION) e pos-voo com a ACL medida", () => {
  const grants = privilegiosDe(rollback, "GRANT");
  assertEquals(grants.length, 1, "um GRANT so");
  assertEquals(
    grants[0].privs,
    REV.privs,
    "GRANT devolve exatamente o que o REVOKE tirou",
  );
  assertEquals(grants[0].papeis, REV.papeis);
  const stmt = `GRANT ${["INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "MAINTAIN"].join(", ")} ON public.vw_produtos_public TO anon, authenticated;`;
  assertEquals(
    codigo(rollback),
    norm(
      `SET LOCAL lock_timeout = ''; SET LOCAL statement_timeout = ''; DO ; ${stmt} DO ; NOTIFY pgrst, '';`,
    ),
  );
  const c = codigo(rollback);
  assert(!/GRANT\s+OPTION/i.test(c), "sem GRANT OPTION");
  assert(
    !/\b(REVOKE|DROP|DELETE\s+FROM|TRUNCATE\s+public|INSERT\s+INTO|CASCADE)\b/i.test(
      c,
    ),
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_vitrine_antiga$");
  const iGrant = rollback.indexOf("\nGRANT INSERT");
  const iPos = rollback.indexOf("DO $posvoo_rollback_vitrine_antiga$");
  assert(
    iPre > 0 && iGrant > iPre && iPos > iGrant,
    "pre-voo -> GRANT -> pos-voo",
  );
  const pre = semComentarios(rollback.slice(iPre, iGrant));
  assertStringIncludes(pre, "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT");
  assertStringIncludes(pre, `'${DEPOIS}'`);
  assertStringIncludes(pre, `'${ANTES}'`);
  assertStringIncludes(pre, "pg_has_role(current_user");
  const pos = semComentarios(rollback.slice(iPos));
  assertStringIncludes(pos, "POSVOO_ROLLBACK_VITRINE_ANTIGA");
  assertStringIncludes(pos, `IS DISTINCT FROM '${ANTES}'`);
});

Deno.test("conferir: UM statement, so leitura, so catalogo, confere a ACL de depois como texto", () => {
  assertEquals(contarStatements(conferir), 1);
  const cod = semComentarios(conferir).replace(/'[^']*'/g, "''");
  assert(
    !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|NOTIFY|DO)\b/.test(
      cod,
    ),
    "so leitura",
  );
  assert(
    !/\bFROM\s+(public\.)?(vw_produtos_public|produtos)\b/i.test(cod),
    "nao le linha",
  );
  assertStringIncludes(conferir, `'${DEPOIS}'`);
  assertStringIncludes(conferir, "relacl::text");
  const rotulos = [...conferir.matchAll(/SELECT '([^']+)',\s/g)].map(
    (m) => m[1],
  );
  assertEquals(new Set(rotulos).size, rotulos.length, "rotulo repetido");
  assertEquals(rotulos.length, 5, "rol fechado de 5 itens");
});

Deno.test("runbook: secao do banco da caderneta com a ordem (conferir antes, aplicar, conferir depois), execute_sql numa transacao e o rollback", () => {
  const i = runbook.indexOf(
    "## O banco da caderneta: a vitrine antiga sem escrita anônima",
  );
  assert(i > 0, "secao ausente");
  const sec = runbook.slice(i, runbook.indexOf("\n## ", i + 1));
  for (const arq of [
    `${PASTA}/vitrine-antiga-sem-escrita-anonima.sql`,
    `${PASTA}/vitrine-antiga-sem-escrita-anonima-conferir.sql`,
    `${PASTA}/rollback-manual-vitrine-antiga-sem-escrita-anonima.sql`,
  ]) {
    assertStringIncludes(sec, arq);
  }
  assertStringIncludes(sec, "execute_sql");
  assertStringIncludes(sec, "apply_migration");
  assertStringIncludes(sec, "begin;");
  assertStringIncludes(sec, "commit;");
  assertStringIncludes(sec, "dekxabvqdsuukijblazl");
});
