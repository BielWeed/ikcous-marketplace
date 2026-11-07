import { useQuestions } from "@/hooks/useQuestions";
import { useReviews } from "@/hooks/useReviews";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  pendurarEnvio: false,
  pendurarLeitura: false,
  falharLeitura: false,
  linhas: [] as unknown[],
  conferida: null as unknown,
  desmarcar: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "comprador-ficticio" }, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/atualizacao/operacao-sensivel", () => ({
  marcarOperacaoSensivel: () => h.desmarcar,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      let envio = false;
      let conferencia = false;
      const b: any = {};
      for (const nome of [
        "select",
        "eq",
        "order",
        "in",
        "maybeSingle",
        "single",
        "abortSignal",
      ]) {
        // eslint-disable-next-line security/detect-object-injection -- nomes fixos do builder de teste
        b[nome] = () => b;
      }
      b.limit = () => b;
      b.maybeSingle = () => {
        conferencia = true;
        return b;
      };
      b.insert = () => {
        envio = true;
        return b;
      };
      // biome-ignore lint/suspicious/noThenProperty: builder Supabase simulado
      b.then = (resolve: any, reject: any) => {
        const resposta = envio
          ? h.pendurarEnvio
            ? new Promise(() => {})
            : {
                data: {
                  id: "nova",
                  product_id: "produto-rede",
                  question: "Tem azul?",
                  created_at: "2026-11-07T00:00:00Z",
                },
                error: null,
              }
          : conferencia
            ? { data: tabela === "reviews" ? h.conferida : null, error: null }
            : h.pendurarLeitura
              ? new Promise(() => {})
              : h.falharLeitura
                ? { data: null, error: { message: "rede caiu" } }
                : { data: tabela === "questions" ? h.linhas : [], error: null };
        return Promise.resolve(resposta).then(resolve, reject);
      };
      return b;
    },
  },
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let host: HTMLDivElement;
let reviews: ReturnType<typeof useReviews>;
let questions: ReturnType<typeof useQuestions>;
function Sonda() {
  const r = useReviews();
  const q = useQuestions();
  useEffect(() => {
    reviews = r;
    questions = q;
  });
  return null;
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.pendurarEnvio = false;
  h.pendurarLeitura = false;
  h.falharLeitura = false;
  h.linhas = [];
  h.conferida = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  raiz = createRoot(host);
  await act(async () => {
    raiz.render(<Sonda />);
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("pergunta confirmada na releitura após prazo limpa o campo e desliga o reenvio", async () => {
  const { ProductQA } = await import("@/components/ui/custom/ProductQA");
  document.body.appendChild(host);
  await act(async () => {
    raiz.render(<ProductQA productId="produto-formulario-prazo" />);
  });
  const input = host.querySelector<HTMLInputElement>("#qa-new-question")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Tem azul?");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  h.pendurarEnvio = true;
  h.linhas = [
    {
      id: "pergunta-recebida-tela",
      product_id: "produto-formulario-prazo",
      user_id: "comprador-ficticio",
      question: "Tem azul?",
      created_at: "2026-11-07T00:00:00Z",
      answers: [],
    },
  ];
  const enviar = host.querySelector<HTMLButtonElement>(
    '[aria-label="Enviar pergunta"]',
  )!;
  await act(async () => {
    enviar.click();
    await vi.advanceTimersByTimeAsync(15001);
  });
  expect(input.value).toBe("");
  expect(enviar.disabled).toBe(true);
  expect(host.textContent).toContain("Tem azul?");
});
it("pergunta já recebida após prazo devolve confirmação para limpar o formulário", async () => {
  h.pendurarEnvio = true;
  h.linhas = [
    {
      id: "nova-recebida",
      product_id: "produto-prazo-confirmado",
      user_id: "comprador-ficticio",
      question: "Tem azul?",
      created_at: "2026-11-07T00:00:00Z",
      answers: [],
    },
  ];
  let resultado: unknown = null;
  await act(async () => {
    void questions
      .addQuestion({
        productId: "produto-prazo-confirmado",
        question: "Tem azul?",
      })
      .then((r) => {
        resultado = r;
      });
    await vi.advanceTimersByTimeAsync(15001);
  });
  expect(resultado).toMatchObject({ id: "nova-recebida" });
  expect(questions.questions.map((q) => q.id)).toContain("nova-recebida");
});
it("avaliação recebida após prazo devolve confirmação ao pedido em vez de oferecer reenviar", async () => {
  h.pendurarEnvio = true;
  h.conferida = { id: "avaliacao-recebida" };
  let resultado: unknown = null;
  await act(async () => {
    void reviews
      .addReview({ productId: "produto-confirmado", rating: 5, comment: "Bom" })
      .then((r) => {
        resultado = r;
      });
    await vi.advanceTimersByTimeAsync(15001);
  });
  expect(resultado).toMatchObject({ id: "avaliacao-recebida" });
});
it("carga inicial falhou: envio confirmado não esconde o erro nem guarda lista parcial", async () => {
  h.falharLeitura = true;
  await act(async () => {
    await questions.getQuestionsByProduct("produto-carga-falhou");
  });
  expect(questions.error).toBeTruthy();
  await act(async () => {
    await questions.addQuestion({
      productId: "produto-carga-falhou",
      question: "Tem azul?",
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  expect(questions.error).toBeTruthy();
  expect(questions.questions.map((q) => q.id)).toContain("nova");
  await act(async () => {
    await questions.getQuestionsByProduct("produto-carga-falhou");
  });
  expect(questions.questions).toHaveLength(0);
});
it("confirmação do mesmo id não duplica a pergunta que já veio na lista", async () => {
  h.linhas = [
    {
      id: "nova",
      product_id: "produto-sem-duplicata",
      user_id: "comprador-ficticio",
      question: "Tem azul?",
      created_at: "2026-11-07T00:00:00Z",
      answers: [],
    },
  ];
  await act(async () => {
    await questions.getQuestionsByProduct("produto-sem-duplicata");
  });
  h.pendurarLeitura = true;
  await act(async () => {
    await questions.addQuestion({
      productId: "produto-sem-duplicata",
      question: "Tem azul?",
    });
  });
  expect(questions.questions.filter((q) => q.id === "nova")).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15001);
  });
});
it.each(["avaliação", "pergunta"])(
  "solta o envio de %s sem resposta e avisa da possível gravação",
  async (tipo) => {
    h.pendurarEnvio = true;
    let terminou = false;
    await act(async () => {
      const envio =
        tipo === "avaliação"
          ? reviews.addReview({
              productId: "produto-rede",
              rating: 5,
              comment: "Bom",
            })
          : questions.addQuestion({
              productId: "produto-rede",
              question: "Tem azul?",
            });
      void envio.then(() => {
        terminou = true;
      });
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(terminou).toBe(true);
    expect(h.desmarcar).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/pode ter sido recebid/),
    );
  },
);
it.each(["avaliações", "perguntas"])(
  "lista de %s pendurada sai de carregando com erro",
  async (tipo) => {
    h.pendurarLeitura = true;
    await act(async () => {
      if (tipo === "avaliações")
        void reviews.getReviewsByProduct("produto-sem-cache");
      else void questions.getQuestionsByProduct("produto-sem-cache");
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(tipo === "avaliações" ? reviews.loading : questions.loading).toBe(
      false,
    );
    expect(
      tipo === "avaliações" ? reviews.erroDaListagemProduto : questions.error,
    ).toBeTruthy();
  },
);
it.each(["sem resposta", "falha imediata"])(
  "pergunta confirmada aparece e retorna sem aguardar a releitura %s; sem aviso de erro",
  async (modo) => {
    h.pendurarLeitura = modo === "sem resposta";
    h.falharLeitura = modo === "falha imediata";
    let terminou = false;
    await act(async () => {
      void questions
        .addQuestion({
          productId: `produto-releitura-${modo}`,
          question: "Tem azul?",
        })
        .then(() => {
          terminou = true;
        });
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    expect(terminou).toBe(true);
    expect(questions.questions.map((q) => q.id)).toContain("nova");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(toast.success).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
    expect(questions.error).toBeNull();
    expect(questions.questions.map((q) => q.id)).toContain("nova");
  },
);
