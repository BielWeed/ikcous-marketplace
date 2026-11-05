import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261399600000_o_resultado_credita_o_custo_da_devolucao_de_outro_mes.sql";
const nome382 =
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

const anterior = ler(`supabase/migrations/${nome382}`);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const H_ANTES = "2d191bc8120a9b188c04eeaaa0263110";
const H_NOVO = "eafc6a2c4663e33f5459791c6601b848";

// As DUAS edicoes desta migration sobre o corpo da 20261382000000 (a ultima que redefine fin_dre antes dela).
const PISO_ANTES = "  v_cmv := GREATEST(v_cmv - v_cmv_volta, 0);\n";
const CONTA_NOVA = "  v_cmv := v_cmv - v_cmv_volta;\n";
const FILTRO_ANTES = "          WHERE v_cmv > 0\n";
const FILTRO_NOVO = "          WHERE v_cmv <> 0\n";

Deno.test("3996: o corpo anterior e' o da 382 e esta migration muda DUAS linhas, mais um comentario", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  assert.equal(md5(corpo(sql)), H_NOVO);
  // Tira so o comentario que a 3996 acrescentou e desfaz as duas edicoes: sobra a 382, byte a byte.
  const semComentarioNovo = definicao(sql).replace(
    / {2}-- CMV do periodo = custo das vendas MENOS[\s\S]*?\(src\/lib\/financeiro\.ts\)\.\n/,
    "",
  );
  assert.notEqual(semComentarioNovo, definicao(sql), "o comentario sumiu");
  assert.equal(
    semComentarioNovo
      .replace(CONTA_NOVA, PISO_ANTES)
      .replace(FILTRO_NOVO, FILTRO_ANTES),
    definicao(anterior),
  );
  assert.equal(definicao(rb), definicao(anterior));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  // A conta nova NAO tem piso: a unica atribuicao de v_cmv depois da leitura e a subtracao simples.
  const atribuicoes = corpo(sql)
    .split("\n")
    .filter((l) => /^\s*v_cmv :=/.test(l));
  assert.deepEqual(atribuicoes, ["  v_cmv := v_cmv - v_cmv_volta;"]);
  assert.doesNotMatch(
    corpo(sql).replace(/--[^\n]*/g, ""),
    /GREATEST\s*\(\s*v_cmv/i,
  );
  // O filtro da linha do CMV deixa o credito passar e continua escondendo o zero.
  assert.ok(corpo(sql).includes(FILTRO_NOVO));
  assert.ok(!corpo(sql).includes(FILTRO_ANTES));
  // O resto da conta do resultado nao muda (o lucro bruto continua receita liquida menos CMV, com o sinal do CMV).
  assert.ok(corpo(sql).includes("v_lucro_bruto := v_liquida - v_cmv;"));
});

Deno.test("3996: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado", () => {
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
        "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.dre3996_atributos')::jsonb",
      ),
    );
    assert.ok(texto.includes(H_ANTES));
    assert.ok(texto.includes(H_NOVO));
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
  // A migration so aceita o corpo da 382 ou o dela (reaplicar e' inofensivo); o rollback so aceita o dela.
  assert.ok(
    sql.includes(`('public.fin_dre(date,date)', '${H_ANTES}', '${H_NOVO}')`),
  );
  assert.ok(
    rb.includes(`('public.fin_dre(date,date)', '${H_ANTES}', '${H_NOVO}')`),
  );
  assert.ok(sql.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  // O pos-voo da migration confere o corpo NOVO; o do rollback, o da 382.
  assert.ok(sql.includes(`md5(replace(p.prosrc, E'\\r', '')) = '${H_NOVO}'`));
  assert.ok(rb.includes(`md5(replace(p.prosrc, E'\\r', '')) = '${H_ANTES}'`));
  assert.ok(!definicao(sql).includes("\r"));
  // O cabecalho da funcao e' o mesmo da 382 (STABLE SECURITY DEFINER, search_path).
  assert.equal(
    definicao(sql).split("AS $$")[0],
    definicao(anterior).split("AS $$")[0],
  );
});

Deno.test("3996: a vigente e' a ultima redefinicao de fin_dre da arvore; db-apply exige as guardas; a lista das sucessoras da 99 fecha", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine fin_dre depois da 3996",
  );
  assert.equal(fontes.at(-2), nome382, "a 3996 sucede a 382 direto");
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[nome];
  assert.equal(checagem?.funcao, "fin_dre");
  assert.equal(avaliarChecagem(corpo(sql), checagem).situacao, "verificada");
  // O CORPO ANTERIOR (com o piso) reprova o marcador novo: a verificacao de pos-apply enxerga a troca.
  assert.equal(avaliarChecagem(corpo(anterior), checagem).situacao, "falhou");
  for (const marcador of checagem.esperado) {
    const texto = typeof marcador === "string" ? marcador : marcador.texto;
    assert.equal(
      avaliarChecagem(corpo(sql).replace(texto, ""), checagem).situacao,
      "falhou",
      `sem "${texto}" a verificacao tem de falhar`,
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

Deno.test("3996: a 8e, a 45a e a 87a aceitam o corpo novo; as consultas 122a/122b sao so de catalogo, quatro linhas fechadas, e estao registradas", async () => {
  assert.ok(
    ler(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
    ).includes(`('fin_dre', '${H_NOVO}', '20261399600000')`),
  );
  assert.ok(
    ler(
      "scripts/publicacao/consultas/45a-conferir-custo-do-dia-aplicado.sql",
    ).includes(
      `f.m IN ('afc3e13805ce37819cfdcd094043087c', '${H_ANTES}', '${H_NOVO}')`,
    ),
  );
  assert.ok(
    ler(
      "scripts/publicacao/consultas/87a-conferir-resultado-mostra-tarifa-juro-e-quebra-como-despesa-aplicado.sql",
    ).includes(`h IN ('${H_ANTES}', '${H_NOVO}')`),
  );
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas = [
    [
      "122a-conferir-o-resultado-credita-o-custo-da-devolucao-de-outro-mes-aplicado",
      H_NOVO,
    ],
    [
      "122b-antes-o-resultado-credita-o-custo-da-devolucao-de-outro-mes-base-vigente",
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
    p.versoes.includes("20261399600000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/o-resultado-credita-o-custo-da-devolucao-de-outro-mes-viva.cjs",
    ),
  );
});
