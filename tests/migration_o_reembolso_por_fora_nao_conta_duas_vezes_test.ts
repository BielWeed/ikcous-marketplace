// O REEMBOLSO POR FORA NAO CONTA DUAS VEZES: prova offline do par 20261664000000 + rollback. O COMPORTAMENTO (o caminho real
// falhou -> resolvido por fora -> aviso do MP, o Financeiro casando com o ranking de lucro pedido a pedido, o controle com o corpo
// anterior, os casos que nao mudam, mutantes, reaplicacao, pre-voo, rollback e consultas 220a/220b) e' provado em
// tests/banco/o-reembolso-por-fora-nao-conta-duas-vezes-viva.cjs, que so roda no Postgres efemero do CI. Aqui fica o que se prova
// so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261664000000_o_reembolso_por_fora_nao_conta_duas_vezes.sql";
const anterior =
  "20261391200000_o_financeiro_descreve_a_venda_do_balcao_como_o_app_mostra.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const lerBruto = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url));
const ler = (rel: string) => lerBruto(rel).replace(/\r/g, "");
const FN = "fin__movimentos";
const definicao = (sql: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`);
  if (ini < 0) return "";
  const fecho = "\n$$;";
  return sql.slice(ini, sql.indexOf(fecho, ini) + fecho.length);
};
const corpo = (sql: string) =>
  definicao(sql).split("AS $$")[1]?.slice(0, -3) ?? "";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const contar = (texto: string, trecho: string) =>
  texto.split(trecho).length - 1;

const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const fonte = ler(`supabase/migrations/${anterior}`);
const ANTES = "26473edd94ad6547d95de43433088304";
const DEPOIS = "04fc43fd9e3e7f4b44cb9e4c2a866ae3";

// As UNICAS trocas (corpo desta -> corpo da 20261391200000). Desfeitas na ordem, devolvem o corpo anterior byte a byte.
const TROCAS: Array<[string, string]> = [
  [
    "  ), por_fora AS (\n" +
      "    -- O reembolso de devolução resolvido POR FORA do app (20261664000000): a linha 'devolucao' abaixo\n" +
      "    -- já tira esse dinheiro. Se a lojista o devolveu pelo painel do Mercado Pago, o aviso do MP grava\n" +
      "    -- DEPOIS da conclusão da devolução uma linha 'sistema' concluída (registrar_estorno_externo_do_mp)\n" +
      "    -- com o MESMO dinheiro. A régua é a do ranking de lucro (get_admin_analytics_v2, 20261659000000,\n" +
      '    -- "já devolvi por fora"): por pedido, a soma desses reembolsos e a primeira conclusão.\n' +
      "    SELECT dvp.order_id, sum(dvp.valor_reembolso) AS valor,\n" +
      "           min(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde\n" +
      "      FROM public.devolucoes dvp\n" +
      "     WHERE dvp.status = 'concluida'\n" +
      "       AND dvp.resolucao_final = 'reembolso'\n" +
      "       AND dvp.valor_reembolso > 0\n" +
      "       AND dvp.refund_id IS NULL AND dvp.reembolso_manual\n" +
      "     GROUP BY dvp.order_id\n" +
      "  ), ja_coberto AS (\n" +
      "    -- Quanto de CADA linha 'sistema' concluída (fora de contestação) nascida depois dessa conclusão o\n" +
      "    -- reembolso por fora já contou: em ordem de chegada, as linhas consomem o valor por fora até ele\n" +
      "    -- acabar. A soma por pedido é LEAST(por fora, linhas 'sistema'), a mesma do ranking.\n" +
      "    SELECT sp.id, sp.order_id,\n" +
      "           LEAST(sp.amount, GREATEST(0, pf.valor - COALESCE(sum(sp.amount) OVER (\n" +
      "             PARTITION BY sp.order_id ORDER BY sp.created_at, sp.id\n" +
      "             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))) AS valor\n" +
      "      FROM public.order_refunds sp\n" +
      "      JOIN por_fora pf ON pf.order_id = sp.order_id\n" +
      "     WHERE sp.solicitado_por = 'sistema'\n" +
      "       AND sp.status = 'concluido' AND sp.concluido_em IS NOT NULL\n" +
      "       AND sp.mp_chargeback_id IS NULL\n" +
      "       AND sp.created_at >= pf.desde\n" +
      "  )\n  SELECT * FROM (\n",
    "  )\n  SELECT * FROM (\n",
  ],
  [
    "           -- Só o que o reembolso por fora NÃO contou (ja_coberto, 20261664000000): o dinheiro sai uma vez.\n" +
      "           (r.amount - COALESCE(jc.valor, 0))::numeric,\n",
    "           r.amount::numeric,\n",
  ],
  [
    "      LEFT JOIN ja_coberto jc ON jc.id = r.id\n" +
      "     WHERE ((r.status = 'concluido' AND r.concluido_em IS NOT NULL)\n" +
      "        OR r.status IN ('solicitado', 'em_processamento'))\n" +
      "       AND r.amount > COALESCE(jc.valor, 0)\n",
    "     WHERE (r.status = 'concluido' AND r.concluido_em IS NOT NULL)\n" +
      "        OR r.status IN ('solicitado', 'em_processamento')\n",
  ],
  [
    "        -- Menos o que a linha 'sistema' já contou deste reembolso por fora (20261664000000): o\n" +
      "        -- valor_estornado já soma essa linha; descontar o reembolso inteiro de novo tiraria o mesmo\n" +
      '        -- dinheiro duas vezes da saída "estornado fora do app".\n' +
      "        SELECT sum(d.valor_reembolso)\n" +
      "               - COALESCE((SELECT sum(jc.valor) FROM ja_coberto jc WHERE jc.order_id = v.id), 0) AS valor\n" +
      "          FROM public.devolucoes d\n",
    "        SELECT sum(d.valor_reembolso) AS valor FROM public.devolucoes d\n",
  ],
];

Deno.test("1664: os hashes das duas pontas batem com os corpos escritos; o rollback devolve o corpo da 1391200 byte a byte", () => {
  assert.equal(md5(corpo(fonte)), ANTES, "anterior");
  assert.equal(md5(corpo(sql)), DEPOIS, "desta");
  assert.equal(md5(corpo(rb)), ANTES, "rollback");
  assert.equal(definicao(rb), definicao(fonte), "rollback byte a byte");
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
});

Deno.test("1664: o corpo de partida e' o VIVO (a 1391200 e' a ultima que define fin__movimentos antes desta) e nenhuma outra a redefine depois", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort();
  const quem = fontes.filter(
    (n) => definicao(ler(`supabase/migrations/${n}`)) !== "",
  );
  assert.equal(quem.at(-1), nome);
  assert.equal(quem.at(-2), anterior);
});

Deno.test("1664: so as quatro trocas declaradas mudam; cabecalho (assinatura, SECURITY INVOKER, STABLE, search_path) igual", () => {
  const novo = definicao(sql);
  const velho = definicao(fonte);
  assert.equal(novo.split("AS $$")[0], velho.split("AS $$")[0]);
  let volta = novo;
  for (const [de, para] of TROCAS) {
    assert.equal(contar(volta, de), 1, de.slice(0, 60));
    volta = volta.replace(de, () => para);
  }
  assert.equal(volta, velho);
});

Deno.test("1664: a regra e' a do ranking (20261659000000) e nao mexe no que a 1b e o db-apply da 1391200 conferem", () => {
  const novo = corpo(sql);
  // A mesma escolha de devolucao por fora e de linha 'sistema' do ranking ("ja devolvi por fora", get_admin_analytics_v2).
  const ranking = ler(
    "supabase/migrations/20261659000000_a_peca_de_produto_excluido_fica_fora_e_o_vale_nao_e_dinheiro.sql",
  );
  for (const trecho of [
    "AND sp.solicitado_por = 'sistema'",
    "AND sp.status = 'concluido'",
    "AND sp.mp_chargeback_id IS NULL",
    "MIN(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde",
    "AND dvp.resolucao_final = 'reembolso'",
    "AND dvp.valor_reembolso > 0",
    "(dvp.refund_id IS NULL AND dvp.reembolso_manual)",
    "AND sp.created_at >= g.desde",
  ])
    assert.ok(ranking.includes(trecho), `ranking: ${trecho}`);
  assert.equal(
    contar(novo, "min(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde"),
    1,
  );
  assert.equal(
    contar(novo, "AND dvp.refund_id IS NULL AND dvp.reembolso_manual"),
    1,
  );
  assert.equal(contar(novo, "AND sp.created_at >= pf.desde"), 1);
  assert.equal(contar(novo, "AND sp.mp_chargeback_id IS NULL"), 1);
  // A linha 'devolucao' do Financeiro continua contando TODO reembolso manual concluido (por_fora e' um subconjunto dela:
  // nunca se desconta da linha do MP um dinheiro que o Financeiro nao mostrou).
  assert.equal(
    contar(
      novo,
      "WHERE d.status = 'concluida' AND d.reembolso_manual AND d.valor_reembolso > 0",
    ),
    1,
  );
  // Os marcadores que a 1b confere para a 20261177000000 seguem UMA vez cada.
  const c1b = ler("scripts/publicacao/consultas/1b-conferir-marcadores.sql");
  const marcadores = [
    ...c1b.matchAll(
      /\('20261177000000', 'fin__movimentos', \$marcador\$([\s\S]*?)\$marcador\$, (\d+)\)/g,
    ),
  ];
  assert.equal(marcadores.length, 2);
  for (const [, texto, vezes] of marcadores)
    assert.equal(contar(novo, texto), Number(vezes), texto);
  // E os do db-apply para a 20261391200000 (os textos do extrato).
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const daAnterior = new Map(Object.entries(VERIFICACOES)).get(anterior) as {
    esperado: Array<{ texto: string; vezes: number }>;
  };
  for (const { texto, vezes } of daAnterior.esperado)
    assert.equal(contar(novo, texto), vezes, texto);
});

Deno.test("1664: sem BEGIN/COMMIT, LF, pre-voo antes de escrever, pos-voo com atributos; nada de ACL, tabela ou dado fora do corpo; rollback tambem", () => {
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
    const semFuncao = texto
      .replace(definicao(texto), "")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      semFuncao,
      /\b(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|BEGIN;|COMMIT)\b/i,
    );
    const iLock = texto.indexOf("SET LOCAL lock_timeout = '5s';");
    assert.ok(iLock >= 0 && iLock < texto.indexOf("DO $preflight"));
    assert.ok(
      texto.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(
      texto.indexOf("DO $conferencia") > texto.indexOf("\n$$;"),
      "a conferencia vem depois do CREATE",
    );
    assert.ok(texto.includes(ANTES) && texto.includes(DEPOIS));
  }
  assert.ok(sql.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(
    sql.includes(
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.porfora1664_atributos')::jsonb",
    ),
  );
  assert.ok(sql.includes(`IF v_hash IS DISTINCT FROM '${DEPOIS}' THEN`));
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  assert.ok(
    rb.includes(
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.porfora1664rb_atributos')::jsonb",
    ),
  );
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${ANTES}' THEN`));
  // O pre-voo confere as colunas novas que o corpo le (uma funcao LANGUAGE sql e' validada ao ser criada).
  for (const coluna of [
    "('devolucoes', 'resolucao_final')",
    "('devolucoes', 'refund_id')",
    "('order_refunds', 'mp_chargeback_id')",
    "('order_refunds', 'created_at')",
  ])
    assert.ok(sql.includes(coluna), coluna);
});

Deno.test("1664: db-apply exige as pecas e o modulo posterior tira esta antes da prova viva da 1391200", () => {
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  const checagens = new Map(Object.entries(VERIFICACOES)).get(nome) as Array<{
    funcao: string;
    esperado: Array<{ texto: string; vezes?: number }>;
  }>;
  assert.deepEqual(
    checagens.map((c) => c.funcao),
    [FN],
  );
  const [c] = checagens;
  assert.equal(avaliarChecagem(corpo(sql), c).situacao, "verificada");
  assert.equal(avaliarChecagem(corpo(fonte), c).situacao, "falhou");
  for (const m of c.esperado)
    assert.equal(
      avaliarChecagem(corpo(sql).replace(m.texto, "XX"), c).situacao,
      "falhou",
      `o marcador "${m.texto.slice(0, 50)}" nao pega a regressao`,
    );

  const posterior = ler("tests/banco/o-reembolso-por-fora-posterior.cjs");
  assert.ok(
    posterior.includes(`"${ANTES}"`) && posterior.includes(`"${DEPOIS}"`),
  );
  assert.ok(posterior.includes(`"${nome}"`));
  const viva1391 = ler(
    "tests/banco/o-financeiro-descreve-a-venda-do-balcao-viva.cjs",
  );
  const iChamada = viva1391.indexOf(
    'require("./o-reembolso-por-fora-posterior.cjs").desfazerReembolsoPorForaNaTransacao(',
  );
  const iMedida = viva1391.indexOf("    const topo = await funcao(c);");
  assert.ok(iChamada >= 0 && iMedida > iChamada);
});

Deno.test("1664: consultas 220a/220b so de catalogo, quatro linhas fechadas, hashes certos, registros de publicacao e a 100a aceita a sucessora", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, string, string]> = [
    [
      "220a-conferir-o-reembolso-por-fora-nao-conta-duas-vezes-aplicado",
      DEPOIS,
      ANTES,
    ],
    [
      "220b-antes-o-reembolso-por-fora-nao-conta-duas-vezes-base-vigente",
      ANTES,
      DEPOIS,
    ],
  ];
  for (const [nomeConsulta, hash, outra] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hash}'`), nomeConsulta);
    assert.ok(!consulta.includes(outra), `${nomeConsulta}: outra ponta`);
    const semComentario = consulta
      .replace(/--[^\n]*/g, "")
      .replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(
      semComentario,
      /FROM public\.(?:marketplace_orders|order_refunds|devolucoes|fin_lancamentos)/,
    );
    assert.doesNotMatch(semComentario, /\bfin__movimentos\s*\(/);
    assert.doesNotMatch(
      semComentario,
      /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT|INTO|LOCK)\b/i,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(
      nomeConsulta,
    ) as string[];
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
    p.versoes.includes("20261664000000"),
  );
  assert.equal(entrada.length, 1);
  assert.deepEqual(entrada[0].versoes, ["20261664000000"]);
  assert.equal(entrada[0].consulta, consultas[0][0]);
  assert.equal(entrada[0].ausenciaConfirmadaPor, consultas[1][0]);
  for (const chave of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(chave in entrada[0]), chave);
  const ordem = canais.provasDeObjetos.map(
    (p: { consulta: string }) => p.consulta,
  );
  const i100a = ordem.indexOf(
    "100a-conferir-o-financeiro-descreve-a-venda-do-balcao-aplicado",
  );
  assert.ok(i100a >= 0 && i100a < ordem.indexOf(consultas[0][0]));
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/o-reembolso-por-fora-nao-conta-duas-vezes-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "o-reembolso-por-fora-nao-conta-duas-vezes-viva.cjs",
    ),
  );

  // A antecessora aceita o corpo desta como SUCESSORA (senao reprova em toda loja depois do apply), e nunca um corpo estranho.
  const c100a = ler(
    "scripts/publicacao/consultas/100a-conferir-o-financeiro-descreve-a-venda-do-balcao-aplicado.sql",
  );
  assert.ok(
    c100a.includes(
      `COALESCE((SELECT CASE WHEN h = '${DEPOIS}' THEN '${ANTES}' ELSE h END FROM fn), 'AUSENTE')`,
    ),
  );
  assert.ok(
    !ler(
      "scripts/publicacao/consultas/100b-antes-o-financeiro-descreve-a-venda-do-balcao-base-vigente.sql",
    ).includes(DEPOIS),
  );
});
