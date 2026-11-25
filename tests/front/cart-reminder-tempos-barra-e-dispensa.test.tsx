// @vitest-environment jsdom
//
// O lembrete "Seu carrinho" (CartReminder) tem uma lógica própria de tempo e de
// conta que os testes do tema (contagem de itens, frete em centavos, retirada)
// não prendem nos LIMITES:
//   - quando aparece: 500 ms depois de haver item no modo acoplado (`docked`),
//     1500 ms no modo solto, e nunca com o acoplamento desligado ou sem item;
//   - quando some sozinho: 8 s depois de aparecer, e então NÃO volta sozinho
//     (dispensado) — só volta se desacoplar e acoplar de novo;
//   - desacoplar no meio da espera/da exibição cancela os relógios antigos (um
//     relógio velho não pode mostrar nem esconder o lembrete fora de hora);
//   - a barra de progresso: proporção, teto de 100 %, "sempre grátis" = 100 %,
//     e as metas "desligado" (0) e "por produto" (-1) que NÃO têm barra nem
//     "Liberado" (o `>= 0` cru diria "Frete Grátis Liberado" para elas);
//   - a região `aria-live="polite"` existe mesmo com o lembrete escondido.
//
// framer-motion é trocado por um espelho simples: a saída animada e a largura
// animada da barra dependem de relógio de animação, que não é o que se prova
// aqui. O espelho expõe a largura que o componente PEDIU em `data-largura`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  cart: [] as { product: { id: string }; quantity: number }[],
  cartCount: 0,
  cartTotal: 0,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: estado.cartTotal }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: estado.cart,
    cartCount: estado.cartCount,
    cartTotal: estado.cartTotal,
  }),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const cache = new Map<string, unknown>();
  const motion = new Proxy(
    {},
    {
      get: (_alvo, tag: string) => {
        if (!cache.has(tag)) {
          cache.set(
            tag,
            ({
              initial: _i,
              animate,
              exit: _e,
              transition: _t,
              children,
              ...resto
            }: Record<string, unknown> & {
              animate?: { width?: string };
              children?: React.ReactNode;
            }) =>
              React.createElement(
                tag,
                { ...resto, "data-largura": animate?.width },
                children,
              ),
          );
        }
        return cache.get(tag);
      },
    },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { CartReminder } from "@/components/ui/custom/CartReminder";

function itens(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    product: { id: `p${i}` },
    quantity: 1,
  }));
}

/** Carrinho com `n` itens de 1 unidade e o total dado. */
function carrinho(n: number, total: number) {
  estado.cart = itens(n);
  estado.cartCount = n;
  estado.cartTotal = total;
}

const LOJA = { localDeliveryEnabled: true } as const;

describe("CartReminder — tempos, barra e dispensa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    estado.config = { ...LOJA, freeShippingMin: 100 };
    carrinho(1, 40);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  const texto = () =>
    (hospedeiro.textContent ?? "")
      .replaceAll(String.fromCharCode(160), " ")
      .replace(/\s+/g, " ");
  const visivel = () => texto().includes("Seu carrinho");
  const largura = () =>
    hospedeiro.querySelector("[data-largura]")?.getAttribute("data-largura");

  async function montar(docked?: boolean, onAction: () => void = () => {}) {
    await act(async () => {
      raiz.render(<CartReminder docked={docked} onAction={onAction} />);
    });
  }
  async function avancar(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  describe("quando aparece", () => {
    it("acoplado: nada em 499 ms, aparece em 500 ms", async () => {
      await montar(true);
      await avancar(499);
      expect(visivel()).toBe(false);
      await avancar(1);
      expect(visivel()).toBe(true);
    });

    it("solto: nada em 1499 ms, aparece em 1500 ms", async () => {
      await montar(undefined);
      await avancar(1499);
      expect(visivel()).toBe(false);
      await avancar(1);
      expect(visivel()).toBe(true);
    });

    it("desacoplado (docked=false): nunca aparece, nem passado muito tempo", async () => {
      await montar(false);
      await avancar(7000);
      expect(visivel()).toBe(false);
    });

    it("sem item no carrinho: nunca aparece", async () => {
      carrinho(0, 0);
      await montar(true);
      await avancar(3000);
      expect(visivel()).toBe(false);
      await montar(undefined);
      await avancar(3000);
      expect(visivel()).toBe(false);
    });

    it("acoplar depois conta 500 ms do acoplamento, não da montagem", async () => {
      await montar(false);
      await avancar(5000);
      await montar(true);
      await avancar(499);
      expect(visivel()).toBe(false);
      await avancar(1);
      expect(visivel()).toBe(true);
    });

    it("desacoplar antes dos 500 ms cancela o relógio: o lembrete não aparece desacoplado", async () => {
      await montar(true);
      await avancar(300);
      await montar(false);
      await avancar(2000);
      expect(visivel()).toBe(false);
    });

    it("o carrinho esvaziar na espera cancela a aparição; voltar a ter item recomeça a espera", async () => {
      await montar(undefined);
      await avancar(1000);
      carrinho(0, 0);
      await montar(undefined);
      await avancar(2000);
      expect(visivel()).toBe(false);

      carrinho(1, 40);
      await montar(undefined);
      await avancar(1499);
      expect(visivel()).toBe(false);
      await avancar(1);
      expect(visivel()).toBe(true);
    });
  });

  describe("quando some", () => {
    it("some sozinho 8 s depois de aparecer: à vista em 7999 ms, fora em 8000 ms", async () => {
      await montar(true);
      await avancar(500);
      expect(visivel()).toBe(true);
      await avancar(7999);
      expect(visivel()).toBe(true);
      await avancar(1);
      expect(visivel()).toBe(false);
    });

    it("dispensado, NÃO volta sozinho: nem com o tempo, nem com mais itens", async () => {
      await montar(true);
      await avancar(500);
      await avancar(8000);
      expect(visivel()).toBe(false);

      await avancar(10_000);
      expect(visivel()).toBe(false);

      carrinho(2, 80);
      await montar(true);
      await avancar(10_000);
      expect(visivel()).toBe(false);
    });

    it("desacoplar e acoplar de novo reabre o lembrete e dá os 8 s inteiros", async () => {
      await montar(true);
      await avancar(500);
      await avancar(8000);
      expect(visivel()).toBe(false);

      await montar(false);
      await montar(true);
      await avancar(500);
      expect(visivel()).toBe(true);
      await avancar(7999);
      expect(visivel()).toBe(true);
      await avancar(1);
      expect(visivel()).toBe(false);
    });

    it("desacoplar com o lembrete à mostra o esconde na hora", async () => {
      await montar(true);
      await avancar(500);
      expect(visivel()).toBe(true);
      await montar(false);
      expect(visivel()).toBe(false);
    });

    it("o relógio de 8 s antigo não esconde o lembrete que reapareceu depois", async () => {
      await montar(true);
      await avancar(500);
      expect(visivel()).toBe(true);
      // Desacopla aos 3 s de exibição (o relógio velho venceria em +5 s) e
      // acopla de novo: o lembrete reaparece e tem 8 s DELE.
      await avancar(3000);
      await montar(false);
      await avancar(1000);
      await montar(true);
      await avancar(500);
      expect(visivel()).toBe(true);
      // 5 s depois do desacoplamento original o relógio velho teria vencido.
      await avancar(6000);
      expect(visivel()).toBe(true);
      await avancar(2000);
      expect(visivel()).toBe(false);
    });

    it("esvaziar o carrinho com o lembrete à mostra o esconde", async () => {
      await montar(true);
      await avancar(500);
      expect(visivel()).toBe(true);
      carrinho(0, 0);
      await montar(true);
      await avancar(1);
      expect(visivel()).toBe(false);
    });
  });

  describe("a região que o leitor de tela escuta", () => {
    it("existe, educada, mesmo com o lembrete escondido", async () => {
      carrinho(0, 0);
      await montar(true);
      expect(visivel()).toBe(false);
      const regiao = hospedeiro.querySelector("[aria-live]");
      expect(regiao).not.toBeNull();
      expect(regiao?.getAttribute("aria-live")).toBe("polite");
    });

    it("o botão Carrinho chama a ação, uma vez por toque", async () => {
      const acao = vi.fn();
      await montar(true, acao);
      await avancar(500);
      const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Carrinho"),
      );
      expect(botao).toBeDefined();
      await act(async () => {
        botao?.click();
      });
      expect(acao).toHaveBeenCalledTimes(1);
    });
  });

  describe("a conta de itens e da barra", () => {
    async function aberto() {
      await montar(true);
      await avancar(500);
      expect(visivel()).toBe(true);
    }

    it("singular e plural", async () => {
      carrinho(1, 40);
      estado.config = { ...LOJA, freeShippingMin: 0 };
      await aberto();
      expect(texto()).toContain("1 item no seu carrinho");
      expect(texto()).not.toContain("1 itens");
      carrinho(2, 40);
      await montar(true);
      expect(texto()).toContain("2 itens no seu carrinho");
    });

    it("a bolinha do ícone só aparece com a contagem acima de zero", async () => {
      // Itens na lista, mas contagem zero (estado intermediário): sem "0".
      carrinho(1, 40);
      estado.cartCount = 0;
      await aberto();
      const bolinhas = Array.from(hospedeiro.querySelectorAll("span")).filter(
        (s) => s.textContent === "0",
      );
      expect(bolinhas).toHaveLength(0);

      estado.cartCount = 3;
      await montar(true);
      expect(
        Array.from(hospedeiro.querySelectorAll("span")).some(
          (s) => s.textContent === "3",
        ),
      ).toBe(true);
    });

    it("meta de R$ 100 e R$ 40 no carrinho: barra em 40 % e 'Faltam R$ 60,00'", async () => {
      carrinho(1, 40);
      await aberto();
      expect(largura()).toBe("40%");
      expect(texto()).toContain("Faltam R$ 60,00 para o Frete Grátis");
      expect(texto()).not.toContain("Liberado");
    });

    it("barra em 0 % com o carrinho de R$ 0 e em 100 % no total exato da meta", async () => {
      carrinho(1, 0);
      await aberto();
      expect(largura()).toBe("0%");

      carrinho(1, 100);
      await montar(true);
      expect(largura()).toBe("100%");
      expect(texto()).toContain("Frete Grátis Liberado");
      expect(texto()).not.toContain("Faltam");
    });

    it("a barra nunca passa de 100 % (R$ 250 para meta de R$ 100)", async () => {
      carrinho(1, 250);
      await aberto();
      expect(largura()).toBe("100%");
      expect(texto()).toContain("Frete Grátis Liberado");
    });

    it("sempre grátis (0,01): barra cheia mesmo com o carrinho em R$ 0 e frase de loja toda", async () => {
      estado.config = { ...LOJA, freeShippingMin: 0.01 };
      carrinho(1, 0);
      await aberto();
      expect(largura()).toBe("100%");
      expect(texto()).toContain("Frete grátis em toda a loja");
      expect(texto()).not.toContain("Faltam");
    });

    it("sem frete grátis (meta 0): só conta os itens, sem 'Liberado' nem 'Faltam'", async () => {
      estado.config = { ...LOJA, freeShippingMin: 0 };
      carrinho(2, 500);
      await aberto();
      expect(texto()).toContain("2 itens no seu carrinho");
      expect(texto()).not.toContain("Liberado");
      expect(texto()).not.toContain("Faltam");
      expect(texto()).not.toContain("Frete");
      expect(largura()).toBe("0%");
    });

    it("frete grátis por produto (meta -1): sem barra de valor e sem 'Liberado'", async () => {
      estado.config = { ...LOJA, freeShippingMin: -1 };
      carrinho(2, 500);
      await aberto();
      expect(texto()).toContain("2 itens no seu carrinho");
      expect(texto()).not.toContain("Liberado");
      expect(texto()).not.toContain("Faltam");
      expect(largura()).toBe("0%");
    });

    it("regra da cidade diferente da nacional: diz 'na cidade' em cada uma das três frases", async () => {
      const divergente = {
        ...LOJA,
        nationalShippingStrategy: "acima_de_valor",
        nationalShippingMin: 300,
      };
      estado.config = { ...divergente, freeShippingMin: 100 };
      carrinho(1, 40);
      await aberto();
      expect(texto()).toContain("Frete Grátis na Cidade");
      expect(texto()).toContain("Faltam R$ 60,00");

      carrinho(1, 120);
      await montar(true);
      expect(texto()).toContain("Frete Grátis na Cidade Liberado");

      estado.config = { ...divergente, freeShippingMin: 0.01 };
      await montar(true);
      expect(texto()).toContain("Frete grátis na cidade");
      expect(texto()).not.toContain("em toda a loja");
    });

    it('só retirada com transportadora e regra local que sobrou: sem meta e sem "Liberado", mesmo acima do valor', async () => {
      estado.config = {
        freeShippingMin: 150,
        localDeliveryEnabled: false,
        shippingCoverage: "national",
        enabledShippingMethods: ["sedex", "store-pickup"],
        nationalShippingStrategy: "desligado",
        nationalShippingMin: 0,
      };
      carrinho(1, 100);
      await aberto();
      expect(texto()).toContain("1 item no seu carrinho");
      expect(texto()).not.toContain("Faltam");

      carrinho(1, 400);
      await montar(true);
      expect(texto()).toContain("1 item no seu carrinho");
      expect(texto()).not.toContain("Liberado");
    });

    it("regra igual nos dois canais: não fala em cidade", async () => {
      carrinho(1, 120);
      await aberto();
      expect(texto()).toContain("Frete Grátis Liberado");
      expect(texto()).not.toMatch(/cidade/i);
    });
  });
});
