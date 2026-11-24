// @vitest-environment jsdom
//
// O TOQUE NO AVISO DO SINO (`navegarPorUrl`) LÊ O ENDEREÇO DO AVISO E ESCOLHE A
// TELA. Os testes vizinhos cobrem o formato antigo de produto, as páginas
// públicas da loja e a categoria na raiz; este arquivo prende os limites do
// leitor de endereço que ficaram sem prova: a categoria também na `/home`, as
// maiúsculas no caminho (o id de `/product/<id>` NÃO é minusculizado), o
// segundo trecho depois do id, `order` e `order-details`, o Id que acompanha
// uma tela conhecida e o desvio do `catch` para endereço que nem URL é.
import { describe, expect, it, vi } from "vitest";

// A tela importa o cartão de avisos do aparelho, que lê o hook de push (puxa o
// supabase real, sem variáveis de ambiente aqui); este teste é só da decisão.
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({}),
}));

import { navegarPorUrl } from "@/views/customer/NotificationsView";

function abrir(url: string) {
  const chamadas: string[] = [];
  const navegar = vi.fn<(view: unknown, id?: string) => void>((view, id) => {
    chamadas.push(`navegar:${String(view)}:${id ?? "-"}`);
  });
  const categoria = vi.fn<(nome: string) => void>((nome) => {
    chamadas.push(`categoria:${nome}`);
  });
  navegarPorUrl(url, navegar, categoria);
  return { navegar, categoria, chamadas };
}

describe("navegarPorUrl — categoria", () => {
  it("/home?category=X também guarda a categoria antes de ir à Início (não é só a raiz)", () => {
    const { chamadas } = abrir("/home?category=Vestidos");
    expect(chamadas).toEqual(["categoria:Vestidos", "navegar:home:-"]);
  });

  it("a categoria é guardada ANTES da navegação: o endereço da Início nasce da categoria atual", () => {
    expect(abrir("/?category=Bebidas").chamadas).toEqual([
      "categoria:Bebidas",
      "navegar:home:-",
    ]);
  });

  it("o caminho em maiúsculas (/HOME) vale como /home", () => {
    expect(abrir("/HOME?category=Doces").chamadas).toEqual([
      "categoria:Doces",
      "navegar:home:-",
    ]);
  });

  it("LIMITE: category vazio não é categoria — vai à Início sem mexer no filtro", () => {
    const { categoria, chamadas } = abrir("/?category=");
    expect(categoria).not.toHaveBeenCalled();
    expect(chamadas).toEqual(["navegar:home:-"]);
  });

  it("LIMITE: category em OUTRA tela não vira filtro (só a Início tem categoria)", () => {
    const { categoria, chamadas } = abrir("/cart?category=Bebidas");
    expect(categoria).not.toHaveBeenCalled();
    expect(chamadas).toEqual(["navegar:cart:-"]);
  });

  it("sem a função de categoria (aviso aberto fora da Início) não quebra e ainda navega", () => {
    const navegar = vi.fn<(view: unknown, id?: string) => void>();
    expect(() => navegarPorUrl("/?category=Vestidos", navegar)).not.toThrow();
    expect(navegar).toHaveBeenCalledWith("home");
  });
});

describe("navegarPorUrl — produto e pedido pelo endereço", () => {
  it("o id de /product/<id> mantém as maiúsculas do aviso (só o NOME da tela é minusculizado)", () => {
    expect(abrir("/PRODUCT/AbC-9F").chamadas).toEqual([
      "navegar:product-detail:AbC-9F",
    ]);
  });

  it("com mais um trecho depois do id, vale o PRIMEIRO trecho", () => {
    expect(abrir("/product/primeiro/segundo").chamadas).toEqual([
      "navegar:product-detail:primeiro",
    ]);
  });

  it("?id= de produto também aceita o nome curto /product e mantém o id como veio", () => {
    expect(abrir("/product?id=XyZ").chamadas).toEqual([
      "navegar:product-detail:XyZ",
    ]);
    expect(abrir("/Product-Detail?id=XyZ").chamadas).toEqual([
      "navegar:product-detail:XyZ",
    ]);
  });

  it("pedido: /order-details?id= e o nome curto /order?id= abrem a ficha do pedido", () => {
    expect(abrir("/order-details?id=ped-1").chamadas).toEqual([
      "navegar:order-details:ped-1",
    ]);
    expect(abrir("/order?id=ped-2").chamadas).toEqual([
      "navegar:order-details:ped-2",
    ]);
  });

  it("LIMITE: /order com ?id= vazio não abre ficha vazia — cai na Início", () => {
    const { chamadas } = abrir("/order?id=");
    // `order` não é tela conhecida: sem id, o aviso cai na Início.
    expect(chamadas).toEqual(["navegar:home:-"]);
  });
});

describe("navegarPorUrl — telas conhecidas e o id que as acompanha", () => {
  it.each([
    "home",
    "cart",
    "checkout",
    "profile",
    "user-profile",
    "search",
    "auth",
    "login",
    "favorites",
    "notifications",
    "orders",
    "account-settings",
    "address-form",
    "about-store",
    "terms",
    "privacy",
    "returns-policy",
  ])("/%s abre a própria tela", (tela) => {
    expect(abrir(`/${tela}`).chamadas).toEqual([`navegar:${tela}:-`]);
  });

  it("o ?id= acompanha a tela conhecida (perfil de outra pessoa, endereço em edição)", () => {
    expect(abrir("/user-profile?id=u-7").chamadas).toEqual([
      "navegar:user-profile:u-7",
    ]);
    expect(abrir("/address-form?id=e-3").chamadas).toEqual([
      "navegar:address-form:e-3",
    ]);
  });

  it("barras sobrando no começo e no fim não mudam a tela", () => {
    expect(abrir("/cart//").chamadas).toEqual(["navegar:cart:-"]);
    expect(abrir("/cart/").chamadas).toEqual(["navegar:cart:-"]);
  });

  it("o nome da tela em maiúsculas vale como minúsculas", () => {
    expect(abrir("/CART").chamadas).toEqual(["navegar:cart:-"]);
    expect(abrir("/Favorites").chamadas).toEqual(["navegar:favorites:-"]);
  });

  it("tela do painel e endereço desconhecido caem na Início (nunca abrem o painel pelo sino)", () => {
    for (const url of [
      "/admin",
      "/admin-orders?id=1",
      "/nao-existe",
      "/cart/extra",
    ]) {
      expect(abrir(url).chamadas).toEqual(["navegar:home:-"]);
    }
  });

  it("aviso sem função de navegação não quebra", () => {
    expect(() => navegarPorUrl("/cart")).not.toThrow();
  });
});

describe("navegarPorUrl — endereço que nem URL é (o desvio do catch)", () => {
  // `new URL("http://[x", base)` lança: o texto é lido só pelas palavras.
  it.each([
    ["http://[cart", "cart"],
    ["http://[favorites", "favorites"],
    ["http://[profile", "profile"],
    ["http://[checkout", "checkout"],
    ["http://[", "home"],
  ])("%s vai para %s", (url, tela) => {
    expect(abrir(url).chamadas).toEqual([`navegar:${tela}:-`]);
  });

  it("PRECEDÊNCIA: se o texto tem mais de uma palavra, vale a ordem carrinho > favoritos > perfil > checkout", () => {
    expect(abrir("http://[checkout-profile-favorites-cart").chamadas).toEqual([
      "navegar:cart:-",
    ]);
    expect(abrir("http://[checkout-profile-favorites").chamadas).toEqual([
      "navegar:favorites:-",
    ]);
    expect(abrir("http://[checkout-profile").chamadas).toEqual([
      "navegar:profile:-",
    ]);
  });
});
