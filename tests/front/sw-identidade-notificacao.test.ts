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

  // ETAPA 3 (ADENDO A.8/B.5, 11/09/2026): `sw.ts` deixou de ler o ícone do
  // build ASSADO (`__STORE_IDENTITY__`) para a notificação — ele lê a ficha
  // guardada no cache PRÓPRIO (`ikcous-identidade`, instalada pelo
  // `install`), e só cai no ícone NEUTRO (`/icons/heart-96x96.png`) quando
  // esse cache está vazio ou o host não bate (ver
  // `sw-icone-neutro-nunca-o-da-principal.test.ts`). "icon e badge vêm do
  // papel local icon_192" continua valendo, mas a origem agora é a FICHA em
  // cache (`identidade.localUrls.icon_192`), não mais o global do build —
  // por isso o dublê de `caches` abaixo devolve uma ficha com o host da
  // própria loja em vez do `{}` (cache ausente) de antes.
  const HOST_LOJA = "loja.example";

  function fichaComIconePorLoja(name: string, slug: string) {
    const identidade = criarBuildIdentity(name, slug);
    return {
      json: vi.fn().mockResolvedValue({
        schemaVersion: 2,
        host: HOST_LOJA,
        identidade: {
          identity: identidade.identity,
          localUrls: identidade.localUrls,
          publicUrl: `https://${HOST_LOJA}`,
          identityRevision: "b".repeat(64),
        },
        conexao: {
          supabaseUrl: "https://ficha.supabase.co",
          publishableKey: "sb_publishable_ficha",
        },
      }),
    };
  }

  async function importar(name = "Aurora") {
    const slug = name.toLowerCase();
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity(name, slug));
    const listeners = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("self", {
      location: { origin: `https://${HOST_LOJA}`, hostname: HOST_LOJA },
      __WB_MANIFEST: [],
      registration: { showNotification },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
    });
    const respostaFicha = fichaComIconePorLoja(name, slug);
    vi.stubGlobal("caches", {
      open: vi
        .fn()
        .mockResolvedValue({ match: vi.fn().mockResolvedValue(respostaFicha) }),
      match: vi.fn(),
    });
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
      // O ícone agora vem da ficha em cache (leitura assíncrona,
      // `resolverIconeDaLoja().then(notificar)`) — `showNotification` só é
      // chamada depois que a promessa passada a `waitUntil` resolve.
      await waitUntil.mock.calls[0][0];
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
    // Mesma leitura assíncrona da ficha (ver comentário acima); só o
    // SEGUNDO `push` chega a chamar `waitUntil`.
    await waitUntil.mock.calls[0][0];
    expect(showNotification).toHaveBeenCalledExactlyOnceWith("Novidade!", {
      body: "",
      icon: "/identity/aurora/icon-192.png",
      badge: "/identity/aurora/icon-192.png",
      data: { url: "/" },
    });
  });
});
