/**
 * O rastreio do convidado confere o código JUNTO com o trio que o pediu
 * (auditoria de 12/10/2026, R3; migration 20261217000000).
 *
 * O DEFEITO: a verificação `get_orders_by_otp_v1(e-mail, código)` contava os
 * erros pelo e-mail. Quem soubesse só o e-mail de outra pessoa gastava as
 * tentativas do código dela. A `get_orders_by_otp_v2` só olha o código do
 * pedido que confere com e-mail + WhatsApp + pedaço do pedido.
 *
 * Aqui: `fetchOrdersByOtp` com o trio chama a v2 com os quatro parâmetros (e
 * só eles); sem o trio, a v1 de sempre (quem ainda chama com dois argumentos
 * não quebra). A resposta da v2 tem o MESMO envelope da v1, então o resto do
 * caminho (toasts, mapeamento) é o mesmo. A tela que manda o trio está em
 * order-search-manda-o-trio-na-verificacao.test.tsx.
 *
 * Mesmo dublê de React de erro-de-pedido-nao-mostra-texto-cru-do-banco.test.ts.
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

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PEDIDO = {
  id: "11111111-0000-4000-8000-000000abcdef",
  user_id: null,
  total: 100,
  subtotal: 100,
  shipping: 0,
  discount: 0,
  payment_method: "pix",
  status: "pending",
  payment_status: "aguardando",
  items: [],
};

describe("fetchOrdersByOtp — com o trio, a verificação amarrada ao pedido (v2)", () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("com o trio: chama get_orders_by_otp_v2 com e-mail, WhatsApp, fragmento e código", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { ok: true, orders: [PEDIDO] },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    const resultado = await fetchOrdersByOtp("cliente@teste.com", "123456", {
      whatsapp: "34999999999",
      fragmento: "abcdef",
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("get_orders_by_otp_v2", {
      p_email: "cliente@teste.com",
      p_whatsapp: "34999999999",
      p_fragmento: "abcdef",
      p_otp: "123456",
    });
    expect(resultado).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("com o trio e código errado: o toast é o da resposta, com as tentativas que restam", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { ok: false, error: "Código inválido ou expirado.", restantes: 4 },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    const resultado = await fetchOrdersByOtp("cliente@teste.com", "000000", {
      whatsapp: "34999999999",
      fragmento: "abcdef",
    });

    expect(resultado).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "Código inválido ou expirado. Restam 4 tentativa(s).",
    );
  });

  it("sem o trio: a v1 de sempre, com os dois parâmetros de antes", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { ok: false, error: "Código inválido ou expirado." },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    const resultado = await fetchOrdersByOtp("cliente@teste.com", "123456");

    expect(supabase.rpc).toHaveBeenCalledWith("get_orders_by_otp_v1", {
      p_email: "cliente@teste.com",
      p_otp: "123456",
    });
    expect(resultado).toEqual([]);
    // a v1 deixou de mandar `restantes`: o toast é só o texto da resposta
    expect(toast.error).toHaveBeenCalledWith("Código inválido ou expirado.");
  });
});
