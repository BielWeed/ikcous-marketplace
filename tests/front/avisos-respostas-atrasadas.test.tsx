// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  user: { id: "cliente" },
  linhas: [] as Record<string, unknown>[],
  campanhas: [] as Record<string, unknown>[],
  consulta: null as Promise<{
    data: Record<string, unknown>[];
    error: null;
  }> | null,
  mutacao: Promise.resolve({ error: null }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: rede.user }) }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let campanha = false;
      const consulta = {
        eq: () => consulta,
        is: () => {
          campanha = true;
          return consulta;
        },
        order: () => consulta,
        limit: () =>
          campanha
            ? Promise.resolve({ data: rede.campanhas, error: null })
            : (rede.consulta ??
              Promise.resolve({ data: rede.linhas, error: null })),
      };
      const mutacao = Object.assign(rede.mutacao, { eq: () => mutacao });
      return {
        select: () => consulta,
        update: () => mutacao,
        delete: () => mutacao,
      };
    },
  },
}));

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}
function aviso(id: string, usuario: string | null = "cliente") {
  return {
    id,
    usuario_id: usuario,
    titulo: id,
    mensagem: "Aviso",
    tipo: "system",
    lida: false,
    created_at: "2026-10-16T10:00:00Z",
  };
}
const espelho: { atual: ReturnType<typeof useNotificationCenter> | null } = {
  atual: null,
};
function Sonda() {
  const contexto = useNotificationCenter();
  useEffect(() => {
    espelho.atual = contexto;
  });
  return null;
}

describe("avisos — respostas atrasadas respeitam as ações da cliente", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(async () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        close() {}
      },
    );
    localStorage.clear();
    rede.linhas = [aviso("antigo")];
    rede.campanhas = [];
    rede.consulta = null;
    rede.mutacao = Promise.resolve({ error: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <Sonda />
        </NotificationProvider>,
      );
    });
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("Marcar todas preserva o aviso próprio e a campanha que chegam durante o UPDATE", async () => {
    const update = pendente<{ error: null }>();
    rede.mutacao = update.promessa;
    let acao: Promise<void> | undefined;
    await act(async () => {
      acao = espelho.atual!.markAllAsRead();
    });
    rede.linhas = [aviso("antigo"), aviso("novo")];
    rede.campanhas = [aviso("campanha-nova", null)];
    await act(async () => {
      await espelho.atual!.refresh();
    });
    await act(async () => {
      update.resolver({ error: null });
      await acao;
    });
    expect(
      espelho.atual!.notifications.find((n) => n.id === "antigo")?.read,
    ).toBe(true);
    expect(
      espelho.atual!.notifications.find((n) => n.id === "novo")?.read,
    ).toBe(false);
    expect(
      espelho.atual!.notifications.find((n) => n.id === "campanha-nova")?.read,
    ).toBe(false);
    expect(espelho.atual!.unreadCount).toBe(2);
  });

  it.each(["ler", "ler todas", "excluir", "ler campanha", "excluir campanha"])(
    "%s impede a consulta anterior de restaurar o retrato antigo",
    async (acao) => {
      if (acao.includes("campanha")) {
        rede.linhas = [];
        rede.campanhas = [aviso("antigo", null)];
        await act(async () => {
          await espelho.atual!.refresh();
        });
      }
      const consulta = pendente<{
        data: Record<string, unknown>[];
        error: null;
      }>();
      rede.consulta = consulta.promessa;
      let busca: Promise<void> | undefined;
      await act(async () => {
        busca = espelho.atual!.refresh();
      });
      await act(async () => {
        if (acao.startsWith("excluir"))
          await espelho.atual!.deleteNotification("antigo");
        else if (acao === "ler todas") await espelho.atual!.markAllAsRead();
        else await espelho.atual!.markAsRead("antigo");
      });
      expect(espelho.atual!.unreadCount).toBe(0);
      expect(espelho.atual!.loading).toBe(false);
      await act(async () => {
        consulta.resolver({
          data: acao.includes("campanha") ? [] : [aviso("antigo")],
          error: null,
        });
        await busca;
      });
      expect(espelho.atual!.unreadCount).toBe(0);
      expect(espelho.atual!.notifications).toHaveLength(
        acao.startsWith("excluir") ? 0 : 1,
      );
    },
  );
});
