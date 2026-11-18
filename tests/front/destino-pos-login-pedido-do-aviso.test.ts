import {
  destinoPosLogin,
  idDePedidoDoPainel,
  idDoDestinoPosLogin,
} from "@/lib/destinoPosLogin";
import { describe, expect, it } from "vitest";

/**
 * O aviso de "Pedido novo" abre `/admin-orders?id=<uuid do pedido>`. A lojista
 * que toca nele com a sessão vencida entra e precisa chegar na FICHA daquele
 * pedido, não na lista. Para isso o `id` atravessa o login — e como o state do
 * histórico é gravável pela própria página, ele só passa se for um uuid de
 * verdade e só para a rota `admin-orders`.
 */
const PEDIDO = "3f2b8c1e-5a47-4d9e-9b1a-7c6d2e4f8a90";

describe("idDePedidoDoPainel: só um uuid de pedido passa", () => {
  it("aceita o uuid, em minúsculas e em maiúsculas (o banco aceita os dois)", () => {
    expect(idDePedidoDoPainel(PEDIDO)).toBe(PEDIDO);
    expect(idDePedidoDoPainel(PEDIDO.toUpperCase())).toBe(PEDIDO.toUpperCase());
  });

  it("LIMITE: script, URL, caminho, texto longo e lixo são descartados", () => {
    for (const lixo of [
      "javascript:alert(1)",
      "//evil.com",
      "https://evil.com/pedido",
      "../",
      "../../admin",
      "a".repeat(5000),
      "<script>alert(1)</script>",
      `${PEDIDO}\n`,
      `${PEDIDO}x`,
      ` ${PEDIDO}`,
      `${PEDIDO}?x=1`,
      `${PEDIDO}#hash`,
      `${PEDIDO}&id=outro`,
      PEDIDO.replaceAll("-", ""),
      "ped-1",
      "",
      "-".repeat(36),
    ]) {
      expect(idDePedidoDoPainel(lixo), JSON.stringify(lixo)).toBeUndefined();
    }
  });

  it("LIMITE: o que não é string (nulo, número, lista, objeto) é descartado", () => {
    for (const lixo of [null, undefined, 36, true, [PEDIDO], { id: PEDIDO }]) {
      expect(idDePedidoDoPainel(lixo)).toBeUndefined();
    }
  });
});

describe("idDoDestinoPosLogin: o pedido do aviso chega à ficha", () => {
  const state = { view: "auth", requested: "admin-orders", id: PEDIDO };

  it("admin-orders recebe o id quando é um uuid", () => {
    expect(idDoDestinoPosLogin("admin-orders", state)).toBe(PEDIDO);
    expect(destinoPosLogin(state)).toBe("admin-orders");
  });

  it("LIMITE: admin-orders NÃO recebe id malformado, script nem URL (cai na lista)", () => {
    for (const id of [
      "javascript:alert(1)",
      "//evil.com",
      "../",
      "a".repeat(5000),
      `${PEDIDO}\n`,
      "ped-1",
      "",
      42,
      null,
      undefined,
      { toString: () => PEDIDO },
    ]) {
      expect(
        idDoDestinoPosLogin("admin-orders", { ...state, id }),
        JSON.stringify(id),
      ).toBeUndefined();
      // O destino continua sendo a lista de pedidos: só o id some.
      expect(destinoPosLogin({ ...state, id })).toBe("admin-orders");
    }
  });

  it("LIMITE: o id de pedido NUNCA vaza para outra rota (allow-list de uma só)", () => {
    for (const destino of [
      "admin",
      "admin-dashboard",
      "admin-settings",
      "admin-products",
      "admin-customers",
      "admin-login",
      "profile",
      "orders",
      "notifications",
      "cart",
      "checkout",
      "home",
      "account-settings",
      "address-form",
    ] as const) {
      expect(idDoDestinoPosLogin(destino, state), destino).toBeUndefined();
    }
  });

  it("CONTROLE: order-details, user-profile e product-detail seguem recebendo o id do state, exatamente como antes", () => {
    const daCliente = { view: "auth", from: "order-details", id: "ped-1" };
    expect(idDoDestinoPosLogin("order-details", daCliente)).toBe("ped-1");
    expect(idDoDestinoPosLogin("user-profile", daCliente)).toBe("ped-1");
    expect(idDoDestinoPosLogin("product-detail", daCliente)).toBe("ped-1");
    expect(destinoPosLogin(daCliente)).toBe("order-details");
    // E o uuid de pedido, nessas três, também passa (não é filtrado lá).
    expect(idDoDestinoPosLogin("order-details", { id: PEDIDO })).toBe(PEDIDO);
  });
});
