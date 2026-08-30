// @vitest-environment jsdom
//
// Item 11 do laudo "o que falta" (29/08, degrau 2): a tela de pedido feito
// prometia "Você receberá atualizações em breve" e nada criava os avisos.
// O aviso agora nasce no banco (trigger 20261026000000) para quem tem conta.
//
// O que este teste fixa: a promessa da tela é POR VERDADE. Logado — que tem
// sino — lê "aviso aqui no app"; convidado — que NÃO tem conta, logo nunca
// receberia nada — lê o caminho que existe de verdade: o código do
// comprovante em "Meus Pedidos". A frase antiga era falsa para os dois
// (nada nascia) e continuaria sendo para o convidado mesmo com a trigger.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let usuarioAtual: { id: string } | null = null;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// testes irmãos desta casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderSuccessView — a promessa de atualizações é por verdade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { OrderSuccessView } = await import(
      "@/views/customer/OrderSuccessView"
    );
    await act(async () => {
      raiz.render(<OrderSuccessView onNavigate={vi.fn()} />);
    });
  }

  it("cliente LOGADA lê que recebe aviso aqui no app (a trigger cumpre)", async () => {
    usuarioAtual = { id: "cliente-1" };
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Pedido Realizado!");
    expect(texto).toContain("aviso aqui no app");
    // A frase antiga prometia "em breve" sem nada nascer — não volta.
    expect(texto).not.toContain("receberá atualizações em breve");
  });

  it("CONVIDADO não lê promessa de aviso (não tem sino) — lê o caminho real", async () => {
    usuarioAtual = null;
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Pedido Realizado!");
    expect(texto).toContain("código do comprovante");
    expect(texto).not.toContain("aviso aqui no app");
    expect(texto).not.toContain("receberá atualizações em breve");
  });

  it("CONVIDADO não lê promessa de AUTOATENDIMENTO (a busca de pedido exige e-mail que ele não deu — laudo caça-bugs 30/08)", async () => {
    usuarioAtual = null;
    await montar();

    const texto = hospedeiro.textContent ?? "";
    // A frase antiga — 'Com o código do comprovante, você acompanha cada
    // atualização em "Meus Pedidos"' — prometia um caminho que falha sempre
    // para convidado. A nova manda para o canal que existe de verdade.
    expect(texto).not.toContain("você acompanha cada atualização");
    expect(texto).toContain("fale com a loja pelo WhatsApp");
  });
});
