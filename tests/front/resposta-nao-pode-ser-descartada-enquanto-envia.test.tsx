// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => {
  const perguntas = [
    {
      id: "q1",
      userId: "cliente-ficticia",
      productId: "p1",
      productName: "Presente",
      customerName: "Cliente Teste",
      question: "Tem estoque?",
      createdAt: "2026-11-17T10:00:00Z",
      answers: [],
    },
  ];
  return {
    perguntas,
    addAnswer: vi.fn(),
    toastError: vi.fn(),
    getAllQuestions: async () => ({ questions: perguntas, total: 1 }),
    getQAStats: async () => ({
      status: "ok",
      total: 1,
      pending: 1,
      answered: 0,
      rate: 0,
    }),
    subscribeToQuestions: () => () => {},
  };
});
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.perguntas,
    loading: false,
    addAnswer: h.addAnswer,
    getAllQuestions: h.getAllQuestions,
    getQAStats: h.getQAStats,
    subscribeToQuestions: h.subscribeToQuestions,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: h.toastError } }));
let raiz: Root;
let hospedeiro: HTMLDivElement;
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function botao(texto: string) {
  const b = Array.from(document.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
  expect(b).toBeTruthy();
  return b!;
}
it.each([
  null,
  { message: "JWT expired", status: 401 },
  { message: "Falha de rede" },
])(
  "preserva a resposta durante o envio e explica a falha %j",
  async (causa) => {
    h.toastError.mockClear();
    class Observador {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Observador);
    vi.stubGlobal("IntersectionObserver", Observador);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    let concluir!: (valor: boolean) => void;
    h.addAnswer.mockImplementation(
      (_answer, options) =>
        new Promise<boolean>((resolve) => {
          concluir = (valor) => {
            if (causa) options?.onError?.(causa);
            resolve(valor);
          };
        }),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () =>
      raiz.render(<AdminQAView onNavigate={() => {}} active />),
    );
    await act(async () => botao("Responder").click());
    const campo = document.getElementById(
      "merchant-answer",
    ) as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(campo, "Sim, temos.");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => botao("Publicar resposta").click());
    expect(botao("Descartar").disabled).toBe(true);
    expect(botao("Fechar").disabled).toBe(true);
    await act(async () => {
      botao("Descartar").click();
      botao("Fechar").click();
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.body.textContent).not.toContain("será perdido");
    expect(document.getElementById("merchant-answer")).toBe(campo);
    await act(async () => concluir(false));
    expect(botao("Descartar").disabled).toBe(false);
    expect(botao("Fechar").disabled).toBe(false);
    expect(campo.value).toBe("Sim, temos.");
    expect(h.toastError).toHaveBeenCalledWith(
      causa && "status" in causa
        ? "Sua sessão expirou. Entre de novo para enviar a resposta — o texto continua aqui."
        : "Não foi possível confirmar o envio da resposta. Confira na lista antes de tentar de novo.",
    );
    expect(h.toastError).toHaveBeenCalledTimes(1);
  },
);
