// @vitest-environment jsdom
//
// Editar vitrine em loja sem produtos dizia "Nenhum produto encontrado na
// busca" sem ninguém ter buscado. Três casos: catálogo vazio, busca sem
// resultado e lista com produtos (sem frase de vazio).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
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
  productIds: [] as string[],
  isCustom: true,
};

const produto = (id: string, name: string) =>
  ({
    id,
    name,
    category: "Geral",
    price: 10,
    images: [],
  }) as unknown as Product;

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

async function abrirFolha(produtos: Product[], secao = SECAO) {
  await act(async () => {
    raiz.render(
      <FolhaEditarVitrine
        secao={secao}
        posicao={1}
        produtos={produtos}
        idsEmExibicao={[]}
        aoFechar={() => {}}
        aoRenomear={async () => true}
        aoMudarQuantidade={() => {}}
        aoAlternarProduto={() => {}}
        aoVoltarAoAutomatico={() => {}}
        aoEscolherManualmente={() => {}}
      />,
    );
  });
}

async function digitarBusca(texto: string) {
  const campo = document.querySelector<HTMLInputElement>(
    'input[aria-label="Buscar produto"]',
  )!;
  const atribuir = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    atribuir?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const tela = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

describe("FolhaEditarVitrine — vazios", () => {
  it("catálogo grande: abre em lotes, busca no catálogo inteiro e volta ao primeiro lote", async () => {
    const produtos = Array.from({ length: 300 }, (_, i) =>
      produto(`p-${i}`, `Produto ${i}`),
    );
    await abrirFolha(produtos);
    const botoes = () => document.querySelectorAll("button[data-produto-id]");
    expect(botoes()).toHaveLength(60);
    expect(tela()).toContain("Mostrando 60 de 300");
    const mais = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Mostrar mais",
    )!;
    await act(async () => mais.click());
    expect(botoes()).toHaveLength(120);
    await digitarBusca("Produto 299");
    expect(botoes()).toHaveLength(1);
    expect(botoes()[0].getAttribute("data-produto-id")).toBe("p-299");
    await digitarBusca("");
    expect(botoes()).toHaveLength(60);
  });

  it("catálogo vazio: diz que não há produtos cadastrados, sem falar de busca", async () => {
    await abrirFolha([]);
    expect(tela()).toContain(
      "Nenhum produto cadastrado ainda. Cadastre o primeiro em Produtos.",
    );
    expect(tela()).not.toContain("encontrado na busca");
    expect(tela()).toContain("Sua loja ainda não tem produtos");
    expect(tela()).not.toContain("Toque em um produto");
  });

  it("catálogo vazio e alguém digita: continua falando do catálogo", async () => {
    await abrirFolha([]);
    await digitarBusca("caneca");
    expect(tela()).toContain("Nenhum produto cadastrado ainda");
    expect(tela()).not.toContain("encontrado na busca");
  });

  it("busca sem resultado com produtos cadastrados: mantém 'Nenhum produto encontrado na busca.'", async () => {
    await abrirFolha([produto("p-1", "Caneca azul")]);
    await digitarBusca("zzz");
    expect(tela()).toContain("Nenhum produto encontrado na busca.");
    expect(tela()).not.toContain("Nenhum produto cadastrado ainda");
  });

  it("com produtos e sem busca: nenhuma frase de vazio, e o produto aparece", async () => {
    await abrirFolha([produto("p-1", "Caneca azul")]);
    expect(tela()).toContain("Caneca azul");
    expect(tela()).not.toContain("Nenhum produto encontrado");
    expect(tela()).not.toContain("Nenhum produto cadastrado");
  });
});
