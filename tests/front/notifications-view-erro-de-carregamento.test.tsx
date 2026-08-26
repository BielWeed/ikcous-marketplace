// @vitest-environment jsdom
//
// Falha de consulta não é caixa limpa.
//
// Até 25/08/2026 o catch do fetch de notificações só fazia console.error:
// com a rede caída, a tela de Notificações renderizava "Sua caixa está
// limpa! / Tudo em ordem..." e o sino do Header zera — para uma cliente com
// avisos não lidos que a consulta simplesmente não trouxe. Zero que quer
// dizer "não consegui medir". Este teste prende o ramo de erro: com `erro`
// no contexto e lista vazia, a tela diz "Não conseguimos carregar" com
// retry — e o "Tudo em ordem" fica reservado para a caixa vazia DE VERDADE.
//
// A prova de que o teste enxerga o defeito: o componente de antes (HEAD)
// nunca lê `erro` — com este mesmo mock ele renderizaria o estado vazio
// "Tudo em ordem", e a asserção de ausência reprovaria. Para o lote 2 a
// evidência de vermelho executada foi registrada nos fixes 21 e 3 (e nos
// cinco do lote 1); aqui o vermelho é analítico contra o HEAD, declarado
// por honestidade de método.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const refresh = vi.fn();
const markAsRead = vi.fn();
const markAllAsRead = vi.fn();
const deleteNotification = vi.fn();

const notificacao: Notification = {
  id: "notif-1",
  title: "Aviso da loja",
  message: "Mensagem.",
  type: "system",
  read: false,
  created_at: new Date(0).toISOString(),
};

// Variáveis lidas pela fábrica no import e pelo useNotificationCenter no
// render — o valor corrente é o reatribuído por cada teste.
let notificacoesDaVez: Notification[] = [];
let erroDaVez: string | null = null;

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: notificacoesDaVez,
    unreadCount: notificacoesDaVez.filter((n) => !n.read).length,
    loading: false,
    erro: erroDaVez,
    refresh,
    markAllAsRead,
    deleteNotification,
    markAsRead,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("NotificationsView — erro de carregamento não é 'Tudo em ordem'", () => {
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
    return hospedeiro.textContent ?? "";
  }

  it("com erro e lista vazia: mensagem de erro com retry, nunca 'Tudo em ordem'", async () => {
    notificacoesDaVez = [];
    erroDaVez = "Não conseguimos carregar suas notificações.";
    const texto = await renderizar();

    expect(texto).toContain("Não conseguimos carregar");
    expect(texto).toContain("Tentar de novo");
    expect(texto).not.toContain("Tudo em ordem");

    const retry = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    ) as HTMLButtonElement | undefined;
    expect(retry).toBeDefined();
    await act(async () => {
      retry!.click();
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("sem erro e caixa vazia DE VERDADE: o 'Tudo em ordem' continua lá", async () => {
    notificacoesDaVez = [];
    erroDaVez = null;
    const texto = await renderizar();

    expect(texto).toContain("Tudo em ordem");
    expect(texto).not.toContain("Tentar de novo");
  });

  it("com erro mas com avisos já carregados: mostra os avisos (dado antigo > tela vazia)", async () => {
    notificacoesDaVez = [notificacao];
    erroDaVez = "Não conseguimos carregar suas notificações.";
    const texto = await renderizar();

    expect(texto).toContain("Aviso da loja");
  });
});
