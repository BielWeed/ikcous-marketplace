// @vitest-environment jsdom
//
// Perguntas: o filtro "Pendentes" (o padrão, e fica guardado no aparelho)
// também limita a busca. Busca sem resultado nele culpava a escrita ("Confira
// a escrita"), mas o motivo era o filtro. A tela agora diz que a busca está só
// em Pendentes e oferece ver em Todas, sem perder o que foi digitado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    perguntas: [] as any[],
  };
  const getAllQuestions = vi.fn((..._args: unknown[]) =>
    Promise.resolve({ questions: estado.perguntas, total: 0 }),
  );
  async function getQAStats(): Promise<unknown> {
    return { status: "ok", total: 6, pending: 2, answered: 4, rate: 67 };
  }
  return { estado, getAllQuestions, getQAStats };
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
    subscribeToQuestions: () => () => {},
    getQAStats: h.getQAStats,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

describe("AdminQAView — busca vazia em Pendentes", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    h.estado.perguntas = [];
    h.getAllQuestions.mockClear();
    armazem.clear();
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
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
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
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
  });

  async function montar() {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  const norm = (t: string | null | undefined) =>
    (t ?? "").replace(/\s+/g, " ").trim();
  const botaoPorTexto = (texto: string) =>
    Array.from(document.body.querySelectorAll("button")).find(
      (b) => norm(b.textContent) === texto,
    );

  it("em Pendentes a frase fala do filtro, não da escrita, e 'Ver em Todas' refaz a busca em Todas", async () => {
    armazem.set("admin_qa_search_query", JSON.stringify("giz azul"));
    armazem.set("admin_qa_filter", JSON.stringify("pending"));
    await montar();

    const tela = norm(hospedeiro.textContent);
    expect(tela).toContain("giz azul");
    expect(tela).toContain("A busca olha só as pendentes");
    expect(tela).not.toContain("Confira a escrita");

    const antes = h.getAllQuestions.mock.calls.length;
    const ver = botaoPorTexto("Ver em Todas");
    expect(ver).toBeTruthy();
    await act(async () => {
      ver!.click();
      await esperar();
    });

    expect(JSON.parse(armazem.get("admin_qa_filter") ?? "null")).toBe("all");
    expect(h.getAllQuestions.mock.calls.length).toBeGreaterThan(antes);
    const chamada = h.getAllQuestions.mock.calls.at(-1) as unknown[];
    expect(chamada[3]).toBe("giz azul");
  });

  it("em Todas a busca vazia segue falando da escrita (controle)", async () => {
    armazem.set("admin_qa_search_query", JSON.stringify("giz azul"));
    armazem.set("admin_qa_filter", JSON.stringify("all"));
    await montar();

    const tela = norm(hospedeiro.textContent);
    expect(tela).toContain("Confira a escrita");
    expect(tela).not.toContain("A busca olha só as pendentes");
    expect(botaoPorTexto("Ver em Todas")).toBeUndefined();
  });
});
