// @vitest-environment jsdom
//
// "Meu pedido" (a ficha da cliente) — o que o cartão de status diz em cada
// etapa, em cada forma de entrega e em cada situação do pagamento, mais a
// linha do tempo, a contagem de itens e o rastreio. Caça por mutação: trocar
// a frase de uma etapa, o título grande, a etapa marcada como "atual", ou o
// "N item/itens" não derrubava teste nenhum. O dublê de hooks é o mesmo de
// `order-details-codigo-de-rastreio.test.tsx`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedidoBase = {
  id: "pedido-etapas",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "card",
  status: "processing",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
} as unknown as Order;

let pedidoAtual: Order = pedidoBase;
let numeroDaLoja = "34999999999";
const copiar = vi.fn().mockResolvedValue(true);

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: numeroDaLoja },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));
vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: (...args: unknown[]) => copiar(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const com = (campos: Record<string, unknown>) =>
  ({ ...pedidoBase, ...campos }) as unknown as Order;

describe("OrderDetailsView — etapas, textos e contagem", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    pedidoAtual = pedidoBase;
    numeroDaLoja = "34999999999";
    copiar.mockClear();
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

  async function renderizar(pedido: Order) {
    pedidoAtual = pedido;
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-etapas"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const cartao = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="cartao-status"]');
  const titulo = () => hospedeiro.querySelector("h1")?.textContent ?? "";
  const rotulo = () => cartao()?.querySelector("h2")?.textContent ?? "";
  const textoDoCartao = () => cartao()?.textContent ?? "";
  const rotulosDaLinhaDoTempo = () =>
    [...(cartao()?.querySelectorAll("span.text-center") ?? [])].map(
      (s) => s.textContent,
    );

  describe("o título, o nome da etapa e a frase de cada situação", () => {
    it.each([
      [
        "processing",
        {},
        "Preparando seu pedido",
        "Em separação",
        "Seu pedido está sendo preparado com todo cuidado e atenção.",
      ],
      [
        "shipping",
        {},
        "Chegando até você",
        "A caminho",
        "Seu pedido já saiu para entrega e chegará em breve.",
      ],
      [
        "delivered",
        {},
        "Chegou!",
        "Entregue",
        "O pedido foi entregue com sucesso. Aproveite sua experiência!",
      ],
      [
        "cancelled",
        {},
        "Pedido cancelado",
        "Cancelado",
        "Este pedido foi cancelado e não seguirá para entrega.",
      ],
      [
        "pending",
        { paymentMethod: "card" },
        "Pedido recebido",
        "Pedido recebido",
        "Recebemos seu pedido. A loja vai separar e você paga na entrega.",
      ],
      [
        "pending",
        { paymentMethod: "card", retiradaNaLoja: true },
        "Pedido recebido",
        "Pedido recebido",
        "Recebemos seu pedido. A loja vai separar e você paga na loja, na hora de retirar.",
      ],
      [
        "pending",
        {
          paymentMethod: "card",
          subtotal: 100,
          discount: 100,
          shipping: 0,
          total: 0,
        },
        "Pedido recebido",
        "Pedido recebido",
        "Recebemos seu pedido. A loja vai separar e você não paga nada.",
      ],
      [
        "pending",
        {
          paymentMethod: "card",
          retiradaNaLoja: true,
          subtotal: 100,
          discount: 100,
          shipping: 0,
          total: 0,
        },
        "Pedido recebido",
        "Pedido recebido",
        "Recebemos seu pedido. A loja vai separar e você não paga nada na retirada.",
      ],
      [
        "pending",
        { paymentMethod: "online" },
        "Pedido recebido",
        "Pedido recebido",
        "Aguardando confirmação de pagamento para iniciar a separação.",
      ],
    ])(
      "%s %j: título '%s', etapa '%s'",
      async (status, extra, tituloEsperado, rotuloEsperado, frase) => {
        await renderizar(com({ status, ...extra }));
        expect(titulo()).toBe(tituloEsperado);
        expect(rotulo()).toBe(rotuloEsperado);
        expect(textoDoCartao()).toContain(frase);
      },
    );

    it("pedido PENDENTE conta o que aconteceu com o pagamento (quem pagou, quem foi recusado, quem venceu)", async () => {
      const frase = async (paymentStatus: string) => {
        await renderizar(
          com({ status: "pending", paymentMethod: "online", paymentStatus }),
        );
        return textoDoCartao();
      };
      expect(await frase("pago")).toContain(
        "Pagamento confirmado. A loja vai iniciar a separação.",
      );
      expect(await frase("recebido_na_entrega")).toContain(
        "Pagamento confirmado. A loja vai iniciar a separação.",
      );
      expect(await frase("recusado")).toContain(
        "O pagamento não foi aprovado. Tente novamente ou fale com a loja.",
      );
      expect(await frase("expirado")).toContain(
        "O prazo de pagamento venceu. Fale com a loja para gerar um novo.",
      );
      expect(await frase("estornado")).toContain(
        "O pagamento foi estornado. Fale com a loja.",
      );
    });

    it("pedido CANCELADO diz o que vale para o dinheiro, e não o texto genérico", async () => {
      const frase = async (extra: Record<string, unknown>) => {
        await renderizar(com({ status: "cancelled", ...extra }));
        return textoDoCartao();
      };
      expect(await frase({ paymentStatus: "recebido_na_entrega" })).toContain(
        "Este pedido foi cancelado, mas o seu pagamento foi recebido. Fale com a loja para resolver.",
      );
      expect(await frase({ paymentStatus: "estornado" })).toContain(
        "Este pedido foi cancelado e o seu pagamento foi estornado: o dinheiro foi devolvido.",
      );
      expect(
        await frase({ paymentStatus: "estornado", canal: "presencial" }),
      ).toContain(
        "Esta compra foi anulada pela loja. A devolução do valor é combinada diretamente com a loja.",
      );
      expect(await frase({ paymentStatus: "aguardando" })).toContain(
        "Este pedido foi cancelado. Se o pagamento ainda estiver aberto no seu banco, não pague.",
      );
      expect(await frase({ retiradaNaLoja: true })).toContain(
        "Este pedido foi cancelado e não seguirá para retirada.",
      );
    });
  });

  describe("PIX ainda aguardando: o aviso de 'já pagou? não faça outro pedido'", () => {
    const AVISO = "Já pagou? Não faça outro pedido.";

    it.each([
      [
        "pagou por PIX pelo site",
        { paymentMethod: "online", metodoOnline: "pix" },
      ],
      ["PIX gravado como forma de pagamento", { paymentMethod: "pix" }],
    ])(
      "em separação, %s: o aviso acompanha a frase da etapa",
      async (_nome, forma) => {
        await renderizar(
          com({ status: "processing", paymentStatus: "aguardando", ...forma }),
        );
        expect(textoDoCartao()).toContain(AVISO);
      },
    );

    it.each([
      [
        "cartão pelo site",
        { paymentMethod: "online", metodoOnline: "credito" },
      ],
      ["pagar na entrega", { paymentMethod: "card" }],
    ])("em separação, %s: NÃO aparece o aviso do PIX", async (_nome, forma) => {
      await renderizar(
        com({ status: "processing", paymentStatus: "aguardando", ...forma }),
      );
      expect(textoDoCartao()).not.toContain(AVISO);
    });

    it("PIX já confirmado não repete o aviso", async () => {
      await renderizar(
        com({
          status: "processing",
          paymentStatus: "pago",
          paymentMethod: "online",
          metodoOnline: "pix",
        }),
      );
      expect(textoDoCartao()).not.toContain(AVISO);
    });
  });

  describe("retirada na loja", () => {
    it("pronto: título e etapa 'Pronto para retirar', com a frase de buscar", async () => {
      await renderizar(com({ status: "shipping", retiradaNaLoja: true }));
      expect(titulo()).toBe("Pronto para retirar");
      expect(rotulo()).toBe("Pronto para retirar");
      expect(textoDoCartao()).toContain(
        "Seu pedido está pronto! Venha retirar na loja.",
      );
      expect(textoDoCartao()).not.toContain("saiu para entrega");
    });

    it("já retirado: título e etapa 'Retirado', nunca 'Chegou!'", async () => {
      await renderizar(com({ status: "delivered", retiradaNaLoja: true }));
      expect(titulo()).toBe("Retirado");
      expect(rotulo()).toBe("Retirado");
      expect(textoDoCartao()).toContain(
        "Pedido retirado na loja. Aproveite sua experiência!",
      );
      expect(titulo()).not.toBe("Chegou!");
    });

    it.each([
      ["pending", "Pedido recebido"],
      ["processing", "Preparando seu pedido"],
    ])(
      "retirada ainda em %s mantém o título normal ('%s')",
      async (status, esperado) => {
        await renderizar(com({ status, retiradaNaLoja: true }));
        expect(titulo()).toBe(esperado);
        expect(textoDoCartao()).not.toContain("Venha retirar na loja");
      },
    );

    it("a linha do tempo da retirada se chama 'Pronto para retirar' e 'Retirado' em TODAS as etapas", async () => {
      for (const status of ["pending", "processing", "shipping", "delivered"]) {
        await renderizar(com({ status, retiradaNaLoja: true }));
        expect(rotulosDaLinhaDoTempo()).toEqual([
          "Recebido",
          "Em separação",
          "Pronto para retirar",
          "Retirado",
        ]);
      }
    });

    it("a linha do tempo da entrega em casa nunca fala de retirada", async () => {
      await renderizar(com({ status: "shipping" }));
      expect(rotulosDaLinhaDoTempo()).toEqual([
        "Recebido",
        "Em separação",
        "A caminho",
        "Entregue",
      ]);
    });
  });

  describe("compra no balcão", () => {
    it("entregue: 'Compra concluída', sem linha do tempo", async () => {
      await renderizar(com({ status: "delivered", canal: "presencial" }));
      expect(titulo()).toBe("Compra concluída");
      expect(rotulo()).toBe("Compra na loja");
      expect(textoDoCartao()).toContain(
        "Compra concluída no balcão da loja. Obrigado!",
      );
      expect(rotulosDaLinhaDoTempo()).toEqual([]);
    });

    it("balcão ainda não entregue NÃO diz 'Compra na loja' e também não tem linha do tempo", async () => {
      await renderizar(com({ status: "processing", canal: "presencial" }));
      expect(titulo()).toBe("Preparando seu pedido");
      expect(rotulo()).toBe("Em separação");
      expect(rotulosDaLinhaDoTempo()).toEqual([]);
    });
  });

  describe("a linha do tempo marca o passado, o atual e o futuro", () => {
    const marcas = () => ({
      concluidas: cartao()?.querySelectorAll("svg.lucide-check").length ?? 0,
      atual: cartao()?.querySelectorAll("div.ring-4").length ?? 0,
      textoClaro: [...(cartao()?.querySelectorAll("span.text-center") ?? [])]
        .filter((s) => s.className.includes("text-white/75"))
        .map((s) => s.textContent),
    });

    it.each([
      ["pending", 0, []],
      ["processing", 1, ["A caminho", "Entregue"]],
      ["shipping", 2, ["Entregue"]],
      ["delivered", 3, []],
    ])(
      "%s: %i etapa(s) concluída(s), uma atual",
      async (status, concluidas, apagadas) => {
        await renderizar(com({ status }));
        const m = marcas();
        expect(m.concluidas).toBe(concluidas);
        expect(m.atual).toBe(1);
        // Os rótulos ainda não alcançados ficam mais apagados que os demais.
        expect(m.textoClaro).toEqual(
          status === "pending"
            ? ["Em separação", "A caminho", "Entregue"]
            : apagadas,
        );
      },
    );

    it("cancelado não mostra linha do tempo", async () => {
      await renderizar(com({ status: "cancelled" }));
      expect(rotulosDaLinhaDoTempo()).toEqual([]);
    });
  });

  describe("quantos itens", () => {
    // O "N item(ns)" do cabeçalho de "Itens do pedido" é um <span> sozinho.
    const contagem = () => {
      const span = [...hospedeiro.querySelectorAll("span")].find((s) =>
        /^\d+ (item|itens)$/.test(s.textContent ?? ""),
      );
      return span?.textContent?.split(" ");
    };

    it.each([
      [[{ quantity: 1 }], ["1", "item"]],
      [[{ quantity: 3 }], ["3", "itens"]],
      [
        [{ quantity: 1 }, { quantity: 1 }],
        ["2", "itens"],
      ],
      [[{ quantity: 0 }], ["1", "item"]],
    ])("linhas %j dizem %j", async (linhas, esperado) => {
      const items = linhas.map((l, i) => ({
        ...pedidoBase.items[0],
        productId: `prod-${i}`,
        ...l,
      }));
      await renderizar(com({ items }));
      expect(contagem()).toEqual(esperado);
    });

    it("o preço unitário só aparece quando há mais de uma unidade", async () => {
      await renderizar(
        com({ items: [{ ...pedidoBase.items[0], quantity: 1 }] }),
      );
      expect(hospedeiro.textContent).toContain("Qtd. 1");
      expect(hospedeiro.textContent).not.toContain(" un.");
      await renderizar(
        com({ items: [{ ...pedidoBase.items[0], quantity: 3 }] }),
      );
      expect(hospedeiro.textContent).toMatch(/Qtd\. 3 · R\$\s?100,00 un\./);
    });
  });

  describe("rastreio", () => {
    it("mostra o código limpo e em maiúsculas, copia o MESMO código e linka para ele", async () => {
      await renderizar(
        com({ status: "shipping", trackingCode: " aa 123 br " }),
      );
      expect(hospedeiro.textContent).toContain("AA123BR");
      expect(hospedeiro.textContent).not.toContain("aa 123 br");

      const link = hospedeiro.querySelector<HTMLAnchorElement>(
        'a[title="Rastrear entrega"]',
      );
      expect(link?.getAttribute("href")).toBe(
        "https://www.melhorrastreio.com.br/rastreio/AA123BR",
      );

      const copiarBotao = hospedeiro.querySelector<HTMLButtonElement>(
        'button[title="Copiar código de rastreio"]',
      );
      await act(async () => {
        copiarBotao?.click();
      });
      expect(copiar).toHaveBeenCalledWith("AA123BR");
    });

    it("código que parece link não vira botão 'Rastrear'", async () => {
      await renderizar(
        com({
          status: "shipping",
          trackingCode: "https://exemplo.com/rastreio/123",
        }),
      );
      expect(
        hospedeiro.querySelector('a[title="Rastrear entrega"]'),
      ).toBeNull();
    });
  });

  describe("falar com a loja pelo WhatsApp", () => {
    const abrir = async (numero: string) => {
      numeroDaLoja = numero;
      const aberto = vi.spyOn(globalThis, "open").mockReturnValue(null);
      await renderizar(com({ status: "processing" }));
      const botao = hospedeiro.querySelector<HTMLButtonElement>(
        '[aria-label="Falar com a loja no WhatsApp"]',
      );
      await act(async () => {
        botao?.click();
      });
      return aberto.mock.calls[0]?.[0] as string | undefined;
    };

    it("celular com DDD (11 dígitos) ganha o 55 e a mensagem leva o número do pedido", async () => {
      const url = await abrir("(34) 99999-9999");
      expect(url).toContain("https://wa.me/5534999999999?text=");
      expect(decodeURIComponent(url ?? "")).toContain(
        "Tenho uma dúvida sobre meu pedido #ETAPAS.",
      );
    });

    it("fixo com DDD (10 dígitos) também ganha o 55", async () => {
      const url = await abrir("(34) 3333-4444");
      expect(url).toContain("https://wa.me/553433334444?text=");
    });

    it("número que já veio com o 55 não ganha outro", async () => {
      const url = await abrir("5534999999999");
      expect(url).toContain("https://wa.me/5534999999999?text=");
    });
  });

  describe("a data do pedido no chip", () => {
    it("usa o dia do calendário da loja, sem zero à esquerda", async () => {
      // 05/11 01:00 UTC ainda é 04/11 22:00 em Brasília.
      await renderizar(com({ createdAt: "2026-11-05T01:00:00.000Z" }));
      expect(hospedeiro.textContent).toContain("4 de nov. de 2026");
      expect(hospedeiro.textContent).not.toContain("04 de nov.");
      expect(hospedeiro.textContent).not.toContain("5 de nov.");
    });
  });
});
