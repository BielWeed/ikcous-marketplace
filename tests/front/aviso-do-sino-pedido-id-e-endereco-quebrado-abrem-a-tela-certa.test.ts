// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026): para onde o toque num aviso do sino leva a
// cliente (`navegarPorUrl`) nos cantos que nenhum teste vigiava:
//   - link de PEDIDO (`/order-details?id=` e o apelido `/order?id=`) abre o
//     pedido com o id intacto; sem id não vira "pedido sem número";
//   - telas conhecidas levam o `id` da consulta (ex.: editar um endereço);
//   - link antigo de produto com caminho a mais (`/product/<id>/<resto>`);
//   - endereço que nem é endereço (a lojista digitou lixo no "Avançado") não
//     derruba a tela: cai na tela que o texto cita, ou na vitrine.
import { describe, expect, it, vi } from "vitest";

// A tela importa o cartão de avisos do aparelho, que lê o hook de push (puxa o
// supabase real, sem variáveis de ambiente aqui); este teste é só da decisão.
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({}),
}));

import { navegarPorUrl } from "@/views/customer/NotificationsView";

function destinoDe(url: string) {
  const navegar = vi.fn<(view: unknown, id?: string) => void>();
  navegarPorUrl(url, navegar);
  return navegar;
}

describe("navegarPorUrl — pedido", () => {
  it.each(["/order-details?id=Ped-AbC", "/order?id=Ped-AbC"])(
    "%s abre o pedido com o id exatamente como veio",
    (url) => {
      const navegar = destinoDe(url);
      expect(navegar).toHaveBeenCalledTimes(1);
      expect(navegar).toHaveBeenCalledWith("order-details", "Ped-AbC");
    },
  );

  it("o apelido /order sem id não abre pedido: cai na vitrine", () => {
    const navegar = destinoDe("/order");
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("/order-details sem id (ou com id vazio) segue como tela comum, sem id inventado", () => {
    expect(destinoDe("/order-details")).toHaveBeenCalledWith(
      "order-details",
      undefined,
    );
    expect(destinoDe("/order-details?id=")).toHaveBeenCalledWith(
      "order-details",
      undefined,
    );
  });
});

describe("navegarPorUrl — tela conhecida leva o id da consulta", () => {
  it("/address-form?id=<id> abre a edição daquele endereço", () => {
    const navegar = destinoDe("/address-form?id=end-1");
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("address-form", "end-1");
  });

  it("sem id na consulta, a tela abre sem id", () => {
    expect(destinoDe("/address-form")).toHaveBeenCalledWith(
      "address-form",
      undefined,
    );
  });
});

describe("navegarPorUrl — link antigo de produto com caminho a mais", () => {
  it("/product/<id>/<resto> abre o produto só com o id, sem o resto do caminho", () => {
    const navegar = destinoDe("/product/abc/avaliacoes");
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("product-detail", "abc");
  });
});

describe("navegarPorUrl — endereço inválido não derruba a tela", () => {
  // `http://[` não é uma URL: o `new URL` lança e o ramo de emergência escolhe
  // a tela pelo texto.
  it.each([
    ["http://[/cart", "cart"],
    ["http://[/favorites", "favorites"],
    ["http://[/profile", "profile"],
    ["http://[/checkout", "checkout"],
  ])("%s cai na tela %s", (url, tela) => {
    const navegar = destinoDe(url);
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith(tela);
  });

  it("sem tela citada, cai na vitrine", () => {
    const navegar = destinoDe("http://[/qualquer-coisa");
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("citando duas telas, vale a primeira da fila (carrinho antes de favoritos antes de perfil antes de pagamento)", () => {
    expect(destinoDe("http://[/favorites/cart")).toHaveBeenCalledWith("cart");
    expect(destinoDe("http://[/profile/favorites")).toHaveBeenCalledWith(
      "favorites",
    );
    expect(destinoDe("http://[/checkout/profile")).toHaveBeenCalledWith(
      "profile",
    );
  });
});
