// A DESPESA NAO ENTRA NO CAIXA FECHADO: prova offline do par 20261663000000 + rollback. O COMPORTAMENTO (a despesa e a baixa
// que correm com o fechamento do caixa em duas conexoes reais, com a pausa forcada entre a leitura da sessao e a escrita; o
// controle com os corpos anteriores; os mutantes sem cada trava; os casos de uma conexao so que nao mudam; dado antigo,
// reaplicacao, pre-voo, rollback e consultas 219a/219b) e' provado em tests/banco/a-despesa-nao-entra-no-caixa-fechado-viva.cjs,
// que so roda no Postgres efemero do CI. Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261663000000_a_despesa_nao_entra_no_caixa_fechado.sql";
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
const FONTE_1654 = "20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql";
const fonte = ler(`supabase/migrations/${FONTE_1654}`);

type Funcao = "fin_lancamento_salvar" | "fin_lancamento_baixar";
const FUNCOES: Array<{
  fn: Funcao;
  antes: string;
  depois: string;
  trava: [string, string];
}> = [
  {
    fn: "fin_lancamento_salvar",
    antes: "3e31817ce1d13bb091ce2d0871cbd718",
    depois: "729fc6e3e4a643459df835d214fa082e",
    trava: [
      "     ORDER BY s.aberto_em DESC LIMIT 1 FOR SHARE OF s;\n  END IF;\n",
      "     ORDER BY s.aberto_em DESC LIMIT 1;\n  END IF;\n",
    ],
  },
  {
    fn: "fin_lancamento_baixar",
    antes: "7d1204cdf214a290cfdb378482795f1b",
    depois: "0abf8da5b460d8b8236ffb5ffc111524",
    trava: [
      "   ORDER BY s.aberto_em DESC LIMIT 1 FOR SHARE OF s;\n  UPDATE public.fin_lancamentos\n",
      "   ORDER BY s.aberto_em DESC LIMIT 1;\n  UPDATE public.fin_lancamentos\n",
    ],
  },
];

/** Tira o bloco marcado desta migration (as linhas inteiras dos dois marcadores e o que esta entre eles). */
const MARCA_INI =
  "-- >>> a despesa nao entra no caixa fechado (20261663000000)\n";
const MARCA_FIM =
  "-- <<< a despesa nao entra no caixa fechado (20261663000000)\n";
function semOBloco(texto: string): string {
  const i = texto.indexOf(MARCA_INI);
  const f = texto.indexOf(MARCA_FIM);
  assert.ok(i >= 0 && f > i, "o bloco marcado existe");
  const inicioDaLinha = texto.lastIndexOf("\n", i) + 1;
  assert.equal(
    texto.slice(inicioDaLinha, i).trim(),
    "",
    "o marcador abre a linha",
  );
  return texto.slice(0, inicioDaLinha) + texto.slice(f + MARCA_FIM.length);
}

Deno.test("1663: os hashes das quatro pontas batem com os corpos escritos; o rollback devolve os dois corpos byte a byte", () => {
  for (const { fn, antes, depois } of FUNCOES) {
    assert.equal(md5(corpo(fonte, fn)), antes, `${fn} anterior`);
    assert.equal(md5(corpo(sql, fn)), depois, `${fn} desta`);
    assert.equal(md5(corpo(rb, fn)), antes, `${fn} rollback`);
    assert.equal(definicao(rb, fn), definicao(fonte, fn), `${fn} rollback`);
  }
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 2);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 2);
});

Deno.test("1663: o corpo de partida de cada uma e' o VIVO (a 1654 e' a ultima que a define antes desta) e nenhuma outra a redefine depois", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort();
  for (const { fn } of FUNCOES) {
    const quem = fontes.filter(
      (n) => definicao(ler(`supabase/migrations/${n}`), fn) !== "",
    );
    assert.equal(quem.at(-1), nome, fn);
    assert.equal(quem.at(-2), FONTE_1654, fn);
  }
});

Deno.test("1663: so o bloco de comentario marcado e a trava da leitura da sessao mudam; cabecalho (assinatura, SECURITY DEFINER, search_path) igual", () => {
  for (const { fn, trava } of FUNCOES) {
    const novo = definicao(sql, fn);
    const velho = definicao(fonte, fn);
    assert.equal(novo.split("AS $$")[0], velho.split("AS $$")[0], fn);
    assert.equal(contar(novo, MARCA_INI), 1, fn);
    assert.equal(contar(novo, MARCA_FIM), 1, fn);
    let volta = semOBloco(novo);
    // O bloco e' SO comentario: nenhuma linha de codigo entra com ele.
    const bloco = novo.slice(
      novo.indexOf(MARCA_INI),
      novo.indexOf(MARCA_FIM) + MARCA_FIM.length,
    );
    for (const linha of bloco.split("\n").filter((l) => l.trim() !== ""))
      assert.ok(linha.trim().startsWith("--"), `${fn}: ${linha}`);
    assert.equal(contar(volta, trava[0]), 1, `${fn}: a trava`);
    volta = volta.replace(trava[0], () => trava[1]);
    assert.equal(volta, velho, fn);
    // Uma trava so por funcao no CODIGO (o comentario a cita), e ela e' a da sessao do caixa.
    const codigo = (t: string) => t.replace(/--[^\n]*/g, "");
    assert.equal(contar(codigo(corpo(sql, fn)), "FOR SHARE"), 1, fn);
    assert.equal(contar(codigo(corpo(fonte, fn)), "FOR SHARE"), 0, fn);
  }
});

Deno.test("1663: a trava esta na leitura da sessao aberta, antes da escrita; a baixa trava o lancamento antes da sessao (a ordem do cancelar)", () => {
  const salvar = corpo(sql, "fin_lancamento_salvar");
  const iLeitura = salvar.indexOf(
    "SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s",
  );
  const iTrava = salvar.indexOf("LIMIT 1 FOR SHARE OF s;");
  // A trava fica na MESMA instrucao da leitura (o WHERE status = 'aberto' e' reavaliado depois da espera).
  assert.ok(iLeitura >= 0 && iTrava > iLeitura);
  assert.ok(!salvar.slice(iLeitura, iTrava).includes(";"));
  assert.ok(
    salvar.slice(iLeitura, iTrava).includes("WHERE s.status = 'aberto'"),
  );
  // Antes da reserva da tentativa e de qualquer INSERT de lancamento.
  assert.ok(iTrava < salvar.indexOf("ON CONFLICT (chave) DO NOTHING;"));
  assert.ok(iTrava < salvar.indexOf("INSERT INTO public.fin_lancamentos ("));
  assert.ok(iTrava < salvar.indexOf("UPDATE public.fin_lancamentos SET"));

  const baixar = corpo(sql, "fin_lancamento_baixar");
  const iLanc = baixar.indexOf(
    "SELECT * INTO v_l FROM public.fin_lancamentos WHERE id = p_id FOR UPDATE;",
  );
  const iLeituraB = baixar.indexOf(
    "SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s",
  );
  const iTravaB = baixar.indexOf("LIMIT 1 FOR SHARE OF s;");
  const iUpdate = baixar.indexOf("UPDATE public.fin_lancamentos");
  assert.ok(iLanc >= 0 && iLanc < iLeituraB && iLeituraB < iTravaB);
  assert.ok(!baixar.slice(iLeituraB, iTravaB).includes(";"));
  assert.ok(
    baixar.slice(iLeituraB, iTravaB).includes("WHERE s.status = 'aberto'"),
  );
  assert.ok(iTravaB < iUpdate);
  // O fechamento (corpo vivo da 1654, intocado aqui) trava a sessao FOR UPDATE antes de calcular o esperado: e' nisso que a
  // trava desta se apoia.
  const fechar = corpo(fonte, "fin_caixa_fechar_sessao");
  const iFecharTrava = fechar.indexOf(
    "SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE id = p_sessao_id FOR UPDATE;",
  );
  assert.ok(
    iFecharTrava >= 0 &&
      iFecharTrava < fechar.indexOf("public.fin__caixa_calculo(v_s.id)"),
  );
  assert.equal(definicao(sql, "fin_caixa_fechar_sessao"), "");
});

Deno.test("1663: sem BEGIN/COMMIT, LF, pre-voo antes de escrever, pos-voo com atributos; nada de ACL, tabela ou dado fora dos corpos; rollback tambem", () => {
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
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.despesa1663_' || esperado.nome)::jsonb",
    ),
  );
  assert.ok(sql.includes(")) <> 2 THEN"));
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  assert.ok(
    rb.includes(
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.despesa1663rb_' || esperado.nome)::jsonb",
    ),
  );
  assert.ok(rb.includes(")) <> 2 THEN"));
});

Deno.test("1663: db-apply exige as pecas, o inventario das sucessoras da 99 fecha e as antecessoras tiram esta antes de medir", () => {
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

  const posterior = ler(
    "tests/banco/a-despesa-nao-entra-no-caixa-fechado-posterior.cjs",
  );
  for (const { antes, depois } of FUNCOES) {
    assert.ok(posterior.includes(`"${antes}"`), antes);
    assert.ok(posterior.includes(`"${depois}"`), depois);
  }
  // A antecessora (1654) desfaz esta ANTES: no modulo "posterior" dela e na prova viva dela.
  // [arquivo, o primeiro trecho que ja mede a antecessora: a chamada tem de vir antes dele]
  for (const [arquivo, depoisDe] of [
    [
      "tests/banco/o-caixa-pertence-ao-dia-posterior.cjs",
      "  let noAr = false;\n",
    ],
    [
      "tests/banco/o-caixa-pertence-ao-dia-em-que-abriu-viva.cjs",
      "    const vivo = await hashes(c);",
    ],
  ]) {
    const texto = ler(arquivo);
    const iChamada = texto.indexOf(
      'require("./a-despesa-nao-entra-no-caixa-fechado-posterior.cjs").desfazerDespesaNoCaixaFechadoNaTransacao(',
    );
    const iMedida = texto.indexOf(depoisDe);
    assert.ok(iChamada >= 0 && iMedida > iChamada, arquivo);
  }
  // A prova 8e sai pela prova propria desta; a 17a lista as duas entradas.
  assert.ok(
    ler("tests/banco/portao-8e-aceita-sucessoras-viva.cjs").includes(
      `s.nome !== "${nome}" &&`,
    ),
  );
  const estoque = ler("tests/banco/estoque-do-painel-portao-viva.cjs");
  for (const assinatura of [
    "public.fin_lancamento_baixar(uuid,date,uuid)",
    "public.fin_lancamento_salvar(jsonb)",
  ])
    assert.ok(
      estoque.includes(`        "${nome}",\n        "${assinatura}",\n`),
      assinatura,
    );
  // A prova viva entra no job do dinheiro do rpc-ci, num clone proprio.
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/a-despesa-nao-entra-no-caixa-fechado-viva.cjs",
    ),
  );
});

Deno.test("1663: consultas 219a/219b so de catalogo, sete linhas fechadas, hashes certos, registros de publicacao e as antecessoras aceitam a sucessora", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, "antes" | "depois"]> = [
    ["219a-conferir-a-despesa-nao-entra-no-caixa-fechado-aplicado", "depois"],
    ["219b-antes-a-despesa-nao-entra-no-caixa-fechado-base-vigente", "antes"],
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
      /FROM public\.fin_(?:contas|lancamentos|caixa_sessoes|lancamento_tentativas)/,
    );
    assert.doesNotMatch(
      semComentario,
      /\b(?:fin_lancamento_salvar|fin_lancamento_baixar|fin_caixa_fechar_sessao)\s*\(/,
    );
    assert.doesNotMatch(
      semComentario,
      /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT|INTO|LOCK)\b/i,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 7);
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
    p.versoes.includes("20261663000000"),
  );
  assert.equal(entrada.length, 1);
  assert.deepEqual(entrada[0].versoes, ["20261663000000"]);
  assert.equal(entrada[0].consulta, consultas[0][0]);
  assert.equal(entrada[0].ausenciaConfirmadaPor, consultas[1][0]);
  for (const chave of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(chave in entrada[0]), chave);
  const ordem = canais.provasDeObjetos.map(
    (p: { consulta: string }) => p.consulta,
  );
  for (const anterior of [
    "49a-conferir-lancamento-idempotente-aplicado",
    "210a-conferir-o-caixa-pertence-ao-dia-em-que-abriu-aplicado",
  ])
    assert.ok(
      ordem.indexOf(anterior) >= 0 &&
        ordem.indexOf(anterior) < ordem.indexOf(consultas[0][0]),
      `o lote da 219a vem depois do da ${anterior}`,
    );

  // As antecessoras aceitam os corpos desta como SUCESSORA (senao reprovam em toda loja depois do apply), e nunca um corpo estranho.
  const [salvar, baixar] = FUNCOES;
  const c210a = ler(
    "scripts/publicacao/consultas/210a-conferir-o-caixa-pertence-ao-dia-em-que-abriu-aplicado.sql",
  );
  for (const f of [salvar, baixar])
    assert.ok(
      c210a.includes(
        `SELECT CASE WHEN h = '${f.depois}' THEN '${f.antes}' ELSE h END FROM fn WHERE nome = '${f.fn}'`,
      ),
      f.fn,
    );
  const c49a = ler(
    "scripts/publicacao/consultas/49a-conferir-lancamento-idempotente-aplicado.sql",
  );
  assert.ok(
    c49a.includes(
      `h IN ('1356dbfc037a9202ef163ba598854891', '${salvar.antes}', '${salvar.depois}')`,
    ),
  );
  const c8e = ler(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  for (const f of [salvar, baixar])
    assert.ok(
      c8e.includes(`('${f.fn}', '${f.depois}', '20261663000000')`),
      f.fn,
    );
});
