// @vitest-environment jsdom
//
// "Você também pode gostar": se a consulta das recomendações nunca respondia
// (rede que conecta e não responde), `carregando` ficava true para sempre e a
// página mantinha os cartões cinza. Agora a espera tem prazo: estourou, cai no
// caminho de falha de sempre (carregando=false, consultado=true; mantém a cópia
// guardada, ou lista vazia e a seção some). Uma resposta tardia da busca
// abandonada não mexe na tela nem grava cópia.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_DAS_RECOMENDACOES_DO_PRODUTO_MS } from "@/lib/prazo-da-requisicao";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO = PRAZO_DAS_RECOMENDACOES_DO_PRODUTO_MS;
const chave = (id: string) => `ikcous_recs_v2_cache_${id}`;

const produto = (id: string) =>
  ({ id, name: `Produto ${id}`, price: 10 }) as unknown as Product;

type Estado = {
  recomendacoes: Product[];
  carregando: boolean;
  consultado: boolean;
};

describe("useRecomendacoesDeProduto — busca sem resposta não deixa a seção carregando para sempre", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  type HookMod = typeof import("@/hooks/useRecomendacoesDeProduto");
  let useRecomendacoesDeProduto: HookMod["useRecomendacoesDeProduto"];
  let ultimoEstado: () => Estado;

  async function carregarHook() {
    vi.resetModules();
    ({ useRecomendacoesDeProduto } = await import(
      "@/hooks/useRecomendacoesDeProduto"
    ));
  }

  beforeEach(async () => {
    vi.useFakeTimers();
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
    await carregarHook();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(
    idInicial: string,
    buscar: (id: string) => Promise<Product[]>,
  ) {
    const aoAtualizar = vi.fn<(estado: Estado) => void>();
    ultimoEstado = () => aoAtualizar.mock.calls.at(-1)![0];
    function Prova({ id }: { id: string }) {
      aoAtualizar(useRecomendacoesDeProduto(id, true, buscar));
      return null;
    }
    await act(async () => {
      raiz.render(<Prova id={idInicial} />);
    });
    return {
      trocarPara: async (id: string) => {
        await act(async () => {
          raiz.render(<Prova id={id} />);
        });
      },
    };
  }

  const passar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("busca que nunca conclui, sem cópia: antes do prazo segue carregando; no prazo a seção sai do carregamento e some", async () => {
    const buscar = vi.fn(() => new Promise<Product[]>(() => {}));
    await montar("prod-a", buscar);

    await passar(PRAZO - 1);
    expect(ultimoEstado().carregando).toBe(true);
    expect(ultimoEstado().consultado).toBe(false);

    await passar(1);
    expect(ultimoEstado().carregando).toBe(false);
    expect(ultimoEstado().consultado).toBe(true);
    expect(ultimoEstado().recomendacoes).toEqual([]);
    expect(armazem.get(chave("prod-a"))).toBeUndefined();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("busca que nunca conclui, com cópia guardada: a lista da cópia continua e a cópia não é apagada", async () => {
    armazem.set(
      chave("prod-a"),
      JSON.stringify([produto("c1"), produto("c2")]),
    );
    await carregarHook();
    const buscar = vi.fn(() => new Promise<Product[]>(() => {}));
    await montar("prod-a", buscar);

    await passar(PRAZO);

    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["c1", "c2"]);
    expect(ultimoEstado().carregando).toBe(false);
    expect(ultimoEstado().consultado).toBe(true);
    expect(JSON.parse(armazem.get(chave("prod-a"))!)).toHaveLength(2);
  });

  it("busca que responde depois do prazo: a resposta tardia não mexe na tela nem grava cópia", async () => {
    let responder!: (lista: Product[]) => void;
    const buscar = vi.fn(
      () =>
        new Promise<Product[]>((resolve) => {
          responder = resolve;
        }),
    );
    await montar("prod-a", buscar);

    await passar(PRAZO);
    await act(async () => {
      responder([produto("tardio")]);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(ultimoEstado().recomendacoes).toEqual([]);
    expect(ultimoEstado().carregando).toBe(false);
    expect(armazem.get(chave("prod-a"))).toBeUndefined();
  });

  it("produto trocado: o prazo da busca ABANDONADA do produto antigo não encerra o carregamento do novo", async () => {
    const buscar = vi.fn(() => new Promise<Product[]>(() => {}));
    const { trocarPara } = await montar("prod-a", buscar);

    await passar(5_000);
    await trocarPara("prod-b");
    expect(buscar).toHaveBeenCalledTimes(2);

    // O prazo da busca de "prod-a" vence aqui; "prod-b" ainda está no seu.
    await passar(PRAZO - 5_000);
    expect(ultimoEstado().carregando).toBe(true);
    expect(ultimoEstado().consultado).toBe(false);

    // O prazo da busca de "prod-b" vence 5 s depois.
    await passar(5_000);
    expect(ultimoEstado().carregando).toBe(false);
    expect(ultimoEstado().consultado).toBe(true);
  });

  it("produto trocado: resposta tardia do produto antigo não altera a lista do novo nem grava cópia do antigo", async () => {
    let responderA!: (lista: Product[]) => void;
    const buscar = vi.fn((id: string) =>
      id === "prod-a"
        ? new Promise<Product[]>((resolve) => {
            responderA = resolve;
          })
        : Promise.resolve([produto("b1")]),
    );
    const { trocarPara } = await montar("prod-a", buscar);

    await passar(PRAZO);
    await trocarPara("prod-b");
    await passar(0);
    await act(async () => {
      responderA([produto("a-tardio")]);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["b1"]);
    expect(armazem.get(chave("prod-a"))).toBeUndefined();
  });

  it("controle: busca rápida normal mostra a lista e grava a cópia, como hoje", async () => {
    const buscar = vi.fn(async () => [produto("r1"), produto("r2")]);
    await montar("prod-a", buscar);
    await passar(0);

    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["r1", "r2"]);
    expect(ultimoEstado().carregando).toBe(false);
    expect(ultimoEstado().consultado).toBe(true);
    expect(JSON.parse(armazem.get(chave("prod-a"))!)).toHaveLength(2);

    // O prazo vencendo depois de uma resposta já dada não desfaz nada.
    await passar(PRAZO);
    expect(ultimoEstado().recomendacoes).toHaveLength(2);
    expect(ultimoEstado().consultado).toBe(true);
  });

  it("controle: busca que rejeita segue como hoje (sai do carregamento, seção some)", async () => {
    const buscar = vi.fn(async (): Promise<Product[]> => {
      throw new Error("rede caiu");
    });
    await montar("prod-a", buscar);
    await passar(0);

    expect(ultimoEstado().recomendacoes).toEqual([]);
    expect(ultimoEstado().carregando).toBe(false);
    expect(ultimoEstado().consultado).toBe(true);
    expect(armazem.get(chave("prod-a"))).toBeUndefined();
  });
});
