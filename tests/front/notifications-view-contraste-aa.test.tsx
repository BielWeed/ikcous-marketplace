// @vitest-environment jsdom
//
// Defeito: a ação "Ver Detalhes" de uma notificação do tipo "sucesso" usava
// `accentColor: "text-emerald-600 dark:text-emerald-400"` -- o tom claro mede
// 3,58-3,77:1 contra o mínimo AA (4,5:1) de texto normal. `text-emerald-700`
// mede 5,21:1 e passa. Só o modo claro muda: `dark:text-emerald-400` não foi
// medido e continua como está.
//
// POR QUE RENDER DE VERDADE: a classe de cor vive no elemento renderizado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const markAsRead = vi.fn();
const markAllAsRead = vi.fn();
const deleteNotification = vi.fn();

const notificacaoSucesso: Notification = {
  id: "notif-1",
  title: "Pedido entregue",
  message: "Seu pedido chegou.",
  type: "sucesso",
  read: false,
  created_at: new Date(0).toISOString(),
  order_id: "pedido-1",
};

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: [notificacaoSucesso],
    markAllAsRead,
    deleteNotification,
    markAsRead,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("NotificationsView — ação 'Ver Detalhes' (tipo sucesso) usa text-emerald-700 (contraste AA) no modo claro, não mais text-emerald-600", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  it("notificação tipo 'sucesso' com order_id: a ação troca de tom no modo claro, e o modo escuro continua emerald-400", async () => {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );

    await act(async () => {
      raiz.render(<NotificationsView onNavigate={() => {}} />);
    });

    // A armadilha precisa estar de fato presente: sem a ação renderizada de
    // verdade, o par abaixo não prova nada sobre este defeito.
    expect(hospedeiro.textContent).toContain("Ver Detalhes");

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const acao = spans.find((el) => el.textContent?.includes("Ver Detalhes"));
    expect(acao).not.toBeUndefined();
    expect(acao?.classList.contains("text-emerald-700")).toBe(true);
    expect(acao?.classList.contains("text-emerald-600")).toBe(false);
    // O modo escuro não foi medido e não deve ser tocado por esta correção.
    expect(acao?.classList.contains("dark:text-emerald-400")).toBe(true);
  });
});
