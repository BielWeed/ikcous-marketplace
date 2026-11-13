"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-non-literal-regexp --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices e chaves de objeto vem de listas literais da
 * propria prova (a fixture, o JSON do banco), nunca de entrada externa; o RegExp monta o nome de funcao de uma lista fechada. */
/**
 * PROVA VIVA da migration 20261399985000_o_grafico_do_financeiro_soma_so_as_contas_ativas.sql (fin_resumo) contra o Postgres EFEMERO com
 * as migrations aplicadas do zero (rpc-ci, job do dinheiro). Nunca banco de loja.
 *
 * O que prova:
 *  (1) O DEFEITO (controle com o corpo anterior): o grafico de saldo do app volta do saldo de hoje (saldo_total = so contas ativas)
 *      descontando entradas - saidas dos dias seguintes. Com uma conta DESATIVADA que tem movimento, e com transferencia entre ativa e
 *      desativada, e com movimento anterior ao saldo_inicial_em de uma conta ativa, esse saldo diverge do saldo que fin__saldos daria
 *      naquele dia (o "saldo de verdade", medido dia a dia com o relogio da loja fixado em cada dia).
 *  (2) A CORRECAO: com serie[].variacao_saldo, saldo_total - soma(variacao dos dias seguintes) = o saldo de fin__saldos no fim de CADA
 *      dia (os 30 dias, e um periodo que passa de hoje), e a variacao de cada dia bate com um ORACULO escrito aqui em JS (centavos
 *      inteiros, das linhas declaradas, sem chamar nenhuma funcao do banco).
 *  (3) O que NAO muda: o JSON inteiro de fin_resumo, menos a chave nova, e IGUAL ao do corpo anterior na mesma base (entradas/saidas
 *      continuam somando todas as contas).
 *  (4) MUTANTES do corpo novo (sem o filtro de ativas, filtro invertido, desativada so no saldo, sem saldo_inicial_em, sem o teto de
 *      hoje, transferencia, sinais, arredondamento, previsto, chave ausente...) reprovam a bateria, cada um na guarda CERTA.
 *  (5) Dado que JA existia: aplicar e reaplicar (LF e CRLF) nao muda nenhuma conta, lancamento, pedido nem estorno.
 *  (6) Rollback devolve o corpo da 20261399300000 byte a byte (md5 e sha256) com os mesmos atributos; o segundo recusa; o rollback da
 *      20261399300000 roda sobre o estado devolvido; estados estranhos recusam sem gravar.
 *  (7) Pre-voo (B1_BASELINE_DIVERGENT) recusa, sem escrever: corpo desconhecido, loja ainda na 20261199, ACL, atributos, sobrecarga,
 *      fin__saldos com outro corpo ou ausente, fin__movimentos ausente, coluna ausente.
 *  (8) A porta: cliente comum, ex-admin (so o JWT velho) e visitante recusados; admin atual chama; periodo invalido segue recusado.
 *  (9) Consultas 141a/141b (rol fechado) e as vizinhas 8e e 119a leem o estado certo e reprovam corpo estranho.
 * (10) Atomicidade em conexao SEM BEGIN: falhar no fim, pos-voo reprovando corpo e atributo, ROLLBACK no meio e leitor concorrente.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-grafico-do-financeiro-soma-so-as-contas-ativas-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261399985000_o_grafico_do_financeiro_soma_so_as_contas_ativas.sql";
const NOME_3993 =
  "20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql";
const NOME_199 = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const rollback3993 = ler(`supabase/migrations/rollback-manual-${NOME_3993}`);
const corpoDe = (sql, nome) =>
  sql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${nome}\\([^)]*\\)[\\s\\S]*?\\nAS \\$\\$([\\s\\S]*?)\\$\\$;`,
    ),
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) =>
  crypto.createHash("sha256").update(s, "utf8").digest("hex");
const emCRLF = (s) => s.replace(/\n/g, "\r\n");

const RESUMO = "public.fin_resumo(date,date)";
const RESUMO_ANTES = corpoDe(
  ler(`supabase/migrations/${NOME_3993}`),
  "fin_resumo",
);
const RESUMO_199 = corpoDe(
  ler(`supabase/migrations/${NOME_199}`),
  "fin_resumo",
);
const RESUMO_NOVO = corpoDe(migration, "fin_resumo");
const H = {
  antes: "a10e7f301eaf6b3edfac50bc87ff74bc",
  novo: "9e711b03cc63f610461915b850f2eb70",
  h199: "410668ed931d89e0a16a568b35df7973",
  saldos: "5992ecf164d886110c21dbf93a5c607e",
};
const C141A =
  "141a-conferir-o-grafico-do-financeiro-soma-so-as-contas-ativas-aplicado";
const C141B =
  "141b-antes-o-grafico-do-financeiro-soma-so-as-contas-ativas-base-vigente";
const C119A =
  "119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado";
const C8E = "8e-conferir-92-a-202-aplicado";

const ADMIN = "5e399985-0000-4000-8000-000000000001";
const CLIENTE = "5e399985-0000-4000-8000-000000000002";
const EX_ADMIN = "5e399985-0000-4000-8000-000000000003";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const ONLINE = "f1000000-0000-4000-8000-000000000003";
const CAT_RECEITA = "f2000000-0000-4000-8000-000000000001";
const CAT_ALUGUEL = "f2000000-0000-4000-8000-000000000020";

// ---------------------------------------------------------------------------------------------------------------------
// A fixture, declarada em JS: o ORACULO sai daqui, sem chamar nenhuma funcao do banco.
// ---------------------------------------------------------------------------------------------------------------------
const HOJE = "2031-06-15";
const PERIODO = ["2031-05-17", "2031-06-15"]; // 30 dias, termina hoje (o grafico do app)
const PERIODO_LONGO = ["2031-05-17", "2031-06-25"]; // passa de hoje: os dias futuros tem de ter variacao zero
const iso = (d) => d.toISOString().slice(0, 10);
const somaDias = (dia, n) =>
  iso(new Date(new Date(`${dia}T00:00:00Z`).getTime() + n * 86400000));
const diasDe = ([ini, fim]) => {
  const dias = [];
  for (let d = ini; d <= fim; d = somaDias(d, 1)) dias.push(d);
  return dias;
};
const cent = (v) => Math.round(Number(v) * 100);

// Contas lancadas pela lojista; as de sistema (CAIXA, ONLINE) nascem ativas, com saldo inicial 0 e saldo_inicial_em de antes de 2031.
const CONTAS = {
  A: { nome: "Banco A", saldoInicial: 100.5, em: "2031-05-01", ativa: true },
  B: { nome: "Banco B", saldoInicial: 0, em: "2031-05-01", ativa: true },
  I: { nome: "Conta velha", saldoInicial: 500, em: "2031-05-01", ativa: false },
  T: {
    nome: "Conta tardia",
    saldoInicial: 40.25,
    em: "2031-06-05",
    ativa: true,
  },
  [CAIXA]: { ativa: true, em: "1900-01-01" },
  [ONLINE]: { ativa: true, em: "1900-01-01" },
};
// Movimentos REALIZADOS (lancamentos manuais, vendas e estorno). valor em reais com centavos.
const MOVS = [
  { tipo: "entrada", conta: "A", valor: 50.25, dia: "2031-06-02" },
  { tipo: "saida", conta: "A", valor: 20.1, dia: "2031-06-04" },
  { tipo: "entrada", conta: "A", valor: 70, dia: "2031-06-10" },
  { tipo: "saida", conta: "A", valor: 15.05, dia: "2031-06-15" },
  // A conta DESATIVADA que ja teve movimento (o defeito).
  { tipo: "saida", conta: "I", valor: 300, dia: "2031-06-06" },
  { tipo: "entrada", conta: "I", valor: 90.5, dia: "2031-06-11" },
  { tipo: "entrada", conta: "B", valor: 25.75, dia: "2031-06-08" },
  // A conta de saldo inicial tardio (2031-06-05): o movimento de 01/06 e' anterior e fin__saldos o ignora.
  { tipo: "entrada", conta: "T", valor: 10, dia: "2031-06-01" },
  { tipo: "entrada", conta: "T", valor: 60.3, dia: "2031-06-07" },
  { tipo: "saida", conta: "T", valor: 5.05, dia: "2031-06-12" },
  // Transferencias: ativa -> ativa (soma zero), ativa -> desativada (saida), desativada -> ativa (entrada), e uma
  // para a conta tardia ANTES do saldo_inicial_em dela (so a origem conta).
  {
    tipo: "transferencia",
    conta: "A",
    destino: "B",
    valor: 40,
    dia: "2031-06-09",
  },
  {
    tipo: "transferencia",
    conta: "A",
    destino: "I",
    valor: 35.2,
    dia: "2031-06-12",
  },
  {
    tipo: "transferencia",
    conta: "I",
    destino: "A",
    valor: 25.1,
    dia: "2031-06-13",
  },
  {
    tipo: "transferencia",
    conta: "T",
    destino: "B",
    valor: 12.34,
    dia: "2031-06-14",
  },
  {
    tipo: "transferencia",
    conta: "B",
    destino: "T",
    valor: 3,
    dia: "2031-06-04",
  },
  // Movimento realizado com data FUTURA: fin__saldos (ate hoje) nao conta; a variacao tem de ser zero naquele dia.
  { tipo: "entrada", conta: "A", valor: 999, dia: "2031-06-20" },
  // Vendas (conta de sistema pela forma de pagamento) e um estorno concluido.
  { tipo: "entrada", conta: ONLINE, valor: 80, dia: "2031-06-03" },
  { tipo: "entrada", conta: ONLINE, valor: 120.4, dia: "2031-06-14" },
  { tipo: "saida", conta: ONLINE, valor: 30.15, dia: "2031-06-14" },
  { tipo: "entrada", conta: CAIXA, valor: 45, dia: "2031-06-12" },
];
// O que NAO e' movimento realizado e nao pode entrar em nada: previsto (vencido ou nao) e cancelado.
const FORA = [
  {
    tipo: "saida",
    conta: "A",
    valor: 77,
    status: "previsto",
    venc: "2031-06-13",
  },
  {
    tipo: "entrada",
    conta: "I",
    valor: 11,
    status: "previsto",
    venc: "2031-06-14",
  },
  {
    tipo: "entrada",
    conta: "A",
    valor: 500,
    status: "cancelado",
    venc: "2031-06-10",
  },
];

/** O que cada dia DEVE valer (so das linhas da fixture, so contas ativas, so a partir do saldo_inicial_em, ate hoje), em centavos. */
function oraculo(dia, hoje = HOJE) {
  if (dia > hoje) return 0;
  let soma = 0;
  for (const m of MOVS) {
    if (m.dia !== dia) continue;
    for (const [papel, id] of [
      ["origem", m.conta],
      ["destino", m.destino],
    ]) {
      if (!id) continue;
      const c = CONTAS[id];
      if (!c.ativa || dia < c.em) continue;
      const v = cent(m.valor);
      if (papel === "origem")
        soma += m.tipo === "entrada" ? v : -v; // saida e transferencia de origem saem
      else soma += v; // transferencia de destino entra
    }
  }
  return soma;
}

// ---------------------------------------------------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------------------------------------------------
async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${RESUMO}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso39985");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso39985");
    await c.query("RELEASE SAVEPOINT caso39985");
  }
}
async function logar(c, id) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [id]);
}
async function fixarRelogio(c, dia) {
  await c.query(
    `CREATE OR REPLACE FUNCTION public.fin__hoje() RETURNS date LANGUAGE sql STABLE
       SET search_path TO 'public' AS $$ SELECT DATE '${dia}' $$`,
  );
}
const instalarResumo = (c, corpo) =>
  c.query(
    `CREATE OR REPLACE FUNCTION public.fin_resumo(p_inicio date, p_fim date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$${corpo}$x$`,
  );
/** fin_resumo(periodo) com o relogio da loja em `hoje`, como admin. */
const resumoEm = (c, periodo, hoje = HOJE) =>
  isolado(c, async () => {
    await fixarRelogio(c, hoje);
    await logar(c, ADMIN);
    return (await c.query("SELECT public.fin_resumo($1, $2) AS r", periodo))
      .rows[0].r;
  });
// Copia sem a chave `k` em cada item da serie.
const semChave = (r, k) => ({
  ...r,
  serie: r.serie.map((d) => {
    const copia = { ...d };
    delete copia[k];
    return copia;
  }),
});

/**
 * O saldo VERDADEIRO das contas ativas ao fim de `dia`: o que fin__saldos (o saldo que o app mostra) daria com o relogio da loja
 * naquele dia (ele conta ate "hoje"). Independe do corpo de fin_resumo.
 */
async function saldoVerdadeiro(c, dia) {
  return isolado(c, async () => {
    await fixarRelogio(c, dia);
    return cent(
      (
        await c.query(
          `SELECT COALESCE(sum(s.saldo), 0) AS v
             FROM public.fin__saldos() s JOIN public.fin_contas k ON k.id = s.conta_id WHERE k.ativa`,
        )
      ).rows[0].v,
    );
  });
}
/** A reconstrucao do app (src/lib/financeiro.ts, serieDoFluxoDeCaixa): saldo do dia = saldo_total - soma(delta dos dias seguintes). */
function reconstruir(r, { usarChave }) {
  const deltas = r.serie.map((d) =>
    usarChave && d.variacao_saldo !== undefined
      ? cent(d.variacao_saldo)
      : cent(d.entradas) - cent(d.saidas),
  );
  const total = cent(r.saldo_total);
  return r.serie.map((d, i) => ({
    dia: d.dia,
    saldo: total - deltas.slice(i + 1).reduce((s, x) => s + x, 0),
  }));
}

/**
 * A BATERIA. Passa no corpo novo; tem de FALHAR no anterior e em cada mutante, e cada falha leva a etiqueta da guarda que caiu:
 * [chave] a chave variacao_saldo nao existe; [oraculo] a variacao de um dia nao bate com a fixture; [identidade] o saldo reconstruido
 * nao bate com o saldo de fin__saldos naquele dia; [resto] o resto do JSON mudou em relacao ao corpo anterior.
 */
async function verificar(c, ctx) {
  for (const periodo of [PERIODO, PERIODO_LONGO]) {
    const r = await resumoEm(c, periodo);
    const nome = `${periodo[0]}..${periodo[1]}`;
    assert.ok(
      r.serie.every((d) => Object.hasOwn(d, "variacao_saldo")),
      `[chave] serie sem variacao_saldo em ${nome}`,
    );
    assert.deepEqual(
      r.serie.map((d) => d.dia),
      diasDe(periodo),
      `[oraculo] a serie nao tem um item por dia em ${nome}`,
    );
    for (const d of r.serie)
      assert.equal(
        cent(d.variacao_saldo),
        oraculo(d.dia) + (ctx.base.get(d.dia) ?? 0),
        `[oraculo] a variacao de ${d.dia} nao bate com a fixture`,
      );
    // O saldo reconstruido, dia a dia, e' o saldo que fin__saldos daria no fim daquele dia.
    const rec = reconstruir(r, { usarChave: true });
    for (const p of rec) {
      if (p.dia > HOJE) continue; // depois de hoje nao ha "saldo do dia": fin__saldos para em hoje
      assert.equal(
        p.saldo,
        ctx.verdade.get(p.dia),
        `[identidade] o saldo reconstruido de ${p.dia} (${p.saldo}) diverge do de fin__saldos (${ctx.verdade.get(p.dia)})`,
      );
    }
    // Dia depois de hoje: variacao zero (e as entradas continuam mostrando o movimento futuro).
    for (const d of r.serie.filter((x) => x.dia > HOJE))
      assert.equal(
        cent(d.variacao_saldo),
        0,
        `[oraculo] ${d.dia} depois de hoje tem variacao`,
      );
    assert.deepEqual(
      semChave(r, "variacao_saldo"),
      ctx.referencia.get(nome),
      `[resto] o JSON de ${nome} mudou alem da chave nova`,
    );
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    for (const [id, noAuth] of [
      [ADMIN, "admin"],
      [CLIENTE, null],
      [EX_ADMIN, "admin"],
    ])
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@grafico39985.invalid', $2::jsonb)`,
        [id, JSON.stringify(noAuth ? { role: noAuth } : {})],
      );
    for (const [id, papel] of [
      [ADMIN, "admin"],
      [CLIENTE, "customer"],
      [EX_ADMIN, "customer"],
    ])
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 39985', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papel],
      );
    // O gatilho de profiles sincroniza auth.users: o papel contraditorio do ex-admin (admin so em auth.users) nasce DEPOIS dele.
    for (const [id, papelAuth] of [
      [ADMIN, { role: "admin" }],
      [CLIENTE, {}],
      [EX_ADMIN, { role: "admin" }],
    ])
      await c.query(
        "UPDATE auth.users SET raw_app_meta_data = $2::jsonb WHERE id = $1::uuid",
        [id, JSON.stringify(papelAuth)],
      );

    // ---- 0. O topo instalado pelo CI e o desta migration; o anterior e o conhecido. ----
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      RESUMO_NOVO,
      "o topo de fin_resumo nao e o da 39985",
    );
    assert.equal(md5(RESUMO_NOVO), H.novo);
    assert.equal(md5(RESUMO_ANTES), H.antes);
    assert.equal(md5(RESUMO_199), H.h199);
    assert.equal(
      md5(
        (
          await c.query(
            "SELECT prosrc FROM pg_proc WHERE oid = 'public.fin__saldos()'::regprocedure",
          )
        ).rows[0].prosrc.replace(/\r/g, ""),
      ),
      H.saldos,
      "fin__saldos nao esta no corpo que a migration conhece",
    );
    // O que o banco ja tinha na janela antes da fixture (outras provas do clone): sai da conta do oraculo.
    const base = new Map();
    {
      const r0 = await resumoEm(c, PERIODO_LONGO);
      for (const d of r0.serie) base.set(d.dia, cent(d.variacao_saldo));
    }

    // ---- 1. Volta ao corpo ANTERIOR (a loja de antes da migration) e cria a fixture: dado que JA existia. ----
    await c.query(rollback);
    assert.equal(
      (await funcao(c)).prosrc,
      RESUMO_ANTES,
      "o rollback nao devolveu fin_resumo da 3993 byte a byte",
    );
    const dumpDe = async (tabela) =>
      (
        await c.query(
          `SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS h, count(*) AS n FROM public.${tabela} x`,
        )
      ).rows[0];
    const dados = async () => ({
      contas: await dumpDe("fin_contas"),
      lanc: await dumpDe("fin_lancamentos"),
      pedidos: await dumpDe("marketplace_orders"),
      refunds: await dumpDe("order_refunds"),
    });
    const dados0 = await dados();
    const ids = {};
    for (const [k, conta] of Object.entries(CONTAS)) {
      if (!conta.nome) {
        ids[k] = k;
        continue;
      }
      ids[k] = (
        await c.query(
          `INSERT INTO public.fin_contas (nome, tipo, saldo_inicial, saldo_inicial_em, ativa)
           VALUES ($1, 'banco', $2, $3, true) RETURNING id`,
          [conta.nome, conta.saldoInicial, conta.em],
        )
      ).rows[0].id;
    }
    const pedido = async (total, forma, status, canal, quando) =>
      (
        await c.query(
          `INSERT INTO public.marketplace_orders
             (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at, created_at)
           VALUES ($1, 'Cliente 39985', '{}'::jsonb, $2, $2, 'delivered', $3, $4, $5, $6::timestamptz, $6::timestamptz)
           RETURNING id`,
          [CLIENTE, total, canal, forma, status, quando],
        )
      ).rows[0].id;
    let pedidoDoEstorno = null;
    for (const m of MOVS) {
      if (m.conta === ONLINE && m.tipo === "entrada") {
        const id = await pedido(
          m.valor,
          "online",
          "pago",
          "online",
          `${m.dia} 12:00:00-03`,
        );
        if (m.dia === "2031-06-14") pedidoDoEstorno = id;
      } else if (m.conta === ONLINE && m.tipo === "saida") {
        await c.query(
          `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, motivo, created_at, updated_at, concluido_em)
           VALUES ($1, $2, 'lojista', 'concluido', 'fixture', $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
          [pedidoDoEstorno, m.valor, `${m.dia} 13:00:00-03`],
        );
      } else if (m.conta === CAIXA) {
        await pedido(
          m.valor,
          "cash",
          "recebido_na_entrega",
          "presencial",
          `${m.dia} 12:00:00-03`,
        );
      } else {
        await c.query(
          `INSERT INTO public.fin_lancamentos
             (tipo, status, valor, conta_id, conta_destino_id, categoria_id, descricao, forma_pagamento,
              data_competencia, data_realizacao)
           VALUES ($1, 'realizado', $2, $3, $4, $5, 'fixture 39985', 'transferencia', $6, $6)`,
          [
            m.tipo,
            m.valor,
            ids[m.conta],
            m.destino ? ids[m.destino] : null,
            m.tipo === "transferencia"
              ? null
              : m.tipo === "entrada"
                ? CAT_RECEITA
                : CAT_ALUGUEL,
            m.dia,
          ],
        );
      }
    }
    for (const f of FORA)
      await c.query(
        `INSERT INTO public.fin_lancamentos
           (tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
            data_competencia, data_vencimento, cancelado_em)
         VALUES ($1, $2, $3, $4, $5, 'fora 39985', 'transferencia', $6, $6, $7)`,
        [
          f.tipo,
          f.status,
          f.valor,
          ids[f.conta],
          f.tipo === "entrada" ? CAT_RECEITA : CAT_ALUGUEL,
          f.venc,
          f.status === "cancelado" ? "2031-06-11 10:00:00-03" : null,
        ],
      );
    // A lojista DESATIVA a conta velha depois de ela ter movimento (e a de saldo tardio ja nasceu com a data dela).
    await c.query("UPDATE public.fin_contas SET ativa = false WHERE id = $1", [
      ids.I,
    ]);
    const dadosAntes = await dados();
    const manuais = MOVS.filter((m) => m.conta !== ONLINE && m.conta !== CAIXA);
    assert.equal(
      Number(dadosAntes.lanc.n) - Number(dados0.lanc.n),
      manuais.length + FORA.length,
      "a fixture nao gravou os lancamentos declarados",
    );
    assert.equal(Number(dadosAntes.contas.n) - Number(dados0.contas.n), 4);

    // O saldo verdadeiro de cada dia (independe do corpo de fin_resumo) e o JSON do corpo anterior (a referencia do "resto").
    const verdade = new Map();
    for (const dia of diasDe(PERIODO_LONGO).filter((d) => d <= HOJE))
      verdade.set(dia, await saldoVerdadeiro(c, dia));
    const referencia = new Map();
    for (const periodo of [PERIODO, PERIODO_LONGO])
      referencia.set(
        `${periodo[0]}..${periodo[1]}`,
        await resumoEm(c, periodo),
      );
    const ctx = { base, verdade, referencia };

    // ---- 2. CONTROLE: o corpo anterior faz o grafico mostrar saldo que nunca existiu NESTA fixture. ----
    {
      const r = await resumoEm(c, PERIODO);
      assert.ok(
        r.serie.every((d) => !Object.hasOwn(d, "variacao_saldo")),
        "controle: o corpo anterior ja tem a chave",
      );
      const rec = reconstruir(r, { usarChave: false });
      const erradas = rec
        .filter((p) => p.saldo !== verdade.get(p.dia))
        .map((p) => ({
          dia: p.dia,
          grafico: p.saldo / 100,
          verdade: verdade.get(p.dia) / 100,
        }));
      assert.ok(
        erradas.length >= 8,
        `controle: o corpo anterior devia errar o saldo de muitos dias; errou ${erradas.length}`,
      );
      // O dia seguinte a saida da conta velha (06/06) e o mais legivel: o grafico desconta 300 que nunca saiu das contas ativas.
      const d0605 = erradas.find((e) => e.dia === "2031-06-05");
      assert.ok(d0605, "controle: 05/06 devia divergir");
      // Se o clone nao trazia movimento de outra prova na janela, a diferenca e' EXATAMENTE o que o oraculo calcula: soma, dos dias depois
      // de 05/06, de (variacao das contas ativas - (entradas - saidas) de todas as contas).
      if ([...base.values()].every((v) => v === 0)) {
        let dif = 0;
        for (const d of diasDe(PERIODO).filter(
          (x) => x > "2031-06-05" && x <= HOJE,
        ))
          dif +=
            oraculo(d) -
            MOVS.filter(
              (m) => m.dia === d && m.tipo !== "transferencia",
            ).reduce(
              (t, m) =>
                t + (m.tipo === "entrada" ? cent(m.valor) : -cent(m.valor)),
              0,
            );
        assert.equal(
          cent(d0605.grafico - d0605.verdade),
          dif,
          "controle: diferenca de 05/06",
        );
      }
      await assert.rejects(
        () => verificar(c, ctx),
        /\[chave\]/,
        "controle: o corpo anterior passou na bateria",
      );
      const exemplos = erradas
        .filter((e) =>
          ["2031-06-05", "2031-06-10", "2031-06-13"].includes(e.dia),
        )
        .map(
          (e) =>
            `${e.dia.slice(8)}/06 mostra R$ ${e.grafico.toFixed(2)} (de verdade R$ ${e.verdade.toFixed(2)})`,
        )
        .join("; ");
      console.log(
        `  PASSOU controle: com o corpo anterior o grafico erra o saldo de ${erradas.length} dos 30 dias (${exemplos})`,
      );
    }

    // ---- 3. A MIGRATION, sobre a fixture que ja existia. ----
    await c.query(migration);
    assert.deepEqual(
      await funcao(c),
      topo,
      "apply nao reproduziu o topo instalado pelo CI",
    );
    assert.deepEqual(
      await dados(),
      dadosAntes,
      "apply alterou conta, lancamento, pedido ou estorno que ja existia",
    );
    await verificar(c, ctx);
    {
      const r = await resumoEm(c, PERIODO);
      const rec = reconstruir(r, { usarChave: true });
      assert.equal(rec.length, 30);
      assert.deepEqual(
        rec.map((p) => p.saldo),
        diasDe(PERIODO).map((d) => verdade.get(d)),
        "o saldo reconstruido dos 30 dias difere do de fin__saldos",
      );
      // O numero grande do topo e o do grafico em hoje sao o mesmo.
      assert.equal(rec.at(-1).saldo, cent(r.saldo_total));
    }
    console.log(
      "  PASSOU corpo novo: saldo_total - soma(variacao_saldo dos dias seguintes) = saldo de fin__saldos no fim de CADA um dos 30 dias (e no periodo que passa de hoje); a variacao de cada dia bate com o oraculo em JS; o resto do JSON e igual ao do corpo anterior; dado existente intacto",
    );

    // ---- 4. MUTANTES do corpo novo. ----
    const trocar = (de, para) => (b) => {
      assert.ok(b.includes(de), `a ancora do mutante sumiu do corpo: ${de}`);
      return b.replace(de, para);
    };
    const MUT = [
      [
        "sem o filtro de contas ativas",
        trocar(
          "JOIN public.fin_contas c ON c.ativa AND (",
          "JOIN public.fin_contas c ON (",
        ),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "filtro invertido (so as desativadas)",
        trocar(
          "JOIN public.fin_contas c ON c.ativa AND (",
          "JOIN public.fin_contas c ON NOT c.ativa AND (",
        ),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "conta desativada so no saldo_total, nao na serie",
        trocar(
          "'saldo_total', COALESCE((SELECT sum(saldo) FROM saldos WHERE ativa), 0)",
          "'saldo_total', COALESCE((SELECT sum(saldo) FROM saldos), 0)",
        ),
        /\[identidade\]/,
      ],
      [
        "sem o saldo_inicial_em",
        trocar(
          "WHERE m.data >= c.saldo_inicial_em AND m.data <= v_hoje",
          "WHERE m.data <= v_hoje",
        ),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "sem o teto de hoje",
        trocar(
          "WHERE m.data >= c.saldo_inicial_em AND m.data <= v_hoje",
          "WHERE m.data >= c.saldo_inicial_em",
        ),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "transferencia ignorada",
        (b) =>
          trocar(
            "                 WHEN m.tipo = 'transferencia' AND m.conta_id = c.id THEN -m.valor\n                 WHEN m.tipo = 'transferencia' AND m.conta_destino_id = c.id THEN m.valor\n",
            "",
          )(b),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "destino da transferencia com o sinal trocado",
        trocar(
          "WHEN m.tipo = 'transferencia' AND m.conta_destino_id = c.id THEN m.valor",
          "WHEN m.tipo = 'transferencia' AND m.conta_destino_id = c.id THEN -m.valor",
        ),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "origem da transferencia com o sinal trocado",
        trocar(
          "WHEN m.tipo = 'transferencia' AND m.conta_id = c.id THEN -m.valor",
          "WHEN m.tipo = 'transferencia' AND m.conta_id = c.id THEN m.valor",
        ),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "so a conta de origem (ignora o destino)",
        trocar(
          "(m.conta_id = c.id OR m.conta_destino_id = c.id)",
          "(m.conta_id = c.id)",
        ),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "saida com o sinal de entrada",
        trocar(
          "WHEN m.tipo = 'saida' AND m.conta_id = c.id THEN -m.valor",
          "WHEN m.tipo = 'saida' AND m.conta_id = c.id THEN m.valor",
        ),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "variacao = entradas - saidas (a conta do corpo anterior na chave nova)",
        trocar(
          "'variacao_saldo', COALESCE((SELECT sum(v.valor) FROM variacao v WHERE v.dia = d.dia::date), 0)",
          "'variacao_saldo', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'entrada'), 0) - COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'saida'), 0)",
        ),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "arredonda a variacao para reais inteiros",
        trocar("ELSE 0 END) AS valor", "ELSE 0 END)::bigint AS valor"),
        /\[(oraculo|identidade)\]/,
      ],
      [
        "o movimento previsto entra no periodo",
        trocar(
          "SELECT * FROM public.fin__movimentos(p_inicio, p_fim) WHERE status = 'realizado'",
          "SELECT * FROM public.fin__movimentos(p_inicio, p_fim) WHERE status IN ('realizado', 'previsto')",
        ),
        /\[(oraculo|identidade|resto)\]/,
      ],
      [
        "a chave com outro nome",
        trocar("'variacao_saldo', COALESCE(", "'variacao_do_saldo', COALESCE("),
        /\[chave\]/,
      ],
      [
        "so as entradas e saidas de TODAS as contas mudam (resto do JSON)",
        trocar(
          "'saidas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'saida'), 0),\n                 'variacao_saldo'",
          "'saidas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'saida' AND p.conta_id IN (SELECT id FROM public.fin_contas WHERE ativa)), 0),\n                 'variacao_saldo'",
        ),
        /\[resto\]/,
      ],
    ];
    for (const [rotulo, mutar, tag] of MUT)
      await isolado(c, async () => {
        const mutado = mutar(RESUMO_NOVO);
        assert.notEqual(
          mutado,
          RESUMO_NOVO,
          `mutante "${rotulo}" nao mudou nada`,
        );
        await instalarResumo(c, mutado);
        await assert.rejects(
          () => verificar(c, ctx),
          (e) => tag.test(e.message),
          `o mutante "${rotulo}" passou na bateria ou caiu na guarda errada`,
        );
      });
    console.log(
      `  PASSOU ${MUT.length} mutantes reprovam a bateria, cada um na guarda certa (sem o filtro de ativas, filtro invertido, desativada so no saldo, sem saldo_inicial_em, sem o teto de hoje, transferencia ignorada e com cada sinal trocado, so a origem, saida com sinal de entrada, entradas - saidas, arredondamento, previsto, chave com outro nome, resto do JSON)`,
    );

    // ---- 5. Reaplicar (LF e CRLF) e idempotencia; dados intactos. ----
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo, "reaplicar mudou algo");
    await c.query(emCRLF(migration));
    assert.deepEqual(
      await funcao(c),
      topo,
      "reaplicar o arquivo em CRLF mudou algo alem dos CR",
    );
    await verificar(c, ctx);
    assert.deepEqual(await dados(), dadosAntes, "reaplicar alterou dado");
    console.log(
      "  PASSOU reaplicar 2x e em CRLF: mesma funcao (OID, dono, ACL, atributos, texto); nenhuma conta, lancamento, pedido nem estorno mudou",
    );

    // ---- 6. Rollback byte a byte; segundo rollback recusa; o rollback da 3993 roda sobre o estado devolvido. ----
    await isolado(c, async () => {
      await c.query(rollback);
      const volta = await funcao(c);
      assert.equal(
        volta.prosrc,
        RESUMO_ANTES,
        "fin_resumo nao voltou byte a byte",
      );
      assert.equal(md5(volta.prosrc), H.antes);
      assert.equal(sha256(volta.prosrc), sha256(RESUMO_ANTES));
      assert.deepEqual(
        { ...volta, prosrc: null },
        { ...topo, prosrc: null },
        "o rollback mudou OID, dono, ACL ou atributo",
      );
      assert.deepEqual(await dados(), dadosAntes, "o rollback alterou dado");
      await c.query("SAVEPOINT rb2");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rb2");
      // O rollback da 20261399300000 aceita o estado que o nosso deixa e leva fin_resumo ao da 20261199.
      await isolado(c, async () => {
        await c.query(rollback3993);
        assert.equal(md5((await funcao(c)).prosrc), H.h199);
      });
      await c.query(emCRLF(migration));
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar depois do rollback nao deixou o topo",
      );
      await c.query(emCRLF(rollback));
      assert.equal(md5((await funcao(c)).prosrc), H.antes, "rollback em CRLF");
    });
    for (const [rotulo, estraga] of [
      [
        "fin_resumo desconhecido",
        () => instalarResumo(c, `${RESUMO_NOVO}\n-- estranho\n`),
      ],
      [
        "fin_resumo ainda no corpo da 3993 (rollback ja feito)",
        () => instalarResumo(c, RESUMO_ANTES),
      ],
      [
        "anon com EXECUTE",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${RESUMO} TO anon`),
      ],
      ["VOLATILE", () => c.query(`ALTER FUNCTION ${RESUMO} VOLATILE`)],
    ])
      await isolado(c, async () => {
        await estraga();
        const antes = await funcao(c);
        await c.query("SAVEPOINT rbrecusa");
        await assert.rejects(
          () => c.query(rollback),
          /B1_BASELINE_DIVERGENT/,
          `rollback aceitou: ${rotulo}`,
        );
        await c.query("ROLLBACK TO SAVEPOINT rbrecusa");
        assert.deepEqual(
          await funcao(c),
          antes,
          `rollback gravou apesar de recusar: ${rotulo}`,
        );
      });
    console.log(
      "  PASSOU rollback devolve o corpo da 3993 byte a byte (texto, md5, sha256) com os mesmos atributos e sem tocar em dado; o segundo rollback recusa; o rollback da 3993 roda sobre o estado devolvido; corpo desconhecido, ja desfeito, anon e VOLATILE recusam sem gravar",
    );

    // ---- 7. Pre-voo da migration: recusa sem escrever. ----
    const recusas = [
      [
        "fin_resumo com corpo desconhecido",
        () => instalarResumo(c, `${RESUMO_NOVO}\n-- estranho\n`),
        /corpo vivo de fin_resumo \(hash/,
      ],
      [
        "loja ainda no corpo da 20261199 (sem a 3993)",
        () => instalarResumo(c, RESUMO_199),
        new RegExp(`corpo vivo de fin_resumo \\(hash ${H.h199}\\)`),
      ],
      [
        "anon com EXECUTE",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${RESUMO} TO anon`),
        /ACL de fin_resumo/,
      ],
      [
        "PUBLIC com EXECUTE",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${RESUMO} TO PUBLIC`),
        /ACL de fin_resumo/,
      ],
      [
        "authenticated sem EXECUTE",
        () =>
          c.query(`REVOKE EXECUTE ON FUNCTION ${RESUMO} FROM authenticated`),
        /ACL de fin_resumo/,
      ],
      [
        "VOLATILE",
        () => c.query(`ALTER FUNCTION ${RESUMO} VOLATILE`),
        /atributos de fin_resumo/,
      ],
      [
        "SECURITY INVOKER",
        () => c.query(`ALTER FUNCTION ${RESUMO} SECURITY INVOKER`),
        /atributos de fin_resumo/,
      ],
      [
        "outro search_path",
        () =>
          c.query(
            `ALTER FUNCTION ${RESUMO} SET search_path = public, extensions`,
          ),
        /atributos de fin_resumo/,
      ],
      [
        "sobrecarga de fin_resumo",
        () =>
          c.query(
            "CREATE FUNCTION public.fin_resumo(p_x integer) RETURNS jsonb LANGUAGE sql AS $x$ SELECT '{}'::jsonb $x$",
          ),
        /fin_resumo tem sobrecarga/,
      ],
      [
        "fin__saldos com outro corpo",
        () =>
          c.query(
            "CREATE OR REPLACE FUNCTION public.fin__saldos() RETURNS TABLE (conta_id uuid, saldo numeric) LANGUAGE sql STABLE SET search_path = public AS $x$ SELECT c.id, c.saldo_inicial FROM public.fin_contas c $x$",
          ),
        /corpo vivo de fin__saldos nao e o conhecido/,
      ],
      [
        "fin__saldos ausente",
        () => c.query("DROP FUNCTION public.fin__saldos()"),
        /corpo vivo de fin__saldos nao e o conhecido/,
      ],
      [
        "fin__movimentos ausente",
        () =>
          c.query("DROP FUNCTION public.fin__movimentos(date,date) CASCADE"),
        /funcoes que o corpo novo chama nao existem: .*fin__movimentos/,
      ],
      [
        "coluna ativa de fin_contas ausente",
        () =>
          c.query(
            "ALTER TABLE public.fin_contas RENAME COLUMN ativa TO ativa_x",
          ),
        /colunas de fin_contas que o corpo novo le nao existem: ativa/,
      ],
    ];
    await isolado(c, async () => {
      await c.query(rollback); // as recusas partem da loja de ANTES: o vigente e o conhecido
      for (const [rotulo, estraga, mensagem] of recusas)
        await isolado(c, async () => {
          await estraga();
          const antes = await funcao(c);
          await c.query("SAVEPOINT recusa");
          await assert.rejects(
            () => c.query(migration),
            (e) =>
              /B1_BASELINE_DIVERGENT/.test(e.message) &&
              mensagem.test(e.message),
            `${rotulo}: a migration devia recusar`,
          );
          await c.query("ROLLBACK TO SAVEPOINT recusa");
          assert.deepEqual(
            await funcao(c),
            antes,
            `${rotulo}: a migration escreveu apesar de recusar`,
          );
        });
    });
    console.log(
      `  PASSOU pre-voo recusa sem escrever: ${recusas.length} estados (corpo desconhecido, loja ainda na 20261199, ACL de anon/PUBLIC/authenticated, VOLATILE, SECURITY INVOKER, search_path, sobrecarga, fin__saldos com outro corpo e ausente, fin__movimentos ausente, coluna ausente)`,
    );

    // ---- 8. A porta: cliente, ex-admin (so o JWT velho) e visitante recusados; admin atual chama; periodo invalido recusa. ----
    for (const [rotulo, id] of [
      ["cliente comum", CLIENTE],
      ["ex-admin", EX_ADMIN],
      ["sem sessao", ""],
    ])
      await isolado(c, async () => {
        await logar(c, id);
        await c.query("SAVEPOINT porta");
        await assert.rejects(
          () => c.query("SELECT public.fin_resumo($1, $2)", PERIODO),
          /Acesso negado/,
          `${rotulo} chamou fin_resumo`,
        );
        await c.query("ROLLBACK TO SAVEPOINT porta");
      });
    await isolado(c, async () => {
      await logar(c, ADMIN);
      await c.query("SELECT public.fin_resumo($1, $2)", PERIODO);
      for (const periodo of [
        ["2031-06-15", "2031-06-01"],
        ["2030-01-01", "2031-06-15"],
      ]) {
        await c.query("SAVEPOINT periodo");
        await assert.rejects(
          () => c.query("SELECT public.fin_resumo($1, $2)", periodo),
          /Per.odo inv.lido/,
        );
        await c.query("ROLLBACK TO SAVEPOINT periodo");
      }
      await c.query("SAVEPOINT periodo");
      await assert.rejects(
        () => c.query("SELECT public.fin_resumo(NULL, $1)", [HOJE]),
        /Per.odo inv.lido/,
      );
      await c.query("ROLLBACK TO SAVEPOINT periodo");
    });
    for (const [papel, esperado] of [
      ["anon", false],
      ["authenticated", true],
    ])
      assert.equal(
        (
          await c.query(
            `SELECT has_function_privilege($1, '${RESUMO}', 'EXECUTE') AS x`,
            [papel],
          )
        ).rows[0].x,
        esperado,
        `EXECUTE de ${papel}`,
      );
    // Mutante da porta: sem is_admin_atual, o ex-admin entra (a bateria da porta pega).
    await isolado(c, async () => {
      await instalarResumo(
        c,
        RESUMO_NOVO.replace(
          "IF NOT public.is_admin_atual() THEN",
          "IF FALSE THEN",
        ),
      );
      await logar(c, EX_ADMIN);
      await c.query("SELECT public.fin_resumo($1, $2)", PERIODO);
    });
    console.log(
      "  PASSOU a porta: cliente, ex-admin (so o papel antigo no JWT) e visitante recusados; admin atual chama; periodo invalido e NULL recusam; anon sem EXECUTE; sem is_admin_atual o ex-admin entraria",
    );

    // ---- 9. Consultas 141a/141b e as vizinhas (8e, 119a). ----
    // eslint-disable-next-line security/detect-non-literal-require -- caminho montado de literais do proprio teste, dentro do repositorio.
    const { ROL_FECHADO_POR_CONSULTA } = require(
      path.join(RAIZ, "scripts/publicacao/conferir-banco.cjs"),
    );
    const rodar = async (nome) =>
      (await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))).rows;
    const reprovadas = (rows) =>
      rows
        .filter((r) => r.ok !== true)
        .map((r) => r.item)
        .sort();
    const confereRol = (nome, rows) =>
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL_FECHADO_POR_CONSULTA[nome]].sort(),
        `${nome}: rol fechado`,
      );
    const mR = "fin_resumo: corpo exato (md5)";
    const dosDois = (rows) => rows.filter((r) => /^fin_resumo:/.test(r.item));
    const estranho = `${RESUMO_NOVO}\n-- estranho\n`;
    for (const [rotulo, poe, e141a, e141b] of [
      ["20261399985000 (topo)", async () => {}, [], [mR]],
      ["20261399300000 (rollback)", () => c.query(rollback), [mR], []],
    ])
      await isolado(c, async () => {
        await poe();
        const a = await rodar(C141A);
        const b = await rodar(C141B);
        confereRol(C141A, a);
        confereRol(C141B, b);
        assert.deepEqual(reprovadas(a), e141a, `141a com o corpo da ${rotulo}`);
        assert.deepEqual(reprovadas(b), e141b, `141b com o corpo da ${rotulo}`);
        // As vizinhas aceitam este corpo e o anterior (linhas de fin_resumo).
        assert.deepEqual(
          reprovadas(dosDois(await rodar(C119A))),
          [],
          `119a com o corpo da ${rotulo}`,
        );
        assert.deepEqual(
          reprovadas(await rodar(C8E)),
          [],
          `8e com o corpo da ${rotulo}`,
        );
      });
    await isolado(c, async () => {
      await instalarResumo(c, estranho);
      for (const nome of [C141A, C141B, C119A])
        assert.ok(
          reprovadas(dosDois(await rodar(nome))).includes(mR),
          `${nome}: aceitou fin_resumo estranho`,
        );
      assert.ok(
        reprovadas(await rodar(C8E)).length > 0,
        "8e aceitou fin_resumo estranho",
      );
    });
    // A conta que a migration repete: fin__saldos com outro corpo reprova a linha dele na 141a e na 141b.
    await isolado(c, async () => {
      await c.query(
        "CREATE OR REPLACE FUNCTION public.fin__saldos() RETURNS TABLE (conta_id uuid, saldo numeric) LANGUAGE sql STABLE SET search_path = public AS $x$ SELECT c.id, c.saldo_inicial FROM public.fin_contas c $x$",
      );
      for (const nome of [C141A, C141B])
        assert.ok(
          reprovadas(await rodar(nome)).includes(
            "fin__saldos: corpo exato (md5)",
          ),
          `${nome}: aceitou fin__saldos com outro corpo`,
        );
    });
    console.log(
      "  PASSOU 141a/141b (rol de 5 linhas; o corpo certo de cada lado) e as vizinhas 119a e 8e aceitam o corpo novo e o anterior e reprovam fin_resumo estranho; fin__saldos com outro corpo reprova a 141a e a 141b",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }

  // ---- 10. ATOMICIDADE E CONCORRENCIA, em conexoes SEM BEGIN: o estado e' commitado de verdade no clone descartavel. ----
  const d = new Client({ connectionString: lerDatabaseUrlEfemera() });
  const leitor = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await d.connect();
  await leitor.connect();
  const hash = async (cli = d) =>
    (
      await cli.query(
        `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = '${RESUMO}'::regprocedure`,
      )
    ).rows[0].h;
  try {
    assert.equal(await hash(), H.novo);
    await d.query(rollback);
    assert.equal(await hash(), H.antes);
    // (a) Falhar no fim, depois do CREATE: nada fica gravado.
    await assert.rejects(
      () => d.query(`${migration}\nSELECT 1/0;`),
      /division by zero/,
    );
    assert.equal(
      await hash(),
      H.antes,
      "a migration que falhou no fim deixou o corpo gravado",
    );
    // (b) Pos-voo reprovando o CORPO: a conferencia derruba a troca.
    const corpoErrado = migration.replace(
      "  v_hoje date := public.fin__hoje();\n  v_res jsonb;\n",
      "  v_hoje date := public.fin__hoje(); -- diferente\n  v_res jsonb;\n",
    );
    assert.notEqual(corpoErrado, migration);
    await assert.rejects(
      () => d.query(corpoErrado),
      /conferencia 20261399985: corpo vivo de fin_resumo \(hash/,
    );
    assert.equal(await hash(), H.antes, "pos-voo do corpo nao desfez a troca");
    // (c) Pos-voo reprovando um ATRIBUTO (mesmo texto, outra volatilidade).
    const partes = migration.split(" STABLE SECURITY DEFINER");
    assert.equal(
      partes.length,
      2,
      "esperava exatamente uma funcao STABLE SECURITY DEFINER",
    );
    await assert.rejects(
      () => d.query(`${partes[0]} VOLATILE SECURITY DEFINER${partes[1]}`),
      /conferencia 20261399985: atributos de fin_resumo mudaram/,
    );
    assert.equal(
      await hash(),
      H.antes,
      "pos-voo do atributo nao desfez a troca",
    );
    assert.equal(
      (
        await d.query(
          `SELECT provolatile FROM pg_proc WHERE oid = '${RESUMO}'::regprocedure`,
        )
      ).rows[0].provolatile,
      "s",
      "a volatilidade nao voltou",
    );
    // (d) Leitor concorrente: com a troca aberta numa transacao, quem le NAO espera e ve o corpo de antes (sem a chave);
    //     depois do COMMIT ve o novo (com a chave).
    await d.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@grafico39985.invalid', '{"role":"admin"}'::jsonb)`,
      [ADMIN],
    );
    await d.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Ficticio 39985', 'admin') ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
      [ADMIN],
    );
    await leitor.query("SELECT set_config('app.rpc.user_id', $1, false)", [
      ADMIN,
    ]);
    await leitor.query("SET statement_timeout = '4s'");
    await d.query("BEGIN");
    await d.query(migration);
    assert.equal(await hash(), H.novo);
    assert.equal(
      await hash(leitor),
      H.antes,
      "o leitor concorrente viu a troca antes do COMMIT",
    );
    const durante = (
      await leitor.query("SELECT public.fin_resumo($1, $2) AS r", PERIODO)
    ).rows[0].r;
    assert.ok(
      durante.serie.every((x) => !Object.hasOwn(x, "variacao_saldo")),
      "o leitor viu a chave antes do COMMIT",
    );
    await d.query("COMMIT");
    assert.equal(
      await hash(leitor),
      H.novo,
      "o leitor nao viu o corpo novo apos o COMMIT",
    );
    const depois = (
      await leitor.query("SELECT public.fin_resumo($1, $2) AS r", PERIODO)
    ).rows[0].r;
    assert.ok(
      depois.serie.every((x) => Object.hasOwn(x, "variacao_saldo")),
      "o leitor nao viu a chave apos o COMMIT",
    );
    // (e) Transacao interrompida no meio (ROLLBACK depois de aplicar): volta ao corpo de antes.
    await d.query(rollback);
    assert.equal(await hash(), H.antes);
    await d.query("BEGIN");
    await d.query(migration);
    await d.query("ROLLBACK");
    assert.equal(
      await hash(),
      H.antes,
      "o ROLLBACK da transacao nao desfez a migration",
    );
    await d.query(migration);
    assert.equal(await hash(), H.novo);
    console.log(
      "  PASSOU atomicidade em conexao SEM BEGIN: falhar no fim, pos-voo reprovando corpo e atributo e ROLLBACK no meio nao deixam nada gravado; o leitor concorrente nao espera e ve o corpo de antes (sem a chave) ate o COMMIT, o novo depois",
    );
  } finally {
    // Garante o estado final do clone: o corpo novo.
    await d.query("ROLLBACK").catch(() => {});
    await d.query(migration).catch(() => {});
    await leitor.end().catch(() => {});
    await d.end();
  }
  console.log("[o-grafico-do-financeiro] prova viva concluida (20261399985).");
}

main().catch((erro) => {
  console.error(
    `[o-grafico-do-financeiro] FALHOU: ${erro.stack || erro.message}`,
  );
  process.exit(1);
});
