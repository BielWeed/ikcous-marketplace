// @vitest-environment jsdom
//
// "Você também pode gostar": quando a página relê as recomendações (volta à
// aba), a busca ANTERIOR fica abandonada. Se essa busca antiga FALHAR depois
// que a releitura já começou, o erro dela não vale: não pode encerrar o
// "carregando" nem declarar a seção "consultada" enquanto a busca nova ainda
// não respondeu — a seção mostraria "sem recomendações" antes da hora.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecomendacoesDoProduto } from "@/hooks/useRecomendacoesDeProduto";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = (id: string) =>
  ({ id, name: `Produto ${id}`, price: 10 }) as unknown as Product;

describe("useRecomendacoesDeProduto — falha tardia de uma busca abandonada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  type HookMod = typeof import("@/hooks/useRecomendacoesDeProduto");
  let useRecomendacoesDeProduto: HookMod["useRecomendacoesDeProduto"];

  beforeEach(async () => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, valor: string) => {
        armazem.set(c, valor);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
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

  it("a busca antiga falha com a releitura em andamento: segue carregando, e a resposta da releitura é a que vale", async () => {
    const respostas: {
      resolver: (lista: Product[]) => void;
      rejeitar: (erro: Error) => void;
    }[] = [];
    const buscar = vi.fn(
      () =>
        new Promise<Product[]>((resolver, rejeitar) => {
          respostas.push({ resolver, rejeitar });
        }),
    );
    const aoAtualizar = vi.fn<(estado: RecomendacoesDoProduto) => void>();
    function Prova() {
      aoAtualizar(useRecomendacoesDeProduto("prod-a", true, buscar));
      return null;
    }
    const estado = () => aoAtualizar.mock.calls.at(-1)![0];

    await act(async () => {
      raiz.render(<Prova />);
    });
    expect(buscar).toHaveBeenCalledTimes(1);

    // A página volta à aba: relê. A primeira busca ainda não respondeu.
    await act(async () => {
      estado().recarregar();
    });
    expect(buscar).toHaveBeenCalledTimes(2);

    // A primeira (abandonada) falha agora.
    await act(async () => {
      respostas[0].rejeitar(new Error("rede caiu"));
    });
    expect(estado().carregando).toBe(true);
    expect(estado().consultado).toBe(false);

    // A releitura responde e é ela quem encerra o carregamento.
    await act(async () => {
      respostas[1].resolver([produto("r1")]);
    });
    expect(estado().carregando).toBe(false);
    expect(estado().consultado).toBe(true);
    expect(estado().recomendacoes.map((p) => p.id)).toEqual(["r1"]);
  });
});
