// @vitest-environment jsdom
//
// Lista velha não fica velha em silêncio.
//
// Quando a releitura dos avisos falha DEPOIS do primeiro carregamento (volta
// ao app sem sinal estável), o contexto mantém a lista antiga e só grava
// `erro`. A tela só lia `erro` com a lista vazia: com avisos na tela, a cliente
// via dado velho como se fosse atual e achava que nada tinha acontecido com o
// pedido. Este teste prende o recado discreto acima da lista, com a lista
// mantida e o botão de nova tentativa — que some quando a releitura funciona.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const refresh = vi.fn();

const notificacao: Notification = {
  id: "notif-1",
  title: "Aviso da loja",
  message: "Mensagem.",
  type: "system",
  read: false,
  created_at: new Date(0).toISOString(),
};

let notificacoesDaVez: Notification[] = [];
let erroDaVez: string | null = null;

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: false,
    permission: "default",
    subscription: null,
    semConta: true,
    sondado: true,
    subscribe: vi.fn(),
  }),
}));

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: notificacoesDaVez,
    unreadCount: notificacoesDaVez.filter((n) => !n.read).length,
    loading: false,
    erro: erroDaVez,
    refresh,
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAsRead: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TEXTO_DO_AVISO =
  "Não foi possível atualizar os avisos. Mostrando a última lista.";

describe("NotificationsView — lista antiga com falha de releitura avisa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    notificacoesDaVez = [];
    erroDaVez = null;
    refresh.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar() {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );
    await act(async () => {
      raiz.render(<NotificationsView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("com avisos na tela e erro: mantém a lista, avisa e oferece Tentar de novo", async () => {
    notificacoesDaVez = [notificacao];
    erroDaVez = "Não conseguimos carregar suas notificações.";
    await renderizar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Aviso da loja");
    expect(texto).toContain(TEXTO_DO_AVISO);
    // Não é a tela cheia de erro da lista vazia.
    expect(texto).not.toContain("Não conseguimos carregar");

    const retry = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    ) as HTMLButtonElement | undefined;
    expect(retry).toBeDefined();
    await act(async () => {
      retry!.click();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("com avisos na tela e sem erro: nada de recado nem botão", async () => {
    notificacoesDaVez = [notificacao];
    erroDaVez = null;
    await renderizar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Aviso da loja");
    expect(texto).not.toContain(TEXTO_DO_AVISO);
    expect(texto).not.toContain("Tentar de novo");
  });

  it("o recado some quando a releitura volta a funcionar (erro limpo)", async () => {
    notificacoesDaVez = [notificacao];
    erroDaVez = "Não conseguimos carregar suas notificações.";
    await renderizar();
    expect(hospedeiro.textContent).toContain(TEXTO_DO_AVISO);

    erroDaVez = null;
    await renderizar();
    expect(hospedeiro.textContent).not.toContain(TEXTO_DO_AVISO);
    expect(hospedeiro.textContent).toContain("Aviso da loja");
  });
});
