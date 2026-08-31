// @vitest-environment jsdom
//
// Item 11 do laudo "o que falta" (29/08, degrau 2): a tela de pedido feito
// prometia "Você receberá atualizações em breve" e nada criava os avisos.
// O aviso agora nasce no banco (trigger 20261026000000) para quem tem conta.
//
// Laudo caça-bugs 30/08 (achado 3): a frase antiga do convidado prometia
// autoatendimento que não existe — a busca de pedido exige e-mail, que o
// convidado não informou.
//
// Laudo caça-bugs 31/08 (C2): a frase de 30/08 mandava o convidado falar
// pelo WhatsApp — mas a tela não tem botão nenhum e a loja pode NÃO TER
// número (decisão de 30/08: WhatsApp é opcional). A promessa só menciona o
// canal que existe: com número configurado, cita o WhatsApp; sem número,
// manda guardar o comprovante e o contato da loja — sem citar canal nenhum
// que a loja não abriu.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let usuarioAtual: { id: string } | null = null;
let whatsappDaLoja: string | null = null;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { whatsappNumber: whatsappDaLoja } }),
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
    whatsappDaLoja = null;
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Pedido Realizado!");
    expect(texto).toContain("aviso aqui no app");
    // A frase antiga prometia "em breve" sem nada nascer — não volta.
    expect(texto).not.toContain("receberá atualizações em breve");
  });

  it("CONVIDADO sem WhatsApp na loja lê o caminho real — sem citar canal que não existe", async () => {
    usuarioAtual = null;
    whatsappDaLoja = null;
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Pedido Realizado!");
    expect(texto).toContain("código do comprovante");
    expect(texto).toContain("Guarde também o contato da loja");
    // Laudo 31/08 (C2): sem número configurado, a promessa NÃO cita o
    // WhatsApp — era a frase que a tela não podia cumprir.
    expect(texto).not.toContain("fale com a loja pelo WhatsApp");
    expect(texto).not.toContain("aviso aqui no app");
    expect(texto).not.toContain("receberá atualizações em breve");
  });

  it("CONVIDADO com WhatsApp configurado lê o canal que existe de verdade", async () => {
    usuarioAtual = null;
    whatsappDaLoja = "34999990000";
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("código do comprovante");
    expect(texto).toContain("fale com a loja pelo WhatsApp");
    // A frase antiga do autoatendimento não volta (laudo 30/08).
    expect(texto).not.toContain("você acompanha cada atualização");
  });

  it("CONVIDADO com número CURTO (9 dígitos) não lê WhatsApp — mesma régua de dígitos do ProductView", async () => {
    usuarioAtual = null;
    whatsappDaLoja = "99999999";
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("código do comprovante");
    expect(texto).not.toContain("fale com a loja pelo WhatsApp");
  });
});
