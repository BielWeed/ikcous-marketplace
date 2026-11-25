// @vitest-environment jsdom
//
// Os relógios do botão "Adicionar ao Carrinho" não podem sobreviver à tela.
//
// Depois de pedir ao carrinho, `handleAddToCart` segura o botão em "Adicionando"
// por 750 ms, passa a "Adicionado" e, 1500 ms depois, volta a "Adicionar". Os
// dois `setTimeout` não eram guardados: se a tela do produto era desmontada
// antes (cliente voltou logo depois de tocar; nos testes, o último teste de um
// arquivo terminando logo depois do clique), o relógio disparava com a janela já
// fechada e o vitest saía com código 1, com todos os testes verdes
// ("Uncaught Exception: ReferenceError: window is not defined", pilha em
// ProductView.tsx -> dispatchSetState).
//
// Prova na ProductView de VERDADE, com o relógio falso do vitest. O `setTimeout`
// é espionado com passagem direta e o teste registra, por prazo (750 ms e
// 1500 ms), quem foi criado, quem foi cancelado e quantas vezes o callback
// rodou. Um registro NOVO por teste: um relógio que vazasse de um teste
// (justamente o defeito) dispara no registro do teste dele.
//
// Irmão de app-relogio-de-350ms-do-voltar-cancela-ao-desmontar (mesmo defeito,
// no App). Dublês e stubs copiados de
// product-view-adicionar-fala-para-leitor-de-tela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
  }),
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-relogios-do-botao",
  name: "Caderno Bom",
  description: "Descrição de teste",
  price: 20,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};

const ATRASO_DO_ADICIONANDO_MS = 750;
const ATRASO_DO_ADICIONADO_MS = 1500;
const PRAZOS = [ATRASO_DO_ADICIONANDO_MS, ATRASO_DO_ADICIONADO_MS];

const nomeAcessivel = (el: Element) =>
  (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();

describe("ProductView — os relógios do botão Adicionar são cancelados ao desmontar", () => {
  let raiz: Root | null = null;
  let hospedeiro: HTMLElement;
  let onAddToCart: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  const novoRegistro = () => ({
    criados: [] as Array<{
      id: ReturnType<typeof setTimeout>;
      atraso: number;
    }>,
    cancelados: [] as Array<unknown>,
    disparos: [] as number[],
  });
  let registro = novoRegistro();

  beforeEach(() => {
    registro = novoRegistro();
    const dono = registro;

    vi.useFakeTimers();
    // Os dois espiões embrulham o relógio FALSO (instalado acima).
    const setTimeoutFalso = globalThis.setTimeout;
    const clearTimeoutFalso = globalThis.clearTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: (...args: unknown[]) => void,
      atraso?: number,
      ...resto: unknown[]
    ) => {
      if (atraso === undefined || !PRAZOS.includes(atraso)) {
        return setTimeoutFalso(callback, atraso, ...resto);
      }
      const id = setTimeoutFalso(
        (...args: unknown[]) => {
          dono.disparos.push(atraso);
          callback(...args);
        },
        atraso,
        ...resto,
      );
      dono.criados.push({ id, atraso });
      return id;
    }) as typeof setTimeout);
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(((
      id?: ReturnType<typeof setTimeout>,
    ) => {
      dono.cancelados.push(id);
      return clearTimeoutFalso(id);
    }) as typeof clearTimeout);

    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    onAddToCart = vi.fn<(q: number, v?: string, n?: string) => void>();
  });

  afterEach(() => {
    const paraDesmontar = raiz;
    raiz = null;
    act(() => {
      paraDesmontar?.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz?.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={onAddToCart}
          onBack={() => {}}
        />,
      );
    });
  }

  const ctaPrincipal = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      /adicionar ao carrinho|adicionando|adicionado/i.test(nomeAcessivel(b)),
    )!;

  const tocarEmAdicionar = async () => {
    await act(async () => {
      ctaPrincipal().click();
    });
  };

  const avancar = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  const desmontar = async () => {
    const paraDesmontar = raiz;
    raiz = null;
    await act(async () => {
      paraDesmontar?.unmount();
    });
  };

  it("o toque arma o relógio de 750 ms (premissa do teste)", async () => {
    await montar();
    await tocarEmAdicionar();

    expect(registro.criados.map((c) => c.atraso)).toEqual([
      ATRASO_DO_ADICIONANDO_MS,
    ]);
    expect(nomeAcessivel(ctaPrincipal())).toMatch(/adicionando/i);
  });

  it("desmontar antes dos 750 ms cancela o relógio, e nada roda depois", async () => {
    await montar();
    await tocarEmAdicionar();
    const [primeiro] = registro.criados;
    expect(primeiro?.atraso).toBe(ATRASO_DO_ADICIONANDO_MS);
    const pendentesAntes = vi.getTimerCount();

    await desmontar();

    expect(registro.cancelados).toContain(primeiro.id);
    // O relógio saiu da fila (nada ficou agendado por causa do toque).
    expect(vi.getTimerCount()).toBeLessThan(pendentesAntes);

    // Passa dos dois prazos. Sem o cancelamento, o callback roda aqui, com a
    // tela já desmontada (e, no vitest, com o jsdom já derrubado).
    await avancar(ATRASO_DO_ADICIONANDO_MS + ATRASO_DO_ADICIONADO_MS + 100);
    expect(registro.disparos).toEqual([]);
    expect(registro.criados).toHaveLength(1);
  });

  it("desmontar no 'Adicionado' (depois dos 750 ms) cancela o relógio de 1500 ms", async () => {
    await montar();
    await tocarEmAdicionar();
    await avancar(ATRASO_DO_ADICIONANDO_MS);

    expect(registro.disparos).toEqual([ATRASO_DO_ADICIONANDO_MS]);
    expect(registro.criados.map((c) => c.atraso)).toEqual([
      ATRASO_DO_ADICIONANDO_MS,
      ATRASO_DO_ADICIONADO_MS,
    ]);
    expect(nomeAcessivel(ctaPrincipal())).toMatch(/adicionado/i);
    const segundo = registro.criados[1];

    await desmontar();

    expect(registro.cancelados).toContain(segundo.id);

    await avancar(ATRASO_DO_ADICIONADO_MS + 100);
    expect(registro.disparos).toEqual([ATRASO_DO_ADICIONANDO_MS]);
  });

  it("controle: com a tela montada nada é cancelado e o botão faz Adicionando -> Adicionado -> Adicionar", async () => {
    await montar();
    await tocarEmAdicionar();
    const botao = ctaPrincipal();
    expect(nomeAcessivel(botao)).toMatch(/adicionando/i);

    await avancar(ATRASO_DO_ADICIONANDO_MS);
    expect(nomeAcessivel(botao)).toMatch(/adicionado/i);

    await avancar(ATRASO_DO_ADICIONADO_MS);
    expect(nomeAcessivel(botao)).toMatch(/adicionar ao carrinho/i);
    expect(botao.hasAttribute("aria-disabled")).toBe(false);

    expect(registro.disparos).toEqual([
      ATRASO_DO_ADICIONANDO_MS,
      ATRASO_DO_ADICIONADO_MS,
    ]);
    for (const { id } of registro.criados) {
      expect(registro.cancelados).not.toContain(id);
    }
  });
});
