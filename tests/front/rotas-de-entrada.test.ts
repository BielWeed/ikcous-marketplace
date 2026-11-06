import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TELAS_DE_ENTRADA } from "../../src/config/rotas";

const appTsx = path.resolve(import.meta.dirname, "../../src/App.tsx");

describe("telas de entrada (declaração única)", () => {
  it("são 46 nomes únicos, com home e 26 administrativas (C3.3: +admin-pdv; 20/09: +admin-about-store; 23/09: +admin-shipping-national; 26/09: +admin-crm, +admin-financeiro, +admin-devolucoes; 14/10: +terms, +privacy, +returns-policy, as três páginas de política da loja; 21/10: +admin-free-shipping-card, Card de frete grátis; 06/11: -order-success e -recently-viewed, que abriam tela errada/em branco)", () => {
    expect(TELAS_DE_ENTRADA).toHaveLength(46);
    expect(new Set(TELAS_DE_ENTRADA).size).toBe(46);
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

  // 06/11/2026: /recently-viewed abria uma tela em branco (a tela nunca
  // existiu) e /order-success dizia "Pedido Realizado!" a quem não comprou
  // nada (nenhuma tela do app navega para ela; a confirmação de compra é
  // interna do checkout). Fora da lista, os dois endereços caem na Home,
  // como qualquer endereço desconhecido.
  it("endereços sem tela própria não são entradas: /order-success e /recently-viewed", () => {
    expect(TELAS_DE_ENTRADA).not.toContain("order-success");
    expect(TELAS_DE_ENTRADA).not.toContain("recently-viewed");
    // controle: as vizinhas que têm tela de verdade continuam entrando.
    expect(TELAS_DE_ENTRADA).toContain("orders");
    expect(TELAS_DE_ENTRADA).toContain("order-details");
    expect(TELAS_DE_ENTRADA).toContain("account-settings");
  });

  it("App.tsx lê a lista daqui, não de um literal próprio", () => {
    const fonte = fs.readFileSync(appTsx, "utf8");
    expect(fonte).toContain("TELAS_DE_ENTRADA");
    expect(fonte).not.toMatch(/const validViews: View\[\] = \[/);
  });
});
