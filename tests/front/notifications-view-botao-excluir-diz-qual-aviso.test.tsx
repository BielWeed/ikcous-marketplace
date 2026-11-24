// @vitest-environment jsdom
//
// Acessibilidade (24/11): o X de cada aviso só tinha `title="Excluir
// notificação"`, igual em TODAS as linhas — o leitor de tela listava uma fila de
// botões idênticos e a pessoa não sabia qual aviso cada um apagava. Agora o nome
// acessível leva o título do aviso ("Excluir notificação: Pedido confirmado").
// O `title` antigo continua (testes e dica de mouse dependem dele).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const deleteNotification = vi.fn();

const notificacoes: Notification[] = [
  {
    id: "notif-1",
    title: "Pedido confirmado",
    message: "Seu pedido foi confirmado.",
    type: "sucesso",
    read: false,
    created_at: new Date(0).toISOString(),
    order_id: "pedido-1",
  },
  {
    id: "notif-2",
    title: "Pedido enviado",
    message: "Seu pedido saiu para entrega.",
    type: "info",
    read: false,
    created_at: new Date(0).toISOString(),
    order_id: "pedido-2",
  },
];

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
    notifications: notificacoes,
    markAllAsRead: vi.fn(),
    deleteNotification,
    markAsRead: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("NotificationsView — o botão de excluir diz qual aviso apaga", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    deleteNotification.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("cada linha tem um nome próprio e o botão certo apaga o aviso certo", async () => {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );
    await act(async () => {
      raiz.render(<NotificationsView onNavigate={() => {}} />);
    });

    const botoes = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>(
        'button[title="Excluir notificação"]',
      ),
    ];
    expect(botoes).toHaveLength(2);
    expect(botoes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Excluir notificação: Pedido confirmado",
      "Excluir notificação: Pedido enviado",
    ]);

    await act(async () => {
      botoes[1]?.click();
    });
    expect(deleteNotification).toHaveBeenCalledWith("notif-2");
  });
});
