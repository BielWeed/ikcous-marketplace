// @vitest-environment jsdom
//
// A data da pergunta na tela Perguntas é a do calendário da LOJA (Brasília),
// a mesma do cartão e da ficha do pedido — não a do aparelho. Pergunta feita
// às 00:30 de 27/11 em Brasília é 23:30 de 26/11 em Manaus: a lojista com o
// aparelho lá lia "26/11/2026". Dublês de `useQuestions` no mesmo molde de
// `admin-qa-view-erro-nao-e-fila-limpa.test.tsx`; o fuso do processo é
// trocado por `process.env.TZ` e volta ao que era depois de cada teste.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PERGUNTA_00H30_BRT = "2026-11-27T03:30:00.000Z";

const h = vi.hoisted(() => {
  const estado = { perguntas: [] as unknown[] };
  const getQAStats = async () => ({
    status: "ok",
    stats: { total: 1, answered: 0, pending: 1, avgResponseTime: 0 },
  });
  const getAllQuestions = () =>
    Promise.resolve({
      questions: estado.perguntas,
      total: estado.perguntas.length,
    });
  const subscribeToQuestions = () => () => {};
  return { estado, getQAStats, getAllQuestions, subscribeToQuestions };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.estado.perguntas,
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: h.getAllQuestions,
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions: h.subscribeToQuestions,
    getQAStats: h.getQAStats,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("AdminQAView — data da pergunta no fuso da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.estado.perguntas = [
      {
        id: "q-1",
        userId: "cliente-1",
        productId: "prod-1",
        productName: "Produto de Teste",
        customerName: "Maria Teste",
        question: "Vocês enviam para o interior?",
        createdAt: PERGUNTA_00H30_BRT,
        answers: [],
      },
    ];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.TZ = fusoDaMaquina;
  });

  it.each(["America/Manaus", "UTC", "America/Sao_Paulo"])(
    "aparelho em %s mostra a pergunta em 27/11/2026 (Brasília)",
    async (fuso) => {
      process.env.TZ = fuso;
      const { AdminQAView } = await import("@/views/admin/AdminQAView");
      await act(async () => {
        raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const tela = hospedeiro.textContent ?? "";
      expect(tela).toContain("Vocês enviam para o interior?");
      expect(tela).toContain("27/11/2026");
      expect(tela).not.toContain("26/11/2026");
    },
  );
});
