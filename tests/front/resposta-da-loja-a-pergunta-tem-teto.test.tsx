// @vitest-environment jsdom
//
// A resposta da loja a uma pergunta de produto não tinha limite: o campo não
// tinha `maxLength` e o texto ia inteiro para a RPC, virando resposta PÚBLICA
// sem teto (a pergunta da cliente já tem 500). Agora a resposta vai até 2000
// caracteres:
//  - a tela limita o campo, mostra o contador e, se o texto passar do teto
//    (texto colado de fora, resposta antiga maior), avisa e não deixa enviar;
//  - o hook recusa antes de chamar o servidor — colar texto enorme pode driblar
//    o `maxLength` do HTML, então a tela sozinha não basta.
import { act, useEffect } from "react";
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

const TETO = 2000;

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
  // Troca a implementação: o ProductQA usa o hook mockado; o teste do hook usa
  // o real. Cada `describe` liga o seu.
  addAnswerDaTela: vi.fn(),
  usarHookReal: false,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1", email: "admin@ikcous.com" },
    profile: { full_name: "Admin", avatar_url: null },
    isAdmin: true,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: { error: h.erro, success: h.sucesso },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
    from: () => ({}),
  },
}));

const pergunta: Question = {
  id: "q-1",
  userId: "u-1",
  productId: "p-1",
  customerName: "Cliente",
  question: "Tem em outras cores?",
  createdAt: "2026-10-01T09:00:00Z",
  answers: [],
};

// ProductQA lê o hook por esta porta; o teste do hook importa o módulo real
// direto de "@/hooks/useQuestions" (por isso o mock abaixo repassa o real
// quando `usarHookReal` está ligado).
vi.mock("@/hooks/useQuestions", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("@/hooks/useQuestions")>();
  return {
    ...real,
    useQuestions: () =>
      h.usarHookReal
        ? real.useQuestions()
        : {
            questions: [pergunta],
            loading: false,
            getQuestionsByProduct: vi.fn(),
            addQuestion: vi.fn(),
            addAnswer: h.addAnswerDaTela,
            subscribeToQuestions: vi.fn(() => () => {}),
          },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("resposta da loja — a tela (ProductQA)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    h.usarHookReal = false;
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(async () => {
    vi.clearAllMocks();
    h.usarHookReal = false;
    h.addAnswerDaTela.mockResolvedValue(true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<ProductQA productId="p-1" />);
    });
    const abrir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Responder Pergunta"),
    );
    await act(async () => {
      abrir?.click();
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  const botaoEnviar = () =>
    hospedeiro.querySelector(
      'button[aria-label="Enviar resposta"]',
    ) as HTMLButtonElement;

  it("o campo da resposta aceita no máximo 2000 caracteres", () => {
    const campo = document.getElementById(
      "qa-reply-q-1",
    ) as HTMLTextAreaElement;
    expect(campo.maxLength).toBe(TETO);
  });

  it("mostra o contador de caracteres, no estilo do campo da pergunta", async () => {
    await act(async () => {
      digitar("qa-reply-q-1", "Temos em 3 cores.");
    });
    expect(hospedeiro.textContent).toContain(`17/${TETO} caracteres`);
    expect(hospedeiro.textContent).not.toContain("Máximo de");
  });

  it("texto colado acima do teto: avisa e não deixa enviar", async () => {
    await act(async () => {
      digitar("qa-reply-q-1", "R".repeat(TETO + 500));
    });
    expect(hospedeiro.textContent).toContain(`Máximo de ${TETO} caracteres`);
    expect(botaoEnviar().disabled).toBe(true);

    await act(async () => {
      botaoEnviar().click();
    });
    expect(h.addAnswerDaTela).not.toHaveBeenCalled();
  });

  it("controle: exatamente no teto envia", async () => {
    await act(async () => {
      digitar("qa-reply-q-1", "R".repeat(TETO));
    });
    expect(hospedeiro.textContent).not.toContain("Máximo de");
    expect(botaoEnviar().disabled).toBe(false);
    await act(async () => {
      botaoEnviar().click();
    });
    expect(h.addAnswerDaTela).toHaveBeenCalledTimes(1);
  });
});

describe("resposta da loja — o hook (addAnswer)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let q: ReturnType<typeof import("@/hooks/useQuestions").useQuestions>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.usarHookReal = true;
    h.rpc.mockResolvedValue({ data: null, error: null });
    const { useQuestions } = await import("@/hooks/useQuestions");
    function Sonda() {
      const lido = useQuestions();
      useEffect(() => {
        q = lido;
      });
      return null;
    }
    hospedeiro = document.createElement("div");
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Sonda />));
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    h.usarHookReal = false;
    vi.restoreAllMocks();
  });

  it("texto acima do teto: recusa sem chamar o servidor e diz o motivo", async () => {
    let r: boolean | undefined;
    await act(async () => {
      r = await q.addAnswer({
        questionId: "q-1",
        answer: "R".repeat(TETO + 1),
      });
    });
    expect(r).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.erro).toHaveBeenCalledWith(
      expect.stringContaining(`${TETO} caracteres`),
    );
  });

  it("o modo silencioso também recusa e avisa (o texto é o problema, não a rede)", async () => {
    let r: boolean | undefined;
    await act(async () => {
      r = await q.addAnswer(
        { questionId: "q-1", answer: "R".repeat(TETO + 1) },
        { silent: true },
      );
    });
    expect(r).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.erro).toHaveBeenCalledWith(
      expect.stringContaining(`${TETO} caracteres`),
    );
  });

  it("controle: exatamente no teto vai ao servidor", async () => {
    let r: boolean | undefined;
    await act(async () => {
      r = await q.addAnswer({ questionId: "q-1", answer: "R".repeat(TETO) });
    });
    expect(r).toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith(
      "answer_question_atomic",
      expect.objectContaining({ p_question_id: "q-1" }),
    );
  });
});
