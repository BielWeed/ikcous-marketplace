import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// A prova de comportamento usa Postgres efemero (tests/banco/admin-atual-endurecimento-viva.cjs); aqui guardamos o contrato dos arquivos.
/* eslint-disable security/detect-object-injection -- Indices enumeram resultados do proprio extrator; nomes de consultas e migration sao constantes locais, sem entrada externa. */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
const nome =
  "20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql";
const A = "86a-conferir-ex-admin-no-resto-do-painel-aplicado";
const B = "86b-antes-ex-admin-no-resto-do-painel-base-vigente";
const ler = (n: string) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${n}`, import.meta.url),
  ).replace(/\r/g, "");
const lerRaiz = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const RPCS = [
  "get_admin_reviews_paged",
  "get_admin_questions_paged",
  "get_admin_products_paged",
  "get_reviews_metrics",
  "buscar_por_codigo_barras",
  "read_store_identity",
  "assinatura_da_loja_ler",
  "record_vor_action",
  "reorder_banners_atomic",
  "swap_banner_order",
];
const GATE_NOVO: Record<string, [string, string]> = {
  buscar_por_codigo_barras: [
    "IF public.is_admin() IS DISTINCT FROM true THEN",
    "IF public.is_admin_atual() IS DISTINCT FROM true THEN",
  ],
  read_store_identity: [
    "IF public.is_admin() IS DISTINCT FROM true THEN",
    "IF public.is_admin_atual() IS DISTINCT FROM true THEN",
  ],
};
const gate = (f: string): [string, string] =>
  GATE_NOVO[f] ?? [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ];

Deno.test("1381: preflight, rollback e transacao do aplicador", () => {
  const sql = ler(nome);
  const rollback = ler(`rollback-manual-${nome}`);
  assertEquals(
    avaliarFase0({
      sqlMigration: sql,
      sqlRollback: rollback,
      temRollback: true,
    }).recusado,
    false,
  );
  for (const s of [sql, rollback]) {
    assertStringIncludes(s, "B1_BASELINE_DIVERGENT");
    assert(
      !/^\s*(BEGIN|COMMIT|START TRANSACTION)\s*;/im.test(s),
      "sem BEGIN/COMMIT",
    );
    assert(
      !/DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)|TRUNCATE/i.test(s),
      "nenhum DROP de objeto de dado",
    );
    assert(
      !/^(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|COPY)\b/im.test(s),
      "nenhum comando de dado fora de corpo de funcao",
    );
    assert(
      !/^\s*(GRANT|REVOKE)\b/im.test(s),
      "nenhum GRANT/REVOKE: a ACL nao muda",
    );
    assert(
      !/\bALTER\s+(TABLE|FUNCTION)\b/i.test(s),
      "sem ALTER TABLE/FUNCTION: so politicas e CREATE OR REPLACE",
    );
    // o unico DROP e' o da politica NOVA (idempotencia do CREATE POLICY / desfazer no rollback)
    const drops = [...s.matchAll(/^DROP\s+(.*?);/gim)].map((m) => m[1]);
    assertEquals(drops, [
      "POLICY IF EXISTS banners_admin_select_policy ON public.banners",
    ]);
    assertStringIncludes(s, "NOTIFY pgrst, 'reload schema';");
    assertStringIncludes(s, "SET LOCAL lock_timeout");
  }
  assertEquals([...sql.matchAll(/^CREATE POLICY\b/gm)].length, 1);
  assertEquals(
    [...ler(`rollback-manual-${nome}`).matchAll(/^CREATE POLICY\b/gm)].length,
    0,
  );
});

Deno.test("1381: 21 politicas trocam is_admin() por rls_admin_atual() sem mudar comando nem papel; banners separa a leitura publica da do admin", () => {
  const sql = ler(nome);
  const rb = ler(`rollback-manual-${nome}`);
  const alteracoes = (s: string) => [
    ...s.matchAll(/^ALTER POLICY ("[^"]+"|\w+) ON ([\w.]+)\n([\s\S]*?);$/gm),
  ];
  const a = alteracoes(sql);
  const r = alteracoes(rb);
  assertEquals(a.length, 21);
  assertEquals(r.length, 21);
  assertEquals(
    a.map((m) => `${m[1]} ${m[2]}`).sort(),
    r.map((m) => `${m[1]} ${m[2]}`).sort(),
  );
  assertEquals(new Set(a.map((m) => m[2])).size, 10, "10 tabelas");
  for (const m of a) {
    assert(!/\bTO\b/.test(m[3]), "ALTER nao muda o papel da politica");
    assert(!/is_admin\(\)/.test(m[3]), `${m[1]} ainda cita is_admin()`);
    if (m[1] !== "banners_select_policy") {
      assertStringIncludes(m[3], "rls_admin_atual()");
    }
  }
  for (const m of r) {
    if (m[1] !== "banners_select_policy")
      assertStringIncludes(m[3], "( SELECT public.is_admin() AS is_admin)");
    assert(
      !/rls_admin_atual/.test(m[3]),
      `${m[1]}: o rollback nao cita a porta nova`,
    );
  }
  // a policy TO public da vitrine NAO ganha a porta (anon nao executa): o ramo admin sai dela e vira politica propria
  const sel = a.find((m) => m[1] === "banners_select_policy")!;
  assert(!/rls_admin_atual|is_admin|auth\.role/.test(sel[3]));
  assertStringIncludes(sel[3], "(active = true)");
  const selAntes = r.find((m) => m[1] === "banners_select_policy")!;
  assertStringIncludes(selAntes[3], "public.is_admin()");
  assertStringIncludes(
    sql,
    "CREATE POLICY banners_admin_select_policy ON public.banners\n  AS PERMISSIVE FOR SELECT TO authenticated\n  USING (( SELECT public.rls_admin_atual() AS rls_admin_atual));",
  );
  assertStringIncludes(
    rb,
    "DROP POLICY IF EXISTS banners_admin_select_policy ON public.banners;",
  );
});

Deno.test("1381: dez corpos anteriores exatos (iguais aos da ultima migration que os define); so o gate muda; hashes conferidos", () => {
  const sql = ler(nome);
  const rb = ler(`rollback-manual-${nome}`);
  const funcoes = (s: string) =>
    new Map(
      [
        ...s.matchAll(
          /CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)\n ?AS \$function\$([\s\S]*?)\$function\$;/g,
        ),
      ].map((m) => [m[1], { cab: m[2], corpo: m[3] }]),
    );
  const novos = funcoes(sql);
  const velhos = funcoes(rb);
  assertEquals([...novos.keys()].sort(), [...RPCS].sort());
  assertEquals([...velhos.keys()].sort(), [...RPCS].sort());
  // linhas de VALUES do preflight: (assinatura, hash_antes, hash_depois, ...)
  const hashes = new Map<string, [string, string]>();
  for (const m of sql.matchAll(
    /\('public\.(\w+)\([^)]*\)', '([0-9a-f]{32})', '([0-9a-f]{32})'/g,
  )) {
    hashes.set(m[1], [m[2], m[3]]);
  }
  assertEquals([...hashes.keys()].sort(), [...RPCS].sort());
  // a ultima migration (por versao, fora rollback) que define cada funcao
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const arquivos = [...Deno.readDirSync(dir)]
    .filter(
      (e) =>
        e.isFile &&
        e.name.endsWith(".sql") &&
        !e.name.startsWith("rollback") &&
        e.name !== nome,
    )
    .map((e) => e.name)
    .sort();
  const definicao = (arq: string, f: string) => {
    // eslint-disable-next-line security/detect-non-literal-regexp -- `f` vem da lista fixa RPCS deste teste.
    const re = new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION (?:public\\.)?"?${f}"?\\s*\\(([\\s\\S]*?)\\n\\s*AS (\\$[A-Za-z_]*\\$)([\\s\\S]*?)\\2`,
      "g",
    );
    return [...ler(arq).matchAll(re)].map((m) => m[3]);
  };
  for (const f of RPCS) {
    const v = velhos.get(f)!;
    const n = novos.get(f)!;
    assertEquals(n.cab, v.cab, `${f}: mesma assinatura`);
    // o cabecalho (atributos) e' o mesmo; so o gate muda no corpo
    const [velho, novo] = gate(f);
    assertEquals(
      v.corpo.split(velho).length - 1,
      1,
      `${f}: o gate antigo aparece uma vez no rollback`,
    );
    assertEquals(n.corpo, v.corpo.replace(velho, novo), `${f}: so o gate muda`);
    assert(!n.corpo.includes(velho), `${f}: gate antigo some`);
    // o rollback e' o corpo da ULTIMA migration que define a funcao
    let ultimo: string | undefined;
    for (const arq of arquivos) {
      const ds = definicao(arq, f);
      if (ds.length) ultimo = ds[ds.length - 1];
    }
    assert(ultimo !== undefined, `${f}: nenhuma migration a define?`);
    assertEquals(
      v.corpo,
      ultimo,
      `${f}: rollback byte a byte igual ao corpo da ultima migration que a define`,
    );
    const [hAntes, hDepois] = hashes.get(f)!;
    assertEquals(md5(v.corpo), hAntes, `${f}: md5 do corpo anterior`);
    assertEquals(md5(n.corpo), hDepois, `${f}: md5 do corpo novo`);
    assertStringIncludes(
      lerRaiz(`scripts/publicacao/consultas/${B}.sql`),
      hAntes,
    );
    assertStringIncludes(
      lerRaiz(`scripts/publicacao/consultas/${A}.sql`),
      hDepois,
    );
    assert(!lerRaiz(`scripts/publicacao/consultas/${A}.sql`).includes(hAntes));
    assert(!lerRaiz(`scripts/publicacao/consultas/${B}.sql`).includes(hDepois));
  }
});

Deno.test("1381: inventario do aplicador, rol das consultas, canais, workflows e prova viva registrados", () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const mapa = require("../scripts/db-apply.cjs");
  const canais = JSON.parse(lerRaiz("scripts/frota/canais-de-backend.json"));
  assertEquals(
    mapa.VERIFICACOES[nome].map((x: { funcao: string }) => x.funcao),
    RPCS,
  );
  for (const x of mapa.VERIFICACOES[nome] as {
    funcao: string;
    esperado: { texto: string }[];
  }[]) {
    assertEquals(x.esperado[0].texto, gate(x.funcao)[1]);
  }
  for (const consulta of [A, B]) {
    assertEquals(conf.ROL_FECHADO_POR_CONSULTA[consulta].length, 36);
    assertEquals(new Set(conf.ROL_FECHADO_POR_CONSULTA[consulta]).size, 36);
    assertStringIncludes(
      lerRaiz(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}\n`,
    );
    assertEquals(
      lerRaiz(".github/workflows/rpc-ci.yml").split(`consultas/${consulta}.sql`)
        .length - 1,
      2,
      "nas duas listas de paths do rpc-ci",
    );
    assertStringIncludes(
      lerRaiz("scripts/frota/publicar-release.mjs"),
      `"${consulta}"`,
    );
  }
  const entrada = canais.provasDeObjetos.find((x: { versoes: string[] }) =>
    x.versoes.includes("20261381000000"),
  );
  assert(entrada);
  assertEquals(entrada.consulta, A);
  assertEquals(entrada.ausenciaConfirmadaPor, B);
  assertEquals(entrada.conferenciasAntesDoApply, ["8b-papeis-contraditorios"]);
  assertStringIncludes(
    lerRaiz(".github/workflows/rpc-ci.yml"),
    "run: node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-endurecimento-viva.cjs",
  );
  assertStringIncludes(
    lerRaiz("tests/banco/LEIA-ME.md"),
    "admin-atual-endurecimento-viva.cjs",
  );
  // as provas antigas que desfazem a 97 desfazem esta antes
  for (const arq of [
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/pagamentos-rpc-viva.cjs",
  ]) {
    const t = lerRaiz(arq);
    // As posteriores entram na ordem da aplicacao; a 20261383 (DEFINIR_CARGO) vem depois desta e fecha a lista.
    const marcaResto = "EX_ADMIN_RESTO_DO_PAINEL,\n";
    const iFim = t.indexOf("DEFINIR_CARGO,\n];");
    const iResto = iFim >= 0 ? t.lastIndexOf(marcaResto, iFim) : -1;
    // Entre as duas marcas so pode haver linha em branco ou comentario.
    const entre =
      iResto >= 0 && iFim > iResto
        ? t.slice(iResto + marcaResto.length, iFim)
        : "x";
    assert(
      entre
        .split("\n")
        .every((l: string) => l.trim() === "" || l.trim().startsWith("//")),
      `${arq}: EX_ADMIN_RESTO_DO_PAINEL seguido so de DEFINIR_CARGO no fim da lista`,
    );
    assertStringIncludes(
      t,
      'require("./ex-admin-resto-do-painel-posterior.cjs")',
    );
  }
});

Deno.test("1381: a lista das 21 politicas e das 10 tabelas e' a mesma da migration, da consulta 86a e da prova viva", () => {
  const sql = ler(nome);
  const viva = lerRaiz("tests/banco/admin-atual-endurecimento-viva.cjs");
  const consulta = lerRaiz(`scripts/publicacao/consultas/${A}.sql`);
  const nomes = [...sql.matchAll(/^ALTER POLICY ("[^"]+"|\w+) ON /gm)].map(
    (m) => m[1].replace(/"/g, ""),
  );
  assertEquals(nomes.length, 21);
  for (const n of nomes) {
    assertStringIncludes(viva, n.includes(" ") ? `"${n}"` : n);
    assertStringIncludes(consulta, n);
  }
  for (const t of [
    "_ninja_migrations",
    "app_settings",
    "assinatura_da_loja",
    "banners",
    "categorias",
    "marketplace_ai_state",
    "shipping_calculation_logs",
    "shipping_quotes_cache",
    "store_config",
    "vor_receipts",
  ]) {
    assertStringIncludes(consulta, `public.${t}`);
    assertStringIncludes(sql, `public.${t}`);
  }
});
