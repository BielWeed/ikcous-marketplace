// @vitest-environment jsdom
//
// Selos de status e de pagamento do pedido (OrderStatusBadge). É a frase que a
// lojista lê para decidir se despacha, cobra ou devolve dinheiro: cada rótulo,
// cada rótulo curto e cada cor tem de sair exatamente como abaixo. Valores
// escritos à mão — nenhum vem do próprio componente.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OrderStatusBadge,
  PaymentStatusBadge,
  ROTULO_PRONTO_PARA_RETIRAR,
  rotuloDoPagamento,
  rotuloDoStatus,
} from "@/components/admin/orders/OrderStatusBadge";

function desenhar(el: React.ReactElement): HTMLElement {
  const caixa = document.createElement("div");
  caixa.innerHTML = renderToStaticMarkup(el);
  return caixa;
}

describe("rotuloDoStatus — a etapa do pedido", () => {
  it.each([
    ["pending", "Novo Pedido"],
    ["processing", "Em Separação"],
    ["shipping", "Em Trânsito"],
    ["delivered", "Finalizado"],
    ["cancelled", "Cancelado"],
  ] as const)("%s se lê %s", (status, esperado) => {
    expect(rotuloDoStatus(status)).toBe(esperado);
  });

  it("retirada na loja: só 'shipping' vira 'Pronto para retirar'; as outras etapas não mudam", () => {
    expect(ROTULO_PRONTO_PARA_RETIRAR).toBe("Pronto para retirar");
    expect(rotuloDoStatus("shipping", true)).toBe("Pronto para retirar");
    expect(rotuloDoStatus("shipping", false)).toBe("Em Trânsito");
    expect(rotuloDoStatus("shipping", null)).toBe("Em Trânsito");
    expect(rotuloDoStatus("processing", true)).toBe("Em Separação");
    expect(rotuloDoStatus("delivered", true)).toBe("Finalizado");
    expect(rotuloDoStatus("cancelled", true)).toBe("Cancelado");
  });

  it("status vazio ou desconhecido cai em 'Novo Pedido', sem quebrar", () => {
    expect(rotuloDoStatus(undefined as never)).toBe("Novo Pedido");
    expect(rotuloDoStatus("inventado" as never)).toBe("Novo Pedido");
  });
});

describe("OrderStatusBadge — texto e cor de cada etapa", () => {
  it.each([
    ["pending", "Novo Pedido", "text-sky-400"],
    ["processing", "Em Separação", "text-amber-400"],
    ["shipping", "Em Trânsito", "text-sky-400"],
    ["delivered", "Finalizado", "text-emerald-400"],
    ["cancelled", "Cancelado", "text-red-400"],
  ] as const)("%s: %s em %s", (status, texto, cor) => {
    const selo = desenhar(<OrderStatusBadge status={status} />);
    const rotulo = selo.querySelectorAll("span")[1];
    expect(rotulo.textContent).toBe(texto);
    expect(rotulo.className).toContain(cor);
    expect((selo.firstElementChild as HTMLElement).className).toContain(cor);
  });

  it("retirada na loja em 'shipping' mostra 'Pronto para retirar' e mantém a cor da etapa", () => {
    const selo = desenhar(
      <OrderStatusBadge status="shipping" retiradaNaLoja />,
    );
    const rotulo = selo.querySelectorAll("span")[1];
    expect(rotulo.textContent).toBe("Pronto para retirar");
    expect(rotulo.className).toContain("text-sky-400");
  });

  it("no cartão da lista o rótulo não vai em maiúsculas; no selo padrão vai", () => {
    const cartao = desenhar(
      <OrderStatusBadge status="pending" tamanho="cartao" />,
    );
    expect(cartao.querySelectorAll("span")[1].className).not.toContain(
      "uppercase",
    );
    const padrao = desenhar(<OrderStatusBadge status="pending" />);
    expect(padrao.querySelectorAll("span")[1].className).toContain("uppercase");
  });
});

describe("rotuloDoPagamento — o que a lojista lê sobre o dinheiro", () => {
  it.each([
    ["aguardando", "pending", "Aguardando pagamento"],
    ["pago", "pending", "Pago"],
    ["recusado", "pending", "Recusado"],
    ["expirado", "pending", "Expirado"],
    ["estornado", "pending", "Estornado — precisa de atenção"],
    ["pago_apos_expirar", "pending", "Pago fora do fluxo — precisa de atenção"],
    ["recebido_na_entrega", "delivered", "Recebido na entrega"],
    [null, "pending", "Sem cobrança online"],
    [undefined, "pending", "Sem cobrança online"],
  ] as const)("%s num pedido %s: %s", (pagamento, etapa, esperado) => {
    expect(rotuloDoPagamento(pagamento, etapa)).toBe(esperado);
  });

  it("pedido cancelado que recebeu dinheiro pede atenção, venha o dinheiro do app ou da entrega", () => {
    expect(rotuloDoPagamento("pago", "cancelled")).toBe(
      "Pago e cancelado — precisa de atenção",
    );
    expect(rotuloDoPagamento("recebido_na_entrega", "cancelled")).toBe(
      "Pago e cancelado — precisa de atenção",
    );
  });

  it("estorno só deixa de pedir atenção quando está resolvido (cancelado, ou entregue com devolução concluída)", () => {
    expect(rotuloDoPagamento("estornado", "cancelled")).toBe("Estornado");
    expect(rotuloDoPagamento("estornado", "delivered", undefined, true)).toBe(
      "Estornado",
    );
    expect(rotuloDoPagamento("estornado", "delivered", undefined, false)).toBe(
      "Estornado — precisa de atenção",
    );
    expect(rotuloDoPagamento("estornado", "shipping", undefined, true)).toBe(
      "Estornado — precisa de atenção",
    );
  });

  it("cancelado sem ter pago não vira 'pago e cancelado'", () => {
    expect(rotuloDoPagamento("aguardando", "cancelled")).toBe(
      "Cancelado — sem pagamento",
    );
    expect(rotuloDoPagamento("recusado", "cancelled")).toBe("Recusado");
    expect(rotuloDoPagamento("expirado", "cancelled")).toBe("Expirado");
  });

  it("dinheiro recebido fora do app diz onde: balcão (vence), retirada, ou entrega", () => {
    expect(
      rotuloDoPagamento("recebido_na_entrega", "delivered", "presencial"),
    ).toBe("Recebido no balcão");
    expect(
      rotuloDoPagamento(
        "recebido_na_entrega",
        "delivered",
        "presencial",
        false,
        true,
      ),
    ).toBe("Recebido no balcão");
    expect(
      rotuloDoPagamento(
        "recebido_na_entrega",
        "delivered",
        "online",
        false,
        true,
      ),
    ).toBe("Recebido na retirada");
    expect(
      rotuloDoPagamento(
        "recebido_na_entrega",
        "delivered",
        "online",
        false,
        false,
      ),
    ).toBe("Recebido na entrega");
    // o canal e a retirada só mudam o texto de "recebido na entrega"
    expect(
      rotuloDoPagamento("pago", "delivered", "presencial", false, true),
    ).toBe("Pago");
  });
});

describe("PaymentStatusBadge — cor, rótulo curto e alerta", () => {
  it.each([
    ["aguardando", "pending", "text-amber-400"],
    ["pago", "pending", "text-emerald-400"],
    ["recusado", "pending", "text-red-400"],
    ["expirado", "pending", "text-zinc-400"],
    ["estornado", "pending", "text-red-400"],
    ["pago_apos_expirar", "pending", "text-red-400"],
    ["recebido_na_entrega", "delivered", "text-emerald-400"],
    [null, "pending", "text-zinc-400"],
  ] as const)("%s (%s) usa %s no texto", (pagamento, etapa, cor) => {
    const selo = desenhar(
      <PaymentStatusBadge paymentStatus={pagamento} orderStatus={etapa} />,
    );
    expect(selo.querySelectorAll("span")[1].className).toContain(cor);
  });

  it.each([
    ["aguardando", "pending", "Aguardando pgto."],
    ["pago", "pending", "Pago"],
    ["recusado", "pending", "Recusado"],
    ["estornado", "pending", "Estornado"],
    ["pago_apos_expirar", "pending", "Pago fora do fluxo"],
    ["pago", "cancelled", "Pago e cancelado"],
    ["aguardando", "cancelled", "Sem pagamento"],
  ] as const)(
    "no modo compacto %s (%s) cabe como '%s' e guarda a frase inteira no title",
    (pagamento, etapa, curto) => {
      const selo = desenhar(
        <PaymentStatusBadge
          paymentStatus={pagamento}
          orderStatus={etapa}
          compact
        />,
      );
      expect(selo.querySelectorAll("span")[1].textContent).toBe(curto);
      expect(
        (selo.firstElementChild as HTMLElement).getAttribute("title"),
      ).toBe(rotuloDoPagamento(pagamento, etapa));
    },
  );

  it("fora do modo compacto não há title e o texto é a frase inteira", () => {
    const selo = desenhar(
      <PaymentStatusBadge paymentStatus="estornado" orderStatus="pending" />,
    );
    expect(selo.querySelectorAll("span")[1].textContent).toBe(
      "Estornado — precisa de atenção",
    );
    expect((selo.firstElementChild as HTMLElement).hasAttribute("title")).toBe(
      false,
    );
  });

  it("só o que pede atenção pulsa, e só no selo padrão (no cartão da lista não)", () => {
    const pulsa = (el: HTMLElement) =>
      (el.firstElementChild as HTMLElement).className.includes("animate-pulse");
    expect(
      pulsa(
        desenhar(
          <PaymentStatusBadge
            paymentStatus="estornado"
            orderStatus="pending"
          />,
        ),
      ),
    ).toBe(true);
    expect(
      pulsa(
        desenhar(
          <PaymentStatusBadge
            paymentStatus="pago_apos_expirar"
            orderStatus="pending"
          />,
        ),
      ),
    ).toBe(true);
    expect(
      pulsa(
        desenhar(
          <PaymentStatusBadge paymentStatus="pago" orderStatus="cancelled" />,
        ),
      ),
    ).toBe(true);
    expect(
      pulsa(
        desenhar(
          <PaymentStatusBadge
            paymentStatus="estornado"
            orderStatus="pending"
            tamanho="cartao"
          />,
        ),
      ),
    ).toBe(false);
    expect(
      pulsa(
        desenhar(
          <PaymentStatusBadge paymentStatus="pago" orderStatus="pending" />,
        ),
      ),
    ).toBe(false);
    expect(
      pulsa(
        desenhar(
          <PaymentStatusBadge
            paymentStatus="estornado"
            orderStatus="cancelled"
          />,
        ),
      ),
    ).toBe(false);
  });
});
