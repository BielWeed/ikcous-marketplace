// @vitest-environment jsdom
//
// Cada SINAL de erro ao enviar a avaliação tem de bastar sozinho.
//
// `mensagemAmigavelErroAvaliacao` (dentro de useReviews) escolhe a frase da
// tela olhando o CÓDIGO do erro e substrings do TEXTO. Os testes de
// use-reviews-erro-do-banco-nao-vaza-na-tela só fornecem erros com os dois
// sinais juntos (23505 + "duplicate key", PGRST301 + "JWT") e, para a rede,
// só o "Failed to fetch" do Chrome. Resultado medido por mutação: dava para
// apagar o código, ou o texto, ou três dos quatro textos de rede, sem teste
// nenhum cair. Aqui cada sinal chega SOZINHO:
//   - Safari ("Load failed"), Firefox ("NetworkError when attempting to
//     fetch resource") e React Native/outros ("Network request failed") dizem
//     "Sem conexão", não a frase genérica de falha;
//   - 23505 sem texto algum, e "duplicate key" sem código, dizem "Você já
//     avaliou este produto.";
//   - PGRST301 sem texto, e "JWT expired" sem código, mandam entrar de novo.
// Mesmo dublê de Supabase/BroadcastChannel do teste vizinho.
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
  singleOk: { data: null as unknown, error: null as unknown },
  rejeicaoSingle: null as unknown,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () =>
            h.rejeicaoSingle !== null
              ? Promise.reject(h.rejeicaoSingle)
              : Promise.resolve(h.singleOk),
        }),
      }),
      select: (colunas?: string) =>
        colunas === "id"
          ? {
              eq: () => ({
                eq: () => ({ limit: async () => ({ data: [], error: null }) }),
              }),
            }
          : {
              eq: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            },
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "comprador-teste" }, isAdmin: false }),
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SEM_CONEXAO =
  "Sem conexão com o servidor. Verifique sua internet e tente novamente.";
const JA_AVALIOU = "Você já avaliou este produto.";
const ENTRE_DE_NOVO =
  "Não foi possível registrar sua avaliação. Faça login novamente e tente de novo.";
const GENERICA =
  "Não foi possível enviar sua avaliação agora. Tente novamente em instantes.";

describe("addReview — cada sinal de erro escolhe a frase certa sozinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    h.singleOk = { data: null, error: null };
    h.rejeicaoSingle = null;
    const { toast } = await import("sonner");
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
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
    vi.restoreAllMocks();
  });

  type AddReview = (avaliacao: {
    productId: string;
    rating: number;
    comment: string;
  }) => Promise<unknown>;

  const chamarAddReview = async (): Promise<unknown> => {
    const capturada = vi.fn((_metodo: AddReview) => {});
    function Sonda({ aoCapturar }: { readonly aoCapturar: typeof capturada }) {
      const { addReview } = useReviews();
      useEffect(() => {
        aoCapturar(addReview as AddReview);
      }, [addReview, aoCapturar]);
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda aoCapturar={capturada} />);
    });
    const metodo = capturada.mock.calls.at(-1)?.[0];
    if (!metodo) throw new Error("A sonda não capturou addReview");
    let retorno: unknown;
    await act(async () => {
      retorno = await metodo({
        productId: "prod-1",
        rating: 5,
        comment: "Produto ótimo",
      });
    });
    return retorno;
  };

  const mensagemNaTela = async (): Promise<string> => {
    const { toast } = await import("sonner");
    const chamadas = (toast.error as ReturnType<typeof vi.fn>).mock.calls;
    expect(chamadas).toHaveLength(1);
    return String(chamadas[0]?.[0]);
  };

  it.each([
    ["Safari", "Load failed"],
    ["Firefox", "NetworkError when attempting to fetch resource."],
    ["outros navegadores", "Network request failed"],
    ["Chrome", "Failed to fetch"],
  ])(
    "a rede caiu (%s: %s): diz 'sem conexão', não a frase genérica",
    async (_navegador, texto) => {
      h.rejeicaoSingle = new TypeError(texto);

      expect(await chamarAddReview()).toBeNull();

      expect(await mensagemNaTela()).toBe(SEM_CONEXAO);
    },
  );

  it("o texto de rede vale em qualquer caixa (o banco e os navegadores variam)", async () => {
    h.rejeicaoSingle = new TypeError("LOAD FAILED");

    await chamarAddReview();

    expect(await mensagemNaTela()).toBe(SEM_CONEXAO);
  });

  it("código 23505 SEM nenhum texto: 'já avaliou'", async () => {
    h.singleOk = { data: null, error: { code: "23505", message: "x" } };

    expect(await chamarAddReview()).toBeNull();

    expect(await mensagemNaTela()).toBe(JA_AVALIOU);
  });

  it("texto 'duplicate key' SEM código: 'já avaliou'", async () => {
    h.singleOk = {
      data: null,
      error: { message: "Duplicate Key value violates unique constraint" },
    };

    expect(await chamarAddReview()).toBeNull();

    expect(await mensagemNaTela()).toBe(JA_AVALIOU);
  });

  it("código PGRST301 SEM texto de token: manda entrar de novo", async () => {
    h.singleOk = { data: null, error: { code: "PGRST301", message: "x" } };

    expect(await chamarAddReview()).toBeNull();

    expect(await mensagemNaTela()).toBe(ENTRE_DE_NOVO);
  });

  it("texto 'JWT expired' SEM código: manda entrar de novo", async () => {
    h.singleOk = { data: null, error: { message: "JWT expired" } };

    expect(await chamarAddReview()).toBeNull();

    expect(await mensagemNaTela()).toBe(ENTRE_DE_NOVO);
  });

  it("erro com texto que ninguém previu e sem código: frase genérica", async () => {
    h.singleOk = { data: null, error: { message: "algo que ninguém previu" } };

    expect(await chamarAddReview()).toBeNull();

    expect(await mensagemNaTela()).toBe(GENERICA);
  });
});
