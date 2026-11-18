import {
  destinoPosLogin,
  idDeProdutoDoPainel,
  idDoDestinoPosLogin,
  painelSemContaPedeEntrada,
} from "@/lib/destinoPosLogin";
import { describe, expect, it } from "vitest";

/**
 * Aviso de "pedido novo" abre `/admin-orders`. Quem toca nele sem sessão (saiu
 * da conta, ou a sessão caiu) caía na vitrine de clientes, sem tela de entrada
 * e sem aviso. Agora o painel sem conta pede entrada, e depois de entrar a
 * lojista volta para os pedidos.
 *
 * A lista de destinos aceitos do painel é FECHADA e mínima (`admin-orders`, a
 * tela que um aviso abre, `admin`, a porta do painel, e as duas telas em que a
 * lojista passa tempo com a sessão aberta e perde trabalho se for jogada no
 * Perfil: `admin-settings` e `admin-product-form`, esta com o id do produto em
 * edição): `history.state` é gravável pela própria página, então nada além
 * delas vira destino.
 */
const PRODUTO = "9a1c4e7b-2d3f-4a56-8b90-1c2d3e4f5a6b";

describe("destinoPosLogin — painel", () => {
  it("requested admin-orders manda para admin-orders (a tela que o aviso de pedido novo abre)", () => {
    expect(destinoPosLogin({ view: "auth", requested: "admin-orders" })).toBe(
      "admin-orders",
    );
  });

  it("PRECEDÊNCIA: requested admin-orders vence from (de onde veio)", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        from: "cart",
        requested: "admin-orders",
      }),
    ).toBe("admin-orders");
  });

  it("requested admin (a porta do painel) manda para admin: sessão vencida em /admin não cai no Perfil de cliente", () => {
    expect(destinoPosLogin({ view: "auth", requested: "admin" })).toBe("admin");
    // Precedência igual à de admin-orders: o pedido vence o "de onde veio".
    expect(
      destinoPosLogin({ view: "auth", from: "cart", requested: "admin" }),
    ).toBe("admin");
    // Sem `requested` (login comum, sem painel no meio), nada muda.
    expect(destinoPosLogin({ view: "auth" })).toBe("profile");
  });

  it("requested admin-settings manda para admin-settings: sessão vencida nos Ajustes não cai no Perfil de cliente", () => {
    expect(destinoPosLogin({ view: "auth", requested: "admin-settings" })).toBe(
      "admin-settings",
    );
    // Precedência igual à das demais: o pedido vence o "de onde veio".
    expect(
      destinoPosLogin({
        view: "auth",
        from: "cart",
        requested: "admin-settings",
      }),
    ).toBe("admin-settings");
  });

  it("requested admin-product-form manda para admin-product-form, com ou sem id (produto novo não tem id)", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        requested: "admin-product-form",
        id: PRODUTO,
      }),
    ).toBe("admin-product-form");
    expect(
      destinoPosLogin({ view: "auth", requested: "admin-product-form" }),
    ).toBe("admin-product-form");
    expect(
      destinoPosLogin({
        view: "auth",
        from: "cart",
        requested: "admin-product-form",
        id: PRODUTO,
      }),
    ).toBe("admin-product-form");
  });

  it("IDEMPOTÊNCIA: depois de já ter navegado para as duas novas (view !== auth) devolve null", () => {
    expect(
      destinoPosLogin({ view: "admin-settings", id: undefined, from: "auth" }),
    ).toBeNull();
    expect(
      destinoPosLogin({
        view: "admin-product-form",
        id: PRODUTO,
        from: "auth",
      }),
    ).toBeNull();
  });

  it("LISTA FECHADA: nenhuma outra tela do painel vira destino — cai no from / perfil", () => {
    for (const outra of [
      "admin-dashboard",
      "admin-products",
      "admin-coupon-form",
      "admin-user-detail",
      "admin-login",
      "admin-orders ",
      "ADMIN-ORDERS",
      "/admin-orders",
      "admin-orders?id=1",
      "admin-settings ",
      "ADMIN-SETTINGS",
      "admin-product-form?id=1",
      "/admin-product-form",
      "constructor",
      "__proto__",
    ]) {
      expect(
        destinoPosLogin({ view: "auth", requested: outra }),
        `requested=${outra}`,
      ).toBe("profile");
      expect(
        destinoPosLogin({ view: "auth", from: "checkout", requested: outra }),
        `requested=${outra} com from`,
      ).toBe("checkout");
    }
  });

  it("requested que não é string (objeto, número, array) não vira destino", () => {
    expect(destinoPosLogin({ view: "auth", requested: 42 })).toBe("profile");
    expect(destinoPosLogin({ view: "auth", requested: ["admin-orders"] })).toBe(
      "profile",
    );
    expect(
      destinoPosLogin({
        view: "auth",
        requested: { toString: () => "admin-orders" },
      }),
    ).toBe("profile");
  });

  it("IDEMPOTÊNCIA: depois de já ter navegado para admin-orders (view !== auth) devolve null", () => {
    expect(
      destinoPosLogin({ view: "admin-orders", id: undefined, from: "auth" }),
    ).toBeNull();
  });
});

describe("painelSemContaPedeEntrada — quem é mandada para a tela de entrada", () => {
  const semConta = { authLoading: false, user: null };
  const comConta = { authLoading: false, user: { id: "pessoa-logada" } };

  it("sem sessão (e sem carregar) em qualquer tela do painel: pede entrada", () => {
    for (const tela of [
      "admin",
      "admin-orders",
      "admin-dashboard",
      "admin-settings",
      "admin-product-form",
    ]) {
      expect(painelSemContaPedeEntrada(tela, semConta), tela).toBe(true);
    }
  });

  it("COM sessão não pede entrada (logada não-admin segue indo para a vitrine, como hoje)", () => {
    expect(painelSemContaPedeEntrada("admin-orders", comConta)).toBe(false);
    expect(painelSemContaPedeEntrada("admin", comConta)).toBe(false);
  });

  it("enquanto a sessão ainda carrega não decide (um admin legítimo não pode ser mandado ao login)", () => {
    expect(
      painelSemContaPedeEntrada("admin-orders", {
        authLoading: true,
        user: null,
      }),
    ).toBe(false);
    expect(
      painelSemContaPedeEntrada("admin-orders", {
        authLoading: true,
        user: { id: "x" },
      }),
    ).toBe(false);
  });

  it("a própria tela de entrada do lojista (admin-login) e as telas de cliente nunca são afetadas", () => {
    expect(painelSemContaPedeEntrada("admin-login", semConta)).toBe(false);
    expect(painelSemContaPedeEntrada("home", semConta)).toBe(false);
    expect(painelSemContaPedeEntrada("profile", semConta)).toBe(false);
    expect(painelSemContaPedeEntrada("auth", semConta)).toBe(false);
  });
});

describe("o id do produto em edição atravessa o login (só até admin-product-form)", () => {
  const state = { view: "auth", requested: "admin-product-form", id: PRODUTO };

  it("idDeProdutoDoPainel aceita o uuid (minúsculas e maiúsculas) e nada mais", () => {
    expect(idDeProdutoDoPainel(PRODUTO)).toBe(PRODUTO);
    expect(idDeProdutoDoPainel(PRODUTO.toUpperCase())).toBe(
      PRODUTO.toUpperCase(),
    );
    for (const lixo of [
      "javascript:alert(1)",
      "//evil.com",
      "https://evil.com/produto",
      "../",
      "a".repeat(5000),
      "<script>alert(1)</script>",
      `${PRODUTO}\n`,
      `${PRODUTO}x`,
      ` ${PRODUTO}`,
      `${PRODUTO}?x=1`,
      `${PRODUTO}&id=outro`,
      PRODUTO.replaceAll("-", ""),
      "produto-A",
      "",
      null,
      undefined,
      42,
      [PRODUTO],
      { toString: () => PRODUTO },
    ]) {
      expect(idDeProdutoDoPainel(lixo), JSON.stringify(lixo)).toBeUndefined();
    }
  });

  it("admin-product-form recebe o id quando é um uuid", () => {
    expect(idDoDestinoPosLogin("admin-product-form", state)).toBe(PRODUTO);
    expect(destinoPosLogin(state)).toBe("admin-product-form");
  });

  it("LIMITE: id malformado é descartado (o destino fica, o id some — nunca vira `?id` na URL)", () => {
    for (const id of [
      "javascript:alert(1)",
      "//evil.com",
      "../",
      "a".repeat(5000),
      `${PRODUTO}\n`,
      "produto-A",
      "",
      42,
      null,
      undefined,
      { toString: () => PRODUTO },
    ]) {
      expect(
        idDoDestinoPosLogin("admin-product-form", { ...state, id }),
        JSON.stringify(id),
      ).toBeUndefined();
      expect(destinoPosLogin({ ...state, id })).toBe("admin-product-form");
    }
  });

  it("LIMITE: admin-settings NUNCA recebe id (Ajustes não tem ficha), mesmo com uuid válido no state", () => {
    expect(
      idDoDestinoPosLogin("admin-settings", {
        view: "auth",
        requested: "admin-settings",
        id: PRODUTO,
      }),
    ).toBeUndefined();
  });

  it("LIMITE: o id de produto não vaza para as outras telas do painel", () => {
    for (const destino of [
      "admin",
      "admin-dashboard",
      "admin-products",
      "admin-coupon-form",
      "admin-user-detail",
      "admin-customers",
      "admin-login",
    ] as const) {
      expect(idDoDestinoPosLogin(destino, state), destino).toBeUndefined();
    }
  });

  it("CONTROLE: admin-orders segue validando como pedido e as telas de cliente seguem iguais", () => {
    expect(
      idDoDestinoPosLogin("admin-orders", { id: PRODUTO, requested: "x" }),
    ).toBe(PRODUTO);
    expect(
      idDoDestinoPosLogin("admin-orders", { id: "ped-1" }),
    ).toBeUndefined();
    expect(idDoDestinoPosLogin("product-detail", { id: "p1" })).toBe("p1");
    expect(idDoDestinoPosLogin("user-profile", { id: "u1" })).toBe("u1");
    expect(idDoDestinoPosLogin("order-details", { id: "o1" })).toBe("o1");
    expect(idDoDestinoPosLogin("profile", { id: "x" })).toBeUndefined();
  });

  it("CONTROLE: os destinos que já funcionavam seguem iguais", () => {
    expect(destinoPosLogin({ view: "auth" })).toBe("profile");
    expect(destinoPosLogin(null)).toBe("profile");
    expect(destinoPosLogin({ view: "auth", from: "checkout" })).toBe(
      "checkout",
    );
    expect(destinoPosLogin({ view: "auth", requested: "admin-orders" })).toBe(
      "admin-orders",
    );
    expect(destinoPosLogin({ view: "auth", requested: "admin" })).toBe("admin");
    expect(destinoPosLogin({ view: "auth", requested: "address-form" })).toBe(
      "address-form",
    );
    expect(
      destinoPosLogin({ view: "auth", requested: "product-detail", id: "p1" }),
    ).toBe("product-detail");
  });
});
