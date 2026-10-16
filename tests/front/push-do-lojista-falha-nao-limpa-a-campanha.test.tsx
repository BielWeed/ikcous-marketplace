// @vitest-environment jsdom
// Mesmo molde de montagem e seletor de push-destino-escolhido.test.tsx.
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeSendPush, inserts, ajustarLog } = vi.hoisted(() => ({
  invokeSendPush: vi.fn(),
  inserts: {
    pushLog: [] as Record<string, unknown>[],
    notificacoes: [] as Record<string, unknown>[],
  },
  ajustarLog: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { realTimeSalesAlerts: false },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ isSupported: false, subscribe: vi.fn() }),
}));
vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    name,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (valor: string) => void;
    name?: string;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    <select
      name={name}
      value={value}
      disabled={disabled}
      onChange={(evento) => onValueChange(evento.target.value)}
    >
      <option value="">Outra página</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return { select: () => Promise.resolve({ count: 1, error: null }) };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: (linha: Record<string, unknown>) => {
            inserts.pushLog.push(linha);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: "log-1" }, error: null }),
              }),
            };
          },
          update: ajustarLog,
        };
      }
      if (tabela === "notificacoes") {
        return {
          insert: (linha: Record<string, unknown>) => {
            inserts.notificacoes.push(linha);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: (nome: string) =>
      Promise.resolve({
        data:
          nome === "get_segmented_push_count"
            ? 1
            : [
                {
                  user_id: "cliente-1",
                  endpoint: "https://push.example/1",
                  p256dh: "p1",
                  auth: "a1",
                },
              ],
        error: null,
      }),
    functions: { invoke: invokeSendPush },
  },
}));

class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const TITULO = "Chegaram novidades";
const MENSAGEM = "Veja os produtos que chegaram hoje";
const CAMINHO = "/novidades-da-semana";

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Avisar clientes — falha não apaga a campanha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    inserts.pushLog = [];
    inserts.notificacoes = [];
    invokeSendPush.mockResolvedValue({
      data: { enviados: 1, falharam: 0, falhas: [] },
      error: null,
    });
    ajustarLog.mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", Observador);
    vi.stubGlobal("IntersectionObserver", Observador);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const campoTitulo = () =>
    hospedeiro.querySelector<HTMLInputElement>("#push-title")!;
  const campoMensagem = () =>
    hospedeiro.querySelector<HTMLTextAreaElement>("#push-body")!;
  const campoCaminho = () =>
    hospedeiro.querySelector<HTMLInputElement>("#push-custom-path")!;
  const seletorDestino = () =>
    hospedeiro.querySelector<HTMLSelectElement>('select[name="destType"]')!;

  function digitar(
    campo: HTMLInputElement | HTMLTextAreaElement,
    valor: string,
  ) {
    const prototipo =
      campo instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(
      campo,
      valor,
    );
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function prepararCampanha(destino: "cart" | "custom" = "custom") {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      digitar(campoTitulo(), TITULO);
      digitar(campoMensagem(), MENSAGEM);
      if (destino === "custom") {
        digitar(campoCaminho(), CAMINHO);
      } else {
        seletorDestino().value = destino;
        seletorDestino().dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    // Aguarda o formulário devolver o texto ao componente.
    await act(async () => {
      await esperar(260);
    });
  }

  async function enviar() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((elemento) =>
      elemento.textContent?.includes("Enviar agora para"),
    );
    expect(botao).toBeDefined();
    expect(botao!.disabled).toBe(false);
    await act(async () => {
      botao!.click();
    });
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(inserts.pushLog).toHaveLength(1);
    expect(inserts.notificacoes).toHaveLength(1);
    expect(inserts.pushLog[0]).toMatchObject({
      title: TITULO,
      body: MENSAGEM,
      recipient_count: 0,
    });
  }

  function conferirCampanhaPreservada() {
    expect(campoTitulo().value).toBe(TITULO);
    expect(campoMensagem().value).toBe(MENSAGEM);
    expect(campoCaminho().value).toBe(CAMINHO);
    expect(invokeSendPush).toHaveBeenCalledWith("send-push", {
      body: expect.objectContaining({ url: CAMINHO }),
    });
  }

  it.each(["cart", "custom"] as const)(
    "entrega confirmada limpa texto e destino %s",
    async (destino) => {
      await prepararCampanha(destino);
      await enviar();

      expect(campoTitulo().value).toBe("");
      expect(campoMensagem().value).toBe("");
      expect(campoCaminho().value).toBe("");
      expect(seletorDestino().value).toBe("home");
      expect(ajustarLog).toHaveBeenCalledWith({ recipient_count: 1 });
      const { toast } = await import("sonner");
      expect(toast.success).toHaveBeenCalledWith(
        "Notificação entregue em 1 dispositivo(s)",
      );
    },
  );

  it("erro do send-push preserva a campanha e mostra o resultado", async () => {
    invokeSendPush.mockResolvedValue({
      data: null,
      error: { name: "FunctionsHttpError", message: "Envio recusado" },
    });
    await prepararCampanha();
    await enviar();

    conferirCampanhaPreservada();
    expect(ajustarLog).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("zero entregas preserva a campanha e informa que ninguém recebeu", async () => {
    invokeSendPush.mockResolvedValue({
      data: { enviados: 0, falharam: 1, falhas: [] },
      error: null,
    });
    await prepararCampanha();
    await enviar();

    conferirCampanhaPreservada();
    expect(ajustarLog).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(
      "Nenhum dos 1 dispositivos recebeu",
      expect.any(Object),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each(["erro de rede retornado", "promessa rejeitada", "sem contagem"])(
    "%s preserva a campanha e avisa que reenviar pode repetir a mensagem",
    async (cenario) => {
      if (cenario === "promessa rejeitada") {
        invokeSendPush.mockRejectedValue(new TypeError("Failed to fetch"));
      } else {
        invokeSendPush.mockResolvedValue({
          data: cenario === "sem contagem" ? {} : null,
          error:
            cenario === "sem contagem"
              ? null
              : { name: "FunctionsFetchError", message: "Failed to fetch" },
        });
      }
      await prepararCampanha();
      await enviar();

      conferirCampanhaPreservada();
      expect(ajustarLog).not.toHaveBeenCalled();
      const { toast } = await import("sonner");
      expect(toast.error).toHaveBeenCalledWith(
        "Não foi possível confirmar o envio",
        {
          description:
            "Sua campanha foi mantida. Alguns clientes podem ter recebido. Se enviar de novo, eles podem receber a mensagem repetida.",
        },
      );
      expect(toast.error).not.toHaveBeenCalledWith(
        "Falha ao registrar notificação no banco",
      );
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("entrega parcial confirmada mantém o aviso e a limpeza do sucesso", async () => {
    invokeSendPush.mockResolvedValue({
      data: { enviados: 1, falharam: 1, falhas: [] },
      error: null,
    });
    await prepararCampanha();
    await enviar();

    expect(campoTitulo().value).toBe("");
    expect(campoMensagem().value).toBe("");
    expect(campoCaminho().value).toBe("");
    expect(seletorDestino().value).toBe("home");
    const { toast } = await import("sonner");
    expect(toast.warning).toHaveBeenCalledWith("Entregue em 1 de 2", {
      description: undefined,
    });
  });
});
