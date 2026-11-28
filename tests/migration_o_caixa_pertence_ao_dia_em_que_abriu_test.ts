// O CAIXA PERTENCE AO DIA EM QUE ABRIU: prova offline do par 20261654000000 + rollback. O COMPORTAMENTO (a virada da meia-noite,
// o caixa de um dia so igual ao de antes, controle, mutantes, dado antigo, reaplicacao, pre-voo, rollback e consultas 210a/210b) e'
// provado em tests/banco/o-caixa-pertence-ao-dia-em-que-abriu-viva.cjs, que so roda no Postgres efemero do CI. Aqui fica o que se
// prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const definicao = (sql: string, fn: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (ini < 0) return "";
  const fecho = "\n$$;";
  return sql.slice(ini, sql.indexOf(fecho, ini) + fecho.length);
};
const corpo = (sql: string, fn: string) =>
  definicao(sql, fn).split("AS $$")[1]?.slice(0, -3) ?? "";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const S246 = ler(
  "supabase/migrations/20261246000000_o_lancamento_repetido_nao_duplica.sql",
);
const S99 = ler(
  "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
);
const S252 = ler(
  "supabase/migrations/20261252000000_o_caixa_preserva_a_intencao.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

type Funcao =
  | "fin_lancamento_salvar"
  | "fin_lancamento_baixar"
  | "fin_caixa_fechar_sessao"
  | "fin_caixa_movimentar_com_chave";
const FUNCOES: Array<{
  fn: Funcao;
  fonte: string;
  antes: string;
  depois: string;
}> = [
  {
    fn: "fin_lancamento_salvar",
    fonte: S246,
    antes: "1356dbfc037a9202ef163ba598854891",
    depois: "3e31817ce1d13bb091ce2d0871cbd718",
  },
  {
    fn: "fin_lancamento_baixar",
    fonte: S99,
    antes: "e59bc12ea20182da4209a257df0be8c1",
    depois: "7d1204cdf214a290cfdb378482795f1b",
  },
  {
    fn: "fin_caixa_fechar_sessao",
    fonte: S252,
    antes: "f10208ba223450fd25af3c9e11dca073",
    depois: "3bc5c509d150fca3c5135361461dcc40",
  },
  {
    fn: "fin_caixa_movimentar_com_chave",
    fonte: S252,
    antes: "134bd5b7c5872bf30041601725fc37ba",
    depois: "f1b22fd85f7a4ae2200d37001c9e1ffb",
  },
];

// As trocas EXATAS de cada corpo (novo -> anterior). Desfeitas, sobra o corpo anterior byte a byte: nada mais mudou.
const TROCAS: Record<Funcao, Array<[string, string]>> = {
  fin_lancamento_salvar: [
    [
      `  -- O caixa pertence ao dia (Brasília) em que abriu (20261654000000): o que foi pago entre o dia da
  -- abertura e hoje, na conta de um caixa ainda aberto, entra na conferência dele. Caixa aberto hoje
  -- só recebe o de hoje (o pago ontem não saiu da gaveta de hoje).
  IF v_status = 'realizado' THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta.id OR (v_tipo = 'transferencia' AND s.conta_id = v_destino.id))
       AND v_real >= public.fin__dia(s.aberto_em)
     ORDER BY s.aberto_em DESC LIMIT 1;
  END IF;
`,
      `  -- Movimento de hoje na conta de um caixa aberto entra na conferência dele.
  IF v_status = 'realizado' AND v_real = v_hoje THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta.id OR (v_tipo = 'transferencia' AND s.conta_id = v_destino.id))
     ORDER BY s.aberto_em DESC LIMIT 1;
  END IF;
`,
    ],
  ],
  fin_lancamento_baixar: [
    [
      `  -- O caixa pertence ao dia (Brasília) em que abriu (20261654000000): a baixa com data entre o dia da
  -- abertura e hoje, na conta de um caixa ainda aberto, entra na conferência dele.
  SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
   WHERE s.status = 'aberto' AND (s.conta_id = v_conta OR s.conta_id = v_l.conta_destino_id)
     AND v_data >= public.fin__dia(s.aberto_em)
   ORDER BY s.aberto_em DESC LIMIT 1;
`,
      `  IF v_data = public.fin__hoje() THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta OR s.conta_id = v_l.conta_destino_id)
     ORDER BY s.aberto_em DESC LIMIT 1;
  END IF;
`,
    ],
  ],
  fin_caixa_fechar_sessao: [
    [
      "  v_dif numeric(12, 2);\n  v_dia date;\nBEGIN",
      "  v_dif numeric(12, 2);\nBEGIN",
    ],
    [
      `  -- O caixa pertence ao dia (Brasília) em que abriu (20261654000000): a sobra/quebra vai para o
  -- dia da abertura, mesmo fechando depois da meia-noite.
  v_dia := public.fin__dia(v_s.aberto_em);
`,
      "",
    ],
    [
      "'dinheiro', v_dia, v_dia, v_dia, 'ajuste_caixa', v_s.id, auth.uid()",
      "'dinheiro', public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), 'ajuste_caixa', v_s.id, auth.uid()",
    ],
  ],
  fin_caixa_movimentar_com_chave: [
    [
      "  v_esperado numeric;\n  v_dia date;\nBEGIN",
      "  v_esperado numeric;\nBEGIN",
    ],
    [
      `  -- O caixa pertence ao dia (Brasília) em que abriu (20261654000000): a sangria/suprimento vai para
  -- o dia da abertura, mesmo feito depois da meia-noite com o caixa ainda aberto.
  v_dia := public.fin__dia(v_s.aberto_em);
`,
      "",
    ],
    [
      "v_desc, 'dinheiro', v_dia, v_dia, v_dia, p_tipo, v_s.id, v_autor",
      "v_desc, 'dinheiro', public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), p_tipo, v_s.id, v_autor",
    ],
  ],
};

const contar = (texto: string, trecho: string) =>
  texto.split(trecho).length - 1;

Deno.test("1654: os hashes das oito pontas batem com os corpos escritos; o rollback devolve os quatro corpos byte a byte", () => {
  for (const { fn, fonte, antes, depois } of FUNCOES) {
    assert.equal(md5(corpo(fonte, fn)), antes, `${fn} anterior`);
    assert.equal(md5(corpo(sql, fn)), depois, `${fn} desta`);
    assert.equal(md5(corpo(rb, fn)), antes, `${fn} rollback`);
    assert.equal(definicao(rb, fn), definicao(fonte, fn), `${fn} rollback`);
  }
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 4);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 4);
});

Deno.test("1654: so a escolha da sessao e a data gravada mudam; cabecalho (assinatura, SECURITY DEFINER, search_path) igual", () => {
  for (const { fn, fonte } of FUNCOES) {
    const novo = definicao(sql, fn);
    const velho = definicao(fonte, fn);
    assert.equal(novo.split("AS $$")[0], velho.split("AS $$")[0], fn);
    let volta = novo;
    // eslint-disable-next-line security/detect-object-injection -- fn vem da lista fechada FUNCOES.
    for (const [de, para] of TROCAS[fn]) {
      assert.equal(contar(volta, de), 1, `${fn}: ${de.slice(0, 60)}`);
      volta = volta.replace(de, () => para);
    }
    assert.equal(volta, velho, fn);
  }
});

Deno.test("1654: as quatro pecas do principio estao onde devem, e nenhuma data de hoje sobra na sessao", () => {
  const salvar = corpo(sql, "fin_lancamento_salvar");
  // A janela vai do dia da abertura ate hoje: o teto (nada no futuro) e' a recusa que ja existia, ANTES da escolha da sessao.
  assert.ok(
    salvar.indexOf("IF v_real IS NOT NULL AND v_real > v_hoje THEN") <
      salvar.indexOf("AND v_real >= public.fin__dia(s.aberto_em)"),
  );
  assert.doesNotMatch(salvar, /v_real = v_hoje/);
  const baixar = corpo(sql, "fin_lancamento_baixar");
  assert.doesNotMatch(baixar, /v_data = public\.fin__hoje\(\)/);
  assert.equal(contar(baixar, "AND v_data >= public.fin__dia(s.aberto_em)"), 1);
  for (const fn of [
    "fin_caixa_fechar_sessao",
    "fin_caixa_movimentar_com_chave",
  ] as const) {
    const c = corpo(sql, fn);
    // O dia sai da linha travada (FOR UPDATE) e so depois dela; a sessao grava SO o dia da abertura.
    assert.ok(
      c.indexOf("FOR UPDATE") <
        c.indexOf("v_dia := public.fin__dia(v_s.aberto_em);"),
      fn,
    );
    assert.equal(contar(c, "public.fin__hoje()"), 0, fn);
    assert.equal(contar(c, "v_dia, v_dia, v_dia"), 1, fn);
  }
});

Deno.test("1654: sem BEGIN/COMMIT, pre-voo antes de escrever, pos-voo com atributos; nada de ACL, tabela ou dado fora dos corpos; rollback tambem", () => {
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
    let semFuncoes = texto;
    for (const { fn } of FUNCOES)
      semFuncoes = semFuncoes.replace(definicao(texto, fn), "");
    semFuncoes = semFuncoes.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      semFuncoes,
      /\b(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|BEGIN;|COMMIT)\b/i,
    );
    assert.ok(
      semFuncoes.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    for (const { antes, depois } of FUNCOES) {
      assert.ok(texto.includes(antes), antes);
      assert.ok(texto.includes(depois), depois);
    }
  }
  assert.ok(sql.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(
    sql.includes(
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.caixa1654_' || esperado.nome)::jsonb",
    ),
  );
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  assert.ok(
    rb.includes(
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.caixa1654rb_' || esperado.nome)::jsonb",
    ),
  );
});

Deno.test("1654: db-apply exige o principio, as funcoes vigentes sao estas e o inventario das sucessoras da 99 fecha", () => {
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagens = VERIFICACOES[nome] as Array<{
    funcao: Funcao;
    esperado: Array<{ texto: string }>;
  }>;
  assert.deepEqual(
    checagens.map((c) => c.funcao),
    FUNCOES.map((f) => f.fn),
  );
  for (const c of checagens) {
    const corpoVivo = corpo(sql, c.funcao);
    assert.equal(avaliarChecagem(corpoVivo, c).situacao, "verificada");
    const fonte = FUNCOES.find((f) => f.fn === c.funcao)?.fonte ?? "";
    // O corpo ANTERIOR reprova e cada marcador que some tira a verificacao do ar.
    assert.equal(
      avaliarChecagem(corpo(fonte, c.funcao), c).situacao,
      "falhou",
      c.funcao,
    );
    for (const m of c.esperado)
      assert.equal(
        avaliarChecagem(corpoVivo.replace(m.texto, "XX"), c).situacao,
        "falhou",
        `o marcador "${m.texto.slice(0, 50)}" nao pega a regressao`,
      );
  }

  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort();
  for (const { fn } of FUNCOES) {
    const quem = fontes.filter((n) =>
      definicao(ler(`supabase/migrations/${n}`), fn),
    );
    assert.equal(quem.at(-1), nome, fn);
  }

  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  const desta = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) => s.nome === nome,
  );
  const hashes = new Set(desta.map((s: { hashDesta: string }) => s.hashDesta));
  for (const { depois } of FUNCOES) assert.ok(hashes.has(depois), depois);
});

Deno.test("1654: consultas 210a/210b so de catalogo, treze linhas fechadas, hashes certos e registros de publicacao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, "antes" | "depois"]> = [
    ["210a-conferir-o-caixa-pertence-ao-dia-em-que-abriu-aplicado", "depois"],
    ["210b-antes-o-caixa-pertence-ao-dia-em-que-abriu-base-vigente", "antes"],
  ];
  for (const [nomeConsulta, ponta] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    for (const f of FUNCOES) {
      // eslint-disable-next-line security/detect-object-injection -- ponta e' "antes" ou "depois".
      assert.ok(consulta.includes(f[ponta]), `${nomeConsulta}: ${f.fn}`);
      const outra = ponta === "antes" ? f.depois : f.antes;
      assert.ok(
        !consulta.includes(outra),
        `${nomeConsulta}: ${f.fn} outra ponta`,
      );
    }
    assert.doesNotMatch(
      consulta,
      /FROM public\.fin_(?:contas|lancamentos|caixa_sessoes)/,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 13);
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
    p.versoes.includes("20261654000000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/o-caixa-pertence-ao-dia-em-que-abriu-viva.cjs",
    ),
  );
});
