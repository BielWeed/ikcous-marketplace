import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

/**
 * Mata o mutante "reverter `ICONE_ASSADO` para o ícone assado da principal
 * (`__STORE_IDENTITY__...icon_192`)" — ADENDO B.5 (11/09/2026): o revisor
 * mediu que 67 testes ficam verdes com essa reversão, porque nenhum deles
 * afirma as duas coisas ao MESMO TEMPO: (a) o cache de identidade está
 * VAZIO (nenhuma ficha por host ainda chegou) e (b) o ícone final da
 * notificação NÃO é o `/identity/.../icon-192.png` de nenhuma loja em
 * especial — com um build único para toda a frota (etapa 2), esse "assado"
 * seria sempre o de UMA loja (hoje, a principal) aparecendo para todas as
 * outras antes da ficha delas chegar ao cache.
 *
 * POR QUE `environment: "node"` / `self` FALSO / IMPORTAR DENTRO DO TESTE:
 * mesmas razões de `tests/front/sw-fetch.test.ts` e dos dois arquivos irmãos
 * (`sw-identidade-notificacao.test.ts`, `sw-identidade-fora-do-document.test.ts`).
 */

type Listener = (event: unknown) => void;

const HOST_LOJA = "loja-sem-ficha-em-cache.example";
// Ícone RECONHECÍVEL da principal — se o mutante voltar a ler
// `__STORE_IDENTITY__...icon_192`, é exatamente este valor que aparece.
const ICONE_DA_PRINCIPAL = "/identity/principal/icon-192.png";

describe("sw.ts — o ícone de último recurso nunca é o assado de UMA loja", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cache de identidade VAZIO -> icon é o NEUTRO do build (/icons/heart-96x96.png), nunca /identity/.../icon-192.png da principal", async () => {
    vi.stubGlobal(
      "__STORE_IDENTITY__",
      criarBuildIdentity("Principal", "principal"),
    );
    const listeners = new Map<string, Listener>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("self", {
      location: { origin: `https://${HOST_LOJA}`, hostname: HOST_LOJA },
      __WB_MANIFEST: [],
      registration: { showNotification },
      addEventListener: (type: string, listener: Listener) =>
        listeners.set(type, listener),
    });
    // Cache de identidade VAZIO: `open` resolve um cache cujo `match` nunca
    // acha nada — `caches.match` de nível topo precisa ser uma FUNÇÃO (é o
    // que decide, em `sw.ts`, se o `push` tenta ler a ficha em cache ou vai
    // direto para o ícone de último recurso pelo atalho síncrono).
    vi.stubGlobal("caches", {
      open: vi
        .fn()
        .mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) }),
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

    const waitUntil = vi.fn();
    push!({
      data: { json: () => ({ title: "Aviso", body: "Mensagem" }) },
      waitUntil,
    });
    // Leitura assíncrona da ficha (`resolverIconeDaLoja().then(notificar)`)
    // — `showNotification` só é chamada depois que a promessa passada a
    // `waitUntil` resolve.
    await waitUntil.mock.calls[0][0];

    expect(showNotification).toHaveBeenCalledExactlyOnceWith(
      "Aviso",
      expect.objectContaining({
        icon: "/icons/heart-96x96.png",
        badge: "/icons/heart-96x96.png",
      }),
    );
    const [, options] = showNotification.mock.calls[0] as [
      string,
      { icon: string },
    ];
    // As duas asserções que o mutante quebra: valor exato E ausência do
    // prefixo `/identity/` (o mutante devolveria `/identity/principal/icon-192.png`,
    // que passaria numa asserção só por `.not.toBe`, mas não por `.not.toContain`
    // se algum dia o defeito virar outro path por loja).
    expect(options.icon).not.toContain("/identity/");
    expect(options.icon).not.toBe(ICONE_DA_PRINCIPAL);
  });
});
