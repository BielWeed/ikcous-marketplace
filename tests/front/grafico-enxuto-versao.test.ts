import { createRequire } from "node:module";
import path from "node:path";
import { build } from "vite";
import { describe, expect, it, vi } from "vitest";
import { graficoEnxuto } from "../../scripts/graficoEnxuto";

const versoes = vi.hoisted(() => new Map<string, string>());
vi.mock("node:module", async (original) => {
  const modulo = await original<typeof import("node:module")>();
  return {
    ...modulo,
    createRequire: (url: string | URL) => {
      const real = modulo.createRequire(url);
      return Object.assign((id: string) => {
        const valor = real(id);
        return versoes.has(id) ? { ...valor, version: versoes.get(id) } : valor;
      }, real);
    },
  };
});

const require = createRequire(import.meta.url);
const manifestoD3 = path.resolve(
  path.dirname(require.resolve("d3-scale")),
  "../package.json",
);

describe("gráfico enxuto — versões validadas", () => {
  it.each([
    ["recharts/package.json", "Recharts", "2.15.4"],
    [manifestoD3, "d3-scale", "4.0.2"],
  ])(
    "derruba o build se %s mudar sem revisão",
    async (manifesto, pacote, validada) => {
      versoes.set(manifesto, "99.0.0");
      try {
        await expect(
          build({
            configFile: false,
            envFile: false,
            logLevel: "silent",
            plugins: [
              graficoEnxuto(),
              {
                name: "entrada-de-prova",
                resolveId: (id) => (id === "virtual:prova" ? "\0prova" : null),
                load: (id) =>
                  id === "\0prova" ? "export const prova = true;" : null,
              },
            ],
            build: {
              write: false,
              lib: { entry: "virtual:prova", formats: ["es"] },
              rollupOptions: { input: "virtual:prova" },
            },
          }),
        ).rejects.toThrow(
          `Gráfico enxuto: revisar substituições e prova SVG para ${pacote} 99.0.0 (validado: ${validada}).`,
        );
      } finally {
        versoes.clear();
      }
    },
  );
});
