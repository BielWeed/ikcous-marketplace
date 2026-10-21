// @vitest-environment jsdom
import { MODELOS_DE_CAMPANHA } from "@/lib/modelos-de-campanha";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { enviarPush, registrarAviso, contarAlcance, buscarAlvos } = vi.hoisted(
  () => ({
    enviarPush: vi.fn(),
    registrarAviso: vi.fn(),
    contarAlcance: vi.fn(),
    buscarAlvos: vi.fn(),
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return { select: () => Promise.resolve({ count: 1, error: null }) };
      }
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { full_name: "Cliente de teste" },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (tabela === "notificacoes") return { insert: registrarAviso };
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "log-1" }, error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
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
      nome === "get_segmented_push_count" ? contarAlcance() : buscarAlvos(),
    functions: { invoke: enviarPush },
  },
}));

describe("Avisar clientes — a conclusão só limpa a mensagem enviada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    contarAlcance.mockResolvedValue({ data: 1, error: null });
    buscarAlvos.mockResolvedValue({
      data: [
        {
          user_id: "cliente-1",
          endpoint: "https://push.example/1",
          p256dh: "p1",
          auth: "a1",
        },
      ],
      error: null,
    });
    registrarAviso.mockResolvedValue({ error: null });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", Observador);
    vi.stubGlobal("IntersectionObserver", Observador);
    localStorage.clear();
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

  function botao(texto: string) {
    const encontrado = [...hospedeiro.querySelectorAll("button")].find(
      (elemento) => elemento.textContent?.includes(texto),
    );
    expect(encontrado).toBeDefined();
    return encontrado!;
  }

  const titulo = () =>
    hospedeiro.querySelector<HTMLInputElement>("#push-title")!.value;
  const mensagem = () =>
    hospedeiro.querySelector<HTMLTextAreaElement>("#push-body")!.value;

  async function preparar(targetUserId?: string) {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} targetUserId={targetUserId} />,
      );
    });
    await act(async () => botao("Lembrete de Carrinho").click());
    expect(titulo()).toBe(MODELOS_DE_CAMPANHA.auth.mensagem.title);
    expect(botao("Enviar agora para").disabled).toBe(false);
  }

  it("escolher Y enquanto X envia preserva Y após o sucesso de X", async () => {
    const envio = adiada<{
      data: { enviados: number; falharam: number };
      error: null;
    }>();
    enviarPush.mockReturnValue(envio.promessa);
    await preparar();
    await act(async () => botao("Enviar agora para").click());
    expect(enviarPush).toHaveBeenCalledWith("send-push", {
      body: expect.objectContaining(MODELOS_DE_CAMPANHA.auth.mensagem),
    });

    expect(botao("Cupom de boas-vindas").disabled).toBe(false);
    await act(async () => botao("Cupom de boas-vindas").click());
    expect(titulo()).toBe(MODELOS_DE_CAMPANHA.value.mensagem.title);
    await act(async () => {
      envio.resolver({ data: { enviados: 1, falharam: 0 }, error: null });
    });
    expect(titulo()).toBe(MODELOS_DE_CAMPANHA.value.mensagem.title);
    expect(mensagem()).toBe(MODELOS_DE_CAMPANHA.value.mensagem.body);
    expect(botao("Cupom de boas-vindas").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(enviarPush).toHaveBeenCalledTimes(1);
  });

  it("troca de modelo no mesmo lote da resposta também preserva a mensagem nova", async () => {
    const envio = adiada<{
      data: { enviados: number; falharam: number };
      error: null;
    }>();
    enviarPush.mockReturnValue(envio.promessa);
    await preparar();
    await act(async () => botao("Enviar agora para").click());
    expect(enviarPush).toHaveBeenCalledTimes(1);
    await act(async () => {
      botao("Cupom de boas-vindas").click();
      envio.resolver({ data: { enviados: 1, falharam: 0 }, error: null });
    });
    expect(titulo()).toBe(MODELOS_DE_CAMPANHA.value.mensagem.title);
    expect(mensagem()).toBe(MODELOS_DE_CAMPANHA.value.mensagem.body);
    expect(botao("Cupom de boas-vindas").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("o sucesso do aviso sem aparelho também preserva o modelo novo", async () => {
    const aviso = adiada<{ error: null }>();
    contarAlcance.mockResolvedValue({ data: 0, error: null });
    registrarAviso.mockReturnValue(aviso.promessa);
    buscarAlvos.mockResolvedValue({ data: [], error: null });
    await preparar("cliente-1");
    await act(async () => botao("Enviar agora para").click());
    expect(registrarAviso).toHaveBeenCalledWith(
      expect.objectContaining({
        titulo: MODELOS_DE_CAMPANHA.auth.mensagem.title,
        usuario_id: "cliente-1",
      }),
    );
    await act(async () => botao("Cupom de boas-vindas").click());
    await act(async () => {
      aviso.resolver({ error: null });
    });
    expect(titulo()).toBe(MODELOS_DE_CAMPANHA.value.mensagem.title);
    expect(mensagem()).toBe(MODELOS_DE_CAMPANHA.value.mensagem.body);
    expect(botao("Cupom de boas-vindas").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(enviarPush).not.toHaveBeenCalled();
  });
});
