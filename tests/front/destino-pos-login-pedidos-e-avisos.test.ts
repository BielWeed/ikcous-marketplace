import { destinoPosLogin, idDoDestinoPosLogin } from "@/lib/destinoPosLogin";
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

/**
 * Caça 05/11 (r20-f): a cliente que toca no aviso "Seu pedido saiu para
 * entrega" sem conta aberta cai em /order-details?id=X, vê "Entre na conta para
 * ver este pedido" e toca em Entrar. A tela não é redirecionada ao login pelo
 * App (o convidado que rastreou por código a usa), então NÃO existe `requested`
 * no state: só `from: "order-details"` e, agora, o `id` do pedido. Com id volta
 * ao pedido; sem id (nada a desenhar) continua no perfil.
 */
describe("destinoPosLogin: Entrar na tela do pedido volta ao pedido", () => {
  it("from order-details COM id volta para order-details", () => {
    expect(
      destinoPosLogin({ view: "auth", from: "order-details", id: "ped-1" }),
    ).toBe("order-details");
  });

  it("from order-details SEM id continua indo ao perfil (tela morta sem pedido)", () => {
    expect(destinoPosLogin({ view: "auth", from: "order-details" })).toBe(
      "profile",
    );
  });

  it("LIMITE: id vazio ou que não é string vai ao perfil", () => {
    for (const id of ["", undefined, null, 0, 123, true, {}, ["ped-1"]]) {
      expect(destinoPosLogin({ view: "auth", from: "order-details", id })).toBe(
        "profile",
      );
    }
  });

  it("LIMITE: id sozinho (sem from order-details) não leva ao pedido", () => {
    for (const from of ["orders", "home", "cart", "checkout", undefined]) {
      expect(destinoPosLogin({ view: "auth", from, id: "ped-1" })).not.toBe(
        "order-details",
      );
    }
  });

  it("LIMITE: `requested` fora da lista com from order-details+id ainda vai ao pedido, nunca a destino de fora", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        from: "order-details",
        id: "ped-1",
        requested: "https://evil.example",
      }),
    ).toBe("order-details");
    expect(
      destinoPosLogin({
        view: "auth",
        from: "order-details",
        id: "ped-1",
        requested: "admin-products",
      }),
    ).toBe("order-details");
  });

  it("PRECEDÊNCIA: requested válido continua vencendo o from order-details", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        from: "order-details",
        id: "ped-1",
        requested: "account-settings",
      }),
    ).toBe("account-settings");
  });

  it("LIMITE: já saiu da tela de login (pushState do pedido) devolve null, sem navegar de novo", () => {
    expect(
      destinoPosLogin({ view: "order-details", from: "auth", id: "ped-1" }),
    ).toBeNull();
  });
});

/**
 * `handleAuthSuccess` (App.tsx) lê o id do state do login ANTES de navegar e o
 * repassa ao destino. Só as três telas que precisam dele o recebem: id nas
 * outras criaria `?id` fantasma numa URL que nunca o teve.
 */
describe("idDoDestinoPosLogin: quem recebe o id do state do login", () => {
  const state = { view: "auth", from: "order-details", id: "ped-1" };

  it("order-details, user-profile e product-detail recebem o id", () => {
    expect(idDoDestinoPosLogin("order-details", state)).toBe("ped-1");
    expect(idDoDestinoPosLogin("user-profile", state)).toBe("ped-1");
    expect(idDoDestinoPosLogin("product-detail", state)).toBe("ped-1");
  });

  it("LIMITE: as demais telas nunca recebem id (sem `?id` fantasma)", () => {
    for (const destino of [
      "profile",
      "orders",
      "notifications",
      "cart",
      "checkout",
      "account-settings",
      "address-form",
      "admin",
      "admin-orders",
    ] as const) {
      expect(idDoDestinoPosLogin(destino, state)).toBeUndefined();
    }
  });

  it("LIMITE: state sem id, id vazio, id não-string ou state lixo devolvem undefined", () => {
    for (const s of [
      { view: "auth" },
      { view: "auth", id: "" },
      { view: "auth", id: 42 },
      { view: "auth", id: { x: 1 } },
      null,
      undefined,
      "texto",
    ]) {
      expect(idDoDestinoPosLogin("order-details", s)).toBeUndefined();
    }
  });
});
