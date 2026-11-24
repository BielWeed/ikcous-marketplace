// Caça de provas fracas (mutação) em `capaDeReservaDoItem`, 24/11/2026. É a
// foto "plano B" da linha do carrinho e do resumo do pedido: quando a foto da
// cor escolhida falha ao carregar, a tela tenta a capa do produto. Nenhum teste
// olhava a função diretamente, e três trocas sobreviviam: aceitar capa vazia
// (a tela pediria uma imagem sem endereço), comparar sem aparar os espaços (a
// mesma foto seria tentada de novo) e aceitar o marcador "Sem Imagem" como se
// fosse foto de verdade (a cliente veria um cartão cinza no lugar da foto).
import { capaDeReservaDoItem } from "@/lib/foto-do-item-do-carrinho";
import type { CartItem } from "@/types";
import { describe, expect, it } from "vitest";

const FOTO_DA_LINHA = "https://loja.test/azul.jpg";
const CAPA = "https://loja.test/capa.jpg";

const itemComFotos = (images: string[] | undefined) =>
  ({ product: { images } }) as unknown as CartItem;

describe("capaDeReservaDoItem — só devolve uma capa que valha a pena tentar", () => {
  it("capa real e diferente da foto da linha é devolvida", () => {
    expect(capaDeReservaDoItem(itemComFotos([CAPA]), FOTO_DA_LINHA)).toBe(CAPA);
  });

  it("sem foto na linha (nada falhou antes), a capa real é devolvida", () => {
    expect(capaDeReservaDoItem(itemComFotos([CAPA]), undefined)).toBe(CAPA);
  });

  it("capa igual à foto da linha não é tentada de novo, mesmo com espaços sobrando", () => {
    expect(capaDeReservaDoItem(itemComFotos([CAPA]), CAPA)).toBeUndefined();
    expect(
      capaDeReservaDoItem(itemComFotos([`  ${CAPA} `]), CAPA),
    ).toBeUndefined();
    expect(
      capaDeReservaDoItem(itemComFotos([CAPA]), `${CAPA}  `),
    ).toBeUndefined();
  });

  it.each([
    ["lista de fotos vazia", []],
    ["sem lista de fotos", undefined],
    ["capa em branco", ["   "]],
    ["capa vazia", [""]],
  ])("%s: não há capa para tentar", (_motivo, fotos) => {
    expect(
      capaDeReservaDoItem(itemComFotos(fotos), FOTO_DA_LINHA),
    ).toBeUndefined();
  });

  it("o marcador 'Sem Imagem' (placehold.co) não é foto: não é tentado", () => {
    expect(
      capaDeReservaDoItem(
        itemComFotos(["https://placehold.co/600x600?text=Sem+Imagem"]),
        FOTO_DA_LINHA,
      ),
    ).toBeUndefined();
  });
});
