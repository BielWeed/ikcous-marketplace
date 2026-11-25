import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BADGE_NEUTRO } from "@/config/fichaDaLojaContract";

/**
 * src/sw/sw.ts — o ícone e o badge do aviso (push) quando a ficha da loja
 * guardada existe, é DESTA loja, mas está incompleta: sem `icon_192`, sem
 * `badge_96`, ou com `localUrls` vazio. Os testes de identidade do aviso só
 * usavam ficha completa ou nenhuma ficha; o meio-termo (ficha antiga, de antes
 * de a loja ter badge) dependia de duas reservas que ninguém provava:
 *
 *  - sem `icon_192`: o ícone cai no neutro do build (`/icons/heart-96x96.png`),
 *    nunca fica vazio — notificação sem ícone sai com o do navegador;
 *  - sem `badge_96`: o badge cai no branco/transparente (`BADGE_NEUTRO`). O
 *    Android desenha o badge como silhueta: colocar ali o ícone colorido do
 *    app (a outra reserva) viraria um quadrado sólido na barra de status.
 *
 * `environment: "node"` e import dentro do teste: mesma razão de
 * `sw-identidade-notificacao.test.ts`.
 */

const HOST_LOJA = "loja.example";
const ICONE_NEUTRO = "/icons/heart-96x96.png";

describe("aviso com ficha da loja incompleta", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function avisarComFicha(
    localUrls: Record<string, string>,
    hostDaFicha = HOST_LOJA,
  ) {
    const listeners = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sem rede")));
    vi.stubGlobal("self", {
      location: { origin: `https://${HOST_LOJA}`, hostname: HOST_LOJA },
      __WB_MANIFEST: [],
      registration: { showNotification },
      addEventListener: (tipo: string, ouvinte: (evento: unknown) => void) =>
        listeners.set(tipo, ouvinte),
    });
    const ficha = {
      host: hostDaFicha,
      identidade: { localUrls },
    };
    vi.stubGlobal("caches", {
      match: vi.fn(),
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue({ json: async () => ficha }),
        put: vi.fn().mockResolvedValue(undefined),
      }),
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
    push?.({
      data: { json: () => ({ title: "Aviso", body: "Mensagem" }) },
      waitUntil,
    });
    await waitUntil.mock.calls[0][0];
    expect(showNotification).toHaveBeenCalledTimes(1);
    return showNotification.mock.calls[0][1] as {
      icon: string;
      badge: string;
    };
  }

  it("sem icon_192: o ícone é o neutro do build e o badge é o da ficha", async () => {
    const opcoes = await avisarComFicha({
      badge_96: "/identity/aurora/badge-96.png",
    });

    expect(opcoes.icon).toBe(ICONE_NEUTRO);
    expect(opcoes.badge).toBe("/identity/aurora/badge-96.png");
  });

  it("sem badge_96: o ícone é o da ficha e o badge é o branco/transparente, nunca o ícone colorido", async () => {
    const opcoes = await avisarComFicha({
      icon_192: "/identity/aurora/icon-192.png",
    });

    expect(opcoes.icon).toBe("/identity/aurora/icon-192.png");
    expect(opcoes.badge).toBe(BADGE_NEUTRO);
    expect(opcoes.badge).not.toBe(opcoes.icon);
    expect(opcoes.badge).not.toBe(ICONE_NEUTRO);
  });

  it("localUrls vazio: os dois neutros", async () => {
    const opcoes = await avisarComFicha({});

    expect(opcoes.icon).toBe(ICONE_NEUTRO);
    expect(opcoes.badge).toBe(BADGE_NEUTRO);
  });

  it("ficha guardada de OUTRA loja (host diferente) nunca é usada: saem os neutros", async () => {
    const opcoes = await avisarComFicha(
      {
        icon_192: "/identity/outra/icon-192.png",
        badge_96: "/identity/outra/badge-96.png",
      },
      "outra-loja.example",
    );

    expect(opcoes.icon).toBe(ICONE_NEUTRO);
    expect(opcoes.badge).toBe(BADGE_NEUTRO);
  });
});
