import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261370000000_o_caixa_abre_so_na_conta_da_loja.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const definicao = (sql: string) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.fin_caixa_abrir\([\s\S]*?\n\$\$;/,
  )?.[0] ?? "";
const corpo = (sql: string) =>
  definicao(sql).split("AS $$")[1]?.slice(0, -3) ?? "";
const guarda = `  IF p_conta_id IS NOT NULL AND p_conta_id <> 'f1000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Abra o caixa na conta Caixa da loja. Contas personalizadas não recebem as vendas do balcão.' USING ERRCODE = '22023';
  END IF;
`;
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const anterior = ler(
  "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("370: a abertura vigente recusa conta personalizada antes de travar ou escrever", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .map((n) => ler(`supabase/migrations/${n}`))
    .filter((sql) => definicao(sql));
  const vigente = corpo(fontes.at(-1)!);
  assert.ok(
    vigente.includes(guarda),
    "a função vigente ainda aceita um caixa que não recebe vendas",
  );
  assert.ok(vigente.indexOf(guarda) < vigente.indexOf("FOR UPDATE"));
  assert.ok(vigente.indexOf(guarda) < vigente.indexOf("INSERT INTO"));
});

Deno.test("370: uma unica guarda nova; rollback e cabecalho identicos aos vigentes", () => {
  assert.equal(definicao(sql).replace(guarda, ""), definicao(anterior));
  assert.equal(definicao(rb), definicao(anterior));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
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
    // Nenhuma mudanca de ACL, tabela ou dado fora do corpo da funcao.
    const externo = texto
      .replace(definicao(texto), "")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      externo,
      /\b(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(
      texto.includes(
        "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.caixa370_atributos')::jsonb",
      ),
    );
    assert.ok(texto.includes(md5(corpo(anterior))));
    assert.ok(texto.includes(md5(corpo(sql))));
  }
  assert.ok(sql.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
});

Deno.test("370: db-apply exige todas as guardas e o inventario da 99 continua fechado", () => {
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[nome];
  assert.equal(checagem?.funcao, "fin_caixa_abrir");
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
  assert.equal(registro.hashVigente, md5(corpo(anterior)));
  assert.equal(registro.hashDesta, md5(corpo(sql)));
});

Deno.test("370: consultas so de catalogo, quatro linhas fechadas e registros de publicacao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas = [
    ["83a-conferir-caixa-so-na-conta-da-loja-aplicado", md5(corpo(sql))],
    ["83b-antes-caixa-so-na-conta-da-loja-base-vigente", md5(corpo(anterior))],
  ];
  for (const [nomeConsulta, hash] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(hash));
    assert.doesNotMatch(
      consulta,
      /FROM public\.fin_(?:contas|lancamentos|caixa_sessoes)/,
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
    p.versoes.includes("20261370000000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/caixa-conta-da-loja-viva.cjs",
    ),
  );
});
