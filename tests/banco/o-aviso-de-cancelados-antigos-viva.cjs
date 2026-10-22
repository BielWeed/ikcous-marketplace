"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// 20261380: o aviso de cancelados antigos (fora_da_janela) conta so pendencia real.
// Somente Postgres descartavel do rpc-ci, nunca banco de loja. A prova nao roda
// automaticamente fora do CI_BANCO_EFEMERO=1 + localhost (efemero.cjs).
//
// O que esta prova mostra, em linguagem de balcao:
//   * pedido antigo cancelado SEM pagamento e SEM envio NAO conta;
//   * antigo pago e nao devolvido conta (dinheiro a devolver);
//   * antigo enviado e nao devolvido conta (mercadoria a voltar);
//   * antigo pago e ja estornado (ou ja devolvido por fora) NAO conta;
//   * recente nunca entra em fora_da_janela; p_dias NULL da 0;
//   * data e total_count ficam iguais aos do corpo anterior;
//   * controles: cada pedaco da regra, tirado, muda o numero (o teste nao e cego);
//   * reaplicar, preflight, rollback byte a byte e as consultas 85a/85b.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261380000000_o_aviso_de_cancelados_antigos_conta_so_pendencia_real.sql";
const ASSINATURA =
  "public.get_admin_orders_cancelados_recentes(integer,integer,integer)";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const antes = ler(
  "scripts/publicacao/consultas/85b-antes-aviso-de-cancelados-antigos-base-vigente.sql",
);
const depois = ler(
  "scripts/publicacao/consultas/85a-conferir-aviso-de-cancelados-antigos-aplicado.sql",
);
const CORPO_DA_99 = ler(
  "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
).match(
  /CREATE OR REPLACE FUNCTION public\.get_admin_orders_cancelados_recentes\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
)[1];

const ADMIN = "5e380000-0000-4000-8000-000000000001";
const CLIENTE = "5e380000-0000-4000-8000-000000000002";
const idDoPedido = (n) =>
  `5e380000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;

const ANTIGO = 200; // dias desde o cancelamento: bem fora da janela de 90
const RECENTE = 10;

// Cada caso e um pedido CANCELADO. `conta` = pendencia real pela regra nova.
// `contavaAntes` = o corpo antigo contava (todo cancelado antigo).
const CASOS = [
  {
    n: 1,
    nome: "antigo, nunca pago e nunca enviado",
    dias: ANTIGO,
    pay: null,
    conta: false,
  },
  {
    n: 2,
    nome: "antigo, pagamento ainda aguardando (nunca entrou)",
    dias: ANTIGO,
    pay: "aguardando",
    conta: false,
  },
  {
    n: 3,
    nome: "antigo, pago e nao devolvido",
    dias: ANTIGO,
    pay: "pago",
    conta: true,
  },
  {
    n: 4,
    nome: "antigo, pago e ja estornado por inteiro",
    dias: ANTIGO,
    pay: "pago",
    estornado: 100,
    conta: false,
  },
  {
    n: 5,
    nome: "antigo, pago e ja devolvido por fora (reembolso manual concluido)",
    dias: ANTIGO,
    pay: "pago",
    devolucaoManual: 100,
    conta: false,
  },
  {
    n: 6,
    nome: "antigo, pago e estornado so em parte (ainda sobra dinheiro)",
    dias: ANTIGO,
    pay: "pago",
    estornado: 40,
    conta: true,
  },
  {
    n: 7,
    nome: "antigo, enviado e produto nao voltou (nunca pago)",
    dias: ANTIGO,
    pay: null,
    enviado: true,
    conta: true,
  },
  {
    n: 8,
    nome: "antigo, enviado e produto ja voltou (nunca pago)",
    dias: ANTIGO,
    pay: null,
    enviado: true,
    voltou: true,
    conta: false,
  },
  {
    n: 9,
    nome: "antigo, pago, enviado, produto voltou e dinheiro ja estornado",
    dias: ANTIGO,
    pay: "pago",
    enviado: true,
    voltou: true,
    estornado: 100,
    conta: false,
  },
  {
    n: 10,
    nome: "antigo, pago e estornado, mas o produto enviado nao voltou",
    dias: ANTIGO,
    pay: "pago",
    enviado: true,
    estornado: 100,
    conta: true,
  },
  {
    n: 11,
    nome: "antigo, dinheiro recebido na entrega",
    dias: ANTIGO,
    pay: "recebido_na_entrega",
    conta: true,
  },
  {
    n: 12,
    nome: "antigo, pago depois de expirar",
    dias: ANTIGO,
    pay: "pago_apos_expirar",
    conta: true,
  },
  {
    n: 13,
    nome: "antigo, pagamento marcado como estornado",
    dias: ANTIGO,
    pay: "estornado",
    conta: false,
  },
  {
    n: 14,
    nome: "antigo, pago, SEM linha de historico (cai no updated_at)",
    dias: null,
    pay: "pago",
    semHistorico: true,
    conta: true,
  },
  {
    n: 15,
    nome: "antigo, pago, devolucao concluida mas so de parte do valor",
    dias: ANTIGO,
    pay: "pago",
    devolucaoManual: 30,
    conta: true,
  },
];
// Recente: pendente de verdade, mas nunca entra em fora_da_janela.
const RECENTE_PAGO = {
  n: 20,
  nome: "recente, pago e nao devolvido",
  dias: RECENTE,
  pay: "pago",
  conta: false,
  recente: true,
};
const RECENTE_ENVIADO = {
  n: 21,
  nome: "recente, enviado e nao devolvido",
  dias: RECENTE,
  pay: null,
  enviado: true,
  conta: false,
  recente: true,
};

async function inserirPedido(c, o) {
  const id = idDoPedido(o.n);
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, paid_at, cancelled_after_shipping,
        returned_to_seller_at, valor_estornado, updated_at)
     VALUES ($1, $2, 'Cliente Ficticio 380', '{}'::jsonb, 100, 100, $3, 'online', 'pix', $4, $5, $6, $7, $8,
             COALESCE($9::timestamptz, now()))`,
    [
      id,
      CLIENTE,
      o.status || "cancelled",
      o.pay || null,
      o.pay?.startsWith("pago") ? new Date() : null,
      Boolean(o.enviado),
      o.voltou ? new Date() : null,
      o.estornado || 0,
      o.semHistorico ? new Date(Date.now() - ANTIGO * 86400000) : null,
    ],
  );
  if (!o.semHistorico && o.dias !== null) {
    await c.query(
      `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, created_at)
       VALUES ($1, 'pending', 'cancelled', now() - make_interval(days => $2::int))`,
      [id, o.dias],
    );
  }
  if (o.devolucaoManual) {
    await c.query(
      `INSERT INTO public.devolucoes
         (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade,
          metodo_retorno, status, valor_itens, valor_reembolso, reembolso_manual, prazo_ate, politica)
       VALUES ($1, $2, $3, 'arrependimento', 'desisti', 'reembolso', 'local',
               'entrega_na_loja', 'concluida', $4, $4, true, current_date + 7, '{}'::jsonb)`,
      [`DEV-380-${o.n}`, id, CLIENTE, o.devolucaoManual],
    );
  }
}

async function resultado(c, dias) {
  const r = (
    await c.query(
      "SELECT public.get_admin_orders_cancelados_recentes($1::int, 0, 200) AS r",
      [dias],
    )
  ).rows[0].r;
  return {
    data: r.data,
    total: Number(r.total_count),
    fora: Number(r.fora_da_janela),
    chaves: Object.keys(r).sort(),
  };
}

async function fotografar(c) {
  return (
    await c.query(`SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY id), '[]') FROM public.marketplace_orders o) AS pedidos,
    (SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY id), '[]') FROM public.marketplace_order_history h) AS historico,
    (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY id), '[]') FROM public.devolucoes d) AS devolucoes`)
  ).rows[0];
}
async function funcao(c) {
  const atributos = (
    await c.query(`SELECT to_jsonb(p) AS atributos FROM pg_proc p
    WHERE oid = '${ASSINATURA}'::regprocedure`)
  ).rows[0].atributos;
  return { ...atributos, prosrc: atributos.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso380");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso380");
    await c.query("RELEASE SAVEPOINT caso380");
  }
}
async function recusa(c, acao, codigo, mensagem) {
  await isolado(c, async () => {
    await assert.rejects(
      acao,
      (e) => e.code === codigo && mensagem.test(e.message),
    );
  });
}
async function conferir(c, sql, positivo) {
  const linhas = (await c.query(sql)).rows;
  assert.equal(linhas.length, 4);
  assert.equal(
    linhas.every((l) => l.ok === true),
    positivo,
  );
}
// Quanto o fora_da_janela SOBE por causa de UM pedido, medido contra o banco sem ele.
async function degrau(c, base, pedido) {
  return isolado(c, async () => {
    await inserirPedido(c, pedido);
    const r = await resultado(c, 90);
    return {
      fora: r.fora - base.fora,
      total: r.total - base.total,
    };
  });
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    const topo = await funcao(c);
    await conferir(c, depois, true);
    await conferir(c, antes, false);
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin-aviso-380@fixture.invalid', '{"role":"admin"}'),
              ($2, 'cliente-aviso-380@fixture.invalid', '{}')`,
      [ADMIN, CLIENTE],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Admin Aviso Ficticio', 'admin'), ($2, 'Cliente Aviso Ficticio', 'customer')
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [ADMIN, CLIENTE],
    );
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);

    // ---- Estado NOVO (a arvore inteira aplicada pelo CI): um pedido por vez. ----
    const baseNovo = await resultado(c, 90);
    assert.deepEqual(baseNovo.chaves, [
      "data",
      "fora_da_janela",
      "total_count",
    ]);
    for (const caso of CASOS) {
      const d = await degrau(c, baseNovo, caso);
      assert.deepEqual(
        d,
        { fora: caso.conta ? 1 : 0, total: 0 },
        `NOVO: ${caso.nome} (conta=${caso.conta}); dentro da janela nunca soma`,
      );
    }
    for (const caso of [RECENTE_PAGO, RECENTE_ENVIADO]) {
      const d = await degrau(c, baseNovo, caso);
      assert.deepEqual(
        d,
        { fora: 0, total: 1 },
        `NOVO: ${caso.nome} fica DENTRO da janela, nunca em fora_da_janela`,
      );
    }
    // Pedido NAO cancelado nunca entra em nada, tenha a pendencia que tiver.
    {
      const d = await degrau(c, baseNovo, {
        n: 30,
        nome: "entregue, pago",
        status: "delivered",
        dias: ANTIGO,
        pay: "pago",
        enviado: true,
      });
      assert.deepEqual(d, { fora: 0, total: 0 }, "pedido entregue entrou");
    }

    // ---- Rollback: o corpo da 99 byte a byte; 85b positiva. ----
    await c.query(rollback);
    const anterior = await funcao(c);
    assert.equal(anterior.prosrc, CORPO_DA_99);
    await conferir(c, antes, true);
    await conferir(c, depois, false);
    const baseAntigo = await resultado(c, 90);
    // CONTROLE (o defeito de origem): o corpo antigo contava TODO cancelado antigo.
    for (const caso of CASOS) {
      const d = await degrau(c, baseAntigo, caso);
      assert.deepEqual(
        d,
        { fora: 1, total: 0 },
        `ANTIGO: ${caso.nome} era contado sem olhar a pendencia`,
      );
    }

    // ---- Todos juntos, no corpo ANTIGO e no NOVO. ----
    for (const caso of [...CASOS, RECENTE_PAGO, RECENTE_ENVIADO]) {
      await inserirPedido(c, caso);
    }
    const dados = await fotografar(c);
    const antigoJunto = await resultado(c, 90);
    const antigoSemJanela = await resultado(c, null);
    assert.equal(antigoJunto.fora - baseAntigo.fora, CASOS.length);

    await c.query(migration);
    assert.deepEqual(
      await fotografar(c),
      dados,
      "apply alterou pedido, historico ou devolucao",
    );
    assert.deepEqual(
      await funcao(c),
      topo,
      "apply nao reproduziu o topo instalado pelo CI (OID, dono, ACL, atributos ou corpo)",
    );
    await conferir(c, depois, true);
    await conferir(c, antes, false);
    const novoJunto = await resultado(c, 90);
    const esperadas = CASOS.filter((x) => x.conta).length;
    assert.equal(esperadas, 8);
    assert.equal(
      novoJunto.fora - baseNovo.fora,
      esperadas,
      "fora_da_janela deve contar so os antigos com pendencia real",
    );
    // O que NAO muda: data e total_count identicos aos do corpo antigo.
    assert.equal(novoJunto.total, antigoJunto.total);
    assert.deepEqual(novoJunto.data, antigoJunto.data);
    assert.deepEqual(novoJunto.chaves, antigoJunto.chaves);
    // p_dias NULL: sem janela nao existe "fora".
    const novoSemJanela = await resultado(c, null);
    assert.equal(novoSemJanela.fora, 0);
    assert.equal(novoSemJanela.total, antigoSemJanela.total);
    assert.deepEqual(novoSemJanela.data, antigoSemJanela.data);
    // Janela enorme: nada fica "fora".
    assert.equal((await resultado(c, 36500)).fora, 0);
    // Paginacao nao muda o numero.
    const pagina = (
      await c.query(
        "SELECT public.get_admin_orders_cancelados_recentes(90, 0, 1) AS r",
      )
    ).rows[0].r;
    assert.equal(Number(pagina.fora_da_janela), novoJunto.fora);

    // ---- CONTROLES: tirar cada pedaco da regra muda o numero (o teste nao e cego). ----
    const definicao = (
      await c.query(
        `SELECT pg_get_functiondef('${ASSINATURA}'::regprocedure) AS d`,
      )
    ).rows[0].d;
    const mutantes = [
      ["sem o filtro de pendencia", /\n\s+AND pendente\n/, "\n"],
      [
        "sem a mercadoria a voltar",
        /\(o\.cancelled_after_shipping IS TRUE AND o\.returned_to_seller_at IS NULL\)/,
        "FALSE",
      ],
      [
        "sem o dinheiro a devolver",
        /WHEN o\.payment_status IN \('pago', 'pago_apos_expirar', 'recebido_na_entrega'\)/,
        "WHEN FALSE",
      ],
      [
        "sem descontar o estorno ja feito",
        /- COALESCE\(o\.valor_estornado, 0\) > 0/,
        "> 0",
      ],
      [
        "sem descontar a devolucao manual",
        /AND d\.reembolso_manual\)/,
        "AND FALSE)",
      ],
    ];
    for (const [nome, de, para] of mutantes) {
      const mutante = definicao.replace(de, para);
      assert.notEqual(
        mutante,
        definicao,
        `mutante "${nome}" nao mexeu no corpo`,
      );
      await isolado(c, async () => {
        await c.query(mutante);
        const r = await resultado(c, 90);
        assert.notEqual(
          r.fora - baseNovo.fora,
          esperadas,
          `mutante "${nome}" passou despercebido`,
        );
      });
    }

    // ---- Porta: quem nao e admin nao enxerga nada. ----
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [CLIENTE]);
    await recusa(
      c,
      () =>
        c.query(
          "SELECT public.get_admin_orders_cancelados_recentes(90, 0, 10)",
        ),
      "P0001",
      /Acesso negado/,
    );
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);

    // ---- Reaplicar: mesmo estado, inclusive com fim de linha CRLF. ----
    await c.query(migration);
    await c.query(migration.replace(/\n/g, "\r\n"));
    assert.deepEqual(await fotografar(c), dados, "reaplicar tocou dados");
    assert.deepEqual(
      await funcao(c),
      topo,
      "reaplicar mudou OID, dono, ACL ou atributos",
    );

    // ---- Corpo ou atributos desconhecidos: o preflight recusa sem escrever. ----
    for (const sabotagem of [
      definicao.replace("DECLARE", "-- corpo desconhecido\nDECLARE"),
      `ALTER FUNCTION ${ASSINATURA} SECURITY INVOKER`,
      `ALTER FUNCTION ${ASSINATURA} SET search_path TO pg_catalog`,
      `GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`,
      `REVOKE EXECUTE ON FUNCTION ${ASSINATURA} FROM service_role`,
    ]) {
      await isolado(c, async () => {
        await c.query(sabotagem);
        const sabotada = await funcao(c);
        await recusa(
          c,
          () => c.query(migration),
          "P0001",
          /B1_BASELINE_DIVERGENT/,
        );
        assert.deepEqual(
          await funcao(c),
          sabotada,
          "preflight escreveu antes de recusar",
        );
        assert.deepEqual(await fotografar(c), dados);
      });
    }

    // ---- Rollback: exato, sem tocar em dado; o segundo recusa. ----
    await c.query(rollback);
    assert.deepEqual(
      await funcao(c),
      anterior,
      "rollback nao devolveu corpo/atributos byte a byte",
    );
    assert.deepEqual(await fotografar(c), dados, "rollback tocou dados");
    await recusa(c, () => c.query(rollback), "P0001", /B1_BASELINE_DIVERGENT/);
    await conferir(c, antes, true);
    await c.query(migration);
    await conferir(c, depois, true);
    console.log(
      "PASSOU 380: antigo sem pagamento e sem envio nao conta; pago, enviado e dinheiro recebido contam; estornado, devolvido e produto de volta nao contam; recente e entregue nunca entram; p_dias NULL = 0; data/total_count iguais; 5 controles; porta de admin; reaplicacao/CRLF; rollback exato; preflight; consultas 85a/85b.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
