// @vitest-environment jsdom
//
// Auditoria do painel do lojista, achado 16 (20/08/2026) — a tela de Cupons
// dizia, em três lugares, que o cupom é usado "no carrinho". Falso: existe
// um só `CouponInput` no app inteiro, e ele está no CHECKOUT
// (CheckoutView.tsx:1561, dentro de `config.enableCoupons &&`). Nenhuma
// ocorrência no carrinho. O próprio guia de ajuda desta mesma tela já sabia
// disso — "O texto digitado pelo cliente no checkout" — só as outras três
// frases é que erravam.
//
// Duas delas já estavam no relatório da auditoria (linhas 362 e 403-404 na
// numeração de então). A TERCEIRA — "o cupom deixa de ser aceito no
// carrinho", no card de Validade do guia de ajuda — não estava no relatório
// e foi achada varrendo o arquivo inteiro por "carrinho", como o prompt
// desta tarefa pediu. É o MESMO erro: o cupom nunca foi aceito no carrinho,
// então "deixa de ser aceito" ali também descreve um lugar que não existe.
//
// E "discounts" (linha 404) estava em inglês no meio de uma frase em
// português.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: [],
    loading: false,
    updateCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
    refreshCoupons: vi.fn(),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableCoupons: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminCouponsView — o cupom é usado no checkout, não no carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function abrirTela() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
  }

  it("a frase curta ao lado da chavinha diz checkout, não carrinho", async () => {
    await abrirTela();

    const texto = (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain(
      "Permitir que clientes usem cupons no checkout.",
    );
    expect(texto).not.toMatch(/usem cupons no carrinho/i);
  });

  it("o texto expandido de 'Saiba mais' diz checkout, em português, sem 'discounts'", async () => {
    await abrirTela();

    const botaoSaibaMais = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((el) => el.textContent?.trim().startsWith("Saiba mais"));
    expect(botaoSaibaMais).toBeTruthy();

    await act(async () => {
      botaoSaibaMais?.click();
    });

    const texto = (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain("no checkout");
    expect(texto).not.toMatch(/no carrinho/i);
    expect(texto).toContain("descontos especiais");
    expect(texto).not.toMatch(/\bdiscounts\b/i);
  });

  it("o card de Validade, no guia de ajuda, também diz checkout — não é aceito 'no carrinho'", async () => {
    await abrirTela();

    const botaoDeAjuda = Array.from(hospedeiro.querySelectorAll("button")).find(
      (el) => el.getAttribute("title") === "Guia de Cupons e Ajuda",
    );
    expect(botaoDeAjuda).toBeTruthy();

    await act(async () => {
      botaoDeAjuda?.click();
    });

    // O modal é montado via createPortal em document.body, fora de `hospedeiro`.
    const textoDoModal = (document.body.textContent ?? "").replace(
      /\s+/g,
      " ",
    );
    expect(textoDoModal).toContain("deixa de ser aceito no checkout");
    expect(textoDoModal).not.toMatch(/aceito no carrinho/i);
  });

  it("nenhuma ocorrência de 'carrinho' sobra na tela inteira, incluindo os dois modais", async () => {
    await abrirTela();

    // Expande o "Saiba mais" e abre o guia de ajuda para varrer os dois
    // textos escondidos, além do que já está visível de cara.
    const botaoSaibaMais = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((el) => el.textContent?.trim().startsWith("Saiba mais"));
    await act(async () => {
      botaoSaibaMais?.click();
    });

    const botaoDeAjuda = Array.from(hospedeiro.querySelectorAll("button")).find(
      (el) => el.getAttribute("title") === "Guia de Cupons e Ajuda",
    );
    await act(async () => {
      botaoDeAjuda?.click();
    });

    const textoTotal = `${hospedeiro.textContent ?? ""} ${document.body.textContent ?? ""}`;
    expect(textoTotal).not.toMatch(/carrinho/i);
  });
});
