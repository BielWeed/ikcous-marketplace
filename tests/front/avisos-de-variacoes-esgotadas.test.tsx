// @vitest-environment jsdom

import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import { variacoesEsgotadas } from "@/lib/variacoes-esgotadas";
import type { Product, ProductVariant } from "@/types";
import type { PainelInicio } from "@/types/painel";
import { montarAvisos } from "@/utils/avisos-do-lojista";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let produtos: Product[] = [];
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A implementação ausente deixa o cenário real sem os tamanhos P e M.
const produto = (estoques: number[], isActive = true): Product => ({
  id: "rosa",
  name: "Rosa choque",
  isActive,
  stock: estoques.reduce((a, b) => a + b, 0),
  description: "",
  price: 20,
  images: [],
  category: "Roupas",
  sold: 0,
  isBestseller: false,
  freeShipping: false,
  createdAt: "",
  variants: estoques.map(
    (stockIncrement, i): ProductVariant => ({
      id: String(i),
      productId: "rosa",
      name: "Tamanho",
      value: ["P", "M", "G", "GG", "XG", "XXG"].at(i) ?? "",
      active: true,
      stockIncrement,
    }),
  ),
});
const painel = {
  pendencias: {
    pedidosParaPreparar: 1,
    devolucoesAbertas: 0,
    estoqueBaixo: 1,
    caixaAberto: false,
  },
  contasVencidas: 0,
} as PainelInicio;

describe("variações esgotadas: cálculo puro", () => {
  it("seleciona P e M sem confundir estoque baixo com zero", () => {
    expect(
      variacoesEsgotadas([produto([0, 0, 20])]).map((a) => a.texto),
    ).toEqual([
      "Rosa choque — Tamanho P esgotou",
      "Rosa choque — Tamanho M esgotou",
    ]);
    expect(variacoesEsgotadas([produto([1, 3, 20])])).toEqual([]);
  });
  it("variação única zerada continua só no aviso antigo", () => {
    expect(variacoesEsgotadas([produto([0])])).toEqual([]);
    const antigo = montarAvisos({
      pedidos: [],
      perguntasPendentes: 0,
      avaliacoes: [],
      produtos: [
        {
          id: "rosa",
          name: "Rosa choque",
          stock: 0,
          estoqueMinimo: null,
          created_at: "",
        },
      ],
    });
    expect(antigo).toHaveLength(1);
    expect(antigo[0].tipo).toBe("estoque");
    expect(antigo[0].contaNoCracha).toBe(false);
  });
  it.each(["arquivado", "rascunho"])(
    "ignora produto %s (isActive=false)",
    () => {
      expect(variacoesEsgotadas([produto([0, 20], false)])).toEqual([]);
    },
  );
  it("ignora variação desativada e leitura incompleta", () => {
    const p = produto([0, 2, 20]);
    p.variants![0].active = false;
    expect(variacoesEsgotadas([p])).toEqual([]);
    expect(
      variacoesEsgotadas([{ ...produto([0, 20]), variantsUnavailable: true }]),
    ).toEqual([]);
  });
  it("aceita lista vazia, ausente e produto sem grade", () => {
    expect(variacoesEsgotadas()).toEqual([]);
    expect(variacoesEsgotadas([])).toEqual([]);
    expect(
      variacoesEsgotadas([{ ...produto([]), variants: undefined }]),
    ).toEqual([]);
  });
  it("reutiliza o rótulo das combinações da ficha", () => {
    const p = produto([0, 20]);
    p.variants![0].name = "Cor / Tamanho";
    p.variants![0].value = "Azul / M";
    expect(variacoesEsgotadas([p])[0].texto).toBe(
      "Rosa choque — Cor Azul · Tamanho M esgotou",
    );
  });
});

describe("aviso discreto no fim de Para fazer", () => {
  it("mostra P e M esgotados mesmo com G=20", () => {
    produtos = [produto([0, 0, 20])];
    const html = renderToStaticMarkup(
      <ParaFazer
        painel={painel}
        carregando={false}
        onNavigate={vi.fn()}
        produtos={produtos}
      />,
    );
    expect(html).toContain("Rosa choque — Tamanho P esgotou");
    expect(html).toContain("Rosa choque — Tamanho M esgotou");
    expect(html.indexOf("Repor em Produtos")).toBeLessThan(
      html.indexOf("Tamanho P esgotou"),
    );
    expect(html).toContain("O produto ainda tem estoque nas outras variações.");
  });
  it("exatamente três variações esgotadas mostra todas sem dizer e mais", () => {
    const html = renderToStaticMarkup(
      <ParaFazer
        painel={painel}
        carregando={false}
        onNavigate={vi.fn()}
        produtos={[produto([0, 0, 0, 20])]}
      />,
    );
    expect(html.match(/ esgotou/g)).toHaveLength(3);
    expect(html).toContain("Tamanho P esgotou");
    expect(html).toContain("Tamanho M esgotou");
    expect(html).toContain("Tamanho G esgotou");
    expect(html).not.toContain("e mais");
  });
  it("limita a três detalhes e informa as duas restantes", () => {
    const html = renderToStaticMarkup(
      <ParaFazer
        painel={painel}
        carregando={false}
        onNavigate={vi.fn()}
        produtos={[produto([0, 0, 0, 0, 0, 20])]}
      />,
    );
    expect(html.match(/ esgotou/g)).toHaveLength(3);
    expect(html).toContain("e mais 2");
    expect(html).not.toContain("Tamanho GG esgotou");
  });
  it("os avisos antigos e sua contagem ficam idênticos", () => {
    const antes = renderToStaticMarkup(
      <ParaFazer painel={painel} carregando={false} onNavigate={vi.fn()} />,
    );
    const depois = renderToStaticMarkup(
      <ParaFazer
        painel={painel}
        carregando={false}
        onNavigate={vi.fn()}
        produtos={[produto([1, 20])]}
      />,
    );
    expect(depois).toBe(antes);
    const comEsgotada = renderToStaticMarkup(
      <ParaFazer
        painel={painel}
        carregando={false}
        onNavigate={vi.fn()}
        produtos={[produto([0, 20])]}
      />,
    );
    expect(comEsgotada).toContain("2 pendências");
    expect(comEsgotada).toContain(antes.split("<ul")[1].split("</ul>")[0]);
  });
  it("não diz Tudo em dia quando só uma numeração está esgotada", () => {
    const semPendencias = {
      ...painel,
      pendencias: {
        ...painel.pendencias,
        pedidosParaPreparar: 0,
        estoqueBaixo: 0,
      },
    };
    const html = renderToStaticMarkup(
      <ParaFazer
        painel={semPendencias}
        carregando={false}
        onNavigate={vi.fn()}
        produtos={[produto([0, 20])]}
      />,
    );
    expect(html).not.toContain("Tudo em dia");
    expect(html).toContain("Tamanho P esgotou");
  });
  it("não afirma que há outros tamanhos em estoque quando todos zeraram", () => {
    const avisos = variacoesEsgotadas([produto([0, 0])]);
    expect(avisos).toHaveLength(2);
    expect(avisos[0].detalhe).toBe(
      "Todas as variações ativas estão esgotadas.",
    );
  });
  it("o toque abre a ficha do produto, não a lista filtrada", async () => {
    const navegar = vi.fn();
    const tela = document.createElement("div");
    const raiz = createRoot(tela);
    try {
      await act(async () =>
        raiz.render(
          <ParaFazer
            painel={painel}
            carregando={false}
            onNavigate={navegar}
            produtos={[produto([0, 20])]}
          />,
        ),
      );
      const botao = Array.from(tela.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Tamanho P esgotou"),
      );
      expect(botao).toBeDefined();
      await act(async () => botao!.click());
      expect(navegar).toHaveBeenLastCalledWith("admin-products", "rosa");
    } finally {
      await act(async () => raiz.unmount());
    }
  });
});
