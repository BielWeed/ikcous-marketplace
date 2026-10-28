// @vitest-environment jsdom
//
// Lote 255: textos que a pessoa lia errado ("Máximo de 1 unidades") e botões
// sem nome para leitor de tela (setas da prévia do celular).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CorpoDaFolhaDeOpcoes,
  FolhaDeOpcoes,
} from "@/components/ui/custom/FolhaDeOpcoes";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "local" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function folha(estoque: number) {
  act(() => {
    raiz.render(
      <FolhaDeOpcoes aberta onMudar={() => {}}>
        <CorpoDaFolhaDeOpcoes
          id="f"
          product={{ id: "p", name: "Camisa", price: 10, images: [] } as never}
          modelo={{ eixos: [] } as never}
          escolhas={new Map()}
          eixoAberto={null}
          aviso={null}
          imagem=""
          preco={10}
          estoque={estoque}
          quantidade={estoque}
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

describe("FolhaDeOpcoes — limite de estoque concorda com o número", () => {
  it("1 peça: 'Só tem 1 unidade em estoque.'", () => {
    folha(1);
    expect(document.body.textContent).toContain("Só tem 1 unidade em estoque.");
    expect(document.body.textContent).not.toContain("1 unidades");
  });

  it("3 peças: 'Máximo de 3 unidades'", () => {
    folha(3);
    expect(document.body.textContent).toContain("Máximo de 3 unidades");
  });
});

describe("PhoneSimulator — setas da galeria têm nome", () => {
  it("anterior e próxima foto aparecem pelo nome", async () => {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );
    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={
            {
              name: "Produto",
              description: "d",
              price: "100",
              costPrice: "50",
              originalPrice: "",
              stock: "10",
              category: "geral",
              images: ["/a.png", "/b.png"],
              freeShipping: false,
              isBestseller: false,
              isActive: true,
              variants: [],
            } as never
          }
          previewMode="page"
          setPreviewMode={() => {}}
          previewImgIndex={0}
          setPreviewImgIndex={() => {}}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={() => {}}
          activeDetailTab="description"
          setActiveDetailTab={() => {}}
        />,
      );
    });
    expect(
      document.body.querySelector('[aria-label="Foto anterior"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector('[aria-label="Próxima foto"]'),
    ).not.toBeNull();
  });
});
