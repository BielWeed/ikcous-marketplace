import { destinoPosLogin } from "@/lib/destinoPosLogin";
import { describe, expect, it } from "vitest";

/**
 * Quem entra pelas "Perguntas ao vendedor" (ProductQA) tem de voltar ao
 * PRODUTO, não cair no Perfil. Mesma regra do `user-profile`: a view só
 * desenha com o `id` do produto, então "product-detail" só é honrado COM um
 * `id` utilizável no state; sem id cai nas regras seguintes.
 */
describe("destinoPosLogin — product-detail no conjunto redirecionável", () => {
  it("requested product-detail COM o id volta ao produto", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        id: "produto-A",
        requested: "product-detail",
      }),
    ).toBe("product-detail");
  });

  it("SEM id (ou id vazio / não-texto) NÃO é honrado — cai nas regras seguintes", () => {
    expect(destinoPosLogin({ view: "auth", requested: "product-detail" })).toBe(
      "profile",
    );
    expect(
      destinoPosLogin({
        view: "auth",
        id: "",
        from: "checkout",
        requested: "product-detail",
      }),
    ).toBe("checkout");
    expect(
      destinoPosLogin({
        view: "auth",
        id: 7,
        requested: "product-detail",
      }),
    ).toBe("profile");
  });

  it("REGRESSÃO: as outras views redirecionáveis seguem como eram", () => {
    expect(
      destinoPosLogin({ view: "auth", requested: "account-settings" }),
    ).toBe("account-settings");
    expect(destinoPosLogin({ view: "auth", from: "cart" })).toBe("cart");
  });
});
