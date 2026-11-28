// O CAIXA DE ONTEM ABERTO NAO SOME DO SALDO: prova offline do par 20261660000000 + rollback. O COMPORTAMENTO (a quebra falsa da
// abertura, o dinheiro que some do saldo total, a corrida do cancelamento com o fechamento e a do saldo inicial com a sangria, o
// controle com os corpos anteriores, os casos que nao mudam, mutantes, dado antigo, reaplicacao, pre-voo, rollback e consultas
// 216a/216b) e' provado em tests/banco/o-caixa-de-ontem-aberto-nao-some-do-saldo-viva.cjs, que so roda no Postgres efemero do CI.
// Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261660000000_o_caixa_de_ontem_aberto_nao_some_do_saldo.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const lerBruto = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url));
const ler = (rel: string) => lerBruto(rel).replace(/\r/g, "");
const definicao = (sql: string, fn: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (ini < 0) return "";
  const fecho = "\n$$;";
  return sql.slice(ini, sql.indexOf(fecho, ini) + fecho.length);
};
const corpo = (sql: string, fn: string) =>
  definicao(sql, fn).split("AS $$")[1]?.slice(0, -3) ?? "";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const contar = (texto: string, trecho: string) =>
  texto.split(trecho).length - 1;

const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

type Funcao =
  | "fin_conta_salvar"
  | "fin_caixa_movimentar_com_chave"
  | "fin_lancamento_cancelar";
const FUNCOES: Array<{
  fn: Funcao;
  fonte: string;
  arquivoFonte: string;
  antes: string;
  depois: string;
}> = [
  {
    fn: "fin_conta_salvar",
    arquivoFonte:
      "20261399930000_o_caixa_e_a_conta_recusam_valor_que_nao_e_numero.sql",
    fonte: ler(
      "supabase/migrations/20261399930000_o_caixa_e_a_conta_recusam_valor_que_nao_e_numero.sql",
    ),
    antes: "1dc6cfdb075e3a1a0882398e1220d0f1",
    depois: "d29894a41940ec4f5bc55ca2b103b69a",
  },
  {
    fn: "fin_caixa_movimentar_com_chave",
    arquivoFonte: "20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql",
    fonte: ler(
      "supabase/migrations/20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql",
    ),
    antes: "f1b22fd85f7a4ae2200d37001c9e1ffb",
    depois: "b7df8a8d11d64ab2cc2bd1dc31a57ae3",
  },
  {
    fn: "fin_lancamento_cancelar",
    arquivoFonte: "20261199000000_portas_do_painel_exigem_admin_atual.sql",
    fonte: ler(
      "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
    ),
    antes: "a0b036d6d16d323dc806732b85b8b1cf",
    depois: "ee75614cd65e5a7339045320e8a855c3",
  },
];

/** O bloco marcado desta migration dentro de um corpo (entre os dois marcadores), sem os marcadores. */
const BLOCO_INI = "  -- >>> o caixa de ontem aberto (20261660000000)\n";
const BLOCO_FIM = "  -- <<< o caixa de ontem aberto (20261660000000)\n";
function semOBloco(texto: string): string {
  const i = texto.indexOf(BLOCO_INI);
  const f = texto.indexOf(BLOCO_FIM);
  assert.ok(i >= 0 && f > i, "o bloco marcado existe");
  return texto.slice(0, i) + texto.slice(f + BLOCO_FIM.length);
}
// Fora do bloco marcado, as UNICAS outras trocas (novo -> anterior): as variaveis declaradas e a trava da contrapartida.
const FORA_DO_BLOCO: Record<Funcao, Array<[string, string]>> = {
  fin_conta_salvar: [["  v_novo_em date;\n  v_dia_do_caixa date;\n", ""]],
  fin_caixa_movimentar_com_chave: [
    ["  v_tardia public.fin_contas%ROWTYPE;\n", ""],
    ["WHERE id = v_contra_id FOR SHARE;\n", "WHERE id = v_contra_id;\n"],
  ],
  fin_lancamento_cancelar: [],
};

Deno.test("1660: os hashes das seis pontas batem com os corpos escritos; o rollback devolve os tres corpos byte a byte", () => {
  for (const { fn, fonte, antes, depois } of FUNCOES) {
    assert.equal(md5(corpo(fonte, fn)), antes, `${fn} anterior`);
    assert.equal(md5(corpo(sql, fn)), depois, `${fn} desta`);
    assert.equal(md5(corpo(rb, fn)), antes, `${fn} rollback`);
    assert.equal(definicao(rb, fn), definicao(fonte, fn), `${fn} rollback`);
  }
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 3);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 3);
});

Deno.test("1660: o corpo de partida de cada uma e' o VIVO (a ultima migration que a define antes desta) e nenhuma outra a redefine depois", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort();
  for (const { fn, arquivoFonte } of FUNCOES) {
    const quem = fontes.filter(
      (n) => definicao(ler(`supabase/migrations/${n}`), fn) !== "",
    );
    assert.equal(quem.at(-1), nome, fn);
    assert.equal(quem.at(-2), arquivoFonte, fn);
  }
});

Deno.test("1660: so o bloco marcado, as variaveis e a trava da contrapartida mudam; cabecalho (assinatura, SECURITY DEFINER, search_path) igual", () => {
  for (const { fn, fonte } of FUNCOES) {
    const novo = definicao(sql, fn);
    const velho = definicao(fonte, fn);
    assert.equal(novo.split("AS $$")[0], velho.split("AS $$")[0], fn);
    assert.equal(contar(novo, BLOCO_INI), 1, fn);
    assert.equal(contar(novo, BLOCO_FIM), 1, fn);
    let volta = semOBloco(novo);
    // eslint-disable-next-line security/detect-object-injection -- fn vem da lista fechada FUNCOES.
    for (const [de, para] of FORA_DO_BLOCO[fn]) {
      assert.equal(contar(volta, de), 1, `${fn}: ${de.slice(0, 60)}`);
      volta = volta.replace(de, () => para);
    }
    assert.equal(volta, velho, fn);
  }
});

Deno.test("1660: as pecas do desenho estao onde devem (depois da trava, antes da escrita) e com as frases da loja", () => {
  const conta = corpo(sql, "fin_conta_salvar");
  const iTrava = conta.indexOf(
    "SELECT * INTO v_atual FROM public.fin_contas WHERE id = v_id FOR UPDATE;",
  );
  const iGuarda = conta.indexOf(BLOCO_INI);
  const iEscrita = conta.indexOf("  UPDATE public.fin_contas SET\n");
  // Criar conta (o INSERT) vem ANTES do bloco e nao passa por ele.
  assert.ok(conta.indexOf("INSERT INTO public.fin_contas") < iTrava);
  assert.ok(iTrava >= 0 && iTrava < iGuarda && iGuarda < iEscrita);
  assert.equal(
    contar(conta, "AND public.fin__dia(s.aberto_em) < v_novo_em"),
    1,
  );
  assert.equal(contar(conta, "USING ERRCODE = '22023'"), 4);
  assert.ok(
    conta.includes(
      "'O caixa aberto em % ainda lança nesta conta com a data desse dia. Feche esse caixa antes de mudar o saldo inicial para depois de %, ou use a data % ou uma anterior.'",
    ),
  );

  const mover = corpo(sql, "fin_caixa_movimentar_com_chave");
  // A guarda vem depois da reserva da tentativa (o replay de um movimento ja gravado segue devolvendo o mesmo id) e da conta
  // contrapartida lida FOR SHARE; e ANTES do INSERT do lancamento.
  const iReserva = mover.indexOf("ON CONFLICT (chave) DO NOTHING;");
  const iContra = mover.indexOf("WHERE id = v_contra_id FOR SHARE;");
  const iGuardaMover = mover.indexOf(BLOCO_INI);
  const iInsert = mover.indexOf("INSERT INTO public.fin_lancamentos (");
  assert.ok(
    iReserva >= 0 &&
      iReserva < iContra &&
      iContra < iGuardaMover &&
      iGuardaMover < iInsert,
  );
  assert.ok(
    mover.includes(
      "'A conta % só conta o saldo a partir de %, depois do dia deste caixa (%): % ficaria fora do saldo dela. Feche este caixa e abra outro, ou mude a data do saldo inicial da conta % para % ou antes.'",
    ),
  );
  // A data que a sessao grava continua a do dia da abertura (a 20261654000000 intacta).
  assert.equal(contar(mover, "v_dia := public.fin__dia(v_s.aberto_em);"), 1);

  const cancelar = corpo(sql, "fin_lancamento_cancelar");
  // A trava do lancamento, depois a da sessao, depois a conferencia do status: nessa ordem.
  const iLanc = cancelar.indexOf(
    "SELECT * INTO v_l FROM public.fin_lancamentos WHERE id = p_id FOR UPDATE;",
  );
  const iSessao = cancelar.indexOf(
    "PERFORM 1 FROM public.fin_caixa_sessoes s WHERE s.id = v_l.caixa_sessao_id FOR UPDATE;",
  );
  const iStatus = cancelar.indexOf(
    "WHERE s.id = v_l.caixa_sessao_id AND s.status = 'fechado'",
  );
  const iUpdate = cancelar.indexOf("UPDATE public.fin_lancamentos");
  assert.ok(iLanc >= 0 && iLanc < iSessao && iSessao < iStatus);
  assert.ok(iStatus < iUpdate);
});

Deno.test("1660: sem BEGIN/COMMIT, LF, pre-voo antes de escrever, pos-voo com atributos; nada de ACL, tabela ou dado fora dos corpos; rollback tambem", () => {
  for (const arquivo of [nome, `rollback-manual-${nome}`])
    assert.ok(
      !lerBruto(`supabase/migrations/${arquivo}`).includes("\r"),
      arquivo,
    );
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
      /\b(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|BEGIN;|COMMIT)\b/i,
    );
    const iLock = texto.indexOf("SET LOCAL lock_timeout = '5s';");
    assert.ok(iLock >= 0 && iLock < texto.indexOf("DO $preflight"));
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
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.ontem1660_' || esperado.nome)::jsonb",
    ),
  );
  assert.ok(sql.includes(")) <> 3 THEN"));
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  assert.ok(
    rb.includes(
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.ontem1660rb_' || esperado.nome)::jsonb",
    ),
  );
});

Deno.test("1660: db-apply exige as pecas, o inventario das sucessoras da 99 fecha e as antecessoras tiram esta antes de medir", () => {
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

  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  const desta = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.deepEqual(
    desta.map((s: { hashVigente: string; hashDesta: string }) => [
      s.hashVigente,
      s.hashDesta,
    ]),
    FUNCOES.map((f) => [f.antes, f.depois]),
  );

  const posterior = ler("tests/banco/o-caixa-de-ontem-aberto-posterior.cjs");
  for (const { antes, depois } of FUNCOES) {
    assert.ok(posterior.includes(`"${antes}"`), antes);
    assert.ok(posterior.includes(`"${depois}"`), depois);
  }
  // As antecessoras (1654 e 3999300) desfazem esta ANTES: no modulo "posterior" delas e na prova viva delas.
  // [arquivo, o primeiro trecho que ja mede a antecessora: a chamada tem de vir antes dele]
  for (const [arquivo, depoisDe] of [
    [
      "tests/banco/o-caixa-pertence-ao-dia-posterior.cjs",
      "  let noAr = false;\n",
    ],
    [
      "tests/banco/o-caixa-e-a-conta-recusam-nan-posterior.cjs",
      "  const abrir = (await cliente.query(hashVivo(ABRIR))).rows[0]?.h;",
    ],
    [
      "tests/banco/o-caixa-pertence-ao-dia-em-que-abriu-viva.cjs",
      "    const vivo = await hashes(c);",
    ],
    [
      "tests/banco/o-caixa-e-a-conta-recusam-nan-viva.cjs",
      "    const vivo = await hashes(c);",
    ],
  ]) {
    const texto = ler(arquivo);
    const iChamada = texto.indexOf(
      'require("./o-caixa-de-ontem-aberto-posterior.cjs").desfazerCaixaDeOntemAbertoNaTransacao(',
    );
    const iMedida = texto.indexOf(depoisDe);
    assert.ok(iChamada >= 0 && iMedida > iChamada, arquivo);
  }
  // A prova 8e sai pela prova propria desta; a 17a lista as tres entradas.
  assert.ok(
    ler("tests/banco/portao-8e-aceita-sucessoras-viva.cjs").includes(
      `s.nome !== "${nome}" &&`,
    ),
  );
  const estoque = ler("tests/banco/estoque-do-painel-portao-viva.cjs");
  for (const assinatura of [
    "public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)",
    "public.fin_conta_salvar(jsonb)",
    "public.fin_lancamento_cancelar(uuid,text)",
  ])
    assert.ok(
      estoque.includes(`        "${nome}",\n        "${assinatura}",\n`),
      assinatura,
    );
});

Deno.test("1660: consultas 216a/216b so de catalogo, dez linhas fechadas, hashes certos, registros de publicacao e as antecessoras aceitam a sucessora", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, "antes" | "depois"]> = [
    [
      "216a-conferir-o-caixa-de-ontem-aberto-nao-some-do-saldo-aplicado",
      "depois",
    ],
    [
      "216b-antes-o-caixa-de-ontem-aberto-nao-some-do-saldo-base-vigente",
      "antes",
    ],
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
    // Sem comentario e sem o conteudo dos literais (os itens do rol citam "EXECUTE", "PUBLIC"...).
    const semComentario = consulta
      .replace(/--[^\n]*/g, "")
      .replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(
      semComentario,
      /FROM public\.fin_(?:contas|lancamentos|caixa_sessoes|caixa_movimento_tentativas)/,
    );
    assert.doesNotMatch(
      semComentario,
      /\b(?:fin_conta_salvar|fin_caixa_movimentar_com_chave|fin_lancamento_cancelar)\s*\(/,
    );
    assert.doesNotMatch(
      semComentario,
      /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT|INTO|LOCK)\b/i,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 10);
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
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const entrada = canais.provasDeObjetos.filter((p: { versoes: string[] }) =>
    p.versoes.includes("20261660000000"),
  );
  assert.equal(entrada.length, 1);
  assert.deepEqual(entrada[0].versoes, ["20261660000000"]);
  assert.equal(entrada[0].consulta, consultas[0][0]);
  assert.equal(entrada[0].ausenciaConfirmadaPor, consultas[1][0]);
  for (const chave of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(chave in entrada[0]), chave);
  const ordem = canais.provasDeObjetos.map(
    (p: { consulta: string }) => p.consulta,
  );
  for (const anterior of [
    "128a-conferir-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-aplicado",
    "210a-conferir-o-caixa-pertence-ao-dia-em-que-abriu-aplicado",
  ])
    assert.ok(
      ordem.indexOf(anterior) >= 0 &&
        ordem.indexOf(anterior) < ordem.indexOf(consultas[0][0]),
      `o lote da 216a vem depois do da ${anterior}`,
    );
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/o-caixa-de-ontem-aberto-nao-some-do-saldo-viva.cjs",
    ),
  );

  // As antecessoras aceitam os corpos desta como SUCESSORA (senao reprovam em toda loja depois do apply), e nunca um corpo estranho.
  const [conta, mover, cancelar] = FUNCOES;
  const c128a = ler(
    "scripts/publicacao/consultas/128a-conferir-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-aplicado.sql",
  );
  assert.ok(
    c128a.includes(
      `SELECT CASE WHEN h = '${conta.depois}' THEN '${conta.antes}' ELSE h END FROM fn WHERE nome = 'fin_conta_salvar'`,
    ),
  );
  const c210a = ler(
    "scripts/publicacao/consultas/210a-conferir-o-caixa-pertence-ao-dia-em-que-abriu-aplicado.sql",
  );
  assert.ok(
    c210a.includes(
      `SELECT CASE WHEN h = '${mover.depois}' THEN '${mover.antes}' ELSE h END FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'`,
    ),
  );
  const c55a = ler(
    "scripts/publicacao/consultas/55a-conferir-intencao-do-caixa-aplicado.sql",
  );
  assert.ok(
    c55a.includes(
      `h IN ('134bd5b7c5872bf30041601725fc37ba', '${mover.antes}', '${mover.depois}')`,
    ),
  );
  const c8e = ler(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    c8e.includes(`('fin_conta_salvar', '${conta.depois}', '20261660000000')`),
  );
  assert.ok(
    c8e.includes(
      `('fin_lancamento_cancelar', '${cancelar.depois}', '20261660000000')`,
    ),
  );
});
