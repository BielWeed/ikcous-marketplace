// @vitest-environment jsdom
//
// APP-01 — o único botão da tela de erro esvazia o carrinho e desconecta a
// pessoa.
//
// Até 26/08/2026, `GlobalErrorBoundary.handleReset` fazia
// `localStorage.clear()` sem exceção nenhuma. O carrinho vive em
// localStorage sob `marketplace_cart_v1` (CartContext.tsx) e o token de
// sessão do Supabase também (`storage: globalThis.localStorage` em
// src/lib/supabase.ts, chave com prefixo `sb-`). A pessoa via a tela preta
// "Erro Fatal Detectado", tocava no único botão que existe — "Reiniciar
// Sessão (Recovery)" — e voltava sem sessão e sem o que tinha montado no
// carrinho.
//
// A correção reaproveita a MESMA lista branca de src/hooks/useUpdateCheck.ts
// (Nuclear Purge), com o prefixo `notificacoes-` (NotificationContext.tsx)
// somado — o defeito irmão medido na auditoria: sem esse prefixo, a chave
// "li este aviso" seria apagada igual.
//
// Vermelho contra o código antigo: com `localStorage.clear()` puro, TODAS as
// chaves — inclusive `sb-...-auth-token` e `marketplace_cart_v1` — somem.
// As asserções de sobrevivência abaixo reprovariam contra ele.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalErrorBoundary } from "@/components/ui/custom/GlobalErrorBoundary";

function Bomba(): never {
  throw new Error("boom — estado inválido de teste");
}

// Node 25 pisa em `localStorage`/`sessionStorage` globais antes do jsdom
// (mesmo contorno de cor-da-loja-vem-do-banco.test.tsx e
// auth-logout-cleanup.test.tsx: sem isto, o `localStorage` global nem tem
// `.clear`). A diferença aqui é que o código sob teste faz
// `Object.keys(localStorage)` — o dublê precisa expor as chaves gravadas
// como propriedades ENUMERÁVEIS de verdade (como o Storage real faz), não
// só responder a getItem/setItem. Métodos ficam não-enumeráveis para não
// entrar no `Object.keys`.
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
  // `window.location.reload` não é redefinível via vi.spyOn no jsdom
  // (propriedade não-configurável). Troca o `location` inteiro por uma
  // cópia rasa com `reload` espionável — mesmo contorno usado para
  // localStorage/sessionStorage acima.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: reloadEspiao },
  });
  // componentDidCatch loga com console.error de propósito (é o "alertamos
  // silenciosamente") — silenciar para não sujar a saída do teste.
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

describe("GlobalErrorBoundary — recovery não apaga sessão nem carrinho", () => {
  it("preserva sessão (sb-), carrinho (marketplace_/cart_), favoritos (ikcous_/favorites_) e aviso lido (notificacoes-); apaga o resto", async () => {
    localStorage.setItem("sb-projeto-auth-token", "token-de-sessao");
    localStorage.setItem("marketplace_cart_v1", JSON.stringify([{ id: 1 }]));
    localStorage.setItem("ikcous_favorites", JSON.stringify([{ id: "p1" }]));
    localStorage.setItem("cart_backup", "1");
    localStorage.setItem("favorites_backup", "1");
    localStorage.setItem(
      "notificacoes-campanha-estado:u1",
      JSON.stringify({ lida: true }),
    );
    // Lixo que a purga TEM que remover.
    localStorage.setItem("algum_state_corrompido", "lixo");
    localStorage.setItem("cache_antigo_de_terceiro", "lixo");

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <Bomba />
        </GlobalErrorBoundary>,
      );
    });

    expect(hospedeiro.textContent).toContain("Erro Fatal Detectado");

    clicarRecovery();

    // Sobrevive: sessão, carrinho, favoritos, aviso lido.
    expect(localStorage.getItem("sb-projeto-auth-token")).toBe(
      "token-de-sessao",
    );
    expect(localStorage.getItem("marketplace_cart_v1")).toBe(
      JSON.stringify([{ id: 1 }]),
    );
    expect(localStorage.getItem("ikcous_favorites")).toBe(
      JSON.stringify([{ id: "p1" }]),
    );
    expect(localStorage.getItem("cart_backup")).toBe("1");
    expect(localStorage.getItem("favorites_backup")).toBe("1");
    expect(localStorage.getItem("notificacoes-campanha-estado:u1")).toBe(
      JSON.stringify({ lida: true }),
    );

    // Não sobrevive: lixo fora da lista branca.
    expect(localStorage.getItem("algum_state_corrompido")).toBeNull();
    expect(localStorage.getItem("cache_antigo_de_terceiro")).toBeNull();

    expect(reloadEspiao).toHaveBeenCalled();
  });

  it("sessionStorage continua sendo limpo por inteiro (não guarda sessão nem carrinho)", async () => {
    sessionStorage.setItem("qualquer_coisa", "1");

    await act(async () => {
      raiz.render(
        <GlobalErrorBoundary>
          <Bomba />
        </GlobalErrorBoundary>,
      );
    });

    clicarRecovery();

    expect(sessionStorage.getItem("qualquer_coisa")).toBeNull();
  });
});
