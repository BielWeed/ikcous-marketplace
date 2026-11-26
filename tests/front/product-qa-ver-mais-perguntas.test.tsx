// @vitest-environment jsdom
//
// Loja grande (26/11/2026): a página do produto passou a ler só as 20
// perguntas mais recentes, e a tela não tinha como chegar nas outras. Num
// produto com mais de 20, as antigas (já respondidas, que valem como perguntas
// frequentes) sumiam da vitrine sem aviso. "Ver mais perguntas" é o caminho
// até elas: só aparece quando o hook diz que há mais, pede a próxima leva do
// produto aberto e, enquanto ela vem, avisa que está carregando e não aceita
// um segundo toque.
//
// O hook é dublado aqui: quem prova a leitura (teto, resposta velha, clique
// duplo no hook) é avaliacoes-e-perguntas-da-vitrine-com-limite.test.tsx.
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

const h = vi.hoisted(() => ({
  haMaisPerguntas: false,
  carregandoMaisPerguntas: false,
  carregarMaisPerguntas: vi.fn(async (_productId: string) => {}),
  questions: [] as unknown[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.questions,
    loading: false,
    error: null,
    haMaisPerguntas: h.haMaisPerguntas,
    carregandoMaisPerguntas: h.carregandoMaisPerguntas,
    carregarMaisPerguntas: h.carregarMaisPerguntas,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    subscribeToQuestions: vi.fn(() => () => {}),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function perguntas(quantas: number) {
  return Array.from({ length: quantas }, (_, i) => ({
    id: `q${i + 1}`,
    productId: "prod-1",
    customerName: "Cliente",
    question: `Pergunta ${i + 1}`,
    createdAt: "2026-11-01T12:00:00Z",
    answers: [],
  }));
}

describe("ProductQA — ver mais perguntas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
    h.haMaisPerguntas = false;
    h.carregandoMaisPerguntas = false;
    h.carregarMaisPerguntas.mockReset();
    h.carregarMaisPerguntas.mockImplementation(async () => {});
    h.questions = perguntas(20);
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

  async function renderizar() {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });
  }

  const botaoVerMais = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      /ver mais perguntas|carregando perguntas/i.test(b.textContent ?? ""),
    ) as HTMLButtonElement | undefined;

  it("sem mais perguntas no banco: nenhum botão de ver mais", async () => {
    await renderizar();
    expect(botaoVerMais()).toBeUndefined();
  });

  it("com mais no banco: o botão aparece e pede a próxima leva do produto aberto", async () => {
    h.haMaisPerguntas = true;
    await renderizar();

    const botao = botaoVerMais();
    expect(botao?.textContent).toBe("Ver mais perguntas");
    expect(botao?.disabled).toBe(false);
    // O mesmo estilo do "Ver mais avaliações" da página do produto.
    expect(botao?.className).toContain(
      "mt-4 min-h-11 w-full rounded-xl border border-zinc-200 px-4 text-sm font-bold text-zinc-900",
    );

    await act(async () => {
      botao?.click();
    });
    expect(h.carregarMaisPerguntas).toHaveBeenCalledTimes(1);
    expect(h.carregarMaisPerguntas).toHaveBeenCalledWith("prod-1");
  });

  it("enquanto a próxima leva vem: diz que está carregando e o toque não pede de novo", async () => {
    h.haMaisPerguntas = true;
    h.carregandoMaisPerguntas = true;
    await renderizar();

    const botao = botaoVerMais();
    expect(botao?.textContent).toBe("Carregando perguntas...");
    expect(botao?.disabled).toBe(true);
    expect(botao?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      botao?.click();
    });
    expect(h.carregarMaisPerguntas).not.toHaveBeenCalled();
  });

  it("dois toques no mesmo instante (antes de a tela redesenhar): um pedido só", async () => {
    h.haMaisPerguntas = true;
    h.carregarMaisPerguntas.mockImplementation(() => new Promise(() => {}));
    await renderizar();

    const botao = botaoVerMais();
    await act(async () => {
      botao?.click();
      botao?.click();
    });
    expect(h.carregarMaisPerguntas).toHaveBeenCalledTimes(1);
  });

  it("produto sem nenhuma pergunta: o convite fica, sem botão de ver mais", async () => {
    h.haMaisPerguntas = true;
    h.questions = [];
    await renderizar();

    expect(hospedeiro.textContent).toContain("Sem perguntas ainda");
    expect(botaoVerMais()).toBeUndefined();
  });
});
