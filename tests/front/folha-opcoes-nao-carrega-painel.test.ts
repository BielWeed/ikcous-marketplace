import { expect, it, vi } from "vitest";

vi.mock("vite", async (original) => ({
  ...(await original<typeof import("vite")>()),
  loadEnv: () => ({}),
}));
vi.mock("../../scripts/identityBuildConfig", () => ({
  createIdentityBuildConfig: async () => ({
    outDir: "dist-test",
    plugin: { name: "identidade-ficticia-sem-rede" },
  }),
}));

// Contrato do roteamento que controlamos. A prova do peso é o build completo:
// um bundle virtual de poucas linhas pode fundir a própria entrada dinâmica
// pelo minChunkSize e deixar de representar a fronteira do painel real.
it.each(["/repo", "C:\\repo"])(
  "o parser usado pela folha não compartilha chunk com o painel (%s)",
  async (raiz) => {
    const { default: configuracao } = await import("../../vite.config");
    if (typeof configuracao !== "function")
      throw new Error("Esperava fábrica Vite");
    const config = await configuracao({ command: "serve", mode: "test" });
    const outputConfig = config.build?.rollupOptions?.output;
    const output = Array.isArray(outputConfig) ? outputConfig[0] : outputConfig;
    const manualChunks = output?.manualChunks;
    if (typeof manualChunks !== "function")
      throw new Error("Esperava roteamento de chunks");
    const parser = manualChunks(
      `${raiz}/src/utils/variante-composta.ts`,
      {} as never,
    );
    const painel = manualChunks(
      `${raiz}/src/components/admin/primitivos/FolhaDoPainel.tsx`,
      {} as never,
    );
    expect(parser).toBeDefined();
    expect(painel).toBeDefined();
    expect(parser).not.toBe(painel);
  },
);
