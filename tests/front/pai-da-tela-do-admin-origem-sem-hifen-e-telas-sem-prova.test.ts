import { paiDaTelaDoAdmin } from "@/utils/pai-da-tela-do-admin";
import { describe, expect, it } from "vitest";

/**
 * O Voltar do painel (`paiDaTelaDoAdmin`) tem quatro telas que obedecem à
 * ORIGEM (Push, Notificações, Atendimento e a ficha do cliente) e a regra é
 * escrita: a origem só vale se veio de DENTRO do painel (nome que começa com
 * `admin-`) e se não é a própria tela. Os testes vizinhos provam a origem
 * `home`, a nula e a própria tela em umas telas; ficaram sem prova:
 *  - a PORTA do painel, `admin` (sem hífen), que não é "tela de dentro" — o
 *    Voltar nunca a devolve como origem, cai no pai da tabela;
 *  - a ficha do cliente apontando para si mesma;
 *  - duas telas da tabela fixa: `admin-coupons` (volta aos Produtos) e
 *    `admin-about-store` (volta aos Ajustes).
 */
describe("paiDaTelaDoAdmin — a origem precisa ser tela de dentro do painel (admin-…)", () => {
  // Cada tela sensível à origem, com o pai de quando a origem não serve.
  const TELAS_COM_ORIGEM = [
    ["admin-push", "admin-customers"],
    ["admin-notifications", "admin-dashboard"],
    ["admin-whatsapp-config", "admin-settings"],
    ["admin-user-detail", "admin-customers"],
  ] as const;

  it.each(TELAS_COM_ORIGEM)(
    "%s com origem `admin` (a porta, sem hífen) NÃO volta à porta: cai no pai da tabela (%s)",
    (tela, pai) => {
      expect(paiDaTelaDoAdmin(tela, "admin", false)).toBe(pai);
    },
  );

  it.each(TELAS_COM_ORIGEM)(
    "%s com origem de dentro do painel volta à origem (controle)",
    (tela) => {
      expect(paiDaTelaDoAdmin(tela, "admin-orders", false)).toBe(
        "admin-orders",
      );
    },
  );

  it.each(TELAS_COM_ORIGEM)(
    "%s com origem igual a ela mesma nunca volta para si mesma: cai no pai da tabela (%s)",
    (tela, pai) => {
      expect(paiDaTelaDoAdmin(tela, tela, false)).toBe(pai);
    },
  );

  it("o detalhe de pedido vence a origem em todas elas", () => {
    for (const [tela] of TELAS_COM_ORIGEM) {
      expect(paiDaTelaDoAdmin(tela, "admin-crm", true)).toBe("admin-orders");
    }
  });
});

describe("paiDaTelaDoAdmin — telas da tabela fixa sem prova", () => {
  it("admin-coupons (a lista de cupons) volta aos Produtos, com ou sem origem", () => {
    expect(paiDaTelaDoAdmin("admin-coupons", null, false)).toBe(
      "admin-products",
    );
    expect(paiDaTelaDoAdmin("admin-coupons", "admin-settings", false)).toBe(
      "admin-products",
    );
  });

  it("admin-about-store (Sobre a loja) volta aos Ajustes, com ou sem origem", () => {
    expect(paiDaTelaDoAdmin("admin-about-store", null, false)).toBe(
      "admin-settings",
    );
    expect(
      paiDaTelaDoAdmin("admin-about-store", "admin-dashboard", false),
    ).toBe("admin-settings");
  });
});
