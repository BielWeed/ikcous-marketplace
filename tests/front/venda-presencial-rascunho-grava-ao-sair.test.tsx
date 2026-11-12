// @vitest-environment jsdom
//
// O rascunho do balcão é gravado com um pequeno atraso (para não escrever a
// cada letra). Antes, se a lojista saísse da tela DENTRO desse atraso, o
// último bipe ficava só na memória e sumia: a tela diz "a venda fica guardada
// e volta ao reabrir", e esse bipe não voltava. Agora, ao sair (a tela fecha
// ou a página é escondida/fechada), o que está pendente é gravado na hora.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type VendaPresencialEmUso,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "admin_pdv_venda_draft:lojista-1";

function armazenamentoEmMemoria() {
  const mapa = new Map<string, string>();
  return {
    mapa,
    getItem: (chave: string) => mapa.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      mapa.set(chave, valor);
    },
    removeItem: (chave: string) => {
      mapa.delete(chave);
    },
  };
}

function Sonda({
  armazenamento,
  aoAtualizar,
}: {
  readonly armazenamento: ReturnType<typeof armazenamentoEmMemoria>;
  readonly aoAtualizar: (venda: VendaPresencialEmUso) => void;
}) {
  const venda = useVendaPresencial({
    armazenamento,
    userId: "lojista-1",
    gerarChave: () => "chave-fixa",
    // Longo de propósito: nenhum teste depende de o relógio chegar lá.
    atrasoDeGravacaoMs: 60_000,
  });
  aoAtualizar(venda);
  return null;
}

const ITEM = {
  chave: "prod-1::",
  productId: "prod-1",
  variantId: null,
  nome: "Caneca",
  variacao: null,
  preco: 10,
  quantidade: 1,
  estoque: 5,
  imagem: "",
} as const;

function itensGravados(
  armazenamento: ReturnType<typeof armazenamentoEmMemoria>,
): number {
  const bruto = armazenamento.mapa.get(CHAVE);
  if (!bruto) return 0;
  return (JSON.parse(bruto) as { itens: unknown[] }).itens.length;
}

describe("rascunho do balcão — grava o que está pendente ao sair", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // A sonda só ANOTA cada render (chamada de mock); o teste lê a última.
  const aoAtualizar = vi.fn<(v: VendaPresencialEmUso) => void>();
  const venda = () => aoAtualizar.mock.calls.at(-1)?.[0];

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    aoAtualizar.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    hospedeiro.remove();
  });

  async function montarComUmaPeca(
    armazenamento: ReturnType<typeof armazenamentoEmMemoria>,
  ) {
    await act(async () => {
      raiz.render(
        <Sonda armazenamento={armazenamento} aoAtualizar={aoAtualizar} />,
      );
    });
    await act(async () => {
      venda()?.despachar({
        tipo: "item_adicionado_manualmente",
        item: ITEM,
        em: 1,
      });
    });
  }

  it("sair da tela logo depois de bipar não perde a peça", async () => {
    const armazenamento = armazenamentoEmMemoria();
    await montarComUmaPeca(armazenamento);
    expect(venda()?.estado.itens).toHaveLength(1);
    // Ainda dentro do atraso: nada foi para o aparelho.
    expect(itensGravados(armazenamento)).toBe(0);

    await act(async () => {
      raiz.unmount();
    });

    expect(itensGravados(armazenamento)).toBe(1);
  });

  it("fechar ou esconder a página logo depois de bipar não perde a peça", async () => {
    const armazenamento = armazenamentoEmMemoria();
    await montarComUmaPeca(armazenamento);
    expect(itensGravados(armazenamento)).toBe(0);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(itensGravados(armazenamento)).toBe(1);
    await act(async () => {
      raiz.unmount();
    });
  });

  it("cupom sem nada (esvaziado antes de sair) não deixa rascunho para trás", async () => {
    const armazenamento = armazenamentoEmMemoria();
    await montarComUmaPeca(armazenamento);
    await act(async () => {
      venda()?.limparCupom();
    });
    await act(async () => {
      raiz.unmount();
    });

    expect(armazenamento.mapa.has(CHAVE)).toBe(false);
  });

  it("vale a última edição: duas edições seguidas dentro do atraso gravam a segunda", async () => {
    const armazenamento = armazenamentoEmMemoria();
    await montarComUmaPeca(armazenamento);
    await act(async () => {
      venda()?.despachar({
        tipo: "item_adicionado_manualmente",
        item: { ...ITEM, chave: "prod-2::", productId: "prod-2" },
        em: 2,
      });
    });
    await act(async () => {
      raiz.unmount();
    });

    expect(itensGravados(armazenamento)).toBe(2);
  });
});
