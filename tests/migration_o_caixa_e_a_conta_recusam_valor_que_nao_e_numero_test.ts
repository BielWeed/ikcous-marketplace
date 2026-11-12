// O CAIXA E A CONTA RECUSAM VALOR QUE NAO E NUMERO: prova offline do par 20261399930000 + rollback (onda 150, lote E). O COMPORTAMENTO (NaN, infinito,
// acima do teto, dado antigo, permissao antes da guarda, reaplicacao, pre-voo, rollback e consultas 128a/128b) e' provado em
// tests/banco/o-caixa-e-a-conta-recusam-nan-viva.cjs, que so roda no Postgres efemero do CI. Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261399930000_o_caixa_e_a_conta_recusam_valor_que_nao_e_numero.sql";
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

const anteriorAbrir = ler(
  "supabase/migrations/20261370000000_o_caixa_abre_so_na_conta_da_loja.sql",
);
const anteriorConta = ler(
  "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

const H = {
  abrirAntes: "28ab512e291378a01d110e298af7a402",
  abrirDepois: "367d298dcc78bc2829fc4e0048005a0c",
  contaAntes: "2f9b720cb3804edba4879595b0d6fe1d",
  contaDepois: "1dc6cfdb075e3a1a0882398e1220d0f1",
};
const GUARDA_ABRIR = `  IF p_valor_abertura = 'NaN'::numeric OR abs(p_valor_abertura) > 9999999999.99 THEN
    RAISE EXCEPTION 'Informe quanto dinheiro há no caixa (pode ser zero).' USING ERRCODE = '22023';
  END IF;
`;
const GUARDA_CONTA = `  IF p ? 'saldo_inicial'
     AND ((p ->> 'saldo_inicial')::numeric = 'NaN'::numeric
          OR abs((p ->> 'saldo_inicial')::numeric) > 9999999999.99) THEN
    RAISE EXCEPTION 'Informe o saldo inicial como um número válido.' USING ERRCODE = '22023';
  END IF;
`;
// Tira o bloco de comentario da guarda: a linha que abre com "-- NaN, infinito" e as linhas "  --" que a seguem.
const comentariosDaGuarda = (txt: string) => {
  const saida: string[] = [];
  let dentro = false;
  for (const linha of txt.split("\n")) {
    if (linha.startsWith("  -- NaN, infinito")) dentro = true;
    else if (!linha.startsWith("  --")) dentro = false;
    if (!dentro) saida.push(linha);
  }
  return saida.join("\n");
};

Deno.test("3999300: os hashes das quatro pontas batem com os corpos escritos; o rollback devolve os dois corpos byte a byte", () => {
  assert.equal(md5(corpo(anteriorAbrir, "fin_caixa_abrir")), H.abrirAntes);
  assert.equal(md5(corpo(sql, "fin_caixa_abrir")), H.abrirDepois);
  assert.equal(md5(corpo(anteriorConta, "fin_conta_salvar")), H.contaAntes);
  assert.equal(md5(corpo(sql, "fin_conta_salvar")), H.contaDepois);
  assert.equal(
    definicao(rb, "fin_caixa_abrir"),
    definicao(anteriorAbrir, "fin_caixa_abrir"),
  );
  assert.equal(
    definicao(rb, "fin_conta_salvar"),
    definicao(anteriorConta, "fin_conta_salvar"),
  );
  assert.equal(md5(corpo(rb, "fin_caixa_abrir")), H.abrirAntes);
  assert.equal(md5(corpo(rb, "fin_conta_salvar")), H.contaAntes);
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 2);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 2);
});

Deno.test("3999300: so a guarda nova (e a atribuicao do v_valor depois dela) muda nos corpos; assinatura e atributos iguais", () => {
  const novoAbrir = definicao(sql, "fin_caixa_abrir");
  const velhoAbrir = definicao(anteriorAbrir, "fin_caixa_abrir");
  // O cabecalho (assinatura, SECURITY DEFINER, search_path) e' o mesmo.
  assert.equal(novoAbrir.split("AS $$")[0], velhoAbrir.split("AS $$")[0]);
  assert.equal(
    definicao(sql, "fin_conta_salvar").split("AS $$")[0],
    definicao(anteriorConta, "fin_conta_salvar").split("AS $$")[0],
  );
  // fin_caixa_abrir: tirando a guarda e devolvendo o inicializador do DECLARE, sobra o corpo anterior EXATO.
  const volta = comentariosDaGuarda(novoAbrir)
    .replace(GUARDA_ABRIR, "")
    .replace("  v_valor := round(p_valor_abertura, 2);\n", "")
    .replace(
      "  v_valor numeric(12, 2);\n",
      "  v_valor numeric(12, 2) := round(p_valor_abertura, 2);\n",
    );
  assert.equal(volta, velhoAbrir);
  // fin_conta_salvar: tirando a guarda (e seu comentario), sobra o corpo anterior EXATO.
  assert.equal(
    comentariosDaGuarda(definicao(sql, "fin_conta_salvar")).replace(
      GUARDA_CONTA,
      "",
    ),
    definicao(anteriorConta, "fin_conta_salvar"),
  );
});

Deno.test("3999300: a guarda vem depois das duas portas de admin e ANTES do cast e de qualquer escrita, nas duas funcoes", () => {
  const abrir = corpo(sql, "fin_caixa_abrir");
  const iGuarda = abrir.indexOf(GUARDA_ABRIR);
  assert.ok(iGuarda > 0);
  assert.ok(abrir.indexOf("public.is_admin_atual()") < iGuarda);
  assert.ok(iGuarda < abrir.indexOf("v_valor := round(p_valor_abertura, 2);"));
  assert.ok(iGuarda < abrir.indexOf("FOR UPDATE"));
  assert.ok(iGuarda < abrir.indexOf("INSERT INTO"));
  // O inicializador do DECLARE rodava ANTES de qualquer IF: o infinito caia em 22003. Nao pode voltar.
  assert.doesNotMatch(abrir, /v_valor numeric\(12, 2\) :=/);

  const conta = corpo(sql, "fin_conta_salvar");
  const iConta = conta.indexOf(GUARDA_CONTA);
  assert.ok(iConta > 0);
  assert.ok(conta.indexOf("public.is_admin_atual()") < iConta);
  assert.ok(iConta < conta.indexOf("INSERT INTO"));
  assert.ok(iConta < conta.indexOf("FOR UPDATE"));
  assert.ok(iConta < conta.indexOf("UPDATE public.fin_contas SET"));
  // Saldo NEGATIVO segue valido: a guarda nao compara com zero.
  assert.doesNotMatch(GUARDA_CONTA, /< 0/);
});

Deno.test("3999300: sem BEGIN/COMMIT, pre-voo antes de escrever, pos-voo com atributos; nada de ACL, tabela ou dado fora dos corpos; rollback tambem", () => {
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
    const semFuncoes = texto
      .replace(definicao(texto, "fin_caixa_abrir"), "")
      .replace(definicao(texto, "fin_conta_salvar"), "")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      semFuncoes,
      /\b(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|BEGIN;|COMMIT)\b/i,
    );
    assert.ok(
      semFuncoes.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(
      texto.includes(
        "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.nan399930_' || esperado.nome)::jsonb",
      ),
    );
    // Os quatro hashes citados, nas duas pontas de cada funcao.
    for (const h of Object.values(H)) assert.ok(texto.includes(h), h);
  }
  assert.ok(sql.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
});

Deno.test("3999300: db-apply exige as guardas, as funcoes vigentes sao estas e o inventario das sucessoras da 99 fecha", () => {
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagens = VERIFICACOES[nome] as Array<{
    funcao: string;
    esperado: Array<{ texto: string }>;
  }>;
  assert.deepEqual(
    checagens.map((c) => c.funcao),
    ["fin_caixa_abrir", "fin_conta_salvar"],
  );
  for (const c of checagens) {
    const corpoVivo = corpo(sql, c.funcao);
    assert.equal(avaliarChecagem(corpoVivo, c).situacao, "verificada");
    // O corpo ANTERIOR reprova (sem a guarda a verificacao nao passa) e cada marcador que some tira a verificacao do ar.
    assert.equal(
      avaliarChecagem(
        corpo(
          c.funcao === "fin_caixa_abrir" ? anteriorAbrir : anteriorConta,
          c.funcao,
        ),
        c,
      ).situacao,
      "falhou",
    );
    for (const m of c.esperado)
      assert.equal(
        avaliarChecagem(corpoVivo.replace(m.texto, "XX"), c).situacao,
        "falhou",
        `o marcador "${m.texto.slice(0, 50)}" nao pega a regressao`,
      );
  }
  // A verificacao da 20261370000000 segue de pe com o corpo novo: nada do que ela cobra foi tirado.
  const da370 =
    VERIFICACOES["20261370000000_o_caixa_abre_so_na_conta_da_loja.sql"];
  assert.equal(
    avaliarChecagem(corpo(sql, "fin_caixa_abrir"), da370).situacao,
    "verificada",
  );

  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort();
  const quem = (fn: string) =>
    fontes.filter((n) => definicao(ler(`supabase/migrations/${n}`), fn));
  assert.equal(quem("fin_caixa_abrir").at(-1), nome);
  assert.equal(quem("fin_conta_salvar").at(-1), nome);

  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  const doAbrir = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.ok(doAbrir.length >= 1, "a migration nao esta nas sucessoras da 99");
  const porFuncao = new Map(
    doAbrir.map((s: { funcao?: string; hashDesta: string }) => [
      s.hashDesta,
      s,
    ]),
  );
  assert.ok(porFuncao.has(H.abrirDepois));
  assert.ok(porFuncao.has(H.contaDepois));
});

Deno.test("3999300: consultas 128a/128b so de catalogo, sete linhas fechadas, hashes certos e registros de publicacao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, string, string]> = [
    [
      "128a-conferir-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-aplicado",
      H.abrirDepois,
      H.contaDepois,
    ],
    [
      "128b-antes-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-base-vigente",
      H.abrirAntes,
      H.contaAntes,
    ],
  ];
  for (const [nomeConsulta, hAbrir, hConta] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(hAbrir));
    assert.ok(consulta.includes(hConta));
    assert.doesNotMatch(
      consulta,
      /FROM public\.fin_(?:contas|lancamentos|caixa_sessoes)/,
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
  const entrada = JSON.parse(
    ler("scripts/frota/canais-de-backend.json"),
  ).provasDeObjetos.find((p: { versoes: string[] }) =>
    p.versoes.includes("20261399930000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  const workflow = ler(".github/workflows/rpc-ci.yml");
  for (const prova of [
    "tests/banco/o-caixa-e-a-conta-recusam-nan-viva.cjs",
    "tests/banco/o-balcao-recusa-venda-sem-item-e-com-itens-demais-viva.cjs",
  ])
    assert.ok(workflow.includes(`rodar-isolado.cjs ${prova}`), prova);
});
