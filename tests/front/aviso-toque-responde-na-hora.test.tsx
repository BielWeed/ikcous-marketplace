// @vitest-environment jsdom
//
// Laudo cliente-pós-compra 02/09, achado #9 — onda 2 (listas vivas).
//
// O toque no aviso CONGELAVA: `handleNotificationClick` fazia
// `await markAsRead(...)` ANTES de navegar (NotificationsView.tsx:77-82). Com
// a rede lenta, toque sem resposta nenhuma — a cliente tocava de novo.
//
// O CONSERTO: navegar NA HORA; marcar como lida em segundo plano. Falha ao
// marcar não impede a navegação nem derruba a tela.
//
// COMO O TESTE PROVA O DEFEITO: o dublê de `markAsRead` devolve uma Promise
// que NUNCA resolve (a rede presa). Um microtick depois do toque, a navegação
// já tem que ter acontecido. Contra o código antigo (await primeiro) a
// navegação nunca chega — vermelho; com a navegação primeiro, verde.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const refresh = vi.fn();
const markAllAsRead = vi.fn();
const deleteNotification = vi.fn();
const markAsRead = vi.fn();

const notificacaoNaoLida: Notification = {
  id: "notif-9",
  title: "Seu pedido saiu para entrega",
  message: "Chega hoje.",
  type: "system",
  read: false,
  created_at: new Date(0).toISOString(),
  order_id: "ped-9",
} as Notification & { order_id: string };

let notificacoesDaVez: Notification[] = [];
let erroDaVez: string | null = null;
let carregandoDaVez = false;

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: notificacoesDaVez,
    unreadCount: notificacoesDaVez.filter((n) => !n.read).length,
    loading: carregandoDaVez,
    erro: erroDaVez,
    refresh,
    markAllAsRead,
    deleteNotification,
    markAsRead,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("NotificationsView — o toque no aviso responde na hora (laudo #9)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onNavigate: ReturnType<
    typeof vi.fn<(view: any, id?: string) => void>
  >;

  beforeEach(() => {
    notificacoesDaVez = [notificacaoNaoLida];
    erroDaVez = null;
    carregandoDaVez = false;
    markAsRead.mockReset();
    markAllAsRead.mockReset();
    onNavigate = vi.fn<(view: any, id?: string) => void>();
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
      raiz.render(<NotificationsView onNavigate={onNavigate} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  /** O card clicável é o ancestral que tem o título do aviso dentro. */
  function clicarNoAviso() {
    const titulo = [...hospedeiro.querySelectorAll("h4")].find(
      (h) => h.textContent === notificacaoNaoLida.title,
    );
    if (!titulo) throw new Error("aviso não montou na tela");
    titulo.click();
  }

  it("rede presa: a navegação acontece MESMO sem o 'lida' voltar", async () => {
    markAsRead.mockImplementation(() => new Promise<void>(() => {}));
    await renderizar();

    await act(async () => {
      clicarNoAviso();
    });
    // Um microtick: o handler assíncrono começou. Nada do 'lida' voltou.
    await act(async () => {
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("order-details", "ped-9");
    // Marcar como lida continua acontecendo — só que em segundo plano.
    expect(markAsRead).toHaveBeenCalledWith("notif-9");
  });

  it("falha ao marcar não derruba a tela nem segura a navegação", async () => {
    markAsRead.mockRejectedValue(new Error("rede caiu"));
    await renderizar();

    await act(async () => {
      clicarNoAviso();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("order-details", "ped-9");
    // A tela continua de pé, com o cabeçalho e o aviso renderizados.
    expect(hospedeiro.textContent).toContain("Notificações");
    expect(hospedeiro.textContent).toContain(notificacaoNaoLida.title);
  });

  it("aviso já lido: navega e não marca de novo", async () => {
    notificacoesDaVez = [{ ...notificacaoNaoLida, read: true }];
    await renderizar();

    await act(async () => {
      clicarNoAviso();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("order-details", "ped-9");
    expect(markAsRead).not.toHaveBeenCalled();
  });
});
