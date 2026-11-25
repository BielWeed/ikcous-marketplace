// Avisar clientes: duas funções de `src/lib/destino-do-aviso.ts` não tinham
// prova direta. `destinoDeProdutoSemIdValido` é a trava que impede a lojista de
// enviar um aviso cujo toque abriria "produto" sem produto (só o endereço
// interno de produto exige id, e o id tem de ser um uuid). `nomeDoDestino` é o
// texto que a lojista lê no histórico no lugar do endereço cru. O arquivo
// vizinho (`destino-do-aviso.test.ts`) prende a tabela de URLs; este prende
// os limites destas duas.
import { describe, expect, it } from "vitest";

import {
  destinoDeProdutoSemIdValido,
  nomeDoDestino,
} from "@/lib/destino-do-aviso";

const UUID = "9a1c4e7b-2d3f-4a56-8b90-1c2d3e4f5a6b";

describe("destinoDeProdutoSemIdValido — só o endereço de produto exige um id de verdade", () => {
  it.each([
    ["/product-detail"],
    ["/product-detail/"],
    ["/product-detail?id="],
    ["/product-detail?id=abc"],
    ["/product-detail?outra=1"],
    [`/product-detail#id=${UUID}`],
    [`/product-detail?id=${UUID}x`],
  ])("%s está sem id válido (o aviso não pode sair assim)", (url) => {
    expect(destinoDeProdutoSemIdValido(url)).toBe(true);
  });

  it.each([
    [`/product-detail?id=${UUID}`],
    [`/product-detail/?id=${UUID}`],
    [`/product-detail?id=${UUID.toUpperCase()}`],
    [`/product-detail?x=1&id=${UUID}`],
    [`/product-detail?id=${UUID}#topo`],
  ])("%s tem um uuid de produto: pode sair", (url) => {
    expect(destinoDeProdutoSemIdValido(url)).toBe(false);
  });

  it("LIMITE: outras telas e páginas manuais nunca exigem id de produto", () => {
    for (const url of [
      "/",
      "/cart",
      "/search",
      "/product-detail-x",
      "/product-detail/extra",
      "/promocao-do-mes?id=abc",
      "https://loja.example/product-detail",
      "",
    ]) {
      expect(destinoDeProdutoSemIdValido(url)).toBe(false);
    }
  });
});

describe("nomeDoDestino — o que a lojista lê no histórico no lugar do endereço", () => {
  it.each([
    ["/", "Página inicial da loja"],
    ["", "Página inicial da loja"],
    ["/home", "Página inicial da loja"],
    ["/search", "Busca de produtos"],
    ["/cart", "Carrinho"],
    ["/favorites", "Favoritos"],
    ["/orders", "Meus pedidos"],
    ["/profile", "Perfil do cliente"],
    [`/product-detail?id=${UUID}`, "Um produto"],
    ["/product/123", "Um produto"],
  ])("%j é lido como %s", (url, nome) => {
    expect(nomeDoDestino(url)).toBe(nome);
  });

  it("página manual mostra o endereço inteiro entre parênteses (é aí que a lojista confere o que digitou)", () => {
    expect(nomeDoDestino("/promocao-do-mes?x=1")).toBe(
      "Outra página (/promocao-do-mes?x=1)",
    );
    // `/product-detail` sem id não é "um produto": é página manual.
    expect(nomeDoDestino("/product-detail")).toBe(
      "Outra página (/product-detail)",
    );
  });
});
