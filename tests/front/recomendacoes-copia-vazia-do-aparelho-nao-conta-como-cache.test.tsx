// @vitest-environment jsdom
//
// "Você também pode gostar": versões antigas do app gravaram no aparelho uma
// cópia VAZIA ("[]") das recomendações. Cópia vazia não é cache útil: a seção
// precisa seguir "carregando" (esqueletos) até a consulta responder — nunca
// nascer "pronta e sem itens", que some com a seção antes da hora.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const chave = (id: string) => `ikcous_recs_v2_cache_${id}`;

const produto = (id: string) =>
  ({ id, name: `Produto ${id}`, price: 10 }) as unknown as Product;

type Estado = {
  recomendacoes: Product[];
  carregando: boolean;
  consultado: boolean;
};

describe("useRecomendacoesDeProduto — cópia vazia guardada no aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  type HookMod = typeof import("@/hooks/useRecomendacoesDeProduto");
  let useRecomendacoesDeProduto: HookMod["useRecomendacoesDeProduto"];

  beforeEach(async () => {
    armazem = new Map<string, string>();
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
    // Módulo novo: o cache em memória do gancho começa vazio em cada teste.
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
      aoAtualizar(useRecomendacoesDeProduto("prod-a", true, buscar));
      return null;
    }
    await act(async () => {
      raiz.render(<Prova />);
    });
    return aoAtualizar;
  }

  it("a cópia '[]' não vale como cache: já no primeiro desenho segue carregando, sem 'consultado'", async () => {
    armazem.set(chave("prod-a"), "[]");
    let responder!: (lista: Product[]) => void;
    const buscar = vi.fn(
      () =>
        new Promise<Product[]>((resolve) => {
          responder = resolve;
        }),
    );

    const aoAtualizar = await montar(buscar);

    const primeiro = aoAtualizar.mock.calls[0][0];
    expect(primeiro.carregando).toBe(true);
    expect(primeiro.consultado).toBe(false);
    // E continua assim enquanto a consulta não responde.
    const durante = aoAtualizar.mock.calls.at(-1)![0];
    expect(durante.carregando).toBe(true);
    expect(durante.consultado).toBe(false);
    expect(durante.recomendacoes).toEqual([]);
    expect(buscar).toHaveBeenCalledTimes(1);

    await act(async () => {
      responder([produto("r1")]);
    });

    const depois = aoAtualizar.mock.calls.at(-1)![0];
    expect(depois.carregando).toBe(false);
    expect(depois.consultado).toBe(true);
    expect(depois.recomendacoes.map((p) => p.id)).toEqual(["r1"]);
    // A resposta boa substitui a cópia vazia.
    expect(JSON.parse(armazem.get(chave("prod-a"))!)).toHaveLength(1);
  });

  it("resposta vazia da consulta não é gravada (a próxima visita busca de novo) e apaga a cópia vazia velha", async () => {
    armazem.set(chave("prod-a"), "[]");
    const aoAtualizar = await montar(() => Promise.resolve([]));

    const final = aoAtualizar.mock.calls.at(-1)![0];
    expect(final.consultado).toBe(true);
    expect(final.recomendacoes).toEqual([]);
    expect(armazem.has(chave("prod-a"))).toBe(false);
  });
});
