// @vitest-environment jsdom
//
// Painel simples, B5: a ajuda do painel (AdminHelpModal) era um <div> solto —
// sem role="dialog", sem Esc, sem foco preso e com um "✕" que o leitor de
// tela não sabia nomear. Agora ela mora sobre a FolhaDoPainel (Radix Dialog).
// As 14 telas que a usam ganham tudo de uma vez, com as MESMAS props.
//
// Padrão da casa: createRoot/act + queries DOM nativas (a testing-library não
// está instalada). A folha renderiza em PORTAL: as queries saem de document.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function nomeAcessivel(el: Element) {
  return (el.getAttribute("aria-label") || el.textContent || "").trim();
}

function botoes() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
}

describe("AdminHelpModal — diálogo acessível sobre a FolhaDoPainel", () => {
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
    document.body.className = "";
  });

  async function abrir(onClose: () => void = () => {}) {
    const { AdminHelpModal } = await import(
      "@/components/admin/AdminHelpModal"
    );
    await act(async () => {
      raiz.render(
        <AdminHelpModal isOpen onClose={onClose} title="Guia de Pedidos">
          <p>conteúdo da ajuda</p>
        </AdminHelpModal>,
      );
    });
  }

  it("aberta, é um role=dialog nomeado pelo título", async () => {
    await abrir();

    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo).toBeTruthy();
    const idDoTitulo = dialogo!.getAttribute("aria-labelledby");
    expect(idDoTitulo).toBeTruthy();
    expect(document.getElementById(idDoTitulo!)?.textContent?.trim()).toBe(
      "Guia de Pedidos",
    );
    expect(document.body.textContent).toContain("conteúdo da ajuda");
  });

  it("Esc chama onClose", async () => {
    const onClose = vi.fn();
    await abrir(onClose);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("o botão de fechar tem o nome acessível Fechar e fecha", async () => {
    const onClose = vi.fn();
    await abrir(onClose);

    const fechar = botoes().find((b) => nomeAcessivel(b) === "Fechar");
    expect(fechar).toBeTruthy();
    await act(async () => {
      fechar!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("não sobrou o '✕' sem nome: nenhum botão se chama só de ✕", async () => {
    await abrir();

    expect(botoes().some((b) => nomeAcessivel(b) === "✕")).toBe(false);
  });

  it("'Entendi' continua fechando", async () => {
    const onClose = vi.fn();
    await abrir(onClose);

    const entendi = botoes().find((b) => nomeAcessivel(b) === "Entendi");
    expect(entendi).toBeTruthy();
    await act(async () => {
      entendi!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a classe admin-modal-open fica no body enquanto aberta e sai ao fechar", async () => {
    const { AdminHelpModal } = await import(
      "@/components/admin/AdminHelpModal"
    );
    const render = (isOpen: boolean) =>
      act(async () => {
        raiz.render(
          <AdminHelpModal isOpen={isOpen} onClose={() => {}} title="Guia">
            <p>x</p>
          </AdminHelpModal>,
        );
      });

    await render(true);
    expect(document.body.classList.contains("admin-modal-open")).toBe(true);

    await render(false);
    expect(document.body.classList.contains("admin-modal-open")).toBe(false);
  });

  it("fechada, não renderiza nada", async () => {
    const { AdminHelpModal } = await import(
      "@/components/admin/AdminHelpModal"
    );
    await act(async () => {
      raiz.render(
        <AdminHelpModal isOpen={false} onClose={() => {}} title="Guia Fechado">
          <p>x</p>
        </AdminHelpModal>,
      );
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Guia Fechado");
  });
});
