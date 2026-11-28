// A CATEGORIA QUE SO TEM PRODUTO EXCLUIDO PODE SAIR: prova offline do par 20261650000000 + rollback.
// O COMPORTAMENTO (so excluidos apaga e o nome escrito no produto fica, o relatorio por categoria igual antes e depois, 1 vivo
// + excluidos recusa, rollback e reaplicar, pre-voo, consultas) e' provado em
// tests/banco/a-categoria-so-com-produto-excluido-pode-sair-viva.cjs, que so roda no Postgres efemero do CI. Aqui fica o que
// se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const nome = "20261650000000_a_categoria_so_com_produto_excluido_pode_sair.sql";
const nome1237 =
  "20261237000000_a_lojista_renomeia_e_apaga_categoria_sem_deixar_produto_orfao.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const sql1237 = ler(`supabase/migrations/${nome1237}`);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const H_ANTES = "942449150bb5e6fadfa7cf003f3fa49e";
const H_NOVO = "f1526e7727709356677c83fdea745491";
const H_USOS = "de71936e57268db232630d37e88fe6cd";
const MARCA = "CREATE OR REPLACE FUNCTION public.apagar_categoria_vazia(";

/** A UNICA definicao de apagar_categoria_vazia do arquivo: cabecalho (ate o AS) e corpo (entre os delimitadores). */
function definicao(arquivo: string): { cabeca: string; corpo: string } {
  assert.equal(arquivo.split(MARCA).length - 1, 1, "uma definicao so");
  const i = arquivo.indexOf(MARCA);
  const m = /\bAS (\$\w*\$)/.exec(arquivo.slice(i));
  assert.ok(m, "sem delimitador de dolar");
  const abre = i + m.index + m[0].length;
  return {
    cabeca: arquivo.slice(i, i + m.index),
    corpo: arquivo.slice(abre, arquivo.indexOf(`${m[1]};`, abre)),
  };
}
const corpoDaFuncao = (arquivo: string, fn: string) => {
  const i = arquivo.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(i >= 0, `${fn} nao esta no arquivo`);
  const a = arquivo.indexOf("AS $$", i) + "AS $$".length;
  return arquivo.slice(a, arquivo.indexOf("$$;", a));
};
const comentario = (arquivo: string) => {
  const i = arquivo.indexOf(
    "COMMENT ON FUNCTION public.apagar_categoria_vazia(uuid) IS",
  );
  assert.ok(i >= 0, "sem COMMENT");
  return arquivo.slice(i, arquivo.indexOf(";", i) + 1);
};

// O que a migration troca no corpo da 1237, exatamente (de -> para).
const TROCAS: Array<[string, string]> = [
  ["  v_aviso_excluidos text := '';\n", ""],
  [
    "  IF v_produtos > 0 THEN\n" +
      "    v_motivos := v_motivos || (\n" +
      "      v_produtos || CASE WHEN v_produtos = 1 THEN ' produto' ELSE ' produtos' END\n" +
      "      || CASE\n" +
      "           WHEN v_excluidos = 1 THEN ' (1 excluído, que não aparece na lista)'\n" +
      "           WHEN v_excluidos > 1 THEN ' (' || v_excluidos || ' excluídos, que não aparecem na lista)'\n" +
      "           ELSE ''\n" +
      "         END);\n" +
      "  END IF;\n" +
      "  IF v_excluidos > 0 THEN\n" +
      "    -- A lojista não enxerga nem move produto excluído: dizer o que dá para fazer, em vez de deixá-la procurando.\n" +
      "    v_aviso_excluidos := ' Produto excluído não aparece na lista de produtos e só sai da categoria com a ajuda do suporte.';\n" +
      "  END IF;\n",
    "  -- 20261650000000: produto EXCLUÍDO (deleted_at preenchido) não segura mais a categoria; só o que a lojista vê na\n" +
      "  -- lista (à venda ou pausado). O excluído não é tocado: segue com o nome escrito, que o relatório de vendas lê.\n" +
      "  IF v_produtos - v_excluidos > 0 THEN\n" +
      "    v_motivos := v_motivos || (\n" +
      "      (v_produtos - v_excluidos) || CASE WHEN v_produtos - v_excluidos = 1 THEN ' produto' ELSE ' produtos' END);\n" +
      "  END IF;\n",
  ],
  [
    "antes de apagar.% Se só quer tirá-la da vitrine, esconda.',\n" +
      "      v_cat.nome, array_to_string(v_motivos, ', '), v_aviso_excluidos\n",
    "antes de apagar. Se só quer tirá-la da vitrine, esconda.',\n" +
      "      v_cat.nome, array_to_string(v_motivos, ', ')\n",
  ],
  [
    "RETURN jsonb_build_object('id', p_id, 'nome', v_cat.nome, 'apagada', true);",
    "RETURN jsonb_build_object('id', p_id, 'nome', v_cat.nome, 'apagada', true, 'produtos_excluidos', v_excluidos);",
  ],
];

Deno.test("3650: fase 0 do db-prove-rollback aceita o par (nada de BEGIN/COMMIT de nivel superior)", () => {
  const r = avaliarFase0({
    sqlMigration: sql,
    sqlRollback: rb,
    temRollback: true,
  });
  assert.equal(r.recusado, false, JSON.stringify(r));
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(rb)).achados, []);
});

Deno.test("3650: a ultima migration que definiu a funcao e' a 20261237000000; o rollback devolve o corpo DELA byte a byte", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const definem = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .filter((n) => ler(`supabase/migrations/${n}`).includes(MARCA))
    .sort();
  assert.deepEqual(definem.slice(-2), [nome1237, nome]);
  assert.equal(md5(definicao(sql1237).corpo), H_ANTES);
  assert.equal(definicao(rb).corpo, definicao(sql1237).corpo);
  assert.equal(md5(definicao(rb).corpo), H_ANTES);
  // MESMA assinatura e atributos (o cabecalho e' o de antes, nos dois arquivos).
  assert.equal(definicao(sql).cabeca, definicao(sql1237).cabeca);
  assert.equal(definicao(rb).cabeca, definicao(sql1237).cabeca);
  // O rollback devolve tambem o COMMENT de antes, byte a byte.
  assert.equal(comentario(rb), comentario(sql1237));
  assert.notEqual(comentario(sql), comentario(sql1237));
  // A conta "produtos menos excluidos" depende da categoria__usos da 1237: o pre-voo confere o md5 dela.
  assert.equal(md5(corpoDaFuncao(sql1237, "categoria__usos")), H_USOS);
  assert.ok(sql.includes(`IS DISTINCT FROM '${H_USOS}' THEN`));
});

Deno.test("3650: o corpo novo so troca a recusa por produto, a frase do suporte e o retorno; travas, lock, FOR UPDATE e DELETE iguais", () => {
  const novo = definicao(sql).corpo;
  assert.equal(md5(novo), H_NOVO);
  assert.ok(!novo.includes("suporte"), "nada de mandar ao suporte");
  assert.ok(!novo.includes("v_aviso_excluidos"));
  // Desfaz a edicao: sobra o corpo da 1237, byte a byte.
  let desfeito = novo;
  for (const [de, para] of TROCAS.slice(1)) {
    assert.equal(desfeito.split(para).length - 1, 1, para);
    desfeito = desfeito.replace(para, () => de);
  }
  // A primeira troca (a declaracao que saiu) volta no lugar dela.
  desfeito = desfeito.replace(
    "  v_motivos text[] := ARRAY[]::text[];\nBEGIN\n",
    () => `  v_motivos text[] := ARRAY[]::text[];\n${TROCAS[0][0]}BEGIN\n`,
  );
  assert.equal(desfeito, definicao(sql1237).corpo);
  for (const trecho of [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
    "PERFORM pg_advisory_xact_lock(hashtext('categorias:gestao'));",
    "SELECT * INTO v_cat FROM public.categorias WHERE id = p_id FOR UPDATE;",
    "v_usos := public.categoria__usos(p_id);",
    "DELETE FROM public.categorias WHERE id = p_id;",
    "USING ERRCODE = '55006';",
  ])
    assert.equal(novo.split(trecho).length - 1, 1, trecho);
  // Nenhum UPDATE de produto: o excluido fica com o nome escrito (o relatorio de vendas por categoria le esse nome).
  assert.ok(
    !/\bUPDATE\s+public\./i.test(novo),
    "o corpo novo nao reescreve linha",
  );
});

Deno.test("3650: pre-voo antes da troca, conferencia depois; nenhum DROP, UPDATE, DELETE, GRANT nem REVOKE fora do corpo; nenhuma linha reescrita", () => {
  const iPre = sql.indexOf("DO $preflight_20261650000000$");
  const iCria = sql.indexOf(MARCA);
  const iConf = sql.indexOf("DO $conferencia_20261650000000$");
  assert.ok(iPre > 0 && iPre < iCria && iCria < iConf, "ordem");
  const semComentario = removerRuido(sql);
  for (const proibido of [
    /\bDROP\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bTRUNCATE\b/i,
    /\bALTER\s+TABLE\b/i,
  ])
    assert.ok(!proibido.test(semComentario), `proibido: ${proibido}`);
  // O pre-voo aceita SO o corpo da 1237 ou o desta; a conferencia exige o desta e compara a fotografia do catalogo.
  assert.ok(sql.includes(`NOT IN ('${H_ANTES}', '${H_NOVO}')`));
  assert.ok(sql.includes(`IS DISTINCT FROM '${H_NOVO}' THEN`));
  assert.ok(
    sql.includes("current_setting('ikcous.categoria_excluidos_1650')::jsonb"),
  );
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  // O rollback aceita o desta ou o da 1237 e exige o da 1237 no fim.
  assert.ok(rb.includes(`NOT IN ('${H_NOVO}', '${H_ANTES}')`));
  assert.ok(rb.includes(`IS DISTINCT FROM '${H_ANTES}' THEN`));
  assert.ok(!/\bDROP\b/i.test(removerRuido(rb)));
  assert.ok(!/\bDELETE\s+FROM\b/i.test(removerRuido(rb)));
});

Deno.test("3650: as provas que medem a 1237 tiram esta antes (o corpo e o comportamento delas sao os da 1237)", () => {
  const modulo = ler("tests/banco/a-categoria-so-com-excluidos-posterior.cjs");
  assert.ok(modulo.includes(`'${H_NOVO}'`), "no ar = o corpo desta");
  assert.ok(modulo.includes(nome));
  for (const [arquivo, depoisDe] of [
    [
      "tests/banco/categorias-gestao-viva.cjs",
      "for (const { nome, corpo } of PROVAS) {",
    ],
    [
      "tests/banco/categorias-gestao-portao-viva.cjs",
      "await C.query(`CREATE ROLE ${PAPEL_RO} NOLOGIN NOSUPERUSER BYPASSRLS`);",
    ],
  ]) {
    const texto = ler(arquivo);
    const main = texto.slice(texto.indexOf("async function main()"));
    const i = main.indexOf("desfazerCategoriaSoComExcluidosNaTransacao");
    assert.ok(i > 0 && i < main.indexOf(depoisDe), arquivo);
    assert.ok(
      main.indexOf('await C.query("COMMIT");', i) < main.indexOf(depoisDe),
      `${arquivo}: desfeito no clone antes das provas`,
    );
  }
});

Deno.test("3650: a prova viva roda no job do dinheiro e tem linha no LEIA-ME; nenhuma tela manda a lojista ao suporte", () => {
  const rpc = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    rpc.includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/a-categoria-so-com-produto-excluido-pode-sair-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-categoria-so-com-produto-excluido-pode-sair-viva.cjs",
    ),
  );
  for (const arquivo of [
    "src/lib/gestao-de-categorias.ts",
    "src/components/admin/categorias/GerenciarCategorias.tsx",
  ])
    assert.ok(!ler(arquivo).includes("ajuda do suporte"), arquivo);
});
