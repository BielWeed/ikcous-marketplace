// @vitest-environment jsdom
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

type Perfil = { data: { full_name: string }; error: null };
const { buscarPerfil, avisos, buscarAlvos } = vi.hoisted(() => ({
  buscarPerfil: vi.fn(),
  avisos: vi.fn(),
  buscarAlvos: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: (_coluna: string, id: string) => ({
              single: () => buscarPerfil(id),
            }),
          }),
        };
      }
      if (tabela === "push_subscriptions") {
        return { select: () => Promise.resolve({ count: 0, error: null }) };
      }
      if (tabela === "notificacoes") return { insert: avisos };
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: (nome: string, args: { p_segment: string }) =>
      nome === "get_segmented_push_targets"
        ? buscarAlvos(args)
        : Promise.resolve({ data: 0, error: null }),
  },
}));

describe("Avisar clientes — o nome pertence ao destinatário atual", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let perfilA: ReturnType<typeof adiada<Perfil>>;
  let perfilB: ReturnType<typeof adiada<Perfil>>;

  beforeEach(() => {
    vi.clearAllMocks();
    perfilA = adiada<Perfil>();
    perfilB = adiada<Perfil>();
    buscarPerfil.mockImplementation((id: string) =>
      id === "cliente-a" ? perfilA.promessa : perfilB.promessa,
    );
    avisos.mockResolvedValue({ error: null });
    buscarAlvos.mockResolvedValue({ data: [], error: null });
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
  });

  async function selecionar(targetUserId?: string) {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} targetUserId={targetUserId} />,
      );
    });
  }

  it("B responde antes de A: mantém B no cartão e envia somente para B", async () => {
    await selecionar("cliente-a");
    await selecionar("cliente-b");
    expect(buscarPerfil.mock.calls.map(([id]) => id)).toEqual([
      "cliente-a",
      "cliente-b",
    ]);
    await act(async () => {
      perfilB.resolver({ data: { full_name: "Cliente B" }, error: null });
    });
    expect(hospedeiro.textContent).toContain("Cliente: Cliente B");
    await act(async () => {
      perfilA.resolver({ data: { full_name: "Cliente A" }, error: null });
    });
    expect(hospedeiro.textContent).toContain("Cliente: Cliente B");
    expect(hospedeiro.textContent).not.toContain("Cliente: Cliente A");

    const modelo = [...hospedeiro.querySelectorAll("button")].find((botao) =>
      botao.textContent?.includes("Lembrete de Carrinho"),
    )!;
    await act(async () => modelo.click());
    const enviar = [...hospedeiro.querySelectorAll("button")].find((botao) =>
      botao.textContent?.includes("Enviar agora para"),
    )!;
    expect(enviar.disabled).toBe(false);
    await act(async () => enviar.click());
    expect(buscarAlvos).toHaveBeenCalledWith({ p_segment: "cliente-b" });
    expect(avisos).toHaveBeenCalledWith(
      expect.objectContaining({ usuario_id: "cliente-b" }),
    );
  });

  it("ao trocar A por B, não mantém o nome de A enquanto B carrega", async () => {
    await selecionar("cliente-a");
    await act(async () => {
      perfilA.resolver({ data: { full_name: "Cliente A" }, error: null });
    });
    expect(hospedeiro.textContent).toContain("Cliente: Cliente A");
    await selecionar("cliente-b");
    expect(hospedeiro.textContent).toContain("Cliente: Carregando...");
    expect(hospedeiro.textContent).not.toContain("Cliente: Cliente A");
    await act(async () => {
      perfilB.resolver({ data: { full_name: "Cliente B" }, error: null });
    });
    expect(hospedeiro.textContent).toContain("Cliente: Cliente B");
  });

  it("resposta do cliente anterior não reaparece depois de sair do modo individual", async () => {
    await selecionar("cliente-a");
    await selecionar();
    await act(async () => {
      perfilA.resolver({ data: { full_name: "Cliente A" }, error: null });
    });
    await selecionar("cliente-b");
    expect(hospedeiro.textContent).toContain("Cliente: Carregando...");
    expect(hospedeiro.textContent).not.toContain("Cliente: Cliente A");
  });
});
