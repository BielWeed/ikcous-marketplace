import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

// Toque no aviso do celular: o Service Worker decide entre FOCAR a janela da
// loja, NAVEGÁ-LA até o pedido do aviso, ou ABRIR uma nova. A decisão pura
// mora em `src/lib/alvo-do-aviso.ts` (tabela em alvo-do-aviso.test.ts); aqui
// se prova que o `notificationclick` do `sw.ts` a obedece.
describe("toque no aviso (notificationclick)", () => {
  const HOST = "loja.example";
  const ORIGEM = `https://${HOST}`;

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function janela(url: string, navegar?: ReturnType<typeof vi.fn>) {
    const j: Record<string, unknown> = {
      url,
      focus: vi.fn().mockResolvedValue(undefined),
    };
    if (navegar) j.navigate = navegar;
    return j as {
      url: string;
      focus: ReturnType<typeof vi.fn>;
      navigate?: ReturnType<typeof vi.fn>;
    };
  }

  async function importar(janelas: ReturnType<typeof janela>[]) {
    const listeners = new Map<string, (event: unknown) => void>();
    const openWindow = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Aurora", "aurora"));
    vi.stubGlobal("self", {
      location: { origin: ORIGEM, hostname: HOST },
      __WB_MANIFEST: [],
      registration: { showNotification: vi.fn() },
      clients: {
        matchAll: vi.fn().mockResolvedValue(janelas),
        openWindow,
      },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
    });
    vi.stubGlobal("caches", { open: vi.fn(), match: vi.fn() });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    await import("@/sw/sw");
    const clique = listeners.get("notificationclick");
    expect(clique).toBeTypeOf("function");
    return { clique: clique!, openWindow };
  }

  async function tocar(
    clique: (event: unknown) => void,
    dados: Record<string, unknown> | undefined,
  ) {
    const waitUntil = vi.fn();
    const close = vi.fn();
    clique({ notification: { close, data: dados }, waitUntil });
    expect(close).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0][0];
  }

  it("aviso de pedido com a cliente em OUTRO pedido: a janela navega até o pedido do aviso e ganha foco", async () => {
    const alvo = "/order-details?id=A";
    const navegarPara = vi.fn();
    const aberta = janela(`${ORIGEM}/order-details?id=B`, navegarPara);
    navegarPara.mockResolvedValue(aberta);
    const { clique, openWindow } = await importar([aberta]);

    await tocar(clique, { url: alvo, orderId: "A", type: "order_status" });

    expect(navegarPara).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${alvo}`);
    expect(aberta.focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("aviso de pedido com a cliente JÁ nesse pedido: só foca, não recarrega", async () => {
    const navegarPara = vi.fn();
    const aberta = janela(`${ORIGEM}/order-details?id=A`, navegarPara);
    const { clique, openWindow } = await importar([aberta]);

    await tocar(clique, { url: "/order-details?id=A" });

    expect(aberta.focus).toHaveBeenCalledOnce();
    expect(navegarPara).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("aviso de pedido sem janela aberta: abre o pedido (não a vitrine)", async () => {
    const { clique, openWindow } = await importar([]);

    await tocar(clique, { url: "/order-details?id=A" });

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(
      `${ORIGEM}/order-details?id=A`,
    );
  });

  it("janela que não aceita navegar (rejeita): abre o pedido em janela nova", async () => {
    const navegarPara = vi
      .fn()
      .mockRejectedValue(new TypeError("sem controle"));
    const aberta = janela(`${ORIGEM}/order-details?id=B`, navegarPara);
    const { clique, openWindow } = await importar([aberta]);

    await tocar(clique, { url: "/order-details?id=A" });

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(
      `${ORIGEM}/order-details?id=A`,
    );
  });

  it("aviso SEM url (campanha comum) continua indo para '/': foca a janela da loja em /?source=pwa", async () => {
    const navegarPara = vi.fn();
    const aberta = janela(`${ORIGEM}/?source=pwa`, navegarPara);
    const { clique, openWindow } = await importar([aberta]);

    await tocar(clique, undefined);

    expect(aberta.focus).toHaveBeenCalledOnce();
    expect(navegarPara).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("aviso SEM url e sem janela: abre '/' (a vitrine, como sempre)", async () => {
    const { clique, openWindow } = await importar([]);

    await tocar(clique, {});

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}/`);
  });
});
