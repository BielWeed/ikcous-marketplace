// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSentinel } from "@/pwa-sentinel";

// Safari antigo (iOS <= 15.3) não tem BroadcastChannel. O sentinela não pode
// quebrar o boot por isso: o pulso continua chegando pela mensagem direta do
// service worker.
describe("initSentinel sem BroadcastChannel", () => {
  const original = globalThis.BroadcastChannel;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        getRegistrations: vi.fn().mockResolvedValue([]),
        controller: null,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.BroadcastChannel = original;
  });

  it("não lança e escuta o service worker direto", () => {
    // @ts-expect-error simula o navegador sem a API.
    globalThis.BroadcastChannel = undefined;
    expect(() => initSentinel()).not.toThrow();
    expect(navigator.serviceWorker.addEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });

  it("com BroadcastChannel disponível, segue criando o canal de pulso", () => {
    const criados: string[] = [];
    globalThis.BroadcastChannel = class {
      onmessage: unknown = null;
      constructor(nome: string) {
        criados.push(nome);
      }
      postMessage() {}
      close() {}
    } as unknown as typeof BroadcastChannel;
    initSentinel();
    expect(criados).toContain("sw-heartbeat");
  });
});
