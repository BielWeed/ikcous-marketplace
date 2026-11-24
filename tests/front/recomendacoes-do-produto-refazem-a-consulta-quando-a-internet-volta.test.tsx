// @vitest-environment jsdom
//
// "Você também pode gostar": quando a consulta FALHAVA (internet caiu), o hook
// marcava `consultado` com lista vazia e a seção sumia sem aviso e sem botão —
// e continuava assim mesmo depois que a internet voltava, até a cliente sair e
// entrar de novo na página. Agora, depois de uma FALHA, a volta da internet
// (offline -> online) com a seção já pedida refaz a consulta UMA vez.
//
// Fora de escopo de propósito: sucesso não consulta de novo, rede que nunca
// caiu não consulta de novo, e uma releitura que falha de novo não vira laço
// (só a PRÓXIMA virada offline -> online tenta outra vez).
//
// A volta da internet é o evento `online` do navegador, disparado pelo teste;
// o hook de recomendações é o real.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRecomendacoesDeProduto } from "@/hooks/useRecomendacoesDeProduto";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = (id: string) =>
  ({ id, name: `Produto ${id}`, price: 10 }) as unknown as Product;

type Estado = {
  recomendacoes: Product[];
  carregando: boolean;
  consultado: boolean;
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimoEstado: () => Estado;
let armazem: Map<string, string>;
// Cada teste usa ids próprios: o cache em memória do hook é de módulo.
let contador = 0;
const idNovo = () => `prod-rede-${++contador}`;

const falha = () => Promise.reject(new Error("Failed to fetch"));

async function montar(
  id: string,
  buscar: (id: string) => Promise<Product[]>,
  visivel = true,
) {
  const aoAtualizar = vi.fn<(estado: Estado) => void>();
  ultimoEstado = () => aoAtualizar.mock.calls.at(-1)![0];
  function Prova({
    id: idAtual,
    visivel: v,
  }: {
    id: string;
    visivel: boolean;
  }) {
    aoAtualizar(useRecomendacoesDeProduto(idAtual, v, buscar));
    return null;
  }
  await act(async () => {
    raiz.render(<Prova id={id} visivel={visivel} />);
  });
  return {
    renderizar: async (idAtual: string, v: boolean) => {
      await act(async () => {
        raiz.render(<Prova id={idAtual} visivel={v} />);
      });
    },
  };
}

// Só uma virada offline -> online dispara o evento `online` do navegador:
// "continuar online" não emite nada.
let estaOffline = false;
const virarRede = async (offline: boolean) => {
  const eraOffline = estaOffline;
  estaOffline = offline;
  if (offline || !eraOffline) return;
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
};

/** A internet cai e volta: UMA virada offline -> online. */
const quedaEVolta = async () => {
  await virarRede(true);
  await virarRede(false);
};

beforeEach(() => {
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
  estaOffline = false;
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

describe("useRecomendacoesDeProduto — a volta da internet refaz a consulta que falhou", () => {
  it("consulta falhou, a internet cai e volta: refaz a consulta e as recomendações aparecem", async () => {
    const id = idNovo();
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockImplementationOnce(falha)
      .mockResolvedValueOnce([produto("r1"), produto("r2")]);
    await montar(id, buscar);

    // Estado de hoje depois da falha: seção vazia e "já consultado".
    expect(ultimoEstado().recomendacoes).toEqual([]);
    expect(ultimoEstado().consultado).toBe(true);
    expect(buscar).toHaveBeenCalledTimes(1);

    await quedaEVolta();

    expect(buscar).toHaveBeenCalledTimes(2);
    expect(buscar).toHaveBeenLastCalledWith(id);
    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["r1", "r2"]);
    expect(ultimoEstado().carregando).toBe(false);
    // Releitura bem-sucedida grava a cópia, como a busca normal.
    expect(JSON.parse(armazem.get(`ikcous_recs_v2_cache_${id}`)!)).toHaveLength(
      2,
    );
  });

  it("a releitura é SEM esqueleto: `carregando` não volta a true enquanto ela está no ar", async () => {
    const id = idNovo();
    let responder!: (lista: Product[]) => void;
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockImplementationOnce(falha)
      .mockImplementationOnce(
        () =>
          new Promise<Product[]>((resolve) => {
            responder = resolve;
          }),
      );
    await montar(id, buscar);
    await quedaEVolta();
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(ultimoEstado().carregando).toBe(false);

    await act(async () => {
      responder([produto("r1")]);
    });
    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["r1"]);
  });

  it("controle: consulta que deu CERTO não é refeita quando a internet cai e volta", async () => {
    const id = idNovo();
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockResolvedValue([produto("r1")]);
    await montar(id, buscar);
    expect(buscar).toHaveBeenCalledTimes(1);

    await quedaEVolta();
    await quedaEVolta();

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["r1"]);
  });

  it("controle: falha com a internet de pé o tempo todo (erro do servidor) não gera consulta nova", async () => {
    const id = idNovo();
    const buscar = vi.fn<(id: string) => Promise<Product[]>>(falha);
    await montar(id, buscar);
    await virarRede(false); // sem virada nenhuma: continua online
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("a internet CAIR (sem voltar) depois da falha não consulta; só a volta consulta", async () => {
    const id = idNovo();
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockImplementationOnce(falha)
      .mockResolvedValueOnce([produto("r1")]);
    await montar(id, buscar);

    await virarRede(true);
    expect(buscar).toHaveBeenCalledTimes(1);

    await virarRede(false);
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("sem laço: a releitura falha de novo e a internet segue de pé — para por aqui; só a PRÓXIMA virada tenta outra vez", async () => {
    const id = idNovo();
    const buscar = vi.fn<(id: string) => Promise<Product[]>>(falha);
    await montar(id, buscar);
    expect(buscar).toHaveBeenCalledTimes(1);

    await quedaEVolta();
    expect(buscar).toHaveBeenCalledTimes(2);

    // Passa tempo e renders sem nova virada: nenhuma consulta a mais.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await virarRede(false);
    expect(buscar).toHaveBeenCalledTimes(2);

    await quedaEVolta();
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it("a rede oscila com a releitura ainda no ar: UMA releitura só, não uma por virada", async () => {
    const id = idNovo();
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockImplementationOnce(falha)
      .mockImplementation(() => new Promise<Product[]>(() => {}));
    await montar(id, buscar);

    await quedaEVolta();
    await quedaEVolta();
    await quedaEVolta();

    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("seção NÃO pedida (visivel=false) quando a internet volta: não consulta; ao ficar visível a busca normal acontece", async () => {
    const id = idNovo();
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockImplementationOnce(falha)
      .mockResolvedValue([produto("r1")]);
    const { renderizar } = await montar(id, buscar, true);
    expect(buscar).toHaveBeenCalledTimes(1);

    // A cliente rola para longe: a seção deixa de estar pedida.
    await renderizar(id, false);
    await quedaEVolta();
    expect(buscar).toHaveBeenCalledTimes(1);

    // Ao ficar visível de novo, o efeito normal busca (não a releitura).
    await renderizar(id, true);
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["r1"]);
  });

  it("falha do produto A, cliente vai ao produto B que deu certo: a volta da internet NÃO refaz a consulta de A nem de B", async () => {
    const a = idNovo();
    const b = idNovo();
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockImplementationOnce(falha)
      .mockResolvedValue([produto("b1")]);
    const { renderizar } = await montar(a, buscar);
    await renderizar(b, true);
    expect(buscar).toHaveBeenCalledTimes(2);

    await quedaEVolta();

    expect(buscar).toHaveBeenCalledTimes(2);
    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["b1"]);
  });

  it("falha do produto B depois de A: a volta da internet refaz a consulta de B (o produto da tela)", async () => {
    const a = idNovo();
    const b = idNovo();
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockResolvedValueOnce([produto("a1")])
      .mockImplementationOnce(falha)
      .mockResolvedValueOnce([produto("b1")]);
    const { renderizar } = await montar(a, buscar);
    await renderizar(b, true);
    expect(buscar).toHaveBeenCalledTimes(2);

    await quedaEVolta();

    expect(buscar).toHaveBeenCalledTimes(3);
    expect(buscar).toHaveBeenLastCalledWith(b);
    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["b1"]);
  });

  it("começar a página já offline e a consulta falhar: a primeira volta da internet refaz", async () => {
    const id = idNovo();
    estaOffline = true;
    const buscar = vi
      .fn<(id: string) => Promise<Product[]>>()
      .mockImplementationOnce(falha)
      .mockResolvedValueOnce([produto("r1")]);
    await montar(id, buscar);
    expect(buscar).toHaveBeenCalledTimes(1);

    await virarRede(false);

    expect(buscar).toHaveBeenCalledTimes(2);
    expect(ultimoEstado().recomendacoes.map((p) => p.id)).toEqual(["r1"]);
  });
});
