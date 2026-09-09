import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

describe("push usa a imagem da própria entrega", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function importar(name = "Aurora") {
    vi.stubGlobal(
      "__STORE_IDENTITY__",
      criarBuildIdentity(name, name.toLowerCase()),
    );
    const listeners = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("self", {
      location: { origin: "https://loja.example" },
      __WB_MANIFEST: [],
      registration: { showNotification },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
    });
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
    return { push: push!, showNotification };
  }

  it.each(["Aurora", "Horizonte"])(
    "icon e badge de %s vêm do papel local icon_192",
    async (name) => {
      const { push, showNotification } = await importar(name);
      const waitUntil = vi.fn();
      push({
        data: {
          json: () => ({
            title: "Aviso",
            body: "Mensagem",
            url: "/pedido",
            data: { pedido: "fixture" },
            icon: "https://externo.example/errado.png",
          }),
        },
        waitUntil,
      });
      expect(showNotification).toHaveBeenCalledExactlyOnceWith("Aviso", {
        body: "Mensagem",
        icon: `/identity/${name.toLowerCase()}/icon-192.png`,
        badge: `/identity/${name.toLowerCase()}/icon-192.png`,
        data: { url: "/pedido", pedido: "fixture" },
      });
      expect(waitUntil).toHaveBeenCalledExactlyOnceWith(
        showNotification.mock.results[0].value,
      );
    },
  );

  it("payload vazio conserva título/corpo/URL de reserva; evento sem data não notifica", async () => {
    const { push, showNotification } = await importar();
    const waitUntil = vi.fn();
    push({ waitUntil });
    expect(showNotification).not.toHaveBeenCalled();
    push({ data: { json: () => ({}) }, waitUntil });
    expect(showNotification).toHaveBeenCalledExactlyOnceWith("Novidade!", {
      body: "",
      icon: "/identity/aurora/icon-192.png",
      badge: "/identity/aurora/icon-192.png",
      data: { url: "/" },
    });
  });
});
