// @vitest-environment jsdom
/**
 * Rastreio de pedido sem conta: "Gerando Código..." (envio do código por
 * e-mail) e "Verificando..." (conferência do código) giravam para sempre
 * quando a rede conectava e não respondia. As duas esperas passam a ter
 * limite (como o CEP, o frete e o PIX): estourou, a tela volta e diz que a
 * conexão está lenta.
 *
 * Cuidado de texto: o limite só desiste de ESPERAR — o servidor pode ter
 * gravado/enviado o código (envio) ou gastado o código de uso único
 * (verificação). Nenhuma das duas frases pode afirmar o contrário.
 *
 * O hook se alcança por um componente-sonda (sem @testing-library/react) e o
 * import de `@/hooks/useOrders` é dinâmico por causa do `vi.mock` içado.
 */
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const rpc = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ data: [], error: null }) }),
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
  toast: { error: toastError, success: toastSuccess },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Funcoes = {
  gerar: (e: string, w: string, f: string) => Promise<boolean>;
  verificar: (
    e: string,
    otp: string,
    trio?: { whatsapp: string; fragmento: string },
  ) => Promise<unknown[]>;
};

let host: HTMLDivElement;
let raiz: Root;

async function pegarFuncoes(): Promise<Funcoes> {
  const { useOrders } = await import("@/hooks/useOrders");
  function Sonda({ aoMontar }: { aoMontar: (f: Funcoes) => void }) {
    const { generateOrderOtp, fetchOrdersByOtp } = useOrders(false, false);
    useEffect(() => {
      aoMontar({ gerar: generateOrderOtp, verificar: fetchOrdersByOtp });
    }, [generateOrderOtp, fetchOrdersByOtp, aoMontar]);
    return null;
  }
  let funcoes: Funcoes | undefined;
  await act(async () => {
    raiz.render(
      <Sonda
        aoMontar={(f) => {
          funcoes = f;
        }}
      />,
    );
  });
  if (!funcoes) throw new Error("a sonda não expôs as funções");
  return funcoes;
}

/** Passa o tempo dentro de `act`: o hook atualiza estado ao resolver. */
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const NUNCA = () => new Promise<never>(() => {});
const TRIO = { whatsapp: "34999999999", fragmento: "abcdef" };

describe("rastreio sem conta — limite de espera", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  it("envio do código que nunca responde: desiste, devolve false e diz 'conexão lenta' sem afirmar que nada saiu", async () => {
    invoke.mockImplementation(NUNCA);
    const { gerar } = await pegarFuncoes();

    let resultado: boolean | undefined;
    const espera = gerar("a@b.c", "34999999999", "abcdef").then((r) => {
      resultado = r;
    });

    // Ainda dentro do limite: segue esperando, sem aviso.
    await avancar(10_000);
    expect(resultado).toBeUndefined();
    expect(toastError).not.toHaveBeenCalled();

    await avancar(10_000);
    await espera;

    expect(resultado).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    const texto = String(toastError.mock.calls[0][0]);
    expect(texto).toContain("A conexão está lenta");
    // O servidor pode ter enviado: não pode dizer que NÃO enviou.
    expect(texto).not.toContain("Não conseguimos enviar");
    expect(texto.toLowerCase()).toContain("e-mail");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("envio lento mas que responde dentro do limite: segue normal (true), sem aviso de erro", async () => {
    invoke.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ data: { ok: true }, error: null }), 5_000),
        ),
    );
    const { gerar } = await pegarFuncoes();

    const espera = gerar("a@b.c", "34999999999", "abcdef");
    await avancar(5_000);

    expect(await espera).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  const FRASE_DO_ENVIO_QUE_FALHOU =
    "Não conseguimos enviar seu código agora. Tente de novo mais tarde. Se já pediu vários códigos hoje, o limite do dia pode levar até 24 horas para liberar: fale com a loja.";

  it("envio: a falha comum (502, sem corpo) dá a frase de falha, não a de conexão lenta", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("boom") });
    const { gerar } = await pegarFuncoes();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(toastError).toHaveBeenCalledWith(FRASE_DO_ENVIO_QUE_FALHOU);
  });

  it("envio: o teto diário (que o cliente não distingue de pane) NUNCA promete 'alguns minutos' e diz que pode levar até 24 horas", async () => {
    // O banco recusa o 6º código do dia para o mesmo pedido com um erro
    // genérico; a edge o repassa como `envio_falhou` (502). Do lado da tela é
    // indistinguível de uma pane de e-mail, então a frase tem de servir aos
    // dois: sem prometer minutos, e dizendo que o limite do dia pode durar.
    const casos = [
      { data: null, error: new Error("502 sem corpo") },
      { data: { ok: false, motivo: "envio_falhou" }, error: null },
      { data: { ok: false, motivo: "sem_remetente" }, error: null },
    ];
    const { gerar } = await pegarFuncoes();
    for (const caso of casos) {
      toastError.mockClear();
      invoke.mockResolvedValueOnce(caso);
      // E-mail diferente por caso: nenhuma falha anterior segura o próximo.
      expect(
        await gerar(`c${casos.indexOf(caso)}@b.c`, "34999999999", "abcdef"),
      ).toBe(false);
      const texto = String(toastError.mock.calls[0]?.[0]);
      expect(texto).toContain("24 horas");
      expect(texto).toContain("fale com a loja");
      expect(texto).not.toMatch(/minutos/i);
    }
  });

  it("envio: rede que cai (exceção) também não promete 'alguns minutos'", async () => {
    invoke.mockRejectedValue(new Error("Failed to fetch"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { gerar } = await pegarFuncoes();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0]?.[0])).not.toMatch(/minutos/i);
  });

  it("envio: insistir logo depois da falha (freio de 60 s) também não promete minutos nem diz que 'já enviamos'", async () => {
    invoke
      .mockResolvedValueOnce({ data: { ok: false, motivo: "envio_falhou" } })
      .mockResolvedValueOnce({
        data: { ok: false, motivo: "muito_recente", espereSegundos: 42 },
      });
    const { gerar } = await pegarFuncoes();

    await gerar("a@b.c", "34999999999", "abcdef");
    toastError.mockClear();
    await gerar("a@b.c", "34999999999", "abcdef");

    const texto = String(toastError.mock.calls[0]?.[0]);
    expect(texto).toContain("Ainda não conseguimos enviar seu código");
    expect(texto).toContain("fale com a loja");
    expect(texto).not.toMatch(/minutos|instante|já enviamos/i);
  });

  it("verificação (com trio, v2) que nunca responde: desiste, devolve [] e avisa 'conexão lenta' sem dizer que o código é inválido", async () => {
    rpc.mockImplementation(NUNCA);
    const { verificar } = await pegarFuncoes();

    let resultado: unknown[] | undefined;
    const espera = verificar("a@b.c", "123456", TRIO).then((r) => {
      resultado = r;
    });

    await avancar(10_000);
    expect(resultado).toBeUndefined();
    expect(toastError).not.toHaveBeenCalled();

    await avancar(10_000);
    await espera;

    expect(rpc).toHaveBeenCalledWith(
      "get_orders_by_otp_v2",
      expect.objectContaining({ p_otp: "123456" }),
    );
    expect(resultado).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
    const texto = String(toastError.mock.calls[0][0]);
    expect(texto).toContain("A conexão está lenta");
    // O código é de uso único e pode ter sido gasto: orienta pedir outro.
    expect(texto).toContain("peça um novo");
    expect(texto).not.toContain("Código inválido ou expirado");
  });

  it("verificação sem trio (v1) que nunca responde: o mesmo limite vale", async () => {
    rpc.mockImplementation(NUNCA);
    const { verificar } = await pegarFuncoes();

    const espera = verificar("a@b.c", "123456");
    await avancar(20_000);

    expect(await espera).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("get_orders_by_otp_v1", expect.anything());
    expect(String(toastError.mock.calls[0][0])).toContain(
      "A conexão está lenta",
    );
  });

  it("verificação que responde dentro do limite: devolve os pedidos e nenhum aviso de erro", async () => {
    rpc.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ data: { ok: true, orders: [] }, error: null }),
            5_000,
          ),
        ),
    );
    const { verificar } = await pegarFuncoes();

    const espera = verificar("a@b.c", "123456", TRIO);
    await avancar(5_000);
    await espera;

    // Sem pedido sobrando cai no aviso de "não está mais disponível" (outro
    // caminho); o que importa aqui é que NÃO foi o aviso de conexão lenta.
    for (const [texto] of toastError.mock.calls) {
      expect(String(texto)).not.toContain("A conexão está lenta");
    }
  });

  it("verificação: código recusado (ok: false) continua mostrando a recusa do servidor", async () => {
    rpc.mockResolvedValue({
      data: { ok: false, error: "Código inválido ou expirado.", restantes: 3 },
      error: null,
    });
    const { verificar } = await pegarFuncoes();

    expect(await verificar("a@b.c", "000000", TRIO)).toEqual([]);
    expect(String(toastError.mock.calls[0][0])).toContain(
      "Código inválido ou expirado.",
    );
    expect(String(toastError.mock.calls[0][0])).not.toContain("lenta");
  });
});
