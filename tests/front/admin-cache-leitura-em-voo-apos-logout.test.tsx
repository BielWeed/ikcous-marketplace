// @vitest-environment jsdom
import { useCoupons } from "@/hooks/useCoupons";
import { useQuestions } from "@/hooks/useQuestions";
import { useReviews } from "@/hooks/useReviews";
import * as cache from "@/utils/admin_cache";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: rede.from,
    rpc: (...args: unknown[]) => {
      const promessa = rede.rpc(...args);
      return Object.assign(promessa, { abortSignal: () => promessa });
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin.fixture.invalid" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Secao = "cupons" | "avaliações" | "perguntas";
let raiz: Root;
let host: HTMLDivElement;
let cupons: ReturnType<typeof useCoupons>;
let avaliacoes: ReturnType<typeof useReviews>;
let perguntas: ReturnType<typeof useQuestions>;
function Sonda() {
  const c = useCoupons();
  const r = useReviews();
  const q = useQuestions();
  useEffect(() => {
    cupons = c;
    avaliacoes = r;
    perguntas = q;
  });
  return null;
}
const linha = {
  id: "registro-ficticio",
  code: "SECRETO10",
  type: "fixed",
  value: 10,
  question: "Pergunta fictícia",
  rating: 5,
  answers: [],
};
beforeEach(async () => {
  cache.limparCachesDeAdmin();
  rede.rpc.mockReset();
  rede.from.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  raiz = createRoot(host);
  await act(async () => raiz.render(<Sonda />));
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  cache.limparCachesDeAdmin();
});

it.each(["cupons", "avaliações", "perguntas"] as const)(
  "%s: leitura em voo não repovoa cache limpo nem substitui a geração nova",
  async (secao: Secao) => {
    let soltar!: (resposta: { data: unknown; error: null }) => void;
    const pendente = new Promise<{ data: unknown; error: null }>((resolve) => {
      soltar = resolve;
    });
    const resposta = {
      data: secao === "cupons" ? [linha] : { data: [linha] },
      error: null,
    };
    rede.rpc.mockReturnValueOnce(pendente).mockResolvedValue(resposta);
    const consulta = vi
      .fn()
      .mockReturnValueOnce(pendente)
      .mockResolvedValue(resposta);
    rede.from.mockReturnValue({ select: () => ({ order: consulta }) });
    const carregar = () =>
      secao === "cupons"
        ? cupons.refreshCoupons()
        : secao === "avaliações"
          ? avaliacoes.getAllReviews()
          : perguntas.getAllQuestions();
    const ler = () =>
      secao === "cupons"
        ? cache.cachedCouponsData
        : secao === "avaliações"
          ? cache.cachedReviewsData
          : cache.cachedQuestionsData;
    let antiga!: ReturnType<typeof carregar>;
    await act(async () => {
      antiga = carregar();
    });
    cache.limparCachesDeAdmin();
    await act(async () => {
      soltar(resposta);
      await antiga;
    });
    expect(ler()).toBeNull();

    // Remontar não pode reaproveitar dados que chegaram depois da limpeza.
    act(() => raiz.unmount());
    raiz = createRoot(host);
    await act(async () => raiz.render(<Sonda />));
    const lista =
      secao === "cupons"
        ? cupons.coupons
        : secao === "avaliações"
          ? avaliacoes.adminReviews
          : perguntas.questions;
    expect(lista).toEqual([]);
    await act(async () => {
      await carregar();
    });
    expect(ler()?.[0].id).toBe("registro-ficticio");
  },
);
