import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

// Lote 204 (26/10/2026): o aviso de status do pedido ("Pedido confirmado", "Saiu para entrega", "Entregue")
// chegava como uma notificacao NOVA a cada mudanca: tres avisos do mesmo pedido empilhados na bandeja. Com
// `tag: pedido-<id>` o aviso novo SUBSTITUI o anterior do mesmo pedido, e `renotify: true` faz o aparelho
// avisar de novo (sem ele a troca seria silenciosa e a cliente nao saberia que o status mudou). Aviso sem
// pedido (campanha, teste do aparelho) segue sem `tag`: cada um continua sendo uma notificacao propria.
describe("aviso de status do pedido se agrupa pelo pedido", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function importar() {
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Aurora", "aurora"));
    const listeners = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("self", {
      location: { origin: "https://loja.example", hostname: "loja.example" },
      __WB_MANIFEST: [],
      registration: { showNotification },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
    });
    // Sem a API de cache: o SW vai direto ao icone neutro (o caminho de icone e' de outro teste).
    vi.stubGlobal("caches", {});
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    await import("@/sw/sw");
    const push = listeners.get("push");
    expect(push).toBeTypeOf("function");
    return async (payload: unknown) => {
      const waitUntil = vi.fn();
      push!({ data: { json: () => payload }, waitUntil });
      await waitUntil.mock.calls[0][0];
      return showNotification.mock.calls.at(-1);
    };
  }

  const NEUTRO = {
    icon: "/icons/heart-96x96.png",
    badge: "/icons/badge-96x96.png",
  };

  it("aviso de status com o pedido no payload ganha tag pedido-<id> e renotify, e o resto fica igual", async () => {
    const avisar = await importar();
    const chamada = await avisar({
      title: "Saiu para entrega",
      body: "Seu pedido esta a caminho",
      url: "/order-details?id=abc-123",
      data: { orderId: "abc-123", type: "order_status" },
    });
    expect(chamada).toEqual([
      "Saiu para entrega",
      {
        body: "Seu pedido esta a caminho",
        ...NEUTRO,
        tag: "pedido-abc-123",
        renotify: true,
        data: {
          url: "/order-details?id=abc-123",
          orderId: "abc-123",
          type: "order_status",
        },
      },
    ]);
  });

  it("dois avisos do MESMO pedido levam a MESMA tag (o segundo substitui o primeiro); outro pedido, outra tag", async () => {
    const avisar = await importar();
    const a1 = await avisar({
      title: "Confirmado",
      data: { orderId: "p1", type: "order_status" },
    });
    const a2 = await avisar({
      title: "Entregue",
      data: { orderId: "p1", type: "order_status" },
    });
    const b = await avisar({
      title: "Confirmado",
      data: { orderId: "p2", type: "order_status" },
    });
    expect(a1?.[1].tag).toBe("pedido-p1");
    expect(a2?.[1].tag).toBe("pedido-p1");
    expect(b?.[1].tag).toBe("pedido-p2");
  });

  it.each([
    ["campanha sem data", { title: "Promo", body: "20% off", url: "/promo" }],
    [
      "data nulo (o que a send-push grava sem data)",
      { title: "Promo", data: null },
    ],
    ["data sem orderId", { title: "Teste", data: { pedido: "x" } }],
    ["orderId vazio", { title: "Aviso", data: { orderId: "" } }],
    ["orderId numero", { title: "Aviso", data: { orderId: 42 } }],
    ["orderId objeto", { title: "Aviso", data: { orderId: { id: "x" } } }],
  ])(
    "%s: nenhuma tag nem renotify (cada aviso continua o seu)",
    async (_n, payload) => {
      const avisar = await importar();
      const chamada = await avisar(payload);
      expect(chamada?.[1]).not.toHaveProperty("tag");
      expect(chamada?.[1]).not.toHaveProperty("renotify");
    },
  );
});
