// @vitest-environment jsdom
//
// Perguntas ao vendedor (ProductQA) — bordas sem guarda:
//  1. Resposta da loja EXATAMENTE no teto (2000) ainda pode ser enviada; com 2001
//     o botão trava e o aviso aparece.
//  2. Depois de responder (com sucesso OU falha) a lista é lida de novo, e na
//     falha a caixa continua aberta com o texto.
//  3. Cancelar a resposta solta a marca "digitando" (a atualização do app não
//     fica esperando um texto que já sumiu); uma resposta lenta que chega
//     depois de a admin abrir OUTRA caixa não fecha a nova; sair da tela
//     cancela a assinatura em tempo real.
//  4. A foto e o nome do autor só levam ao perfil quando a pergunta TEM autor
//     (visitante sem sessão não recebe `userId`); o nome vira botão de teclado:
//     Enter e Espaço abrem o perfil e seguram o comportamento padrão; outra
//     tecla não.
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

import type { Question } from "@/hooks/useQuestions";
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";

const addQuestion = vi.fn();
const addAnswer = vi.fn();
const getQuestionsByProduct = vi.fn();
const subscribeToQuestions = vi.fn(() => () => {});

const estado = vi.hoisted(() => ({
  questions: [] as unknown[],
  isAdmin: false,
  error: null as string | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "cliente-1", email: "cliente@exemplo.test" },
    profile: { full_name: "Érica Álvares", avatar_url: null },
    isAdmin: estado.isAdmin,
  }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: estado.questions,
    loading: false,
    error: estado.error,
    getQuestionsByProduct,
    addQuestion,
    addAnswer,
    subscribeToQuestions,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pergunta(id: string, extra: Partial<Question> = {}): Question {
  return {
    id,
    productId: "prod-1",
    customerName: "Maria de Souza",
    question: "Tem em azul?",
    createdAt: "2026-10-01T10:00:00Z",
    answers: [],
    ...extra,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

beforeAll(async () => {
  ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
}, 60_000);

beforeEach(() => {
  addAnswer.mockReset();
  getQuestionsByProduct.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  estado.questions = [];
  estado.isAdmin = false;
  estado.error = null;
});

async function montar(onNavigate?: (view: string, id?: string) => void) {
  await act(async () => {
    raiz.render(<ProductQA productId="prod-1" onNavigate={onNavigate} />);
  });
}

async function digitarResposta(id: string, texto: string) {
  const area = document.getElementById(`qa-reply-${id}`) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(area, texto);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const botaoResponder = () =>
  [...hospedeiro.querySelectorAll("button")].find((b) =>
    /Responder Pergunta/i.test(b.textContent ?? ""),
  ) as HTMLButtonElement;
const botaoSalvarEdicao = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    'button[aria-label="Salvar edição"]',
  ) as HTMLButtonElement;
const botaoEnviarResposta = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    'button[aria-label="Enviar resposta"]',
  ) as HTMLButtonElement;

describe("ProductQA — resposta da loja no teto", () => {
  beforeEach(() => {
    estado.isAdmin = true;
    estado.questions = [pergunta("q1")];
  });

  async function abrirCaixa() {
    await montar();
    await act(async () => {
      botaoResponder().click();
    });
  }

  it("2000 caracteres ainda envia; 2001 trava o botão e mostra o aviso", async () => {
    await abrirCaixa();

    await digitarResposta("q1", "a".repeat(2000));
    expect(botaoEnviarResposta().disabled).toBe(false);
    expect(hospedeiro.textContent).toContain("2000/2000 caracteres");
    expect(hospedeiro.textContent).not.toContain("Máximo de 2000 caracteres");

    await digitarResposta("q1", "a".repeat(2001));
    expect(botaoEnviarResposta().disabled).toBe(true);
    expect(hospedeiro.textContent).toContain("Máximo de 2000 caracteres");
  });

  it("responder com sucesso lê a lista de novo e fecha a caixa", async () => {
    addAnswer.mockResolvedValue(true);
    await abrirCaixa();
    await digitarResposta("q1", "Temos em azul, sim.");
    getQuestionsByProduct.mockClear();

    await act(async () => {
      botaoEnviarResposta().click();
    });

    expect(addAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: "q1",
      answer: "Temos em azul, sim.",
    });
    expect(getQuestionsByProduct).toHaveBeenCalledExactlyOnceWith("prod-1");
    expect(document.getElementById("qa-reply-q1")).toBeNull();
  });

  it("falha ao responder: lê a lista de novo, mas a caixa e o texto ficam", async () => {
    addAnswer.mockResolvedValue(false);
    await abrirCaixa();
    await digitarResposta("q1", "Resposta que não foi salva");
    getQuestionsByProduct.mockClear();

    await act(async () => {
      botaoEnviarResposta().click();
    });

    expect(getQuestionsByProduct).toHaveBeenCalledExactlyOnceWith("prod-1");
    const area = document.getElementById("qa-reply-q1") as HTMLTextAreaElement;
    expect(area).not.toBeNull();
    expect(area.value).toBe("Resposta que não foi salva");
  });
});

describe("ProductQA — caixa de resposta: cancelar, resposta lenta e sair da tela", () => {
  beforeEach(() => {
    estado.isAdmin = true;
  });

  it('cancelar solta a marca de "digitando" (atualização do app não espera à toa)', async () => {
    estado.questions = [pergunta("q1")];
    await montar();
    await act(async () => {
      botaoResponder().click();
    });
    await digitarResposta("q1", "texto pela metade");
    expect(haOperacaoSensivel()).toBe(true);

    await act(async () => {
      [...hospedeiro.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Cancelar")
        ?.click();
    });
    expect(document.getElementById("qa-reply-q1")).toBeNull();
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("resposta lenta da pergunta 1 não fecha a caixa que a admin abriu na pergunta 2", async () => {
    estado.questions = [
      pergunta("q1", {
        answers: [
          {
            id: "a1",
            questionId: "q1",
            answer: "Resposta velha da 1",
            createdAt: "2026-10-02T10:00:00Z",
          },
        ],
      }),
      pergunta("q2", {
        answers: [
          {
            id: "a2",
            questionId: "q2",
            answer: "Resposta velha da 2",
            createdAt: "2026-10-02T10:00:00Z",
          },
        ],
      }),
    ];
    let terminar: (ok: boolean) => void = () => {};
    addAnswer.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          terminar = resolve;
        }),
    );
    await montar();
    const editar = () =>
      [...hospedeiro.querySelectorAll("button")].filter((b) =>
        /Editar Resposta/i.test(b.textContent ?? ""),
      );

    await act(async () => {
      editar()[0].click();
    });
    // A caixa da 1 já vem com o texto antigo: envia sem digitar nada.
    await act(async () => {
      botaoSalvarEdicao().click();
    });
    expect(addAnswer).toHaveBeenCalledTimes(1);

    // Com o envio da 1 ainda pendente, a admin abre a caixa da pergunta 2.
    await act(async () => {
      editar()[0].click();
    });
    const caixa2 = document.getElementById(
      "qa-reply-q2",
    ) as HTMLTextAreaElement;
    expect(caixa2.value).toBe("Resposta velha da 2");

    await act(async () => {
      terminar(true);
    });
    const depois = document.getElementById(
      "qa-reply-q2",
    ) as HTMLTextAreaElement;
    expect(depois).not.toBeNull();
    expect(depois.value).toBe("Resposta velha da 2");
  });

  it("ao sair da tela cancela a assinatura em tempo real (e só uma vez)", async () => {
    const cancelar = vi.fn();
    subscribeToQuestions.mockReturnValueOnce(cancelar);
    estado.questions = [pergunta("q1")];
    await montar();
    expect(cancelar).not.toHaveBeenCalled();
    act(() => {
      raiz.unmount();
    });
    expect(cancelar).toHaveBeenCalledTimes(1);
    raiz = createRoot(hospedeiro);
  });
});

describe("ProductQA — falha ao carregar", () => {
  it("erro com a lista VAZIA mostra o aviso; erro com perguntas já na tela mantém a lista", async () => {
    estado.error = "rede caiu";
    estado.questions = [];
    await montar();
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos carregar as perguntas",
    );

    estado.questions = [pergunta("q1", { question: "Serve no tamanho M?" })];
    await montar();
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).toContain("Serve no tamanho M?");
  });
});

describe("ProductQA — foto e nome do autor da pergunta", () => {
  const foto = () =>
    hospedeiro.querySelector<HTMLElement>('div[aria-hidden="true"].shrink-0');
  const nome = () =>
    hospedeiro.querySelector<HTMLElement>("span.truncate") as HTMLElement;
  function apertar(alvo: HTMLElement, key: string) {
    const evento = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      alvo.dispatchEvent(evento);
    });
    return evento.defaultPrevented;
  }

  it("sem userId (visitante) ou sem onNavigate: nada navega e o nome não é botão", async () => {
    const onNavigate = vi.fn();
    estado.questions = [pergunta("q1")];
    await montar(onNavigate);
    await act(async () => {
      foto()?.click();
      nome().click();
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(nome().getAttribute("role")).toBeNull();
    expect(nome().getAttribute("tabindex")).toBeNull();
    expect(apertar(nome(), "Enter")).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();

    estado.questions = [pergunta("q1", { userId: "u-9" })];
    await montar(undefined);
    await act(async () => {
      foto()?.click();
    });
    expect(nome().getAttribute("role")).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("com userId e onNavigate: foto e nome abrem o perfil; Enter e Espaço também", async () => {
    const onNavigate = vi.fn();
    estado.questions = [pergunta("q1", { userId: "u-9" })];
    await montar(onNavigate);

    await act(async () => {
      foto()?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("user-profile", "u-9");

    expect(nome().getAttribute("role")).toBe("button");
    expect(nome().getAttribute("tabindex")).toBe("0");

    onNavigate.mockClear();
    expect(apertar(nome(), "Enter")).toBe(true);
    expect(apertar(nome(), " ")).toBe(true);
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenNthCalledWith(1, "user-profile", "u-9");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "user-profile", "u-9");

    onNavigate.mockClear();
    expect(apertar(nome(), "a")).toBe(false);
    expect(apertar(nome(), "Tab")).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
