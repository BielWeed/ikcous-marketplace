// @vitest-environment jsdom
//
// Falha de carregamento não é "Sem perguntas ainda".
//
// Até 25/08/2026 o catch de getQuestionsByProduct só fazia toast (que some
// em segundos) e deixava questions=[]: o feed passava a convidar "Seja o
// primeiro a tirar uma dúvida!" num produto que a consulta não conseguiu
// trazer — podendo ter dez perguntas respondidas. Este teste prende o ramo
// de erro no ProductQA: com `error` no hook e lista vazia, a tela diz "Não
// conseguimos carregar" com retry; o convite fica para o vazio DE VERDADE.
//
// Vermelho analítico contra o HEAD: o ProductQA antigo não lê `error` —
// com este mock renderizaria o "Seja o primeiro" e a asserção de ausência
// reprovaria.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const getQuestionsByProduct = vi.fn();
const subscribeToQuestions = vi.fn(() => () => {});

let erroDaVez: string | null = null;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "cliente@teste.com" },
    profile: null,
    isAdmin: false,
  }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    error: erroDaVez,
    getQuestionsByProduct,
    getAllQuestions: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// product-qa-edit-prefill.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ProductQA — erro de carregamento não é 'Seja o primeiro'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
    erroDaVez = null;
    getQuestionsByProduct.mockClear();
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
  });

  async function renderizar() {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("com erro e lista vazia: mensagem de erro com retry, nunca 'Seja o primeiro'", async () => {
    erroDaVez = "Não conseguimos carregar as perguntas deste produto.";
    const texto = await renderizar();

    expect(texto).toContain("Não conseguimos carregar as perguntas");
    expect(texto).toContain("Tentar de novo");
    expect(texto).not.toContain("Seja o primeiro");

    const retry = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    ) as HTMLButtonElement | undefined;
    expect(retry).toBeDefined();
    await act(async () => {
      retry!.click();
    });
    expect(getQuestionsByProduct).toHaveBeenCalledWith("prod-1");
  });

  it("sem erro e vazio DE VERDADE: o 'Seja o primeiro' continua lá", async () => {
    erroDaVez = null;
    const texto = await renderizar();

    expect(texto).toContain("Seja o primeiro");
    expect(texto).not.toContain("Tentar de novo");
  });
});
