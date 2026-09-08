import { pixConfiguradoNoBuild } from "@/lib/pix-configurado-no-build";
import { describe, expect, it } from "vitest";

// Contrato pedido no item 3 da issue #480: os dois lados usam a mesma regra.
const fontes = import.meta.glob<string>(
  [
    "/src/views/admin/AdminDashboardView.tsx",
    "/src/views/admin/AdminSettingsView.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

describe("PIX configurado no build tem uma regra compartilhada", () => {
  it.each([
    "/src/views/admin/AdminDashboardView.tsx",
    "/src/views/admin/AdminSettingsView.tsx",
  ])("%s importa a função compartilhada", (caminho) => {
    const fonte = new Map(Object.entries(fontes)).get(caminho);
    expect(fonte, `fonte ausente: ${caminho}`).toBeDefined();
    expect(fonte).toMatch(
      /import\s*\{\s*pixConfiguradoNoBuild\s*\}\s*from\s*["']@\/lib\/pix-configurado-no-build["']/,
    );
    expect(fonte).not.toContain("YOUR_MP_PUBLIC_KEY_HERE");
  });
});

describe("pixConfiguradoNoBuild", () => {
  it.each([
    { chavePublica: undefined, esperado: false },
    { chavePublica: "", esperado: false },
    { chavePublica: "YOUR_MP_PUBLIC_KEY_HERE", esperado: false },
    { chavePublica: "APP_USR-abc", esperado: true },
  ])("chave $chavePublica retorna $esperado", ({ chavePublica, esperado }) => {
    expect(pixConfiguradoNoBuild(chavePublica)).toBe(esperado);
  });
});
