import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// A prova de comportamento usa Postgres efemero; aqui guardamos o contrato dos arquivos.
/* eslint-disable security/detect-object-injection -- Indices enumeram resultados do proprio extrator; nomes de consultas e migration sao constantes locais, sem entrada externa. */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
const nome =
  "20261360000000_ex_admin_perde_o_acesso_na_hora_nas_demais_tabelas.sql";
const ler = (n: string) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${n}`, import.meta.url),
  ).replace(/\r/g, "");
Deno.test("1360: preflight, rollback e transacao do aplicador", () => {
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
  assertStringIncludes(sql, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(sql, "rls_admin_atual()");
  assertStringIncludes(sql, "is_admin_atual()");
  assert(!/DROP\s+(TABLE|COLUMN)|TRUNCATE/i.test(sql));
});
const fontes = [
  "20261240000000_a_cliente_e_avisada_quando_a_loja_responde_sua_pergunta.sql",
  "20261065000000_a_sobrecarga_que_o_app_usa_tambem_nasce_honesta.sql",
  "20261064000000_o_log_de_push_nasce_honesto.sql",
];
const funcoes = (sql: string) => [
  ...sql.matchAll(
    /CREATE OR REPLACE FUNCTION public\.(answer_question_atomic|reply_review_atomic)\(([^)]*)\)[\s\S]*?\$function\$([\s\S]*?)\$function\$;/g,
  ),
];
Deno.test("1360: quatro corpos anteriores exatos; somente a guarda muda; hashes conferidos", () => {
  const novos = funcoes(ler(nome));
  const velhos = funcoes(ler(`rollback-manual-${nome}`));
  assertEquals(novos.length, 4);
  assertEquals(velhos.length, 4);
  const anteriores = fontes.flatMap((f) => funcoes(ler(f)));
  for (let i = 0; i < 4; i++) {
    const n = novos[i];
    const v = velhos[i];
    assertEquals(n[1], v[1]);
    assertEquals(n[2], v[2]);
    const fonte = anteriores.find((a) => a[1] === v[1] && a[2] === v[2]);
    assert(fonte);
    assertEquals(v[3], fonte[3], "rollback byte a byte");
    assertEquals(
      n[3],
      v[3]
        .replace(
          "IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN",
          "IF NOT public.is_admin_atual() THEN",
        )
        .replace(
          "IF NOT public.is_admin() THEN",
          "IF NOT public.is_admin_atual() THEN",
        ),
    );
    const hash = (s: string) => createHash("md5").update(s).digest("hex");
    for (const corpo of [v[3], n[3]]) {
      assertStringIncludes(ler(nome), hash(corpo));
    }
    if (n[1] === "answer_question_atomic") {
      const query41 = Deno.readTextFileSync(
        new URL(
          "../scripts/publicacao/consultas/41a-conferir-pergunta-respondida-avisa-a-cliente-aplicado.sql",
          import.meta.url,
        ),
      );
      assertStringIncludes(
        query41,
        `WHEN '${hash(n[3])}' THEN '${hash(v[3])}'`,
      );
    }
  }
});
Deno.test("1360: mesmas 28 politicas; somente leitura direta de produtos restringe papel; grants identicos", () => {
  const sql = ler(nome);
  const rb = ler(`rollback-manual-${nome}`);
  const alteracoes = (s: string) => [
    ...s.matchAll(/^ALTER POLICY ("[^"]+") ON ([\w.]+)[\s\S]*?;/gm),
  ];
  const a = alteracoes(sql);
  const r = alteracoes(rb);
  assertEquals(a.length, 28);
  assertEquals(r.length, 28);
  assertEquals(
    a.map((m) => `${m[1]} ${m[2]}`),
    r.map((m) => `${m[1]} ${m[2]}`),
  );
  for (const m of a) {
    assertStringIncludes(m[0], "rls_admin_atual()");
    if (m[1] === '"produtos_select_policy"') {
      assertStringIncludes(m[0], "TO authenticated");
    } else assert(!/\bTO\b/.test(m[0]));
  }
  for (const m of r) assertStringIncludes(m[0], "is_admin()");
  for (const s of [sql, rb]) {
    assert(!/^\s*(GRANT|REVOKE|DROP|CREATE POLICY)\b/m.test(s));
  }
  assertStringIncludes(sql, "WHERE public.rls_admin_atual()");
  assertStringIncludes(rb, "WHERE public.is_admin()");
  assertStringIncludes(sql, "WITH CASCADED CHECK OPTION");
});
Deno.test("1360: inventario do aplicador e rol das consultas a/b registrados", () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const mapa = require("../scripts/db-apply.cjs");
  const canais = JSON.parse(
    Deno.readTextFileSync(
      new URL("../scripts/frota/canais-de-backend.json", import.meta.url),
    ),
  );
  assertEquals(
    mapa.VERIFICACOES[nome].map((x: { funcao: string }) => x.funcao),
    ["answer_question_atomic", "reply_review_atomic"],
  );
  for (const consulta of [
    "82a-conferir-ex-admin-sem-acesso-nas-demais-tabelas",
    "82b-antes-ex-admin-nas-demais-tabelas",
  ]) {
    assertEquals(conf.ROL_FECHADO_POR_CONSULTA[consulta].length, 36);
    assertEquals(new Set(conf.ROL_FECHADO_POR_CONSULTA[consulta]).size, 36);
  }
  assert(
    canais.provasDeObjetos.some((x: { versoes: string[] }) =>
      x.versoes.includes("20261360000000"),
    ),
  );
});
