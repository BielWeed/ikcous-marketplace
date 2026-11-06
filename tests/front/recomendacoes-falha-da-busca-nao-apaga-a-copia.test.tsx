// @vitest-environment jsdom
//
// "Você também pode gostar": quando a função do banco dava erro, o buscador
// caía num plano B que filtra a lista local — vazia na página da cliente — e
// devolvia [] como se fosse resposta. O hook tratava [] como "sem
// recomendações": limpava a lista da tela e APAGAVA a cópia boa (memória +
// aparelho), e a seção sumia por causa de uma falha de rede.
//
// Aqui: falha de busca NÃO é "sem recomendações". Mantém o que está na tela e a
// cópia guardada; resposta vazia de verdade continua apagando a cópia (a loja
// pode ter ficado sem sugestões) e erro sem cópia continua escondendo a seção.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "ikcous_recs_v2_cache_prod-falha";

const produto = (id: string) =>
  ({ id, name: `Produto ${id}`, price: 10 }) as unknown as Product;

type Estado = {
  recomendacoes: Product[];
  carregando: boolean;
  consultado: boolean;
};

describe("useRecomendacoesDeProduto — falha da busca não é 'sem recomendações'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  type HookMod = typeof import("@/hooks/useRecomendacoesDeProduto");
  let useRecomendacoesDeProduto: HookMod["useRecomendacoesDeProduto"];

  beforeEach(async () => {
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    ({ useRecomendacoesDeProduto } = await import(
      "@/hooks/useRecomendacoesDeProduto"
    ));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(buscar: (id: string) => Promise<Product[]>) {
    const aoAtualizar = vi.fn<(estado: Estado) => void>();
    function Prova() {
      aoAtualizar(useRecomendacoesDeProduto("prod-falha", true, buscar));
      return null;
    }
    await act(async () => {
      raiz.render(<Prova />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return aoAtualizar.mock.calls.at(-1)![0];
  }

  it("busca falha com cópia guardada: a lista continua e a cópia NÃO é apagada", async () => {
    armazem.set(CHAVE, JSON.stringify([produto("c1"), produto("c2")]));
    // Hook novo lê o aparelho com a cópia já gravada.
    vi.resetModules();
    ({ useRecomendacoesDeProduto } = await import(
      "@/hooks/useRecomendacoesDeProduto"
    ));
    const buscar = vi.fn(async (_id: string): Promise<Product[]> => {
      throw new Error("rede caiu");
    });

    const ultimo = await montar(buscar);

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(ultimo.recomendacoes.map((p) => p.id)).toEqual(["c1", "c2"]);
    expect(ultimo.carregando).toBe(false);
    expect(ultimo.consultado).toBe(true);
    expect(JSON.parse(armazem.get(CHAVE)!).map((p: Product) => p.id)).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("busca responde [] de verdade com cópia guardada: grava [] como hoje (apaga a cópia)", async () => {
    armazem.set(CHAVE, JSON.stringify([produto("c1")]));
    vi.resetModules();
    ({ useRecomendacoesDeProduto } = await import(
      "@/hooks/useRecomendacoesDeProduto"
    ));
    const buscar = vi.fn(async (_id: string) => [] as Product[]);

    const ultimo = await montar(buscar);

    expect(ultimo.recomendacoes).toEqual([]);
    expect(ultimo.consultado).toBe(true);
    expect(armazem.get(CHAVE)).toBeUndefined();
  });

  it("busca falha sem cópia: seção some como hoje (lista vazia, consultado, sem cópia gravada)", async () => {
    const buscar = vi.fn(async (_id: string): Promise<Product[]> => {
      throw new Error("rede caiu");
    });

    const ultimo = await montar(buscar);

    expect(ultimo.recomendacoes).toEqual([]);
    expect(ultimo.carregando).toBe(false);
    expect(ultimo.consultado).toBe(true);
    expect(armazem.get(CHAVE)).toBeUndefined();
  });
});
