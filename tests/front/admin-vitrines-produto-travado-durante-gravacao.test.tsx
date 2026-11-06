// @vitest-environment jsdom
//
// Vitrines (painel): enquanto uma gravação corre, o toque num segundo produto
// era descartado em silêncio pela view (a lista inteira é regravada de uma vez
// e só uma gravação sai por vez). Os botões de quantidade e Automático/Escolher
// já ficavam desabilitados; os da lista de produtos não, e a lojista achava que
// tinha marcado os dois.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { FolhaEditarVitrine } = await import(
  "@/components/admin/vitrines/FolhaEditarVitrine"
);

const SECAO = {
  id: "custom_1",
  title: "Kits de presente",
  active: true,
  maxItems: 6,
  productIds: [],
  isCustom: true,
};

const PRODUTOS = [
  { id: "p1", name: "Produto A", price: 10, images: [], isActive: true },
  { id: "p2", name: "Produto B", price: 20, images: [], isActive: true },
] as never[];

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function abrirFolha(travado: boolean, aoAlternarProduto = vi.fn()) {
  await act(async () => {
    raiz.render(
      <FolhaEditarVitrine
        secao={SECAO}
        posicao={1}
        produtos={PRODUTOS}
        idsEmExibicao={[]}
        aoFechar={() => {}}
        aoRenomear={async () => true}
        aoMudarQuantidade={() => {}}
        aoAlternarProduto={aoAlternarProduto}
        aoVoltarAoAutomatico={() => {}}
        aoEscolherManualmente={() => {}}
        travado={travado}
      />,
    );
  });
}

const botoesDeProduto = () => [
  ...document.querySelectorAll<HTMLButtonElement>("button[data-produto-id]"),
];

describe("Folha de editar vitrine: produtos durante a gravação", () => {
  it("com gravação em andamento, os botões de produto ficam desabilitados", async () => {
    await abrirFolha(true);
    expect(botoesDeProduto()).toHaveLength(2);
    for (const b of botoesDeProduto()) expect(b.disabled).toBe(true);
  });

  it("sem gravação, os botões de produto ficam ligados e o toque chega à view", async () => {
    const aoAlternarProduto = vi.fn();
    await abrirFolha(false, aoAlternarProduto);
    for (const b of botoesDeProduto()) expect(b.disabled).toBe(false);
    await act(async () => {
      botoesDeProduto()[1].click();
    });
    expect(aoAlternarProduto).toHaveBeenCalledWith("p2");
  });
});
