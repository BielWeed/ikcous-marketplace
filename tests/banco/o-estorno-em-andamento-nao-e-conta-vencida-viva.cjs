"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-non-literal-regexp --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices e chaves de objeto vem de listas literais da
 * propria prova (HOJES, fixtures, JSON do banco), nunca de entrada externa; o RegExp monta o nome de funcao de uma lista fechada. */
/**
 * PROVA VIVA da migration 20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql (painel_inicio e fin_resumo) contra o
 * Postgres EFEMERO com as migrations aplicadas do zero (rpc-ci, job do dinheiro). Nunca banco de loja.
 *
 * O que prova:
 *  (1) O defeito e a correcao: estorno em andamento (order_refunds 'solicitado' / 'em_processamento') com vencimento no passado NAO
 *      conta em painel_inicio()->contas_vencidas nem em fin_resumo()->a_pagar.vencido. CONTROLE: o corpo anterior (o rollback) conta,
 *      na mesma fixture.
 *  (2) A conta que a lojista lancou (manual, sangria) vencida segue contando; vence HOJE nao e vencida; cancelada, realizada e
 *      estorno concluido/falhou/recusado nunca contaram. Contra um ORACULO escrito aqui (calculado das linhas, em JS), em quatro
 *      "hoje" diferentes (relogio da loja fixado so dentro de savepoint).
 *  (3) O que NAO muda: a_pagar_7d, a_receber_7d, a_pagar.total, a_pagar.proximos_7_dias e o resto do JSON dos dois: iguais ao corpo
 *      anterior, menos os dois campos.
 *  (4) As duas telas concordam entre si e com a aba "Pagar e receber" (fin_previstos): contagem e soma do que e vencido e nao e estorno.
 *  (5) MUTANTES dos dois corpos (sem a exclusao, exclusao a mais, so 'manual', vence-hoje conta...) reprovam a bateria.
 *  (6) Dados que ja existiam: aplicar e reaplicar (LF e CRLF) nao muda nenhum estorno, pedido nem lancamento.
 *  (7) Rollback devolve OS DOIS corpos byte a byte (md5 e sha256) com os mesmos atributos; o segundo rollback recusa; o rollback da
 *      20261398000000 roda sobre o estado devolvido.
 *  (8) Pre-voo (B1_BASELINE_DIVERGENT) recusa, sem escrever, corpo desconhecido (de cada funcao), ACL, atributos, sobrecarga, objeto
 *      ausente e a loja que ainda esta em outro corpo; uma loja com UMA das funcoes ja trocada completa a outra (idempotente).
 *  (9) A porta: cliente comum, ex-admin (so o JWT velho) e visitante nao chamam; admin atual chama.
 * (10) As consultas 119a/119b (e 116a/b, 97a/b, 8e, 17a, 30a) leem o estado certo e reprovam corpo estranho.
 * (11) Atomicidade em conexao SEM BEGIN: falhar no fim, pos-voo reprovando (corpo ou atributo, de cada funcao) e leitor concorrente.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-estorno-em-andamento-nao-e-conta-vencida-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME = "20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql";
const NOME_PAINEL_ANTES =
  "20261398000000_o_inicio_compara_o_mes_anterior_ate_a_mesma_hora.sql";
const NOME_RESUMO_ANTES =
  "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
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

const PAINEL = "public.painel_inicio()";
const RESUMO = "public.fin_resumo(date,date)";
const PAINEL_ANTES = corpoDe(
  ler(`supabase/migrations/${NOME_PAINEL_ANTES}`),
  "painel_inicio",
);
const RESUMO_ANTES = corpoDe(
  ler(`supabase/migrations/${NOME_RESUMO_ANTES}`),
  "fin_resumo",
);
const PAINEL_NOVO = corpoDe(migration, "painel_inicio");
const RESUMO_NOVO = corpoDe(migration, "fin_resumo");
const H = {
  painelAntes: "01d29aedf98b7f95851c1a1001b5c7ca",
  painelNovo: "8d58e15e7410afe0d254f37f38251df4",
  resumoAntes: "410668ed931d89e0a16a568b35df7973",
  resumoNovo: "a10e7f301eaf6b3edfac50bc87ff74bc",
};
// O corpo da 20261390 (o que o rollback da 20261398 deixa): a loja que ainda nao recebeu a 398.
const PAINEL_390 = corpoDe(
  ler(`supabase/migrations/rollback-manual-${NOME_PAINEL_ANTES}`),
  "painel_inicio",
);
const C119A =
  "119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado";
const C119B =
  "119b-antes-a-busca-por-palavras-e-o-estorno-fora-do-vencido-base-vigente";
const C116A =
  "116a-conferir-o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-aplicado";
const C116B =
  "116b-antes-o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-base-vigente";
const C97A = "97a-conferir-o-lucro-do-inicio-conta-o-mes-inteiro-aplicado";
const PORTOES = [
  "8e-conferir-92-a-202-aplicado",
  "17a-conferir-estoque-do-painel-aplicado",
  "30a-conferir-numeros-do-painel-aplicado",
];

const ADMIN = "5e399300-0000-4000-8000-000000000001";
const CLIENTE = "5e399300-0000-4000-8000-000000000002";
const EX_ADMIN = "5e399300-0000-4000-8000-000000000003";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const CAT_ALUGUEL = "f2000000-0000-4000-8000-000000000020";
const PERIODO = ["2031-01-01", "2031-12-31"];

const num = (v) => Math.round(Number(v) * 10000) / 10000;
const iso = (d) => d.toISOString().slice(0, 10);
const somaDias = (dia, n) =>
  iso(new Date(new Date(`${dia}T00:00:00Z`).getTime() + n * 86400000));

// ---------------------------------------------------------------------------------------------------------------------
// A fixture, declarada em JS: o ORACULO sai daqui, sem chamar nenhuma funcao do banco.
// ---------------------------------------------------------------------------------------------------------------------
// Contas lancadas pela lojista (fin_lancamentos).
const LANCAMENTOS = [
  {
    id: "L1 manual vencida",
    tipo: "saida",
    status: "previsto",
    origem: "manual",
    venc: "2031-06-10",
    valor: 40,
  },
  {
    id: "L2 manual vencida",
    tipo: "saida",
    status: "previsto",
    origem: "manual",
    venc: "2031-06-14",
    valor: 25.5,
  },
  {
    id: "L3 sangria vencida",
    tipo: "saida",
    status: "previsto",
    origem: "sangria",
    venc: "2031-06-12",
    valor: 15,
  },
  {
    id: "L4 vence hoje",
    tipo: "saida",
    status: "previsto",
    origem: "manual",
    venc: "2031-06-15",
    valor: 7,
  },
  {
    id: "L5 futura",
    tipo: "saida",
    status: "previsto",
    origem: "manual",
    venc: "2031-06-20",
    valor: 100,
  },
  {
    id: "L6 cancelada",
    tipo: "saida",
    status: "cancelado",
    origem: "manual",
    venc: "2031-06-01",
    valor: 50,
  },
  {
    id: "L7 paga",
    tipo: "saida",
    status: "realizado",
    origem: "manual",
    venc: "2031-06-01",
    valor: 60,
    realizado: "2031-06-05",
  },
  {
    id: "L8 a receber vencida",
    tipo: "entrada",
    status: "previsto",
    origem: "manual",
    venc: "2031-06-02",
    valor: 70,
  },
];
// Pedidos de estorno (order_refunds); `criado` e' o instante (-03:00 = Sao Paulo) e o dia do vencimento do movimento previsto.
const ESTORNOS = [
  {
    id: "R1 solicitado vencido",
    status: "solicitado",
    criado: "2031-06-10 12:00:00-03",
    valor: 30,
  },
  {
    id: "R2 em_processamento vencido",
    status: "em_processamento",
    criado: "2031-06-13 12:00:00-03",
    valor: 12.34,
  },
  {
    id: "R3 solicitado hoje",
    status: "solicitado",
    criado: "2031-06-15 10:00:00-03",
    valor: 5,
  },
  {
    id: "R4 solicitado futuro",
    status: "solicitado",
    criado: "2031-06-18 10:00:00-03",
    valor: 8,
  },
  {
    id: "R5 concluido",
    status: "concluido",
    criado: "2031-06-09 12:00:00-03",
    concluido: "2031-06-11 12:00:00-03",
    valor: 20,
  },
  {
    id: "R6 falhou",
    status: "falhou",
    criado: "2031-06-08 12:00:00-03",
    valor: 9,
  },
  {
    id: "R7 recusado",
    status: "recusado",
    criado: "2031-06-07 12:00:00-03",
    valor: 11,
  },
];
const diaDe = (criado) => criado.slice(0, 10);
const HOJES = ["2031-06-15", "2031-07-20", "2031-06-10", "2031-06-01"];

/** O que cada numero DEVE valer (so das linhas da fixture), em `hoje`. `contaEstorno` = o corpo anterior. */
function oraculo(hoje, { contaEstorno }) {
  const prev = [
    ...LANCAMENTOS.filter((l) => l.status === "previsto").map((l) => ({
      tipo: l.tipo,
      origem: l.origem,
      venc: l.venc,
      valor: l.valor,
    })),
    ...ESTORNOS.filter((e) =>
      ["solicitado", "em_processamento"].includes(e.status),
    ).map((e) => ({
      tipo: "saida",
      origem: "estorno",
      venc: diaDe(e.criado),
      valor: e.valor,
    })),
  ];
  const saidas = prev.filter((p) => p.tipo === "saida");
  const vencidas = saidas.filter(
    (p) => p.venc < hoje && (contaEstorno || p.origem !== "estorno"),
  );
  const soma = (l) => num(l.reduce((s, p) => s + p.valor, 0));
  const ate7 = somaDias(hoje, 7);
  return {
    contas_vencidas: vencidas.length,
    pagar_vencido: soma(vencidas),
    pagar_total: soma(saidas),
    pagar_7d: soma(saidas.filter((p) => p.venc <= ate7)),
    pagar_proximos: soma(
      saidas.filter((p) => p.venc >= hoje && p.venc <= ate7),
    ),
    receber_7d: soma(
      prev.filter((p) => p.tipo === "entrada" && p.venc <= ate7),
    ),
    receber_total: soma(prev.filter((p) => p.tipo === "entrada")),
    receber_vencido: soma(
      prev.filter((p) => p.tipo === "entrada" && p.venc < hoje),
    ),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------------------------------------------------
async function funcao(c, assinatura) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${assinatura}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
const ambas = async (c) => ({
  painel: await funcao(c, PAINEL),
  resumo: await funcao(c, RESUMO),
});
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso3993");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3993");
    await c.query("RELEASE SAVEPOINT caso3993");
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
const instalarPainel = (c, corpo) =>
  c.query(
    `CREATE OR REPLACE FUNCTION public.painel_inicio() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$${corpo}$x$`,
  );
const instalarResumo = (c, corpo) =>
  c.query(
    `CREATE OR REPLACE FUNCTION public.fin_resumo(p_inicio date, p_fim date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$${corpo}$x$`,
  );
const inicio = async (c) =>
  (await c.query("SELECT public.painel_inicio() AS r")).rows[0].r;
const resumo = async (c) =>
  (await c.query("SELECT public.fin_resumo($1, $2) AS r", PERIODO)).rows[0].r;
const previstos = async (c, tipo) =>
  (await c.query("SELECT public.fin_previstos($1) AS r", [tipo])).rows[0].r;
// Acha a primeira chave `k` em qualquer nivel do JSON.
function achar(obj, k) {
  if (obj && typeof obj === "object") {
    if (Object.hasOwn(obj, k)) return obj[k];
    for (const v of Object.values(obj)) {
      const r = achar(v, k);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}
// Copia sem a chave `k` (em qualquer nivel).
function sem(obj, k) {
  if (Array.isArray(obj)) return obj.map((x) => sem(x, k));
  if (obj && typeof obj === "object")
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([c]) => c !== k)
        .map(([c, v]) => [c, sem(v, k)]),
    );
  return obj;
}
/** Os numeros do dia `hoje` (relogio da loja fixado dentro de um savepoint). */
async function medir(c, hoje) {
  return isolado(c, async () => {
    await fixarRelogio(c, hoje);
    await logar(c, ADMIN);
    const p = await inicio(c);
    const r = await resumo(c);
    return {
      contas_vencidas: Number(achar(p, "contas_vencidas")),
      pagar_7d: num(achar(p, "a_pagar_7d")),
      receber_7d: num(achar(p, "a_receber_7d")),
      pagar_vencido: num(r.a_pagar.vencido),
      pagar_total: num(r.a_pagar.total),
      pagar_proximos: num(r.a_pagar.proximos_7_dias),
      receber_total: num(r.a_receber.total),
      receber_vencido: num(r.a_receber.vencido),
    };
  });
}
const somar = (a, b) =>
  Object.fromEntries(Object.keys(a).map((k) => [k, num(a[k] + b[k])]));

/**
 * A BATERIA. Passa nos corpos novos; tem de FALHAR no anterior e em cada mutante.
 * `base` = o que o banco ja tinha antes da fixture, por "hoje" (medido com o corpo correspondente).
 */
async function verificar(c, base) {
  for (const hoje of HOJES) {
    const esperado = somar(base[hoje], oraculo(hoje, { contaEstorno: false }));
    assert.deepEqual(
      await medir(c, hoje),
      esperado,
      `os numeros de ${hoje} divergem do oraculo`,
    );
    // As duas telas concordam entre si e com a aba "Pagar e receber": mesma fonte, mesma regra.
    await isolado(c, async () => {
      await fixarRelogio(c, hoje);
      await logar(c, ADMIN);
      const lista = await previstos(c, "saida");
      const vencidasDaAba = lista.filter(
        (x) => x.vencido === true && x.origem !== "estorno",
      );
      assert.equal(
        Number(achar(await inicio(c), "contas_vencidas")),
        vencidasDaAba.length,
        `${hoje}: contas_vencidas do Inicio diverge da aba Pagar e receber`,
      );
      assert.equal(
        num((await resumo(c)).a_pagar.vencido),
        num(vencidasDaAba.reduce((s, x) => s + Number(x.valor), 0)),
        `${hoje}: o Vencido da Visao diverge da aba Pagar e receber`,
      );
      // O estorno em andamento segue LISTADO na aba (so sai do alarme).
      assert.equal(
        lista.filter((x) => x.origem === "estorno").length,
        ESTORNOS.filter((e) =>
          ["solicitado", "em_processamento"].includes(e.status),
        ).length,
        `${hoje}: o estorno em andamento sumiu da aba Pagar e receber`,
      );
    });
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
         VALUES ($1::uuid, $1::text || '@estorno3993.invalid', $2::jsonb)`,
        [id, JSON.stringify(noAuth ? { role: noAuth } : {})],
      );
    for (const [id, papel] of [
      [ADMIN, "admin"],
      [CLIENTE, "customer"],
      [EX_ADMIN, "customer"],
    ])
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 3993', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papel],
      );
    // O gatilho de profiles sincroniza auth.users: o papel contraditorio do ex-admin (admin so em auth.users, cliente em profiles) nasce DEPOIS dele.
    for (const [id, papelAuth] of [
      [ADMIN, { role: "admin" }],
      [CLIENTE, {}],
      [EX_ADMIN, { role: "admin" }],
    ])
      await c.query(
        "UPDATE auth.users SET raw_app_meta_data = $2::jsonb WHERE id = $1::uuid",
        [id, JSON.stringify(papelAuth)],
      );
    assert.deepEqual(
      (
        await c.query(
          `SELECT p.role AS perfil, u.raw_app_meta_data->>'role' AS papel_auth
             FROM auth.users u JOIN public.profiles p ON p.id = u.id
            WHERE u.id = ANY($1::uuid[]) ORDER BY u.id`,
          [[ADMIN, CLIENTE, EX_ADMIN]],
        )
      ).rows.map((r) => [r.perfil, r.papel_auth]),
      [
        ["admin", "admin"],
        ["customer", null],
        ["customer", "admin"],
      ],
      "os atores nasceram como o teste declara (o ex-admin e admin so em auth.users)",
    );

    // ---- 0. O topo instalado pelo CI e o desta migration; os anteriores sao os conhecidos. ----
    const topo = await ambas(c);
    assert.equal(
      topo.painel.prosrc,
      PAINEL_NOVO,
      "o topo de painel_inicio nao e o da 3993",
    );
    assert.equal(
      topo.resumo.prosrc,
      RESUMO_NOVO,
      "o topo de fin_resumo nao e o da 3993",
    );
    assert.equal(md5(PAINEL_NOVO), H.painelNovo);
    assert.equal(md5(RESUMO_NOVO), H.resumoNovo);
    assert.equal(
      md5(PAINEL_ANTES),
      H.painelAntes,
      "o anterior de painel_inicio nao e o da 398",
    );
    assert.equal(
      md5(PAINEL_390),
      "b4aa318b777824bd49aab4175d9133f8",
      "o corpo da 390 mudou",
    );
    assert.equal(
      md5(RESUMO_ANTES),
      H.resumoAntes,
      "o anterior de fin_resumo nao e o da 1199",
    );
    // So as duas linhas mudam: o diff do painel e do resumo e' a exclusao do estorno (2 + 2 linhas de comentario).
    assert.equal(
      PAINEL_NOVO.replace(" AND origem <> 'estorno'", "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n"),
      PAINEL_ANTES.split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n"),
      "o corpo novo de painel_inicio muda mais do que a exclusao do estorno",
    );
    assert.equal(
      RESUMO_NOVO.replace(" AND origem <> 'estorno'", "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n"),
      RESUMO_ANTES.split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n"),
      "o corpo novo de fin_resumo muda mais do que a exclusao do estorno",
    );
    console.log(
      `  PASSOU o topo sao os corpos da 3993 (painel_inicio ${H.painelNovo}, fin_resumo ${H.resumoNovo}) e eles diferem dos anteriores SO pela exclusao do estorno`,
    );

    // ---- 1. Base: o que o banco ja tem ANTES da fixture, com cada corpo. ----
    const baseNovo = {};
    for (const hoje of HOJES) baseNovo[hoje] = await medir(c, hoje);
    await c.query(rollback);
    const baseAntigo = {};
    for (const hoje of HOJES) baseAntigo[hoje] = await medir(c, hoje);
    assert.deepEqual(
      baseAntigo,
      baseNovo,
      "o banco ja tinha estorno vencido antes da fixture",
    );

    // ---- 2. A fixture, com o corpo ANTERIOR no ar: dados que JA existiam antes da migration. ----
    const pedido = async (total) =>
      (
        await c.query(
          `INSERT INTO public.marketplace_orders
             (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at, created_at)
           VALUES ($1, 'Cliente 3993', '{}'::jsonb, $2, $2, 'delivered', 'online', 'online', 'pago',
                   TIMESTAMPTZ '2031-05-01 10:00:00-03', TIMESTAMPTZ '2031-05-01 10:00:00-03')
           RETURNING id`,
          [CLIENTE, total],
        )
      ).rows[0].id;
    for (const l of LANCAMENTOS)
      await c.query(
        `INSERT INTO public.fin_lancamentos
           (tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
            data_competencia, data_vencimento, data_realizacao, origem, cancelado_em)
         VALUES ($1, $2, $3, $4, $5, $6, 'dinheiro', $7, $7, $8, $9, $10)`,
        [
          l.tipo,
          l.status,
          l.valor,
          CAIXA,
          CAT_ALUGUEL,
          l.id,
          l.venc,
          l.realizado ?? null,
          l.origem,
          l.status === "cancelado" ? "2031-06-02 10:00:00-03" : null,
        ],
      );
    for (const e of ESTORNOS) {
      const ped = await pedido(200);
      await c.query(
        `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, motivo, created_at, updated_at, concluido_em)
         VALUES ($1, $2, 'lojista', $3, $4, $5, $5, $6)`,
        [ped, e.valor, e.status, e.id, e.criado, e.concluido ?? null],
      );
    }
    const dumpDe = async (tabela) =>
      (
        await c.query(
          `SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS h, count(*) AS n FROM public.${tabela} x`,
        )
      ).rows[0];
    const dadosAntes = {
      refunds: await dumpDe("order_refunds"),
      lanc: await dumpDe("fin_lancamentos"),
      pedidos: await dumpDe("marketplace_orders"),
    };
    assert.equal(Number(dadosAntes.refunds.n), ESTORNOS.length);
    assert.equal(Number(dadosAntes.lanc.n), LANCAMENTOS.length);

    // ---- 3. CONTROLE: o corpo anterior conta o estorno em andamento como conta vencida NESTA fixture. ----
    const anterior = await ambas(c);
    assert.equal(
      anterior.painel.prosrc,
      PAINEL_ANTES,
      "o rollback nao devolveu painel_inicio da 398 byte a byte",
    );
    assert.equal(
      anterior.resumo.prosrc,
      RESUMO_ANTES,
      "o rollback nao devolveu fin_resumo da 1199 byte a byte",
    );
    for (const hoje of HOJES) {
      assert.deepEqual(
        await medir(c, hoje),
        somar(baseAntigo[hoje], oraculo(hoje, { contaEstorno: true })),
        `controle: o corpo anterior em ${hoje} nao reproduz a conta do oraculo antigo`,
      );
    }
    const defeito = await medir(c, "2031-06-15");
    assert.equal(
      defeito.contas_vencidas - baseAntigo["2031-06-15"].contas_vencidas,
      5,
      "controle: 3 contas + 2 estornos",
    );
    await assert.rejects(
      () => verificar(c, baseNovo),
      "controle: o corpo anterior passou na bateria inteira",
    );
    console.log(
      "  PASSOU controle: em 15/06/2031 o corpo anterior mostra 5 contas vencidas (3 contas + os 2 estornos em andamento) e R$ 122,84 vencidos; o oraculo antigo confere nos 4 'hoje'",
    );

    // Referencia do JSON inteiro com o corpo anterior (para provar que o resto nao muda).
    const jsonAntes = {};
    for (const hoje of HOJES)
      jsonAntes[hoje] = await isolado(c, async () => {
        await fixarRelogio(c, hoje);
        await logar(c, ADMIN);
        return { painel: await inicio(c), resumo: await resumo(c) };
      });

    // ---- 4. A MIGRATION, sobre a fixture que ja existia ----
    await c.query(migration);
    assert.deepEqual(
      await ambas(c),
      topo,
      "apply nao reproduziu o topo instalado pelo CI",
    );
    assert.deepEqual(
      {
        refunds: await dumpDe("order_refunds"),
        lanc: await dumpDe("fin_lancamentos"),
        pedidos: await dumpDe("marketplace_orders"),
      },
      dadosAntes,
      "apply alterou estorno, lancamento ou pedido que ja existia",
    );
    await verificar(c, baseNovo);
    const e15 = await medir(c, "2031-06-15");
    assert.equal(
      e15.contas_vencidas - baseNovo["2031-06-15"].contas_vencidas,
      3,
    );
    assert.equal(
      e15.pagar_vencido - baseNovo["2031-06-15"].pagar_vencido,
      80.5,
    );
    console.log(
      "  PASSOU em 15/06/2031: 3 contas vencidas (so as lancadas pela lojista: manual, manual e sangria), R$ 80,50; o estorno em andamento fica fora; vence-hoje, futura, cancelada, paga e estorno concluido/falhou/recusado nao contam; 4 'hoje' = oraculo; as duas telas e a aba Pagar e receber concordam",
    );

    // ---- 5. O que NAO muda: o JSON inteiro dos dois, menos os dois campos. ----
    for (const hoje of HOJES) {
      await isolado(c, async () => {
        await fixarRelogio(c, hoje);
        await logar(c, ADMIN);
        const novo = { painel: await inicio(c), resumo: await resumo(c) };
        const antes = jsonAntes[hoje];
        assert.deepEqual(
          sem(novo.painel, "contas_vencidas"),
          sem(antes.painel, "contas_vencidas"),
          `${hoje}: o resto do JSON de painel_inicio mudou`,
        );
        const semVencido = (r) => ({
          ...r,
          a_pagar: {
            total: r.a_pagar.total,
            proximos_7_dias: r.a_pagar.proximos_7_dias,
          },
        });
        assert.deepEqual(
          semVencido(novo.resumo),
          semVencido(antes.resumo),
          `${hoje}: o resto do JSON de fin_resumo mudou`,
        );
        assert.equal(
          achar(novo.painel, "a_pagar_7d"),
          achar(antes.painel, "a_pagar_7d"),
          `${hoje}: a_pagar_7d mudou (de proposito ele segue somando o estorno previsto)`,
        );
      });
    }
    assert.ok(
      (await medir(c, "2031-06-15")).pagar_7d > 0,
      "fixture: a_pagar_7d precisa ser positivo",
    );
    console.log(
      "  PASSOU o resto do JSON dos dois (a_pagar_7d, a_receber_7d, a_pagar.total, proximos_7_dias, saldo, mes, hoje, pendencias, DRE, formas...) e IGUAL ao do corpo anterior, nos 4 'hoje'; so contas_vencidas e a_pagar.vencido mudam",
    );

    // ---- 6. MUTANTES dos dois corpos ----
    const MUT_PAINEL = [
      [
        "painel sem a exclusao",
        (b) => b.replace(" AND origem <> 'estorno'", ""),
      ],
      [
        "painel exclui tambem de a_pagar_7d",
        (b) =>
          b.replace(
            "FROM prev WHERE tipo = 'saida' AND venc <= v_hoje + 7)",
            "FROM prev WHERE tipo = 'saida' AND venc <= v_hoje + 7 AND origem <> 'estorno')",
          ),
      ],
      [
        "painel conta so a origem manual",
        (b) => b.replace("origem <> 'estorno'", "origem = 'manual'"),
      ],
      [
        "painel: vence hoje ja e vencida",
        (b) =>
          b.replace("venc < v_hoje AND origem", "venc <= v_hoje AND origem"),
      ],
      [
        "painel soma o valor em vez de contar",
        (b) =>
          b.replace(
            "'contas_vencidas', (SELECT count(*)",
            "'contas_vencidas', (SELECT COALESCE(sum(valor), 0)",
          ),
      ],
    ];
    const MUT_RESUMO = [
      [
        "resumo sem a exclusao",
        (b) => b.replace(" AND origem <> 'estorno'", ""),
      ],
      [
        "resumo exclui tambem de a_pagar.total",
        (b) =>
          b.replace(
            "'total', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida'), 0)",
            "'total', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida' AND origem <> 'estorno'), 0)",
          ),
      ],
      [
        "resumo exclui tambem de proximos_7_dias",
        (b) =>
          b.replace(
            "WHERE tipo = 'saida' AND venc BETWEEN v_hoje AND v_hoje + 7)",
            "WHERE tipo = 'saida' AND venc BETWEEN v_hoje AND v_hoje + 7 AND origem <> 'estorno')",
          ),
      ],
      [
        "resumo conta so a origem manual",
        (b) => b.replace("origem <> 'estorno'", "origem = 'manual'"),
      ],
      [
        "resumo: vence hoje ja e vencida",
        (b) =>
          b.replace("venc < v_hoje AND origem", "venc <= v_hoje AND origem"),
      ],
    ];
    for (const [rotulo, mutar] of MUT_PAINEL)
      await isolado(c, async () => {
        const mutado = mutar(PAINEL_NOVO);
        assert.notEqual(
          mutado,
          PAINEL_NOVO,
          `mutante "${rotulo}" nao mudou nada`,
        );
        await instalarPainel(c, mutado);
        await assert.rejects(
          () => verificar(c, baseNovo),
          `o mutante "${rotulo}" passou na bateria`,
        );
      });
    for (const [rotulo, mutar] of MUT_RESUMO)
      await isolado(c, async () => {
        const mutado = mutar(RESUMO_NOVO);
        assert.notEqual(
          mutado,
          RESUMO_NOVO,
          `mutante "${rotulo}" nao mudou nada`,
        );
        await instalarResumo(c, mutado);
        await assert.rejects(
          () => verificar(c, baseNovo),
          `o mutante "${rotulo}" passou na bateria`,
        );
      });
    console.log(
      `  PASSOU ${MUT_PAINEL.length + MUT_RESUMO.length} mutantes reprovam a bateria (sem a exclusao nos dois, exclusao a mais em a_pagar_7d / total / proximos_7_dias, so 'manual', vence-hoje conta, soma no lugar de contagem)`,
    );

    // ---- 7. Reaplicar (LF e CRLF) e idempotencia; dados intactos. ----
    await c.query(migration);
    assert.deepEqual(await ambas(c), topo, "reaplicar mudou algo");
    await c.query(emCRLF(migration));
    assert.deepEqual(
      await ambas(c),
      topo,
      "reaplicar o arquivo em CRLF mudou algo alem dos CR",
    );
    await verificar(c, baseNovo);
    await c.query(migration);
    assert.deepEqual(await ambas(c), topo);
    assert.deepEqual(
      {
        refunds: await dumpDe("order_refunds"),
        lanc: await dumpDe("fin_lancamentos"),
        pedidos: await dumpDe("marketplace_orders"),
      },
      dadosAntes,
      "reaplicar alterou dado",
    );
    // Loja com UMA das duas funcoes ja trocada (aplicacao interrompida de outra forma): a migration completa a outra.
    for (const [rotulo, volta] of [
      [
        "so painel_inicio no corpo anterior",
        () => instalarPainel(c, PAINEL_ANTES),
      ],
      [
        "so fin_resumo no corpo anterior",
        () => instalarResumo(c, RESUMO_ANTES),
      ],
    ])
      await isolado(c, async () => {
        await volta();
        await c.query(migration);
        assert.deepEqual(
          await ambas(c),
          topo,
          `${rotulo}: a migration nao completou`,
        );
      });
    console.log(
      "  PASSOU reaplicar 2x e em CRLF: mesmas funcoes (OID, dono, ACL, atributos, texto), nenhum estorno, pedido nem lancamento mudou; loja com uma das duas ja trocada: a migration completa a outra",
    );

    // ---- 8. Rollback byte a byte; segundo rollback recusa; o rollback da 398 roda sobre o estado devolvido. ----
    await isolado(c, async () => {
      await c.query(rollback);
      const volta = await ambas(c);
      assert.equal(
        volta.painel.prosrc,
        PAINEL_ANTES,
        "painel_inicio nao voltou byte a byte",
      );
      assert.equal(
        volta.resumo.prosrc,
        RESUMO_ANTES,
        "fin_resumo nao voltou byte a byte",
      );
      assert.equal(md5(volta.painel.prosrc), H.painelAntes);
      assert.equal(md5(volta.resumo.prosrc), H.resumoAntes);
      assert.equal(sha256(volta.painel.prosrc), sha256(PAINEL_ANTES));
      assert.equal(sha256(volta.resumo.prosrc), sha256(RESUMO_ANTES));
      for (const k of ["painel", "resumo"])
        assert.deepEqual(
          { ...volta[k], prosrc: null },
          { ...topo[k], prosrc: null },
          `o rollback mudou OID, dono, ACL ou atributo de ${k}`,
        );
      assert.deepEqual(
        {
          refunds: await dumpDe("order_refunds"),
          lanc: await dumpDe("fin_lancamentos"),
          pedidos: await dumpDe("marketplace_orders"),
        },
        dadosAntes,
        "o rollback alterou dado",
      );
      // O defeito volta (e' o que o rollback faz).
      const d = await medir(c, "2031-06-15");
      assert.equal(
        d.contas_vencidas - baseAntigo["2031-06-15"].contas_vencidas,
        5,
      );
      await isolado(c, async () => {
        await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      });
      // O rollback da 20261398 (painel_inicio) aceita o estado que o nosso deixa.
      await isolado(c, async () => {
        await c.query(
          ler(`supabase/migrations/rollback-manual-${NOME_PAINEL_ANTES}`),
        );
        assert.equal(
          md5((await funcao(c, PAINEL)).prosrc),
          "b4aa318b777824bd49aab4175d9133f8",
        );
      });
      await c.query(emCRLF(migration));
      assert.deepEqual(
        await ambas(c),
        topo,
        "reaplicar depois do rollback nao deixou o topo",
      );
      await c.query(emCRLF(rollback));
      assert.equal(
        md5((await funcao(c, PAINEL)).prosrc),
        H.painelAntes,
        "rollback em CRLF",
      );
      assert.equal(
        md5((await funcao(c, RESUMO)).prosrc),
        H.resumoAntes,
        "rollback em CRLF",
      );
    });
    // O pre-voo do rollback: recusa corpo desconhecido de QUALQUER das duas, sem escrever nenhuma.
    for (const [rotulo, estraga] of [
      [
        "painel_inicio desconhecido",
        async () => instalarPainel(c, `${PAINEL_NOVO}\n-- estranho\n`),
      ],
      [
        "fin_resumo desconhecido",
        async () => instalarResumo(c, `${RESUMO_NOVO}\n-- estranho\n`),
      ],
      [
        "so painel_inicio no corpo anterior",
        async () => instalarPainel(c, PAINEL_ANTES),
      ],
      [
        "so fin_resumo no corpo anterior",
        async () => instalarResumo(c, RESUMO_ANTES),
      ],
      [
        "anon com EXECUTE",
        async () => c.query(`GRANT EXECUTE ON FUNCTION ${PAINEL} TO anon`),
      ],
      [
        "fin_resumo VOLATILE",
        async () => c.query(`ALTER FUNCTION ${RESUMO} VOLATILE`),
      ],
    ])
      await isolado(c, async () => {
        await estraga();
        const antes = await ambas(c);
        await c.query("SAVEPOINT rbrecusa3993");
        await assert.rejects(
          () => c.query(rollback),
          /B1_BASELINE_DIVERGENT/,
          `rollback aceitou: ${rotulo}`,
        );
        await c.query("ROLLBACK TO SAVEPOINT rbrecusa3993");
        assert.deepEqual(
          await ambas(c),
          antes,
          `rollback gravou apesar de recusar: ${rotulo}`,
        );
      });
    console.log(
      "  PASSOU rollback devolve os DOIS corpos byte a byte (texto, md5, sha256) com os mesmos atributos e sem tocar em dado; o segundo rollback recusa; o rollback da 398 roda sobre o estado devolvido; corpo desconhecido, estado pela metade, anon e VOLATILE recusam sem gravar",
    );

    // ---- 9. Pre-voo da migration: recusa sem escrever. ----
    const estranhoP = `${PAINEL_NOVO}\n-- estranho\n`;
    const estranhoR = `${RESUMO_NOVO}\n-- estranho\n`;
    const recusas = [
      [
        "painel_inicio com corpo desconhecido",
        async () => instalarPainel(c, estranhoP),
        /corpo vivo de public\.painel_inicio\(\) \(hash/,
      ],
      [
        "fin_resumo com corpo desconhecido",
        async () => instalarResumo(c, estranhoR),
        /corpo vivo de public\.fin_resumo\(date,date\) \(hash/,
      ],
      [
        "painel_inicio ainda no corpo da 390 (loja sem a 398)",
        async () => instalarPainel(c, PAINEL_390),
        /corpo vivo de public\.painel_inicio\(\) \(hash b4aa318b777824bd49aab4175d9133f8\)/,
      ],
      [
        "anon com EXECUTE no painel",
        async () => c.query(`GRANT EXECUTE ON FUNCTION ${PAINEL} TO anon`),
        /ACL de public\.painel_inicio\(\)/,
      ],
      [
        "anon com EXECUTE no resumo",
        async () => c.query(`GRANT EXECUTE ON FUNCTION ${RESUMO} TO anon`),
        /ACL de public\.fin_resumo\(date,date\)/,
      ],
      [
        "PUBLIC com EXECUTE no resumo",
        async () => c.query(`GRANT EXECUTE ON FUNCTION ${RESUMO} TO PUBLIC`),
        /ACL de public\.fin_resumo\(date,date\)/,
      ],
      [
        "authenticated sem EXECUTE no resumo",
        async () =>
          c.query(`REVOKE EXECUTE ON FUNCTION ${RESUMO} FROM authenticated`),
        /ACL de public\.fin_resumo\(date,date\)/,
      ],
      [
        "service_role sem EXECUTE no painel",
        async () =>
          c.query(`REVOKE EXECUTE ON FUNCTION ${PAINEL} FROM service_role`),
        /ACL de public\.painel_inicio\(\)/,
      ],
      [
        "painel_inicio VOLATILE",
        async () => c.query(`ALTER FUNCTION ${PAINEL} VOLATILE`),
        /atributos de public\.painel_inicio\(\)/,
      ],
      [
        "fin_resumo SECURITY INVOKER",
        async () => c.query(`ALTER FUNCTION ${RESUMO} SECURITY INVOKER`),
        /atributos de public\.fin_resumo\(date,date\)/,
      ],
      [
        "fin_resumo com outro search_path",
        async () =>
          c.query(
            `ALTER FUNCTION ${RESUMO} SET search_path = public, extensions`,
          ),
        /atributos de public\.fin_resumo\(date,date\)/,
      ],
      [
        "sobrecarga de fin_resumo",
        async () =>
          c.query(
            "CREATE FUNCTION public.fin_resumo(p_x integer) RETURNS jsonb LANGUAGE sql AS $x$ SELECT '{}'::jsonb $x$",
          ),
        /fin_resumo tem sobrecarga/,
      ],
      [
        "sobrecarga de painel_inicio",
        async () =>
          c.query(
            "CREATE FUNCTION public.painel_inicio(p_x integer) RETURNS jsonb LANGUAGE sql AS $x$ SELECT '{}'::jsonb $x$",
          ),
        /painel_inicio tem sobrecarga/,
      ],
      [
        "fin__movimentos ausente",
        async () =>
          c.query("DROP FUNCTION public.fin__movimentos(date,date) CASCADE"),
        /funcoes que os corpos novos chamam nao existem: .*public\.fin__movimentos\(date,date\)/,
      ],
      [
        "fin_dre ausente",
        async () => c.query("DROP FUNCTION public.fin_dre(date,date)"),
        /funcoes que os corpos novos chamam nao existem: public\.fin_dre\(date,date\)/,
      ],
    ];
    for (const [rotulo, estraga, mensagem] of recusas)
      await isolado(c, async () => {
        await estraga();
        const antes = await ambas(c);
        await c.query("SAVEPOINT recusa3993");
        await assert.rejects(
          () => c.query(migration),
          (e) =>
            /B1_BASELINE_DIVERGENT/.test(e.message) && mensagem.test(e.message),
          `${rotulo}: a migration devia recusar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa3993");
        assert.deepEqual(
          await ambas(c),
          antes,
          `${rotulo}: a migration escreveu apesar de recusar`,
        );
      });
    console.log(
      `  PASSOU pre-voo recusa sem escrever: ${recusas.length} estados (corpo desconhecido de cada funcao, loja ainda na 390, ACL de anon/PUBLIC/authenticated/service_role, VOLATILE, SECURITY INVOKER, search_path, sobrecargas, fin__movimentos e fin_dre ausentes)`,
    );

    // ---- 10. A porta: cliente, ex-admin (so o JWT velho) e visitante recusados nas duas; admin atual chama. ----
    for (const [rotulo, id] of [
      ["cliente comum", CLIENTE],
      ["ex-admin", EX_ADMIN],
      ["sem sessao", ""],
    ])
      for (const [nome, sql] of [
        ["painel_inicio", "SELECT public.painel_inicio()"],
        [
          "fin_resumo",
          `SELECT public.fin_resumo('${PERIODO[0]}', '${PERIODO[1]}')`,
        ],
      ])
        await isolado(c, async () => {
          await logar(c, id);
          await c.query("SAVEPOINT porta3993");
          await assert.rejects(
            () => c.query(sql),
            /Acesso negado/,
            `${rotulo} chamou ${nome}`,
          );
          await c.query("ROLLBACK TO SAVEPOINT porta3993");
        });
    await logar(c, ADMIN);
    await inicio(c);
    await resumo(c);
    for (const [papel, esperado] of [
      ["anon", false],
      ["authenticated", true],
    ])
      for (const assinatura of [PAINEL, RESUMO])
        assert.equal(
          (
            await c.query(
              `SELECT has_function_privilege($1, '${assinatura}', 'EXECUTE') AS x`,
              [papel],
            )
          ).rows[0].x,
          esperado,
          `EXECUTE de ${papel} em ${assinatura}`,
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
      await resumo(c);
    });
    console.log(
      "  PASSOU a porta: cliente, ex-admin (so o papel antigo no JWT) e visitante recusados em painel_inicio e fin_resumo; admin atual chama; anon sem EXECUTE; sem is_admin_atual o ex-admin entraria",
    );

    // ---- 11. Consultas 119a/119b e os portoes vizinhos. ----
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
    const mP = "painel_inicio: corpo exato (md5)";
    const mR = "fin_resumo: corpo exato (md5)";
    const estados = [
      // [rotulo, instala, 119a, 119b, 116b]: a 116b ("antes" = o corpo da 390) reprova o painel da 398 e o da 3993.
      ["3993 (topo)", async () => {}, [], [mR, mP], [mP]],
      [
        "398 + 1199 (rollback)",
        async () => c.query(rollback),
        [mR, mP],
        [],
        [mP],
      ],
    ];
    // A 119a/119b tambem leem get_admin_products_paged (a 3992): ela esta no ar no CI; a prova dela e' a outra. Aqui so as linhas dos dois.
    const dosDois = (rows) =>
      rows.filter((r) => /^(painel_inicio|fin_resumo):/.test(r.item));
    for (const [rotulo, poe, e119a, e119b, e116b] of estados)
      await isolado(c, async () => {
        await poe();
        const a = await rodar(C119A);
        const b = await rodar(C119B);
        confereRol(C119A, a);
        confereRol(C119B, b);
        assert.deepEqual(
          reprovadas(dosDois(a)),
          e119a,
          `119a com o corpo da ${rotulo}`,
        );
        assert.deepEqual(
          reprovadas(dosDois(b)),
          e119b,
          `119b com o corpo da ${rotulo}`,
        );
        // painel_inicio: as consultas das migrations anteriores aceitam este corpo (e o anterior).
        assert.deepEqual(
          reprovadas(await rodar(C116A)),
          [],
          `116a com o corpo da ${rotulo}`,
        );
        assert.deepEqual(
          reprovadas(await rodar(C116B)),
          e116b,
          `116b com o corpo da ${rotulo}`,
        );
        assert.deepEqual(
          reprovadas(await rodar(C97A)),
          [],
          `97a com o corpo da ${rotulo}`,
        );
        for (const portao of PORTOES)
          assert.deepEqual(
            reprovadas(await rodar(portao)),
            [],
            `${portao}: reprovou o corpo da ${rotulo}`,
          );
      });
    // Corpo estranho de cada funcao: reprova a linha dela em 119a e 119b, e os portoes que leem a funcao.
    for (const [rotulo, instala, linha, portoesQueLem] of [
      [
        "painel_inicio",
        () => instalarPainel(c, estranhoP),
        mP,
        [
          C116A,
          C97A,
          "17a-conferir-estoque-do-painel-aplicado",
          "30a-conferir-numeros-do-painel-aplicado",
          "8e-conferir-92-a-202-aplicado",
        ],
      ],
      [
        "fin_resumo",
        () => instalarResumo(c, estranhoR),
        mR,
        ["8e-conferir-92-a-202-aplicado"],
      ],
    ])
      await isolado(c, async () => {
        await instala();
        for (const nome of [C119A, C119B])
          assert.deepEqual(
            reprovadas(dosDois(await rodar(nome))).filter((x) => x === linha),
            [linha],
            `${nome}: aceitou ${rotulo} estranho`,
          );
        for (const nome of portoesQueLem)
          assert.ok(
            reprovadas(await rodar(nome)).length > 0,
            `${nome}: aceitou ${rotulo} estranho`,
          );
      });
    console.log(
      "  PASSOU 119a/119b (rol de 10 linhas; as 6 dos dois corpos do lado certo), 116a, 97a, 8e, 17a e 30a aceitam o corpo da 3993 e o anterior e reprovam corpo estranho de cada funcao",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }

  // ---- 12. ATOMICIDADE E CONCORRENCIA, em conexoes SEM BEGIN: o estado e' commitado de verdade no clone descartavel. ----
  const d = new Client({ connectionString: lerDatabaseUrlEfemera() });
  const leitor = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await d.connect();
  await leitor.connect();
  const hashes = async (cli = d) =>
    (
      await cli.query(
        `SELECT (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = '${PAINEL}'::regprocedure) AS p,
                (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = '${RESUMO}'::regprocedure) AS r`,
      )
    ).rows[0];
  const ANTES = { p: H.painelAntes, r: H.resumoAntes };
  const NOVO = { p: H.painelNovo, r: H.resumoNovo };
  try {
    assert.deepEqual(await hashes(), NOVO);
    await d.query(rollback);
    assert.deepEqual(await hashes(), ANTES);
    // (a) Falhar no fim, depois dos dois CREATE: nada fica gravado.
    await assert.rejects(
      () => d.query(`${migration}\nSELECT 1/0;`),
      /division by zero/,
    );
    assert.deepEqual(
      await hashes(),
      ANTES,
      "a migration que falhou no fim deixou um corpo gravado pela metade",
    );
    // (b) Pos-voo reprovando o CORPO de CADA funcao: a conferencia derruba as DUAS trocas.
    const corpoErradoP = migration.replace(
      "  v_mes_ant_tem_o_dia boolean;\n",
      "  v_mes_ant_tem_o_dia boolean; -- diferente\n",
    );
    assert.notEqual(corpoErradoP, migration);
    await assert.rejects(
      () => d.query(corpoErradoP),
      /conferencia 20261399300: corpo vivo de public\.painel_inicio\(\)/,
    );
    assert.deepEqual(
      await hashes(),
      ANTES,
      "pos-voo do corpo do painel nao desfez as duas trocas",
    );
    const corpoErradoR = migration.replace(
      "  v_hoje date := public.fin__hoje();\n  v_res jsonb;\n",
      "  v_hoje date := public.fin__hoje(); -- diferente\n  v_res jsonb;\n",
    );
    assert.notEqual(corpoErradoR, migration);
    await assert.rejects(
      () => d.query(corpoErradoR),
      /conferencia 20261399300: corpo vivo de public\.fin_resumo\(date,date\)/,
    );
    assert.deepEqual(
      await hashes(),
      ANTES,
      "pos-voo do corpo do resumo nao desfez as duas trocas",
    );
    // (c) Pos-voo reprovando um ATRIBUTO de cada funcao (mesmo texto, outra volatilidade): derruba as duas trocas.
    const partes = migration.split(" STABLE SECURITY DEFINER");
    assert.equal(
      partes.length,
      3,
      "esperava exatamente duas funcoes STABLE SECURITY DEFINER",
    );
    const atributoP = `${partes[0]} VOLATILE SECURITY DEFINER${partes[1]} STABLE SECURITY DEFINER${partes[2]}`;
    const atributoR = `${partes[0]} STABLE SECURITY DEFINER${partes[1]} VOLATILE SECURITY DEFINER${partes[2]}`;
    await assert.rejects(
      () => d.query(atributoP),
      /conferencia 20261399300: atributos de public\.painel_inicio\(\) mudaram/,
    );
    assert.deepEqual(
      await hashes(),
      ANTES,
      "pos-voo do atributo do painel nao desfez",
    );
    await assert.rejects(
      () => d.query(atributoR),
      /conferencia 20261399300: atributos de public\.fin_resumo\(date,date\) mudaram/,
    );
    assert.deepEqual(
      await hashes(),
      ANTES,
      "pos-voo do atributo do resumo nao desfez",
    );
    for (const assinatura of [PAINEL, RESUMO])
      assert.equal(
        (
          await d.query(
            `SELECT provolatile FROM pg_proc WHERE oid = '${assinatura}'::regprocedure`,
          )
        ).rows[0].provolatile,
        "s",
        `a volatilidade de ${assinatura} nao voltou`,
      );
    // (d) Leitor concorrente: enquanto a troca esta aberta numa transacao, quem le NAO espera e enxerga os corpos INTEIROS de antes
    //     (nunca um painel novo com resumo velho); depois do COMMIT enxerga os dois novos.
    await d.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@estorno3993.invalid', '{"role":"admin"}'::jsonb)`,
      [ADMIN],
    );
    await d.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Ficticio 3993', 'admin') ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
      [ADMIN],
    );
    await leitor.query("SELECT set_config('app.rpc.user_id', $1, false)", [
      ADMIN,
    ]);
    await leitor.query("SET statement_timeout = '4s'");
    await d.query("BEGIN");
    await d.query(migration);
    assert.deepEqual(await hashes(), NOVO);
    assert.deepEqual(
      await hashes(leitor),
      ANTES,
      "o leitor concorrente viu a troca antes do COMMIT",
    );
    const durante = (await leitor.query("SELECT public.painel_inicio() AS r"))
      .rows[0].r;
    await leitor.query("SELECT public.fin_resumo($1, $2)", PERIODO);
    await d.query("COMMIT");
    assert.deepEqual(
      await hashes(leitor),
      NOVO,
      "o leitor nao viu os corpos novos apos o COMMIT",
    );
    const depois = (await leitor.query("SELECT public.painel_inicio() AS r"))
      .rows[0].r;
    assert.deepEqual(Object.keys(depois), Object.keys(durante));
    // (e) Transacao interrompida no meio (ROLLBACK depois de aplicar): volta aos corpos de antes.
    await d.query(rollback);
    assert.deepEqual(await hashes(), ANTES);
    await d.query("BEGIN");
    await d.query(migration);
    await d.query("ROLLBACK");
    assert.deepEqual(
      await hashes(),
      ANTES,
      "o ROLLBACK da transacao nao desfez a migration",
    );
    await d.query(migration);
    assert.deepEqual(await hashes(), NOVO);
    console.log(
      "  PASSOU atomicidade em conexao SEM BEGIN: falhar no fim, pos-voo reprovando corpo e atributo de CADA funcao e ROLLBACK no meio nao deixam nada gravado (as duas caem juntas); o leitor concorrente nao espera e ve os dois corpos de antes ate o COMMIT, os dois novos depois",
    );
  } finally {
    // Garante o estado final do clone: os corpos novos.
    await d.query("ROLLBACK").catch(() => {});
    await d.query(migration).catch(() => {});
    await leitor.end().catch(() => {});
    await d.end();
  }
  console.log("[o-estorno-em-andamento] prova viva concluida (20261399300).");
}

main().catch((erro) => {
  console.error(
    `[o-estorno-em-andamento] FALHOU: ${erro.stack || erro.message}`,
  );
  process.exit(1);
});
