// @vitest-environment jsdom
//
// Corrida da resposta atrasada: a leitura de avaliações começa, a pessoa clica
// em "Sair" (a limpeza esvazia o cache guardado no aparelho) e SÓ DEPOIS a
// resposta da rede chega. Sem conferir se a pessoa ainda é a mesma, o hook
// regravava no `localStorage` e na memória a lista que era dela — inclusive
// avaliações ainda não aprovadas, com o nome da autora — para a próxima pessoa
// a ver antes da rede responder.
//
// O conserto é um contador de "geração" do cache, incrementado em toda
// limpeza: a leitura captura o número ao COMEÇAR e só grava se ele não mudou.
//
// Dublê do BroadcastChannel: jsdom não tem, e o módulo do hook instancia um
// no topo do arquivo na importação.
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
  // Resposta da leitura, SEGURADA até o teste soltar.
  soltarLeitura: null as null | ((linhas: unknown[]) => void),
  soltarVoto: null as null | ((resultado: { error: unknown }) => void),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = async () => ({ data: [], error: null });
      builder.order = () =>
        new Promise((resolve) => {
          h.soltarLeitura = (linhas) => resolve({ data: linhas, error: null });
        });
      return builder;
    },
    rpc: () =>
      new Promise((resolve) => {
        h.soltarVoto = resolve;
      }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuarioLogado, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";
import {
  esquecerAvaliacoesGuardadas,
  esvaziarAvaliacoesEmMemoria,
  getReviewsCache,
  updateReviewsCache,
} from "@/lib/cache-de-avaliacoes";

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

const PRODUTO = "prod-bolsa";
const CHAVE = `ikcous_reviews_cache_${PRODUTO}`;

const LINHA_PENDENTE = {
  id: "rev-pendente",
  product_id: PRODUTO,
  user_id: "cliente-9",
  rating: 5,
  comment: "ainda não aprovada",
  created_at: "2026-08-21T09:30:00.000Z",
  helpful: 0,
  verified: false,
  status: "pendente",
  merchant_reply: null,
  user: { full_name: "Maria Autora", avatar_url: null },
};

type Metodos = {
  getReviewsByProduct: (id: string) => Promise<void>;
  markHelpful: (id: string) => Promise<boolean>;
};

describe("resposta atrasada não regrava o cache depois da limpeza do Sair", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.usuarioLogado = { id: "lojista-1" };
    h.soltarLeitura = null;
    h.soltarVoto = null;
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    esvaziarAvaliacoesEmMemoria();
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

  async function montar(): Promise<Metodos> {
    const capturar = vi.fn((_m: Metodos) => {});
    function Sonda() {
      const { getReviewsByProduct, markHelpful } = useReviews();
      useEffect(() => {
        capturar({
          getReviewsByProduct:
            getReviewsByProduct as Metodos["getReviewsByProduct"],
          markHelpful,
        });
      }, [getReviewsByProduct, markHelpful]);
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    const m = capturar.mock.calls.at(-1)?.[0];
    if (!m) throw new Error("A sonda não capturou os métodos do hook");
    return m;
  }

  it("controle: leitura em voo SEM limpeza grava no cache normalmente", async () => {
    const { getReviewsByProduct } = await montar();

    let leitura!: Promise<void>;
    await act(async () => {
      leitura = getReviewsByProduct(PRODUTO);
    });
    expect(localStorage.getItem(CHAVE)).toBeNull();

    await act(async () => {
      h.soltarLeitura?.([LINHA_PENDENTE]);
      await leitura;
    });

    expect(localStorage.getItem(CHAVE)).not.toBeNull();
    expect(getReviewsCache(PRODUTO)).toHaveLength(1);
  });

  it("leitura em voo → limpeza do logout → resposta chega: NADA volta para o localStorage nem para a memória", async () => {
    const { getReviewsByProduct } = await montar();

    let leitura!: Promise<void>;
    await act(async () => {
      leitura = getReviewsByProduct(PRODUTO);
    });

    // A pessoa clica em "Sair" com a leitura ainda no ar.
    esquecerAvaliacoesGuardadas();

    await act(async () => {
      h.soltarLeitura?.([LINHA_PENDENTE]);
      await leitura;
    });

    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(getReviewsCache(PRODUTO)).toBeNull();
  });

  it("o mesmo vale para a limpeza do logout que só esvazia a memória (clearLocalUserData)", async () => {
    const { getReviewsByProduct } = await montar();

    let leitura!: Promise<void>;
    await act(async () => {
      leitura = getReviewsByProduct(PRODUTO);
    });

    esvaziarAvaliacoesEmMemoria();

    await act(async () => {
      h.soltarLeitura?.([LINHA_PENDENTE]);
      await leitura;
    });

    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(getReviewsCache(PRODUTO)).toBeNull();
  });

  it("voto 'útil' recusado pelo banco, com limpeza no meio: a resposta não regrava o cache", async () => {
    const { getReviewsByProduct, markHelpful } = await montar();

    // Lista carregada normalmente (e guardada) enquanto a pessoa está logada.
    let leitura!: Promise<void>;
    await act(async () => {
      leitura = getReviewsByProduct(PRODUTO);
    });
    await act(async () => {
      h.soltarLeitura?.([LINHA_PENDENTE]);
      await leitura;
    });
    expect(localStorage.getItem(CHAVE)).not.toBeNull();

    let voto!: Promise<boolean>;
    await act(async () => {
      voto = markHelpful("rev-pendente");
    });

    // "Sair" com o voto em voo: o cache guardado some.
    esquecerAvaliacoesGuardadas();
    expect(localStorage.getItem(CHAVE)).toBeNull();

    await act(async () => {
      h.soltarVoto?.({ error: { message: "recusado" } });
      await voto;
    });

    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(getReviewsCache(PRODUTO)).toBeNull();
  });

  it("controle: voto recusado SEM limpeza mantém o contador confirmado no cache", async () => {
    const { getReviewsByProduct, markHelpful } = await montar();

    let leitura!: Promise<void>;
    await act(async () => {
      leitura = getReviewsByProduct(PRODUTO);
    });
    await act(async () => {
      h.soltarLeitura?.([LINHA_PENDENTE]);
      await leitura;
    });

    let voto!: Promise<boolean>;
    await act(async () => {
      voto = markHelpful("rev-pendente");
    });
    // Voto em voo não persiste um incremento ainda não confirmado.
    expect(getReviewsCache(PRODUTO)?.[0]?.helpful).toBe(0);

    await act(async () => {
      h.soltarVoto?.({ error: { message: "recusado" } });
      await voto;
    });

    expect(getReviewsCache(PRODUTO)?.[0]?.helpful).toBe(0);
  });

  it("sanidade do dublê: updateReviewsCache direto continua gravando", () => {
    updateReviewsCache(PRODUTO, []);
    expect(localStorage.getItem(CHAVE)).toBe("[]");
  });
});
