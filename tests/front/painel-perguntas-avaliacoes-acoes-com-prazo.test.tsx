// @vitest-environment jsdom
import { useQuestions } from "@/hooks/useQuestions";
import { useReviews } from "@/hooks/useReviews";
import { limparCachesDeAdmin } from "@/utils/admin_cache";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gravar: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-ficticio" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { error: h.erro, success: h.sucesso } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => h.gravar(),
    from: () => ({
      delete: () => ({ eq: () => ({ select: () => h.gravar() }) }),
      update: () => ({ eq: () => ({ select: () => h.gravar() }) }),
    }),
  },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let q: ReturnType<typeof useQuestions>;
let r: ReturnType<typeof useReviews>;
function Sonda() {
  const perguntas = useQuestions();
  const avaliacoes = useReviews();
  useEffect(() => {
    q = perguntas;
    r = avaliacoes;
  });
  return null;
}
beforeEach(async () => {
  limparCachesDeAdmin();
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root.render(<Sonda />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  limparCachesDeAdmin();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const acoes = [
  [
    "responder pergunta",
    () => q.addAnswer({ questionId: "q", answer: "Texto preservado" }),
  ],
  ["excluir pergunta", () => q.deleteQuestion("q")],
  ["excluir avaliação", () => r.deleteReview("r")],
  ["publicar avaliação", () => r.aprovarReview("r")],
  ["responder avaliação", () => r.addMerchantReply("r", "Texto preservado")],
  [
    "responder pergunta silenciosa",
    () =>
      q.addAnswer(
        { questionId: "q", answer: "Texto preservado" },
        { silent: true },
      ),
  ],
  [
    "excluir pergunta silenciosa",
    () => q.deleteQuestion("q", { silent: true }),
  ],
] as const;

for (const [nome, executar] of acoes) {
  it(`${nome}: libera a espera em 20 s sem repetir e ignora confirmação atrasada`, async () => {
    let concluir!: (resposta: unknown) => void;
    h.gravar.mockReturnValue(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );
    let resultado: boolean | undefined;
    await act(async () => {
      void executar().then((valor) => {
        resultado = valor;
      });
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(resultado).toBeUndefined();
    expect(h.erro).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(resultado).toBe(false);
    expect(h.erro).toHaveBeenCalledWith(
      "Sem resposta da rede. Confira na lista antes de tentar de novo.",
    );
    expect(h.gravar).toHaveBeenCalledTimes(1);
    await act(async () => {
      concluir({ data: [{ id: "r" }], error: null });
    });
    expect(h.sucesso).not.toHaveBeenCalled();
    expect(r.adminReviews).toEqual([]);
    expect(q.questions).toEqual([]);
    // O próximo toque pode concluir normalmente: o prazo não deixa uma trava presa.
    h.gravar.mockResolvedValue({ data: [{ id: "r" }], error: null });
    await act(async () => {
      expect(await executar()).toBe(true);
    });
    expect(h.gravar).toHaveBeenCalledTimes(2);
  });
}
