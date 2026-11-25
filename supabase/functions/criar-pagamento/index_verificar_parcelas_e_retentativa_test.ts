// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `criar-pagamento/index.ts`. Cada teste
 * abaixo fecha um buraco que sobreviveu à suíte antiga: o código podia ser
 * trocado por uma versão errada e nenhum teste avisava.
 *
 *  - `verificar`, releitura do pedido: erro do banco COM linha na mão, ou
 *    linha ausente, é "não consegui consultar" (503), nunca resposta por cima
 *    de dado em dúvida; vaga vazia ("") é vaga livre.
 *  - `verificar`, confirmação imediata: se a função do banco (RPC) disse que
 *    o pagamento foi confirmado AGORA ('pago', 'pago_apos_expirar', 'ja_pago'),
 *    a resposta é "pago" mesmo quando a releitura seguinte falha; e uma
 *    releitura que devolve ERRO junto com dado nunca vale como prova.
 *  - parcelamento: "3 " / "3.0" / "0x3" / "1e1" não são parcela (só 1-2
 *    dígitos); `parcelas_max` fora de 1..12 ou fracionário vale 1.
 *  - teto de tentativas do cartão: `tentativas_de_pagamento` lixo (7.5) vale
 *    0, e pedido de dono vazio nunca soma os pedidos "do dono vazio".
 *
 * Banco e Mercado Pago são locais e falsos; nada de rede, nada de espera real.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { orderCartaoAprovadaDaDoc } from "../_shared/prova-de-pagamento_fixtures.ts";
import { handler, validarCorpoDoCartao } from "./index.ts";

const UUID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const DONO = "5f5f5f5f-6666-7777-8888-999900001111";
const VAGA = "ORDTST05VERIFICARPARCELAS0000";
const PRAZO = "2099-01-01T00:00:00.000Z";
const CREDENCIAIS = {
  origem: "lojista",
  token: "TOKEN-FALSO-DE-TESTE",
  segredoWebhook: "WEBHOOK-FALSO-DE-TESTE",
  publicKey: "PUBLICA-FALSA-DE-TESTE",
};

function montarToken(sub: string): string {
  const base64 = btoa(JSON.stringify({ sub })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `cabecalho.${base64}.assinatura`;
}

function pedidoDe(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UUID,
    user_id: DONO,
    total: 100,
    payment_status: "aguardando",
    status: "pending",
    payment_method: "online",
    gateway_payment_id: null,
    tentativas_de_pagamento: 0,
    expires_at: PRAZO,
    created_at: "2026-11-25T10:00:00.000Z",
    customer_data: { email: "cliente@exemplo.com" },
    ...extra,
  };
}

type Resposta = { data: unknown; error: unknown };

/**
 * Banco falso que escolhe a resposta pela LISTA DE COLUNAS pedida (cada leitura
 * do `verificar` pede uma lista diferente), então a ordem das leituras não
 * precisa ser adivinhada. A gravação (`update`) é a barreira "chegou na reserva
 * da cobrança": registra e lança, e nenhum teste de cobrança passa dela.
 */
function banco(o: {
  entrada: Record<string, unknown>;
  relida?: Resposta;
  confirmada?: Resposta;
  confirmarPagamento?: string;
  config?: Record<string, unknown> | null;
  somaDoCliente?: Array<Record<string, unknown>>;
}) {
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const escritas: Array<Record<string, unknown>> = [];
  const leiturasDoCliente: unknown[][] = [];
  const cadeiaDe = (r: Resposta) => ({ eq: () => ({ maybeSingle: async () => r }) });
  return {
    rpcs,
    escritas,
    leiturasDoCliente,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      if (nome === "confirmar_pagamento") return { data: o.confirmarPagamento ?? "pago", error: null };
      if (nome === "reservar_aviso_ao_lojista") return { data: "reservado", error: null };
      if (nome === "confirmar_aviso_ao_lojista" || nome === "liberar_aviso_ao_lojista") {
        return { data: true, error: null };
      }
      throw new Error(`rpc inesperada: ${nome}`);
    },
    from(tabela: string) {
      if (tabela === "config_pagamento_cartao") {
        return { select: () => cadeiaDe({ data: o.config ?? null, error: null }) };
      }
      if (tabela !== "marketplace_orders") throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select(colunas: string) {
          if (colunas === "tentativas_de_pagamento") {
            const cadeia = {
              eq: (...a: unknown[]) => {
                leiturasDoCliente.push(a);
                return cadeia;
              },
              gte: () => cadeia,
              gt: () => cadeia,
              limit: () => Promise.resolve({ data: o.somaDoCliente ?? [], error: null }),
            };
            return cadeia;
          }
          if (colunas.startsWith("id, customer_name")) return cadeiaDe({ data: { id: UUID, total: 100 }, error: null });
          if (colunas.startsWith("id, user_id")) return cadeiaDe({ data: o.entrada, error: null });
          if (colunas === "payment_status, status, expires_at, gateway_payment_id, total") {
            return cadeiaDe(o.relida ?? { data: o.entrada, error: null });
          }
          if (colunas === "payment_status, status, expires_at, gateway_payment_id") {
            return cadeiaDe(o.confirmada ?? { data: o.entrada, error: null });
          }
          throw new Error(`leitura inesperada: ${colunas}`);
        },
        update(valores: Record<string, unknown>) {
          escritas.push(valores);
          throw new Error("RESERVA_ALCANCADA");
        },
      };
    },
  };
}

/** MP falso: só GET por id; qualquer outro verbo derruba o teste. */
function mercadoPago(orders: Array<Record<string, unknown>> = []) {
  const chamadas: string[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const verbo = init?.method ?? "GET";
    chamadas.push(`${verbo} ${url}`);
    if (verbo !== "GET") throw new Error(`o verificar nunca faz ${verbo}: ${url}`);
    const id = url.split("/v1/orders/")[1]?.split("?")[0] ?? "";
    const alvo = orders.find((o) => o.id === id);
    return alvo
      ? new Response(JSON.stringify(alvo), { status: 200 })
      : new Response(JSON.stringify({ message: "not_found" }), { status: 404 });
  };
  return { fn, chamadas };
}

async function emSilencio<T>(f: () => Promise<T>): Promise<T> {
  const erro = console.error;
  const aviso = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await f();
  } finally {
    console.error = erro;
    console.warn = aviso;
  }
}

async function chamar(
  corpo: Record<string, unknown>,
  db: unknown,
  mp: { fn: (url: string, init?: RequestInit) => Promise<Response> },
  sub: string = DONO,
): Promise<{ status: number; corpo: Record<string, unknown> | null; lancou: string | null }> {
  try {
    const r = await emSilencio(() =>
      handler(
        new Request("http://localhost/criar-pagamento", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: montarToken(sub) },
          body: JSON.stringify(corpo),
        }),
        {
          supabase: db as never,
          fetchImpl: mp.fn as typeof fetch,
          credenciaisMp: CREDENCIAIS,
          enviarPush: async () => {},
          enviarComprovante: async () => {},
          enviarAvisoAtrasado: async () => {},
          alertarAdminCartaoOrfao: async () => {},
        },
      )
    );
    return { status: r.status, corpo: await r.json(), lancou: null };
  } catch (erro) {
    return { status: 0, corpo: null, lancou: erro instanceof Error ? erro.message : String(erro) };
  }
}

const verificarDoPedido = { orderId: UUID, metodo: "verificar" };
const cartaoPagoNoMp = () => ({
  ...orderCartaoAprovadaDaDoc({ id: VAGA, externalReference: UUID, valor: "100.00" }),
  total_paid_amount: "100.00",
});
const pedidoComCartaoNaVaga = () => pedidoDe({ gateway_payment_id: VAGA });
const relidaComCartaoNaVaga = (): Resposta => ({ data: pedidoComCartaoNaVaga(), error: null });
const INDISPONIVEL = {
  error: "Não foi possível consultar o pagamento agora.",
  verificacao: "indisponivel",
};

// ── verificar: a releitura que decide a resposta ──────────────────────────

Deno.test("verificar: a releitura volta com ERRO do banco (mesmo trazendo linha) -> 503 'indisponivel', nunca responde por cima do dado em dúvida", async () => {
  const db = banco({
    entrada: pedidoDe(),
    relida: { data: pedidoDe(), error: { message: "statement timeout" } },
  });
  const r = await chamar(verificarDoPedido, db, mercadoPago());
  assertEquals(r.lancou, null);
  assertEquals(r.status, 503);
  assertEquals(r.corpo, INDISPONIVEL);
  assertEquals(db.escritas.length, 0);
});

Deno.test("verificar: a releitura volta SEM erro e SEM linha (pedido sumiu entre as leituras) -> 503 'indisponivel', não 500 por exceção", async () => {
  const db = banco({ entrada: pedidoDe(), relida: { data: null, error: null } });
  const r = await chamar(verificarDoPedido, db, mercadoPago());
  assertEquals(r.lancou, null);
  assertEquals(r.status, 503);
  assertEquals(r.corpo, INDISPONIVEL);
});

Deno.test("verificar: vaga vazia ('') na releitura é vaga LIVRE, e não vira uma consulta ao MP por um id vazio", async () => {
  const db = banco({ entrada: pedidoDe(), relida: { data: pedidoDe({ gateway_payment_id: "" }), error: null } });
  const mp = mercadoPago();
  const r = await chamar(verificarDoPedido, db, mp);
  assertEquals(r.lancou, null);
  assertEquals(r.status, 200);
  assertEquals(r.corpo, { verificacao: "livre", paymentId: null, expiraEm: PRAZO });
  assertEquals(mp.chamadas, []);
});

// ── verificar: o que vale depois da confirmação imediata ──────────────────

for (const desfecho of ["pago", "pago_apos_expirar", "ja_pago"]) {
  Deno.test(`verificar: a RPC respondeu '${desfecho}' e a releitura seguinte FALHA -> responde 'pago' (a RPC é quem confirmou), com o paymentId da vaga`, async () => {
    const db = banco({
      entrada: pedidoComCartaoNaVaga(),
      relida: relidaComCartaoNaVaga(),
      confirmarPagamento: desfecho,
      confirmada: { data: null, error: { message: "banco fora" } },
    });
    const r = await chamar(verificarDoPedido, db, mercadoPago([cartaoPagoNoMp()]));
    assertEquals(r.lancou, null);
    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { verificacao: "pago", paymentId: VAGA, expiraEm: PRAZO });
    assertEquals(db.rpcs.filter((c) => c.nome === "confirmar_pagamento").length, 1);
  });
}

Deno.test("verificar: a RPC NÃO confirmou ('divergente') e a releitura falha -> 'em_analise', nunca 'pago'", async () => {
  const db = banco({
    entrada: pedidoComCartaoNaVaga(),
    relida: relidaComCartaoNaVaga(),
    confirmarPagamento: "divergente",
    confirmada: { data: null, error: { message: "banco fora" } },
  });
  const r = await chamar(verificarDoPedido, db, mercadoPago([cartaoPagoNoMp()]));
  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "em_analise", paymentId: VAGA, expiraEm: PRAZO });
});

Deno.test("verificar: releitura que devolve ERRO junto com uma linha 'pago' NÃO vale como prova — sem confirmação agora, fica 'em_analise'", async () => {
  const db = banco({
    entrada: pedidoComCartaoNaVaga(),
    relida: relidaComCartaoNaVaga(),
    confirmarPagamento: "divergente",
    confirmada: { data: pedidoDe({ gateway_payment_id: VAGA, payment_status: "pago" }), error: { message: "resposta parcial" } },
  });
  const r = await chamar(verificarDoPedido, db, mercadoPago([cartaoPagoNoMp()]));
  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "em_analise", paymentId: VAGA, expiraEm: PRAZO });
});

Deno.test("verificar: contraste — releitura SEM erro e com a linha 'pago' (o webhook chegou antes) -> 'pago' pelo banco", async () => {
  const db = banco({
    entrada: pedidoComCartaoNaVaga(),
    relida: relidaComCartaoNaVaga(),
    confirmarPagamento: "divergente",
    confirmada: { data: pedidoDe({ gateway_payment_id: VAGA, payment_status: "pago" }), error: null },
  });
  const r = await chamar(verificarDoPedido, db, mercadoPago([cartaoPagoNoMp()]));
  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "pago", paymentId: VAGA, expiraEm: PRAZO });
});

// ── parcelas: o que é um número de parcelas ───────────────────────────────

const CARTAO_BASE = {
  token: "ff8080814c11e237014c1ff593b57b4d",
  paymentMethodId: "master",
  paymentTypeId: "credit_card",
  documento: { type: "CPF", number: "12345678909" },
};

Deno.test("validarCorpoDoCartao: parcelas em texto só valem com 1-2 dígitos puros — ' 3', '3 ', '3.0', '0x3', '1e1', '+3', '-3' são recusadas", () => {
  for (const ruim of [" 3", "3 ", "3.0", "0x3", "1e1", "+3", "-3"]) {
    const r = validarCorpoDoCartao({ ...CARTAO_BASE, parcelas: ruim });
    assertEquals(r, { ok: false, erro: "Número de parcelas inválido." }, `parcelas ${JSON.stringify(ruim)}`);
  }
});

Deno.test("validarCorpoDoCartao: contraste — '3' (texto) e 3 (número) viram 3 parcelas; débito sem parcelas vira 1", () => {
  const texto = validarCorpoDoCartao({ ...CARTAO_BASE, parcelas: "3" });
  const numero = validarCorpoDoCartao({ ...CARTAO_BASE, parcelas: 3 });
  assertEquals(texto.ok && texto.dados.parcelas, 3);
  assertEquals(numero.ok && numero.dados.parcelas, 3);
  const debito = validarCorpoDoCartao({ ...CARTAO_BASE, paymentTypeId: "debit_card" });
  assertEquals(debito.ok && debito.dados.parcelas, 1);
});

// ── teto de parcelas da loja (config_pagamento_cartao.parcelas_max) ───────

const corpoDeCartao = (extra: Record<string, unknown> = {}) => ({
  orderId: UUID,
  metodo: "cartao",
  ...CARTAO_BASE,
  parcelas: 2,
  ...extra,
});
const PARCELAMENTO_RECUSADO = { error: "Esse parcelamento não está disponível nesta loja." };

for (const maximo of [13, 2.5, 0, -1, "abc", null, 100]) {
  Deno.test(`parcelas_max inválido (${JSON.stringify(maximo)}) vale 1: crédito em 2x -> 400 'parcelamento não disponível', nada gravado`, async () => {
    const db = banco({
      entrada: pedidoDe(),
      config: { credito: true, debito: true, parcelas_max: maximo },
    });
    const r = await chamar(corpoDeCartao(), db, mercadoPago());
    assertEquals(r.lancou, null);
    assertEquals(r.status, 400, JSON.stringify(r.corpo));
    assertEquals(r.corpo, PARCELAMENTO_RECUSADO);
    assertEquals(db.escritas.length, 0);
  });
}

Deno.test("parcelas_max 12 (o limite de cima) deixa passar 12x — chega até a reserva da cobrança, sem o 400 de parcelamento", async () => {
  const db = banco({ entrada: pedidoDe(), config: { credito: true, debito: true, parcelas_max: 12 } });
  const r = await chamar(corpoDeCartao({ parcelas: 12 }), db, mercadoPago());
  assertEquals(r.corpo?.error === PARCELAMENTO_RECUSADO.error, false);
  assertEquals(db.escritas.length > 0, true, "tinha de chegar à reserva da vaga");
});

// ── teto de tentativas do cartão ──────────────────────────────────────────

const LIMITE_DO_PEDIDO = {
  error: "Muitas tentativas com cartão. Para concluir, pague com PIX.",
  codigo: "CARTAO_FORMA_DESLIGADA",
  limiteDeTentativas: true,
};
const CONFIG_LIGADA = { credito: true, debito: true, parcelas_max: 12 };

for (const lixo of [7.5, "7.5", 5.5, "abc", -9, null]) {
  Deno.test(`tentativas_de_pagamento ilegível (${JSON.stringify(lixo)}) vale 0: o cartão NÃO é barrado pelo teto e chega à reserva`, async () => {
    const db = banco({ entrada: pedidoDe({ tentativas_de_pagamento: lixo }), config: CONFIG_LIGADA });
    const r = await chamar(corpoDeCartao({ parcelas: 1 }), db, mercadoPago());
    assertEquals(r.corpo?.limiteDeTentativas === true, false, JSON.stringify(r.corpo));
    assertEquals(db.escritas.length > 0, true, "tinha de chegar à reserva da vaga");
  });
}

Deno.test("contraste: 5 tentativas mortas no pedido -> 409 limiteDeTentativas e nada gravado; 4 passam", async () => {
  const barrado = banco({ entrada: pedidoDe({ tentativas_de_pagamento: 5 }), config: CONFIG_LIGADA });
  const r5 = await chamar(corpoDeCartao({ parcelas: 1 }), barrado, mercadoPago());
  assertEquals(r5.status, 409);
  assertEquals(r5.corpo, LIMITE_DO_PEDIDO);
  assertEquals(barrado.escritas.length, 0);

  const livre = banco({ entrada: pedidoDe({ tentativas_de_pagamento: 4 }), config: CONFIG_LIGADA });
  const r4 = await chamar(corpoDeCartao({ parcelas: 1 }), livre, mercadoPago());
  assertEquals(r4.corpo?.limiteDeTentativas === true, false);
  assertEquals(livre.escritas.length > 0, true);
});

Deno.test("pedido com dono VAZIO ('') nunca soma as tentativas de 'todos os pedidos do dono vazio': a consulta do cliente nem é feita", async () => {
  const db = banco({
    entrada: pedidoDe({ user_id: "" }),
    config: CONFIG_LIGADA,
    // se a soma fosse feita, estas linhas (3 x 5 = 15) fechariam o teto do cliente
    somaDoCliente: [{ tentativas_de_pagamento: 5 }, { tentativas_de_pagamento: 5 }, { tentativas_de_pagamento: 5 }],
  });
  const r = await chamar(corpoDeCartao({ parcelas: 1 }), db, mercadoPago(), "");
  assertEquals(r.corpo?.limiteDeTentativas === true, false, JSON.stringify(r.corpo));
  assertEquals(db.leiturasDoCliente, [], "dono vazio não consulta a soma do cliente");
  assertEquals(db.escritas.length > 0, true, "tinha de chegar à reserva da vaga");
});

Deno.test("contraste: dono de verdade com 15 tentativas somadas nas últimas 24 h -> 409 limiteDeTentativas (teto do cliente)", async () => {
  const db = banco({
    entrada: pedidoDe(),
    config: CONFIG_LIGADA,
    somaDoCliente: [{ tentativas_de_pagamento: 5 }, { tentativas_de_pagamento: 5 }, { tentativas_de_pagamento: 5 }],
  });
  const r = await chamar(corpoDeCartao({ parcelas: 1 }), db, mercadoPago());
  assertEquals(r.status, 409);
  assertEquals(r.corpo, LIMITE_DO_PEDIDO);
  assertEquals(db.leiturasDoCliente.length, 1);
  assertEquals(db.escritas.length, 0);
});
