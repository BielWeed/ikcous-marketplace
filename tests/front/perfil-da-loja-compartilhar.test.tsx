// @vitest-environment jsdom
//
// Pedido do Gabriel (Início, 27/09/2026): o cartão da loja tinha "Ver loja"
// (abre a vitrine) bem ao lado do botão Voltar do Perfil, que já leva para o
// mesmo lugar — dois botões, mesmo destino. Troca decidida: "Compartilhar",
// que manda o link da loja pelo Web Share API (celular) ou copia para a área
// de transferência (desktop, sem `navigator.share`). Mesmo casco de
// admin-page-header.test.tsx: createRoot + act, sem mockar hooks porque o
// componente é puro.
import { PerfilDaLoja } from "@/components/admin/inicio/PerfilDaLoja";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";

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

const props = {
  nome: "Loja do Gabriel",
  logoUrl: null,
  cidade: "Manaus",
  uf: "AM",
  responsavel: "Gabriel Dono",
};

describe("PerfilDaLoja — Compartilhar no lugar de Ver loja", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(window.navigator, "share");
    Reflect.deleteProperty(window.navigator, "clipboard");
  });

  it("não existe mais link para a vitrine ('Ver loja' / href=\"/\")", () => {
    const tela = montar(<PerfilDaLoja {...props} />);
    expect(tela.querySelector('a[href="/"]')).toBeNull();
    expect(tela.textContent).not.toContain("Ver loja");

    const botao = tela.querySelector("button")!;
    expect(botao).not.toBeNull();
    expect(botao.getAttribute("aria-label")).toBe(
      "Compartilhar o link da loja",
    );
  });

  it("com navigator.share, compartilha o nome e a URL de origem da loja", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "share", {
      value: share,
      configurable: true,
    });

    const tela = montar(<PerfilDaLoja {...props} />);
    const botao = tela.querySelector("button")!;
    await act(async () => {
      botao.click();
      await Promise.resolve();
    });

    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Loja do Gabriel",
        url: `${window.location.origin}/`,
      }),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("sem navigator.share, copia o link e mostra o toast de sucesso", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const tela = montar(<PerfilDaLoja {...props} />);
    const botao = tela.querySelector("button")!;
    await act(async () => {
      botao.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/`);
    expect(toast.success).toHaveBeenCalledWith("Link da loja copiado");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("cancelamento do share (AbortError) não mostra toast de erro", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelado", "AbortError"));
    Object.defineProperty(window.navigator, "share", {
      value: share,
      configurable: true,
    });

    const tela = montar(<PerfilDaLoja {...props} />);
    const botao = tela.querySelector("button")!;
    await act(async () => {
      botao.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
