// @ts-nocheck
// Edge cobrar-pix-no-balcao — banco e Mercado Pago FALSOS (nenhuma rede real).
//
//   P1  sem admin → 401, sem ler a venda
//   P2  venda do SITE (ou inexistente) → 404
//   P3  gerar: cria a order com chave = id do pedido, e-mail do cliente (nunca
//       do lojista), grava a vaga com UPDATE condicional, realinha o prazo e
//       devolve QR + prazo + hora do servidor
//   P4  gerar de novo: reconsulta a MESMA order, não cria outra
//   P5  gerar com a order já aprovada no MP (webhook atrasado): confirma pela
//       RPC e responde pago
//   P6  conferir: aprovado com valor divergente → NÃO confirma
//   P7  cancelar: cancela no MP ANTES e só então cancela a venda como o lojista
//   P8  cancelar com o MP dizendo que já foi pago → confirma, não cancela
//   P9  cancelar com o MP fora do ar → 502 e a venda continua viva
//   P10 gerar sem credencial → 503 terminal, nada criado
//   P11 corrida: venda cancelada enquanto a order nascia → cancela a order no MP
//   P12 venda que já saiu da espera → só a situação, sem tocar no MP
//
// PRONTIDÃO (acao "prontidao", sem orderId): a tela pergunta ANTES de criar a
// venda se este servidor cobra PIX no balcão. Responde 200 { pronto: true } ou
// 200 { pronto: false, motivo: "banco" | "credencial" }; qualquer dúvida é
// "não pronto". Nunca lê nem grava pedido, nunca fala com o Mercado Pago.
//   R1  sem admin → 401 antes de qualquer leitura (banco, credencial, MP)
//   R2  função de prontidão AUSENTE no banco (PGRST202) → não pronto, "banco"
//   R3  função devolve falso/nulo, ou o banco responde erro → não pronto, "banco"
//   R4  sem credencial do MP (ou a leitura dela falha) → não pronto, "credencial"
//   R5  banco pronto + credencial → pronto (sem orderId no corpo)
//   R6  em todos os cenários: nenhum acesso a marketplace_orders, nenhum
//       UPDATE, nenhuma chamada ao MP, nenhum getUserById
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const PEDIDO = "11111111-2222-4333-8444-555555555555";
const ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const AGORA = new Date("2026-09-28T15:00:00.000Z");
const mais = (min: number) => new Date(AGORA.getTime() + min * 60_000).toISOString();

function pedidoBase(extra: Record<string, unknown> = {}) {
  return {
    id: PEDIDO,
    canal: "presencial",
    payment_method: "online",
    status: "pending",
    payment_status: "aguardando",
    expires_at: mais(29),
    gateway_payment_id: null,
    total: 57,
    customer_data: { whatsapp: null, canal: "presencial" },
    user_id: "cccccccc-0000-0000-0000-000000000001",
    ...extra,
  };
}

/** Banco falso: uma linha de pedido, a RPC confirmar_pagamento, o getUserById. */
function bancoFalso(linha: Record<string, unknown> | null, opcoes: { naoGravar?: boolean } = {}) {
  const estado = { linha, rpcs: [] as any[], updates: [] as any[], leituras: 0 };
  const supabase = {
    from(_tabela: string) {
      const filtros: Array<[string, string, unknown]> = [];
      let valores: Record<string, unknown> | null = null;
      const q: any = {
        select: () => q,
        update: (v: Record<string, unknown>) => {
          valores = v;
          return q;
        },
        eq: (c: string, v: unknown) => {
          filtros.push(["eq", c, v]);
          return q;
        },
        is: (c: string, v: unknown) => {
          filtros.push(["is", c, v]);
          return q;
        },
        maybeSingle: async () => {
          if (valores) {
            estado.updates.push({ valores, filtros: [...filtros] });
            const casa =
              !opcoes.naoGravar &&
              estado.linha &&
              filtros.every(([, c, v]) => new Map(Object.entries(estado.linha)).get(c) === v);
            if (!casa) return { data: null, error: null };
            Object.assign(estado.linha, valores);
            return { data: { id: PEDIDO }, error: null };
          }
          estado.leituras++;
          return { data: estado.linha ? { ...estado.linha } : null, error: null };
        },
      };
      return q;
    },
    rpc: async (nome: string, args: any) => {
      estado.rpcs.push({ nome, args });
      if (nome === "confirmar_pagamento" && estado.linha) {
        Object.assign(estado.linha, { payment_status: "pago", status: "delivered" });
      }
      return { data: "pago", error: null };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "cliente@ex.com" } } }),
      },
    },
  };
  return { supabase, estado };
}

/** MP falso: registra as chamadas; `rotas` decide a resposta. */
function mpFalso(rotas: {
  criar?: () => Response;
  consultar?: () => Response;
  cancelar?: () => Response;
}) {
  const chamadas: Array<{ metodo: string; url: string; chave: string | null; corpo: any }> = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const metodo = init.method ?? "GET";
    const headers = new Headers(init.headers);
    chamadas.push({
      metodo,
      url,
      chave: headers.get("X-Idempotency-Key"),
      corpo: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (metodo === "POST" && url.endsWith("/cancel")) return (rotas.cancelar ?? naoEsperado)();
    if (metodo === "POST") return (rotas.criar ?? naoEsperado)();
    return (rotas.consultar ?? naoEsperado)();
  };
  return { fetchImpl, chamadas };
}
const naoEsperado = () => new Response("inesperado", { status: 500 });
const ok = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

function orderPix(status: string, detalhe: string, extra: Record<string, unknown> = {}) {
  return {
    id: "ORDTST-1",
    status,
    status_detail: detalhe,
    total_amount: "57.00",
    transactions: {
      payments: [
        {
          id: "PAY-1",
          amount: "57.00",
          date_of_expiration: mais(30),
          payment_method: { id: "pix", qr_code: "000201PIX", qr_code_base64: "iVBOR", ticket_url: "https://mp/t" },
        },
      ],
    },
    ...extra,
  };
}

function chamar(acao: string, deps: Record<string, unknown>, orderId = PEDIDO) {
  return handler(
    new Request("https://edge/cobrar-pix-no-balcao", {
      method: "POST",
      headers: { Authorization: "Bearer token-do-lojista", "Content-Type": "application/json" },
      body: JSON.stringify({ acao, orderId }),
    }),
    {
      verificarAdmin: async () => ADMIN,
      tokenDoMercadoPago: async () => "TOKEN-MP",
      agora: () => AGORA,
      ...deps,
    },
  );
}

Deno.test("P1 sem admin → 401 e a venda nem é lida", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase());
  const r = await chamar("gerar", { supabase, verificarAdmin: async () => null });
  assertEquals(r.status, 401);
  assertEquals(estado.leituras, 0);
});

Deno.test("P2 venda do site ou inexistente → 404", async () => {
  const site = bancoFalso(pedidoBase({ canal: "online" }));
  assertEquals((await chamar("gerar", { supabase: site.supabase })).status, 404);
  const balcaoEmDinheiro = bancoFalso(pedidoBase({ payment_method: "cash" }));
  assertEquals((await chamar("gerar", { supabase: balcaoEmDinheiro.supabase })).status, 404);
  const nada = bancoFalso(null);
  assertEquals((await chamar("gerar", { supabase: nada.supabase })).status, 404);
});

Deno.test("P3 gerar cria a order com chave = pedido, e-mail do cliente, grava a vaga e devolve o QR", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase());
  const mp = mpFalso({ criar: () => ok(orderPix("action_required", "waiting_transfer"), 201) });
  const r = await chamar("gerar", { supabase, fetchImpl: mp.fetchImpl });
  assertEquals(r.status, 200);
  const corpo = await r.json();
  assertEquals(corpo.situacao, "aguardando");
  assertEquals(corpo.qrCode, "000201PIX");
  assertEquals(corpo.qrCodeBase64, "iVBOR");
  assertEquals(corpo.agoraServidor, AGORA.toISOString());
  assertEquals(corpo.expiraEm, mais(30), "prazo realinhado ao vencimento do QR");
  assertEquals(mp.chamadas.length, 1);
  assertEquals(mp.chamadas[0].chave, PEDIDO);
  assertEquals(mp.chamadas[0].corpo.payer.email, "cliente@ex.com");
  assertEquals(mp.chamadas[0].corpo.total_amount, "57.00");
  assertEquals(mp.chamadas[0].corpo.external_reference, PEDIDO);
  const u = estado.updates[0];
  assertEquals(u.valores.gateway_payment_id, "ORDTST-1");
  assertEquals(u.valores.metodo_online, "pix");
  for (const filtro of [
    ["eq", "payment_status", "aguardando"],
    ["eq", "status", "pending"],
    ["is", "gateway_payment_id", null],
  ]) {
    assert(
      u.filtros.some((f: any) => f[0] === filtro[0] && f[1] === filtro[1] && f[2] === filtro[2]),
      `UPDATE da vaga sem o filtro ${filtro.join(" ")}`,
    );
  }
});

Deno.test("P4 gerar de novo reconsulta a MESMA order (nenhuma criação)", async () => {
  const { supabase } = bancoFalso(pedidoBase({ gateway_payment_id: "ORDTST-1" }));
  const mp = mpFalso({ consultar: () => ok(orderPix("action_required", "waiting_transfer")) });
  const corpo = await (await chamar("gerar", { supabase, fetchImpl: mp.fetchImpl })).json();
  assertEquals(corpo.qrCode, "000201PIX");
  assertEquals(mp.chamadas.map((c) => c.metodo), ["GET"]);
  assert(mp.chamadas[0].url.endsWith("/v1/orders/ORDTST-1"));
});

Deno.test("P5 gerar com a order já aprovada no MP confirma pela RPC e responde pago", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase({ gateway_payment_id: "ORDTST-1" }));
  const mp = mpFalso({ consultar: () => ok(orderPix("processed", "accredited")) });
  const corpo = await (await chamar("gerar", { supabase, fetchImpl: mp.fetchImpl })).json();
  assertEquals(corpo.situacao, "pago");
  assertEquals(estado.rpcs, [
    { nome: "confirmar_pagamento", args: { p_order_id: PEDIDO, p_payment_id: "ORDTST-1", p_status: "pago" } },
  ]);
});

Deno.test("P6 conferir: aprovado com valor divergente NÃO confirma", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase({ gateway_payment_id: "ORDTST-1" }));
  const mp = mpFalso({
    consultar: () => ok(orderPix("processed", "accredited", { total_amount: "5.70" })),
  });
  const corpo = await (await chamar("conferir", { supabase, fetchImpl: mp.fetchImpl })).json();
  assertEquals(corpo.situacao, "aguardando");
  assertEquals(corpo.valorDivergente, true);
  assertEquals(estado.rpcs, []);
});

Deno.test("P7 cancelar: primeiro no MP, depois a venda como o lojista", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase({ gateway_payment_id: "ORDTST-1" }));
  const ordem: string[] = [];
  const mp = mpFalso({
    cancelar: () => {
      ordem.push("mp");
      return ok(orderPix("canceled", "canceled"));
    },
  });
  const rpcsDoLojista: any[] = [];
  const clienteDoLojista = (auth: string) => ({
    rpc: async (nome: string, args: any) => {
      ordem.push("banco");
      rpcsDoLojista.push({ auth, nome, args });
      Object.assign(estado.linha, { status: "cancelled" });
      return { data: {}, error: null };
    },
  });
  const corpo = await (await chamar("cancelar", { supabase, fetchImpl: mp.fetchImpl, clienteDoLojista })).json();
  assertEquals(ordem, ["mp", "banco"]);
  assertEquals(mp.chamadas[0].chave, "cancelar:ORDTST-1");
  assertEquals(rpcsDoLojista[0].auth, "Bearer token-do-lojista");
  assertEquals(rpcsDoLojista[0].nome, "update_order_status_atomic");
  assertEquals(rpcsDoLojista[0].args.p_new_status, "cancelled");
  assertEquals(corpo.situacao, "cancelado");
});

Deno.test("P8 cancelar com o PIX já pago no MP: confirma e NÃO cancela", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase({ gateway_payment_id: "ORDTST-1" }));
  const mp = mpFalso({
    cancelar: () => ok({ errors: [{ code: "order_already_processed" }] }, 409),
    consultar: () => ok(orderPix("processed", "accredited")),
  });
  let cancelouNoBanco = false;
  const clienteDoLojista = () => ({
    rpc: async () => {
      cancelouNoBanco = true;
      return { data: {}, error: null };
    },
  });
  const corpo = await (await chamar("cancelar", { supabase, fetchImpl: mp.fetchImpl, clienteDoLojista })).json();
  assertEquals(corpo.situacao, "pago");
  assertEquals(corpo.jaEstavaPago, true);
  assertEquals(cancelouNoBanco, false);
  assertEquals(estado.rpcs[0].nome, "confirmar_pagamento");
});

Deno.test("P9 cancelar com o MP fora do ar → 502 e a venda segue viva", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase({ gateway_payment_id: "ORDTST-1" }));
  const mp = mpFalso({
    cancelar: () => new Response("", { status: 503 }),
    consultar: () => new Response("", { status: 503 }),
  });
  let cancelouNoBanco = false;
  const clienteDoLojista = () => ({
    rpc: async () => {
      cancelouNoBanco = true;
      return { data: {}, error: null };
    },
  });
  const r = await chamar("cancelar", { supabase, fetchImpl: mp.fetchImpl, clienteDoLojista });
  assertEquals(r.status, 502);
  assertEquals(cancelouNoBanco, false);
  assertEquals(estado.linha.status, "pending");
});

Deno.test("P10 gerar sem credencial do MP → 503 terminal, nada criado", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase());
  const mp = mpFalso({});
  const r = await chamar("gerar", { supabase, fetchImpl: mp.fetchImpl, tokenDoMercadoPago: async () => null });
  assertEquals(r.status, 503);
  assertEquals((await r.json()).terminal, true);
  assertEquals(mp.chamadas.length, 0);
  assertEquals(estado.updates.length, 0);
});

Deno.test("P11 venda saiu da espera enquanto a order nascia → cancela a order no MP", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase(), { naoGravar: true });
  const mp = mpFalso({
    criar: () => {
      Object.assign(estado.linha, { status: "cancelled" });
      return ok(orderPix("action_required", "waiting_transfer"), 201);
    },
    cancelar: () => ok(orderPix("canceled", "canceled")),
  });
  const corpo = await (await chamar("gerar", { supabase, fetchImpl: mp.fetchImpl })).json();
  assertEquals(corpo.situacao, "cancelado");
  assertEquals(corpo.qrCode, undefined, "nenhum QR de venda morta");
  assertEquals(mp.chamadas.map((c) => c.metodo), ["POST", "POST"]);
  assert(mp.chamadas[1].url.endsWith("/v1/orders/ORDTST-1/cancel"));
});

Deno.test("P12 venda já paga ou expirada: só a situação, sem tocar no MP", async () => {
  for (const [linha, esperado] of [
    [pedidoBase({ payment_status: "pago", status: "delivered" }), "pago"],
    [pedidoBase({ payment_status: "expirado", status: "cancelled" }), "expirado"],
    [pedidoBase({ expires_at: mais(-1) }), "expirado"],
  ] as const) {
    const { supabase } = bancoFalso(linha);
    const mp = mpFalso({});
    const corpo = await (await chamar("gerar", { supabase, fetchImpl: mp.fetchImpl })).json();
    assertEquals(corpo.situacao, esperado);
    assertEquals(mp.chamadas.length, 0);
  }
});

Deno.test("P13 venda vencida pelo relógio COM cobrança: conferir pergunta ao MP e confirma o pago do último segundo", async () => {
  const { supabase, estado } = bancoFalso(
    pedidoBase({ gateway_payment_id: "ORDTST-1", expires_at: mais(-1) }),
  );
  const mp = mpFalso({ consultar: () => ok(orderPix("processed", "accredited")) });
  const corpo = await (await chamar("conferir", { supabase, fetchImpl: mp.fetchImpl })).json();
  assertEquals(mp.chamadas.map((c) => c.metodo), ["GET"]);
  assertEquals(estado.rpcs[0]?.nome, "confirmar_pagamento");
  assertEquals(corpo.situacao, "pago");
});

Deno.test("P14 venda já cancelada por outro caminho com o PIX vivo: cancelar derruba o QR no MP e não mexe no banco", async () => {
  const { supabase } = bancoFalso(
    pedidoBase({ gateway_payment_id: "ORDTST-1", status: "cancelled" }),
  );
  const mp = mpFalso({ cancelar: () => ok(orderPix("canceled", "canceled")) });
  let chamouOBanco = false;
  const clienteDoLojista = () => ({
    rpc: async () => {
      chamouOBanco = true;
      return { data: {}, error: null };
    },
  });
  const corpo = await (await chamar("cancelar", { supabase, fetchImpl: mp.fetchImpl, clienteDoLojista })).json();
  assert(mp.chamadas[0].url.endsWith("/v1/orders/ORDTST-1/cancel"));
  assertEquals(chamouOBanco, false);
  assertEquals(corpo.situacao, "cancelado");
});

Deno.test("P15 aprovado sem valor legível: confirma pelo status (como webhook e reconciliação)", async () => {
  const { supabase, estado } = bancoFalso(pedidoBase({ gateway_payment_id: "ORDTST-1" }));
  const semValor = orderPix("processed", "accredited", { total_amount: undefined });
  (semValor.transactions.payments[0] as any).amount = undefined;
  const mp = mpFalso({ consultar: () => ok(semValor) });
  await chamar("conferir", { supabase, fetchImpl: mp.fetchImpl });
  assertEquals(estado.rpcs.map((r: any) => r.nome), ["confirmar_pagamento"]);
});

// ---- PRONTIDÃO --------------------------------------------------------------

const FUNCAO_DE_PRONTIDAO = "pix_do_balcao_pronto";

const RPC_AUSENTE = {
  data: null,
  error: {
    code: "PGRST202",
    message: `Could not find the function public.${FUNCAO_DE_PRONTIDAO} without parameters in the schema cache`,
  },
};
const RPC_VERDADEIRA = { data: true, error: null };

/** Banco falso da prontidão: registra TUDO o que a edge tocar. */
function bancoDaProntidao(respostaDaRpc: { data: unknown; error: unknown }) {
  const estado = {
    tabelas: [] as string[],
    updates: 0,
    rpcs: [] as Array<{ nome: string; args: unknown }>,
    getUserById: 0,
  };
  const supabase = {
    from(tabela: string) {
      estado.tabelas.push(tabela);
      const q: any = {
        select: () => q,
        eq: () => q,
        is: () => q,
        update: () => {
          estado.updates++;
          return q;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
    rpc: async (nome: string, args: unknown) => {
      estado.rpcs.push({ nome, args });
      return respostaDaRpc;
    },
    auth: {
      admin: {
        getUserById: async () => {
          estado.getUserById++;
          return { data: null };
        },
      },
    },
  };
  return { supabase, estado };
}

/** Credencial falsa que conta quantas vezes foi pedida. */
function credencialFalsa(token: string | null | Error) {
  const espia = { chamadas: 0 };
  const tokenDoMercadoPago = async () => {
    espia.chamadas++;
    if (token instanceof Error) throw token;
    return token;
  };
  return { tokenDoMercadoPago, espia };
}

/** Prontidão: corpo SEM orderId. */
function chamarProntidao(deps: Record<string, unknown>) {
  return handler(
    new Request("https://edge/cobrar-pix-no-balcao", {
      method: "POST",
      headers: { Authorization: "Bearer token-do-lojista", "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "prontidao" }),
    }),
    {
      verificarAdmin: async () => ADMIN,
      agora: () => AGORA,
      ...deps,
    },
  );
}

/** R6: nada de pedido, nada de UPDATE, nada de MP, nada de getUserById. */
function exigirSemEfeitos(
  estado: ReturnType<typeof bancoDaProntidao>["estado"],
  mp: ReturnType<typeof mpFalso>,
  rotulo: string,
) {
  assert(
    !estado.tabelas.includes("marketplace_orders"),
    `${rotulo}: a prontidão acessou marketplace_orders (${estado.tabelas.join(", ")})`,
  );
  assertEquals(estado.updates, 0, `${rotulo}: a prontidão fez UPDATE`);
  assertEquals(mp.chamadas.length, 0, `${rotulo}: a prontidão chamou o Mercado Pago`);
  assertEquals(estado.getUserById, 0, `${rotulo}: a prontidão leu conta de usuário`);
}

Deno.test("R1 prontidão sem admin → 401 antes de ler banco, credencial ou MP", async () => {
  const { supabase, estado } = bancoDaProntidao(RPC_VERDADEIRA);
  const credencial = credencialFalsa("TOKEN-MP");
  const mp = mpFalso({});
  const r = await chamarProntidao({
    supabase,
    verificarAdmin: async () => null,
    tokenDoMercadoPago: credencial.tokenDoMercadoPago,
    fetchImpl: mp.fetchImpl,
  });
  assertEquals(r.status, 401);
  assertEquals(estado.rpcs.length, 0, "consultou o banco antes de conferir o admin");
  assertEquals(estado.tabelas.length, 0, "leu tabela antes de conferir o admin");
  assertEquals(credencial.espia.chamadas, 0, "resolveu a credencial antes de conferir o admin");
  exigirSemEfeitos(estado, mp, "R1");
});

Deno.test("R2 função de prontidão ausente no banco → não pronto, motivo banco", async () => {
  const { supabase, estado } = bancoDaProntidao(RPC_AUSENTE);
  const credencial = credencialFalsa("TOKEN-MP");
  const mp = mpFalso({});
  const r = await chamarProntidao({
    supabase,
    tokenDoMercadoPago: credencial.tokenDoMercadoPago,
    fetchImpl: mp.fetchImpl,
  });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { pronto: false, motivo: "banco" });
  assertEquals(estado.rpcs.map((c) => c.nome), [FUNCAO_DE_PRONTIDAO]);
  exigirSemEfeitos(estado, mp, "R2");
});

Deno.test("R3 função devolve falso/nulo, ou o banco responde erro → não pronto, motivo banco", async () => {
  for (const [rotulo, resposta] of [
    ["falso", { data: false, error: null }],
    ["nulo", { data: null, error: null }],
    ["texto 'true' não é true", { data: "true", error: null }],
    ["erro do banco", { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }],
  ] as const) {
    const { supabase, estado } = bancoDaProntidao(resposta);
    const credencial = credencialFalsa("TOKEN-MP");
    const mp = mpFalso({});
    const r = await chamarProntidao({
      supabase,
      tokenDoMercadoPago: credencial.tokenDoMercadoPago,
      fetchImpl: mp.fetchImpl,
    });
    assertEquals(r.status, 200, rotulo);
    assertEquals(await r.json(), { pronto: false, motivo: "banco" }, rotulo);
    exigirSemEfeitos(estado, mp, `R3 ${rotulo}`);
  }
});

Deno.test("R4 sem credencial do MP (ou leitura dela falhando) → não pronto, motivo credencial", async () => {
  for (const [rotulo, token] of [
    ["sem token", null],
    ["leitura da credencial lança", new Error("registro_ilegivel")],
  ] as const) {
    const { supabase, estado } = bancoDaProntidao(RPC_VERDADEIRA);
    const credencial = credencialFalsa(token);
    const mp = mpFalso({});
    const r = await chamarProntidao({
      supabase,
      tokenDoMercadoPago: credencial.tokenDoMercadoPago,
      fetchImpl: mp.fetchImpl,
    });
    assertEquals(r.status, 200, rotulo);
    assertEquals(await r.json(), { pronto: false, motivo: "credencial" }, rotulo);
    assertEquals(credencial.espia.chamadas, 1, `${rotulo}: a credencial foi consultada`);
    exigirSemEfeitos(estado, mp, `R4 ${rotulo}`);
  }
});

Deno.test("R5 banco pronto + credencial → pronto, sem orderId no corpo", async () => {
  const { supabase, estado } = bancoDaProntidao(RPC_VERDADEIRA);
  const credencial = credencialFalsa("TOKEN-MP");
  const mp = mpFalso({});
  const r = await chamarProntidao({
    supabase,
    tokenDoMercadoPago: credencial.tokenDoMercadoPago,
    fetchImpl: mp.fetchImpl,
  });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { pronto: true });
  assertEquals(estado.rpcs.map((c) => c.nome), [FUNCAO_DE_PRONTIDAO]);
  assertEquals(credencial.espia.chamadas, 1);
  exigirSemEfeitos(estado, mp, "R5");
});
