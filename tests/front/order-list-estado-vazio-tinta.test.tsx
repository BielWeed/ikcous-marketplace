// @vitest-environment jsdom
//
// Estado vazio de "Meus Pedidos" no desenho Tinta (24/10/2026): ladrilho com o
// glifo, título, frase e o botão "Ver produtos" que leva à vitrine. O botão só
// existe para quem tem conta (o convidado tem a busca/entrar) e fora do modo
// compacto. Vazio NÃO é falha de carregamento: a falha continua em role=alert.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList — estado vazio no desenho Tinta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    onNavigate.mockClear();
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

  async function renderizar(props: Record<string, unknown>) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[]} onNavigate={onNavigate} {...props} />);
    });
  }

  const botaoVerProdutos = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === "Ver produtos",
    );

  it("aba sem pedidos (há outros em memória): título da aba, sem alerta, e 'Ver produtos' leva à vitrine", async () => {
    await renderizar({
      hasAnyOrders: true,
      emptyTitle: "Sem pedidos ativos",
      emptyDescription: "Você não tem nenhum pedido em andamento no momento.",
    });
    expect(hospedeiro.querySelector("h3")?.textContent).toBe(
      "Sem pedidos ativos",
    );
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    const botao = botaoVerProdutos();
    expect(botao).not.toBeUndefined();
    expect(botao?.className).toContain("h-12");
    expect(botao?.className).toContain("border-solid");
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("convidado: mesmo desenho, mas sem 'Ver produtos'", async () => {
    await renderizar({ isGuest: true });
    expect(hospedeiro.querySelector("h3")?.textContent).toBe(
      "Histórico Protegido",
    );
    expect(botaoVerProdutos()).toBeUndefined();
  });

  it("modo compacto: sem 'Ver produtos' e com glifo menor", async () => {
    await renderizar({ compact: true });
    expect(botaoVerProdutos()).toBeUndefined();
    expect(hospedeiro.querySelector("svg.size-5")).not.toBeNull();
  });

  it("falha de carregamento sem pedidos continua sendo alerta com 'Tentar de novo' (não é vazio)", async () => {
    const onRetry = vi.fn();
    await renderizar({ loadError: "Não foi possível carregar", onRetry });
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    expect(botaoVerProdutos()).toBeUndefined();
    const tentar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === "Tentar de novo",
    );
    expect(tentar?.className).toContain("h-[52px]");
  });
});
