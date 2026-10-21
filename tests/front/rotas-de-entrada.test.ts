import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TELAS_DE_ENTRADA } from "../../src/config/rotas";

const appTsx = path.resolve(import.meta.dirname, "../../src/App.tsx");

describe("telas de entrada (declaração única)", () => {
  it("são 48 nomes únicos, com home e 26 administrativas (C3.3: +admin-pdv; 20/09: +admin-about-store; 23/09: +admin-shipping-national; 26/09: +admin-crm, +admin-financeiro, +admin-devolucoes; 14/10: +terms, +privacy, +returns-policy, as três páginas de política da loja; 21/10: +admin-free-shipping-card, Card de frete grátis)", () => {
    expect(TELAS_DE_ENTRADA).toHaveLength(48);
    expect(new Set(TELAS_DE_ENTRADA).size).toBe(48);
    expect(TELAS_DE_ENTRADA[0]).toBe("home");
    expect(TELAS_DE_ENTRADA).toContain("admin-pdv");
    expect(TELAS_DE_ENTRADA).toContain("admin-shipping-national");
    expect(TELAS_DE_ENTRADA).toContain("admin-free-shipping-card");
    expect(TELAS_DE_ENTRADA).toContain("admin-crm");
    expect(TELAS_DE_ENTRADA).toContain("admin-financeiro");
    expect(TELAS_DE_ENTRADA).toContain("admin-devolucoes");
    expect(TELAS_DE_ENTRADA).toContain("terms");
    expect(TELAS_DE_ENTRADA).toContain("privacy");
    expect(TELAS_DE_ENTRADA).toContain("returns-policy");
    expect(TELAS_DE_ENTRADA.filter((t) => t.startsWith("admin-"))).toHaveLength(
      26,
    );
    expect(TELAS_DE_ENTRADA).toContain("admin"); // nominal sem hífen, sem alias
  });

  it("App.tsx lê a lista daqui, não de um literal próprio", () => {
    const fonte = fs.readFileSync(appTsx, "utf8");
    expect(fonte).toContain("TELAS_DE_ENTRADA");
    expect(fonte).not.toMatch(/const validViews: View\[\] = \[/);
  });
});
