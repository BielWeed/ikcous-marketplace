// @vitest-environment jsdom
//
// Auditoria de acessibilidade (06/11/2026): na folha "Escolher opções" do card,
// o botão de cada opção tinha aria-label só com o valor ("PP"). O motivo de
// esgotado / indisponível ficava em `title` e o risco era só visual, então
// quem usa leitor de tela não sabia o que estava apagado. Mesma fala de
// FileirasDeVariacao: o estado vai no nome do botão.
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
  name: "Cor / Tamanho",
  value,
  stockIncrement,
  active: true,
});

// Com Cor = Verde escolhida, no eixo Tamanho:
//   PP -> existe só em Azul/Preto: indisponível com a escolha (mas tocável)
//   M  -> Verde/M tem 1 peça: última unidade
//   G  -> Verde/G tem 5: normal
//   GG -> sem estoque em nenhuma cor: esgotado de vez
const modelo = criarEixosDaVariacao([
  variante("Azul / PP", 5),
  variante("Verde / PP", 0),
  variante("Verde / M", 1),
  variante("Verde / G", 5),
  variante("Azul / GG", 0),
]);

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

function abrirTamanhoComVerde() {
  const tamanho = modelo.eixos.find((e) => e.nome === "Tamanho")!;
  const cor = modelo.eixos.find((e) => e.nome === "Cor")!;
  act(() => {
    raiz.render(
      <FolhaDeOpcoes aberta onMudar={() => {}}>
        <CorpoDaFolhaDeOpcoes
          id="f"
          product={{ id: "p", name: "Camisa", price: 10, images: [] } as never}
          modelo={modelo}
          escolhas={new Map([[cor.chave, "Verde"]])}
          eixoAberto={tamanho.chave}
          aviso={null}
          imagem=""
          preco={10}
          estoque={6}
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

const botoesDasOpcoes = () =>
  [
    ...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  ].filter((b) => /^(PP|M|G|GG)\b/.test(b.getAttribute("aria-label") ?? ""));

describe("FolhaDeOpcoes: o nome do botão da opção diz o estado", () => {
  it("esgotado, indisponível com a escolha e última unidade falam; a opção normal fica só com o valor", () => {
    abrirTamanhoComVerde();
    expect(botoesDasOpcoes().map((b) => b.getAttribute("aria-label"))).toEqual([
      "PP, indisponível com a sua escolha. Toque para trocar",
      "M, última unidade",
      "G",
      "GG, esgotado",
    ]);
  });

  it("o aviso da folha não depende de enxergar o risco", () => {
    abrirTamanhoComVerde();
    const texto = document.body.textContent ?? "";
    expect(texto).toContain(
      "Opções indisponíveis em Verde aparecem como indisponíveis com a sua escolha. Toque para trocar a combinação.",
    );
    expect(texto).not.toContain("Riscado");
  });
});
