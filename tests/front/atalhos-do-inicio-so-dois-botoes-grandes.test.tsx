// @vitest-environment jsdom
//
// Pedido do Gabriel (Início, 27/09/2026): a fileira de ações rápidas
// (Vender, Pedidos, Devoluções) saiu do Início — "Vender e Pedidos já estão
// na barra de baixo; Devoluções tem que estar na tela de Pedidos, não ali"
// (porta em AdminOrdersView.tsx via `AtalhosDaAba`). Sobram só os dois
// botões grandes (Relatórios e Financeiro). Mesmo casco de
// admin-page-header.test.tsx: createRoot + act, sem mocks (componente puro).
import { AtalhosDoInicio } from "@/components/admin/inicio/AtalhosDoInicio";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function montar(ui: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return container;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AtalhosDoInicio — só os dois botões grandes", () => {
  it("mostra Relatórios e Financeiro, sem Vender/Pedidos/Devoluções", () => {
    const onNavigate = vi.fn();
    const tela = montar(<AtalhosDoInicio onNavigate={onNavigate} />);

    const rotulos = Array.from(tela.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(rotulos.some((r) => r?.includes("Relatórios"))).toBe(true);
    expect(rotulos.some((r) => r?.includes("Financeiro"))).toBe(true);
    expect(rotulos).toHaveLength(2);

    expect(tela.textContent).not.toContain("Vender");
    expect(tela.textContent).not.toContain("Pedidos");
    expect(tela.textContent).not.toContain("Devoluções");
  });

  it("clicar em Relatórios e Financeiro navega para os destinos certos", async () => {
    const onNavigate = vi.fn();
    const tela = montar(<AtalhosDoInicio onNavigate={onNavigate} />);
    const botoes = Array.from(tela.querySelectorAll("button"));

    await act(async () => {
      botoes.find((b) => b.textContent?.includes("Relatórios"))!.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-crm");

    await act(async () => {
      botoes.find((b) => b.textContent?.includes("Financeiro"))!.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-financeiro");
  });
});

describe("AtalhosDoInicio — prateleira acoplada", () => {
  it("mantém a descrição acessível com 12px no desktop e alvos de 56px na prateleira", () => {
    const tela = montar(<AtalhosDoInicio onNavigate={vi.fn()} />);
    for (const botao of Array.from(tela.querySelectorAll("button"))) {
      const descricao = botao.querySelector("span.sr-only");
      expect(descricao).not.toBeNull();
      expect(descricao?.classList.contains("text-xs")).toBe(true);
      expect(descricao?.className).not.toContain("text-[11px]");
      expect(descricao?.className).toContain("text-zinc-400");
      expect(descricao?.className).toContain("lg:not-sr-only");
      expect(botao.className).toContain("min-h-14");
      expect(botao.className).toContain("min-w-0");
      expect(botao.querySelector(".truncate")).toBeNull();
    }
    expect(tela.textContent).not.toContain("Acessos rápidos");
  });

  it("preserva o aquecimento por foco, hover e toque", () => {
    const preparar = vi.fn();
    const tela = montar(
      <AtalhosDoInicio onNavigate={vi.fn()} aoPrepararDestino={preparar} />,
    );
    const botoes = [...tela.querySelectorAll("button")];
    act(() => botoes[0].focus());
    expect(preparar).toHaveBeenLastCalledWith("admin-crm");
    act(() =>
      botoes[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    expect(preparar).toHaveBeenLastCalledWith("admin-financeiro");
    act(() =>
      botoes[0].dispatchEvent(new Event("touchstart", { bubbles: true })),
    );
    expect(preparar).toHaveBeenLastCalledWith("admin-crm");
  });
});
