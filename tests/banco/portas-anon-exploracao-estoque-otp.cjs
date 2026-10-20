"use strict";

/**
 * A5c — O QUE UM ESTRANHO FAZ COM O ESTOQUE, O OTP E O SERVIÇO (auditoria de
 * pagamento e segurança, 10/10/2026). MEDIÇÃO, não portão: sempre sai 0 e imprime
 * uma linha `PORTA <recurso> -> escreveu|vazou|recusou|executou|inconclusivo|
 * AUSENTE <detalhe>` por caso. O motor e o significado de cada veredito estão em
 * portas-anon-exploracao-comum.cjs.
 *
 * Cada função é chamada, no banco efêmero e numa transação desfeita, como o
 * visitante sem login (`anon`) com o EXECUTE reaberto de propósito (reproduz um
 * banco restaurado sem as permissões); dados SINTÉTICOS criados aqui. Cobre:
 * devolver_estoque (duas vezes: o carimbo segura a segunda?), decrement_stock,
 * expirar_pedidos_vencidos (varredura de serviço), generate_order_otp_v1 (e se há
 * limite de pedidos de código), a leitura da tabela de códigos, o achado A-1
 * (quem sabe SÓ o e-mail gasta as 5 tentativas de get_orders_by_otp_v1 e bloqueia
 * o código CERTO da vítima?) e o F-7 (se `avatar_url` aceita 5 MB, e o anônimo
 * lê). Vira teste de regressão das correções B2 e do OTP.
 *
 * USO (no rpc-ci.yml, depois das migrations):
 *   node tests/banco/rodar-isolado.cjs tests/banco/portas-anon-exploracao-estoque-otp.cjs
 */

const {
  P_PRODUTO,
  U_CLIENTE,
  U_VITIMA,
  chamar,
  como,
  pedidoSintetico,
  rodar,
  umaLinha,
} = require("./portas-anon-exploracao-comum.cjs");

const EMAIL_VITIMA = "vitima.sintetica@teste.invalid";
const FONE_VITIMA = "5539999990001";
const CODIGO_DA_VITIMA = "123456";
const CINCO_MB = 5 * 1024 * 1024;

const estoqueDoProduto = async (c) => {
  const r = await umaLinha(
    c,
    "SELECT estoque FROM public.produtos WHERE id = $1",
    [P_PRODUTO],
  );
  return `estoque_do_produto=${r.estoque}`;
};

/** Pedido da vítima com e-mail e telefone (o que o fluxo de OTP do convidado pede). */
const pedidoDaVitima = (c) =>
  pedidoSintetico(c, {
    userId: U_VITIMA,
    nome: "Vitima Sintetica Pedido",
    telefone: FONE_VITIMA,
    dados: { email: EMAIL_VITIMA, whatsapp: FONE_VITIMA },
  });

const chamarOtp = (quem, params) =>
  chamar(quem, "SELECT public.generate_order_otp_v1($1, $2, $3) AS r", params);

const CASOS = [
  {
    porta: "devolver_estoque (duas chamadas seguidas, pedido vivo e pago)",
    assinatura: "public.devolver_estoque(uuid)",
    preparar: async (c) => {
      const p = await pedidoSintetico(c, {
        status: "processing",
        paymentStatus: "pago",
        pago: true,
        quantidade: 3,
      });
      return { orderId: p.id };
    },
    controle: chamar(
      "service",
      "SELECT public.devolver_estoque($1::uuid) AS r",
      (ctx) => [ctx.orderId],
    ),
    ataque: async (c, ctx) => {
      const sql = "SELECT public.devolver_estoque($1::uuid) AS r";
      const a = await como(c, "anon", sql, [ctx.orderId]);
      if (!a.ok) return a;
      const b = await como(c, "anon", sql, [ctx.orderId]);
      return {
        ...a,
        nota: `1ª chamada devolveu ${a.dados[0].r} unidade(s); 2ª ${b.ok ? `devolveu ${b.dados[0].r} (o carimbo segura)` : `recusou: ${b.code}`}`,
      };
    },
    observar: estoqueDoProduto,
  },
  {
    porta: "decrement_stock (tirar estoque de um produto, sem sessão)",
    assinatura: "public.decrement_stock(uuid,integer)",
    preparar: async () => ({}),
    // O repositório só concede esta função ao service_role (o admin não tem
    // EXECUTE): o controle legítimo é o serviço.
    controle: chamar("service", "SELECT public.decrement_stock($1::uuid, 5)", [
      P_PRODUTO,
    ]),
    ataque: chamar("anon", "SELECT public.decrement_stock($1::uuid, 5)", [
      P_PRODUTO,
    ]),
    observar: estoqueDoProduto,
  },
  {
    porta: "expirar_pedidos_vencidos (varredura de serviço, pedido vencido)",
    assinatura: "public.expirar_pedidos_vencidos()",
    preparar: async (c) => {
      const p = await pedidoSintetico(c, {
        status: "pending",
        paymentStatus: "aguardando",
        expiraEm: "2020-01-01T00:00:00Z",
        quantidade: 2,
      });
      return { orderId: p.id };
    },
    controle: chamar(
      "service",
      "SELECT public.expirar_pedidos_vencidos() AS r",
    ),
    ataque: chamar("anon", "SELECT public.expirar_pedidos_vencidos() AS r"),
    observar: async (c, ctx) => {
      const r = await umaLinha(
        c,
        "SELECT status, payment_status FROM public.marketplace_orders WHERE id = $1",
        [ctx.orderId],
      );
      return `pedido=${r.status}/${r.payment_status} ${await estoqueDoProduto(c)}`;
    },
  },
  {
    porta:
      "generate_order_otp_v1 (10 pedidos de código seguidos, só com e-mail, telefone e pedaço do pedido)",
    assinatura: "public.generate_order_otp_v1(text,text,text)",
    preparar: async (c) => {
      const p = await pedidoDaVitima(c);
      return { fragmento: p.id.slice(-8) };
    },
    controle: chamarOtp("service", (ctx) => [
      EMAIL_VITIMA,
      FONE_VITIMA,
      ctx.fragmento,
    ]),
    ataque: async (c, ctx) => {
      let ultima = null;
      let verdadeiras = 0;
      for (let i = 0; i < 10; i += 1) {
        ultima = await como(
          c,
          "anon",
          "SELECT public.generate_order_otp_v1($1, $2, $3) AS r",
          [EMAIL_VITIMA, FONE_VITIMA, ctx.fragmento],
        );
        if (!ultima.ok) return ultima;
        if (ultima.dados[0].r === true) verdadeiras += 1;
      }
      return {
        ...ultima,
        nota: `${verdadeiras} de 10 chamadas devolveram true (a função confirma que o pedido existe e não limita a taxa)`,
      };
    },
    observar: async (c) => {
      const r = await umaLinha(
        c,
        "SELECT count(*) AS n FROM public.otp_verifications",
      );
      return `codigos_gravados=${r.n}`;
    },
  },
  {
    porta: "SELECT em otp_verifications (o código sai?)",
    leitura: true,
    preparar: async (c) => {
      const p = await pedidoDaVitima(c);
      await c.query(
        `INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at, order_id)
         VALUES ($1, $2, $3, now() + interval '15 minutes', $4)`,
        [EMAIL_VITIMA, FONE_VITIMA, CODIGO_DA_VITIMA, p.id],
      );
      return {};
    },
    controle: chamar(
      "admin",
      "SELECT email, otp_code FROM public.otp_verifications",
    ),
    ataque: chamar(
      "anon",
      "SELECT email, otp_code FROM public.otp_verifications",
    ),
    marcadores: () => [CODIGO_DA_VITIMA],
  },
  {
    porta:
      "A-1: get_orders_by_otp_v1 (5 códigos errados de quem só sabe o e-mail, depois o código CERTO da vítima)",
    assinatura: "public.get_orders_by_otp_v1(text,text)",
    preparar: async (c) => {
      const p = await pedidoDaVitima(c);
      await c.query(
        `INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at, order_id)
         VALUES ($1, $2, $3, now() + interval '15 minutes', $4)`,
        [EMAIL_VITIMA, FONE_VITIMA, CODIGO_DA_VITIMA, p.id],
      );
      return { orderId: p.id };
    },
    // O controle é a própria vítima, com o código certo, antes de qualquer ataque.
    controle: chamar(
      "anon",
      "SELECT public.get_orders_by_otp_v1($1, $2) AS r",
      [EMAIL_VITIMA, CODIGO_DA_VITIMA],
    ),
    ataque: async (c) => {
      const sql = "SELECT public.get_orders_by_otp_v1($1, $2) AS r";
      let ultimaErrada = null;
      for (const palpite of [
        "000001",
        "000002",
        "000003",
        "000004",
        "000005",
      ]) {
        ultimaErrada = await como(c, "anon", sql, [EMAIL_VITIMA, palpite]);
        if (!ultimaErrada.ok) return ultimaErrada;
      }
      const vitima = await como(c, "anon", sql, [
        EMAIL_VITIMA,
        CODIGO_DA_VITIMA,
      ]);
      const r = vitima.ok ? vitima.dados[0].r : null;
      return {
        ok: true,
        dados: [ultimaErrada.dados[0].r],
        rowCount: 1,
        nota: `a 5ª tentativa errada do estranho respondeu ${JSON.stringify(ultimaErrada.dados[0].r)}; depois disso o código CERTO da vítima responde ${vitima.ok ? JSON.stringify(r) : `${vitima.code} ${vitima.message}`} => vítima bloqueada: ${r && r.ok === false ? "SIM" : "não"}`,
      };
    },
    observar: async (c) => {
      const r = await umaLinha(
        c,
        "SELECT attempts, verified FROM public.otp_verifications ORDER BY created_at DESC LIMIT 1",
      );
      return `tentativas_do_codigo_da_vitima=${r.attempts} verificado=${r.verified}`;
    },
  },
  {
    porta:
      "F-7: avatar_url de 5 MB (cliente logado, no próprio perfil) e o que o anônimo lê depois",
    preparar: async () => ({}),
    controle: chamar(
      "cliente",
      "UPDATE public.profiles SET avatar_url = $2 WHERE id = $1",
      [U_CLIENTE, "https://exemplo.invalid/avatar.png"],
    ),
    ataque: async (c) => {
      const grava = await como(
        c,
        "cliente",
        "UPDATE public.profiles SET avatar_url = repeat('A', $2::int) WHERE id = $1",
        [U_CLIENTE, CINCO_MB],
      );
      if (!grava.ok) return grava;
      const le = await como(
        c,
        "anon",
        "SELECT length(avatar_url) AS bytes FROM public.public_profiles WHERE id = $1",
        [U_CLIENTE],
      );
      return {
        ...grava,
        dados: [],
        nota: `gravou ${CINCO_MB} bytes em profiles.avatar_url (${grava.rowCount} linha); o anônimo lê ${le.ok ? `${le.dados[0]?.bytes ?? 0} bytes em public_profiles` : `recusado: ${le.code}`}`,
      };
    },
    observar: async (c) => {
      const r = await umaLinha(
        c,
        "SELECT COALESCE(length(avatar_url), 0) AS bytes FROM public.profiles WHERE id = $1",
        [U_CLIENTE],
      );
      return `tamanho_do_avatar=${r.bytes}`;
    },
  },
];

rodar("estoque, OTP e serviço", CASOS).catch((erro) => {
  console.log(`[estoque, OTP e serviço] ERRO DA MEDIÇÃO: ${erro.message}`);
  process.exitCode = 0;
});
