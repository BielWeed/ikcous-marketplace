// @vitest-environment jsdom
//
// Perguntas com dois aparelhos abertos: a folha de resposta guardava uma cópia
// congelada da pergunta, então a resposta mais antiga voltava por cima da mais
// nova e o aviso dizia "enviada com sucesso". Agora o campo intacto acompanha a
// resposta nova, e publicar por cima de uma mudança pede um segundo toque.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const h = vi.hoisted(() => ({
  perguntas: [] as unknown[],
  addAnswer: vi.fn(),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.perguntas,
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: () =>
      Promise.resolve({ questions: h.perguntas, total: h.perguntas.length }),
    addQuestion: vi.fn(),
    addAnswer: h.addAnswer,
    deleteQuestion: vi.fn(),
    subscribeToQuestions: () => () => {},
    getQAStats: async () => ({
      status: "ok",
      total: 1,
      pending: 1,
      answered: 0,
      rate: 0,
    }),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class Stub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pergunta(resposta?: string) {
  return {
    id: "q-1",
    userId: "cliente-1",
    productId: "prod-1",
    productName: "Produto de Teste",
    customerName: "Maria Teste",
    question: "Vocês enviam para o interior?",
    createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    answers: resposta
      ? [
          {
            id: "r-1",
            questionId: "q-1",
            answer: resposta,
            createdAt: new Date("2026-08-21T10:00:00Z").toISOString(),
          },
        ]
      : [],
  };
}

describe("AdminQAView — resposta em dois aparelhos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let sujo: Mock<(sujo: boolean) => void>;

  beforeEach(() => {
    h.addAnswer.mockReset().mockResolvedValue(true);
    vi.mocked(toast.error).mockClear();
    sujo = vi.fn<(sujo: boolean) => void>();
    vi.stubGlobal("IntersectionObserver", Stub);
    vi.stubGlobal("ResizeObserver", Stub);
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

  async function desenhar() {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      // `onNavigate` novo a cada chamada: o componente é memoizado.
      raiz.render(
        <AdminQAView active onNavigate={() => {}} onSetDirty={sujo} />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  function atualizarLista(lista: unknown[]) {
    h.perguntas = lista;
    return desenhar();
  }
  function botao(rotulo: RegExp) {
    const achado = Array.from(document.body.querySelectorAll("button")).find(
      (b) => rotulo.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
    );
    if (!achado) throw new Error(`Botão ausente: ${rotulo}`);
    return achado as HTMLButtonElement;
  }
  async function clicar(el: HTMLButtonElement) {
    await act(async () => {
      el.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  function campo() {
    return document.getElementById("merchant-answer") as HTMLTextAreaElement;
  }
  async function digitar(texto: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(campo(), texto);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("Editar resposta sem mexer: a resposta nova do outro aparelho entra no campo", async () => {
    h.perguntas = [pergunta("Resposta velha")];
    await desenhar();
    await clicar(botao(/^Editar resposta a Maria/));
    expect(campo().value).toBe("Resposta velha");
    await atualizarLista([pergunta("Resposta nova do computador")]);
    expect(campo().value).toBe("Resposta nova do computador");
    expect(sujo).toHaveBeenLastCalledWith(false);
  });

  it("texto já digitado: publicar por cima da resposta nova pede um segundo toque", async () => {
    h.perguntas = [pergunta()];
    await desenhar();
    await clicar(botao(/^Responder a Maria/));
    await digitar("Meu texto do celular");
    await atualizarLista([pergunta("Resposta do computador")]);
    expect(campo().value).toBe("Meu texto do celular");

    await clicar(botao(/Publicar resposta/));
    expect(h.addAnswer).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("mudou em outro aparelho"),
      expect.anything(),
    );

    await clicar(botao(/Publicar resposta/));
    expect(h.addAnswer).toHaveBeenCalledWith(
      { questionId: "q-1", answer: "Meu texto do celular" },
      { silent: true },
    );
  });

  it("pergunta que sumiu da lista (respondida ou excluída fora): também pede um segundo toque", async () => {
    h.perguntas = [pergunta()];
    await desenhar();
    await clicar(botao(/^Responder a Maria/));
    await digitar("Meu texto do celular");
    await atualizarLista([]);

    await clicar(botao(/Publicar resposta/));
    expect(h.addAnswer).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("mudou em outro aparelho"),
      expect.anything(),
    );

    await clicar(botao(/Publicar resposta/));
    expect(h.addAnswer).toHaveBeenCalledTimes(1);
  });

  it("nada mudou fora: publicar segue direto", async () => {
    h.perguntas = [pergunta("Resposta velha")];
    await desenhar();
    await clicar(botao(/^Editar resposta a Maria/));
    await digitar("Resposta corrigida");
    await clicar(botao(/Publicar resposta/));
    expect(h.addAnswer).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
