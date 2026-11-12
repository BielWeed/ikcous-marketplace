// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  quantidade: 0,
  repetirAutores: false,
  falharLote: false,
  rejeitarLote: false,
  chamadas: [] as { tabela: string; coluna: string; ids: string[] }[],
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/canal-de-abas", () => ({ criarCanalDeAbas: () => null }));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  cachedQuestionsData: null,
  setCachedReviewsData: vi.fn(),
  setCachedQuestionsData: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(tabela: string) {
      let ids: string[] = [];
      const resultado = () => {
        if (["reviews", "questions", "vw_questions_public"].includes(tabela)) {
          return {
            data: Array.from({ length: h.quantidade }, (_, i) => ({
              id: `id-${i}`,
              user_id: `user-${h.repetirAutores ? i % 2 : i}`,
              product_id: "p",
              rating: 5,
              helpful: 0,
              question: "Tem azul?",
              created_at: "2026-11-07T12:00:00Z",
              answers: [],
            })),
            error: null,
          };
        }
        if (tabela === "vw_produtos_public")
          return { data: { nome: "Bolsa" }, error: null };
        if (h.rejeitarLote && ids.includes("user-100"))
          throw new Error("Failed to fetch");
        // O gateway recusa a lista grande; o dublê recebe o filtro real do hook.
        if (ids.length > 100 || (h.falharLote && ids.includes("user-100"))) {
          return { data: null, error: { message: "URI too long" } };
        }
        const data = ids.map((id) =>
          tabela === "review_votes"
            ? { review_id: id }
            : tabela === "answers"
              ? {
                  id: `a-${id}`,
                  question_id: id,
                  answer: `Resposta ${id}`,
                  created_at: "2026-11-07T13:00:00Z",
                }
              : { user_id: id },
        );
        return { data, error: null };
      };
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        maybeSingle() {
          return this;
        },
        in(coluna: string, valores: string[]) {
          ids = valores;
          h.chamadas.push({ tabela, coluna, ids: valores });
          return this;
        },
        abortSignal() {
          return this;
        },
        // biome-ignore lint/suspicious/noThenProperty: reproduz o builder aguardável do Supabase.
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(resultado()).then(resolve);
        },
      };
      return query;
    },
  },
}));

import { useQuestions } from "@/hooks/useQuestions";
import { useReviews } from "@/hooks/useReviews";
import { esvaziarAvaliacoesEmMemoria } from "@/lib/cache-de-avaliacoes";

let host: HTMLDivElement;
let root: Root;
let avaliacoes: ReturnType<typeof useReviews>;
let perguntas: ReturnType<typeof useQuestions>;
function Sonda() {
  const estadoAvaliacoes = useReviews();
  const estadoPerguntas = useQuestions();
  useEffect(() => {
    avaliacoes = estadoAvaliacoes;
    perguntas = estadoPerguntas;
  }, [estadoAvaliacoes, estadoPerguntas]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  esvaziarAvaliacoesEmMemoria();
  h.user = { id: "cliente" };
  h.quantidade = 0;
  h.repetirAutores = false;
  h.falharLote = false;
  h.rejeitarLote = false;
  h.chamadas = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  esvaziarAvaliacoesEmMemoria();
});
async function montar() {
  await act(async () => root.render(<Sonda />));
}
function lotes(tabela: string) {
  return h.chamadas.filter((c) => c.tabela === tabela).map((c) => c.ids);
}

it.each([0, 1, 100, 101, 205])(
  "votos de %i avaliações: lê todos sem endereço enorme",
  async (n) => {
    h.quantidade = n;
    await montar();
    await act(async () => {
      await avaliacoes.getReviewsByProduct(`reviews-${n}`);
    });
    expect(avaliacoes.userIdAtual).toBe("cliente");
    expect(avaliacoes.reviews).toHaveLength(n);
    expect(avaliacoes.votosUteis.size).toBe(n);
    expect(lotes("review_votes").map((l) => l.length)).toEqual(
      n === 0 ? [] : n <= 100 ? [n] : n === 101 ? [100, 1] : [100, 100, 5],
    );
    expect(lotes("review_votes").flat()).toEqual(
      Array.from({ length: n }, (_, i) => `id-${i}`),
    );
  },
);

it.each([0, 1, 100, 101, 205])(
  "visitante com %i perguntas: reúne todas as respostas",
  async (n) => {
    h.user = null;
    h.quantidade = n;
    await montar();
    await act(async () => {
      await perguntas.getQuestionsByProduct(`anon-${n}`);
    });
    expect(perguntas.error).toBeNull();
    expect(perguntas.questions).toHaveLength(n);
    expect(perguntas.questions.map((q) => q.answers[0]?.answer)).toEqual(
      Array.from({ length: n }, (_, i) => `Resposta id-${i}`),
    );
    expect(lotes("answers").every((l) => l.length <= 100)).toBe(true);
    expect(lotes("answers").flat()).toHaveLength(n);
  },
);

it.each([1, 205])("compradores de %i perguntas: reúne os selos", async (n) => {
  h.quantidade = n;
  await montar();
  await act(async () => {
    await perguntas.getQuestionsByProduct(`auth-${n}`);
  });
  expect(perguntas.questions).toHaveLength(n);
  expect(perguntas.questions.every((q) => q.isVerified)).toBe(true);
  expect(lotes("marketplace_orders").every((l) => l.length <= 100)).toBe(true);
  expect(lotes("marketplace_orders").flat()).toHaveLength(n);
});
it("deduplica os autores antes de consultar os compradores", async () => {
  h.quantidade = 205;
  h.repetirAutores = true;
  await montar();
  await act(async () => {
    await perguntas.getQuestionsByProduct("deduplicar");
  });
  expect(lotes("marketplace_orders")).toEqual([["user-0", "user-1"]]);
  expect(perguntas.questions.every((q) => q.isVerified)).toBe(true);
});
it.each([false, true])(
  "erro num pedaço não apaga os selos dos outros pedaços (rejeição: %s)",
  async (rejeitar) => {
    h.quantidade = 205;
    h.falharLote = !rejeitar;
    h.rejeitarLote = rejeitar;
    await montar();
    await act(async () => {
      await perguntas.getQuestionsByProduct("erro-parcial");
    });
    expect(perguntas.error).toBeNull();
    expect(perguntas.questions).toHaveLength(205);
    expect(perguntas.questions.filter((q) => q.isVerified)).toHaveLength(105);
    expect(perguntas.questions.find((q) => q.id === "id-204")?.isVerified).toBe(
      true,
    );
  },
);
