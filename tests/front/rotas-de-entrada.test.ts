import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TELAS_DE_ENTRADA } from "../../src/config/rotas";

const appTsx = path.resolve(import.meta.dirname, "../../src/App.tsx");

describe("telas de entrada (declaração única)", () => {
  it("são 36 nomes únicos, com home e 18 administrativas", () => {
    expect(TELAS_DE_ENTRADA).toHaveLength(36);
    expect(new Set(TELAS_DE_ENTRADA).size).toBe(36);
    expect(TELAS_DE_ENTRADA[0]).toBe("home");
    expect(TELAS_DE_ENTRADA.filter((t) => t.startsWith("admin-"))).toHaveLength(
      18,
    );
    expect(TELAS_DE_ENTRADA).toContain("admin"); // nominal sem hífen, sem alias
  });

  it("App.tsx lê a lista daqui, não de um literal próprio", () => {
    const fonte = fs.readFileSync(appTsx, "utf8");
    expect(fonte).toContain("TELAS_DE_ENTRADA");
    expect(fonte).not.toMatch(/const validViews: View\[\] = \[/);
  });
});
