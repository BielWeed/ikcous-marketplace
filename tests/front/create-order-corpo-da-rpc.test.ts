import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    info: vi.fn(),
  },
}));

/**
 * useOrders/createOrder — o CORPO que a função de criar pedido manda ao banco.
 *
 * `create-order-rpc.test.ts` confere QUAL função do banco é chamada, mas com
 * `expect.anything()` no lugar dos argumentos. Aqui o objeto enviado é conferido
 * INTEIRO, num pedido que tem cupom, tamanho/cor (variação) e dados de endereço.
 * Sem este teste, trocar `p_coupon_code`, `variant_id` ou `p_address_data` por
 * `null` passava em toda a suíte: na loja, toda compra com cupom ou com tamanho
 * seria recusada pelo banco ("Os valores do pedido mudaram" / "Escolha uma
 * variação"), e o CPF do destinatário sumiria do pedido.
 *
 * O `react` é trocado por um dublê mínimo pelo mesmo motivo explicado em
 * `create-order-rpc.test.ts` (o projeto não usa renderHook): o corpo de
 * createOrder que roda aqui é o do app, não um substituto.
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
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: "ped-1", error: null }),
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  },
}));

const ENDERECO_COM_CPF = {
  cpf: "00000000000",
  cep: "01001000",
  street: "Rua Teste",
  number: "10",
};

function argumentosDaRpc(): Record<string, unknown> {
  const chamadas = vi.mocked(supabase.rpc).mock.calls;
  expect(chamadas).toHaveLength(1);
  return chamadas[0][1] as Record<string, unknown>;
}

describe("createOrder manda ao banco o pedido inteiro, com cupom, variação e endereço", () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockClear();
  });

  it("cupom, variação e dados do endereço chegam à função do banco", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder({
      items: [
        { productId: "prod-1", variantId: "var-p", quantity: 2 },
        { productId: "prod-2", quantity: 1 },
      ],
      totalAmount: 80,
      shippingCost: 12.5,
      paymentMethod: "pix",
      addressId: "end-1",
      couponCode: "DEZ",
      customer: { name: "Fulana", whatsapp: "11999999999" },
      notes: "Deixar na portaria",
      addressData: ENDERECO_COM_CPF,
      destinationCep: "01001000",
      shippingOptionId: "opt-1",
      idempotencyKey: "chave-1",
    });

    expect(argumentosDaRpc()).toEqual({
      p_items: [
        { product_id: "prod-1", variant_id: "var-p", quantity: 2 },
        // Produto sem variação: variant_id vai null, nunca some nem vira "".
        { product_id: "prod-2", variant_id: null, quantity: 1 },
      ],
      p_total_amount: 80,
      p_shipping_cost: 12.5,
      p_payment_method: "pix",
      p_address_id: "end-1",
      p_coupon_code: "DEZ",
      p_customer_name: "Fulana",
      p_customer_phone: "11999999999",
      p_observation: "Deixar na portaria",
      p_address_data: ENDERECO_COM_CPF,
      p_destination_cep: "01001000",
      p_shipping_option_id: "opt-1",
      p_idempotency_key: "chave-1",
    });
  });

  it("o mesmo vale quando o pagamento é online (a outra versão da função do banco)", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { total: 80 }, error: null }),
        }),
      }),
    } as never);
    const { createOrder } = useOrders(false, false);
    await createOrder(
      {
        items: [{ productId: "prod-1", variantId: "var-p", quantity: 2 }],
        totalAmount: 80,
        shippingCost: 0,
        paymentMethod: "pix",
        couponCode: "DEZ",
        customer: { name: "Fulana", whatsapp: "11999999999" },
        addressData: ENDERECO_COM_CPF,
      },
      { comPagamentoOnline: true },
    );

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_marketplace_order_v24",
      expect.anything(),
    );
    const args = argumentosDaRpc();
    expect(args.p_coupon_code).toBe("DEZ");
    expect(args.p_items).toEqual([
      { product_id: "prod-1", variant_id: "var-p", quantity: 2 },
    ]);
    expect(args.p_address_data).toEqual(ENDERECO_COM_CPF);
  });

  it("sem cupom, sem variação e sem endereço, os três vão null (não somem)", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder({
      items: [{ productId: "prod-1", quantity: 1 }],
      totalAmount: 100,
      shippingCost: 0,
      paymentMethod: "pix",
      customer: { name: "Fulana", whatsapp: "11999999999" },
    });

    const args = argumentosDaRpc();
    expect(args.p_coupon_code).toBeNull();
    expect(args.p_address_data).toBeNull();
    expect(args.p_items).toEqual([
      { product_id: "prod-1", variant_id: null, quantity: 1 },
    ]);
  });
});
