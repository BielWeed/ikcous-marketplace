// @vitest-environment jsdom
//
// O painel mostra horário e data no calendário da LOJA (America/Sao_Paulo),
// qualquer que seja o fuso do aparelho de quem abre — o mesmo do papel
// (`OrderReceipt`) e do checkout. Dois pontos estavam no fuso do aparelho:
//  - a hora do recibo na tela Vender (`ReciboDaVenda`): a tela dizia 01:30 e o
//    papel dizia 22:30 para a mesma venda;
//  - "Expira em:" no cartão da lista de cupons: com a validade gravada em
//    Brasília (`validade-do-cupom.ts`), um aparelho em UTC mostrava o dia
//    seguinte ao que a lojista escolheu no formulário.
// O fuso do processo é trocado por `process.env.TZ` (o Node relê na hora) e
// volta ao que era depois de cada teste.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `useOnlineStatus` devolve `true` quando está OFFLINE (armadilha de nome).
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
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

import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import type {
  ItemDoCupom,
  ReciboDaVendaRegistrada,
} from "@/hooks/useVendaPresencial";

let mockCoupons: Coupon[] = [];

const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta Lisa",
  variacao: null,
  preco: 39.9,
  quantidade: 2,
  estoque: 10,
  imagem: "",
};

function reciboEm(criadoEm: string): ReciboDaVendaRegistrada {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    numero: "111111",
    criadoEm,
    total: 79.8,
    subtotal: 79.8,
    desconto: 0,
    pagamento: "pix",
    cliente: { tipo: "sem_cliente" },
    itens: [ITEM],
    jaExistia: false,
  };
}

describe("painel — hora e validade no fuso da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockCoupons = [];
    process.env.TZ = fusoDaMaquina;
  });

  async function montarRecibo(criadoEm: string): Promise<string> {
    await act(async () =>
      raiz.render(
        <ReciboDaVenda
          recibo={reciboEm(criadoEm)}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          aoAnular={vi.fn()}
        />,
      ),
    );
    return (
      hospedeiro.querySelector(".pdv-receipt > .pdv-card")?.textContent ?? ""
    );
  }

  describe("hora do recibo da tela Vender", () => {
    // 22:30 de Brasília de 12/11/2026 = 01:30 UTC de 13/11/2026.
    const VENDA_22H30_BRT = "2026-11-13T01:30:00.000Z";

    it.each([
      "UTC",
      "America/Manaus",
      "America/Noronha",
      "Pacific/Auckland",
      "America/Sao_Paulo",
    ])(
      "aparelho em %s mostra 12/11/2026 às 22:30 (hora de Brasília)",
      async (fuso) => {
        process.env.TZ = fuso;
        const tela = await montarRecibo(VENDA_22H30_BRT);
        expect(tela).toContain("Pedido #111111");
        expect(tela).toContain("12/11/2026");
        expect(tela).toContain("22:30:00");
        expect(tela).not.toContain("13/11/2026");
      },
    );
  });

  describe("'Expira em:' no cartão do cupom", () => {
    // O formulário grava "até 12/11/2026" como 23:59:59.999 de Brasília.
    const VALE_ATE_12_11 = "2026-11-13T02:59:59.999Z";

    async function montarLista(): Promise<string> {
      mockCoupons = [
        {
          id: "cupom-1",
          code: "NATAL2026",
          type: "percentage",
          value: 10,
          usageCount: 0,
          active: true,
          validUntil: VALE_ATE_12_11,
        },
      ];
      const { AdminCouponsView } = await import(
        "@/views/admin/AdminCouponsView"
      );
      await act(async () => {
        raiz.render(<AdminCouponsView active onNavigate={vi.fn()} />);
      });
      return hospedeiro.textContent ?? "";
    }

    it.each(["UTC", "America/Manaus", "Pacific/Auckland", "America/Sao_Paulo"])(
      "aparelho em %s mostra a data escolhida no formulário (12/11/2026)",
      async (fuso) => {
        process.env.TZ = fuso;
        const texto = await montarLista();
        expect(texto).toContain("Expira em: 12/11/2026");
      },
    );
  });
});
