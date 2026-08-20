// @vitest-environment jsdom
//
// Auditoria do painel do lojista, lote 1 — a tela de Cupons prometia, por
// escrito, que "após esse prazo, o cupom é desativado automaticamente pelo
// sistema". Um cupom já vencido continuava com o selo verde "Ativo" e
// continuava contado no indicador "Cupons Ativos" — mesmo o servidor já
// recusando esse cupom no checkout. O defeito era só o rótulo e a
// contagem: o mecanismo de recusa já existia.
//
// `status-do-cupom.test.ts` prova a regra pura (chavinha manual vence a
// leitura de vencimento) sem montar nada. Este arquivo prova que a TELA
// liga essa regra ao selo e ao indicador — sozinho, o teste de função pura
// não pegaria o defeito de esquecer de chamar `rotuloDoCupom` no JSX.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
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

// O carrossel de KPIs (AdminKpiCarousel) usa embla-carousel-react, que chama
// ResizeObserver, IntersectionObserver e matchMedia no mount — ausentes no
// jsdom deste projeto. Sem os dublês o carrossel estoura dentro do
// LocalErrorBoundary e os cards somem do DOM. Mesmo padrão de
// admin-customers-ticket-medio.test.tsx.
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

function cupomFake(overrides: Partial<Coupon>): Coupon {
  return {
    id: "cupom-1",
    code: "CODIGO",
    type: "percentage",
    value: 10,
    usageCount: 0,
    active: true,
    ...overrides,
  };
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const noPassado = () => new Date(Date.now() - UM_DIA_MS).toISOString();
const noFuturo = () => new Date(Date.now() + 30 * UM_DIA_MS).toISOString();

describe("AdminCouponsView — cupom vencido para de dizer Ativo", () => {
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
    mockCoupons = [];
  });

  async function abrirTela() {
    const { AdminCouponsView } = await import(
      "@/views/admin/AdminCouponsView"
    );
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
  }

  /** Acha o card do cupom pelo código e devolve o texto só dele — os cards
   * usam a classe `group` do framer-motion como raiz (ver
   * `AdminCouponsView.tsx`: `<motion.div ... className="group relative">`). */
  function textoDoCard(codigo: string): string {
    const botaoDoCodigo = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((el) => el.textContent?.includes(codigo));
    if (!botaoDoCodigo) {
      throw new Error(`Card do cupom "${codigo}" não encontrado no DOM`);
    }
    const card = botaoDoCodigo.closest(".group");
    if (!card) {
      throw new Error(`Container do card "${codigo}" não encontrado`);
    }
    return card.textContent ?? "";
  }

  it("cupom ativo e dentro do prazo mostra Ativo", async () => {
    mockCoupons = [
      cupomFake({
        id: "c-ativo",
        code: "PROMOATIVA",
        active: true,
        validUntil: noFuturo(),
      }),
    ];

    await abrirTela();

    expect(textoDoCard("PROMOATIVA")).toContain("Ativo");
    expect(textoDoCard("PROMOATIVA")).not.toContain("Expirado");
  });

  it("cupom ligado na chavinha mas com a data já passada mostra Expirado, não Ativo", async () => {
    mockCoupons = [
      cupomFake({
        id: "c-expirado",
        code: "PROMOVENCIDA",
        active: true,
        validUntil: noPassado(),
      }),
    ];

    await abrirTela();

    const texto = textoDoCard("PROMOVENCIDA");
    expect(texto).toContain("Expirado");
    expect(texto).not.toContain("Ativo");
  });

  it("cupom desligado na chavinha E vencido mostra Inativo — a chavinha decide, não existe um terceiro rótulo aqui", async () => {
    mockCoupons = [
      cupomFake({
        id: "c-inativo-vencido",
        code: "PROMODESLIGADA",
        active: false,
        validUntil: noPassado(),
      }),
    ];

    await abrirTela();

    const texto = textoDoCard("PROMODESLIGADA");
    expect(texto).toContain("Inativo");
    expect(texto).not.toContain("Expirado");
  });

  it("o indicador 'Cupons Ativos' não conta o cupom vencido", async () => {
    mockCoupons = [
      cupomFake({ id: "c1", code: "UMATIVA", active: true, validUntil: noFuturo() }),
      cupomFake({
        id: "c2",
        code: "UMAVENCIDA",
        active: true,
        validUntil: noPassado(),
      }),
      cupomFake({
        id: "c3",
        code: "OUTRAVENCIDA",
        active: true,
        validUntil: noPassado(),
      }),
    ];

    await abrirTela();

    const textoGeral = hospedeiro.textContent ?? "";
    const posicao = textoGeral.indexOf("Cupons Ativos");
    expect(posicao).toBeGreaterThan(-1);
    // O indicador fica perto do rótulo no card do KPI; só 1 dos 3 cupons
    // (UMATIVA) está ligado e dentro do prazo.
    expect(textoGeral.slice(posicao, posicao + 30)).toContain("1");
    expect(textoGeral.slice(posicao, posicao + 30)).not.toContain("3 / 3");
  });

  it("o guia de ajuda descreve o que acontece de verdade, não um mecanismo automático que não existe", async () => {
    mockCoupons = [];

    await abrirTela();

    const botaoDeAjuda = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((el) => el.getAttribute("title") === "Guia de Cupons e Ajuda");
    expect(botaoDeAjuda).toBeTruthy();

    await act(async () => {
      botaoDeAjuda?.click();
    });

    // O modal é montado via createPortal em document.body, fora de `hospedeiro`.
    const textoDoModal = document.body.textContent ?? "";
    expect(textoDoModal).toContain("deixa de ser aceito no carrinho");
    expect(textoDoModal).not.toContain(
      "é desativado automaticamente pelo sistema",
    );
  });
});
