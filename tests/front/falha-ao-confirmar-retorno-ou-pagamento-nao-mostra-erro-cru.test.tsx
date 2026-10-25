// @vitest-environment jsdom
//
// Defeito (O4 da revisão da tela Pedidos): quando "O produto voltou" ou o
// registro do pagamento recebido falhavam, o aviso vermelho trazia, embaixo
// da frase em português, o texto CRU do erro: "TypeError: Failed to fetch",
// "JWT expired". Para quem vende, isso é um código ilegível sem o que fazer.
//
// O aviso agora passa pela mesma tradução dos outros avisos do pedido
// (`mensagemAmigavelErroAtualizacaoStatus`), com uma frase de "tente de novo".
// A fronteira que NÃO pode quebrar: as RPCs de pedido levantam frases em
// português escritas para a lojista (P0001: "Pedido cancelado não recebe
// pagamento.") e essas continuam passando inteiras, porque explicam o motivo.
//
// POR QUE A SONDA: sem @testing-library/react neste projeto; o hook real se
// alcança por um componente que expõe as funções via efeito (mesmo molde de
// cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Acao = (id: string, ...resto: boolean[]) => Promise<unknown>;

let host: HTMLDivElement;
let raiz: Root;

async function montarSonda(): Promise<{
  confirmarRetorno: Acao;
  registrarPagamento: Acao;
}> {
  const { useOrders } = await import("@/hooks/useOrders");
  const funcoes: { retorno: Acao; pagamento: Acao } = {
    retorno: async () => undefined,
    pagamento: async () => undefined,
  };
  function Sonda() {
    const { confirmarRetornoDoProduto, registrarPagamentoRecebido } = useOrders(
      false,
      true,
    );
    useEffect(() => {
      funcoes.retorno = confirmarRetornoDoProduto;
      funcoes.pagamento = registrarPagamentoRecebido as Acao;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  return {
    confirmarRetorno: (id) => funcoes.retorno(id),
    registrarPagamento: (id, recebido) => funcoes.pagamento(id, recebido),
  };
}

/** Os dois botões e o aviso de falha de cada um. */
const ACOES = [
  {
    nome: "“O produto voltou”",
    tituloDoAviso: "Não foi possível confirmar o retorno do produto.",
    chamar: (s: Awaited<ReturnType<typeof montarSonda>>) =>
      s.confirmarRetorno("pedido-1"),
    rpcDaAcao: "confirmar_retorno_do_produto",
  },
  {
    nome: "registrar o pagamento recebido",
    tituloDoAviso: "Não foi possível registrar o pagamento recebido.",
    chamar: (s: Awaited<ReturnType<typeof montarSonda>>) =>
      s.registrarPagamento("pedido-1", true),
    rpcDaAcao: "registrar_pagamento_recebido",
  },
  {
    nome: "desfazer o recebimento",
    tituloDoAviso: "Não foi possível desfazer o recebimento.",
    chamar: (s: Awaited<ReturnType<typeof montarSonda>>) =>
      s.registrarPagamento("pedido-1", false),
    rpcDaAcao: "registrar_pagamento_recebido",
  },
] as const;

const FRASE_PADRAO = "Tente novamente em instantes.";
const TEXTO_TECNICO = /fetch|jwt|typeerror|pgrst|expired|constraint|violates/i;

describe("falha ao confirmar o retorno ou o pagamento: o aviso não mostra o erro cru", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(toast.error).mockClear();
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function falhar(
    acao: (typeof ACOES)[number],
    resposta: () => Promise<unknown>,
  ) {
    rpc.mockImplementation(resposta);
    const sonda = await montarSonda();
    await act(async () => {
      await expect(acao.chamar(sonda)).rejects.toBeDefined();
    });
    const chamadas = vi.mocked(toast.error).mock.calls;
    expect(chamadas).toHaveLength(1);
    const [titulo, opcoes] = chamadas[0] as [
      string,
      { description?: string } | undefined,
    ];
    expect(titulo).toBe(acao.tituloDoAviso);
    return opcoes?.description ?? "";
  }

  describe.each(ACOES)("$nome", (acao) => {
    it("sem rede (“TypeError: Failed to fetch”): diz o que fazer, sem o texto técnico", async () => {
      const descricao = await falhar(acao, () =>
        Promise.resolve({
          data: null,
          error: { message: "TypeError: Failed to fetch" },
        }),
      );
      expect(descricao).toBe(FRASE_PADRAO);
      expect(descricao).not.toMatch(TEXTO_TECNICO);
    });

    it("sessão vencida (“JWT expired”): diz o que fazer, sem o texto técnico", async () => {
      const descricao = await falhar(acao, () =>
        Promise.resolve({
          data: null,
          error: { code: "PGRST301", message: "JWT expired" },
        }),
      );
      expect(descricao).toBe(FRASE_PADRAO);
      expect(descricao).not.toMatch(TEXTO_TECNICO);
    });

    it("a chamada nem chega a responder (rejeição da rede): também sem o texto técnico", async () => {
      const descricao = await falhar(acao, () =>
        Promise.reject(new TypeError("Failed to fetch")),
      );
      expect(descricao).toBe(FRASE_PADRAO);
      expect(descricao).not.toMatch(TEXTO_TECNICO);
    });

    it("erro de banco com texto de constraint: nunca vai para a tela", async () => {
      const descricao = await falhar(acao, () =>
        Promise.resolve({
          data: null,
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "marketplace_order_history_pkey"',
          },
        }),
      );
      expect(descricao).toBe(FRASE_PADRAO);
      expect(descricao).not.toMatch(TEXTO_TECNICO);
    });

    it("a frase em português que o servidor escreveu para a lojista (P0001) passa inteira: explica o motivo", async () => {
      const frase = "Pedido cancelado não recebe pagamento.";
      const descricao = await falhar(acao, () =>
        Promise.resolve({
          data: null,
          error: { code: "P0001", message: frase },
        }),
      );
      expect(descricao).toBe(frase);
    });
  });
});
