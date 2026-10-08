// @ts-nocheck
/**
 * Testes da ação `cancelar` da criar-pagamento (S1, dinheiro, 04/10/2026).
 *
 * O que dói aqui: cancelar no BANCO com a cobrança ainda viva no Mercado Pago
 * (dinheiro que entra num pedido morto), ou cancelar sem provar nada. Cada
 * resposta possível do MP tem um caso, e nos ramos que NÃO autorizam a prova
 * é "zero efeito no banco": nenhuma chamada de RPC, nenhum UPDATE/INSERT.
 * O MP é falso (rotas por método + caminho); o banco é falso e CONTA cada
 * escrita. A regra do banco (CAS, posse, estoque) tem a prova viva em
 * tests/banco/cancelar-pedido-viva.cjs.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { cancelarPedidoPelaEdge, MENSAGENS_DO_CANCELAMENTO, verificarAdminAtualReal } from "./cancelar-pedido.ts";
import { handler } from "./index.ts";

const PEDIDO = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const ADMIN = "a2222222-2222-4222-8222-222222222222";
const ESTRANHO = "e3333333-3333-4333-8333-333333333333";
const ORDER = "ORD01JABCDEFGHJKMNPQRSTVWXYZ";
const CREDENCIAIS = { origem: "lojista", token: "TOKEN-FALSO", segredoWebhook: "s", publicKey: "p" };

function montarToken(sub: string | null): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `Bearer ${b64({ alg: "HS256" })}.${b64(sub ? { sub } : {})}.assinatura`;
}

function pedidoBase(extra: Record<string, unknown> = {}) {
  return {
    id: PEDIDO,
    user_id: CLIENTE,
    status: "pending",
    payment_status: "aguardando",
    gateway_payment_id: ORDER,
    metodo_online: "pix",
    created_at: "2026-10-04T10:00:00.000Z",
    ...extra,
  };
}

/** Banco falso: devolve a linha, registra RPC e QUALQUER escrita. */
function bancoFalso(linha: Record<string, unknown> | null, opts: {
  erroLeitura?: unknown;
  respostaRpc?: { data?: unknown; error?: unknown };
} = {}) {
  const registro = { rpcs: [] as Array<{ nome: string; args: Record<string, unknown> }>, escritas: 0 };
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: () => Promise.resolve({ data: opts.erroLeitura ? null : linha, error: opts.erroLeitura ?? null }),
    update: () => {
      registro.escritas += 1;
      return consulta;
    },
    insert: () => {
      registro.escritas += 1;
      return consulta;
    },
  };
  const supabase = {
    from: (tabela: string) => {
      assertEquals(tabela, "marketplace_orders");
      return consulta;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      return Promise.resolve(opts.respostaRpc ?? {
        data: { cancelado: true, ja_estava: false, pedido: { status: "cancelled", payment_status: linha?.payment_status } },
        error: null,
      });
    },
  };
  return { supabase, registro };
}

type Rota = (req: { metodo: string; url: string }) => Response | Promise<Response>;

/** MP falso: rotas por "MÉTODO caminho"; registra cada chamada. */
function mpFalso(rotas: Record<string, Rota>) {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const metodo = (init.method ?? "GET").toUpperCase();
    const caminho = new URL(url).pathname;
    const chave = `${metodo} ${caminho}`;
    chamadas.push(chave);
    const rota = rotas[chave] ?? (caminho === "/v1/orders" ? rotas["GET /v1/orders?busca"] : undefined);
    if (!rota) throw new Error(`rota não esperada no MP falso: ${chave}`);
    return await rota({ metodo, url });
  };
  return { fetchImpl, chamadas };
}

const jsonResp = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

const orderPix = (status: string, detalhe: string, extra: Record<string, unknown> = {}) => ({
  id: ORDER,
  external_reference: PEDIDO,
  status,
  status_detail: detalhe,
  transactions: { payments: [{ payment_method: { type: "bank_transfer", id: "pix" } }] },
  ...extra,
});
const orderCartao = (status: string, detalhe: string) => ({
  id: ORDER,
  external_reference: PEDIDO,
  status,
  status_detail: detalhe,
  transactions: { payments: [{ payment_method: { type: "credit_card", id: "visa" } }] },
});

const json = (corpo: unknown, status: number) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

async function cancelar(opts: {
  linha: Record<string, unknown> | null;
  mp?: ReturnType<typeof mpFalso>;
  sub?: string | null;
  adminAtual?: string | null;
  erroLeitura?: unknown;
  respostaRpc?: { data?: unknown; error?: unknown };
}) {
  const banco = bancoFalso(opts.linha, { erroLeitura: opts.erroLeitura, respostaRpc: opts.respostaRpc });
  let credenciaisPedidas = 0;
  let adminPerguntado = 0;
  const mp = opts.mp ?? mpFalso({});
  const sub = opts.sub === undefined ? CLIENTE : opts.sub;
  const resposta = await cancelarPedidoPelaEdge({
    supabase: banco.supabase,
    pedidoId: PEDIDO,
    sub,
    authorization: montarToken(sub),
    json,
    obterCredenciais: () => {
      credenciaisPedidas += 1;
      return Promise.resolve(CREDENCIAIS);
    },
    verificarAdminAtual: () => {
      adminPerguntado += 1;
      return Promise.resolve(opts.adminAtual ?? null);
    },
    fetchImpl: mp.fetchImpl,
  });
  const corpo = await resposta.json();
  return { status: resposta.status, corpo, banco: banco.registro, mp, credenciaisPedidas, adminPerguntado };
}

function semEfeitoNoBanco(r: { banco: { rpcs: unknown[]; escritas: number } }) {
  assertEquals(r.banco.rpcs, [], "nenhuma RPC — nada cancelado no banco");
  assertEquals(r.banco.escritas, 0, "nenhuma escrita direta");
}

// ─── O caminho feliz: o MP prova a anulação, SÓ então o banco ───────────────

Deno.test("PIX aberto: anula no MP (POST cancel → canceled) e SÓ então cancela no banco, com CAS na vaga e no pagamento lidos", async () => {
  const mp = mpFalso({
    [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderPix("action_required", "waiting_transfer")),
    [`POST /v1/orders/${ORDER}/cancel`]: () => jsonResp(orderPix("canceled", "canceled")),
  });
  const r = await cancelar({ linha: pedidoBase(), mp });
  assertEquals(r.status, 200);
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(r.corpo.jaEstava, false);
  assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`, `POST /v1/orders/${ORDER}/cancel`]);
  assertEquals(r.banco.rpcs, [{
    nome: "cancelar_pedido_com_cobranca",
    args: {
      p_order_id: PEDIDO,
      p_ator: CLIENTE,
      p_vaga_esperada: ORDER,
      p_pagamento_esperado: "aguardando",
      p_notes: null,
    },
  }]);
  assertEquals(r.banco.escritas, 0);
  assertEquals(r.adminPerguntado, 0, "o dono não precisa da conferência de admin");
});

Deno.test("GET já mostra a order MORTA (expirada) → prova bastante: cancela no banco sem POST", async () => {
  const mp = mpFalso({ [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderPix("expired", "expired")) });
  const r = await cancelar({ linha: pedidoBase(), mp });
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`]);
  assertEquals(r.banco.rpcs.length, 1);
});

Deno.test("cartão em `created` (nada em análise): anula no MP e cancela", async () => {
  const mp = mpFalso({
    [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderCartao("created", "created")),
    [`POST /v1/orders/${ORDER}/cancel`]: () => jsonResp(orderCartao("canceled", "canceled")),
  });
  const r = await cancelar({ linha: pedidoBase({ metodo_online: "credito" }), mp });
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(r.banco.rpcs.length, 1);
});

// ─── O MP NÃO prova: zero efeito no banco ────────────────────────────────────

for (const caso of [
  { nome: "409", resposta: () => jsonResp({ errors: [{ code: "order_cannot_be_canceled" }] }, 409) },
  { nome: "500", resposta: () => jsonResp({ message: "internal" }, 500) },
  { nome: "503", resposta: () => new Response("upstream", { status: 503 }) },
  {
    nome: "timeout (o fetch aborta)",
    resposta: () => {
      throw new DOMException("The signal has been aborted", "AbortError");
    },
  },
  { nome: "2xx ambíguo (ainda action_required)", resposta: () => jsonResp(orderPix("action_required", "waiting_transfer")) },
  { nome: "2xx sem corpo legível", resposta: () => new Response("<html>", { status: 200 }) },
  { nome: "2xx 'canceled' de OUTRA order", resposta: () => jsonResp({ ...orderPix("canceled", "canceled"), id: "ORDOUTRA" }) },
]) {
  Deno.test(`POST cancel responde ${caso.nome} → NÃO cancela no banco, "tente de novo", sem 2ª escrita no MP`, async () => {
    const mp = mpFalso({
      [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderPix("action_required", "waiting_transfer")),
      [`POST /v1/orders/${ORDER}/cancel`]: caso.resposta,
    });
    const r = await cancelar({ linha: pedidoBase(), mp });
    assertEquals(r.status, 200);
    assertEquals(r.corpo.cancelamento, "recuperavel");
    assertEquals(r.corpo.mensagem, MENSAGENS_DO_CANCELAMENTO.recuperavel);
    semEfeitoNoBanco(r);
    assertEquals(
      mp.chamadas.filter((c) => c.startsWith("POST")).length,
      1,
      "uma tentativa de anular, nunca uma segunda automática",
    );
  });
}

Deno.test("POST cancel 409 porque PAGOU no meio → a releitura (GET) reconhece: ja_pago, nada no banco", async () => {
  let gets = 0;
  const mp = mpFalso({
    [`GET /v1/orders/${ORDER}`]: () => {
      gets += 1;
      return jsonResp(gets === 1 ? orderPix("action_required", "waiting_transfer") : orderPix("processed", "accredited"));
    },
    [`POST /v1/orders/${ORDER}/cancel`]: () => jsonResp({ errors: [{ code: "order_already_processed" }] }, 409),
  });
  const r = await cancelar({ linha: pedidoBase(), mp });
  assertEquals(r.corpo.cancelamento, "ja_pago");
  assertEquals(r.corpo.mensagem, MENSAGENS_DO_CANCELAMENTO.ja_pago);
  semEfeitoNoBanco(r);
});

Deno.test("MP diz JÁ PAGO (processed:accredited) → não cancela, não tenta anular, nunca grava pago", async () => {
  const mp = mpFalso({ [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderPix("processed", "accredited")) });
  const r = await cancelar({ linha: pedidoBase(), mp });
  assertEquals(r.corpo.cancelamento, "ja_pago");
  assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`]);
  semEfeitoNoBanco(r);
});

for (const caso of [
  { nome: "cartão em análise (processing:in_process)", order: orderCartao("processing", "in_process") },
  { nome: "cartão no desafio 3DS (action_required:pending_challenge)", order: orderCartao("action_required", "pending_challenge") },
]) {
  for (const quem of ["cliente", "admin"]) {
    Deno.test(`${caso.nome} pelo ${quem} → em_analise: ninguém cancela, nada no MP além do GET, nada no banco`, async () => {
      const mp = mpFalso({ [`GET /v1/orders/${ORDER}`]: () => jsonResp(caso.order) });
      const r = await cancelar({
        linha: pedidoBase({ metodo_online: "credito" }),
        mp,
        sub: quem === "cliente" ? CLIENTE : ADMIN,
        adminAtual: quem === "admin" ? ADMIN : null,
      });
      assertEquals(r.corpo.cancelamento, "em_analise");
      assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`]);
      semEfeitoNoBanco(r);
    });
  }
}

Deno.test("GET da order falha (5xx) → recuperavel, sem POST e sem banco", async () => {
  const mp = mpFalso({ [`GET /v1/orders/${ORDER}`]: () => jsonResp({}, 502) });
  const r = await cancelar({ linha: pedidoBase(), mp });
  assertEquals(r.corpo.cancelamento, "recuperavel");
  assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`]);
  semEfeitoNoBanco(r);
});

Deno.test("a order da vaga é de OUTRO pedido (external_reference) → recuperavel, nunca anula a cobrança alheia", async () => {
  const mp = mpFalso({
    [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderPix("action_required", "waiting_transfer", { external_reference: "outro" })),
  });
  const r = await cancelar({ linha: pedidoBase(), mp });
  assertEquals(r.corpo.cancelamento, "recuperavel");
  assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`]);
  semEfeitoNoBanco(r);
});

Deno.test("order com dinheiro estornado num pedido ainda aguardando → recuperavel (estado inesperado não autoriza)", async () => {
  const mp = mpFalso({ [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderPix("refunded", "refunded")) });
  const r = await cancelar({ linha: pedidoBase(), mp });
  assertEquals(r.corpo.cancelamento, "recuperavel");
  semEfeitoNoBanco(r);
});

Deno.test("sem credencial do MP com cobrança na vaga → recuperavel, nada no MP nem no banco", async () => {
  const banco = bancoFalso(pedidoBase());
  const mp = mpFalso({});
  const resposta = await cancelarPedidoPelaEdge({
    supabase: banco.supabase,
    pedidoId: PEDIDO,
    sub: CLIENTE,
    authorization: montarToken(CLIENTE),
    json,
    obterCredenciais: () => Promise.resolve({ origem: "lojista", token: null, segredoWebhook: null, publicKey: null, motivo: "cofre" }),
    verificarAdminAtual: () => Promise.resolve(null),
    fetchImpl: mp.fetchImpl,
  });
  assertEquals((await resposta.json()).cancelamento, "recuperavel");
  assertEquals(mp.chamadas, []);
  semEfeitoNoBanco({ banco: banco.registro });
});

// ─── Sentinela `verificando:` ────────────────────────────────────────────────

const SENTINELA = `verificando:${PEDIDO}:c0:pabc:1790000000000`;

Deno.test("sentinela + CLIENTE → em_analise, sem busca no MP, sem banco", async () => {
  const mp = mpFalso({});
  const r = await cancelar({ linha: pedidoBase({ gateway_payment_id: SENTINELA, metodo_online: null }), mp });
  assertEquals(r.corpo.cancelamento, "em_analise");
  assertEquals(mp.chamadas, []);
  semEfeitoNoBanco(r);
});

Deno.test("sentinela + ADMIN, a busca não acha order nenhuma → cancela COM AVISO (CAS no sentinela)", async () => {
  const mp = mpFalso({ "GET /v1/orders?busca": () => jsonResp({ data: [], paging: { total: "0" } }) });
  const r = await cancelar({
    linha: pedidoBase({ gateway_payment_id: SENTINELA, metodo_online: null }),
    mp,
    sub: ADMIN,
    adminAtual: ADMIN,
  });
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(r.corpo.aviso, MENSAGENS_DO_CANCELAMENTO.avisoSentinela);
  assertEquals(r.banco.rpcs[0].args.p_vaga_esperada, SENTINELA);
  assertEquals(r.banco.rpcs[0].args.p_ator, ADMIN);
});

Deno.test("sentinela + ADMIN, a busca acha uma order VIVA do pedido → em_analise, nada no banco", async () => {
  const mp = mpFalso({
    "GET /v1/orders?busca": () => jsonResp({ data: [orderCartao("processing", "in_process")], paging: { total: "1" } }),
  });
  const r = await cancelar({
    linha: pedidoBase({ gateway_payment_id: SENTINELA, metodo_online: null }),
    mp,
    sub: ADMIN,
    adminAtual: ADMIN,
  });
  assertEquals(r.corpo.cancelamento, "em_analise");
  semEfeitoNoBanco(r);
});

Deno.test("sentinela + ADMIN, a busca falha → recuperavel, nada no banco", async () => {
  const mp = mpFalso({ "GET /v1/orders?busca": () => jsonResp({}, 500) });
  const r = await cancelar({
    linha: pedidoBase({ gateway_payment_id: SENTINELA, metodo_online: null }),
    mp,
    sub: ADMIN,
    adminAtual: ADMIN,
  });
  assertEquals(r.corpo.cancelamento, "recuperavel");
  semEfeitoNoBanco(r);
});

Deno.test("sentinela RECENTE (a RPC diz cobranca_em_criacao) → em_analise", async () => {
  const mp = mpFalso({ "GET /v1/orders?busca": () => jsonResp({ data: [], paging: { total: "0" } }) });
  const r = await cancelar({
    linha: pedidoBase({ gateway_payment_id: SENTINELA, metodo_online: null }),
    mp,
    sub: ADMIN,
    adminAtual: ADMIN,
    respostaRpc: { data: { cancelado: false, motivo: "cobranca_em_criacao", pedido: { status: "pending" } }, error: null },
  });
  assertEquals(r.corpo.cancelamento, "em_analise");
});

// ─── Sem cobrança a anular, posse, e as respostas da RPC ─────────────────────

Deno.test("sem cobrança na vaga → nenhuma chamada ao MP, nem credencial; a RPC com CAS na vaga NULL", async () => {
  const mp = mpFalso({});
  const r = await cancelar({ linha: pedidoBase({ gateway_payment_id: null, metodo_online: null }), mp });
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(mp.chamadas, []);
  assertEquals(r.credenciaisPedidas, 0);
  assertEquals(r.banco.rpcs[0].args.p_vaga_esperada, null);
});

Deno.test("pedido PAGO (cliente cancela antes do envio) → sem MP; a RPC com o pagamento 'pago' esperado (o estorno nasce no ledger)", async () => {
  const mp = mpFalso({});
  const r = await cancelar({ linha: pedidoBase({ payment_status: "pago", status: "processing" }), mp });
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(mp.chamadas, []);
  assertEquals(r.banco.rpcs[0].args.p_pagamento_esperado, "pago");
});

Deno.test("nem dono nem admin atual → o MESMO 404 de sempre, nada no MP nem no banco", async () => {
  const mp = mpFalso({});
  const r = await cancelar({ linha: pedidoBase(), mp, sub: ESTRANHO, adminAtual: null });
  assertEquals(r.status, 404);
  assertEquals(r.corpo.error, "Pedido não encontrado.");
  assertEquals(r.adminPerguntado, 1);
  assertEquals(mp.chamadas, []);
  semEfeitoNoBanco(r);
});

Deno.test("sem sessão → 404, sem nada", async () => {
  const r = await cancelar({ linha: pedidoBase(), sub: null, adminAtual: null });
  assertEquals(r.status, 404);
  semEfeitoNoBanco(r);
});

Deno.test("pedido já cancelado → cancelado/jaEstava sem RPC nem MP", async () => {
  const mp = mpFalso({});
  const r = await cancelar({ linha: pedidoBase({ status: "cancelled" }), mp });
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(r.corpo.jaEstava, true);
  assertEquals(mp.chamadas, []);
  semEfeitoNoBanco(r);
});

Deno.test("a RPC diz cobranca_mudou (CAS perdeu) → mudou, com o pedido relido", async () => {
  const mp = mpFalso({
    [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderPix("action_required", "waiting_transfer")),
    [`POST /v1/orders/${ORDER}/cancel`]: () => jsonResp(orderPix("canceled", "canceled")),
  });
  const r = await cancelar({
    linha: pedidoBase(),
    mp,
    respostaRpc: {
      data: { cancelado: false, motivo: "cobranca_mudou", pedido: { status: "pending", payment_status: "pago" } },
      error: null,
    },
  });
  assertEquals(r.corpo.cancelamento, "mudou");
  assertEquals(r.corpo.pedido, { status: "pending", paymentStatus: "pago" });
});

Deno.test("a RPC recusa por REGRA (P0001) → 409 recusado com a mensagem do banco; outro erro → recuperavel", async () => {
  const regra = await cancelar({
    linha: pedidoBase({ gateway_payment_id: null }),
    respostaRpc: { data: null, error: { code: "P0001", message: "Este pedido não pode mais ser cancelado por você." } },
  });
  assertEquals(regra.status, 409);
  assertEquals(regra.corpo.cancelamento, "recusado");
  assertEquals(regra.corpo.error, "Este pedido não pode mais ser cancelado por você.");
  const falha = await cancelar({
    linha: pedidoBase({ gateway_payment_id: null }),
    respostaRpc: { data: null, error: { code: "57014", message: "timeout" } },
  });
  assertEquals(falha.status, 200);
  assertEquals(falha.corpo.cancelamento, "recuperavel");
});

Deno.test("leitura do pedido falha → 503 recuperável, nada no MP", async () => {
  const mp = mpFalso({});
  const r = await cancelar({ linha: pedidoBase(), mp, erroLeitura: { message: "pool" } });
  assertEquals(r.status, 503);
  assertEquals(r.corpo.cancelamento, "recuperavel");
  assertEquals(mp.chamadas, []);
});

Deno.test("pagamento da API clássica (id numérico) → 409, nada anulado nem cancelado", async () => {
  const mp = mpFalso({});
  const r = await cancelar({ linha: pedidoBase({ gateway_payment_id: "123456789" }), mp });
  assertEquals(r.status, 409);
  assertEquals(r.corpo.cancelamento, "recusado");
  assertEquals(mp.chamadas, []);
  semEfeitoNoBanco(r);
});

// ─── A fiação no handler ─────────────────────────────────────────────────────

Deno.test("handler: metodo 'cancelar' chega à ação nova (ADMIN pela conferência injetada) e não passa por podeCobrar", async () => {
  const banco = bancoFalso(pedidoBase({ gateway_payment_id: null, metodo_online: null, user_id: CLIENTE }));
  const resposta = await handler(
    new Request("http://localhost/criar-pagamento", {
      method: "POST",
      headers: { Authorization: montarToken(ADMIN), "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: PEDIDO, metodo: "cancelar" }),
    }),
    {
      supabase: banco.supabase,
      fetchImpl: mpFalso({}).fetchImpl,
      credenciaisMp: CREDENCIAIS,
      verificarAdminAtual: () => Promise.resolve(ADMIN),
    },
  );
  assertEquals(resposta.status, 200);
  const corpo = await resposta.json();
  assertEquals(corpo.cancelamento, "cancelado");
  assertEquals(banco.registro.rpcs[0].args.p_ator, ADMIN);
});

Deno.test("handler: 'cancelar' com orderId inválido → 400 antes de tudo", async () => {
  const resposta = await handler(
    new Request("http://localhost/criar-pagamento", {
      method: "POST",
      headers: { Authorization: montarToken(CLIENTE), "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "nao-e-uuid", metodo: "cancelar" }),
    }),
    { supabase: bancoFalso(null).supabase, verificarAdminAtual: () => Promise.resolve(null) },
  );
  assertEquals(resposta.status, 400);
  assert((await resposta.json()).error);
});

// ─── Admin ATUAL de verdade: a conferência real, com Auth/PostgREST falsos ──
//
// Achado do coordenador (04/10): decidir só por `profiles.role` deixava um
// ex-admin (auth.users rebaixado, perfil ainda "admin") chegar ao POST de
// anulação no MP de pedido ALHEIO antes de a RPC negar. Estes casos rodam a
// `verificarAdminAtualReal` de verdade (supabase-js com `fetch` injetado) pelo
// HANDLER, com o MP falso contando cada chamada.

const URL_FALSA = "http://supabase.falso";

function supabaseAuthFalso(opts: { papelNoAuth: string | null; papelNoPerfil: string | null; id?: string }) {
  const chamadas: string[] = [];
  const responder = (entrada: Request | string | URL, init: RequestInit = {}) => {
    const req = entrada instanceof Request ? entrada : new Request(String(entrada), init);
    const u = new URL(req.url);
    chamadas.push(`${req.method} ${u.pathname}`);
    if (u.pathname === "/auth/v1/user") {
      return jsonResp({
        id: opts.id ?? ESTRANHO,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: opts.papelNoAuth ? { role: opts.papelNoAuth } : {},
        user_metadata: {},
      });
    }
    if (u.pathname === "/rest/v1/profiles") {
      const linhas = opts.papelNoPerfil === null ? [] : [{ role: opts.papelNoPerfil }];
      if ((req.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
        return linhas.length ? jsonResp(linhas[0]) : jsonResp({ code: "PGRST116", message: "0 rows" }, 406);
      }
      return jsonResp(linhas);
    }
    throw new Error(`rota não esperada no Supabase falso: ${req.method} ${u.pathname}`);
  };
  // Sem async: o throw acima vira promessa rejeitada pelo construtor.
  const fetchImpl = (entrada: Request | string | URL, init: RequestInit = {}) =>
    new Promise<Response>((resolve) => resolve(responder(entrada, init)));
  return { fetchImpl, chamadas };
}

async function cancelarPeloHandlerComAdminReal(opts: {
  linha: Record<string, unknown>;
  sub: string;
  papelNoAuth: string | null;
  papelNoPerfil: string | null;
  mp: ReturnType<typeof mpFalso>;
}) {
  const banco = bancoFalso(opts.linha);
  const auth = supabaseAuthFalso({ papelNoAuth: opts.papelNoAuth, papelNoPerfil: opts.papelNoPerfil, id: opts.sub });
  const resposta = await handler(
    new Request("http://localhost/criar-pagamento", {
      method: "POST",
      headers: { Authorization: montarToken(opts.sub), "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: PEDIDO, metodo: "cancelar" }),
    }),
    {
      supabase: banco.supabase,
      fetchImpl: opts.mp.fetchImpl,
      credenciaisMp: CREDENCIAIS,
      verificarAdminAtual: (authorization: string | null) =>
        verificarAdminAtualReal(authorization, {
          fetchImpl: auth.fetchImpl as typeof fetch,
          url: URL_FALSA,
          chavePublica: "chave-publica-falsa",
          chaveDeServico: "chave-servico-falsa",
        }),
    },
  );
  return { status: resposta.status, corpo: await resposta.json(), banco: banco.registro, auth };
}

const mpQueAnula = () =>
  mpFalso({
    [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderPix("action_required", "waiting_transfer")),
    [`POST /v1/orders/${ORDER}/cancel`]: () => jsonResp(orderPix("canceled", "canceled")),
  });

for (const caso of [
  { nome: "auth.users REBAIXADO + perfil admin", papelNoAuth: null, papelNoPerfil: "admin" },
  { nome: "auth.users admin + perfil REBAIXADO", papelNoAuth: "admin", papelNoPerfil: "customer" },
  { nome: "auth.users admin + SEM perfil", papelNoAuth: "admin", papelNoPerfil: null },
]) {
  for (const pedidoCaso of [
    { rotulo: "PIX aberto de outro cliente", linha: pedidoBase() },
    { rotulo: "payment_status NULL + cobrança viva de outro cliente", linha: pedidoBase({ payment_status: null }) },
    {
      rotulo: "pago de outro cliente",
      linha: pedidoBase({ status: "processing", payment_status: "pago" }),
    },
    {
      rotulo: "offline de outro cliente",
      linha: pedidoBase({ status: "processing", payment_status: null, gateway_payment_id: null, metodo_online: null }),
    },
  ]) {
    Deno.test(`admin ATUAL contraditório (${caso.nome}) — ${pedidoCaso.rotulo}: 404, ZERO chamada ao MP, ZERO RPC/escrita`, async () => {
      const mp = mpQueAnula();
      const r = await cancelarPeloHandlerComAdminReal({
        linha: pedidoCaso.linha,
        sub: ESTRANHO,
        papelNoAuth: caso.papelNoAuth,
        papelNoPerfil: caso.papelNoPerfil,
        mp,
      });
      assertEquals(r.status, 404);
      assertEquals(mp.chamadas, [], "nenhum GET/POST ao Mercado Pago");
      semEfeitoNoBanco(r);
      assert(r.auth.chamadas.includes("GET /auth/v1/user"), "a conferência real rodou");
    });
  }
}

Deno.test("controle: admin ATUAL coerente (auth.users E perfil admin) anula no MP e cancela pedido de outro cliente", async () => {
  const mp = mpQueAnula();
  const r = await cancelarPeloHandlerComAdminReal({
    linha: pedidoBase(),
    sub: ESTRANHO,
    papelNoAuth: "admin",
    papelNoPerfil: "admin",
    mp,
  });
  assertEquals(r.status, 200);
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`, `POST /v1/orders/${ORDER}/cancel`]);
  assertEquals(r.banco.rpcs.length, 1);
  assertEquals(r.banco.rpcs[0].args.p_ator, ESTRANHO);
  assertEquals(r.auth.chamadas, ["GET /auth/v1/user", "GET /rest/v1/profiles"]);
});

Deno.test("controle: o DONO segue pelo caminho dele — nenhuma conferência de admin, anula e cancela", async () => {
  const mp = mpQueAnula();
  const r = await cancelarPeloHandlerComAdminReal({
    linha: pedidoBase(),
    sub: CLIENTE,
    papelNoAuth: null,
    papelNoPerfil: "customer",
    mp,
  });
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(r.auth.chamadas, [], "o dono não passa pela conferência de admin");
  assertEquals(r.banco.rpcs[0].args.p_ator, CLIENTE);
});

// ─── payment_status NULL com a vaga ocupada é TRANSITÓRIO ────────────────────

Deno.test("NULL + cobrança na vaga NÃO é 'sem cobrança': consulta o MP; 5xx → recuperável, ZERO RPC", async () => {
  const mp = mpFalso({ [`GET /v1/orders/${ORDER}`]: () => jsonResp({ message: "erro" }, 500) });
  const r = await cancelar({ linha: pedidoBase({ payment_status: null }), mp });
  assertEquals(r.corpo.cancelamento, "recuperavel");
  assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`]);
  semEfeitoNoBanco(r);
});

Deno.test("NULL + cobrança na vaga: o MP prova a anulação → cancela no banco com CAS no NULL lido", async () => {
  const r = await cancelar({ linha: pedidoBase({ payment_status: null }), mp: mpQueAnula() });
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(r.banco.rpcs.length, 1);
  assertEquals(r.banco.rpcs[0].args.p_pagamento_esperado, null);
  assertEquals(r.banco.rpcs[0].args.p_vaga_esperada, ORDER);
});

Deno.test("NULL + cobrança na vaga e o MP diz PAGA → ja_pago, ZERO RPC", async () => {
  const mp = mpFalso({ [`GET /v1/orders/${ORDER}`]: () => jsonResp(orderPix("processed", "accredited")) });
  const r = await cancelar({ linha: pedidoBase({ payment_status: null }), mp });
  assertEquals(r.corpo.cancelamento, "ja_pago");
  semEfeitoNoBanco(r);
});
