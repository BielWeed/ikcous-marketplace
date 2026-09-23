import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TELAS_DE_ENTRADA } from "../../src/config/rotas";

const appTsx = path.resolve(import.meta.dirname, "../../src/App.tsx");

describe("telas de entrada (declaração única)", () => {
  it("são 40 nomes únicos, com home e 21 administrativas (C3.3: +admin-pdv; 20/09: +admin-about-store; 23/09: +admin-shipping-national)", () => {
    expect(TELAS_DE_ENTRADA).toHaveLength(40);
    expect(new Set(TELAS_DE_ENTRADA).size).toBe(40);
    expect(TELAS_DE_ENTRADA[0]).toBe("home");
    expect(TELAS_DE_ENTRADA).toContain("admin-pdv");
    expect(TELAS_DE_ENTRADA).toContain("admin-shipping-national");
    expect(TELAS_DE_ENTRADA.filter((t) => t.startsWith("admin-"))).toHaveLength(
      21,
    );
    expect(TELAS_DE_ENTRADA).toContain("admin"); // nominal sem hífen, sem alias
  });

  it("App.tsx lê a lista daqui, não de um literal próprio", () => {
    const fonte = fs.readFileSync(appTsx, "utf8");
    expect(fonte).toContain("TELAS_DE_ENTRADA");
    expect(fonte).not.toMatch(/const validViews: View\[\] = \[/);
  });
});
