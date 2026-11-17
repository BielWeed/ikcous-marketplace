// @vitest-environment jsdom
//
// "Você também pode gostar": a cliente deixa a página do produto aberta, a
// lojista muda o preço/estoque (ou pausa) de um dos recomendados e a cliente
// volta à aba. O catálogo era relido, mas as recomendações moravam em estado
// PRÓPRIO do hook e só se refaziam quando `[productId, visivel]` mudavam: os
// cards seguiam com o preço velho, inclusive para comprar.
//
// O conserto é `recarregar()` no retorno do hook — a página chama no mesmo
// gatilho que já relê o catálogo. Aqui se prende:
// 1. recarregar mostra o dado NOVO (preço novo, produto pausado some);
// 2. sem esqueleto (a lista antiga fica na tela até a nova chegar) e sem laço:
//    re-render com buscador instável NÃO busca de novo (a armadilha de 01/09);
// 3. falha na releitura mantém o que está na tela;
// 4. duas releituras seguidas: vale a ÚLTIMA, mesmo que a antiga responda tarde.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = (id: string, price = 10) =>
  ({ id, name: `Produto ${id}`, price }) as unknown as Product;

type Estado = {
  recomendacoes: Product[];
  carregando: boolean;
  consultado: boolean;
  recarregar: () => void;
};

const esperar = (ms = 20) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe("useRecomendacoesDeProduto — recarregar ao voltar à aba", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  type HookMod = typeof import("@/hooks/useRecomendacoesDeProduto");
  let useRecomendacoesDeProduto: HookMod["useRecomendacoesDeProduto"];

  beforeEach(async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
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

  /** Monta o hook e devolve o ESTADO mais recente (via função, não cópia). */
  async function montar(
    buscar: (id: string) => Promise<Product[]>,
    visivel = true,
  ) {
    const aoAtualizar = vi.fn<(estado: Estado) => void>();
    function Prova({ gatilho }: { gatilho: number }) {
      aoAtualizar(
        useRecomendacoesDeProduto("prod-1", visivel, (id) => buscar(id)),
      );
      return <div data-gatilho={gatilho} />;
    }
    await act(async () => {
      raiz.render(<Prova gatilho={0} />);
    });
    await esperar();
    return {
      atual: () => aoAtualizar.mock.calls.at(-1)![0],
      todos: () => aoAtualizar.mock.calls.map((c) => c[0]),
      rerender: (gatilho: number) =>
        act(async () => {
          raiz.render(<Prova gatilho={gatilho} />);
        }),
    };
  }

  it("preço mudou no servidor: recarregar() troca o card pelo preço novo, sem esqueleto e sem laço", async () => {
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockResolvedValueOnce([produto("r1", 10), produto("r2", 20)])
      .mockResolvedValue([produto("r1", 12), produto("r2", 20)]);

    const tela = await montar(buscar);
    expect(tela.atual().recomendacoes.map((p) => p.price)).toEqual([10, 20]);
    expect(buscar).toHaveBeenCalledTimes(1);
    const quantidadeAntes = tela.todos().length;

    await act(async () => {
      tela.atual().recarregar();
    });
    await esperar();

    expect(tela.atual().recomendacoes.map((p) => p.price)).toEqual([12, 20]);
    expect(buscar).toHaveBeenCalledTimes(2);
    // A lista antiga ficou na tela durante a releitura: nenhum render depois
    // do primeiro carregamento voltou a "carregando" nem esvaziou a lista.
    for (const estado of tela.todos().slice(quantidadeAntes)) {
      expect(estado.carregando).toBe(false);
      expect(estado.recomendacoes.length).toBe(2);
    }

    // Re-renders com buscador NOVO a cada um (a instabilidade de 01/09) não
    // disparam busca nenhuma: continuam as duas chamadas.
    for (const gatilho of [1, 2, 3]) await tela.rerender(gatilho);
    await esperar();
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("recomendado foi pausado: a releitura devolve sem ele e o card some", async () => {
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockResolvedValueOnce([produto("r1"), produto("r2")])
      .mockResolvedValue([produto("r2")]);

    const tela = await montar(buscar);
    await act(async () => {
      tela.atual().recarregar();
    });
    await esperar();

    expect(tela.atual().recomendacoes.map((p) => p.id)).toEqual(["r2"]);
  });

  it("a releitura falha: o que está na tela continua", async () => {
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockResolvedValueOnce([produto("r1", 10)])
      .mockRejectedValue(new Error("rede caiu"));

    const tela = await montar(buscar);
    await act(async () => {
      tela.atual().recarregar();
    });
    await esperar();

    expect(buscar).toHaveBeenCalledTimes(2);
    expect(tela.atual().recomendacoes.map((p) => p.price)).toEqual([10]);
    expect(tela.atual().carregando).toBe(false);
  });

  it("duas releituras seguidas: vale a última, mesmo se a antiga responder depois", async () => {
    let soltarAntiga: (r: Product[]) => void = () => {};
    const antiga = new Promise<Product[]>((resolve) => {
      soltarAntiga = resolve;
    });
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockResolvedValueOnce([produto("r1", 10)])
      .mockReturnValueOnce(antiga)
      .mockResolvedValue([produto("r1", 14)]);

    const tela = await montar(buscar);
    await act(async () => {
      tela.atual().recarregar(); // fica pendurada
      tela.atual().recarregar(); // responde logo
    });
    await esperar();
    expect(tela.atual().recomendacoes.map((p) => p.price)).toEqual([14]);

    await act(async () => {
      soltarAntiga([produto("r1", 11)]);
    });
    await esperar();
    expect(tela.atual().recomendacoes.map((p) => p.price)).toEqual([14]);
  });

  it("seção invisível: recarregar() não busca nada", async () => {
    const buscar = vi.fn(async (_id: string) => [produto("r1")]);

    const tela = await montar(buscar, false);
    await act(async () => {
      tela.atual().recarregar();
    });
    await esperar();

    expect(buscar).not.toHaveBeenCalled();
  });
});
