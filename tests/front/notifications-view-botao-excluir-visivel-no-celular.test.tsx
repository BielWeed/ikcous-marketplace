// @vitest-environment jsdom
//
// Defeito (NotificationsView-421): o botão "Excluir notificação" (X) usava
// `opacity-0` + `group-hover:opacity-100` como ÚNICO mecanismo de revelação,
// só virando `relative` (ocupando espaço no layout) a partir do breakpoint
// `xs` (480px). Como a maioria dos celulares tem tela abaixo de 480px e não
// existe `:hover` real em touch, o botão ficava com opacidade 0 para sempre
// — mas continuava no DOM, focável e TOCÁVEL: um toque sem querer no canto
// inferior-direito do cartão apagava a notificação sem nenhum aviso visual.
//
// Correção (convenção já usada em ProductCard.tsx e ProductView.tsx para o
// mesmo problema): opacidade plena por padrão; o esconder-até-hover só entra
// em `@media (hover: hover)`, via variante Tailwind `hover-hover` — quem não
// tem hover de verdade (celular) nunca perde a visibilidade.
//
// POR QUE RENDER DE VERDADE: a classe (e portanto a opacidade aplicada) vive
// no elemento renderizado, não é algo que dê para provar lendo só a fonte.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const markAsRead = vi.fn();
const markAllAsRead = vi.fn();
const deleteNotification = vi.fn();

const notificacao: Notification = {
  id: "notif-1",
  title: "Pedido confirmado",
  message: "Seu pedido foi confirmado.",
  type: "sucesso",
  read: false,
  created_at: new Date(0).toISOString(),
  order_id: "pedido-1",
};

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: [notificacao],
    markAllAsRead,
    deleteNotification,
    markAsRead,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("NotificationsView — botão 'Excluir notificação' visível em telas sem hover (celular)", () => {
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

  async function renderizarEEncontrarBotao() {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );

    await act(async () => {
      raiz.render(<NotificationsView onNavigate={() => {}} />);
    });

    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Excluir notificação"]',
    );
    expect(botao).not.toBeNull();
    return botao as HTMLButtonElement;
  }

  it("não carrega opacity-0 incondicional — em touch (sem @media hover:hover) o botão fica opacity-100", async () => {
    const botao = await renderizarEEncontrarBotao();

    // `opacity-0` puro (sem prefixo) é o bug: some para sempre em quem não
    // tem hover. Só pode sobreviver prefixado por `hover-hover:`.
    expect(botao.classList.contains("opacity-0")).toBe(false);
    expect(botao.classList.contains("opacity-100")).toBe(true);
  });

  it("usa a variante hover-hover do repo (mesma de ProductCard/ProductView) para esconder só em @media (hover: hover)", async () => {
    const botao = await renderizarEEncontrarBotao();

    expect(botao.classList.contains("hover-hover:opacity-0")).toBe(true);
    expect(
      botao.classList.contains("hover-hover:group-hover:opacity-100"),
    ).toBe(true);
  });

  it("ganha alvo de toque ampliado (pseudo-elemento after) para chegar a 44px sem alterar o ícone visível", async () => {
    const botao = await renderizarEEncontrarBotao();

    expect(botao.classList.contains("after:absolute")).toBe(true);
    expect(botao.classList.contains("after:content-['']")).toBe(true);
    // p-1.5 (6px) + size-4 (16px) = 28px de base; -inset-2 (8px por lado)
    // fecha os 44px mínimos recomendados de área de toque.
    expect(botao.classList.contains("after:-inset-2")).toBe(true);
  });

  it("continua chamando deleteNotification ao tocar/clicar (comportamento não mudou)", async () => {
    const botao = await renderizarEEncontrarBotao();

    await act(async () => {
      botao.click();
    });

    expect(deleteNotification).toHaveBeenCalledWith("notif-1");
  });
});
