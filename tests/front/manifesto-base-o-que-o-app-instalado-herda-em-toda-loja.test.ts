// Caça por mutação (25/11/2026) em `src/config/manifestoBase.ts`: os campos do
// manifest que NUNCA variam por loja e que o celular lê ao instalar o app.
// Trocar qualquer um passava sem teste reclamar, e o efeito é de quem usa:
//  - `start_url` / `id` / `scope`: onde o ícone abre e o que o Android entende
//    como "o mesmo app" (mudar o `id` faz o celular tratar a loja como OUTRO
//    app e duplicar a instalação);
//  - `display`: sem a barra do navegador;
//  - `launch_handler`: tocar no ícone com o app aberto FOCA a janela que já
//    existe em vez de abrir outra;
//  - os dois atalhos do ícone (Carrinho e Favoritos): nome, texto, destino e
//    o ícone de 96x96 certo de cada um.
import { describe, expect, it } from "vitest";

import { MANIFESTO_BASE } from "@/config/manifestoBase";

describe("MANIFESTO_BASE — como o app instalado abre", () => {
  it("abre sem a barra do navegador, na raiz da loja, e o aparelho decide a orientação", () => {
    expect(MANIFESTO_BASE.display).toBe("standalone");
    expect(MANIFESTO_BASE.orientation).toBe("any");
    expect(MANIFESTO_BASE.scope).toBe("/");
  });

  it("o ícone abre em '/?source=pwa' e a identidade do app instalado é a mesma rota", () => {
    expect(MANIFESTO_BASE.start_url).toBe("/?source=pwa");
    expect(MANIFESTO_BASE.id).toBe("/?source=pwa");
  });

  it("tocar no ícone com o app aberto foca a janela existente; sem janela, abre normalmente", () => {
    expect(MANIFESTO_BASE.launch_handler).toEqual({
      client_mode: ["focus-existing", "auto"],
    });
  });

  it("as categorias de loja são 'shopping' e 'lifestyle', nessa ordem", () => {
    expect(MANIFESTO_BASE.categories).toEqual(["shopping", "lifestyle"]);
  });
});

describe("MANIFESTO_BASE — os atalhos do ícone", () => {
  it("são exatamente dois, Carrinho primeiro e Favoritos depois, cada um com seu texto, destino e ícone", () => {
    expect(MANIFESTO_BASE.shortcuts).toEqual([
      {
        name: "Carrinho",
        short_name: "Carrinho",
        description: "Ver itens no carrinho",
        url: "/cart",
        icons: [{ src: "/icons/cart-96x96.png", sizes: "96x96" }],
      },
      {
        name: "Favoritos",
        short_name: "Favoritos",
        description: "Ver favoritos",
        url: "/favorites",
        icons: [{ src: "/icons/heart-96x96.png", sizes: "96x96" }],
      },
    ]);
  });
});
