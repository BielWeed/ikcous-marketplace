import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * useOrders/criarPagamento — CHECKOUT-050 (#194): o Error que esta função
 * lança precisa carregar o campo `terminal` que a edge function manda no
 * corpo do 409 (`{ error, terminal }`, ver supabase/functions/criar-pagamento
 * /index.ts), não só a mensagem. Antes deste conserto, `criarPagamento`
 * recortava só `corpo.error` — PagamentoOnline.tsx tinha que ADIVINHAR a
 * categoria comparando a MENSAGEM por igualdade exata com um texto fixo, e
 * quebrava assim que o pg_cron trocava a mensagem real (ver o achado da
 * revisão em PagamentoOnline.tsx).
 *
 * Mesmo dublê de React de create-order-rpc.test.ts: `useOrders` chama
 * useAuth/useLeaderElection logo na primeira linha, e o projeto não tem
 * @testing-library — trocar react por um dublê mínimo deixa `useOrders(...)`
 * executável como função síncrona comum, com o MESMO corpo de
 * `criarPagamento` que o app usa.
 */
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    useState: (inicial: unknown) => [
      typeof inicial === "function" ? (inicial as () => unknown)() : inicial,
      vi.fn(),
    ],
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useRef: (inicial: unknown) => ({ current: inicial }),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

/**
 * Reproduz o formato real do erro que o supabase-js v2 devolve quando
 * `functions.invoke` recebe uma resposta NÃO-2xx: `data` vem null e o corpo
 * fica em `error.context`, que é um `Response`. Ver o comentário grande em
 * useOrders.ts:980-986 sobre essa armadilha do contrato.
 */
function erroDeInvokeComCorpo(corpo: Record<string, unknown>) {
  return {
    message: "Edge Function returned a non-2xx status code",
    context: { json: async () => corpo },
  };
}

const ARGS_MINIMOS = { orderId: "ped-1", metodo: "pix" as const };

describe("useOrders/criarPagamento propaga o campo terminal do 409, não só a mensagem", () => {
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockClear();
  });

  it("409 com terminal:true lança Error com .terminal === true", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: erroDeInvokeComCorpo({
        error: "Este pedido não está aguardando pagamento.",
        terminal: true,
      }),
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_MINIMOS);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect(erroCapturado.message).toBe(
      "Este pedido não está aguardando pagamento.",
    );
    expect(erroCapturado.terminal).toBe(true);
  });

  it("409 sem o campo terminal (versão antiga da edge function) lança Error com .terminal !== true", async () => {
    // De propósito SEM compatibilidade especial: a função publicada hoje
    // manda o campo; se um dia não mandar, o front trata como recuperável
    // (falha fechada), nunca reintroduzindo comparação de texto.
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: erroDeInvokeComCorpo({
        error: "O prazo para pagar este pedido acabou.",
      }),
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_MINIMOS);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect(erroCapturado.terminal).not.toBe(true);
  });

  it("corpo ilegível (context.json rejeita) ainda lança Error com .terminal !== true e mensagem genérica", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: {
        message: "network error",
        context: {
          json: async () => {
            throw new Error("corpo vazio");
          },
        },
      },
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_MINIMOS);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect(erroCapturado.message).toBe("Não foi possível gerar a cobrança.");
    expect(erroCapturado.terminal).not.toBe(true);
  });

  it("ramo data?.error usa a MESMA regra estrita do ramo error — 'false' (string) não vira terminal", async () => {
    // Achado da revisão: o ramo `error` (acima) exige `typeof === "boolean"`,
    // mas o ramo `data?.error` usava `Boolean(...)`, que aceita qualquer
    // valor truthy — a string "false", o número 1, um objeto. Inalcançável
    // hoje (o supabase-js v2 sempre preenche `error` numa resposta não-2xx),
    // mas duas regras diferentes para o MESMO campo, a poucas linhas de
    // distância, é convite a essa divergência voltar. Este teste força as
    // duas leituras a concordar.
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { error: "Falha genérica.", terminal: "false" },
      error: null,
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_MINIMOS);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect(erroCapturado.terminal).not.toBe(true);
  });
});

/**
 * LOTE 210 (caça 8) — loja sem a chave de assinatura do webhook. A edge manda
 * uma frase de OPERADOR ("...cadastrar a chave de assinatura do webhook do
 * Mercado Pago") e, ao lado dela, o MARCADOR `pixSemChaveDeAssinatura` /
 * `cartaoSemChaveDeAssinatura`. Quem compra nunca lê a frase de operador: o
 * front troca pelo texto de cliente olhando o MARCADOR (booleano `true`
 * exato), nunca comparando o texto da edge.
 */
describe("useOrders/criarPagamento traduz o marcador de 'loja sem chave de assinatura' para frase de cliente", () => {
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockClear();
  });

  /** Prepara a resposta 409 da edge (corpo no formato do supabase-js v2). */
  function responderComErro(corpo: Record<string, unknown>) {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: erroDeInvokeComCorpo(corpo),
    } as any);
  }

  /** O erro que a chamada lança (falha o teste se ela não lançar). */
  async function pegarErro(chamada: () => Promise<unknown>) {
    try {
      await chamada();
    } catch (err) {
      return err as any;
    }
    throw new Error("criarPagamento deveria ter lançado");
  }

  it("PIX: o marcador vira a frase de cliente, sem jargão, e segue terminal", async () => {
    responderComErro({
      error:
        "Para pagar com Pix, a loja precisa cadastrar a chave de assinatura do webhook do Mercado Pago.",
      terminal: true,
      pixSemChaveDeAssinatura: true,
    });
    const { criarPagamento } = useOrders(false, true);
    const erro = await pegarErro(() => criarPagamento(ARGS_MINIMOS));
    expect(erro.message).toBe(
      "Esta loja não está recebendo Pix pelo app agora. Fale com a loja para combinar outra forma de pagamento.",
    );
    expect(erro.message).not.toMatch(/webhook|assinatura|Mercado Pago/i);
    expect(erro.terminal).toBe(true);
  });

  it("cartão: o marcador vira a frase de cliente, sem jargão, e segue terminal", async () => {
    responderComErro({
      error:
        "Para pagar com cartão, a loja precisa cadastrar a chave de assinatura do webhook do Mercado Pago.",
      terminal: true,
      cartaoSemChaveDeAssinatura: true,
    });
    const { criarPagamento } = useOrders(false, true);
    const erro = await pegarErro(() => criarPagamento(ARGS_MINIMOS));
    expect(erro.message).toBe(
      "Esta loja não está recebendo cartão pelo app agora. Fale com a loja para combinar outra forma de pagamento.",
    );
    expect(erro.message).not.toMatch(/webhook|assinatura|Mercado Pago/i);
    expect(erro.terminal).toBe(true);
  });

  it.each([
    ["string 'true'", "true"],
    ["número 1", 1],
    ["objeto", {}],
    ["false", false],
  ])(
    "CONTROLE: marcador que não é o booleano true exato (%s) NÃO traduz — a frase da edge segue como veio",
    async (_nome, marcador) => {
      responderComErro({
        error: "Frase qualquer da edge.",
        terminal: true,
        pixSemChaveDeAssinatura: marcador,
      });
      const { criarPagamento } = useOrders(false, true);
      const erro = await pegarErro(() => criarPagamento(ARGS_MINIMOS));
      expect(erro.message).toBe("Frase qualquer da edge.");
    },
  );

  it("CONTROLE: a tradução não olha o TEXTO — a mesma frase de operador SEM marcador passa como veio", async () => {
    const frase =
      "Para pagar com Pix, a loja precisa cadastrar a chave de assinatura do webhook do Mercado Pago.";
    responderComErro({ error: frase, terminal: true });
    const { criarPagamento } = useOrders(false, true);
    const erro = await pegarErro(() => criarPagamento(ARGS_MINIMOS));
    expect(erro.message).toBe(frase);
  });

  it("ramo data?.error (inalcançável hoje) traduz do mesmo jeito", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        error: "Frase de operador.",
        terminal: true,
        cartaoSemChaveDeAssinatura: true,
      },
      error: null,
    } as any);
    const { criarPagamento } = useOrders(false, true);
    let erro: any;
    try {
      await criarPagamento(ARGS_MINIMOS);
    } catch (err) {
      erro = err;
    }
    expect(erro.message).toBe(
      "Esta loja não está recebendo cartão pelo app agora. Fale com a loja para combinar outra forma de pagamento.",
    );
    expect(erro.terminal).toBe(true);
  });
});
