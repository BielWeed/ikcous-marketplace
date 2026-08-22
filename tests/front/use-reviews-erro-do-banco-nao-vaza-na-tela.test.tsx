// @vitest-environment jsdom
//
// O erro CRU do banco não pode chegar à tela do comprador.
//
// O DEFEITO: o catch de topo de addReview exibia
// `Erro ao enviar avaliação: ${error.message}`. Quando o banco recusava a
// gravação, o aviso na página do produto era coisa como "new row violates
// row-level security policy for table reviews" — ininteligível para quem está
// comprando e, pior, descreve a estrutura interna do banco (tabela, política,
// restrição) para quem está sondando a loja de fora.
//
// POR QUE O TESTE PASSA PELO HOOK DE VERDADE (render React + jsdom) e não por
// função extraída isolada: quem exibia o texto cru era o fechamento dentro de
// useReviews().addReview; então é ELE que é exercitado aqui, com o cliente do
// Supabase dublê logo abaixo — mesmo precedente de
// qa-stats-erro-nao-e-fila-vazia.test.tsx. Com a linha antiga de volta, este
// teste CAI: o texto do banco reaparece dentro do toast.
//
// Dublê do BroadcastChannel: jsdom não tem, e o módulo do hook instancia um
// no topo do arquivo (`new BroadcastChannel(...)`) na importação.
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

// Estado que cada teste troca caso a caso. `singleOk`/`rejeicaoSingle` são o
// que o `.single()` do INSERT devolve (o cliente Supabase NÃO lança exceção por
// si: devolve { data, error }; rede caída é o caminho da REJEIÇÃO). `lista` é
// a resposta do refresh que getReviewsByProduct faz após o sucesso.
// `inserts`/`eqs` registram o que chegou ao banco, para provar que o fluxo de
// sucesso segue idêntico ao de antes da correção.
const h = vi.hoisted(() => ({
  singleOk: { data: null as unknown, error: null as unknown },
  rejeicaoSingle: null as unknown,
  lista: { data: [] as unknown[], error: null as unknown },
  inserts: [] as unknown[],
  eqs: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      // addReview: supabase.from("reviews").insert(...).select().single()
      insert: (payload: unknown) => {
        h.inserts.push(payload);
        return {
          select: () => ({
            single: () =>
              h.rejeicaoSingle !== null
                ? Promise.reject(h.rejeicaoSingle)
                : Promise.resolve(h.singleOk),
          }),
        };
      },
      // getReviewsByProduct: .from("reviews").select(...).eq(...).order(...)
      select: () => ({
        eq: (...args: unknown[]) => {
          h.eqs.push(args);
          return {
            order: () => Promise.resolve(h.lista),
          };
        },
      }),
    }),
  },
}));

// Montar o hook precisa de sessão e eleição de aba; dublês mínimos, mesmo
// padrão de use-coupons-limpar-campo-persiste-como-null.test.tsx.
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

// O toast é o observado do teste: é NELE que se lê o que a pessoa recebeu.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";

// Mesmo padrão de product-card-gate-avaliacoes.test.tsx: sem esta flag o
// React reclama de act() em todo render.
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Textos CRUS que um banco real devolve nestas situações — é EXATAMENTE isto
// que não pode aparecer na tela.
const MENSAGEM_RLS =
  'new row violates row-level security policy for table "reviews"';
const MENSAGEM_DUPLICADA =
  'duplicate key value violates unique constraint "reviews_user_id_product_id_key"';
const MENSAGEM_COLUNA =
  'null value in column "rating" of relation "reviews" violates not-null constraint';

describe("addReview — o erro cru do banco não vaza para a tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Estrutura mínima do espião, sem depender dos genéricos internos do vitest.
  let consolaErro: { mock: { calls: Array<unknown[]> }; mockRestore: () => void };

  beforeEach(async () => {
    h.singleOk = { data: null, error: null };
    h.rejeicaoSingle = null;
    h.lista = { data: [], error: null };
    h.inserts.length = 0;
    h.eqs.length = 0;
    const { toast } = await import("sonner");
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    // O console.error com o erro completo é o diagnóstico que TEM de
    // sobreviver; o espião o captura sem sujar a saída do teste.
    consolaErro = vi
      .spyOn(console, "error")
      .mockImplementation(() => {}) as typeof consolaErro;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    consolaErro.mockRestore();
  });

  /** Tudo que passou pelo console.error durante o teste, serializado.
   *
   * As contrabarras do escape de JSON saem fora: só elas diferenciariam
   * `table \"reviews\"` (serializado) de `table "reviews"` (o texto real do
   * banco), e a prova aqui é do TEXTO, não da pontuação.
   */
  const textoDoConsole = (): string =>
    consolaErro.mock.calls
      .map((chamada) =>
        chamada
          .map((parte) => {
            if (typeof parte === "string") return parte;
            if (parte instanceof Error) return `${parte.name}: ${parte.message}`;
            try {
              return JSON.stringify(parte);
            } catch {
              return String(parte);
            }
          })
          .join(" "),
      )
      .join("\n")
      .replaceAll("\\", "");

  type AddReview = (avaliacao: {
    productId: string;
    rating: number;
    comment: string;
  }) => Promise<unknown>;

  /**
   * Monta uma sonda só para alcançar `addReview` com os hooks do React vivos,
   * chama o método com uma avaliação típica e devolve o retorno dele.
   */
  const chamarAddReview = async (): Promise<unknown> => {
    type SondaProps = { readonly aoCapturar: (m: AddReview) => void };
    const capturada = vi.fn((_metodo: AddReview) => {});

    // A captura vai num efeito, não no corpo do render: escrever em variável
    // de fora durante o render é efeito colateral (mesma razão do teste de
    // useCoupons citado acima).
    function Sonda({ aoCapturar }: SondaProps) {
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

  /** A última mensagem que o app mandou para a tela como erro. */
  const ultimaMensagemDeErroNaTela = async (): Promise<string> => {
    const { toast } = await import("sonner");
    const chamadas = (toast.error as ReturnType<typeof vi.fn>).mock.calls;
    expect(chamadas.length).toBeGreaterThan(0);
    return String(chamadas.at(-1)?.[0]);
  };

  it("recusa de política do banco SEM sinal de sessão: frase genérica na tela, nunca manda fazer login, texto cru só no console", async () => {
    // reviews_insert_policy devolve 42501 com esta MESMA mensagem tanto para
    // sessão inválida quanto para a loja ter desligado enable_reviews (ver
    // supabase/migrations/20260812020000_reviews_insert_respeita_enable_reviews.sql).
    // Sem "jwt" na mensagem, não há como diferenciar as duas causas — por
    // isso a tela tem de ficar com a frase genérica, nunca com "faça login".
    h.singleOk = { data: null, error: { code: "42501", message: MENSAGEM_RLS } };

    const retorno = await chamarAddReview();

    expect(retorno).toBeNull();

    // O QUE A PESSOA LÊ: mensagem estável, em português, SEM o desenho do
    // banco e SEM mandar fazer login de novo — "faça login" seria falso se
    // a causa real for a loja ter desligado avaliações, e o comprador
    // tentaria de novo para sempre sem nunca descobrir o motivo.
    const mensagemNaTela = await ultimaMensagemDeErroNaTela();
    expect(mensagemNaTela).toBe(
      "Não foi possível enviar sua avaliação agora. Tente novamente em instantes.",
    );
    for (const fragmentoProibido of [
      "row-level",
      "security policy",
      "table",
      "reviews",
      "erro ao enviar avaliação:",
      "login",
      "faça login",
    ]) {
      expect(mensagemNaTela.toLowerCase()).not.toContain(
        fragmentoProibido.toLowerCase(),
      );
    }

    // O DIAGNÓSTICO SOBREVIVEU: o texto cru chegou INTEIRO ao console.error.
    const saidaDoConsole = textoDoConsole();
    expect(saidaDoConsole).toContain(MENSAGEM_RLS);
    expect(saidaDoConsole).toContain("row-level security policy");
  });

  it("recusa de permissão porque a LOJA desligou avaliações (enable_reviews=false): mesma frase genérica, nunca 'faça login'", async () => {
    // Cenário concreto do achado de revisão: o comprador está LOGADO, com
    // sessão válida (auth.uid() = user_id bate), mas a lojista desligou o
    // interruptor "Avaliações dos Clientes" no painel enquanto o formulário
    // já estava aberto — a policy recusa com 42501 mesmo assim, porque o
    // segundo braço do WITH CHECK (enable_reviews) falhou. Refazer login
    // aqui não resolveria NUNCA: o comprador ficaria preso num loop de
    // "faça login" que não tem relação com o problema real. A mensagem varia
    // (o PostgREST não garante o mesmo texto sempre), então este caso usa uma
    // pista diferente da do teste anterior para provar que é o CÓDIGO 42501
    // sozinho, sem "jwt" na pista, que decide o ramo — não uma substring
    // específica de uma mensagem.
    h.singleOk = {
      data: null,
      error: { code: "42501", message: "permission denied for table reviews" },
    };

    const retorno = await chamarAddReview();

    expect(retorno).toBeNull();
    const mensagemNaTela = await ultimaMensagemDeErroNaTela();
    expect(mensagemNaTela).toBe(
      "Não foi possível enviar sua avaliação agora. Tente novamente em instantes.",
    );
    expect(mensagemNaTela.toLowerCase()).not.toContain("login");
    expect(mensagemNaTela.toLowerCase()).not.toContain("permission");
    expect(mensagemNaTela.toLowerCase()).not.toContain("table");
  });

  it("gravação bem-sucedida: fluxo idêntico — dado devolvido, toast de sucesso, mesma gravação e mesmo refresh", async () => {
    h.singleOk = {
      data: { id: "rev-nova", product_id: "prod-1" },
      error: null,
    };

    const retorno = await chamarAddReview();

    // Mesmo retorno de sempre.
    expect(retorno).toEqual({ id: "rev-nova", product_id: "prod-1" });

    const { toast } = await import("sonner");
    const sucesso = toast.success as ReturnType<typeof vi.fn>;
    const erro = toast.error as ReturnType<typeof vi.fn>;
    expect(sucesso).toHaveBeenCalledTimes(1);
    expect(sucesso.mock.calls[0]?.[0]).toBe("Avaliação enviada com sucesso!");
    expect(erro).not.toHaveBeenCalled();

    // Mesma gravação: payload idêntico ao que ia antes da correção.
    expect(h.inserts).toEqual([
      {
        product_id: "prod-1",
        user_id: "comprador-teste",
        rating: 5,
        comment: "Produto ótimo",
      },
    ]);
    // Mesmo refresh: getReviewsByProduct consultou o produto avaliado.
    expect(h.eqs).toContainEqual(["product_id", "prod-1"]);
  });

  it("já avaliou este produto: causa nomeada, sem nome de restrição na tela", async () => {
    h.singleOk = {
      data: null,
      error: { code: "23505", message: MENSAGEM_DUPLICADA },
    };

    const retorno = await chamarAddReview();

    expect(retorno).toBeNull();
    const mensagemNaTela = await ultimaMensagemDeErroNaTela();
    expect(mensagemNaTela).toBe("Você já avaliou este produto.");
    for (const fragmentoProibido of [
      "constraint",
      "duplicate key",
      "reviews_user_id",
    ]) {
      expect(mensagemNaTela).not.toContain(fragmentoProibido);
    }
    expect(textoDoConsole()).toContain(MENSAGEM_DUPLICADA);
  });

  it("rede caiu antes do banco: convite a tentar de novo, sem jargão técnico", async () => {
    h.rejeicaoSingle = new TypeError("Failed to fetch");

    const retorno = await chamarAddReview();

    expect(retorno).toBeNull();
    const mensagemNaTela = await ultimaMensagemDeErroNaTela();
    expect(mensagemNaTela).toBe(
      "Sem conexão com o servidor. Verifique sua internet e tente novamente.",
    );
    expect(mensagemNaTela.toLowerCase()).not.toContain("fetch");
    expect(textoDoConsole()).toContain("Failed to fetch");
  });

  it("recusa desconhecida do banco: frase honesta genérica — nada de coluna ou relação na tela", async () => {
    h.singleOk = {
      data: null,
      error: { code: "23502", message: MENSAGEM_COLUNA },
    };

    const retorno = await chamarAddReview();

    expect(retorno).toBeNull();
    const mensagemNaTela = await ultimaMensagemDeErroNaTela();
    expect(mensagemNaTela).toBe(
      "Não foi possível enviar sua avaliação agora. Tente novamente em instantes.",
    );
    for (const fragmentoProibido of [
      "relation",
      "column",
      "violates",
      "rating",
    ]) {
      expect(mensagemNaTela).not.toContain(fragmentoProibido);
    }
    expect(textoDoConsole()).toContain(MENSAGEM_COLUNA);
  });

  it("sessão expirada (JWT): aponta para entrar de novo, sem citar token", async () => {
    h.singleOk = {
      data: null,
      error: { code: "PGRST301", message: "JWT expired" },
    };

    const retorno = await chamarAddReview();

    expect(retorno).toBeNull();
    const mensagemNaTela = await ultimaMensagemDeErroNaTela();
    expect(mensagemNaTela).toBe(
      "Não foi possível registrar sua avaliação. Faça login novamente e tente de novo.",
    );
    expect(mensagemNaTela.toLowerCase()).not.toContain("jwt");
  });
});
