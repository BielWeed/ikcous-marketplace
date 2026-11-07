// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCoupons } from "@/hooks/useCoupons";
import { useProducts } from "@/hooks/useProducts";
import { useQuestions } from "@/hooks/useQuestions";
import { useReviews } from "@/hooks/useReviews";

const h = vi.hoisted(() => ({
  admin: false,
  user: { id: "usuario-teste" },
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  rpc: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, isAdmin: h.admin, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: h.erro, success: h.sucesso, info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => {
  // O controle só precisa alcançar a gravação. O banco simulado recusa
  // depois dela, para não depender da releitura ou da limpeza de mídia.
  const recusa = { data: null, error: { message: "recusa do banco simulado" } };
  function escrita() {
    const consulta = {
      eq: () => consulta,
      is: () => consulta,
      select: () => consulta,
      single: () => Promise.resolve(recusa),
      // biome-ignore lint/suspicious/noThenProperty: query builder thenable do Supabase
      then: (resolve: (value: typeof recusa) => unknown) =>
        Promise.resolve(recusa).then(resolve),
    };
    return consulta;
  }
  return {
    supabase: {
      from: () => ({
        insert: (...args: unknown[]) => {
          h.insert(...args);
          return escrita();
        },
        update: (...args: unknown[]) => {
          h.update(...args);
          return escrita();
        },
        delete: (...args: unknown[]) => {
          h.delete(...args);
          return escrita();
        },
        select: () => {
          const leitura = {
            eq: () => leitura,
            is: () => leitura,
            maybeSingle: async () => ({
              data: { id: "produto-teste", imagem_urls: [], imagem_url: null },
              error: null,
            }),
            // biome-ignore lint/suspicious/noThenProperty: leitura de variantes do Supabase
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ data: [], error: null }).then(resolve),
          };
          return leitura;
        },
      }),
      rpc: (...args: unknown[]) => {
        h.rpc(...args);
        return Promise.resolve(recusa);
      },
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function usePainel() {
  return {
    cupons: useCoupons(false),
    produtos: useProducts({ autoFetch: false }),
    avaliacoes: useReviews(),
    perguntas: useQuestions(),
  };
}
type Painel = ReturnType<typeof usePainel>;
type Caso = {
  nome: string;
  chamar: (painel: Painel) => Promise<unknown>;
  retorno: unknown;
  escrita: "insert" | "update" | "delete" | "rpc";
  silencioso?: boolean;
};
const cupom = {
  code: "TESTE",
  type: "percentage" as const,
  value: 10,
  minPurchase: 0,
  usageLimit: 0,
  active: true,
};
const produto = {
  name: "Produto de teste",
  description: "",
  price: 50,
  stock: 3,
  category: "Geral",
  images: [],
  isActive: true,
  sold: 0,
  isBestseller: false,
  freeShipping: false,
  tags: [],
};
const casos: Caso[] = [
  {
    nome: "addCoupon",
    chamar: (p) => p.cupons.addCoupon(cupom),
    retorno: null,
    escrita: "insert",
  },
  {
    nome: "updateCoupon",
    chamar: (p) => p.cupons.updateCoupon("cupom-teste", { active: false }),
    retorno: undefined,
    escrita: "update",
  },
  {
    nome: "deleteCoupon",
    chamar: (p) => p.cupons.deleteCoupon("cupom-teste"),
    retorno: undefined,
    escrita: "delete",
  },
  {
    nome: "addProduct",
    chamar: (p) => p.produtos.addProduct(produto),
    retorno: undefined,
    escrita: "insert",
  },
  {
    nome: "updateProduct",
    chamar: (p) =>
      p.produtos.updateProduct("produto-teste", { name: "Novo nome" }),
    retorno: undefined,
    escrita: "update",
  },
  {
    nome: "deleteProduct",
    chamar: (p) => p.produtos.deleteProduct("produto-teste"),
    retorno: undefined,
    escrita: "update",
  },
  {
    nome: "deleteReview",
    chamar: (p) => p.avaliacoes.deleteReview("avaliacao-teste"),
    retorno: false,
    escrita: "delete",
  },
  {
    nome: "aprovarReview",
    chamar: (p) => p.avaliacoes.aprovarReview("avaliacao-teste"),
    retorno: false,
    escrita: "update",
  },
  {
    nome: "addMerchantReply",
    chamar: (p) => p.avaliacoes.addMerchantReply("avaliacao-teste", "Resposta"),
    retorno: false,
    escrita: "rpc",
  },
  {
    nome: "addAnswer",
    chamar: (p) =>
      p.perguntas.addAnswer({
        questionId: "pergunta-teste",
        answer: "Resposta",
      }),
    retorno: false,
    escrita: "rpc",
  },
  {
    nome: "deleteQuestion",
    chamar: (p) => p.perguntas.deleteQuestion("pergunta-teste"),
    retorno: false,
    escrita: "delete",
  },
  {
    nome: "addAnswer silencioso",
    chamar: (p) =>
      p.perguntas.addAnswer(
        { questionId: "pergunta-teste", answer: "Resposta" },
        { silent: true },
      ),
    retorno: false,
    escrita: "rpc",
    silencioso: true,
  },
  {
    nome: "deleteQuestion silencioso",
    chamar: (p) =>
      p.perguntas.deleteQuestion("pergunta-teste", { silent: true }),
    retorno: false,
    escrita: "delete",
    silencioso: true,
  },
];

describe("gravações do painel exigem administrador antes de chamar o banco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let painel: Painel;
  function Sonda() {
    const valor = usePainel();
    useEffect(() => {
      painel = valor;
    });
    return null;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    h.admin = false;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });
  async function montar(admin: boolean) {
    h.admin = admin;
    await act(async () => {
      raiz.render(<Sonda />);
    });
    vi.clearAllMocks();
  }

  for (const caso of casos) {
    it(`${caso.nome}: não-admin recebe recusa sem tentar gravar`, async () => {
      await montar(false);
      let retorno: unknown;
      await act(async () => {
        retorno = await caso.chamar(painel);
      });
      // A ausência de qualquer gravação é a primeira asserção, inclusive
      // para funções que também devolvem false quando o banco recusa.
      for (const gravar of [h.insert, h.update, h.delete, h.rpc]) {
        expect(gravar).not.toHaveBeenCalled();
      }
      expect(retorno).toBe(caso.retorno);
      if (caso.silencioso) expect(h.erro).not.toHaveBeenCalled();
      else expect(h.erro).toHaveBeenCalledExactlyOnceWith("Permissão negada");
      expect(h.sucesso).not.toHaveBeenCalled();
    });

    it(`${caso.nome}: administrador alcança a gravação (controle do dublê)`, async () => {
      await montar(true);
      await act(async () => {
        // Algumas APIs lançam a recusa do banco; outras devolvem false.
        // Aqui o resultado não é sucesso: o controle prova só o acesso ao banco.
        await caso.chamar(painel).catch(() => undefined);
      });
      expect(h[caso.escrita]).toHaveBeenCalledTimes(1);
      expect(h.erro).not.toHaveBeenCalledWith("Permissão negada");
    });
  }
});
