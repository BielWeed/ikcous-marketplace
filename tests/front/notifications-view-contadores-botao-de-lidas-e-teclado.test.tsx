// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), tela de Notificações da cliente. Três buracos
// que nenhum teste vigiava:
//   1. os contadores: "1 não lida" / "N não lidas" (plural), e o número de cada
//      aba (Todas e Avisos contam SÓ as não lidas; Avisos só as de tipo aviso);
//   2. "Marcar como lidas": some quando tudo está lido, e o botão VOLTA a
//      funcionar depois de terminar — se a marcação falha, a cliente precisa
//      poder tocar de novo (o botão preso em "disabled" era invisível);
//   3. a barra de espaço na linha do aviso faz o mesmo que Enter (e impede a
//      página de rolar), enquanto outras teclas não navegam.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const estado = vi.hoisted(() => ({
  lista: [] as Notification[],
  carregando: false,
}));

const markAsRead = vi.fn<(id: string) => Promise<void>>();
const markAllAsRead = vi.fn<() => Promise<void>>();
const deleteNotification = vi.fn<(id: string) => Promise<void>>();
const onNavigate = vi.fn<(view: unknown, id?: string) => void>();

// O cartão de avisos do aparelho lê o hook de push (que puxa o supabase real,
// sem variáveis de ambiente aqui); esta tela é a caixa de avisos.
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
    notifications: estado.lista,
    loading: estado.carregando,
    erro: null,
    refresh: vi.fn(),
    markAllAsRead,
    deleteNotification,
    markAsRead,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function aviso(
  id: string,
  type: Notification["type"],
  read: boolean,
  extra: Partial<Notification> = {},
): Notification {
  return {
    id,
    title: `Aviso ${id}`,
    message: "texto",
    type,
    read,
    created_at: new Date().toISOString(),
    ...extra,
  };
}

describe("NotificationsView: contadores, 'Marcar como lidas' e teclado", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    markAsRead.mockResolvedValue(undefined);
    markAllAsRead.mockResolvedValue(undefined);
    estado.lista = [];
    estado.carregando = false;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function renderizar() {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );
    await act(async () => {
      raiz.render(<NotificationsView onNavigate={onNavigate} />);
    });
  }

  const eyebrow = () =>
    [...host.querySelectorAll("p")]
      .map((p) => p.textContent ?? "")
      .find((t) => /^\d+ não lidas?$/.test(t));

  const aba = (nome: string) =>
    [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith(nome),
    ) as HTMLButtonElement;

  const botaoMarcarTodas = () =>
    host.querySelector<HTMLButtonElement>(
      'button[title="Marcar todas como lidas"]',
    );

  describe("contadores", () => {
    it("uma só não lida diz '1 não lida', no singular", async () => {
      estado.lista = [aviso("a", "aviso", false), aviso("b", "aviso", true)];
      await renderizar();
      expect(eyebrow()).toBe("1 não lida");
    });

    it("várias não lidas dizem 'N não lidas', no plural", async () => {
      estado.lista = [
        aviso("a", "aviso", false),
        aviso("b", "aviso", false),
        aviso("c", "order", false),
      ];
      await renderizar();
      expect(eyebrow()).toBe("3 não lidas");
    });

    it("cada aba conta só as não lidas, e Avisos só as de tipo aviso", async () => {
      estado.lista = [
        aviso("a", "aviso", false),
        aviso("b", "sucesso", false),
        aviso("c", "aviso", true),
        aviso("d", "sucesso", true),
        aviso("e", "order", false),
      ];
      await renderizar();
      // Todas: 3 não lidas (a, b, e). Avisos: 2 não lidas de aviso (a, b);
      // as duas lidas (c, d) e o pedido (e) não entram no número de Avisos.
      expect(aba("Todas").textContent).toBe("Todas3");
      expect(aba("Avisos").textContent).toBe("Avisos2");
    });

    it("tudo lido: sem contador, sem número nas abas e sem o botão de marcar", async () => {
      estado.lista = [aviso("a", "aviso", true), aviso("b", "order", true)];
      await renderizar();
      expect(eyebrow()).toBeUndefined();
      expect(aba("Todas").textContent).toBe("Todas");
      expect(aba("Avisos").textContent).toBe("Avisos");
      expect(botaoMarcarTodas()).toBeNull();
    });

    it("lista vazia não mostra o botão de marcar como lidas", async () => {
      estado.lista = [];
      await renderizar();
      expect(botaoMarcarTodas()).toBeNull();
    });
  });

  describe("Marcar como lidas", () => {
    it("durante a marcação o botão fica travado e, terminada, volta a funcionar", async () => {
      estado.lista = [aviso("a", "aviso", false)];
      let terminar: () => void = () => {};
      markAllAsRead.mockImplementationOnce(
        () =>
          new Promise<void>((resolver) => {
            terminar = resolver;
          }),
      );
      await renderizar();

      await act(async () => {
        botaoMarcarTodas()?.click();
      });
      expect(markAllAsRead).toHaveBeenCalledTimes(1);
      expect(botaoMarcarTodas()?.disabled).toBe(true);

      await act(async () => {
        terminar();
      });
      // A lista (mock) ainda tem não lida: a cliente pode tocar de novo.
      expect(botaoMarcarTodas()?.disabled).toBe(false);
      await act(async () => {
        botaoMarcarTodas()?.click();
      });
      expect(markAllAsRead).toHaveBeenCalledTimes(2);
    });
  });

  describe("releitura em andamento", () => {
    it("aba Avisos sem nenhum aviso, com a lista cheia de outro tipo e relendo: mostra o vazio da aba, não o esqueleto", async () => {
      estado.lista = [aviso("a", "order", false)];
      estado.carregando = true;
      await renderizar();
      await act(async () => {
        aba("Avisos").click();
      });
      expect(host.textContent).toContain("Sem avisos ou comunicados");
      expect(host.querySelector('[data-testid="sino-carregando"]')).toBeNull();
    });
  });

  describe("destino do toque", () => {
    const linha = () =>
      host.querySelector<HTMLElement>('[role="button"][tabindex="0"]');

    it("aviso com pedido E com link abre o PEDIDO, uma vez só", async () => {
      estado.lista = [
        aviso("a", "aviso", false, { order_id: "ped-9", action_url: "/cart" }),
      ];
      await renderizar();
      await act(async () => {
        linha()?.click();
      });
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("order-details", "ped-9");
    });

    it("aviso só com link abre o link", async () => {
      estado.lista = [aviso("a", "aviso", false, { action_url: "/cart" })];
      await renderizar();
      await act(async () => {
        linha()?.click();
      });
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("cart", undefined);
    });

    it("aviso sem pedido e sem link só marca como lido: não navega", async () => {
      estado.lista = [aviso("a", "aviso", false)];
      await renderizar();
      await act(async () => {
        linha()?.click();
      });
      expect(onNavigate).not.toHaveBeenCalled();
      expect(markAsRead).toHaveBeenCalledWith("a");
    });
  });

  describe("teclado na linha do aviso", () => {
    const linha = () =>
      host.querySelector<HTMLElement>('[role="button"][tabindex="0"]');

    function teclar(tecla: string) {
      const evento = new KeyboardEvent("keydown", {
        key: tecla,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        linha()?.dispatchEvent(evento);
      });
      return evento;
    }

    beforeEach(async () => {
      estado.lista = [aviso("a", "aviso", false, { order_id: "ped-9" })];
      await renderizar();
    });

    it("a barra de espaço abre o destino e não deixa a página rolar", () => {
      const evento = teclar(" ");
      expect(onNavigate).toHaveBeenCalledWith("order-details", "ped-9");
      expect(evento.defaultPrevented).toBe(true);
    });

    it("Enter abre o destino e não deixa o navegador agir por conta própria", () => {
      const evento = teclar("Enter");
      expect(onNavigate).toHaveBeenCalledWith("order-details", "ped-9");
      expect(evento.defaultPrevented).toBe(true);
    });

    it.each(["a", "Tab", "Escape", "ArrowDown"])(
      "a tecla %s não abre nada",
      (tecla) => {
        const evento = teclar(tecla);
        expect(onNavigate).not.toHaveBeenCalled();
        expect(markAsRead).not.toHaveBeenCalled();
        expect(evento.defaultPrevented).toBe(false);
      },
    );
  });
});
