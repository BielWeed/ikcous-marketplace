import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B3 da revisão de risco pré-publicação (26/09/2026): o 409 "Há um pagamento
 * com cartão em análise para este pedido." (criar-pagamento/index.ts) tem que
 * chegar ao CheckoutView como um sinal PRÓPRIO, não só como mais um erro
 * recuperável — cancelar o pedido enquanto o cartão ainda pode ser aprovado
 * pelo banco é dinheiro cobrado por um pedido morto. O contrato combinado com
 * a revisão do edge: o corpo do 409 vai carregar `cartaoEmAnalise: true`, e
 * `criarPagamento` precisa propagar esse campo no Error que lança — MESMO
 * padrão de `.terminal` (ver criar-pagamento-erro.test.ts), que este arquivo
 * não toca.
 *
 * Mesmo dublê de React de create-order-rpc.test.ts / criar-pagamento-erro.
 * test.ts: `useOrders` chama useAuth/useLeaderElection na primeira linha, e o
 * projeto não tem @testing-library — o dublê deixa `useOrders(...)`
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
 * fica em `error.context`, que é um `Response`.
 */
function erroDeInvokeComCorpo(corpo: Record<string, unknown>) {
  return {
    message: "Edge Function returned a non-2xx status code",
    context: { json: async () => corpo },
  };
}

const ARGS_PIX = { orderId: "ped-1", metodo: "pix" as const };

describe("useOrders/criarPagamento propaga o campo cartaoEmAnalise do 409 (B3)", () => {
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockClear();
  });

  it("409 com cartaoEmAnalise:true lança Error com .cartaoEmAnalise === true", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: erroDeInvokeComCorpo({
        error: "Há um pagamento com cartão em análise para este pedido.",
        cartaoEmAnalise: true,
      }),
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_PIX);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect(erroCapturado.message).toBe(
      "Há um pagamento com cartão em análise para este pedido.",
    );
    expect(erroCapturado.cartaoEmAnalise).toBe(true);
  });

  it("409 comum (sem cartaoEmAnalise) lança Error com .cartaoEmAnalise !== true — falha fechada", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: erroDeInvokeComCorpo({
        error: "Não foi possível gerar a cobrança.",
      }),
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_PIX);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect(erroCapturado.cartaoEmAnalise).not.toBe(true);
  });

  it("cartaoEmAnalise: 'true' (string) não vira true — só o booleano literal conta", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: erroDeInvokeComCorpo({
        error: "Há um pagamento com cartão em análise para este pedido.",
        cartaoEmAnalise: "true",
      }),
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_PIX);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado.cartaoEmAnalise).not.toBe(true);
  });
});

/**
 * Contrato "forma de cartão desligada" (01/10/2026): o 409 do portão de
 * `criar-pagamento` carrega `codigo: "CARTAO_FORMA_DESLIGADA"` — e SÓ isso. O
 * código não afirma ausência de cobrança (o portão roda antes do ramo
 * "reconsultar" da edge); serve para a tela trocar a configuração e oferecer
 * PIX pela guarda da vaga. `criarPagamento` transporta o código no Error
 * somente quando é o literal EXATO — qualquer outra coisa fica `undefined`
 * (falha fechada, mesma régua estrita de `terminal`/`cartaoEmAnalise`).
 */
const CODIGO_FORMA_DESLIGADA = "CARTAO_FORMA_DESLIGADA";
const MENSAGEM_FORMA_DESLIGADA =
  "Esta forma de pagamento não está disponível nesta loja.";
const ARGS_CARTAO = {
  orderId: "ped-1",
  metodo: "cartao" as const,
  token: "tok",
  paymentMethodId: "master",
  paymentTypeId: "credit_card" as const,
  parcelas: 1,
  documento: { type: "CPF", number: "12345678909" },
};

type Origem = "error.context.json()" | "data.error";

/** A resposta do invoke com o corpo da edge na origem pedida. */
function respostaDoInvoke(origem: Origem, corpo: Record<string, unknown>) {
  return origem === "error.context.json()"
    ? { data: null, error: erroDeInvokeComCorpo(corpo) }
    : { data: corpo, error: null };
}

async function erroDeCriarPagamento(
  origem: Origem,
  corpo: Record<string, unknown>,
): Promise<any> {
  vi.mocked(supabase.functions.invoke).mockResolvedValue(
    respostaDoInvoke(origem, corpo) as any,
  );
  // React é dublado neste arquivo; useOrders roda como função síncrona nos testes.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { criarPagamento } = useOrders(false, true);
  try {
    await criarPagamento(ARGS_CARTAO as any);
  } catch (err) {
    return err;
  }
  throw new Error("criarPagamento devia ter lançado");
}

const ORIGENS: Origem[] = ["error.context.json()", "data.error"];

describe("useOrders/criarPagamento transporta Error.codigo só para o literal CARTAO_FORMA_DESLIGADA", () => {
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockReset();
  });

  it.each(ORIGENS)(
    "%s: codigo exato vira Error.codigo, com a mensagem e terminal/cartaoEmAnalise falsos preservados",
    async (origem) => {
      const erro = await erroDeCriarPagamento(origem, {
        error: MENSAGEM_FORMA_DESLIGADA,
        codigo: CODIGO_FORMA_DESLIGADA,
      });

      expect(erro).toBeInstanceOf(Error);
      expect(erro.message).toBe(MENSAGEM_FORMA_DESLIGADA);
      expect(erro.codigo).toBe(CODIGO_FORMA_DESLIGADA);
      // O código NÃO é afirmação sobre cobrança: nada é inventado.
      expect(erro.terminal).toBe(false);
      expect(erro.cartaoEmAnalise).toBe(false);
      expect("semCobranca" in erro).toBe(false);
    },
  );

  it.each(ORIGENS)(
    "%s: o código não apaga terminal/cartaoEmAnalise que vieram no MESMO corpo",
    async (origem) => {
      const erro = await erroDeCriarPagamento(origem, {
        error: MENSAGEM_FORMA_DESLIGADA,
        codigo: CODIGO_FORMA_DESLIGADA,
        terminal: true,
        cartaoEmAnalise: true,
      });

      expect(erro.codigo).toBe(CODIGO_FORMA_DESLIGADA);
      expect(erro.terminal).toBe(true);
      expect(erro.cartaoEmAnalise).toBe(true);
    },
  );

  const NAO_SAO_O_CODIGO: ReadonlyArray<[string, Record<string, unknown>]> = [
    ["ausente", {}],
    ["outro texto", { codigo: "OUTRO_CODIGO" }],
    ["minúsculas", { codigo: "cartao_forma_desligada" }],
    ["com espaço", { codigo: ` ${CODIGO_FORMA_DESLIGADA} ` }],
    ["número", { codigo: 1 }],
    ["booleano", { codigo: true }],
    ["lista com o literal", { codigo: [CODIGO_FORMA_DESLIGADA] }],
    ["objeto", { codigo: { valor: CODIGO_FORMA_DESLIGADA } }],
    ["null", { codigo: null }],
  ];

  for (const origem of ORIGENS) {
    it.each(NAO_SAO_O_CODIGO)(
      `${origem}: codigo %s -> Error.codigo indefinido (falha fechada)`,
      async (_rotulo, extra) => {
        const erro = await erroDeCriarPagamento(origem, {
          error: MENSAGEM_FORMA_DESLIGADA,
          ...extra,
        });

        expect(erro).toBeInstanceOf(Error);
        expect(erro.codigo).toBeUndefined();
        // A MESMA frase sem o código não vira código: nada se deduz do texto.
        expect(erro.message).toBe(MENSAGEM_FORMA_DESLIGADA);
      },
    );
  }
});
