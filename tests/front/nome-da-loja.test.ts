import { branding } from "@/config/branding";
import { describe, expect, it } from "vitest";

describe("critério 6 — nomeDaLoja", () => {
  it("preserva o nome configurado e remove espaços externos", async () => {
    const { nomeDaLoja } = await import("@/lib/nome-da-loja");
    expect(nomeDaLoja({ storeName: "  Savy  " })).toBe("Savy");
  });

  it.each([
    { storeName: "" },
    { storeName: "   " },
    { storeName: null },
    {},
    null,
    undefined,
  ])("usa a marca do build quando não existe nome: %j", async (config) => {
    const { nomeDaLoja } = await import("@/lib/nome-da-loja");
    expect(nomeDaLoja(config)).toBe(branding.appName);
  });
});
