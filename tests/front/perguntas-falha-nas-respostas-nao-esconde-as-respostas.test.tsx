// @vitest-environment jsdom
// Falha na consulta separada de answers não é pergunta sem resposta.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    },
  );
  return {
    perguntas: vi.fn(),
    respostas: vi.fn(),
  };
});

function builderSimples(resultado: () => unknown) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      return this;
    },
    maybeSingle() {
      return this;
    },
    abortSignal: () => Promise.resolve(resultado()),
  };
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "vw_questions_public") return builderSimples(h.perguntas);
      if (tabela === "answers") return builderSimples(h.respostas);
      if (tabela === "vw_produtos_public") {
        return builderSimples(() => ({
          data: { nome: "Bolsa", imagem_url: "bolsa.jpg" },
          error: null,
        }));
      }
      throw new Error(`Consulta inesperada: ${tabela}`);
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedQuestionsData: null,
  setCachedQuestionsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { type Question, useQuestions } from "@/hooks/useQuestions";

type Estado = ReturnType<typeof useQuestions>;

function Sonda({ aoRenderizar }: { aoRenderizar: (estado: Estado) => void }) {
  const estado = useQuestions();
  useEffect(() => {
    aoRenderizar(estado);
  }, [aoRenderizar, estado]);
  return null;
}

function criarLocalStorageFake() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
  };
}

const perguntaPublica = (productId: string) => ({
  id: "pergunta-1",
  product_id: productId,
  question: "Tem em azul?",
  created_at: "2026-10-15T10:00:00.000Z",
  author_name: "Marina",
  author_avatar_url: null,
});
const respostaDaLoja = {
  id: "resposta-1",
  question_id: "pergunta-1",
  answer: "Temos em azul!",
  created_at: "2026-10-15T11:00:00.000Z",
};
const falhaNasRespostas = { message: "Não foi possível consultar answers" };
const chaveDoCache = (productId: string) =>
  `ikcous_questions_cache_${productId}`;

describe("useQuestions — falha nas respostas não publica uma lista incompleta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const capturar = vi.fn((_estado: Estado) => {});

  beforeEach(() => {
    h.perguntas.mockReset();
    h.respostas.mockReset();
    h.respostas.mockReturnValue({ data: [respostaDaLoja], error: null });
    capturar.mockClear();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function estadoAtual(): Estado {
    const estado = capturar.mock.calls.at(-1)?.[0];
    if (!estado) throw new Error("A sonda não capturou o estado do hook");
    return estado;
  }

  async function montar(chave = "primeira") {
    await act(async () => {
      raiz.render(<Sonda key={chave} aoRenderizar={capturar} />);
    });
  }

  async function carregar(productId: string) {
    await act(async () => {
      await estadoAtual().getQuestionsByProduct(productId);
    });
  }

  it("expõe erro, sem publicar perguntas sem resposta nem criar cache; a nova tentativa pode recuperar", async () => {
    const productId = "falha-respostas-sem-cache";
    h.perguntas.mockReturnValue({
      data: [perguntaPublica(productId)],
      error: null,
    });
    h.respostas.mockReturnValue({ data: null, error: falhaNasRespostas });
    await montar();
    await carregar(productId);

    expect(h.respostas).toHaveBeenCalledOnce();
    expect(estadoAtual().questions).toEqual([]);
    expect(estadoAtual().error).toBeTruthy();
    expect(estadoAtual().loading).toBe(false);
    expect(localStorage.getItem(chaveDoCache(productId))).toBeNull();

    h.respostas.mockReturnValue({ data: [respostaDaLoja], error: null });
    await carregar(productId);

    expect(estadoAtual().error).toBeNull();
    expect(estadoAtual().questions[0]?.answers[0]?.answer).toBe(
      "Temos em azul!",
    );
    expect(JSON.parse(localStorage.getItem(chaveDoCache(productId))!)).toEqual(
      estadoAtual().questions,
    );
  });

  it("preserva a lista completa do cache persistido e da memória quando answers falha", async () => {
    const productId = "falha-respostas-com-cache";
    const completa: Question[] = [
      {
        id: "pergunta-1",
        productId,
        customerName: "Marina",
        question: "Tem em azul?",
        createdAt: "2026-10-15T10:00:00.000Z",
        answers: [
          {
            id: "resposta-1",
            questionId: "pergunta-1",
            answer: "Temos em azul!",
            createdAt: "2026-10-15T11:00:00.000Z",
          },
        ],
      },
    ];
    const cacheOriginal = JSON.stringify(completa);
    localStorage.setItem(chaveDoCache(productId), cacheOriginal);
    h.perguntas.mockReturnValue({
      data: [perguntaPublica(productId)],
      error: null,
    });
    h.respostas.mockReturnValue({ data: null, error: falhaNasRespostas });
    await montar();
    await carregar(productId);

    expect(estadoAtual().questions).toEqual(completa);
    expect(estadoAtual().error).toBeTruthy();
    expect(estadoAtual().loading).toBe(false);
    expect(localStorage.getItem(chaveDoCache(productId))).toBe(cacheOriginal);

    // Uma instância nova também deve recuperar a lista completa da memória.
    await montar("segunda");
    await carregar(productId);
    expect(estadoAtual().questions).toEqual(completa);
    expect(estadoAtual().error).toBeTruthy();
    expect(localStorage.getItem(chaveDoCache(productId))).toBe(cacheOriginal);
  });

  it("preserva a última carga completa no estado ao falhar a atualização das respostas", async () => {
    const productId = "falha-respostas-apos-sucesso";
    h.perguntas.mockReturnValue({
      data: [perguntaPublica(productId)],
      error: null,
    });
    await montar();
    await carregar(productId);
    const completa = estadoAtual().questions;
    const cacheOriginal = localStorage.getItem(chaveDoCache(productId));
    expect(completa[0]?.answers[0]?.answer).toBe("Temos em azul!");
    expect(estadoAtual().error).toBeNull();

    h.respostas.mockReturnValue({ data: null, error: falhaNasRespostas });
    await carregar(productId);

    expect(estadoAtual().questions).toEqual(completa);
    expect(estadoAtual().error).toBeTruthy();
    expect(estadoAtual().loading).toBe(false);
    expect(localStorage.getItem(chaveDoCache(productId))).toBe(cacheOriginal);
  });

  it("mantém a formatação, a ordem das respostas e o cache no caminho feliz", async () => {
    const productId = "respostas-caminho-feliz";
    h.perguntas.mockReturnValue({
      data: [
        perguntaPublica(productId),
        { ...perguntaPublica(productId), id: "pergunta-2" },
      ],
      error: null,
    });
    h.respostas.mockReturnValue({
      data: [
        {
          ...respostaDaLoja,
          id: "resposta-2",
          created_at: "2026-10-15T12:00:00.000Z",
        },
        respostaDaLoja,
      ],
      error: null,
    });
    await montar();
    await carregar(productId);

    expect(estadoAtual().questions).toHaveLength(2);
    expect(estadoAtual().questions[0]).toEqual({
      id: "pergunta-1",
      userId: undefined,
      productId,
      productName: "Bolsa",
      productImage: "bolsa.jpg",
      customerName: "Marina",
      customerAvatar: undefined,
      question: "Tem em azul?",
      createdAt: "2026-10-15T10:00:00.000Z",
      isVerified: false,
      answers: [
        {
          id: "resposta-1",
          questionId: "pergunta-1",
          answer: "Temos em azul!",
          createdAt: "2026-10-15T11:00:00.000Z",
        },
        {
          id: "resposta-2",
          questionId: "pergunta-1",
          answer: "Temos em azul!",
          createdAt: "2026-10-15T12:00:00.000Z",
        },
      ],
    });
    expect(estadoAtual().questions[1]?.answers).toEqual([]);
    expect(estadoAtual().error).toBeNull();
    expect(estadoAtual().loading).toBe(false);
    expect(JSON.parse(localStorage.getItem(chaveDoCache(productId))!)).toEqual(
      estadoAtual().questions,
    );
  });
});
