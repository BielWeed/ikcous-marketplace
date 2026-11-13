// O ITEM "NAO VEIO" FICA COM A CLIENTE NO RANKING DE LUCRO: prova offline do par 20261399994000 + rollback (lote 146). O COMPORTAMENTO (so o que voltou, reembolso cheio,
// parcial, frete, cupom, cortesia, vale/troca, danificada/usada/condicao nula, pedido de novo, grafico diario, JSON igual ao da 3997, mutantes, rollback,
// conexao sem BEGIN e consultas 146a/146b) e' provado em tests/banco/o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-viva.cjs, que so roda no Postgres efemero do CI.
// Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
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

const anterior = ler(
  "supabase/migrations/20261399970000_o_ranking_de_lucro_desconta_a_devolucao.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const H = {
  antes: "0ea0841208f326971e4f92241929e088",
  depois: "de8648a7783c12f1be7abd7986c8a2fc",
};
const FILTRO_NOVO =
  "FILTER (WHERE di.reestocado_em IS NULL AND di.condicao IS DISTINCT FROM 'ausente')";
const FILTRO_ANTIGO = "FILTER (WHERE di.reestocado_em IS NULL)";

Deno.test("3994: os hashes das duas pontas batem com os corpos escritos; o rollback devolve o corpo da 3997 byte a byte", () => {
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
      texto.includes("set_config('ikcous.rank3994_atributos'") &&
        texto.includes("current_setting('ikcous.rank3994_atributos')"),
    );
  }
  // O pos-voo da migration confere o hash NOVO e o do rollback o ANTIGO: um corpo trocado cai junto com a transacao.
  assert.ok(sql.includes(`IF v_hash IS DISTINCT FROM '${H.depois}' THEN`));
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${H.antes}' THEN`));
  // O rollback nao exige a coluna nova (so a migration usa condicao); a migration exige.
  assert.ok(sql.includes("('devolucao_itens', 'condicao')"));
  assert.ok(!rb.includes("('devolucao_itens', 'condicao')"));
});

Deno.test("3994: o Nao veio sai das devolvidas e das perdidas, o reembolso sem peca e o fator f entram nos DOIS lugares; o resto do corpo e' o da 3997 byte a byte", () => {
  const novo = corpo(sql);
  const velho = corpo(anterior);
  assert.equal(novo.split(FILTRO_NOVO).length - 1, 2);
  assert.equal(velho.split(FILTRO_ANTIGO).length - 1, 2);
  assert.equal(novo.split(FILTRO_ANTIGO).length - 1, 0);
  const lateralFr =
    /\n *LEFT JOIN LATERAL \(\n *SELECT CASE WHEN dv\.resolucao_final[\s\S]*?WHERE dx\.devolucao_id = dv\.id\) x\) fr ON true/g;
  assert.equal(novo.match(lateralFr)?.length, 2);
  // Desfazendo cada trecho novo (e os comentarios que o explicam), o corpo e' exatamente o da 3997.
  const devolvido = novo
    .split("\n")
    .filter(
      (l) =>
        !/^ *-- ('Nao veio' \(condicao|reembolso_sem_peca =|pecas 'Nao veio' de cada)/.test(
          l,
        ),
    )
    .join("\n")
    .replace(lateralFr, "")
    .split(" FILTER (WHERE rdi.condicao IS DISTINCT FROM 'ausente')")
    .join("")
    .split(
      "SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0))::int AS devolvidas",
    )
    .join("SUM(di.quantidade), 0))::int AS devolvidas")
    .split(FILTRO_NOVO)
    .join(FILTRO_ANTIGO)
    .replace(
      /::int AS perdidas,\n *LEAST\(oi\.quantity \* oi\.price, COALESCE\([^\n]*AS reembolso_sem_peca/g,
      "::int AS perdidas",
    )
    .replace(
      /(- dev\.perdidas \* COALESCE\(oic\.custo, p\.custo\))\n *- dev\.reembolso_sem_peca\)/g,
      "$1)",
    );
  assert.equal(devolvido, velho);
  // A excecao usa IS DISTINCT FROM (a condicao nula, das devolucoes de antes da marcacao, continua contando): nunca "<>".
  assert.ok(!novo.includes("condicao <> 'ausente'"));
  // O Nao veio nao conta como devolvida (quantidade e lucro do ranking, rateio da cortesia) nem como perdida.
  assert.equal(
    novo.split(
      "SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0))::int AS devolvidas",
    ).length - 1,
    2,
  );
  assert.equal(
    novo.split(
      "SUM(rdi.quantidade) FILTER (WHERE rdi.condicao IS DISTINCT FROM 'ausente')",
    ).length - 1,
    2,
  );
  // O dinheiro devolvido sem a peca: fator f de 0 a 1 (so reembolso, nunca negativo, frete de ida fora), teto do item vendido,
  // subtraido do lucro do ranking e do grafico diario.
  assert.equal(
    novo.split(
      "THEN LEAST(1, GREATEST(0, COALESCE(dv.valor_reembolso, 0) - x.vv - COALESCE(dv.valor_frete_ida, 0)) / x.va)",
    ).length - 1,
    2,
  );
  assert.equal(
    novo.split("dv.resolucao_final = 'reembolso' AND x.va > 0").length - 1,
    2,
  );
  assert.equal(
    novo.split(
      "LEAST(oi.quantity * oi.price, COALESCE(SUM(di.quantidade * di.valor_unitario * fr.f) FILTER (WHERE di.condicao = 'ausente'), 0)) AS reembolso_sem_peca",
    ).length - 1,
    2,
  );
  assert.equal(
    novo.split(
      "- dev.reembolso_sem_peca) FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit",
    ).length - 1,
    1,
  );
  assert.equal(novo.split("- dev.reembolso_sem_peca) as total").length - 1, 1);
  // Guardas, SECURITY DEFINER e search_path como na 3997.
  const def = definicao(sql);
  assert.match(
    def,
    /RETURNS json\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'/,
  );
  assert.equal(def.split("IF NOT public.is_admin() THEN").length - 1, 1);
  assert.equal(def.split("IF NOT public.is_admin_atual() THEN").length - 1, 1);
  assert.equal(
    def.split("resolucao_final IN ('reembolso', 'vale')").length - 1,
    4,
  );
  assert.equal(
    def.split("- dev.perdidas * COALESCE(oic.custo, p.custo)").length - 1,
    2,
  );
  // A premissa antiga (o Nao veio nunca saiu da loja) nao esta em lugar nenhum do arquivo.
  assert.doesNotMatch(sql, /nunca (saiu|chegou)|nao vira perda/i);
});

Deno.test("3994: consultas 146a/146b so de catalogo, quatro linhas fechadas, hashes certos e registros de publicacao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, string]> = [
    [
      "146a-conferir-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-aplicado",
      H.depois,
    ],
    [
      "146b-antes-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-base-vigente",
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
    p.versoes.includes("20261399994000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-viva.cjs",
    ),
  );
});

Deno.test("3994: a 135a (da 3997) e as consultas das antecessoras aceitam o corpo novo como sucessor", () => {
  // A 135a espera o corpo da 3997 e agora aceita tambem o da 3994 (normaliza ao esperado historico); a 146a/146b nao se aceitam entre si.
  const a135 = ler(
    "scripts/publicacao/consultas/135a-conferir-o-ranking-de-lucro-desconta-a-devolucao-aplicado.sql",
  );
  assert.ok(
    a135.includes(`f.m IN ('${H.antes}', '${H.depois}')`),
    "a 135a tem de aceitar o corpo da 3994 como sucessor",
  );
  for (const arq of [
    "35a-conferir-lucro-so-com-custo-aplicado",
    "45a-conferir-custo-do-dia-aplicado",
    "48a-conferir-lucro-com-desconto-aplicado",
    "53a-conferir-faturamento-potencial-aplicado",
    "54a-conferir-lucro-do-estoque-aplicado",
  ]) {
    const consulta = ler(`scripts/publicacao/consultas/${arq}.sql`);
    assert.ok(
      consulta.includes(`'${H.antes}', '${H.depois}')`),
      `${arq}: tem de aceitar o corpo da 3994 depois do da 3997`,
    );
  }
  assert.ok(
    ler(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
    ).includes(`('get_admin_analytics_v2', '${H.depois}', '20261399994000')`),
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

Deno.test("3994: a migration esta na cadeia das sucessoras e a prova da 3997 desfaz esta primeiro", () => {
  const { SUCESSORAS_DA_99 } = require("./banco/sucessoras-da-99.cjs");
  const dela = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.equal(dela.length, 1);
  assert.equal(dela[0].hashVigente, H.antes);
  assert.equal(dela[0].hashDesta, H.depois);
  // A 3997 e' a antecessora direta: o hashDesta dela e' o hashVigente desta.
  const da3997 = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) =>
      s.nome === "20261399970000_o_ranking_de_lucro_desconta_a_devolucao.sql",
  );
  assert.equal(da3997.length, 1);
  assert.equal(da3997[0].hashDesta, dela[0].hashVigente);
  const posterior = ler(
    "tests/banco/o-item-que-nao-veio-fica-com-a-cliente-posterior.cjs",
  );
  assert.ok(
    posterior.includes("rollback-manual-${ITEM_NAO_VEIO_NO_LUCRO.nome}"),
  );
  assert.ok(posterior.includes(H.depois));
  // A cadeia: o-ranking-de-lucro-posterior (3997) chama este modulo ANTES de desfazer a 3997.
  const ranking = ler("tests/banco/o-ranking-de-lucro-posterior.cjs");
  const iChama = ranking.indexOf("desfazerItemQueNaoVeioNoLucroNaTransacao");
  const iRollback3997 = ranking.indexOf("RANKING_DE_LUCRO.noAr");
  assert.ok(iChama >= 0 && iChama < iRollback3997);
  // A prova viva da 3997 tambem a desfaz antes de medir a 3997 isolada.
  assert.ok(
    ler(
      "tests/banco/o-ranking-de-lucro-desconta-a-devolucao-viva.cjs",
    ).includes("await desfazerItemQueNaoVeio(c);"),
  );
});
