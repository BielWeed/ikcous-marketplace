// @vitest-environment jsdom
//
// Lote r66-b: o botão "Recarregar o app" da tela "Algo deu errado" apagava o
// pedido de VISITANTE com resposta perdida (`ikcous-pedido-sem-resposta-v1`,
// no sessionStorage). Sem ele o checkout não mostra mais "reenviar a mesma
// compra" e remonta o pedido a partir do carrinho, que pode ter mudado de
// preço ou estoque: a pessoa podia criar um SEGUNDO pedido sem perceber.
//
// O teste usa o botão REAL do GlobalErrorBoundary e grava e relê pelo módulo
// REAL (`guardarPedidoSemResposta` / `lerPedidoSemResposta`): o literal da
// chave não é exportado, então a prova de que a lista acerta a chave certa
// é o pedido voltar legível depois do clique. O resto da sessão continua
// sendo apagado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalErrorBoundary } from "@/components/ui/custom/GlobalErrorBoundary";
import {
  type PedidoCongelado,
  guardarPedidoSemResposta,
  lerPedidoSemResposta,
} from "@/lib/pedido-sem-resposta";

function Bomba(): never {
  throw new Error("boom — estado inválido de teste");
}

// Mesmo contorno de global-error-boundary-recovery-preserva-sessao-e-carrinho.test.tsx:
// o código sob teste faz `Object.keys(localStorage)`, então o dublê precisa
// expor as chaves gravadas como propriedades ENUMERÁVEIS de verdade.
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
    // `Reflect.deleteProperty` em vez de `delete store[chave]`: mesmo
    // efeito, sem acesso computado por variável (o que o eslint-plugin-
    // -security marca como Generic Object Injection Sink).
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

const pedido: PedidoCongelado = {
  orderData: {
    idempotencyKey: "chave-original",
    items: [{ product_id: "produto-1", quantity: 2 }],
  },
  ehOnline: false,
  metodoOnline: "pix",
  itens: [],
  valor: 200,
  cpfParaRpc: undefined,
  contaEsperada: null,
  semConta: true,
};

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
}

describe("GlobalErrorBoundary — Recarregar o app não apaga o pedido de visitante com resposta perdida", () => {
  it("o pedido guardado sobrevive e ainda volta legível; o resto da sessão é apagado", async () => {
    guardarPedidoSemResposta(pedido);
    sessionStorage.setItem("ikcous:checkout-pedido-pendente:u1", "p1");
    sessionStorage.setItem("splash_shown", "true");
    sessionStorage.setItem("sb-projeto-auth-token", "lixo");
    expect(lerPedidoSemResposta()?.orderData.idempotencyKey).toBe(
      "chave-original",
    );

    await abrirTelaDeErroEClicarEmRecarregar();

    // O que importa para quem compra: o checkout reabre a MESMA compra.
    expect(lerPedidoSemResposta()?.orderData).toEqual(pedido.orderData);
    // A lista continua seletiva: o que já sobrevivia fica, o resto some.
    expect(sessionStorage.getItem("ikcous:checkout-pedido-pendente:u1")).toBe(
      "p1",
    );
    expect(sessionStorage.getItem("splash_shown")).toBeNull();
    expect(sessionStorage.getItem("sb-projeto-auth-token")).toBeNull();
    expect(reloadEspiao).toHaveBeenCalled();
  });

  it("sem pedido guardado, nada é inventado: a sessão sai limpa e a página recarrega", async () => {
    sessionStorage.setItem("algum_estado_corrompido", "lixo");

    await abrirTelaDeErroEClicarEmRecarregar();

    expect(lerPedidoSemResposta()).toBeNull();
    expect(sessionStorage.getItem("algum_estado_corrompido")).toBeNull();
    expect(reloadEspiao).toHaveBeenCalled();
  });

  it("pedido vencido (30 min) que sobreviveu ao clique continua sendo descartado na leitura", async () => {
    const agora = Date.now();
    guardarPedidoSemResposta(pedido);
    await abrirTelaDeErroEClicarEmRecarregar();

    vi.spyOn(Date, "now").mockReturnValue(agora + 31 * 60_000);

    expect(lerPedidoSemResposta()).toBeNull();
  });
});
