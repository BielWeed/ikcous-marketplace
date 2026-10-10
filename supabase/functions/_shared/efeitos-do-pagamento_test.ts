// @ts-nocheck
/**
 * Testes de `_shared/efeitos-do-pagamento.ts` — a RPC da confirmação imediata
 * e os efeitos que ela dispara.
 *
 * O que erra caro: efeito em DOBRO (o webhook já avisou, e esta rota avisa de
 * novo), efeito SEM transição ('ja_pago' disparando push), o comprovante
 * padrão num 'pago_apos_expirar' (mentiria "entra na fila de separação"), e
 * texto que diverge do webhook (o lojista recebe dois formatos para o mesmo
 * fato). A paridade do E-MAIL é provada aqui contra as exportações do
 * webhook; a do PUSH, rodando o handler do webhook de verdade, em
 * `criar-pagamento/index_test.ts`.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  aplicarEfeitosDoPagamentoConfirmado,
  assuntoDoAvisoDePagamentoAtrasado,
  avisoAoLojista,
  confirmarPagamentoProvado,
  htmlDoAvisoDePagamentoAtrasado,
} from "./efeitos-do-pagamento.ts";
import { formatarBRL, numeroDoPedido } from "./pedido.ts";
import {
  assuntoDoAvisoDePagamentoAtrasado as assuntoDoWebhook,
  formatarBRL as formatarBRLDoWebhook,
  htmlDoAvisoDePagamentoAtrasado as htmlDoWebhook,
  numeroDoPedido as numeroDoWebhook,
} from "../webhook-mercadopago/index.ts";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const VAGA = "ORDTST01VAGADOPEDIDO000000000";

async function emSilencio<T>(f: () => Promise<T>): Promise<T> {
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    return await f();
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
}

function bancoDoRpc(resposta: () => Promise<unknown> | unknown) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  return {
    chamadas,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      return await resposta();
    },
  };
}

// ── confirmarPagamentoProvado ─────────────────────────────────────────────

Deno.test("confirmarPagamentoProvado: chama confirmar_pagamento UMA vez com os argumentos EXATOS e devolve o desfecho da RPC", async () => {
  for (const desfecho of ["pago", "pago_apos_expirar", "ja_pago", "divergente", "inexistente", "ignorado"]) {
    const db = bancoDoRpc(() => ({ data: desfecho, error: null }));
    const r = await confirmarPagamentoProvado({ supabase: db as never, pedidoId: PEDIDO, vaga: VAGA });
    assertEquals(r, { ok: true, resultado: desfecho });
    assertEquals(db.chamadas, [{
      nome: "confirmar_pagamento",
      args: { p_order_id: PEDIDO, p_payment_id: VAGA, p_status: "pago" },
    }]);
  }
});

for (
  const caso of [
    { nome: "{ error }", resposta: () => ({ data: null, error: { code: "57014", message: "statement timeout" } }) },
    { nome: "exceção", resposta: () => Promise.reject(new Error("rede caiu")) },
    { nome: "data ilegível (null)", resposta: () => ({ data: null, error: null }) },
  ]
) {
  Deno.test(`confirmarPagamentoProvado: ${caso.nome} -> { ok: false }, sem lançar`, async () => {
    const db = bancoDoRpc(caso.resposta);
    const r = await emSilencio(() => confirmarPagamentoProvado({ supabase: db as never, pedidoId: PEDIDO, vaga: VAGA }));
    assertEquals(r, { ok: false });
    assertEquals(db.chamadas.length, 1);
  });
}

// ── aplicarEfeitosDoPagamentoConfirmado ───────────────────────────────────

function bancoDoPedido(opts: { falha?: boolean; linha?: Record<string, unknown> } = {}) {
  const leituras: string[] = [];
  return {
    leituras,
    from(tabela: string) {
      return {
        select(colunas: string) {
          leituras.push(`${tabela}:${colunas}`);
          return {
            eq: () => ({
              maybeSingle: async () => {
                if (opts.falha) throw new Error("banco caiu");
                return { data: opts.linha ?? { id: PEDIDO, customer_name: "Fulana", total: 100 }, error: null };
              },
            }),
          };
        },
      };
    },
    rpc: () => {
      throw new Error("os efeitos nunca chamam RPC direto quando injetados");
    },
  };
}

function coletores() {
  const pushes: unknown[] = [];
  const comprovantes: unknown[] = [];
  const atrasados: unknown[] = [];
  return {
    pushes,
    comprovantes,
    atrasados,
    deps: {
      enviarPush: async (a: { aviso: unknown }) => {
        pushes.push(a.aviso);
      },
      enviarComprovante: async (a: { orderId: string }) => {
        comprovantes.push(a.orderId);
      },
      enviarAvisoAtrasado: async (a: { orderId: string }) => {
        atrasados.push(a.orderId);
      },
    },
  };
}

Deno.test("efeitos 'pago': push 'Pedido pago' com número e valor + comprovante ao cliente, UMA vez cada; nenhum aviso atrasado", async () => {
  const db = bancoDoPedido();
  const c = coletores();
  await aplicarEfeitosDoPagamentoConfirmado({ supabase: db as never, orderId: PEDIDO, resultado: "pago", ...c.deps });
  assertEquals(c.pushes, [{ title: "Pedido pago", body: "#4F5A6B · R$ 100,00", url: "/admin-orders" }]);
  assertEquals(c.comprovantes, [PEDIDO]);
  assertEquals(c.atrasados, []);
  assertEquals(db.leituras, ["marketplace_orders:id, customer_name, total, total_amount"]);
});

Deno.test("efeitos 'pago_apos_expirar': push 'Pagamento fora do fluxo' + aviso ATRASADO; NUNCA o comprovante padrão", async () => {
  const db = bancoDoPedido();
  const c = coletores();
  await aplicarEfeitosDoPagamentoConfirmado({
    supabase: db as never,
    orderId: PEDIDO,
    resultado: "pago_apos_expirar",
    ...c.deps,
  });
  assertEquals(c.pushes, [{
    title: "Pagamento fora do fluxo",
    body: "#4F5A6B · R$ 100,00 · estoque já devolvido",
    url: "/admin-orders",
  }]);
  assertEquals(c.comprovantes, []);
  assertEquals(c.atrasados, [PEDIDO]);
});

for (const resultado of ["ja_pago", "divergente", "inexistente", "ignorado", "estornado", "recusado", null, undefined]) {
  Deno.test(`efeitos '${String(resultado)}': NENHUM efeito — nem push, nem e-mail, nem a leitura do pedido`, async () => {
    const db = bancoDoPedido();
    const c = coletores();
    await aplicarEfeitosDoPagamentoConfirmado({ supabase: db as never, orderId: PEDIDO, resultado, ...c.deps });
    assertEquals(c.pushes, []);
    assertEquals(c.comprovantes, []);
    assertEquals(c.atrasados, []);
    assertEquals(db.leituras, []);
  });
}

Deno.test("efeitos: o push LANÇA -> o comprovante sai assim mesmo, e nada sobe para quem chama", async () => {
  const db = bancoDoPedido();
  const c = coletores();
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({
      supabase: db as never,
      orderId: PEDIDO,
      resultado: "pago",
      ...c.deps,
      enviarPush: () => Promise.reject(new Error("push service fora")),
    })
  );
  assertEquals(c.comprovantes, [PEDIDO]);
});

Deno.test("efeitos: o comprovante LANÇA -> nada sobe para quem chama", async () => {
  const db = bancoDoPedido();
  const c = coletores();
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({
      supabase: db as never,
      orderId: PEDIDO,
      resultado: "pago",
      ...c.deps,
      enviarComprovante: () => Promise.reject(new Error("smtp fora")),
    })
  );
  assertEquals(c.pushes.length, 1);
});

Deno.test("efeitos: a leitura do valor FALHA -> o push sai assim mesmo (sem o valor, como o webhook)", async () => {
  const db = bancoDoPedido({ falha: true });
  const c = coletores();
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({ supabase: db as never, orderId: PEDIDO, resultado: "pago", ...c.deps })
  );
  assertEquals(c.pushes, [{ title: "Pedido pago", body: "#4F5A6B · R$ 0,00", url: "/admin-orders" }]);
  assertEquals(c.comprovantes, [PEDIDO]);
});

Deno.test("efeitos: valor cai em total_amount quando total não vem (mesma ordem do webhook)", async () => {
  const db = bancoDoPedido({ linha: { id: PEDIDO, total_amount: 1234.5 } });
  const c = coletores();
  await aplicarEfeitosDoPagamentoConfirmado({ supabase: db as never, orderId: PEDIDO, resultado: "pago", ...c.deps });
  assertEquals(c.pushes, [{ title: "Pedido pago", body: "#4F5A6B · R$ 1.234,50", url: "/admin-orders" }]);
});

// ── Paridade com o webhook ────────────────────────────────────────────────

Deno.test("paridade: numeroDoPedido e formatarBRL de _shared/pedido.ts dão o MESMO texto que os do webhook", () => {
  for (const id of [PEDIDO, "00000000-0000-0000-0000-00000000abcd"]) {
    assertEquals(numeroDoPedido(id), numeroDoWebhook(id));
  }
  for (const valor of [0, 100, 1234.5, 99.999, "50.00", null, undefined, Number.NaN]) {
    assertEquals(formatarBRL(valor), formatarBRLDoWebhook(valor), String(valor));
  }
});

Deno.test("paridade: o e-mail de pagamento atrasado (assunto e HTML) é BYTE A BYTE o do webhook — com e sem nome de loja, com HTML no nome", () => {
  for (const nomeDaLoja of ["", "Loja da Ana", "  <b>Loja & Cia</b>  "]) {
    assertEquals(htmlDoAvisoDePagamentoAtrasado({ orderId: PEDIDO, nomeDaLoja }), htmlDoWebhook({ orderId: PEDIDO, nomeDaLoja }));
    assertEquals(assuntoDoAvisoDePagamentoAtrasado(PEDIDO, nomeDaLoja), assuntoDoWebhook(PEDIDO, nomeDaLoja));
  }
});

Deno.test("avisoAoLojista: só 'pago' e 'pago_apos_expirar' têm aviso", () => {
  assertEquals(avisoAoLojista(PEDIDO, "ja_pago", 10), null);
  assertEquals(avisoAoLojista(PEDIDO, "divergente", 10), null);
});
