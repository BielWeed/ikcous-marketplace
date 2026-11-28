// @vitest-environment jsdom
//
// O botão "Recarregar o app" da tela "Algo deu errado" apagava três coisas
// que a pessoa ainda estava usando:
//
//  - a chave da devolução do painel (`ikcous-chave-da-devolucao:<pedido>:<centavos>`,
//    localStorage, 30 min): depois da limpeza, a lojista tocava "Devolver" de
//    novo, nascia uma chave nova e o servidor criava um SEGUNDO estorno do
//    mesmo valor (o cliente recebia em dobro);
//  - a chave da tentativa de lançamento do financeiro
//    (`fin-lancamento-tentativas-em-aberto`, sessionStorage, 10 min): o mesmo
//    lançamento salvo de novo entrava duas vezes no extrato;
//  - o rascunho do pedido de devolução da cliente
//    (`ikcous:rascunho-da-devolucao:<conta>:<pedido>`, sessionStorage): a folha
//    voltava em branco.
//
// O teste usa o botão REAL do GlobalErrorBoundary e grava e relê pelos módulos
// REAIS: a prova de que a lista acerta a chave é a MESMA chave (ou o mesmo
// rascunho) voltar depois do clique. O que não está na lista continua sumindo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveEmAbertoDoConteudo,
  guardarChaveEmAberto,
} from "@/components/admin/financeiro/tentativasEmAberto";
import { GlobalErrorBoundary } from "@/components/ui/custom/GlobalErrorBoundary";
import { chaveDaDevolucao } from "@/lib/chave-da-devolucao";
import {
  lerRascunhoDaDevolucao,
  salvarRascunhoDaDevolucao,
} from "@/lib/rascunho-da-devolucao";

function Bomba(): never {
  throw new Error("boom — estado inválido de teste");
}

// Mesmo contorno de global-error-boundary-preserva-pedido-sem-resposta.test.tsx:
// o código sob teste faz `Object.keys(storage)`, então o dublê precisa expor as
// chaves gravadas como propriedades ENUMERÁVEIS de verdade.
function criarStorageComChavesEnumeraveis(): Storage {
  const armazem = new Map<string, string>();
  const store = {} as Record<string, unknown>;

  function metodo(nome: string, fn: (...args: never[]) => unknown) {
    Object.defineProperty(store, nome, {
      value: fn,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  metodo("getItem", ((chave: string) =>
    armazem.has(chave) ? armazem.get(chave)! : null) as never);
  metodo("setItem", ((chave: string, valor: string) => {
    armazem.set(chave, String(valor));
    Object.defineProperty(store, chave, {
      value: String(valor),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }) as never);
  metodo("removeItem", ((chave: string) => {
    armazem.delete(chave);
    Reflect.deleteProperty(store, chave);
  }) as never);
  metodo("clear", (() => {
    for (const chave of armazem.keys()) Reflect.deleteProperty(store, chave);
    armazem.clear();
  }) as never);
  metodo(
    "key",
    ((index: number) => Array.from(armazem.keys()).at(index) ?? null) as never,
  );
  Object.defineProperty(store, "length", {
    get: () => armazem.size,
    enumerable: false,
    configurable: true,
  });

  return store as unknown as Storage;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
const reloadEspiao = vi.fn();

beforeEach(() => {
  vi.stubGlobal("localStorage", criarStorageComChavesEnumeraveis());
  vi.stubGlobal("sessionStorage", criarStorageComChavesEnumeraveis());
  reloadEspiao.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: reloadEspiao },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function abrirTelaDeErroEClicarEmRecarregar() {
  await act(async () => {
    raiz.render(
      <GlobalErrorBoundary>
        <Bomba />
      </GlobalErrorBoundary>,
    );
  });
  expect(hospedeiro.textContent).toContain("Algo deu errado");
  const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Recarregar o app"),
  ) as HTMLButtonElement | undefined;
  expect(botao).toBeDefined();
  act(() => {
    botao!.click();
  });
  expect(reloadEspiao).toHaveBeenCalled();
}

const PEDIDO = "5f0d6c1e-8a3b-4c52-9e7a-2b1d3f4a5c6d";

describe("Recarregar o app — a chave da devolução do painel (estorno) sobrevive", () => {
  it("o próximo 'Devolver' do MESMO valor repete a chave (o servidor não cria o segundo estorno)", async () => {
    const antes = chaveDaDevolucao(PEDIDO, 50);
    localStorage.setItem("algum_state_corrompido", "lixo");

    await abrirTelaDeErroEClicarEmRecarregar();

    expect(chaveDaDevolucao(PEDIDO, 50)).toBe(antes);
    // A purga continua seletiva: o que não está na lista some.
    expect(localStorage.getItem("algum_state_corrompido")).toBeNull();
  });

  it("valor diferente continua sendo intenção nova (a lista não junta valores)", async () => {
    const de50 = chaveDaDevolucao(PEDIDO, 50);

    await abrirTelaDeErroEClicarEmRecarregar();

    expect(chaveDaDevolucao(PEDIDO, 60)).not.toBe(de50);
    expect(chaveDaDevolucao(PEDIDO, 50)).toBe(de50);
  });
});

describe("Recarregar o app — a tentativa de lançamento do financeiro sobrevive", () => {
  it("salvar o mesmo lançamento de novo reaproveita a chave (não entra duas vezes)", async () => {
    guardarChaveEmAberto("conta-1", "conteudo-do-lancamento", "chave-original");
    sessionStorage.setItem("splash_shown", "true");

    await abrirTelaDeErroEClicarEmRecarregar();

    expect(chaveEmAbertoDoConteudo("conta-1", "conteudo-do-lancamento")).toBe(
      "chave-original",
    );
    expect(sessionStorage.getItem("splash_shown")).toBeNull();
  });
});

describe("Recarregar o app — o rascunho do pedido de devolução da cliente sobrevive", () => {
  it("a folha reabre preenchida; o resto da sessão é apagado", async () => {
    salvarRascunhoDaDevolucao(sessionStorage, "conta-1", PEDIDO, {
      passo: 2,
      itens: [["item-1", 1]],
      motivo: null,
      detalhe: "chegou rasgado",
      resolucao: null,
      metodo: null,
      fotos: 2,
    });
    sessionStorage.setItem("sb-projeto-auth-token", "lixo");

    await abrirTelaDeErroEClicarEmRecarregar();

    expect(lerRascunhoDaDevolucao(sessionStorage, "conta-1", PEDIDO)).toEqual(
      expect.objectContaining({
        passo: 2,
        itens: [["item-1", 1]],
        detalhe: "chegou rasgado",
        fotos: 2,
      }),
    );
    expect(sessionStorage.getItem("sb-projeto-auth-token")).toBeNull();
  });
});
