import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261382000000_o_resultado_mostra_tarifa_juro_e_quebra_como_despesa.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const definicao = (sql: string) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.fin_dre\([\s\S]*?\n\$\$;/,
  )?.[0] ?? "";
const corpo = (sql: string) =>
  definicao(sql).split("AS $$")[1]?.slice(0, -3) ?? "";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// A UNICA edicao desta migration sobre o corpo da 20261242000000 (a ultima que redefine fin_dre).
const ANTES = `    (SELECT COALESCE(jsonb_agg(jsonb_build_object('grupo', g.grupo_dre, 'categoria', g.nome, 'valor', g.total)
                               ORDER BY g.ordem, g.total DESC), '[]'::jsonb)
       FROM (SELECT grupo_dre, nome, sum(valor) AS total,
                    CASE grupo_dre WHEN 'receita' THEN 1`;
const DEPOIS_SEM_COMENTARIO = `    (SELECT COALESCE(jsonb_agg(jsonb_build_object('grupo', g.grupo_dre, 'categoria', g.nome, 'valor', g.valor_dre)
                               ORDER BY g.ordem, g.total DESC), '[]'::jsonb)
       FROM (SELECT grupo_dre, nome, sum(valor) AS total,
                    CASE WHEN grupo_dre = 'financeiro'
                         THEN sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END)
                         ELSE sum(valor) END AS valor_dre,
                    CASE grupo_dre WHEN 'receita' THEN 1`;

const anterior = ler(
  "supabase/migrations/20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const H_ANTES = "afc3e13805ce37819cfdcd094043087c";

Deno.test("382: o corpo anterior e' o da 242 e esta migration muda UMA agregacao, mais um comentario", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  // Tira so os comentarios que a 382 acrescentou e desfaz a unica edicao: sobra a 242, byte a byte.
  const semComentarioNovo = definicao(sql).replace(
    / {4}-- As categorias do grupo 'financeiro'[\s\S]*?como antes\.\n/,
    "",
  );
  assert.equal(
    semComentarioNovo.replace(DEPOIS_SEM_COMENTARIO, ANTES),
    definicao(anterior),
  );
  assert.equal(definicao(rb), definicao(anterior));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  // A conta do total e' a mesma do detalhe: entrada menos saida.
  assert.ok(
    corpo(sql).includes(
      "SELECT COALESCE(sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0)",
    ),
  );
  assert.ok(
    corpo(sql).includes(
      "THEN sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END)",
    ),
  );
});

Deno.test("382: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado", () => {
  for (const texto of [sql, rb]) {
    assert.ok(texto.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
    assert.equal(
      require("../scripts/db-prove-rollback.cjs").avaliarFase0({
        sqlMigration: texto,
        sqlRollback: rb,
        temRollback: true,
      }).recusado,
      false,
    );
    const externo = texto
      .replace(definicao(texto), "")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      externo,
      /\b(?:BEGIN;|COMMIT|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(
      texto.includes(
        "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.dre382_atributos')::jsonb",
      ),
    );
    assert.ok(texto.includes(H_ANTES));
    assert.ok(texto.includes(md5(corpo(sql))));
    // Os atributos do desenho de sempre: STABLE, SECURITY DEFINER, search_path, uma assinatura so.
    assert.ok(texto.includes("p.provolatile = 's'"));
    assert.ok(
      texto.includes(
        "p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]",
      ),
    );
    assert.ok(texto.includes("q.proname = 'fin_dre') = 1"));
    assert.ok(
      texto.includes("NOT has_function_privilege('anon', p.oid, 'EXECUTE')"),
    );
  }
  assert.ok(sql.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  assert.ok(!definicao(sql).includes("\r"));
  // O cabecalho da funcao e' o mesmo da 242 (STABLE SECURITY DEFINER, search_path).
  assert.equal(
    definicao(sql).split("AS $$")[0],
    definicao(anterior).split("AS $$")[0],
  );
});

Deno.test("382: a vigente e' a ultima redefinicao de fin_dre da arvore; db-apply exige as guardas; a lista das sucessoras da 99 fecha", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine fin_dre depois da 382",
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[nome];
  assert.equal(checagem?.funcao, "fin_dre");
  assert.equal(avaliarChecagem(corpo(sql), checagem).situacao, "verificada");
  for (const marcador of checagem.esperado) {
    assert.equal(
      avaliarChecagem(corpo(sql).replace(marcador, ""), checagem).situacao,
      "falhou",
    );
  }
  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  const registro = SUCESSORAS_DA_99.find(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.equal(registro.assinatura, "public.fin_dre(date,date)");
  assert.equal(registro.hashVigente, md5(corpo(anterior)));
  assert.equal(registro.hashDesta, md5(corpo(sql)));
});

Deno.test("382: a 8e e a 45a aceitam os dois corpos EXATOS de fin_dre; as consultas 87a/87b sao so de catalogo, quatro linhas fechadas, e estao registradas", async () => {
  const hNovo = md5(corpo(sql));
  assert.ok(
    ler(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
    ).includes(`('fin_dre', '${hNovo}', '20261382000000')`),
  );
  assert.ok(
    ler(
      "scripts/publicacao/consultas/45a-conferir-custo-do-dia-aplicado.sql",
    ).includes(`f.m IN ('${H_ANTES}', '${hNovo}')`),
  );
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas = [
    [
      "87a-conferir-resultado-mostra-tarifa-juro-e-quebra-como-despesa-aplicado",
      hNovo,
    ],
    [
      "87b-antes-resultado-mostra-tarifa-juro-e-quebra-como-despesa-base-vigente",
      H_ANTES,
    ],
  ];
  for (const [nomeConsulta, hash] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(hash));
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:fin_|marketplace_)|public\.fin_dre\(\s*[^d)]/,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 4);
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(nomeConsulta));
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1), rol), null);
    assert.notEqual(estruturaDoRolFechado([...linhas, linhas[0]], rol), null);
    assert.equal(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${nomeConsulta}.sql"`,
      ).length - 1,
      2,
    );
    assert.ok(
      ler(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nomeConsulta}\n`,
      ),
    );
  }
  const entrada = JSON.parse(
    ler("scripts/frota/canais-de-backend.json"),
  ).provasDeObjetos.find((p: { versoes: string[] }) =>
    p.versoes.includes("20261382000000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/fin-dre-sinal-viva.cjs",
    ),
  );
});
