// @vitest-environment jsdom
//
// "Meus pedidos" — o cartão de cada pedido na lista da cliente. Caça por
// mutação: trocar a frase de uma etapa, a cor do ponto, a contagem de itens ou
// a regra da "Próxima etapa" não derrubava nenhum teste. Aqui cada decisão do
// cartão tem o seu caso, e o limite (retirada, balcão, quantidade 0, sem
// bairro, cancelado com cada situação de pagamento) tem o seu também.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import type { Order, View } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: vi.fn().mockResolvedValue(true),
}));

const ID = "11111111-2222-3333-4444-555555ABC123";

const pedidoBase = {
  id: ID,
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

const com = (campos: Record<string, unknown>) =>
  ({ ...pedidoBase, ...campos }) as unknown as Order;

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList — o cartão de cada pedido", () => {
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
  });

  async function renderizar(
    pedidos: Order[],
    extras: Record<string, unknown> = {},
    onNavigate: (view: View, id?: string) => void = vi.fn(),
  ) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList orders={pedidos} onNavigate={onNavigate} {...extras} />,
      );
    });
  }

  const painel = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="order-status-panel"]');
  const textoDoPainel = () => painel()?.textContent ?? "";
  const resumo = () =>
    hospedeiro.querySelector("h4")?.nextElementSibling?.textContent ?? "";
  const ponto = () => painel()?.querySelector("span.size-2\\.5");

  describe("a frase de cada etapa (entrega em casa)", () => {
    it.each([
      ["pending", "A loja já recebeu seu pedido"],
      ["processing", "Preparando seu envio"],
      ["shipping", "A caminho do seu endereço"],
      ["delivered", "Pedido entregue"],
      ["cancelled", "Este pedido foi cancelado"],
    ])("%s diz '%s'", async (status, frase) => {
      await renderizar([com({ status })]);
      expect(textoDoPainel()).toContain(frase);
    });
  });

  describe("a frase de cada etapa (retirada na loja)", () => {
    it.each([
      ["processing", "Separando seu pedido"],
      ["shipping", "Venha retirar na loja"],
      ["delivered", "Pedido retirado na loja"],
      ["pending", "A loja já recebeu seu pedido"],
      ["cancelled", "Este pedido foi cancelado"],
    ])("%s diz '%s'", async (status, frase) => {
      await renderizar([com({ status, retiradaNaLoja: true })]);
      expect(textoDoPainel()).toContain(frase);
    });
  });

  describe("compra no balcão", () => {
    it("entregue diz 'Compra na loja', sem trilha de etapas nem 'Próxima etapa'", async () => {
      await renderizar([com({ status: "delivered", canal: "presencial" })]);
      expect(textoDoPainel()).toContain("Compra na loja");
      expect(textoDoPainel()).not.toContain("Pedido entregue");
      expect(painel()?.querySelector('[role="progressbar"]')).toBeNull();
      expect(textoDoPainel()).not.toContain("Próxima etapa");
    });

    it("balcão que ainda não está entregue NÃO diz 'Compra na loja' e não promete próxima etapa", async () => {
      await renderizar([com({ status: "processing", canal: "presencial" })]);
      expect(textoDoPainel()).toContain("Preparando seu envio");
      expect(textoDoPainel()).not.toContain("Compra na loja");
      expect(textoDoPainel()).not.toContain("Próxima etapa");
    });
  });

  describe("'Próxima etapa' e código de rastreio", () => {
    it.each([
      ["pending", "Em separação"],
      ["processing", "A caminho"],
      ["shipping", "Entregue"],
    ])("%s aponta a próxima etapa '%s'", async (status, proxima) => {
      await renderizar([com({ status })]);
      expect(textoDoPainel()).toContain(`Próxima etapa: ${proxima}`);
    });

    it("entregue e cancelado não têm próxima etapa", async () => {
      await renderizar([com({ status: "delivered" })]);
      expect(textoDoPainel()).not.toContain("Próxima etapa");
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await renderizar([com({ status: "cancelled" })]);
      expect(textoDoPainel()).not.toContain("Próxima etapa");
    });

    it("com código de rastreio, ele toma o lugar da próxima etapa, limpo e em maiúsculas", async () => {
      await renderizar([
        com({ status: "shipping", trackingCode: " aa 123 br " }),
      ]);
      expect(textoDoPainel()).toContain("Rastreio AA123BR");
      expect(textoDoPainel()).not.toContain("Próxima etapa");
    });

    it("rastreio só de espaços ou pontuação não vira bloco de rastreio", async () => {
      await renderizar([com({ status: "shipping", trackingCode: "  - . " })]);
      expect(textoDoPainel()).not.toContain("Rastreio");
      expect(textoDoPainel()).toContain("Próxima etapa: Entregue");
    });
  });

  describe("a trilha de etapas", () => {
    const trilha = () =>
      hospedeiro.querySelector<HTMLElement>('[role="progressbar"]');

    it.each([
      ["pending", "1", "Etapa 1 de 4: Recebido. Próxima: Em separação"],
      ["processing", "2", "Etapa 2 de 4: Em separação. Próxima: A caminho"],
      ["shipping", "3", "Etapa 3 de 4: A caminho. Próxima: Entregue"],
    ])("%s é a etapa %s", async (status, n, texto) => {
      await renderizar([com({ status })]);
      expect(trilha()?.getAttribute("aria-valuenow")).toBe(n);
      expect(trilha()?.getAttribute("aria-valuetext")).toBe(texto);
    });

    it("entregue e cancelado não mostram trilha", async () => {
      await renderizar([com({ status: "delivered" })]);
      expect(trilha()).toBeNull();
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await renderizar([com({ status: "cancelled" })]);
      expect(trilha()).toBeNull();
    });

    it("a pílula da etapa só fica verde na retirada PRONTA, nunca em outra etapa", async () => {
      const pilulaAtual = () =>
        trilha()?.querySelector<HTMLElement>("span.rounded-full.px-3");
      await renderizar([com({ status: "shipping", retiradaNaLoja: true })]);
      expect(pilulaAtual()?.className).toContain("bg-emerald-700");
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await renderizar([com({ status: "processing", retiradaNaLoja: true })]);
      expect(pilulaAtual()?.className).not.toContain("bg-emerald-700");
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await renderizar([com({ status: "shipping", retiradaNaLoja: false })]);
      expect(pilulaAtual()?.className).not.toContain("bg-emerald-700");
    });
  });

  describe("a cor do ponto — só com significado", () => {
    it.each([
      ["delivered", {}, "bg-emerald-600"],
      ["cancelled", {}, "bg-red-600"],
      ["shipping", { retiradaNaLoja: true }, "bg-emerald-600"],
      ["shipping", {}, "bg-foreground"],
      ["processing", {}, "bg-foreground"],
      ["processing", { retiradaNaLoja: true }, "bg-foreground"],
      ["pending", {}, "bg-foreground"],
    ])("%s %j usa %s", async (status, extra, classe) => {
      await renderizar([com({ status, ...extra })]);
      expect(ponto()?.className).toContain(classe);
    });
  });

  describe("quantos itens", () => {
    it.each([
      [[{ quantity: 1 }], "1 item ·"],
      [[{ quantity: 3 }], "3 itens ·"],
      [[{ quantity: 1 }, { quantity: 1 }], "2 itens ·"],
      [[{ quantity: 2 }, { quantity: 1 }], "3 itens ·"],
      [[{ quantity: 0 }], "1 item ·"],
      [[{ quantity: 2 }], "2 itens ·"],
    ])("linhas %j dizem '%s'", async (linhas, texto) => {
      const items = linhas.map((l, i) => ({
        ...pedidoBase.items[0],
        productId: `prod-${i}`,
        ...l,
      }));
      await renderizar([com({ items })]);
      expect(resumo()).toContain(texto);
    });

    it("o '+N' do cartão é o número de produtos além do primeiro, e só aparece com mais de um", async () => {
      const tres = ["a", "b", "c"].map((id) => ({
        ...pedidoBase.items[0],
        productId: id,
        name: `Produto ${id}`,
      }));
      await renderizar([com({ items: tres })]);
      expect(hospedeiro.textContent).toContain("+2");
      expect(hospedeiro.textContent).not.toContain("+3");
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await renderizar([com({ items: tres.slice(0, 1) })]);
      expect(hospedeiro.textContent).not.toMatch(/\+\d/);
    });

    it("o bairro entra na linha de resumo; sem bairro não sobra ponto solto", async () => {
      await renderizar([
        com({
          customer: {
            name: "Cliente Teste",
            whatsapp: "",
            neighborhood: "Centro",
          },
        }),
      ]);
      expect(resumo()).toMatch(/Cartão na entrega · Centro$/);
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await renderizar([com({})]);
      expect(resumo()).toMatch(/Cartão na entrega$/);
    });
  });

  describe("o total", () => {
    it.each([
      [120, "R$ 120,00"],
      [1234.5, "R$ 1.234,50"],
      [89.9, "R$ 89,90"],
    ])("%s aparece como '%s'", async (total, texto) => {
      await renderizar([com({ total })]);
      expect(hospedeiro.textContent?.replace(/\s/g, " ")).toContain(texto);
    });
  });

  describe("pedido cancelado — o que a frase diz de cada situação do pagamento", () => {
    const fraseDoCancelado = () => {
      const p = painel()?.querySelector("p.text-\\[15px\\]");
      return p?.textContent ?? "";
    };

    it.each([
      [
        { paymentStatus: "expirado" },
        "O prazo para pagar terminou. Se não pagou, é só comprar de novo.",
      ],
      [
        { paymentStatus: "aguardando" },
        "Se o pagamento ainda estiver aberto no seu banco, não pague.",
      ],
      [
        { paymentStatus: "pago" },
        "Seu pagamento foi recebido. Toque para ver o que acontece com ele.",
      ],
      [
        { paymentStatus: "recebido_na_entrega" },
        "Seu pagamento foi recebido. Fale com a loja para resolver.",
      ],
      [
        { paymentStatus: "pago_apos_expirar" },
        "Seu pagamento foi recebido. Fale com a loja para resolver.",
      ],
      [
        { paymentStatus: "recusado" },
        "O pagamento não foi aprovado e o pedido foi cancelado.",
      ],
      [
        { paymentStatus: "estornado" },
        "O dinheiro deste pedido foi devolvido. Toque para ver os detalhes.",
      ],
      [
        { paymentStatus: "estornado", canal: "presencial" },
        "Esta compra foi anulada pela loja. A devolução do valor é combinada com a loja.",
      ],
      [{}, "Toque para ver os detalhes do pedido."],
    ])("%j diz '%s'", async (extra, frase) => {
      await renderizar([com({ status: "cancelled", ...extra })]);
      expect(fraseDoCancelado()).toBe(frase);
    });

    it("cancelado por prazo de CARTÃO não manda 'comprar de novo': avisa para confirmar com a loja", async () => {
      await renderizar([
        com({
          status: "cancelled",
          paymentStatus: "expirado",
          metodoOnline: "credito",
        }),
      ]);
      expect(fraseDoCancelado()).not.toContain("é só comprar de novo");
      expect(fraseDoCancelado()).toContain("fale com a loja");
    });
  });

  describe("limites do cartão", () => {
    it("na retirada, a 'Próxima etapa' usa os nomes da retirada, não os da entrega", async () => {
      await renderizar([com({ status: "shipping", retiradaNaLoja: true })]);
      expect(textoDoPainel()).toContain("Próxima etapa: Retirado");
      expect(textoDoPainel()).not.toContain("Próxima etapa: Entregue");
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await renderizar([com({ status: "processing", retiradaNaLoja: true })]);
      expect(textoDoPainel()).toContain("Próxima etapa: Pronto p/ retirar");
    });

    it("compra no balcão em andamento não mostra a trilha de etapas de entrega", async () => {
      await renderizar([com({ status: "processing", canal: "presencial" })]);
      expect(hospedeiro.querySelector('[role="progressbar"]')).toBeNull();
    });

    it("o traço antes da etapa atual já vem preenchido; os seguintes, não", async () => {
      const tracos = () =>
        [
          ...(hospedeiro.querySelectorAll<HTMLElement>(
            '[role="progressbar"] span.h-0\\.5',
          ) ?? []),
        ].map((t) => t.className.includes("bg-foreground"));
      await renderizar([com({ status: "processing" })]);
      expect(tracos()).toEqual([true, false, false]);
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await renderizar([com({ status: "shipping" })]);
      expect(tracos()).toEqual([true, true, false]);
    });

    it("copiar leva os 6 últimos caracteres do id em maiúsculas, o mesmo que o cartão escreve", async () => {
      await renderizar([pedidoBase]);
      const botao = hospedeiro.querySelector<HTMLButtonElement>(
        'button[aria-label="Copiar número do pedido"]',
      );
      expect(botao?.textContent).toContain("#ABC123");
      await act(async () => {
        botao?.click();
      });
      expect(copiarParaClipboard).toHaveBeenCalledWith("ABC123");
    });

    it("pedido sem total aparece como R$ 0,00, nunca como valor inventado", async () => {
      await renderizar([com({ total: undefined })]);
      expect(hospedeiro.textContent?.replace(/\s/g, " ")).toContain("R$ 0,00");
    });

    it("a data do cartão é o dia da loja (23h30 de Brasília ainda é o dia anterior ao UTC)", async () => {
      await renderizar([com({ createdAt: "2026-11-05T01:30:00.000Z" })]);
      expect(hospedeiro.textContent).toContain("04/11/2026");
    });
  });

  describe("falha ao carregar a lista", () => {
    const retry = vi.fn();
    const comOnline = (online: boolean) =>
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);

    it("sem internet o conselho é a conexão; com internet, tentar de novo", async () => {
      comOnline(false);
      await renderizar([], { loadError: "Não deu para carregar" });
      expect(hospedeiro.textContent).toContain("Verifique sua conexão");
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      comOnline(true);
      await renderizar([], { loadError: "Não deu para carregar" });
      expect(hospedeiro.textContent).not.toContain("Verifique sua conexão");
      expect(hospedeiro.textContent).toContain("Tente de novo em instantes.");
    });

    it("'Tentar de novo' refaz a leitura uma vez; enquanto relê, o toque é ignorado", async () => {
      retry.mockClear();
      comOnline(true);
      await renderizar([], {
        loadError: "Não deu para carregar",
        onRetry: retry,
      });
      const botao = () => hospedeiro.querySelector("button");
      expect(botao()?.textContent).toBe("Tentar de novo");
      act(() => {
        botao()?.click();
      });
      expect(retry).toHaveBeenCalledTimes(1);

      await renderizar([], {
        loadError: "Não deu para carregar",
        onRetry: retry,
        isLoadingOrders: true,
      });
      expect(botao()?.textContent).toBe("Carregando…");
      act(() => {
        botao()?.click();
      });
      expect(retry).toHaveBeenCalledTimes(1);
    });

    it("convidado nunca vê erro de carregamento: vê o histórico protegido", async () => {
      await renderizar([], {
        isGuest: true,
        loadError: "Não deu para carregar",
      });
      expect(hospedeiro.textContent).toContain("Histórico Protegido");
      expect(hospedeiro.textContent).not.toContain("Não deu para carregar");
    });
  });

  describe("abrir o pedido", () => {
    it("'Ver detalhes' leva ao pedido do cartão, não a outro", async () => {
      const onNavigate = vi.fn<(view: View, id?: string) => void>();
      const outro = com({ id: "99999999-aaaa-bbbb-cccc-000000DEF456" });
      await renderizar([pedidoBase, outro], {}, onNavigate);
      const botoes = hospedeiro.querySelectorAll<HTMLButtonElement>(
        '[data-testid="order-card-open"]',
      );
      expect(botoes).toHaveLength(2);
      act(() => {
        botoes[1]?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith(
        "order-details",
        "99999999-aaaa-bbbb-cccc-000000DEF456",
      );
      expect(botoes[1]?.getAttribute("aria-label")).toBe(
        "Ver detalhes do pedido #DEF456",
      );
    });
  });
});

describe("OrderList — lista vazia", () => {
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
  });

  async function vazio(
    extras: Record<string, unknown>,
    onNavigate: (view: View, id?: string) => void = vi.fn(),
  ) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList orders={[]} onNavigate={onNavigate} {...extras} />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  it("conta logada sem pedido: título, frase e 'Ver produtos' que leva à vitrine", async () => {
    const onNavigate = vi.fn<(view: View, id?: string) => void>();
    const texto = await vazio({}, onNavigate);
    expect(texto).toContain("Nenhum pedido");
    expect(texto).toContain("Você ainda não fez nenhum pedido");
    expect(texto).toContain(
      "Comprou com outro e-mail? Entre com o usado na compra.",
    );
    const botao = hospedeiro.querySelector("button");
    expect(botao?.textContent).toBe("Ver produtos");
    act(() => {
      botao?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("com pedidos em memória (aba filtrada vazia) não pergunta do outro e-mail", async () => {
    const texto = await vazio({ hasAnyOrders: true });
    expect(texto).not.toContain("Comprou com outro e-mail?");
  });

  it("descrição própria também dispensa a pergunta do outro e-mail", async () => {
    const texto = await vazio({ emptyDescription: "Nada por aqui." });
    expect(texto).toContain("Nada por aqui.");
    expect(texto).not.toContain("Comprou com outro e-mail?");
  });

  it("convidado: 'Histórico Protegido', sem botão a menos que haja ação", async () => {
    const texto = await vazio({ isGuest: true });
    expect(texto).toContain("Histórico Protegido");
    expect(texto).toContain("Seus pedidos são vinculados à sua conta");
    expect(hospedeiro.querySelector("button")).toBeNull();
  });

  it("convidado com ação própria: o botão tem o rótulo e o clique dela", async () => {
    const onClick = vi.fn();
    await vazio({ isGuest: true, emptyAction: { label: "Entrar", onClick } });
    const botao = hospedeiro.querySelector("button");
    expect(botao?.textContent).toBe("Entrar");
    act(() => {
      botao?.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("modo compacto: frase curta e nunca botão", async () => {
    const texto = await vazio({
      isGuest: true,
      compact: true,
      emptyAction: { label: "Entrar", onClick: vi.fn() },
    });
    expect(texto).toContain("Acesse para ver seu histórico.");
    expect(hospedeiro.querySelector("button")).toBeNull();
  });
});
