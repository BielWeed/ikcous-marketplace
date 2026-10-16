// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
let usuarioAtual: { id: string } | null = null;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ upsert }) },
}));
vi.mock("@/config/configuracaoDaLoja", () => ({
  chavePublicaVapid: () => "A".repeat(64),
}));
vi.mock("@/lib/inscricao-de-push-da-conta", () => ({
  dequemEAInscricao: async () => "esta-conta",
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

type Estado = ReturnType<
  typeof import("@/hooks/usePushNotifications").usePushNotifications
>;

describe("usePushNotifications — ativação de uma geração antiga", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let estado: Estado;
  let inscricaoNoNavegador: PushSubscription | null;
  let inscricao: PushSubscription;

  beforeEach(() => {
    vi.resetAllMocks();
    usuarioAtual = { id: "conta-a" };
    inscricaoNoNavegador = null;
    const endpoint = "https://push.example.com/aparelho-teste";
    inscricao = {
      endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: null },
      getKey: () => null,
      toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: vi.fn(async () => {
        inscricaoNoNavegador = null;
        return true;
      }),
    };
    const registro = {
      pushManager: {
        getSubscription: async () => inscricaoNoNavegador,
        subscribe: vi.fn(async () => {
          inscricaoNoNavegador = inscricao;
          return inscricao;
        }),
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      get: () => ({ ready: Promise.resolve(registro) }),
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: async () => "granted",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    // Definida no próprio objeto pelo teste: precisa SUMIR para o `in` voltar a false.
    Reflect.deleteProperty(navigator, "serviceWorker");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { usePushNotifications } = await import(
      "@/hooks/usePushNotifications"
    );
    function Sonda() {
      const atual = usePushNotifications();
      useEffect(() => {
        estado = atual;
      });
      return <span>{atual.subscription ? "Inscrito" : "Ativar avisos"}</span>;
    }
    const renderizar = async () => {
      await act(async () => raiz.render(<Sonda />));
    };
    await renderizar();
    expect(estado.isSupported).toBe(true);
    return renderizar;
  }

  async function iniciarAtivacao() {
    let ativacao!: ReturnType<Estado["subscribe"]>;
    await act(async () => {
      ativacao = estado.subscribe();
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    return { ativacao };
  }

  it("sair, cancelar no navegador e entrar de novo em A não ressuscita a inscrição antiga", async () => {
    const envio = pendente<{ error: null }>();
    upsert.mockReturnValue(envio.promessa);
    const renderizar = await montar();
    const { ativacao } = await iniciarAtivacao();

    await act(async () => {
      await inscricao.unsubscribe();
    });
    usuarioAtual = null;
    await renderizar();
    usuarioAtual = { id: "conta-a" };
    await renderizar();
    await act(async () => {
      envio.resolver({ error: null });
      await ativacao;
    });

    expect(inscricaoNoNavegador).toBeNull();
    expect(estado.subscription).toBeNull();
    expect(host.textContent).toBe("Ativar avisos");
    expect(toast.success).not.toHaveBeenCalled();

    // Uma ativação nova continua funcionando depois do descarte.
    upsert.mockResolvedValue({ error: null });
    await act(async () => {
      await estado.subscribe();
    });
    expect(estado.subscription).toBe(inscricao);
    expect(host.textContent).toBe("Inscrito");
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("a troca direta de A para B descarta o sucesso que ainda pertencia a A", async () => {
    const envio = pendente<{ error: null }>();
    upsert.mockReturnValue(envio.promessa);
    const renderizar = await montar();
    const { ativacao } = await iniciarAtivacao();
    await act(async () => {
      await inscricao.unsubscribe();
    });
    usuarioAtual = { id: "conta-b" };
    await renderizar();
    await act(async () => {
      envio.resolver({ error: null });
      await ativacao;
    });

    expect(estado.subscription).toBeNull();
    expect(host.textContent).toBe("Ativar avisos");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("cancelar durante a gravação invalida a ativação mesmo sem inscrição no estado", async () => {
    const envio = pendente<{ error: null }>();
    upsert.mockReturnValue(envio.promessa);
    await montar();
    const { ativacao } = await iniciarAtivacao();
    expect(estado.subscription).toBeNull();
    await act(async () => {
      await estado.unsubscribe();
      await inscricao.unsubscribe();
    });
    await act(async () => {
      envio.resolver({ error: null });
      await ativacao;
    });

    expect(estado.subscription).toBeNull();
    expect(host.textContent).toBe("Ativar avisos");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
