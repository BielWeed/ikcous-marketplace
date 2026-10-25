// @vitest-environment jsdom
//
// AVISO COM LINK ANTIGO `/product/<id>` ABRE O PRODUTO (caça 4, A3, 24/10/2026).
//
// O painel ainda aceita (e `destinoDaUrl` ainda reconhece) o formato antigo de
// link de produto, `/product/<id>`. Mas na caixa de avisos da cliente o toque
// caía na vitrine: o caminho `product/<id>` não era `product`, não era uma tela
// conhecida e o resto caía em "home". A cliente tocava no aviso do produto e
// via a página inicial.
//
// `navegarPorUrl` é a decisão pura (URL -> tela + id); o clique chama ela antes
// de qualquer espera.
import { describe, expect, it, vi } from "vitest";

import { navegarPorUrl } from "@/views/customer/NotificationsView";

function destinoDe(url: string) {
  const navegar = vi.fn<(view: unknown, id?: string) => void>();
  navegarPorUrl(url, navegar);
  return navegar;
}

describe("navegarPorUrl — link antigo de produto", () => {
  it("/product/<id> abre o produto", () => {
    const navegar = destinoDe("/product/abc");
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("product-detail", "abc");
  });

  it("com barra no fim ou parâmetro solto, o id continua sendo o do caminho", () => {
    expect(destinoDe("/product/abc/")).toHaveBeenCalledWith(
      "product-detail",
      "abc",
    );
    expect(destinoDe("/product/abc?origem=push")).toHaveBeenCalledWith(
      "product-detail",
      "abc",
    );
  });

  it("id de verdade (UUID) passa inteiro", () => {
    const id = "3f2b8c1e-9d4a-4e6b-8a57-1c2d3e4f5a6b";
    expect(destinoDe(`/product/${id}`)).toHaveBeenCalledWith(
      "product-detail",
      id,
    );
  });

  it("/product/ SEM id não abre produto vazio: cai na vitrine", () => {
    const navegar = destinoDe("/product/");
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("CONTROLES — os formatos que já funcionavam seguem iguais", () => {
    expect(destinoDe("/product-detail?id=abc")).toHaveBeenCalledWith(
      "product-detail",
      "abc",
    );
    expect(destinoDe("/product?id=abc")).toHaveBeenCalledWith(
      "product-detail",
      "abc",
    );
    expect(destinoDe("/cart")).toHaveBeenCalledWith("cart", undefined);
    expect(destinoDe("/caminho-que-nao-existe")).toHaveBeenCalledWith("home");
  });
});
