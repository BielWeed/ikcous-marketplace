// @vitest-environment jsdom
//
// REDE QUE PENDURA NÃO PODE TRAVAR O CUPOM DO CHECKOUT.
//
// Rede "pendurada" conecta e não responde. Sem prazo:
//   - "Aplicando…" nunca terminava, e a tela toda do cupom ficava travada
//     (toque em outro cartão, remover, digitar de novo);
//   - o esqueleto "Carregando cupons" girava para sempre, sem "Tentar de novo"
//     (esse botão só existe no estado de erro, que a chamada pendurada nunca
//     alcançava).
//
// Com o prazo (`aguardarComPrazo`, o mesmo do pedido e da revisão do frete no
// envio) a espera estoura: aplicar devolve o aviso de conexão lenta
// (`networkError`) e a lista vira o estado de erro que já tinha o botão.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getSession = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: () => getSession() },
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO_MS = 12_000;
const PAUSA_DO_SUBTOTAL_MS = 400;
const MENSAGEM_DE_CUPOM_LENTO =
  "A conexão está lenta. Toque em Aplicar para tentar de novo.";

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const passar = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("useCoupons.validateCoupon — aplicar com rede pendurada", () => {
  type Resultado = {
    valid: boolean;
    discount: number;
    message?: string;
    networkError?: boolean;
  };
  type Metodo = (code: string, subtotal: number) => Promise<Resultado>;

  async function montar(): Promise<Metodo> {
    const { useCoupons } = await import("@/hooks/useCoupons");
    let validateCoupon!: Metodo;
    function Sonda() {
      const { validateCoupon: metodo } = useCoupons(false);
      useEffect(() => {
        validateCoupon = metodo as Metodo;
      }, [metodo]);
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    return (code, subtotal) => validateCoupon(code, subtotal);
  }

  /** Dispara e acompanha a promessa sem travar o teste se ela nunca voltar. */
  function disparar(validar: Metodo, codigo = "PROMO10") {
    const estado: { resultado: Resultado | null } = { resultado: null };
    void validar(codigo, 100).then((r) => {
      estado.resultado = r;
    });
    return estado;
  }

  it("a âncora: antes do prazo continua esperando, sem resposta", async () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    const validar = await montar();
    const estado = disparar(validar);
    await passar(PRAZO_MS - 1_000);
    expect(estado.resultado).toBeNull();
  });

  it("RPC pendurada: estoura o prazo e devolve o aviso de conexão lenta", async () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    const validar = await montar();
    const estado = disparar(validar);

    await passar(PRAZO_MS + 100);

    expect(estado.resultado).toEqual({
      valid: false,
      discount: 0,
      message: MENSAGEM_DE_CUPOM_LENTO,
      networkError: true,
    });
  });

  it("depois do aviso, aplicar de novo com rede boa funciona", async () => {
    rpc.mockImplementationOnce(() => new Promise(() => {}));
    const validar = await montar();
    const primeira = disparar(validar);
    await passar(PRAZO_MS + 100);
    expect(primeira.resultado?.networkError).toBe(true);

    rpc.mockResolvedValueOnce({
      data: { is_valid: true, discount_value: 10, error_message: null },
      error: null,
    });
    const segunda = disparar(validar);
    await passar(10);

    expect(segunda.resultado).toMatchObject({ valid: true, discount: 10 });
  });

  it("a pergunta da vaga presa também tem prazo: a cadeia inteira não pendura", async () => {
    // A validação responde "limite de uso" e a segunda pergunta (vaga presa
    // num pedido cancelado) é quem pendura.
    rpc.mockImplementation((nome: string) =>
      nome === "validate_coupon_secure_v2"
        ? Promise.resolve({
            data: {
              is_valid: false,
              discount_value: 0,
              error_message: "Cupom atingiu o limite de uso.",
            },
            error: null,
          })
        : new Promise(() => {}),
    );
    const validar = await montar();
    const estado = disparar(validar);

    await passar(PRAZO_MS + 100);

    expect(estado.resultado?.networkError).toBe(true);
    expect(estado.resultado?.message).toBe(MENSAGEM_DE_CUPOM_LENTO);
  });
});

describe("useCuponsDoCheckout — lista de cupons com rede pendurada", () => {
  type Retorno = ReturnType<
    typeof import("@/hooks/useCuponsDoCheckout").useCuponsDoCheckout
  >;
  let ultimo: Retorno | null = null;

  async function montar() {
    const { useCuponsDoCheckout } = await import("@/hooks/useCuponsDoCheckout");
    function Sonda() {
      const valor = useCuponsDoCheckout({
        subtotal: 100,
        userId: null,
        ligado: true,
      });
      useEffect(() => {
        ultimo = valor;
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
  }

  const linha = (codigo: string) => ({
    codigo,
    tipo: "fixed",
    valor: 10,
    minimo: 0,
    valido_ate: null,
    exclusivo: false,
    aplica: true,
    falta: 0,
    desconto: 10,
  });

  beforeEach(() => {
    ultimo = null;
  });

  it("a âncora: antes do prazo segue 'carregando', sem erro", async () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    await montar();
    await passar(PAUSA_DO_SUBTOTAL_MS + PRAZO_MS - 1_000);
    expect(ultimo?.situacao).toBe("carregando");
  });

  it("busca pendurada: estoura o prazo e vira 'erro' (a seção mostra o botão)", async () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    await montar();
    expect(ultimo?.situacao).toBe("carregando");

    await passar(PAUSA_DO_SUBTOTAL_MS + PRAZO_MS + 100);

    expect(ultimo?.situacao).toBe("erro");
    expect(ultimo?.cupons).toEqual([]);
  });

  it("'tentar de novo' com sucesso depois do erro mostra a lista", async () => {
    rpc.mockImplementationOnce(() => new Promise(() => {}));
    await montar();
    await passar(PAUSA_DO_SUBTOTAL_MS + PRAZO_MS + 100);
    expect(ultimo?.situacao).toBe("erro");

    rpc.mockResolvedValueOnce({ data: [linha("B")], error: null });
    await act(async () => {
      ultimo?.tentarDeNovo();
    });

    expect(ultimo?.situacao).toBe("pronto");
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["B"]);
  });

  it("resposta tardia da tentativa velha não vira o estado da nova", async () => {
    let soltarAVelha: (v: unknown) => void = () => {};
    rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          soltarAVelha = resolve;
        }),
    );
    await montar();
    await passar(PAUSA_DO_SUBTOTAL_MS + PRAZO_MS + 100);
    expect(ultimo?.situacao).toBe("erro");

    rpc.mockResolvedValueOnce({ data: [linha("NOVA")], error: null });
    await act(async () => {
      ultimo?.tentarDeNovo();
    });
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["NOVA"]);

    await act(async () => {
      soltarAVelha({ data: [linha("VELHA")], error: null });
    });
    await passar(PRAZO_MS);

    expect(ultimo?.situacao).toBe("pronto");
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["NOVA"]);
  });

  it("o prazo da tentativa velha estourando não derruba a lista da mais nova", async () => {
    // Tentativa 1 pendurada; aos 5 s "tentar de novo" já traz a lista. Quando o
    // prazo da 1 vence, a rodada mais nova manda: nada de erro por cima.
    rpc
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ data: [linha("NOVA")], error: null });
    await montar();
    await passar(PAUSA_DO_SUBTOTAL_MS + 5_000);
    await act(async () => {
      ultimo?.tentarDeNovo();
    });
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["NOVA"]);

    await passar(PRAZO_MS);

    expect(ultimo?.situacao).toBe("pronto");
    expect(ultimo?.cupons.map((c) => c.codigo)).toEqual(["NOVA"]);
  });
});
