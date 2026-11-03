// @vitest-environment jsdom
//
// d5 (caça 03/11/2026) — o cache de perguntas do produto (Map em memória +
// `localStorage`, chave `ikcous_questions_cache_<produto>`) era UM SÓ para as
// duas visões. A visão logada grava `userId` e `isVerified` (selo "Comprador");
// a visão pública nasce SEM os dois de propósito (`vw_questions_public` nunca
// teve `user_id`, e o selo do visitante fica sempre desligado). Depois de
// "Sair", o visitante que abrisse o mesmo produto recebia o cache da pessoa
// logada ANTES da rede: selo e link do perfil dos autores, e sem internet o
// cache velho ficava na tela.
//
// O conserto: cada visão tem a sua chave (`:pub` / `:auth`), no Map e no
// `localStorage`. A chave antiga (sem sufixo) deixa de ser lida.
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

const h = vi.hoisted(() => ({
  usuarioLogado: null as { id: string } | null,
  // Visão pública que nunca responde: o que está na tela veio do CACHE.
  anonPendente: true,
  // Idem para a visão logada (tabela `questions`).
  logadoPendente: false,
  linhaAnon: [] as unknown[],
}));

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

const PERGUNTA_LOGADA = (produto: string) => ({
  id: `q-${produto}`,
  user_id: "autor-1",
  product_id: produto,
  question: "Tem em azul?",
  created_at: "2026-11-01T10:00:00.000Z",
  user: { full_name: "Ana", avatar_url: null },
  answers: [],
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "vw_questions_public") {
        return h.anonPendente
          ? builderSimples(() => new Promise(() => {}))
          : builderSimples(() => ({ data: h.linhaAnon, error: null }));
      }
      if (tabela === "questions") {
        if (h.logadoPendente) {
          return builderSimples(() => new Promise(() => {}));
        }
        // O produto vem do `.eq("product_id", ...)`.
        const builder: any = builderSimples(() => ({
          data: [PERGUNTA_LOGADA(builder.__produto)],
          error: null,
        }));
        builder.eq = (_coluna: string, valor: string) => {
          builder.__produto = valor;
          return builder;
        };
        return builder;
      }
      if (tabela === "marketplace_orders") {
        return builderSimples(() => ({
          data: [{ user_id: "autor-1" }],
          error: null,
        }));
      }
      if (tabela === "vw_produtos_public") {
        return builderSimples(() => ({
          data: { nome: "Produto Teste", imagem_url: null },
          error: null,
        }));
      }
      return builderSimples(() => ({ data: [], error: null }));
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuarioLogado, isAdmin: false }),
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
import type { Question } from "@/hooks/useQuestions";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function criarLocalStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("useQuestions — o cache de perguntas é separado por visão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.usuarioLogado = null;
    h.anonPendente = true;
    h.logadoPendente = false;
    h.linhaAnon = [];
    vi.stubGlobal("localStorage", criarLocalStorageFake());
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
  });

  // Monta a sonda, dispara a carga do produto e devolve o que está na tela
  // logo depois (a consulta pública, quando pendente, nunca termina).
  async function abrirProduto(produto: string): Promise<Question[]> {
    let carregar: ((id: string) => Promise<void>) | null = null;
    let ultima: Question[] = [];
    function Sonda() {
      const { getQuestionsByProduct, questions } = useQuestions();
      useEffect(() => {
        carregar = getQuestionsByProduct;
      }, [getQuestionsByProduct]);
      useEffect(() => {
        ultima = questions;
      }, [questions]);
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      void carregar?.(produto);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    return ultima;
  }

  async function sair() {
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
  }

  it("VERMELHO (memória): depois de sair, o visitante não recebe o selo nem o autor da pessoa que estava logada", async () => {
    h.usuarioLogado = { id: "lojista-1" };
    const logada = await abrirProduto("p-memoria");
    expect(logada[0]?.userId).toBe("autor-1");
    expect(logada[0]?.isVerified).toBe(true);

    await sair();
    h.usuarioLogado = null;
    const visitante = await abrirProduto("p-memoria");

    expect(visitante).toEqual([]);
  });

  it("VERMELHO (aparelho): a chave antiga do localStorage, gravada por versão anterior com a visão logada, não é lida pelo visitante", async () => {
    localStorage.setItem(
      "ikcous_questions_cache_p-antigo",
      JSON.stringify([
        {
          id: "q-velha",
          userId: "autor-1",
          productId: "p-antigo",
          customerName: "Ana",
          question: "Tem em azul?",
          createdAt: "2026-11-01T10:00:00.000Z",
          isVerified: true,
          answers: [],
        },
      ]),
    );

    const visitante = await abrirProduto("p-antigo");

    expect(visitante).toEqual([]);
  });

  it("VERMELHO (gravação): a visão logada grava na sua chave — nunca na chave sem sufixo", async () => {
    h.usuarioLogado = { id: "lojista-1" };
    await abrirProduto("p-chaves");

    const chaves = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.key(i),
    ).filter((c) => c?.startsWith("ikcous_questions_cache_p-chaves"));
    expect(chaves).toEqual(["ikcous_questions_cache_p-chaves:auth"]);
  });

  it("CONTROLE: o visitante continua tendo o SEU cache (mostra a lista guardada antes da rede)", async () => {
    h.anonPendente = false;
    h.linhaAnon = [
      {
        id: "q-pub",
        product_id: "p-pub",
        question: "Entrega em Patos?",
        created_at: "2026-11-01T10:00:00.000Z",
        author_name: "Marina",
        author_avatar_url: null,
      },
    ];
    const primeira = await abrirProduto("p-pub");
    expect(primeira).toHaveLength(1);

    await sair();
    h.anonPendente = true;
    const segunda = await abrirProduto("p-pub");

    expect(segunda).toHaveLength(1);
    expect(segunda[0]?.id).toBe("q-pub");
    expect(segunda[0]?.userId).toBeUndefined();
    expect(segunda[0]?.isVerified).toBe(false);
  });

  it("CONTROLE: quem está logado continua tendo o cache da visão logada", async () => {
    h.usuarioLogado = { id: "lojista-1" };
    await abrirProduto("p-logado");
    await sair();
    h.logadoPendente = true;
    const segunda = await abrirProduto("p-logado");
    expect(segunda).toHaveLength(1);
    expect(segunda[0]?.userId).toBe("autor-1");
  });
});
