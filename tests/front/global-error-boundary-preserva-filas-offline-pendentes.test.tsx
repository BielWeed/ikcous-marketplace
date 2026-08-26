// @vitest-environment jsdom
//
// Achado 1 da revisão de contexto limpo (26/08/2026) sobre
// global-error-boundary-recovery-preserva-sessao-e-carrinho.test.tsx.
//
// A lista branca de GlobalErrorBoundary.handleReset (8 prefixos) não cobria
// "orders_offline_updates_queue" (useOrders.ts) nem
// "products_offline_updates_queue" (useProducts.ts) — as duas chaves que
// guardam ESCRITA AINDA NÃO CONFIRMADA no servidor: o lojista sem rede marca
// pedido como "enviado" ou edita preço/estoque/SKU de produto, o app
// empilha a mudança para reenviar quando a rede voltar, e diz "vamos tentar
// de novo mais tarde". Se o boundary cai antes da rede voltar e a pessoa
// toca no único botão da tela, a fila inteira era apagada em silêncio.
//
// Mesmo mecanismo para "admin_banner_form_draft": rascunho de formulário
// perdido no meio de uma edição por causa de um crash não relacionado.
//
// Vermelho contra o código antigo: as três chaves não batem em nenhum dos
// 8 prefixos da lista branca original e são removidas pelo laço de
// `handleReset`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalErrorBoundary } from "@/components/ui/custom/GlobalErrorBoundary";

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

function clicarRecovery() {
  const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Reiniciar Sessão"),
  ) as HTMLButtonElement | undefined;
  expect(botao).toBeDefined();
  act(() => {
    botao!.click();
  });
}

describe("GlobalErrorBoundary — recovery preserva escrita pendente do lojista", () => {
  it("preserva as filas offline de pedidos e produtos, e o rascunho do banner; apaga o resto", async () => {
    const filaPedidos = JSON.stringify([{ orderId: "o1", status: "shipped" }]);
    const filaProdutos = JSON.stringify([{ id: "p1", price: 42 }]);
    const rascunhoBanner = JSON.stringify({ title: "Promoção de agosto" });

    localStorage.setItem("orders_offline_updates_queue", filaPedidos);
    localStorage.setItem("products_offline_updates_queue", filaProdutos);
    localStorage.setItem("admin_banner_form_draft", rascunhoBanner);
    localStorage.setItem("algum_state_corrompido", "lixo");

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <Bomba />
        </GlobalErrorBoundary>,
      );
    });

    expect(hospedeiro.textContent).toContain("Erro Fatal Detectado");

    clicarRecovery();

    expect(localStorage.getItem("orders_offline_updates_queue")).toBe(
      filaPedidos,
    );
    expect(localStorage.getItem("products_offline_updates_queue")).toBe(
      filaProdutos,
    );
    expect(localStorage.getItem("admin_banner_form_draft")).toBe(
      rascunhoBanner,
    );

    expect(localStorage.getItem("algum_state_corrompido")).toBeNull();

    expect(reloadEspiao).toHaveBeenCalled();
  });
});
