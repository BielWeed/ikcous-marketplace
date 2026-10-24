// @vitest-environment jsdom
//
// Redesenho Tinta (23/10/2026) da tela Notificações da cliente: o "ver
// detalhes" virou a linha inteira clicável e o "X" continua dispensando.
// Nada some: ponto de não lida, contador, aba Avisos e "marcar como lidas".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const markAsRead = vi.fn().mockResolvedValue(undefined);
const markAllAsRead = vi.fn();
const deleteNotification = vi.fn();
const onNavigate = vi.fn();

const lista: Notification[] = [
  {
    id: "a",
    title: "Pedido entregue",
    message: "Seu pedido foi entregue.",
    type: "sucesso",
    read: false,
    created_at: new Date(0).toISOString(),
    order_id: "ped-1",
  } as Notification,
  {
    id: "b",
    title:
      "Tituloextremamentelongosemnenhumespacoparaverseaquebradelinhafunciona",
    message: "Aviso antigo da loja.",
    type: "aviso",
    read: true,
    created_at: new Date(0).toISOString(),
  } as Notification,
];

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: lista,
    markAllAsRead,
    deleteNotification,
    markAsRead,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("NotificationsView (Tinta): estrutura", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    markAsRead.mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );
    await act(async () => {
      raiz.render(<NotificationsView onNavigate={onNavigate} />);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it("cabeçalho: eyebrow mono com a contagem, título 28 e abas na tinta", () => {
    expect(host.textContent).toContain("1 não lida");
    const h1 = host.querySelector("h1");
    expect(h1?.className).toContain("text-[28px]");
    const todas = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Todas"),
    );
    expect(todas?.className).toContain("bg-foreground");
    expect(todas?.className).toContain("text-background");
    expect(todas?.className).not.toContain("bg-primary");
    expect(todas?.className).toContain("h-11");
  });

  it("a linha inteira é um botão com o destino do pedido e é focável", async () => {
    const linha = host.querySelector<HTMLElement>('[role="button"]');
    expect(linha).not.toBeNull();
    expect(linha?.tabIndex).toBe(0);
    await act(async () => {
      linha?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("order-details", "ped-1");
    expect(markAsRead).toHaveBeenCalledWith("a");
  });

  it("Enter na linha também leva ao destino", async () => {
    const linha = host.querySelector<HTMLElement>('[role="button"]');
    await act(async () => {
      linha?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onNavigate).toHaveBeenCalledWith("order-details", "ped-1");
  });

  it("ponto de não lida só na não lida (1 ponto, igual ao contador)", () => {
    expect(
      host.querySelectorAll('[data-testid="notif-ponto-nao-lida"]'),
    ).toHaveLength(1);
  });

  it("o × dispensa sem navegar, com alvo de 44px e rótulo", async () => {
    const x = host.querySelector<HTMLButtonElement>(
      'button[title="Excluir notificação"]',
    );
    expect(x?.className).toContain("size-11");
    await act(async () => {
      x?.click();
    });
    expect(deleteNotification).toHaveBeenCalledWith("a");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("título longo quebra linha e 'marcar como lidas' continua chamando markAllAsRead", async () => {
    const longo = [...host.querySelectorAll("h4")].find((h) =>
      h.textContent?.startsWith("Titulo"),
    );
    expect(longo?.className).toContain("break-words");
    const marcar = host.querySelector<HTMLButtonElement>(
      'button[title="Marcar todas como lidas"]',
    );
    await act(async () => {
      marcar?.click();
    });
    expect(markAllAsRead).toHaveBeenCalled();
  });

  it("aba Avisos filtra (a notificação de pedido não é aviso, 'aviso' é)", async () => {
    const avisos = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Avisos"),
    );
    await act(async () => {
      avisos?.click();
    });
    expect(host.textContent).toContain("Pedido entregue");
    expect(host.textContent).toContain("Aviso antigo da loja.");
  });
});
