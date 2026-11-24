// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território "estoque na vitrine". A linha de
// estoque da folha "Escolher opções" do cartão (o "• Restam apenas 3!" ao lado
// do preço) não era vigiada em NENHUM limite: trocar `estoque <= 0` por
// `< 0`, ou `estoque <= 5` por `< 5`, passava em todos os testes. Quem abre a
// folha de um produto cujas opções acabaram (estoque 0) passaria a ler "Restam
// apenas 0!" em vez de "Esgotado".
//
// Aqui o limite vale para a frase E para a cor, no corpo da folha:
//  - 0: "Esgotado", em cinza;
//  - 1: "Resta apenas 1!" (singular), 2 e 5: "Restam apenas N!", em rosa;
//  - 6 e 20: "Estoque: N", em verde.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CorpoDaFolhaDeOpcoes,
  FolhaDeOpcoes,
} from "@/components/ui/custom/FolhaDeOpcoes";
import type { ProductVariant } from "@/types";
import { criarEixosDaVariacao } from "@/utils/eixos-da-variacao";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "local" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variante = (value: string, stockIncrement: number): ProductVariant => ({
  id: value,
  productId: "p",
  name: "Tamanho",
  value,
  stockIncrement,
  active: true,
});

const modelo = criarEixosDaVariacao([variante("P", 5), variante("M", 5)]);

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

function abrirComEstoque(estoque: number) {
  act(() => {
    raiz.render(
      <FolhaDeOpcoes aberta onMudar={() => {}}>
        <CorpoDaFolhaDeOpcoes
          id="f"
          product={{ id: "p", name: "Camisa", price: 10, images: [] } as never}
          modelo={modelo}
          escolhas={new Map()}
          eixoAberto={null}
          aviso={null}
          imagem=""
          preco={10}
          estoque={estoque}
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
}

/** O span da linha de estoque: o único com o marcador "• " na frente. */
function linhaDeEstoque(): HTMLElement {
  const achados = Array.from(document.querySelectorAll("span")).filter((s) =>
    (s.textContent ?? "").startsWith("• "),
  );
  // O span externo (frase + marcador) é o último a conter o marcador.
  const externo = achados.find((s) => s.querySelector('[aria-hidden="true"]'));
  expect(externo).toBeDefined();
  return externo as HTMLElement;
}

const frase = () => (linhaDeEstoque().textContent ?? "").replace("• ", "");

describe("FolhaDeOpcoes: a linha de estoque muda exatamente nos limites", () => {
  it("estoque 0 diz 'Esgotado' em cinza, nunca 'Restam apenas 0!'", () => {
    abrirComEstoque(0);
    expect(frase()).toBe("Esgotado");
    expect(linhaDeEstoque().classList.contains("text-zinc-500")).toBe(true);
    expect(document.body.textContent).not.toMatch(/Restam? apenas/);
  });

  it.each([
    [1, "Resta apenas 1!"],
    [2, "Restam apenas 2!"],
    [5, "Restam apenas 5!"],
  ])("estoque %i diz '%s' em rosa", (estoque, esperado) => {
    abrirComEstoque(estoque);
    expect(frase()).toBe(esperado);
    expect(linhaDeEstoque().classList.contains("text-rose-600")).toBe(true);
  });

  it.each([
    [6, "Estoque: 6"],
    [20, "Estoque: 20"],
  ])(
    "estoque %i diz '%s' em verde, sem aviso de pouca unidade",
    (estoque, esperado) => {
      abrirComEstoque(estoque);
      expect(frase()).toBe(esperado);
      expect(linhaDeEstoque().classList.contains("text-emerald-700")).toBe(
        true,
      );
      expect(linhaDeEstoque().classList.contains("text-rose-600")).toBe(false);
    },
  );
});
