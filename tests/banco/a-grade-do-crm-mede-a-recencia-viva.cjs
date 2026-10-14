"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste ou do catálogo do
 * Postgres efêmero; nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA da migration 20261232000000_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista.sql
 * (public.crm_visao) contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * O DEFEITO: a grade de segmentos do CRM (crm_visao) e a lista de clientes (crm_clientes) contam
 * quantos dias faz que cada cliente comprou. A lista mede até AGORA (now()); a grade media até a
 * MEIA-NOITE DE AMANHÃ ((p_fim + 1) à 00:00 de São Paulo). Com o período terminando hoje, a grade via
 * cada cliente 1 dia mais velho: quem comprou há 30 dias estava em "Novos" na lista e em "Promissores"
 * na grade (e o mesmo nas viradas de 60 e de 120 dias). Medido em Postgres descartável: lista
 * {novos 2, hibernando 4} x grade {novos 1, hibernando 5}.
 *
 * A CORREÇÃO: v_fim_ts := LEAST(<meia-noite de amanhã>, now()). Um instante só para as quatro chamadas
 * (crm__vendas, crm__clientes_rfm, crm__pedidos_nao_pagos, crm__nunca_comprou).
 *
 * O QUE ESTA PROVA FIXA:
 *   (1a) cada VIRADA (29/30/31, 59/60/61, 119/120/121, 239/240/241 dias): a grade põe o cliente no MESMO
 *        segmento da lista, e no segmento certo da regra (Novos até 30, Promissores até 60, Quase
 *        dormindo até 120, Hibernando depois);
 *   (1b) o CONJUNTO das 12 compras: a grade conta {novos 2, promissores 3, quase_dormindo 3,
 *        hibernando 4}, igual à lista (antes: novos 1, hibernando 5);
 *   (1c) a virada de 240 dias: o ajudante de nota (crm__clientes_rfm) muda de 2 para 1 conforme a âncora,
 *        mas a GRADE não a mostra (r = 2 e r = 1 caem no mesmo segmento): dito, não escondido;
 *   (1d) as OUTRAS TRÊS chamadas recebem o mesmo instante: uma venda paga, um pedido não pago e um perfil
 *        sem compra com data DEPOIS de agora (relógio adiantado de gateway) não entram na grade, igual à
 *        lista; e o que é de AGORA (e de uma hora atrás) entra;
 *   (2a) período que NÃO termina hoje: o JSON é IDÊNTICO ao do corpo antigo, em 4 períodos; período que
 *        termina hoje: só `segmentos` e `kpis.receita_em_risco` (que dependem da nota de recência) mudam;
 *   (2b) período que termina no futuro: mede até agora (os segmentos são os do período que termina hoje);
 *   (3)  CONTROLE: o corpo ANTIGO (o rollback-manual aplicado numa transação desfeita) reprova (1a), (1b)
 *        e (1d); e (3b) MUTANTES: sem o LEAST, GREATEST no lugar de LEAST, âncora de ontem, now() fixo,
 *        corte no começo do dia, e cada uma das quatro chamadas com a âncora antiga, cada um deixa a
 *        prova correspondente vermelha;
 *   (4a) a porta (comum, admin rebaixado e visitante recusados; anon/PUBLIC sem EXECUTE); (4b) o formato
 *        do JSON, a ACL, os atributos e o dono são os do corpo antigo, e nenhuma linha muda; (4c) reaplicar
 *        2x é o mesmo que 1x, e desfazer e aplicar volta idêntico; (4d) pré-voo: corpo divergente, ACL
 *        aberta, atributo trocado, função que o corpo chama ausente recusam SEM escrever, e um erro no
 *        meio da troca não deixa nada; (4e) concorrência: leitura nunca enxerga estado misto, e dois
 *        aplicadores ao mesmo tempo deixam um estado só;
 *   (5)  O RESTO DO CORPO NÃO MUDOU: o corpo novo é o do rollback-manual com UMA linha trocada, byte a byte.
 *
 * Toda prova que mexe em corpo de função roda numa transação DESFEITA no fim (exceto a concorrência, que
 * confirma no clone descartável e devolve o estado). GRADE_SO=comportamento roda só (1a) a (1d): usado
 * para ver o VERMELHO do corpo vigente antes de a migration existir; GRADE_TODAS=1 não para na primeira
 * que falhar.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-grade-do-crm-mede-a-recencia-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
const NOME =
  "20261232000000_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista.sql";
const NOME_27 = "20261227000000_o_crm_compara_o_que_e_comparavel.sql";
const SO_COMPORTAMENTO = process.env.GRADE_SO === "comportamento";

const CRM = "public.crm_visao(date,date)";

const ANCORA_VELHA =
  "((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')";
const LINHA_VELHA = `v_fim_ts := ${ANCORA_VELHA};`;
const LINHA_NOVA = `v_fim_ts := LEAST(${ANCORA_VELHA}, now());`;

const U_ADMIN = "d3d30000-0000-4000-8000-000000000001";
const U_COMUM = "d3d30000-0000-4000-8000-000000000002";

// Os dias desde a última compra de cada cliente do cenário: as viradas de 30, 60, 120 e 240 dias
// (um dia antes, no dia e um dia depois de cada uma).
const DIAS = [29, 30, 31, 59, 60, 61, 119, 120, 121, 239, 240, 241];
const NAO_RFM = ["pediu_nao_pagou", "nunca_comprou"];

/** O segmento que a REGRA do CRM dá a quem comprou uma vez, `d` dias atrás (1 compra, ticket igual). */
const segmentoEsperado = (d) =>
  d <= 30
    ? "novos"
    : d <= 60
      ? "promissores"
      : d <= 120
        ? "quase_dormindo"
        : "hibernando";

async function logar(c, uid) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [uid]);
}

async function hoje(c) {
  return (await c.query("SELECT public.fin__hoje()::text AS d")).rows[0].d;
}

async function catalogo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, prosrc, prosecdef,
            coalesce(array_to_string(proconfig, ','), '') AS proconfig,
            coalesce(proacl::text, '') AS proacl, provolatile::text AS volatil,
            proowner::regrole::text AS dono
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

/** Os caminhos de chave de um JSON (formato), sem os valores. */
function formato(v, prefixo = "") {
  if (Array.isArray(v))
    return v.length ? formato(v[0], `${prefixo}[]`) : [`${prefixo}[]`];
  if (v && typeof v === "object")
    return Object.keys(v)
      .sort()
      .flatMap((k) => formato(v[k], `${prefixo}.${k}`));
  return [prefixo];
}

// ---- fixtures (sempre DENTRO de uma transação desfeita: now() é o mesmo instante nas duas funções)

async function semearAdmin(c, { comum = false } = {}) {
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin@grade.teste', '{\"role\":\"admin\"}'::jsonb)",
    [U_ADMIN],
  );
  // 20261199000000 (admin ATUAL): o painel exige o papel admin AGORA em auth.users E em profiles.
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Grade', 'admin')",
    [U_ADMIN],
  );
  if (comum) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'comum@grade.teste', '{}'::jsonb)",
      [U_COMUM],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente Comum', 'customer')",
      [U_COMUM],
    );
  }
}

let contador = 0;

/** Venda PAGA de um cliente sem conta (chave = o WhatsApp). `quando` é um intervalo ('30 days', '-2 hours'). */
async function venda(c, { nome, quando, total = 100, zap }) {
  contador += 1;
  await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES (NULL, $1, $2::jsonb, $3, $3, 'delivered', 'online', 'online', 'pago',
             now() - $4::interval, now() - $4::interval)`,
    [
      nome,
      JSON.stringify({
        whatsapp: zap || `(34) 9${String(2000 + contador)}-1111`,
        email: `c${contador}@grade.teste`,
      }),
      total,
      quando,
    ],
  );
}

/** Pedido NÃO pago (aguardando), de alguém que nunca pagou nada. */
async function pedidoNaoPago(c, { nome, quando, total = 50 }) {
  contador += 1;
  await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, created_at)
     VALUES (NULL, $1, $2::jsonb, $3, $3, 'pending', 'online', 'online', 'aguardando',
             now() - $4::interval)`,
    [
      nome,
      JSON.stringify({
        whatsapp: `(34) 9${String(3000 + contador)}-2222`,
        email: `np${contador}@grade.teste`,
      }),
      total,
      quando,
    ],
  );
}

/** Perfil de cliente que se cadastrou e nunca comprou. */
async function perfilSemCompra(c, { nome, quando }) {
  contador += 1;
  const r = await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES (gen_random_uuid(), $1, '{}'::jsonb) RETURNING id`,
    [`sem${contador}@grade.teste`],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role, created_at)
     VALUES ($1, $2, 'customer', now() - $3::interval)`,
    [r.rows[0].id, nome, quando],
  );
}

async function semearViradas(c) {
  for (const d of DIAS)
    await venda(c, {
      nome: `Grade ${String(d).padStart(3, "0")}d`,
      quando: `${d} days`,
    });
}

/** A LISTA (crm_clientes, âncora now()): { nome -> { segmento, r, dias } } dos clientes `Grade ...`. */
async function lista(c) {
  await logar(c, U_ADMIN);
  const r = await c.query(
    "SELECT public.crm_clientes(NULL, NULL, 200, 0) AS r",
  );
  const porNome = {};
  const porSegmento = {};
  for (const l of r.rows[0].r.clientes) {
    porSegmento[l.segmento] = (porSegmento[l.segmento] || 0) + 1;
    if (l.nome?.startsWith("Grade "))
      porNome[l.nome] = {
        segmento: l.segmento,
        r: l.r,
        dias: l.dias_sem_comprar,
      };
  }
  return { porNome, porSegmento };
}

/** A GRADE (crm_visao): o JSON inteiro e a contagem por segmento. */
async function grade(c, pfim, tamanho = 30) {
  await logar(c, U_ADMIN);
  const r = await c.query(
    "SELECT public.crm_visao(($1::date - ($2::int - 1)), $1::date) AS r",
    [pfim, tamanho],
  );
  const bruto = r.rows[0].r;
  const porSegmento = {};
  for (const s of bruto.segmentos)
    if (Number(s.clientes) > 0) porSegmento[s.segmento] = Number(s.clientes);
  return { bruto, porSegmento };
}

/** Só os segmentos de COMPRADORES (tira "pediu_nao_pagou" e "nunca_comprou", que não vêm da nota de recência). */
const soRfm = (porSegmento) =>
  Object.fromEntries(
    Object.entries(porSegmento).filter(([k]) => !NAO_RFM.includes(k)),
  );

const PROVAS = [];
const fx = {};

// ---- as provas do comportamento: cada uma monta o próprio cenário (dentro de uma transação desfeita)
const prova1a = async (c) => {
  await semearAdmin(c);
  for (const d of DIAS) {
    await c.query("SAVEPOINT virada");
    await venda(c, {
      nome: `Grade ${String(d).padStart(3, "0")}d`,
      quando: `${d} days`,
    });
    const l = await lista(c);
    const g = await grade(c, await hoje(c));
    const nome = `Grade ${String(d).padStart(3, "0")}d`;
    // o que a lista (âncora now()) diz é a verdade: dias = d, e o segmento é o da regra
    assert.equal(l.porNome[nome].dias, d, `lista: dias de ${nome}`);
    assert.equal(
      l.porNome[nome].segmento,
      segmentoEsperado(d),
      `lista: segmento de ${nome}`,
    );
    // a grade tem de contar o MESMO cliente no MESMO segmento
    assert.deepEqual(
      soRfm(g.porSegmento),
      { [segmentoEsperado(d)]: 1 },
      `virada de ${d} dias: a lista põe o cliente em "${segmentoEsperado(d)}" e a grade contou ${JSON.stringify(soRfm(g.porSegmento))}`,
    );
    await c.query("ROLLBACK TO SAVEPOINT virada");
  }
};

const prova1b = async (c) => {
  await semearAdmin(c);
  await semearViradas(c);
  const l = await lista(c);
  const g = await grade(c, await hoje(c));
  const esperado = {};
  for (const d of DIAS)
    esperado[segmentoEsperado(d)] = (esperado[segmentoEsperado(d)] || 0) + 1;
  assert.deepEqual(
    esperado,
    { novos: 2, promissores: 3, quase_dormindo: 3, hibernando: 4 },
    "a conta do cenário",
  );
  assert.deepEqual(soRfm(l.porSegmento), esperado, "a lista segue a regra");
  assert.deepEqual(
    soRfm(g.porSegmento),
    soRfm(l.porSegmento),
    `a grade tem de contar o mesmo que a lista: lista ${JSON.stringify(soRfm(l.porSegmento))} x grade ${JSON.stringify(soRfm(g.porSegmento))}`,
  );
};

const prova1c = async (c) => {
  await semearAdmin(c);
  for (const d of [239, 240, 241])
    await venda(c, { nome: `Grade ${d}d`, quando: `${d} days` });
  const nome = "Grade 240d";
  const l = await lista(c);
  assert.equal(l.porNome[nome].r, 2, "lista: 240 dias ainda é nota 2");
  assert.equal(l.porNome["Grade 241d"].r, 1, "lista: 241 dias é nota 1");
  // o ajudante muda de nota conforme a âncora (é por isso que a âncora importa)...
  const nota = async (ancora) =>
    (
      await c.query(
        `SELECT r FROM public.crm__clientes_rfm(${ancora}) WHERE nome = $1`,
        [nome],
      )
    ).rows[0].r;
  assert.equal(await nota("now()"), 2);
  assert.equal(
    await nota(ANCORA_VELHA.replace("p_fim + 1", "public.fin__hoje() + 1")),
    1,
  );
  // ... mas a GRADE não mostra essa diferença: nota 2 e nota 1 caem no MESMO segmento ("hibernando"),
  // nos dois corpos. Por isso a virada de 240 dias não é uma das que a correção conserta.
  const g = await grade(c, await hoje(c));
  assert.deepEqual(soRfm(g.porSegmento), { hibernando: 3 });
};

const prova1d = async (c) => {
  await semearAdmin(c);
  // o que é de AGORA e de uma hora atrás ENTRA (controle de que o instante não corta dado de verdade)
  await venda(c, { nome: "Grade agora", quando: "0 seconds", total: 40 });
  await venda(c, { nome: "Grade uma hora", quando: "1 hour", total: 60 });
  await pedidoNaoPago(c, { nome: "Pediu uma hora", quando: "1 hour" });
  await perfilSemCompra(c, { nome: "Sem compra uma hora", quando: "1 hour" });
  // o que tem data DEPOIS de agora (relógio adiantado) NÃO entra: nem na lista, nem na grade
  await venda(c, { nome: "Grade futuro", quando: "-2 hours", total: 77 });
  await pedidoNaoPago(c, { nome: "Pediu no futuro", quando: "-2 hours" });
  await perfilSemCompra(c, { nome: "Sem compra futuro", quando: "-2 hours" });

  const l = await lista(c);
  const g = await grade(c, await hoje(c));
  // a lista (âncora now()): 2 compradores, 1 pediu e não pagou, 1 nunca comprou
  assert.equal(l.porSegmento.pediu_nao_pagou, 1, "lista: pediu_nao_pagou");
  assert.equal(l.porSegmento.nunca_comprou, 1, "lista: nunca_comprou");
  assert.equal(
    Object.values(soRfm(l.porSegmento)).reduce((a, b) => a + b, 0),
    2,
    `lista: compradores ${JSON.stringify(l.porSegmento)}`,
  );
  // a grade tem de contar o MESMO, nas quatro chamadas
  assert.equal(
    g.porSegmento.pediu_nao_pagou,
    1,
    "grade: pediu_nao_pagou (crm__pedidos_nao_pagos com a âncora de agora)",
  );
  assert.equal(
    g.porSegmento.nunca_comprou,
    1,
    "grade: nunca_comprou (crm__nunca_comprou com a âncora de agora)",
  );
  assert.deepEqual(
    soRfm(g.porSegmento),
    soRfm(l.porSegmento),
    "grade: compradores (crm__clientes_rfm com a âncora de agora)",
  );
  // e as vendas do período (crm__vendas): só as de agora e de uma hora atrás, nunca a de daqui a 2 horas
  assert.equal(
    Number(g.bruto.kpis.pedidos),
    2,
    "grade: pedidos do período (crm__vendas)",
  );
  assert.equal(
    Number(g.bruto.kpis.receita),
    100,
    "grade: receita do período (crm__vendas)",
  );
};

PROVAS.push({
  nome: "(1a) cada VIRADA (29/30/31, 59/60/61, 119/120/121, 239/240/241 dias): a grade põe o cliente no mesmo segmento da lista",
  corpo: async (c) => numaTransacao(c, [], () => prova1a(c)),
});
PROVAS.push({
  nome: "(1b) o CONJUNTO das 12 compras: a grade conta o mesmo que a lista (novos 2, promissores 3, quase dormindo 3, hibernando 4)",
  corpo: async (c) => numaTransacao(c, [], () => prova1b(c)),
});
PROVAS.push({
  nome: "(1c) a virada de 240 dias muda a nota no ajudante, mas a grade não a mostra (nota 2 e nota 1 caem no mesmo segmento)",
  corpo: async (c) => numaTransacao(c, [], () => prova1c(c)),
});
PROVAS.push({
  nome: "(1d) as OUTRAS três chamadas recebem o mesmo instante: o que tem data depois de agora não entra na grade (venda, pedido não pago, perfil sem compra); o de agora e de uma hora atrás entra",
  corpo: async (c) => numaTransacao(c, [], () => prova1d(c)),
});

// ---- itens 2 a 5: precisam dos arquivos (a migration, o rollback e a 20261227)

function montarCorpos() {
  if (fx.pronto) return;
  fx.mig = ler(NOME);
  fx.rb = ler(`rollback-manual-${NOME}`);
  fx.mig27 = ler(NOME_27);
  const m =
    /\('public\.crm_visao\(date,date\)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/.exec(
      fx.mig,
    );
  assert.ok(m, "o pré-voo da migration não cita (vigente, desta) de crm_visao");
  fx.h = { vigente: m[1], desta: m[2] };
  // o statement CREATE OR REPLACE (para os mutantes) e o corpo de dentro dos $$ ... $$
  const stmt = (sql) => {
    const ini = sql.indexOf("CREATE OR REPLACE FUNCTION public.crm_visao");
    const fim = sql.indexOf("\n$$;", ini) + "\n$$;".length;
    return sql.slice(ini, fim);
  };
  fx.stmt = stmt(fx.mig);
  fx.stmtRb = stmt(fx.rb);
  fx.stmt27 = stmt(fx.mig27);
  // o prosrc exato: tudo entre o `AS $$` e o `$$;` (com a quebra de linha do começo e a do fim)
  const corpo = (st) =>
    st.slice(st.indexOf("AS $$") + "AS $$".length, st.lastIndexOf("$$;"));
  fx.corpo = corpo(fx.stmt);
  fx.corpoRb = corpo(fx.stmtRb);
  fx.corpo27 = corpo(fx.stmt27);
  fx.pronto = true;
}

/** Roda `fn` com os `sqls` aplicados numa transação que SEMPRE é desfeita. */
async function numaTransacao(c, sqls, fn) {
  await c.query("BEGIN");
  try {
    for (const sql of sqls) await c.query(sql);
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

/** A prova `prova` PRECISA falhar com o corpo mutado: senão, o mutante sobreviveu. */
async function mataMutante(c, nome, sqls, prova) {
  let passou = false;
  try {
    await numaTransacao(c, sqls, () => prova(c));
    passou = true;
  } catch (e) {
    if (e instanceof assert.AssertionError) {
      console.log(`    mutante morto: ${nome}`);
      return;
    }
    throw e;
  }
  assert.ok(!passou, `MUTANTE SOBREVIVEU: ${nome}`);
}

function mutar(stmt, de, para) {
  const n = stmt.split(de).length - 1;
  assert.equal(
    n,
    1,
    `o trecho do mutante tem de aparecer 1x (achei ${n}): ${de.slice(0, 60)}`,
  );
  return stmt.replace(de, () => para);
}

PROVAS.push({
  nome: "(2a) período que NÃO termina hoje: o JSON é IDÊNTICO ao do corpo antigo; que termina hoje: só `segmentos` e `kpis.receita_em_risco` mudam",
  corpo: async (c) => {
    montarCorpos();
    await numaTransacao(c, [], async () => {
      await semearAdmin(c);
      await semearViradas(c);
      // vendas em vários dias, um pedido não pago e um perfil sem compra, para o JSON ter de tudo
      for (const q of ["0 seconds", "1 day", "3 days", "10 days", "35 days"])
        await venda(c, { nome: `Grade venda ${q}`, quando: q, total: 80 });
      await pedidoNaoPago(c, { nome: "Pediu e nao pagou", quando: "2 hours" });
      await perfilSemCompra(c, { nome: "Sem compra", quando: "5 days" });
      const h = await hoje(c);
      const dia = async (n) =>
        (await c.query("SELECT ($1::date + $2::int)::text AS d", [h, n]))
          .rows[0].d;
      assert.equal(
        (await catalogo(c, CRM)).hash,
        fx.h.desta,
        "o banco da prova tem de estar no corpo novo",
      );
      const novo = {};
      for (const n of [-1, -5, -40, -200, 0])
        novo[n] = (await grade(c, await dia(n))).bruto;
      novo.longo = (await grade(c, await dia(-3), 400)).bruto;
      // o corpo ANTIGO, no mesmo instante (a mesma transação): o rollback-manual
      await c.query(fx.rb);
      assert.equal((await catalogo(c, CRM)).hash, fx.h.vigente);
      const antigo = {};
      for (const n of [-1, -5, -40, -200, 0])
        antigo[n] = (await grade(c, await dia(n))).bruto;
      antigo.longo = (await grade(c, await dia(-3), 400)).bruto;
      for (const n of [-1, -5, -40, -200, "longo"])
        assert.deepEqual(
          novo[n],
          antigo[n],
          `período que termina ${n === "longo" ? "há 3 dias (400 dias de período)" : `${n} dia(s) de hoje`} não pode mudar`,
        );
      // termina hoje: o que muda é só a nota de recência (segmentos e receita em risco)
      const tira = (j) => {
        const k = structuredClone(j);
        k.segmentos = undefined;
        k.kpis.receita_em_risco = undefined;
        return k;
      };
      assert.deepEqual(
        tira(novo[0]),
        tira(antigo[0]),
        "fora dos segmentos, nada muda",
      );
      assert.notDeepEqual(
        novo[0].segmentos,
        antigo[0].segmentos,
        "o defeito: os segmentos mudam",
      );
    });
  },
});

PROVAS.push({
  nome: "(2b) período que termina no FUTURO: mede até agora (os segmentos são os do período que termina hoje); no corpo antigo eram deslocados",
  corpo: async (c) => {
    montarCorpos();
    await numaTransacao(c, [], async () => {
      await semearAdmin(c);
      await semearViradas(c);
      const h = await hoje(c);
      const dia = async (n) =>
        (await c.query("SELECT ($1::date + $2::int)::text AS d", [h, n]))
          .rows[0].d;
      const hojeSeg = (await grade(c, h)).bruto.segmentos;
      const futuroSeg = (await grade(c, await dia(3))).bruto.segmentos;
      assert.deepEqual(futuroSeg, hojeSeg);
      await c.query(fx.rb);
      const futuroAntigo = (await grade(c, await dia(3))).bruto.segmentos;
      assert.notDeepEqual(
        futuroAntigo,
        hojeSeg,
        "o corpo antigo deslocava o período do futuro",
      );
    });
  },
});

PROVAS.push({
  nome: "(3) CONTROLE: o corpo ANTIGO (rollback-manual numa transação desfeita) REPROVA as provas do defeito, pela razão certa (asserção), e mostra o 1 x 2 e o 5 x 4",
  corpo: async (c) => {
    montarCorpos();
    await numaTransacao(c, [fx.rb], async () => {
      assert.equal((await catalogo(c, CRM)).hash, fx.h.vigente);
      for (const [nome, prova] of [
        ["1a (viradas)", prova1a],
        ["1b (conjunto)", prova1b],
        ["1d (outras chamadas)", prova1d],
      ])
        await assert.rejects(
          () => nomeada(c, prova),
          (e) => e instanceof assert.AssertionError,
          `o corpo ANTIGO tinha de reprovar a prova ${nome}`,
        );
      // a medida do defeito, no corpo antigo
      await semearAdmin(c);
      await semearViradas(c);
      const l = await lista(c);
      const g = await grade(c, await hoje(c));
      assert.deepEqual(soRfm(l.porSegmento), {
        novos: 2,
        promissores: 3,
        quase_dormindo: 3,
        hibernando: 4,
      });
      assert.deepEqual(soRfm(g.porSegmento), {
        novos: 1,
        promissores: 3,
        quase_dormindo: 3,
        hibernando: 5,
      });
    });
    // fora da transação o corpo é o novo, e as provas passam
    assert.equal((await catalogo(c, CRM)).hash, fx.h.desta);
    await numaTransacao(c, [], () => prova1b(c));
  },
});

/** `prova` roda num savepoint que SEMPRE volta (a prova pode inserir à vontade). */
async function nomeada(c, prova) {
  await c.query("SAVEPOINT nomeada");
  try {
    await prova(c);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT nomeada");
  }
}

PROVAS.push({
  nome: "(3b) MUTANTES: sem o LEAST, GREATEST, âncora de ontem, now() fixo, corte no começo do dia e cada uma das quatro chamadas com a âncora antiga: cada um deixa a prova correspondente vermelha",
  corpo: async (c) => {
    montarCorpos();
    const base = fx.stmt;
    const viradas = prova1a;
    // O período que NÃO termina hoje não pode mudar: com now() fixo, a compra de HOJE vazaria para o
    // "LTV médio" de um período que terminou ontem (a nota e o total do cliente são medidos até o fim do período).
    const periodoPassado = async (cc) => {
      await semearAdmin(cc);
      const zap = "(34) 97777-0001";
      await venda(cc, {
        nome: "Grade repetida",
        quando: "1 day",
        total: 100,
        zap,
      });
      await venda(cc, {
        nome: "Grade repetida",
        quando: "0 seconds",
        total: 300,
        zap,
      });
      const h = await hoje(cc);
      const ontem = (await cc.query("SELECT ($1::date - 1)::text AS d", [h]))
        .rows[0].d;
      const k = (await grade(cc, ontem, 1)).bruto.kpis;
      assert.equal(
        Number(k.pedidos),
        1,
        "período de ontem: só a venda de ontem",
      );
      assert.equal(
        Number(k.ltv_medio),
        100,
        "período de ontem: o total do cliente não inclui a compra de hoje",
      );
    };
    const casos = [
      [
        "sem o LEAST (a âncora antiga)",
        mutar(base, LINHA_NOVA, LINHA_VELHA),
        [viradas, prova1b],
      ],
      [
        "GREATEST no lugar de LEAST",
        mutar(base, "v_fim_ts := LEAST(", "v_fim_ts := GREATEST("),
        [viradas, prova1b],
      ],
      [
        "âncora de ONTEM (now() - 1 dia)",
        mutar(
          base,
          "'America/Sao_Paulo'), now());",
          "'America/Sao_Paulo'), now() - interval '1 day');",
        ),
        [viradas, prova1b],
      ],
      [
        "now() fixo (sem respeitar o fim do período)",
        mutar(base, LINHA_NOVA, "v_fim_ts := now();"),
        [periodoPassado],
      ],
      [
        "corte no começo do dia (a venda de agora fica de fora)",
        mutar(
          base,
          "'America/Sao_Paulo'), now());",
          "'America/Sao_Paulo'), date_trunc('day', now()));",
        ),
        [prova1d],
      ],
      [
        "crm__vendas com a âncora antiga",
        mutar(
          base,
          "public.crm__vendas(v_fim_ts)",
          `public.crm__vendas(${ANCORA_VELHA})`,
        ),
        [prova1d],
      ],
      [
        "crm__clientes_rfm com a âncora antiga",
        mutar(
          base,
          "public.crm__clientes_rfm(v_fim_ts)",
          `public.crm__clientes_rfm(${ANCORA_VELHA})`,
        ),
        [viradas, prova1d],
      ],
      [
        "crm__pedidos_nao_pagos com a âncora antiga",
        mutar(
          base,
          "public.crm__pedidos_nao_pagos(v_fim_ts)",
          `public.crm__pedidos_nao_pagos(${ANCORA_VELHA})`,
        ),
        [prova1d],
      ],
      [
        "crm__nunca_comprou com a âncora antiga",
        mutar(
          base,
          "public.crm__nunca_comprou(v_fim_ts)",
          `public.crm__nunca_comprou(${ANCORA_VELHA})`,
        ),
        [prova1d],
      ],
    ];
    for (const [nome, stmt, provas] of casos)
      for (const p of provas) await mataMutante(c, nome, [stmt], p);
    // e o corpo novo INTEIRO passa em todas (o controle dos mutantes)
    for (const p of [viradas, prova1b, prova1d, periodoPassado])
      await numaTransacao(c, [], () => p(c));
  },
});

PROVAS.push({
  nome: "(4a) a porta: comum, admin REBAIXADO e visitante recusados; anon/PUBLIC sem EXECUTE; authenticated e service_role com; o corpo vivo é o declarado",
  corpo: async (c) => {
    montarCorpos();
    await numaTransacao(c, [], async () => {
      await semearAdmin(c, { comum: true });
      const sql = "SELECT public.crm_visao(current_date - 29, current_date)";
      const recusa = async (rotulo) => {
        await c.query("SAVEPOINT porta");
        await assert.rejects(
          c.query(sql),
          (e) => /Acesso negado/.test(e.message),
          rotulo,
        );
        await c.query("ROLLBACK TO SAVEPOINT porta");
      };
      await logar(c, U_COMUM);
      await recusa("comum");
      await logar(c, "");
      await recusa("visitante");
      // admin REBAIXADO: auth.users ainda diz admin, profiles já diz customer (20261199000000)
      await c.query(
        `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = $1`,
        [U_COMUM],
      );
      await logar(c, U_COMUM);
      await recusa("rebaixado");
      // e o admin de verdade entra
      await logar(c, U_ADMIN);
      await c.query(sql);
    });
    const a = await c.query(
      `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS auth,
              has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS srv,
              EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = $1::regprocedure AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) AS publico`,
      [CRM],
    );
    assert.deepEqual(a.rows[0], {
      anon: false,
      auth: true,
      srv: true,
      publico: false,
    });
    assert.equal((await catalogo(c, CRM)).hash, fx.h.desta);
  },
});

PROVAS.push({
  nome: "(4b) o FORMATO do JSON é o do corpo antigo; ACL, atributos e dono iguais; nenhuma linha de pedido, perfil ou conta muda",
  corpo: async (c) => {
    montarCorpos();
    const contar = async () =>
      (
        await c.query(
          `SELECT (SELECT md5(string_agg(p::text, '|' ORDER BY p.id)) FROM public.profiles p) AS perfis,
                  (SELECT md5(string_agg(o::text, '|' ORDER BY o.id)) FROM public.marketplace_orders o) AS pedidos,
                  (SELECT md5(string_agg(u.id::text || coalesce(u.phone, ''), '|' ORDER BY u.id)) FROM auth.users u) AS contas`,
        )
      ).rows[0];
    const antes = await contar();
    const novo = await catalogo(c, CRM);
    await numaTransacao(c, [], async () => {
      await semearAdmin(c);
      await semearViradas(c);
      await venda(c, { nome: "Grade hoje", quando: "0 seconds" });
      const fNovo = formato((await grade(c, await hoje(c))).bruto);
      await c.query(fx.rb);
      const fAntigo = formato((await grade(c, await hoje(c))).bruto);
      assert.ok(fNovo.length > 20);
      assert.deepEqual(fNovo, fAntigo, "o formato do JSON mudou");
      const antigo = await catalogo(c, CRM);
      assert.equal(antigo.prosecdef, novo.prosecdef);
      assert.equal(antigo.proconfig, novo.proconfig);
      assert.equal(antigo.proacl, novo.proacl);
      assert.equal(antigo.volatil, novo.volatil);
      assert.equal(antigo.dono, novo.dono);
    });
    assert.deepEqual(
      await contar(),
      antes,
      "aplicar/desfazer ou ler tocou dado de cliente",
    );
  },
});

PROVAS.push({
  nome: "(4c) reaplicar 2x deixa a mesma impressão digital; aplicar, desfazer 2x e aplicar de novo volta idêntico; o rollback devolve o corpo da 20261227 byte a byte",
  corpo: async (c) => {
    montarCorpos();
    const digital = async () =>
      Object.fromEntries(
        (
          await c.query(
            `SELECT p.oid::regprocedure::text AS k,
                    concat_ws(' | ', md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, ''),
                              p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                              p.provolatile::text, p.proowner::regrole::text) AS v
               FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`,
          )
        ).rows.map((l) => [l.k, l.v]),
      );
    const base = await digital();
    await numaTransacao(c, [fx.mig, fx.mig], async () => {
      assert.deepEqual(await digital(), base, "reaplicar mudou alguma coisa");
    });
    await numaTransacao(c, [fx.rb], async () => {
      const k = await catalogo(c, CRM);
      assert.equal(
        k.hash,
        fx.h.vigente,
        "o rollback não devolveu o md5 da 20261227",
      );
      // byte a byte: o texto do corpo é o da própria 20261227
      assert.equal(k.prosrc.replace(/\r/g, ""), fx.corpo27.replace(/\r/g, ""));
      await c.query(fx.rb); // o segundo rollback deixa o mesmo estado
      assert.equal((await catalogo(c, CRM)).hash, fx.h.vigente);
      await c.query(fx.mig);
      assert.deepEqual(
        await digital(),
        base,
        "aplicar-desfazer-aplicar mudou o estado",
      );
    });
    assert.deepEqual(await digital(), base);
  },
});

PROVAS.push({
  nome: "(4d) pré-voo: corpo divergente, ACL aberta, atributo trocado e função ausente recusam (B1_BASELINE_DIVERGENT) SEM escrever; erro no meio da troca não deixa nada",
  corpo: async (c) => {
    montarCorpos();
    // 1. corpo vivo divergente (um comentário a mais): migration e rollback recusam e nada muda
    await c.query("BEGIN");
    try {
      const def = (
        await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
          CRM,
        ])
      ).rows[0].d;
      const divergente = def.replace("DECLARE", "DECLARE\n  -- divergente");
      assert.notEqual(divergente, def);
      await c.query(divergente);
      const hashDivergente = (await catalogo(c, CRM)).hash;
      assert.notEqual(hashDivergente, fx.h.desta);
      await c.query("SAVEPOINT a");
      await assert.rejects(
        c.query(fx.mig),
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.crm_visao/,
      );
      await c.query("ROLLBACK TO SAVEPOINT a");
      assert.equal(
        (await catalogo(c, CRM)).hash,
        hashDivergente,
        "a recusa escreveu",
      );
      await assert.rejects(
        c.query(fx.rb),
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.crm_visao/,
      );
      await c.query("ROLLBACK TO SAVEPOINT a");
      assert.equal(
        (await catalogo(c, CRM)).hash,
        hashDivergente,
        "o rollback recusado escreveu",
      );
    } finally {
      await c.query("ROLLBACK");
    }
    // 2. ACL aberta para PUBLIC / anon com EXECUTE / authenticated sem EXECUTE
    for (const [rotulo, ajuste] of [
      ["PUBLIC", `GRANT EXECUTE ON FUNCTION ${CRM} TO PUBLIC`],
      ["anon", `GRANT EXECUTE ON FUNCTION ${CRM} TO anon`],
      [
        "sem authenticated",
        `REVOKE EXECUTE ON FUNCTION ${CRM} FROM authenticated`,
      ],
    ]) {
      await c.query("BEGIN");
      try {
        await c.query(ajuste);
        const antes = (await catalogo(c, CRM)).hash;
        await c.query("SAVEPOINT b");
        await assert.rejects(
          c.query(fx.mig),
          /B1_BASELINE_DIVERGENT: ACL de/,
          `${rotulo}: migration`,
        );
        await c.query("ROLLBACK TO SAVEPOINT b");
        await assert.rejects(
          c.query(fx.rb),
          /B1_BASELINE_DIVERGENT/,
          `${rotulo}: rollback`,
        );
        await c.query("ROLLBACK TO SAVEPOINT b");
        assert.equal(
          (await catalogo(c, CRM)).hash,
          antes,
          `${rotulo}: escreveu`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
    // 3. atributo trocado (SECURITY INVOKER)
    await c.query("BEGIN");
    try {
      await c.query(`ALTER FUNCTION ${CRM} SECURITY INVOKER`);
      await assert.rejects(
        c.query(fx.mig),
        /B1_BASELINE_DIVERGENT: atributos de public\.crm_visao/,
      );
    } finally {
      await c.query("ROLLBACK");
    }
    // 4. função que o corpo chama AUSENTE: recusa (o PL/pgSQL só acusaria na hora de executar)
    for (const ajuste of [
      "ALTER FUNCTION public.crm__nunca_comprou(timestamptz) RENAME TO crm__nunca_comprou_x",
      "ALTER FUNCTION public.fin__hoje() RENAME TO fin__hoje_x",
    ]) {
      await c.query("BEGIN");
      try {
        await c.query(ajuste);
        await assert.rejects(
          c.query(fx.mig),
          /B1_BASELINE_DIVERGENT: funções que o corpo novo chama não existem/,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
    // 5. erro NO MEIO da troca (depois do CREATE OR REPLACE): a transação inteira cai e o corpo volta
    await c.query("BEGIN");
    try {
      await c.query(fx.rb);
      assert.equal((await catalogo(c, CRM)).hash, fx.h.vigente);
      await c.query("SAVEPOINT meio");
      await assert.rejects(
        c.query(
          `${fx.mig}\nDO $$ BEGIN RAISE EXCEPTION 'falha no meio da troca'; END $$;`,
        ),
        /falha no meio da troca/,
      );
      await c.query("ROLLBACK TO SAVEPOINT meio");
      assert.equal(
        (await catalogo(c, CRM)).hash,
        fx.h.vigente,
        "a troca interrompida deixou o corpo novo",
      );
    } finally {
      await c.query("ROLLBACK");
    }
    assert.equal((await catalogo(c, CRM)).hash, fx.h.desta);
  },
});

PROVAS.push({
  nome: "(4e) CONCORRENCIA: a leitura nunca enxerga estado misto (corpo novo inteiro ou antigo inteiro); dois aplicadores ao mesmo tempo deixam UM estado só",
  corpo: async (c) => {
    montarCorpos();
    const url = lerDatabaseUrlEfemera();
    const outra = new Client({ connectionString: url });
    await outra.connect();
    const terceira = new Client({ connectionString: url });
    await terceira.connect();
    try {
      // (a) a outra sessão desfaz numa transação ABERTA: aqui o corpo ainda é o NOVO inteiro
      await outra.query("BEGIN");
      await outra.query(fx.rb);
      assert.equal((await catalogo(c, CRM)).hash, fx.h.desta);
      await outra.query("ROLLBACK");
      await outra.query("BEGIN");
      await outra.query(fx.rb);
      await outra.query("COMMIT");
      // depois do COMMIT: o ANTIGO inteiro
      assert.equal((await catalogo(c, CRM)).hash, fx.h.vigente);
      // (b) dois aplicadores ao mesmo tempo: o segundo espera o primeiro; o resultado é UM estado só
      await outra.query("BEGIN");
      await outra.query(fx.mig);
      await terceira.query("BEGIN");
      let terminou = false;
      let erro = null;
      const segundo = terceira
        .query(fx.mig)
        .catch((e) => {
          erro = e;
        })
        .then(() => {
          terminou = true;
        });
      await new Promise((r) => setTimeout(r, 600));
      assert.equal(
        terminou,
        false,
        "o segundo aplicador tinha de esperar o primeiro",
      );
      await outra.query("COMMIT");
      await segundo;
      if (erro) {
        // a Postgres recusa a segunda troca do MESMO corpo ("tuple concurrently updated"): nada foi escrito por ela
        assert.match(
          erro.message,
          /concurrently updated|B1_BASELINE_DIVERGENT/,
        );
        await terceira.query("ROLLBACK");
      } else {
        await terceira.query("COMMIT");
      }
      assert.equal(
        (await catalogo(c, CRM)).hash,
        fx.h.desta,
        "dois aplicadores deixaram estado misto",
      );
      // e repetir o aplicador que falhou é seguro (o pré-voo aceita o corpo desta migration)
      await c.query(fx.mig);
      assert.equal((await catalogo(c, CRM)).hash, fx.h.desta);
      console.log(
        `    dois aplicadores ao mesmo tempo: segundo ${erro ? `recusado limpo (${erro.message})` : "terminou depois do primeiro (no-op)"}`,
      );
    } finally {
      await outra.query("ROLLBACK").catch(() => {});
      await terceira.query("ROLLBACK").catch(() => {});
      await outra.end().catch(() => {});
      await terceira.end().catch(() => {});
    }
  },
});

PROVAS.push({
  nome: "(5) O RESTO DO CORPO NÃO MUDOU: o corpo novo é o do rollback-manual (corpo da 20261227) com UMA linha trocada, byte a byte; o vivo é o do arquivo",
  corpo: async (c) => {
    montarCorpos();
    assert.equal(
      fx.corpoRb,
      fx.corpo27,
      "o rollback tem de devolver o corpo da 20261227 byte a byte",
    );
    assert.equal(fx.corpo27.split(LINHA_VELHA).length - 1, 1);
    assert.equal(fx.corpo.split(LINHA_NOVA).length - 1, 1);
    assert.equal(
      fx.corpo,
      fx.corpo27.replace(LINHA_VELHA, () => LINHA_NOVA),
      "o corpo novo só pode diferir do da 20261227 na linha do v_fim_ts",
    );
    // o corpo vivo (prosrc) é o do arquivo, byte a byte
    const vivo = await catalogo(c, CRM);
    assert.equal(vivo.prosrc.replace(/\r/g, ""), fx.corpo.replace(/\r/g, ""));
    // e a assinatura e os atributos do CREATE do arquivo novo são os do rollback e os da 20261227
    const cabeca = (s) => s.slice(0, s.indexOf("AS $$"));
    assert.equal(cabeca(fx.stmt), cabeca(fx.stmtRb));
    assert.equal(cabeca(fx.stmt), cabeca(fx.stmt27));
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  let falhas = 0;
  const provas = SO_COMPORTAMENTO
    ? PROVAS.filter((p) => /^\(1[a-d]\)/.test(p.nome))
    : PROVAS;
  try {
    for (const { nome, corpo } of provas) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        await cliente.query("ROLLBACK").catch(() => {});
        if (process.env.GRADE_TODAS === "1") {
          falhas += 1;
          continue;
        }
        anexarAoSummary(
          "Prova viva da grade do CRM (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "A grade do CRM deixou de medir a recência do mesmo instante da lista — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  if (falhas > 0)
    falhar("FALHOU", `${falhas} prova(s) falharam (GRADE_TODAS=1).`);
  console.log(
    `\n[grade-do-crm] ${provas.length}/${provas.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva da grade do CRM (rpc-ci)",
    `${linhas.join("\n")}\n\n**${provas.length}/${provas.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
