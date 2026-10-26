// @vitest-environment jsdom
//
// Sino da cliente:
//   C1. o trigger de status do pedido grava os tipos "info", "success" e
//       "warning"; o sino so conhecia "sucesso"/"aviso"/"system"/"order": o
//       "Pedido entregue" saia com sino cinza e nenhum aviso de pedido entrava
//       na aba "Avisos".
//   C2. visitante SEM conta lia "Tudo em ordem", mas nunca recebera aviso de
//       pedido: agora a tela convida a entrar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  notificacoes: [] as Record<string, unknown>[],
  usuario: null as null | { id: string },
}));

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: estado.notificacoes,
    unreadCount: estado.notificacoes.length,
    loading: false,
    erro: null,
    semConta: estado.usuario === null,
    refresh: vi.fn(),
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAsRead: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const aviso = (
  id: string,
  titulo: string,
  type: string,
  order_id?: string,
) => ({
  id,
  title: titulo,
  message: "m",
  type,
  read: false,
  created_at: new Date().toISOString(),
  order_id,
});

describe("NotificationsView: avisos de pedido e visitante sem conta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    onNavigate.mockClear();
    estado.notificacoes = [];
    estado.usuario = { id: "cliente-1" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function renderizar() {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );
    await act(async () => {
      raiz.render(<NotificationsView onNavigate={onNavigate} />);
    });
  }

  const botao = (trecho: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(trecho),
    ) as HTMLButtonElement | undefined;

  it("C1: avisos de pedido (info, success, warning) entram na aba Avisos", async () => {
    estado.notificacoes = [
      aviso("a", "Pedido a caminho", "info", "o1"),
      aviso("b", "Pedido entregue", "success", "o1"),
      aviso("c", "Pedido cancelado", "warning", "o2"),
    ];
    await renderizar();
    await act(async () => {
      botao("Avisos")!.click();
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Pedido a caminho");
    expect(texto).toContain("Pedido entregue");
    expect(texto).toContain("Pedido cancelado");
  });

  it("C1: 'Pagamento confirmado' (tipo pagamento) entra na aba Avisos com o glifo de sucesso", async () => {
    estado.notificacoes = [
      aviso("p", "Pagamento confirmado", "pagamento", "o1"),
    ];
    await renderizar();
    const glifos = [
      ...hospedeiro.querySelectorAll('[data-testid="notif-glifo"]'),
    ].map((g) => g.getAttribute("class") ?? "");
    expect(glifos[0]).toContain("text-emerald-700");
    await act(async () => {
      botao("Avisos")!.click();
    });
    expect(hospedeiro.textContent ?? "").toContain("Pagamento confirmado");
  });

  it("C1: 'Pedido entregue' tem o glifo verde de sucesso e 'a caminho' o caminhao azul", async () => {
    estado.notificacoes = [
      aviso("a", "Pedido a caminho", "info", "o1"),
      aviso("b", "Pedido entregue", "success", "o1"),
      aviso("c", "Pedido cancelado", "warning", "o2"),
    ];
    await renderizar();
    const glifos = [
      ...hospedeiro.querySelectorAll('[data-testid="notif-glifo"]'),
    ].map((g) => g.getAttribute("class") ?? "");
    expect(glifos[0]).toContain("text-blue-600");
    expect(glifos[1]).toContain("text-emerald-700");
    expect(glifos[2]).toContain("text-muted-foreground");
  });

  it("C1: o vazio da aba Avisos fala da loja, nao de plataforma", async () => {
    await renderizar();
    await act(async () => {
      botao("Avisos")!.click();
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/plataforma/i);
    expect(texto).toContain("Quando a loja enviar um comunicado");
  });

  it("C2: visitante sem conta e convidado a entrar, nao ouve 'Tudo em ordem'", async () => {
    estado.usuario = null;
    await renderizar();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(
      "Entre na sua conta para receber os avisos dos seus pedidos",
    );
    expect(texto).not.toContain("Tudo em ordem");
    await act(async () => {
      botao("Entrar")!.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("auth");
  });

  it("C2: cliente com conta e caixa vazia continua vendo 'Tudo em ordem'", async () => {
    await renderizar();
    expect(hospedeiro.textContent).toContain("Tudo em ordem");
    expect(botao("Explorar Ofertas")).toBeDefined();
  });
});
