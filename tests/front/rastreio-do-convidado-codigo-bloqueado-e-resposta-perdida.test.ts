/**
 * Rastreio do convidado por código: o que o toast diz quando o código não
 * serve (get_orders_by_otp_v2 / v1).
 *
 * TRÊS defeitos de texto, sem tocar banco nem função de servidor:
 *
 * 1. Quem pede um código novo e digita o ANTIGO conta uma tentativa errada
 *    (a RPC só olha o código mais recente). A 5ª tentativa errada volta com
 *    `restantes: 0` e o texto "Código inválido ou expirado." — a tela só usava
 *    `restantes` quando era maior que zero e mostrava o texto cru, sem avisar
 *    que o código foi BLOQUEADO. Agora `restantes === 0` diz que bloqueou e
 *    manda pedir um novo; e com tentativas restantes, lembra que só vale o
 *    código do e-mail mais recente.
 * 2. A resposta do servidor se perde (rede ruim) DEPOIS de ele ter aceito o
 *    código: o código fica gasto (uso único) e a próxima tentativa volta
 *    "inválido". O texto de falha de rede passa a orientar a pedir um novo.
 * 3. (O terceiro, de colar com separador, é da tela:
 *    order-search-codigo-colado-com-separador.test.tsx.)
 *
 * Mesmo dublê de React de rastreio-do-convidado-manda-o-trio.test.ts.
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

import { mensagemAmigavelErroOtp, useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TRIO = { whatsapp: "34999999999", fragmento: "abcdef" };

function ultimoToast(): string {
  const chamadas = vi.mocked(toast.error).mock.calls;
  return String(chamadas[chamadas.length - 1][0]);
}

describe("fetchOrdersByOtp — código bloqueado e código antigo", () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("5ª tentativa errada (restantes 0): diz que o código foi bloqueado e manda pedir um novo", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { ok: false, error: "Código inválido ou expirado.", restantes: 0 },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    const resultado = await fetchOrdersByOtp("a@b.c", "000000", TRIO);

    expect(resultado).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    const msg = ultimoToast();
    expect(msg).toBe(
      "Código bloqueado por excesso de tentativas. Peça um novo código.",
    );
    expect(msg).not.toMatch(/inválido/i);
    expect(msg).not.toMatch(/Rest[am]/);
  });

  it("ainda com tentativas (restantes 1, singular): lembra que só vale o código do e-mail mais recente", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { ok: false, error: "Código inválido ou expirado.", restantes: 1 },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    await fetchOrdersByOtp("a@b.c", "000000", TRIO);

    expect(ultimoToast()).toBe(
      "Código inválido ou expirado. Resta 1 tentativa. Use o código do e-mail mais recente.",
    );
  });

  it("ainda com tentativas (restantes 4, plural): mesma orientação", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { ok: false, error: "Código inválido ou expirado.", restantes: 4 },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    await fetchOrdersByOtp("a@b.c", "000000", TRIO);

    expect(ultimoToast()).toBe(
      "Código inválido ou expirado. Restam 4 tentativas. Use o código do e-mail mais recente.",
    );
  });

  it("já bloqueado antes (o servidor responde com o próprio texto, sem `restantes`): o texto do servidor passa direto", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: {
        ok: false,
        error: "Código bloqueado por excesso de tentativas. Peça um novo.",
      },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    await fetchOrdersByOtp("a@b.c", "000000", TRIO);

    expect(ultimoToast()).toBe(
      "Código bloqueado por excesso de tentativas. Peça um novo.",
    );
  });

  it("sem `restantes` (sem código ativo, trio que não confere): o texto do servidor, sem inventar contagem", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { ok: false, error: "Código inválido ou expirado." },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    await fetchOrdersByOtp("a@b.c", "000000", TRIO);

    expect(ultimoToast()).toBe("Código inválido ou expirado.");
  });
});

describe("fetchOrdersByOtp — resposta perdida na rede", () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("a rede caiu: avisa da conexão E orienta pedir um novo código se aparecer inválido (o código pode ter sido aceito e gasto)", async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(
      new Error("TypeError: Failed to fetch"),
    );
    const { fetchOrdersByOtp } = useOrders(false, false);

    const resultado = await fetchOrdersByOtp("a@b.c", "123456", TRIO);

    expect(resultado).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    const msg = ultimoToast();
    expect(msg).toContain("Sem conexão");
    expect(msg).toMatch(/pe[çc]a um novo/i);
    expect(msg).not.toContain("TypeError");
  });

  it("erro técnico do servidor (a RPC não chegou a gastar o código): a frase de antes, sem a orientação de pedir novo", () => {
    expect(mensagemAmigavelErroOtp({ code: "PGRST202", message: "x" })).toBe(
      "Não conseguimos verificar seu código agora. Tente novamente em instantes.",
    );
  });
});
