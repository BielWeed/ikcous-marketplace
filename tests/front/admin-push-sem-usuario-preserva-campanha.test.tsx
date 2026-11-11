// @vitest-environment jsdom
import { AdminPushView } from "@/views/admin/AdminPushView";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "admin-ficticio" } as { id: string } | null,
  alvos: vi.fn(),
  log: vi.fn(),
  aviso: vi.fn(),
  invoke: vi.fn(),
  erro: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
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
  toast: { success: vi.fn(), error: h.erro, warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return { select: async () => ({ count: 1, error: null }) };
      }
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: (coluna: string, id: string) => {
              expect([coluna, id]).toEqual(["id", "cliente-ficticio"]);
              return {
                single: async () => ({
                  data: { full_name: "Cliente fictício" },
                  error: null,
                }),
              };
            },
          }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
          insert: h.log,
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (tabela === "notificacoes") return { insert: h.aviso };
      return {
        select: () => ({
          order: () => ({ limit: async () => ({ data: [], error: null }) }),
          eq: () => ({
            order: () => {
              const p = Promise.resolve({ data: [], error: null });
              return Object.assign(p, { order: () => p, range: () => p });
            },
          }),
        }),
      };
    },
    rpc: (nome: string, args: { p_segment: string }) => {
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: 1, error: null });
      }
      expect(nome).toBe("get_segmented_push_targets");
      h.alvos(nome, args);
      expect(args).toEqual({ p_segment: "cliente-ficticio" });
      const p = Promise.resolve({
        data: [
          {
            user_id: "cliente-ficticio",
            endpoint: "https://push.example/um",
            p256dh: "chave-ficticia",
            auth: "auth-ficticia",
          },
        ],
        error: null,
      });
      return { order: () => ({ range: () => p }) };
    },
    functions: { invoke: h.invoke },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const esperar = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const desmontagens: (() => Promise<void>)[] = [];

async function montarCampanha() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const raiz = createRoot(host);
  const desenhar = async () => {
    await act(async () =>
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} targetUserId="cliente-ficticio" />,
      ),
    );
  };
  desmontagens.push(async () => {
    await act(async () => raiz.unmount());
    host.remove();
  });
  await desenhar();
  await act(async () => esperar(80));
  const titulo = host.querySelector<HTMLInputElement>("#push-title");
  const corpo = host.querySelector<HTMLTextAreaElement>("#push-body");
  if (!titulo || !corpo) throw new Error("Campos da campanha ausentes");
  await act(async () => {
    for (const [campo, texto, prototipo] of [
      [titulo, "Novidades da loja", HTMLInputElement.prototype],
      [
        corpo,
        "Confira os produtos que chegaram hoje",
        HTMLTextAreaElement.prototype,
      ],
    ] as const) {
      Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(
        campo,
        texto,
      );
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () => esperar(260));
  const enviar = async () => {
    const botao = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Enviar agora para"),
    );
    expect(botao).toBeTruthy();
    expect(botao?.disabled).toBe(false);
    await act(async () => botao?.click());
  };
  return { desenhar, enviar, titulo, corpo };
}

describe("campanha não sai quando a sessão termina com a tela aberta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.user = { id: "admin-ficticio" };
    h.log.mockImplementation(() => ({
      select: () => ({
        single: async () => ({ data: { id: "log-ficticio" }, error: null }),
      }),
    }));
    h.aviso.mockResolvedValue({ error: null });
    h.invoke.mockResolvedValue({
      data: { enviados: 1, falharam: 0, falhas: [] },
      error: null,
    });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const desmontar of desmontagens.splice(0)) await desmontar();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sem usuário recusa antes de consultar alvos e preserva o rascunho", async () => {
    const tela = await montarCampanha();
    h.user = null;
    await tela.desenhar();
    h.alvos.mockClear();
    await tela.enviar();
    expect(h.alvos).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
    expect(h.aviso).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.erro).toHaveBeenCalledWith(
      "Falha ao registrar notificação no banco",
    );
    expect(console.error).toHaveBeenCalledWith(
      "Error sending push:",
      expect.objectContaining({ message: "Administrador não autenticado" }),
    );
    expect(tela.titulo.value).toBe("Novidades da loja");
    expect(tela.corpo.value).toBe("Confira os produtos que chegaram hoje");
  });

  it("com usuário a mesma campanha consulta, grava e envia", async () => {
    const tela = await montarCampanha();
    await tela.enviar();
    expect(h.alvos).toHaveBeenCalledOnce();
    expect(h.log).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: "admin-ficticio" }),
    );
    expect(h.aviso).toHaveBeenCalledOnce();
    expect(h.invoke).toHaveBeenCalledWith(
      "send-push",
      expect.objectContaining({
        body: expect.objectContaining({ title: "Novidades da loja" }),
      }),
    );
  });
});
