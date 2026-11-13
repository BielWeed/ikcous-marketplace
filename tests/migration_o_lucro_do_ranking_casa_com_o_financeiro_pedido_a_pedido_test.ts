// O LUCRO DO RANKING CASA COM O FINANCEIRO, PEDIDO A PEDIDO: prova offline do par 20261399995000 + rollback (lote 147). O COMPORTAMENTO (os 6 casos do dono de produto, cada cenario contra
// fin_dre, JSON igual ao do corpo anterior fora do lucro, mutantes, rollback, conexao sem BEGIN e consultas 147a/147b) e' provado em
// tests/banco/o-lucro-do-ranking-casa-com-o-financeiro-viva.cjs, que so roda no Postgres efemero do CI. Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261399995000_o_lucro_do_ranking_casa_com_o_financeiro_pedido_a_pedido.sql";
const nome3994 =
  "20261399994000_o_item_que_nao_veio_fica_com_a_cliente_no_ranking_de_lucro.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const definicao = (sql: string) => {
  const ini = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(",
  );
  if (ini < 0) return "";
  const fecho = "\n$$;";
  return sql.slice(ini, sql.indexOf(fecho, ini) + fecho.length);
};
const corpo = (sql: string) =>
  definicao(sql).split("AS $$")[1]?.slice(0, -3) ?? "";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const conta = (texto: string, trecho: string) => texto.split(trecho).length - 1;

const anterior = ler(`supabase/migrations/${nome3994}`);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const H = {
  antes: "de8648a7783c12f1be7abd7986c8a2fc",
  depois: "4f8fb94f6cb0018e10d0ef71541f1cbf",
};
const PAGAMENTO_NOVO = "'recebido_na_entrega', 'estornado')";

Deno.test("3995: os hashes das duas pontas batem com os corpos escritos; o rollback devolve o corpo da 3994 byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H.antes);
  assert.equal(md5(corpo(sql)), H.depois);
  assert.equal(definicao(rb), definicao(anterior));
  for (const texto of [sql, rb]) {
    assert.ok(
      texto.includes(
        `('public.get_admin_analytics_v2(integer)', '${H.antes}', '${H.depois}')`,
      ),
      "o pre-voo nao cita (assinatura, vigente, desta)",
    );
    assert.ok(
      texto.includes("AS esperado(assinatura, hash_vigente, hash_desta)"),
    );
    assert.ok(texto.includes("SET LOCAL lock_timeout = '5s';"));
    assert.ok(texto.includes("SET LOCAL statement_timeout = '30s';"));
    // Sem controle de transacao: o aplicador fornece a transacao inteira (AGENTS.md).
    assert.doesNotMatch(texto, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
    // Nenhum grant novo e nenhum objeto novo.
    assert.doesNotMatch(
      texto,
      /^\s*(GRANT|REVOKE|CREATE (TABLE|INDEX|POLICY|TRIGGER|SCHEMA))\b/im,
    );
    assert.ok(texto.includes("NOTIFY pgrst, 'reload schema';"));
    // A conferencia final fotografa OID, dono, ACL e atributos: o CREATE OR REPLACE so troca o texto.
    assert.ok(
      texto.includes("set_config('ikcous.rank3995_atributos'") &&
        texto.includes("current_setting('ikcous.rank3995_atributos')"),
    );
  }
  // O pos-voo da migration confere o hash NOVO e o do rollback o ANTIGO: um corpo trocado cai junto com a transacao.
  assert.ok(sql.includes(`IF v_hash IS DISTINCT FROM '${H.depois}' THEN`));
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${H.antes}' THEN`));
  // O pre-voo da migration recusa a loja que ainda esta na 3997: a 3994 vem antes.
  assert.ok(!sql.includes("0ea0841208f326971e4f92241929e088"));
  // A migration exige as colunas da conta do dinheiro; o rollback so restaura.
  assert.ok(sql.includes("('marketplace_orders', 'payment_status')"));
  assert.ok(sql.includes("('devolucoes', 'valor_frete_ida')"));
  assert.ok(!rb.includes("('marketplace_orders', 'payment_status')"));
});

Deno.test("3995: so os blocos 4 (grafico diario) e 5 (ranking) mudam; o resto do corpo e' o da 3994 byte a byte", () => {
  const novo = corpo(sql);
  const velho = corpo(anterior);
  const marca4 = "    -- 4. Revenue";
  const marca5b = "    -- 5b. Produtos vendidos";
  assert.equal(novo.split(marca4)[0], velho.split(marca4)[0]);
  assert.equal(
    novo.slice(novo.indexOf(marca5b)),
    velho.slice(velho.indexOf(marca5b)),
  );
  // Guardas, SECURITY DEFINER e search_path como na 3994.
  const def = definicao(sql);
  assert.match(
    def,
    /RETURNS json\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'/,
  );
  assert.equal(conta(def, "IF NOT public.is_admin() THEN"), 1);
  assert.equal(conta(def, "IF NOT public.is_admin_atual() THEN"), 1);
});

Deno.test("3995: a conta do dinheiro entra nos DOIS lugares (ranking e grafico), o pedido estornado entra e o faturamento nao muda", () => {
  const novo = corpo(sql);
  const velho = corpo(anterior);
  const cada = (trecho: string, vezes: number) =>
    assert.equal(conta(novo, trecho), vezes, trecho);
  // lucro = q x (pago - custo) + custo x reestocadas - dinheiro devolvido, nas duas copias
  cada(
    "pc.q * (pc.pago - COALESCE(oic.custo, p.custo)) + COALESCE(oic.custo, p.custo) * pc.reestocadas - pc.dinheiro_dev",
    2,
  );
  cada("- (pc.q * pc.pago - pc.dinheiro_dev) * COALESCE(s.taxa, 0)", 2);
  // o dinheiro cobre primeiro as pecas que voltaram, depois as 'Nao veio'; o excesso vai para o rateio do pedido
  cada("CASE WHEN x.vv > 0 THEN LEAST(m.pm, x.vv) / x.vv ELSE 0 END AS fv", 2);
  cada(
    "CASE WHEN x.va > 0 THEN LEAST(GREATEST(m.pm - x.vv, 0), x.va) / x.va ELSE 0 END AS fa",
    2,
  );
  cada("GREATEST(0, m.pm - x.vv - x.va) AS excesso", 2);
  // o frete de ida nao e dinheiro de produto; sem valor gravado (dado antigo) vale o das pecas que voltaram
  cada("GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))", 2);
  cada("AND dv.valor_reembolso IS NOT NULL", 2);
  // o dinheiro nunca passa do que o item pagou
  cada(
    "LEAST(oi.quantity * pg.pago, COALESCE(dv.dinheiro, 0)) AS dinheiro_dev",
    2,
  );
  // o estorno sem devolucao e o excesso se repartem pelo que cada item ainda pagou; pedido 'estornado' leva tudo
  cada("(t.residual + t.excesso)", 2);
  cada("CASE WHEN t.estornado THEN 1", 2);
  cada("so.payment_status = 'estornado' AS estornado", 2);
  // o pedido 'estornado' entra nos dois lugares: a lista de pagamento so existe em pecas e em sobra de cada bloco (a consulta final sai de pecas e nao repete o filtro)
  cada(PAGAMENTO_NOVO, 4);
  assert.equal(conta(velho, PAGAMENTO_NOVO), 0);
  // so o cancelado/devolvido continua fora
  assert.equal(conta(novo, "so.status NOT IN ('cancelled', 'returned')"), 2);
  // o pedido cancelado ou devolvido fica fora de pecas (de onde sai a consulta final) nas duas copias: a regra de status e' a de sempre
  const blocosPecas = novo
    .split("pecas AS MATERIALIZED (")
    .slice(1)
    .map((t) => t.slice(0, t.indexOf("sobra AS MATERIALIZED (")));
  assert.equal(blocosPecas.length, 2);
  for (const b of blocosPecas) {
    assert.ok(b.includes("o.status NOT IN ('cancelled', 'returned')"));
    assert.ok(b.includes(PAGAMENTO_NOVO));
  }
  // a linha de faturamento, a contagem de pedidos e a quantidade do ranking continuam como eram; o custo vendido do dia nao ganha o estornado
  const daily = (t: string) =>
    t.slice(t.indexOf("daily_orders AS ("), t.indexOf("daily_items AS ("));
  assert.ok(
    novo
      .slice(novo.indexOf("daily_orders AS ("))
      .startsWith(daily(velho).slice(0, daily(velho).indexOf("sobra AS ("))),
  );
  cada("FILTER (WHERE pc.pst <> 'estornado')", 1);
  cada("SUM(pc.q - pc.devolvidas)::int", 1);
  // DESEMPENHO (medido em base de 15 mil pedidos): a consulta final sai de pecas e NAO junta pecas de volta pelo item_id (a CTE nao tem estatistica: o planejador subestimava a juncao e
  // refazia o rateio por linha, 52 s contra 0,5 s); as CTEs usadas mais de uma vez ficam MATERIALIZED para o pior caso ser uma varredura e nao uma recontagem
  cada("FROM pecas pc", 2);
  assert.ok(!novo.includes("JOIN pecas pc ON pc.item_id"));
  cada("devs AS MATERIALIZED (", 2);
  cada("pecas AS MATERIALIZED (", 2);
  cada("sobra AS MATERIALIZED (", 2);
  // devolucao de reembolso ou vale; troca nunca entra
  cada("resolucao_final IN ('reembolso', 'vale')", 2);
  assert.ok(!novo.includes("'troca'"));
  // a excecao do 'Nao veio' usa IS DISTINCT FROM (a condicao nula, das devolucoes de antes da marcacao, continua contando): nunca "<>"
  assert.ok(!novo.includes("condicao <> 'ausente'"));
  assert.equal(conta(novo, "IS DISTINCT FROM 'ausente'"), 6);
  // nenhuma escrita
  assert.doesNotMatch(
    novo,
    /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i,
  );
  // a premissa antiga (por quantidade) nao esta mais no corpo
  assert.ok(!novo.includes("dev.perdidas"));
  assert.ok(!novo.includes("reembolso_sem_peca)"));
});

Deno.test("3995: consultas 147a/147b so de catalogo, quatro linhas fechadas, hashes certos e registros de publicacao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, string]> = [
    [
      "147a-conferir-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-aplicado",
      H.depois,
    ],
    [
      "147b-antes-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-base-vigente",
      H.antes,
    ],
  ];
  for (const [nomeConsulta, hash] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(hash));
    // Catalogo apenas: nenhuma le pedido, devolucao, estorno nem chama a funcao.
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:marketplace_orders|devolucoes|devolucao_itens|order_refunds)/,
    );
    assert.doesNotMatch(consulta, /get_admin_analytics_v2\(\d/);
    const itens = [...consulta.matchAll(/SELECT '([^']+)',/g)].map((m) => m[1]);
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
      conta(
        ler(".github/workflows/rpc-ci.yml"),
        `"scripts/publicacao/consultas/${nomeConsulta}.sql"`,
      ),
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
    p.versoes.includes("20261399995000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/o-lucro-do-ranking-casa-com-o-financeiro-viva.cjs",
    ),
  );
  // O aplicador confere os marcadores do corpo (db-apply) com as contagens que este arquivo conta.
  assert.ok(ler("scripts/db-apply.cjs").includes(`"${nome}":`));
});

Deno.test("3995: as consultas das antecessoras aceitam o corpo novo como sucessor", () => {
  // A 146a (da 3994) espera o corpo da 3994 e agora aceita tambem o da 3995 (normaliza ao esperado historico); a 147a/147b nao se aceitam entre si.
  const a146 = ler(
    "scripts/publicacao/consultas/146a-conferir-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-aplicado.sql",
  );
  assert.ok(a146.includes(`f.m IN ('${H.antes}', '${H.depois}')`));
  const a147b = ler(
    "scripts/publicacao/consultas/147b-antes-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-base-vigente.sql",
  );
  assert.ok(!a147b.includes(H.depois));
  for (const arq of [
    "135a-conferir-o-ranking-de-lucro-desconta-a-devolucao-aplicado",
    "35a-conferir-lucro-so-com-custo-aplicado",
    "45a-conferir-custo-do-dia-aplicado",
    "48a-conferir-lucro-com-desconto-aplicado",
    "53a-conferir-faturamento-potencial-aplicado",
    "54a-conferir-lucro-do-estoque-aplicado",
  ]) {
    const consulta = ler(`scripts/publicacao/consultas/${arq}.sql`);
    assert.ok(
      consulta.includes(`'${H.antes}', '${H.depois}')`),
      `${arq}: tem de aceitar o corpo da 3995 depois do da 3994`,
    );
  }
  assert.ok(
    ler(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
    ).includes(`('get_admin_analytics_v2', '${H.depois}', '20261399995000')`),
  );
  // A 17a aceita o sha256 do corpo novo (LF e CRLF), calculado do ARQUIVO.
  const corpoNovo = corpo(sql);
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const a17 = ler(
    "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
  );
  assert.ok(a17.includes(`'${sha(corpoNovo)}'`));
  assert.ok(a17.includes(`'${sha(corpoNovo.replace(/\n/g, "\r\n"))}'`));
});

Deno.test("3995: a migration esta na cadeia das sucessoras e a prova da 3994 desfaz esta primeiro", () => {
  const { SUCESSORAS_DA_99 } = require("./banco/sucessoras-da-99.cjs");
  const dela = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.equal(dela.length, 1);
  assert.equal(dela[0].hashVigente, H.antes);
  assert.equal(dela[0].hashDesta, H.depois);
  // A 3994 e' a antecessora direta: o hashDesta dela e' o hashVigente desta.
  const da3994 = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) => s.nome === nome3994,
  );
  assert.equal(da3994.length, 1);
  assert.equal(da3994[0].hashDesta, dela[0].hashVigente);
  const posterior = ler(
    "tests/banco/o-lucro-do-ranking-casa-com-o-financeiro-posterior.cjs",
  );
  assert.ok(
    posterior.includes("rollback-manual-${LUCRO_CASA_COM_O_FINANCEIRO.nome}"),
  );
  assert.ok(posterior.includes(H.depois));
  // A cadeia: o-item-que-nao-veio-posterior (3994) chama este modulo ANTES de desfazer a 3994.
  const item = ler(
    "tests/banco/o-item-que-nao-veio-fica-com-a-cliente-posterior.cjs",
  );
  const iChama = item.indexOf("desfazerLucroCasaComOFinanceiroNaTransacao");
  const iRollback3994 = item.indexOf("ITEM_NAO_VEIO_NO_LUCRO.noAr");
  assert.ok(iChama >= 0 && iChama < iRollback3994);
  // A prova viva da 3994 tambem a desfaz antes de medir a 3994 isolada.
  assert.ok(
    ler(
      "tests/banco/o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-viva.cjs",
    ).includes("await desfazerLucroCasa(c);"),
  );
});
