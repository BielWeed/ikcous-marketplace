// @vitest-environment jsdom
//
// AVISO COM LINK DE CATEGORIA ABRE A CATEGORIA TAMBÉM NO SINO (caça r21, F1-D).
//
// O painel deixa a lojista mandar `/?category=Vestidos`. O celular abre o app
// na categoria (o App lê `?category=` ao abrir), mas o sino DENTRO do app mandava
// tudo que não é tela conhecida para a página inicial, jogando a query fora: a
// cliente caía na vitrine inteira. Agora o sino avisa o App da categoria antes
// de ir para a página inicial (o mesmo `handleCategoryChange` do chip).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

let notificacoesDaVez: Notification[] = [];

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
    unreadCount: 0,
    loading: false,
    erro: null,
    refresh: vi.fn(),
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAsRead: vi.fn(() => Promise.resolve()),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  NotificationsView,
  navegarPorUrl,
} from "@/views/customer/NotificationsView";

function chamadas(url: string) {
  const navegar = vi.fn<(view: unknown, id?: string) => void>();
  const categoria = vi.fn<(categoria: string) => void>();
  navegarPorUrl(url, navegar, categoria);
  return { navegar, categoria };
}

describe("navegarPorUrl — link de categoria", () => {
  it("'/?category=Vestidos' leva à página inicial COM a categoria", () => {
    const { navegar, categoria } = chamadas("/?category=Vestidos");
    expect(categoria).toHaveBeenCalledWith("Vestidos");
    expect(navegar).toHaveBeenCalledWith("home");
    // A categoria é gravada ANTES de ir à página inicial: o App monta o
    // endereço da home a partir da categoria atual.
    expect(categoria.mock.invocationCallOrder[0]).toBeLessThan(
      navegar.mock.invocationCallOrder[0],
    );
  });

  it("entende nome com espaço e acento codificados", () => {
    const { categoria } = chamadas("/?category=Cal%C3%A7ados%20Femininos");
    expect(categoria).toHaveBeenCalledWith("Calçados Femininos");
  });

  it("CONTROLES — sem categoria, categoria vazia ou fora da raiz, nada muda", () => {
    expect(chamadas("/").categoria).not.toHaveBeenCalled();
    expect(chamadas("/").navegar).toHaveBeenCalledWith("home");
    expect(chamadas("/?category=").categoria).not.toHaveBeenCalled();
    expect(
      chamadas("/search?category=Vestidos").categoria,
    ).not.toHaveBeenCalled();
    expect(
      chamadas("/caminho-que-nao-existe?category=Vestidos").categoria,
    ).not.toHaveBeenCalled();
  });

  it("sem quem receba a categoria (chamada antiga), segue para a página inicial", () => {
    const navegar = vi.fn<(view: unknown, id?: string) => void>();
    navegarPorUrl("/?category=Vestidos", navegar);
    expect(navegar).toHaveBeenCalledWith("home");
  });
});

describe("NotificationsView — tocar no aviso de categoria", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    notificacoesDaVez = [
      {
        id: "n-1",
        title: "Vestidos em oferta",
        message: "Veja a categoria.",
        type: "aviso",
        read: true,
        created_at: new Date().toISOString(),
        action_url: "/?category=Vestidos",
      } as Notification & { action_url: string },
    ];
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

  it("escolhe a categoria e abre a página inicial", async () => {
    const onNavigate = vi.fn();
    const onCategoryChange = vi.fn();
    await act(async () => {
      raiz.render(
        <NotificationsView
          onNavigate={onNavigate}
          onCategoryChange={onCategoryChange}
        />,
      );
    });
    const titulo = [...hospedeiro.querySelectorAll("h4")].find(
      (h) => h.textContent === "Vestidos em oferta",
    );
    if (!titulo) throw new Error("aviso não montou na tela");
    await act(async () => {
      titulo.click();
    });

    expect(onCategoryChange).toHaveBeenCalledWith("Vestidos");
    expect(onNavigate).toHaveBeenCalledWith("home");
  });
});
