// @vitest-environment jsdom
//
// Laudo cliente-pós-compra 02/09, achado #8 — onda 2 (listas vivas).
//
// O sino mostrava "caixa limpa" durante o PRIMEIRO carregamento: a view não
// consumia o `loading` que o contexto expõe (NotificationContext.tsx:344) e,
// com a lista vazia, o ternário caía no estado vazio — em rede lenta, "Tudo
// em ordem" mentindo para quem tem avisos a caminho.
//
// O CONSERTO: enquanto o primeiro carregamento anda (e a lista está vazia), a
// tela mostra um skeleton simples no estilo da casa — nunca o "Tudo em
// ordem". Irmão do ramo de erro preso em
// notifications-view-erro-de-carregamento.test.tsx: zero que quer dizer "não
// consegui medir" não é caixa limpa; zero que ainda está medindo também não.
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

// Variáveis lidas pela fábrica no render — o valor corrente é o de cada teste.
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

describe("NotificationsView — carregando não é 'Tudo em ordem' (laudo #8)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    notificacoesDaVez = [];
    erroDaVez = null;
    carregandoDaVez = false;
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

  it("primeiro carregamento com lista vazia: skeleton, nunca 'Tudo em ordem'", async () => {
    carregandoDaVez = true;
    const texto = await renderizar();

    expect(
      hospedeiro.querySelector('[data-testid="sino-carregando"]'),
    ).not.toBeNull();
    expect(texto).not.toContain("Tudo em ordem");
    expect(texto).not.toContain("Sua caixa está limpa");
  });

  it("caixa vazia DE VERDADE (carregamento terminado): o estado vazio continua lá", async () => {
    carregandoDaVez = false;
    const texto = await renderizar();

    expect(texto).toContain("Tudo em ordem");
    expect(
      hospedeiro.querySelector('[data-testid="sino-carregando"]'),
    ).toBeNull();
  });

  it("carregando mas com avisos já em mãos: mostra os avisos, sem skeleton", async () => {
    carregandoDaVez = true;
    notificacoesDaVez = [notificacao];
    const texto = await renderizar();

    expect(texto).toContain("Aviso da loja");
    expect(
      hospedeiro.querySelector('[data-testid="sino-carregando"]'),
    ).toBeNull();
  });
});
