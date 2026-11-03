import { destinoPosLogin } from "@/lib/destinoPosLogin";
import { describe, expect, it } from "vitest";

/**
 * Caça 03/11 (achado d9): quem estava na aba Pedidos (ou nos Avisos) e tocou em
 * "Entrar" voltava ao PERFIL depois do login, e não à tela onde estava. As duas
 * telas não têm id nem formulário: voltar a elas é navegação absoluta segura.
 */
describe("destinoPosLogin: Pedidos e Avisos voltam para a mesma tela", () => {
  it("from orders, sem requested, volta para orders", () => {
    expect(destinoPosLogin({ view: "auth", from: "orders" })).toBe("orders");
  });

  it("from notifications, sem requested, volta para notifications", () => {
    expect(destinoPosLogin({ view: "auth", from: "notifications" })).toBe(
      "notifications",
    );
  });

  it("PRECEDÊNCIA: requested vence from também para orders/notifications", () => {
    expect(
      destinoPosLogin({ view: "auth", from: "orders", requested: "profile" }),
    ).toBe("profile");
    expect(
      destinoPosLogin({
        view: "auth",
        from: "notifications",
        requested: "account-settings",
      }),
    ).toBe("account-settings");
  });

  it("LIMITE: o conjunto de `from` continua fechado (telas com id ou desconhecidas caem no perfil)", () => {
    for (const from of [
      "order-details",
      "admin-orders",
      "user-profile",
      "home",
      "auth",
      "ORDERS",
      "",
      undefined,
      null,
    ]) {
      expect(destinoPosLogin({ view: "auth", from })).toBe("profile");
    }
  });

  it("LIMITE: já saiu da tela de login (pushState do destino) continua devolvendo null", () => {
    expect(destinoPosLogin({ view: "orders", from: "auth" })).toBeNull();
    expect(destinoPosLogin({ view: "notifications", from: "auth" })).toBeNull();
  });
});
