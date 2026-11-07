// @vitest-environment jsdom
//
// A lista de Notificações da cliente lê os 50 avisos mais recentes. Quem tem
// mais que isso via o histórico terminar sem aviso nenhum: achava que tinha
// visto tudo. Quando a consulta volta cheia (`listaCortada`), a tela diz,
// no fim da lista, que ela mostra só os mais recentes.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const estado = vi.hoisted(() => ({
  listaCortada: false,
  notifications: [] as unknown[],
}));

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
    notifications: estado.notifications,
    listaCortada: estado.listaCortada,
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAsRead: vi.fn().mockResolvedValue(undefined),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function umAviso(id: string): Notification {
  return {
    id,
    title: `Aviso ${id}`,
    message: "Seu pedido mudou.",
    type: "aviso",
    read: true,
    created_at: new Date(0).toISOString(),
  } as Notification;
}

const AVISO_DE_CORTE = "Mostrando os 50 avisos mais recentes.";

describe("NotificationsView: aviso de lista cortada", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    estado.listaCortada = false;
    estado.notifications = [umAviso("a"), umAviso("b")];
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function abrir() {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );
    await act(async () => {
      raiz.render(<NotificationsView />);
    });
  }

  it("lista cortada: o fim da lista diz que são só os mais recentes", async () => {
    estado.listaCortada = true;
    await abrir();
    expect(host.textContent).toContain(AVISO_DE_CORTE);
  });

  it("lista que coube inteira: nenhum aviso de corte", async () => {
    estado.listaCortada = false;
    await abrir();
    expect(host.textContent).not.toContain("avisos mais recentes");
  });

  it("cortada, mas sem nenhum aviso na aba: não mostra o aviso solto", async () => {
    estado.listaCortada = true;
    estado.notifications = [];
    await abrir();
    expect(host.textContent).not.toContain("avisos mais recentes");
  });
});
