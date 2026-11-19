import { spawnSync } from "node:child_process";
import { matcher } from "@/hospedagem/porteiro";
import { describe, expect, it, vi } from "vitest";
import vercel from "../../vercel.json";

describe("avisos de terceiros", () => {
  it("acompanham as dependências de produção instaladas", () => {
    const resultado = spawnSync(
      process.execPath,
      ["scripts/gerar-avisos-de-terceiros.mjs", "--check"],
      { cwd: new URL("../../", import.meta.url), encoding: "utf8" },
    );

    expect(resultado.error).toBeUndefined();
    expect(resultado.status, resultado.stderr).toBe(0);
  });

  it("ao abrir o endereço, o service worker deixa a rede responder", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    vi.stubGlobal("self", {
      location: { origin: "https://loja.exemplo.com" },
      __WB_MANIFEST: [],
      addEventListener: (nome: string, listener: (event: unknown) => void) =>
        listeners.set(nome, listener),
    });
    // Só interessa se o SW assume a resposta, não o que retorna do cache.
    vi.stubGlobal("caches", { match: () => new Promise(() => {}) });
    try {
      await import("@/sw/sw");
      const respondWith = vi.fn();
      listeners.get("fetch")?.({
        request: {
          method: "GET",
          mode: "navigate",
          url: "https://loja.exemplo.com/THIRD_PARTY_NOTICES.txt",
        },
        respondWith,
      });
      expect(listeners.has("fetch")).toBe(true);
      expect(respondWith).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("não passam pelo fallback de páginas da Vercel", () => {
    const padroes = [
      ...matcher,
      ...vercel.rewrites.map(({ source }) => source),
    ];
    for (const padrao of padroes) {
      // eslint-disable-next-line security/detect-non-literal-regexp -- padrões versionados da Vercel
      expect(new RegExp(`^${padrao}$`).test("/THIRD_PARTY_NOTICES.txt")).toBe(
        false,
      );
    }
  });
});
