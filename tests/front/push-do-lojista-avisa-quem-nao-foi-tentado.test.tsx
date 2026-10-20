// @vitest-environment jsdom
// Mesma montagem e mocks de push-do-lojista-falha-nao-limpa-a-campanha.test.tsx.
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeSendPush, inserts, ajustarLog, recordAction } = vi.hoisted(
  () => ({
    invokeSendPush: vi.fn(),
    inserts: {
      pushLog: [] as Record<string, unknown>[],
      notificacoes: [] as Record<string, unknown>[],
    },
    ajustarLog: vi.fn(),
    recordAction: vi.fn(),
  }),
);

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
  useVOR: () => ({ recordAction }),
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

describe("Avisar clientes — destinatários não tentados", () => {
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

  function conferirCampanhaLimpa() {
    expect(campoTitulo().value).toBe("");
    expect(campoMensagem().value).toBe("");
    expect(campoCaminho().value).toBe("");
    expect(seletorDestino().value).toBe("home");
    expect(ajustarLog).toHaveBeenCalledWith({ recipient_count: 2 });
  }

  function conferirRegistro(
    status: "success" | "partial",
    falharam: number,
    naoTentados = 0,
  ) {
    expect(recordAction).toHaveBeenCalledTimes(1);
    expect(recordAction).toHaveBeenCalledWith(
      "PUSH_DISPATCH",
      { title: TITULO, alvos: 1, segment: "all" },
      {
        status,
        entregues: 2,
        falharam,
        ...(naoTentados > 0 ? { naoTentados } : {}),
        falhas: [],
        timestamp: expect.any(String),
      },
    );
  }

  it.each([
    {
      naoTentados: 3,
      total: 5,
      aviso: "3 dispositivos não receberam porque o envio demorou demais",
    },
    {
      naoTentados: 1,
      total: 3,
      aviso: "1 dispositivo não recebeu porque o envio demorou demais",
    },
  ])(
    "avisa sobre $naoTentados não alcançados e risco de repetição, mas limpa a campanha",
    async ({ naoTentados, total, aviso }) => {
      invokeSendPush.mockResolvedValue({
        data: { enviados: 2, falharam: 0, naoTentados, falhas: [] },
        error: null,
      });
      await prepararCampanha();
      await enviar();

      const { toast } = await import("sonner");
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(toast.warning).toHaveBeenCalledWith(`Entregue em 2 de ${total}`, {
        description: expect.stringContaining(aviso),
      });
      expect(toast.warning).toHaveBeenCalledWith(expect.any(String), {
        description: expect.stringMatching(
          /reenviar.*quem já recebeu.*mensagem repetida/i,
        ),
      });
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      conferirCampanhaLimpa();
      conferirRegistro("partial", 0, naoTentados);
    },
  );

  it.each([
    undefined,
    0,
    -1,
    1.5,
    "3",
    null,
    true,
    {},
    [],
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])(
    "mantém o sucesso e a limpeza para naoTentados ausente, zero ou inválido (%s)",
    async (naoTentados) => {
      invokeSendPush.mockResolvedValue({
        data: {
          enviados: 2,
          falharam: 0,
          falhas: [],
          ...(naoTentados === undefined ? {} : { naoTentados }),
        },
        error: null,
      });
      await prepararCampanha();
      await enviar();

      const { toast } = await import("sonner");
      expect(toast.success).toHaveBeenCalledWith(
        "Notificação entregue em 2 dispositivo(s)",
      );
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      conferirCampanhaLimpa();
      conferirRegistro("success", 0);
    },
  );

  it("mantém o aviso de entrega parcial e acrescenta os não alcançados por demora", async () => {
    invokeSendPush.mockResolvedValue({
      data: {
        enviados: 2,
        falharam: 1,
        naoTentados: 3,
        falhas: [{ quantidade: 1, motivo: "Serviço indisponível" }],
      },
      error: null,
    });
    await prepararCampanha();
    await enviar();

    const { toast } = await import("sonner");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith("Entregue em 2 de 6", {
      description: expect.stringContaining("1x Serviço indisponível"),
    });
    expect(toast.warning).toHaveBeenCalledWith("Entregue em 2 de 6", {
      description: expect.stringContaining(
        "3 dispositivos não receberam porque o envio demorou demais",
      ),
    });
    expect(toast.warning).toHaveBeenCalledWith("Entregue em 2 de 6", {
      description: expect.stringMatching(
        /reenviar.*quem já recebeu.*mensagem repetida/i,
      ),
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    conferirCampanhaLimpa();
    expect(recordAction).toHaveBeenCalledTimes(1);
    expect(recordAction).toHaveBeenCalledWith(
      "PUSH_DISPATCH",
      { title: TITULO, alvos: 1, segment: "all" },
      {
        status: "partial",
        entregues: 2,
        falharam: 1,
        naoTentados: 3,
        falhas: [{ quantidade: 1, motivo: "Serviço indisponível" }],
        timestamp: expect.any(String),
      },
    );
  });

  it("zero entregas avisa que reenviar repete o aviso dentro do app", async () => {
    invokeSendPush.mockResolvedValue({
      data: { enviados: 0, falharam: 1, falhas: [] },
      error: null,
    });
    await prepararCampanha();
    await enviar();

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(
      "Nenhum dos 1 dispositivos recebeu",
      {
        description: expect.stringMatching(/reenviar.*aviso dentro do app/i),
      },
    );
  });

  it("zero entregas com não tentados diz quantos dispositivos nem foram tentados", async () => {
    invokeSendPush.mockResolvedValue({
      data: { enviados: 0, falharam: 1, naoTentados: 4, falhas: [] },
      error: null,
    });
    await prepararCampanha();
    await enviar();

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(
      "Nenhum dos 1 dispositivos recebeu",
      {
        description: expect.stringContaining(
          "4 dispositivos nem chegaram a ser tentados porque o envio demorou demais",
        ),
      },
    );
    expect(recordAction).toHaveBeenCalledWith(
      "PUSH_DISPATCH",
      expect.anything(),
      expect.objectContaining({
        status: "error",
        entregues: 0,
        naoTentados: 4,
      }),
    );
  });
});
