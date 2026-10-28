// @vitest-environment jsdom
//
// Banner com link de categoria (ou link `/?category=X`) tem de levar a
// cliente até o Catálogo filtrado. O chip de categoria NÃO rola: ele chama
// `handleCategoryChange`, que não passa por aqui.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rolarAoCatalogo } from "@/lib/rolar-ao-catalogo";

describe("rolarAoCatalogo", () => {
  let rolou: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    rolou = vi.fn();
    document.body.innerHTML = '<h2 id="catalogo">Catálogo</h2>';
    document.getElementById("catalogo")!.scrollIntoView =
      rolou as unknown as typeof Element.prototype.scrollIntoView;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rola suavemente até o Catálogo", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    rolarAoCatalogo();
    vi.runAllTimers();
    expect(rolou).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("vai direto, sem animação, para quem pediu menos movimento", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    rolarAoCatalogo();
    vi.runAllTimers();
    expect(rolou).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
  });

  it("espera a Home montar: tenta de novo até o Catálogo existir", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    document.body.innerHTML = "";
    rolarAoCatalogo();
    vi.advanceTimersByTime(700);
    document.body.innerHTML = '<h2 id="catalogo">Catálogo</h2>';
    document.getElementById("catalogo")!.scrollIntoView =
      rolou as unknown as typeof Element.prototype.scrollIntoView;
    vi.advanceTimersByTime(300);
    expect(rolou).toHaveBeenCalledTimes(1);
  });

  it("não quebra quando a Home não está na tela", () => {
    document.body.innerHTML = "";
    expect(() => {
      rolarAoCatalogo();
      vi.runAllTimers();
    }).not.toThrow();
  });
});

describe("ligação da rolagem", () => {
  it("a Home marca o título do Catálogo com o id que a rolagem procura", () => {
    expect(readFileSync("src/views/customer/HomeView.tsx", "utf8")).toMatch(
      /<h2\s+id="catalogo"/,
    );
  });

  it("só a navegação por endereço rola; o chip (handleCategoryChange) não", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("rolarAoCatalogo()");
    const chip = app.slice(
      app.indexOf("const handleCategoryChange"),
      app.indexOf("const mainRef"),
    );
    expect(chip).not.toContain("rolarAoCatalogo");
  });
});
