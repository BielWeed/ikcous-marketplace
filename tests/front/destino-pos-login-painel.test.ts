import {
  destinoPosLogin,
  painelSemContaPedeEntrada,
} from "@/lib/destinoPosLogin";
import { describe, expect, it } from "vitest";

/**
 * Aviso de "pedido novo" abre `/admin-orders`. Quem toca nele sem sessão (saiu
 * da conta, ou a sessão caiu) caía na vitrine de clientes, sem tela de entrada
 * e sem aviso. Agora o painel sem conta pede entrada, e depois de entrar a
 * lojista volta para os pedidos.
 *
 * A lista de destinos aceitos do painel é FECHADA e mínima (só `admin-orders`,
 * a única tela que um aviso abre): `history.state` é gravável pela própria
 * página, então nada além dela vira destino.
 */
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

  it("LISTA FECHADA: nenhuma outra tela do painel vira destino — cai no from / perfil", () => {
    for (const outra of [
      "admin",
      "admin-dashboard",
      "admin-settings",
      "admin-products",
      "admin-product-form",
      "admin-user-detail",
      "admin-login",
      "admin-orders ",
      "ADMIN-ORDERS",
      "/admin-orders",
      "admin-orders?id=1",
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
