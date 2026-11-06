// @vitest-environment jsdom
//
// Os três caches por produto (recomendações, avaliações, perguntas) gravavam
// uma chave nova a cada produto aberto e nunca apagavam nada. Aqui, pelo
// código de verdade de cada um: depois de abrir muitos produtos, o aparelho
// guarda só as últimas cópias de cada cache.
vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    class BroadcastChannelFalso {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
      BroadcastChannelFalso;
  }
});

function builderSimples(resultado: () => unknown) {
  const builder: any = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.in = () => builder;
  builder.order = () => builder;
  builder.maybeSingle = () => builder;
  builder.abortSignal = () => builder;
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve(resultado()).then(resolve, reject);
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => builderSimples(() => ({ data: [], error: null })),
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
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "@/hooks/useQuestions";
import { useRecomendacoesDeProduto } from "@/hooks/useRecomendacoesDeProduto";
import { updateReviewsCache } from "@/lib/cache-de-avaliacoes";
import {
  LIMITE_DE_COPIAS,
  PREFIXO_DE_AVALIACOES,
  PREFIXO_DE_PERGUNTAS,
  PREFIXO_DE_RECOMENDACOES,
} from "@/lib/copias-por-produto";
import type { Product } from "@/types";
import { ArmazenamentoComCota } from "./helpers/armazenamento-com-cota";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRODUTOS_ABERTOS = LIMITE_DE_COPIAS + 12;

describe("cópias por produto — os três caches têm teto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: ArmazenamentoComCota;

  const copiasDe = (prefixo: string) =>
    armazem.chaves().filter((c) => c.startsWith(prefixo));

  beforeEach(() => {
    armazem = new ArmazenamentoComCota(5_000_000);
    vi.stubGlobal("localStorage", armazem);
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.restoreAllMocks();
  });

  it("recomendações: abrir muitos produtos deixa só as últimas cópias, com a mais nova entre elas", async () => {
    const buscar = async (id: string) =>
      [{ id: `rec-de-${id}`, name: "x", price: 1 }] as unknown as Product[];
    function Pagina({ id }: Readonly<{ id: string }>) {
      useRecomendacoesDeProduto(id, true, buscar);
      return null;
    }
    for (let i = 0; i < PRODUTOS_ABERTOS; i++) {
      await act(async () => {
        raiz.render(<Pagina id={`p${i}`} />);
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    const guardadas = copiasDe(PREFIXO_DE_RECOMENDACOES);
    expect(guardadas).toHaveLength(LIMITE_DE_COPIAS);
    expect(guardadas).toContain(
      `${PREFIXO_DE_RECOMENDACOES}p${PRODUTOS_ABERTOS - 1}`,
    );
    expect(guardadas).not.toContain(`${PREFIXO_DE_RECOMENDACOES}p0`);
  });

  it("avaliações: gravar muitos produtos deixa só as últimas cópias", () => {
    for (let i = 0; i < PRODUTOS_ABERTOS; i++) {
      updateReviewsCache(`p${i}`, []);
    }
    const guardadas = copiasDe(PREFIXO_DE_AVALIACOES);
    expect(guardadas).toHaveLength(LIMITE_DE_COPIAS);
    expect(guardadas).toContain(
      `${PREFIXO_DE_AVALIACOES}p${PRODUTOS_ABERTOS - 1}`,
    );
    expect(guardadas).not.toContain(`${PREFIXO_DE_AVALIACOES}p0`);
  });

  it("perguntas (visitante): abrir muitos produtos deixa só as últimas cópias", async () => {
    let carregar: ((id: string) => Promise<void>) | null = null;
    function Sonda() {
      const { getQuestionsByProduct } = useQuestions();
      useEffect(() => {
        carregar = getQuestionsByProduct;
      }, [getQuestionsByProduct]);
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    for (let i = 0; i < PRODUTOS_ABERTOS; i++) {
      await act(async () => {
        await carregar?.(`p${i}`);
      });
    }
    const guardadas = copiasDe(PREFIXO_DE_PERGUNTAS);
    expect(guardadas).toHaveLength(LIMITE_DE_COPIAS);
    expect(guardadas).toContain(
      `${PREFIXO_DE_PERGUNTAS}p${PRODUTOS_ABERTOS - 1}:pub`,
    );
    expect(guardadas).not.toContain(`${PREFIXO_DE_PERGUNTAS}p0:pub`);
  });
});
