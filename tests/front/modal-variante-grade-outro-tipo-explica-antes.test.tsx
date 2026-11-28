// @vitest-environment jsdom
//
// Produto que já varia por um tipo (ex.: só Tamanho P, M, G) e a lojista quer
// acrescentar Cor. A trava de um tipo por produto (`um-grupo-de-variacao.ts`)
// recusa no "Gerar", DEPOIS de ela montar o segundo atributo inteiro. Agora o
// "+ Adicionar outro atributo" nem aparece nesse produto: no lugar dele, a
// grade explica ANTES o caminho que funciona (excluir as opções e gerar de
// novo com os dois; a vendida não sai, e aí é produto novo).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalVarianteGrade } from "@/components/admin/products/ModalVarianteGrade";
import type { ProductVariant } from "@/types";

const { toast } = vi.hoisted(() => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const tamanho = (id: string, valor: string): ProductVariant => ({
  id,
  productId: "prod-1",
  name: "Tamanho",
  value: valor,
  stockIncrement: 2,
  active: true,
});

function montar(existentes: ProductVariant[], grupoUnicoEmUso: string | null) {
  act(() => {
    root.render(
      <ModalVarianteGrade
        aberto
        onFechar={vi.fn()}
        variantesExistentes={existentes}
        sugestoesDeAtributo={["Tamanho"]}
        grupoUnicoEmUso={grupoUnicoEmUso}
        skusDaLoja={[]}
        precoDoProduto=""
        onEfetivar={() => true}
      />,
    );
  });
}

const temBotaoDeOutroAtributo = () =>
  [...document.body.querySelectorAll("button")].some((b) =>
    (b.textContent ?? "").includes("Adicionar outro atributo"),
  );
const explicacao = () =>
  document.body.querySelector('[data-testid="outro-tipo-de-variacao"]')
    ?.textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("grade em produto que já usa um tipo: explica antes, não recusa depois", () => {
  it("tamanhos já salvos: sem '+ Adicionar outro atributo', com o caminho real e a saída da vendida", () => {
    montar(
      [tamanho("v1", "P"), tamanho("v2", "M"), tamanho("v3", "G")],
      "Tamanho",
    );
    expect(temBotaoDeOutroAtributo()).toBe(false);
    expect(explicacao()).toContain('já varia por "Tamanho"');
    expect(explicacao()).toContain("tamanho e cor juntos");
    expect(explicacao()).toContain("exclua as opções");
    expect(explicacao()).toContain("crie um produto novo");
  });

  it("tamanhos ainda não salvos: o caminho real, sem falar de venda", () => {
    montar(
      [tamanho("temp-1", "P"), tamanho("temp-2", "M"), tamanho("temp-3", "G")],
      "Tamanho",
    );
    expect(temBotaoDeOutroAtributo()).toBe(false);
    expect(explicacao()).toContain("exclua as opções");
    expect(explicacao()).not.toContain("vendida");
  });

  it("produto sem variação: o botão continua e não há explicação", () => {
    montar([], null);
    expect(temBotaoDeOutroAtributo()).toBe(true);
    expect(explicacao()).toBe("");
  });
});
