// @vitest-environment jsdom
//
// Defeito reportado pelo Gabriel em 01/09 (prova de rua na loja): na página
// de produto, "Você também pode gostar" ficava em SKELETON PARA SEMPRE na
// maioria dos produtos.
//
// O mecanismo (laudo interno da frente): `fetchRecommendations` é
// useCallback([products]) — muda de identidade a cada troca da lista de
// produtos do contexto — e era DEPENDÊNCIA do efeito de carga. A cada
// re-render com lista nova, o efeito re-rodava, o cleanup matava a busca
// anterior (isMounted=false) e o cache nunca chegava a gravar: carregando
// true, eternamente.
//
// O conserto é o hook `useRecomendacoesDeProduto`: o buscador vai por REF
// (re-render não re-dispara a busca; só produto novo ou seção ficando
// visível) e o resultado vazio é DISTINGUÍVEL de "carregando" — é o que
// deixa a página esconder a seção em vez de mostrar título com grid vazio.
//
// Este teste prende exatamente as duas garantias:
// 1. buscador instável + re-renders = UMA busca só, e ela conclui;
// 2. fim de carga distinguível (consultado=true) com lista vazia ou cheia.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

const produto = (id: string) =>
  ({ id, name: `Produto ${id}`, price: 10 }) as unknown as Product;

describe("useRecomendacoesDeProduto — a busca não morre no re-render", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  type HookMod = typeof import("@/hooks/useRecomendacoesDeProduto");
  let useRecomendacoesDeProduto: HookMod["useRecomendacoesDeProduto"];

  beforeEach(async () => {
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
    vi.restoreAllMocks();
  });

  /** Hospedeiro que recria o BUSCADOR a cada render (a instabilidade que o
   * useCallback([products]) produzia) e re-renderiza quando algo muda. */
  function Prova({
    buscar,
    visivel,
    aoAtualizar,
    gatilho,
  }: {
    buscar: (id: string) => Promise<Product[]>;
    visivel: boolean;
    aoAtualizar: (estado: {
      recomendacoes: Product[];
      carregando: boolean;
      consultado: boolean;
    }) => void;
    gatilho: number;
  }) {
    const estado = useRecomendacoesDeProduto("prod-1", visivel, buscar);
    aoAtualizar(estado);
    return <div data-gatilho={gatilho} />;
  }

  it("buscador instável + re-renders: UMA busca, e ela conclui", async () => {
    const buscar = vi.fn(async (_id: string) => [produto("r1"), produto("r2")]);
    const aoAtualizar = vi.fn();

    await act(async () => {
      raiz.render(
        <Prova
          buscar={buscar}
          visivel={true}
          aoAtualizar={aoAtualizar}
          gatilho={0}
        />,
      );
    });

    // Quatro re-renders com buscador NOVO a cada um — o padrão que matava
    // a busca no código antigo.
    for (const gatilho of [1, 2, 3, 4]) {
      await act(async () => {
        raiz.render(
          <Prova
            buscar={(id) => buscar(id)}
            visivel={true}
            aoAtualizar={aoAtualizar}
            gatilho={gatilho}
          />,
        );
      });
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(buscar).toHaveBeenCalledTimes(1);
    const ultimo = aoAtualizar.mock.calls.at(-1)![0];
    expect(ultimo.carregando).toBe(false);
    expect(ultimo.consultado).toBe(true);
    expect(ultimo.recomendacoes.map((p: Product) => p.id)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("busca termina VAZIA: consultado=true com lista vazia (a seção pode se esconder)", async () => {
    const buscar = vi.fn(async (_id: string) => []);
    const aoAtualizar = vi.fn();

    await act(async () => {
      raiz.render(
        <Prova
          buscar={buscar}
          visivel={true}
          aoAtualizar={aoAtualizar}
          gatilho={0}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const ultimo = aoAtualizar.mock.calls.at(-1)![0];
    expect(ultimo.consultado).toBe(true);
    expect(ultimo.carregando).toBe(false);
    expect(ultimo.recomendacoes).toEqual([]);
  });

  it("seção invisível não busca nada", async () => {
    const buscar = vi.fn(async (_id: string) => [produto("r1")]);

    await act(async () => {
      raiz.render(
        <Prova
          buscar={buscar}
          visivel={false}
          aoAtualizar={vi.fn()}
          gatilho={0}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(buscar).not.toHaveBeenCalled();
  });

  it("cache vazio gravado por versão antiga NÃO congela a seção: busca de novo e se cura", async () => {
    // O cache antigo gravava "[]" — com isso a seção nem renderizava, o
    // observador ficava sem alvo e a busca nunca rodava: loja que crescia
    // nunca mais ganhava recomendações naquele produto (achado 1 da revisão).
    const armazem = new Map<string, string>();
    armazem.set("ikcous_recs_cache_prod-recupera", JSON.stringify([]));
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    const buscar = vi.fn(async (_id: string) => [produto("r9")]);
    const aoAtualizarRecuperacao = vi.fn();

    function ProvaRecuperacao() {
      const estado = useRecomendacoesDeProduto("prod-recupera", true, buscar);
      aoAtualizarRecuperacao(estado);
      return null;
    }

    // Import dinâmico depois do stub: o hook novo precisa ler o localStorage
    // que agora tem o cache vazio gravado.
    vi.resetModules();
    ({ useRecomendacoesDeProduto } = await import(
      "@/hooks/useRecomendacoesDeProduto"
    ));

    await act(async () => {
      raiz.render(<ProvaRecuperacao />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(buscar).toHaveBeenCalledTimes(1);
    const ultimo = aoAtualizarRecuperacao.mock.calls.at(-1)![0];
    expect(ultimo.consultado).toBe(true);
    expect(ultimo.recomendacoes.map((p: Product) => p.id)).toEqual(["r9"]);
  });

  it("busca que termina vazia NÃO grava cache vazio (a próxima visita re-busca)", async () => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    const buscar = vi.fn(async (_id: string) => []);
    const aoAtualizarVazio = vi.fn();

    function ProvaVazia() {
      const estado = useRecomendacoesDeProduto("prod-vazio", true, buscar);
      aoAtualizarVazio(estado);
      return null;
    }

    vi.resetModules();
    ({ useRecomendacoesDeProduto } = await import(
      "@/hooks/useRecomendacoesDeProduto"
    ));

    await act(async () => {
      raiz.render(<ProvaVazia />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(armazem.get("ikcous_recs_cache_prod-vazio")).toBeUndefined();
  });
});
