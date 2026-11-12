// @vitest-environment jsdom
//
// A folha "Escolher opções" do card mostrava os tamanhos na ordem em que o
// lojista os cadastrou ("GG, P, G, M"), enquanto a página do produto os ordena
// (P, M, G, GG; números em ordem de número; "Único" por último). O mesmo produto
// aparecia com sequências diferentes. A folha agora usa a MESMA régua da página
// (`fileirasDeVariacao`); cor continua na ordem do cadastro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CorpoDaFolhaDeOpcoes,
  FolhaDeOpcoes,
} from "@/components/ui/custom/FolhaDeOpcoes";
import type { ProductVariant } from "@/types";
import { criarEixosDaVariacao } from "@/utils/eixos-da-variacao";
import { fileirasDeVariacao } from "@/utils/fileiras-de-variacao";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "local" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variante = (
  name: string,
  value: string,
  stockIncrement = 5,
): ProductVariant => ({
  id: `${name}:${value}`,
  productId: "p",
  name,
  value,
  stockIncrement,
  active: true,
});
const doTamanho = (valores: string[]) =>
  valores.map((v) => variante("Tamanho", v));

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

// Abre o eixo pedido e devolve, na ordem da tela, o valor de cada botão.
function valoresDoEixo(variantes: ProductVariant[], nomeDoEixo: string) {
  const modelo = criarEixosDaVariacao(variantes);
  const eixo = modelo.eixos.find((e) => e.nome === nomeDoEixo)!;
  act(() => {
    raiz.render(
      <FolhaDeOpcoes aberta onMudar={() => {}}>
        <CorpoDaFolhaDeOpcoes
          id="f"
          product={{ id: "p", name: "Camisa", price: 10, images: [] } as never}
          modelo={modelo}
          escolhas={new Map()}
          eixoAberto={eixo.chave}
          aviso={null}
          imagem=""
          preco={10}
          estoque={20}
          quantidade={1}
          indisponivel={false}
          cartStatus="idle"
          avisoDeAdicionado=""
          onAbrirEixo={() => {}}
          onEscolher={() => {}}
          onQuantidade={() => {}}
          onAdicionar={() => {}}
          onDetalhes={() => {}}
        />
      </FolhaDeOpcoes>,
    );
  });
  const painel = document.getElementById(`f-${eixo.chave}`)!;
  return [...painel.querySelectorAll("button[aria-pressed]")].map(
    (b) => (b.getAttribute("aria-label") ?? "").split(",")[0],
  );
}

const daPagina = (variantes: ProductVariant[], nome: string) =>
  fileirasDeVariacao(variantes)
    .fileiras.find((f) => f.nome === nome)!
    .valores.map((v) => v.valor);

describe("FolhaDeOpcoes: os tamanhos saem na ordem da página do produto", () => {
  it("letras cadastradas fora de ordem aparecem P, M, G, GG", () => {
    const variantes = doTamanho(["GG", "P", "G", "M"]);
    expect(valoresDoEixo(variantes, "Tamanho")).toEqual(["P", "M", "G", "GG"]);
  });

  it("números saem em ordem de número (não de texto) e Único vai para o fim", () => {
    const variantes = doTamanho(["10", "9", "Único", "8"]);
    expect(valoresDoEixo(variantes, "Tamanho")).toEqual([
      "8",
      "9",
      "10",
      "Único",
    ]);
  });

  it("é exatamente a ordem que a página mostra, também em grade Cor / Tamanho", () => {
    const variantes = [
      variante("Cor / Tamanho", "Verde / GG"),
      variante("Cor / Tamanho", "Azul / P"),
      variante("Cor / Tamanho", "Verde / G"),
      variante("Cor / Tamanho", "Azul / M"),
    ];
    const naFolha = valoresDoEixo(variantes, "Tamanho");
    expect(naFolha).toEqual(["P", "M", "G", "GG"]);
    expect(naFolha).toEqual(daPagina(variantes, "Tamanho"));
  });

  it("o eixo de cor mantém a ordem do cadastro", () => {
    const variantes = [
      variante("Cor / Tamanho", "Verde / P"),
      variante("Cor / Tamanho", "Azul / P"),
      variante("Cor / Tamanho", "Preto / P"),
    ];
    expect(valoresDoEixo(variantes, "Cor")).toEqual(["Verde", "Azul", "Preto"]);
  });
});
