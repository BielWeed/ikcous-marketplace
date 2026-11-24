// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), perguntas do PAINEL. Regras que nenhum teste
// lia no que o hook ENTREGA à tela:
//  - linha incompleta da `get_admin_questions_paged` (produto apagado, autora
//    sem nome, sem selo de comprador) ganha "Produto removido", "Usuário
//    Anônimo" e selo desligado;
//  - as respostas da loja saem da mais antiga para a mais nova, mesmo que o
//    banco as entregue embaralhadas;
//  - total ausente vale 0, busca ausente vira "" e o filtro padrão é "all";
//  - nos números do topo, "respondidas" nunca fica negativa quando as duas
//    contagens (feitas em instantes diferentes) se cruzam.
// Entrada = linha CRUA da RPC e contagens cruas; a conclusão é lida do hook.
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
  rpc: vi.fn(),
  respostaDaRpc: null as unknown,
  // Índice 0 = contagem do total; 1 = contagem dos sem resposta (usa .eq).
  contagens: [
    { count: 0, error: null },
    { count: 0, error: null },
  ] as Array<{ count: number | null; error: unknown }>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      h.rpc(...args);
      return {
        abortSignal: () => Promise.resolve(h.respostaDaRpc),
      };
    },
    from: () => {
      let passouPorEq = false;
      const construtor: {
        select: () => typeof construtor;
        eq: () => typeof construtor;
        then: (
          resolucao: (valor: unknown) => void,
          rejeicao: (erro: unknown) => void,
        ) => void;
      } = {
        select: () => construtor,
        eq: () => {
          passouPorEq = true;
          return construtor;
        },
        // O query builder do Supabase É thenable por desenho (mesmo precedente
        // de qa-stats-erro-nao-e-fila-vazia.test.tsx).
        // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
        then: (resolucao, rejeicao) => {
          Promise.resolve(h.contagens[passouPorEq ? 1 : 0]).then(
            resolucao,
            rejeicao,
          );
        },
      };
      return construtor;
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-ficticio" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "@/hooks/useQuestions";
import { limparCachesDeAdmin } from "@/utils/admin_cache";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Sonda = ReturnType<typeof useQuestions>;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let atual: Sonda;

beforeEach(async () => {
  h.rpc.mockReset();
  h.respostaDaRpc = { data: { data: [] }, error: null };
  h.contagens[0] = { count: 0, error: null };
  h.contagens[1] = { count: 0, error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
  limparCachesDeAdmin();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  function Componente() {
    const q = useQuestions();
    useEffect(() => {
      atual = q;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Componente />);
  });
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  limparCachesDeAdmin();
  vi.restoreAllMocks();
});

async function lista(...args: Parameters<Sonda["getAllQuestions"]>) {
  let retorno: Awaited<ReturnType<Sonda["getAllQuestions"]>>;
  await act(async () => {
    retorno = await atual.getAllQuestions(...args);
  });
  return retorno!;
}

describe("useQuestions (painel) — linha incompleta e ordem das respostas", () => {
  it("produto apagado, autora sem nome e sem selo: 'Produto removido', 'Usuário Anônimo', selo desligado", async () => {
    h.respostaDaRpc = {
      data: {
        data: [
          {
            id: "q-1",
            user_id: "u-1",
            product_id: "p-1",
            question: "Tem no tamanho M?",
            created_at: "2026-11-01T10:00:00.000Z",
            // sem product, user, is_verified, answers
          },
        ],
        total_count: 1,
      },
      error: null,
    };
    const { questions, total } = await lista();

    expect(total).toBe(1);
    expect(questions).toHaveLength(1);
    expect(questions[0].productName).toBe("Produto removido");
    expect(questions[0].customerName).toBe("Usuário Anônimo");
    expect(questions[0].isVerified).toBe(false);
    expect(questions[0].customerAvatar).toBeUndefined();
    expect(questions[0].answers).toEqual([]);
  });

  it("controle: linha completa passa como veio (nome, produto, selo de comprador)", async () => {
    h.respostaDaRpc = {
      data: {
        data: [
          {
            id: "q-2",
            user_id: "u-2",
            product_id: "p-2",
            question: "Serve em quem usa 40?",
            created_at: "2026-11-02T10:00:00.000Z",
            product: { nome: "Tênis Azul", imagem_url: "https://x.test/t.png" },
            user: {
              full_name: "Joana Lima",
              avatar_url: "https://x.test/j.png",
            },
            is_verified: true,
            answers: [],
          },
        ],
        total_count: 1,
      },
      error: null,
    };
    const { questions } = await lista();

    expect(questions[0]).toMatchObject({
      productName: "Tênis Azul",
      productImage: "https://x.test/t.png",
      customerName: "Joana Lima",
      customerAvatar: "https://x.test/j.png",
      isVerified: true,
    });
  });

  it("respostas embaralhadas pelo banco saem da mais antiga para a mais nova", async () => {
    h.respostaDaRpc = {
      data: {
        data: [
          {
            id: "q-3",
            user_id: "u-3",
            product_id: "p-3",
            question: "Qual o prazo?",
            created_at: "2026-11-01T10:00:00.000Z",
            answers: [
              {
                id: "a-nova",
                question_id: "q-3",
                answer: "Atualização: 5 dias.",
                created_at: "2026-11-03T10:00:00.000Z",
              },
              {
                id: "a-velha",
                question_id: "q-3",
                answer: "Prazo de 7 dias.",
                created_at: "2026-11-01T11:00:00.000Z",
              },
              {
                id: "a-meio",
                question_id: "q-3",
                answer: "Corrigindo: 6 dias.",
                created_at: "2026-11-02T10:00:00.000Z",
              },
            ],
          },
        ],
        total_count: 1,
      },
      error: null,
    };
    const { questions } = await lista();

    expect(questions[0].answers.map((resposta) => resposta.id)).toEqual([
      "a-velha",
      "a-meio",
      "a-nova",
    ]);
    // O que o hook guarda para a tela é a mesma ordem.
    expect(atual.questions[0].answers.map((resposta) => resposta.id)).toEqual([
      "a-velha",
      "a-meio",
      "a-nova",
    ]);
  });

  it("resposta sem total: total 0 (número); sem busca e sem filtro, pede '' e 'all'", async () => {
    h.respostaDaRpc = { data: { data: [] }, error: null };
    const { questions, total } = await lista();

    expect(total).toBe(0);
    expect(questions).toEqual([]);
    expect(h.rpc).toHaveBeenLastCalledWith("get_admin_questions_paged", {
      p_search: "",
      p_filter: "all",
      p_page: 0,
      p_page_size: 20,
    });
  });

  it("filtro 'pending', busca e página chegam à RPC como foram pedidos", async () => {
    await lista(2, 10, "pending", "frete");

    expect(h.rpc).toHaveBeenLastCalledWith("get_admin_questions_paged", {
      p_search: "frete",
      p_filter: "pending",
      p_page: 2,
      p_page_size: 10,
    });
  });
});

describe("useQuestions (painel) — números do topo", () => {
  async function numeros() {
    let resultado: Awaited<ReturnType<Sonda["getQAStats"]>>;
    await act(async () => {
      resultado = await atual.getQAStats();
    });
    return resultado!;
  }

  it("as duas contagens se cruzam (mais sem resposta do que total): respondidas e taxa ficam em 0, nunca negativas", async () => {
    // Duas consultas feitas em instantes diferentes: entre uma e outra entrou
    // pergunta nova e a loja ficou com mais "sem resposta" que "total" lido.
    h.contagens[0] = { count: 3, error: null };
    h.contagens[1] = { count: 5, error: null };
    const r = await numeros();

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.total).toBe(3);
      expect(r.pending).toBe(5);
      expect(r.answered).toBe(0);
      expect(r.rate).toBe(0);
    }
  });

  it("controle: 10 no total e 4 sem resposta dão 6 respondidas e 60%", async () => {
    h.contagens[0] = { count: 10, error: null };
    h.contagens[1] = { count: 4, error: null };
    const r = await numeros();

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.answered).toBe(6);
      expect(r.rate).toBe(60);
    }
  });

  it("borda: todas respondidas (pendentes 0) dá 100% e nenhuma pergunta dá taxa 0", async () => {
    h.contagens[0] = { count: 8, error: null };
    h.contagens[1] = { count: 0, error: null };
    const cheio = await numeros();
    expect(cheio.status === "ok" && cheio.answered).toBe(8);
    expect(cheio.status === "ok" && cheio.rate).toBe(100);

    h.contagens[0] = { count: 0, error: null };
    h.contagens[1] = { count: 0, error: null };
    const vazio = await numeros();
    expect(vazio.status === "ok" && vazio.total).toBe(0);
    expect(vazio.status === "ok" && vazio.rate).toBe(0);
  });
});
