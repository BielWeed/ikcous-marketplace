// @vitest-environment jsdom
//
// ABRIR O APP ESVAZIA O RESÍDUO DE CUPONS NO COFRE LOCAL (caça 4, A1,
// 24/10/2026).
//
// Versões antigas gravavam todos os cupons da loja (código, valor, limite) na
// gaveta `coupons` do IndexedDB `ikcous-datavault`. A versão nova nem busca
// nem grava, e o "Sair" esvazia — mas o aparelho em que a lojista JÁ tinha
// saído antes da atualização continuaria com os códigos lá, para sempre, já
// que ninguém lê nem sobrescreve a gaveta. Na abertura do app a gaveta é
// esvaziada (uma vez por abertura, barato: nada nela é usado).
//
// A limpeza é disparar-e-esquecer: falhar não pode derrubar a abertura do cofre
// nem fazer o app cair no caminho de "purgar todas as gavetas".
//
// Molde: tests/front/realtime-liga-quando-o-cofre-chega-tarde.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider } from "@/contexts/StoreContext";

const controle = vi.hoisted(() => ({
  cofre: null as unknown,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn(async () => controle.cofre),
  },
}));

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function construtorEncadeavel(
  obterResultado: () => Promise<{ data: unknown; error: unknown }>,
): any {
  const alvo: any = () => construtorEncadeavel(obterResultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (
          resolve: (v: unknown) => void,
          rejeitar: (e: unknown) => void,
        ) => obterResultado().then(resolve, rejeitar);
      }
      return () => construtorEncadeavel(obterResultado);
    },
    apply() {
      return construtorEncadeavel(obterResultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => construtorEncadeavel(async () => ({ data: null, error: null })),
    rpc: () => construtorEncadeavel(async () => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function cofreFalso(clear: ReturnType<typeof vi.fn>) {
  return {
    getById: vi.fn().mockResolvedValue(null),
    getAll: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    replaceAll: vi.fn().mockResolvedValue(undefined),
    setLastSync: vi.fn().mockResolvedValue(undefined),
    clear,
  };
}

describe("StoreContext — resíduo de cupons no cofre local", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <div />
        </StoreProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("ao abrir, esvazia SÓ a gaveta de cupons", async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    controle.cofre = cofreFalso(clear);

    await montar();

    expect(clear).toHaveBeenCalledWith("coupons");
    // Catálogo, categorias, configuração: intactos (é o cache offline da loja).
    expect(clear.mock.calls.map(([gaveta]) => gaveta)).toEqual(["coupons"]);
  });

  it("limpeza que falha não derruba a abertura nem dispara a purga de todas as gavetas", async () => {
    const clear = vi.fn().mockRejectedValue(new Error("transação abortada"));
    controle.cofre = cofreFalso(clear);

    await montar();

    expect(clear.mock.calls.map(([gaveta]) => gaveta)).toEqual(["coupons"]);
  });

  it("cofre sem o método (dublê antigo) também não derruba a abertura", async () => {
    const { clear: _semMetodo, ...semClear } = cofreFalso(vi.fn());
    controle.cofre = semClear;
    const espiaDeErro = vi.spyOn(console, "error").mockImplementation(() => {});

    await montar();

    // Se a limpeza lançasse dentro do bloco do cofre, o app cairia no ramo de
    // "falha ao carregar o cofre" e logaria este erro.
    expect(
      espiaDeErro.mock.calls.some(([msg]) =>
        String(msg).includes("DataVault load failed"),
      ),
    ).toBe(false);
    espiaDeErro.mockRestore();
  });
});
