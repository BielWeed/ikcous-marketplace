import path from "node:path";
import { loadConfigFromFile } from "vite";
import { describe, expect, it, vi } from "vitest";

describe("painel-ui — fusão fechada de financeiro e CRM", () => {
  it("funde financeiro, CRM e seu auxiliar de WhatsApp, sem absorver outros vizinhos do painel", async () => {
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "fixture");
    vi.stubEnv("IKCOUS_CODE_SHA", "5f2999544cbcd26308994dd67925df51fd6b4785");
    const carregado = await loadConfigFromFile({
      command: "build",
      mode: "production",
    });
    const output = carregado!.config.build!.rollupOptions!.output!;
    if (Array.isArray(output) || typeof output.manualChunks !== "function")
      throw new Error("manualChunks ausente");
    const classificar = (arquivo: string) => {
      // O callback atual só usa id; o contexto do Rollup não é consultado.
      const callback = output.manualChunks as (id: string) => unknown;
      return callback(path.resolve(arquivo));
    };
    expect(classificar("src/lib/financeiro.ts")).toBe("painel-ui");
    expect(classificar("src/lib/crm.ts")).toBe("painel-ui");
    expect(classificar("src/lib/whatsapp-do-cliente.ts")).toBe("painel-ui");
    for (const arquivo of [
      "src/lib/recebimentos-por-marcar.ts",
      "src/hooks/usePainelInicio.ts",
      "src/hooks/useDiaDeSaoPaulo.ts",
      "src/components/admin/LocalBufferedInput.tsx",
      "src/components/admin/PaginacaoAdmin.tsx",
      "src/components/admin/DebouncedSearchInput.tsx",
      "src/components/admin/primitivos/MetricasDoPainel.tsx",
      "src/views/admin/AdminFinanceiroView.tsx",
    ]) {
      expect(classificar(arquivo), arquivo).toBeUndefined();
    }
    expect(classificar("src/lib/utils.ts")).toBe("vendor-inicio");
    expect(
      carregado!.config
        .plugins!.flat()
        .some(
          (plugin) =>
            plugin &&
            typeof plugin === "object" &&
            "name" in plugin &&
            plugin.name === "grafico-enxuto",
        ),
    ).toBe(true);
  });
});
