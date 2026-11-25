// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território ui/custom: o selo de pagamento que
// a cliente vê no pedido tinha seus textos de dinheiro cobertos, mas três
// pontos passavam com o código quebrado:
//  - "Venda anulada" é só do balcão: um pedido ONLINE cancelado e estornado tem
//    de continuar dizendo "Pagamento estornado" (quem esquece o padrão da
//    propriedade `noBalcao` faria a cliente achar que a loja anulou a venda);
//  - o ícone do selo muda com a situação (confirmado, atenção, recusado,
//    neutro, aguardando) para não depender só da cor;
//  - o tamanho do selo na lista (24 px, texto de 11 px) e no Perfil (28 px,
//    texto de 12 px) e a versão sem variante (letras maiúsculas).
import { CustomerPaymentBadge } from "@/components/ui/custom/CustomerPaymentBadge";
import type { OrderStatus, PaymentStatus } from "@/types";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MinusCircle,
  XCircle,
} from "lucide-react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

type Props = Parameters<typeof CustomerPaymentBadge>[0];

function montar(props: Props) {
  act(() => {
    raiz.render(<CustomerPaymentBadge {...props} />);
  });
  return hospedeiro.querySelector(
    '[data-testid="customer-payment-badge"]',
  ) as HTMLElement | null;
}

function rotulo(
  paymentStatus: PaymentStatus | null,
  orderStatus?: OrderStatus,
  extra: Partial<Props> = {},
) {
  return montar({ paymentStatus, orderStatus, ...extra })?.textContent;
}

describe("CustomerPaymentBadge — 'Venda anulada' é só do balcão", () => {
  it("pedido online (sem dizer que é balcão) cancelado e estornado: 'Pagamento estornado'", () => {
    expect(rotulo("estornado", "cancelled")).toBe("Pagamento estornado");
  });

  it("pedido do balcão cancelado e estornado: 'Venda anulada'", () => {
    expect(rotulo("estornado", "cancelled", { noBalcao: true })).toBe(
      "Venda anulada",
    );
  });

  it("balcão, mas o pedido NÃO está cancelado: o texto normal do pagamento", () => {
    expect(rotulo("estornado", "delivered", { noBalcao: true })).toBe(
      "Pagamento estornado",
    );
    expect(rotulo("pago", "delivered", { noBalcao: true })).toBe(
      "Pagamento confirmado",
    );
  });

  it("balcão cancelado, mas o dinheiro não foi estornado: não vira 'Venda anulada'", () => {
    expect(rotulo("pago", "cancelled", { noBalcao: true })).toBe(
      "Pago — cancelado",
    );
  });

  it("sem cobrança online (dinheiro ou PIX combinado à mão): o selo não aparece", () => {
    expect(montar({ paymentStatus: null, orderStatus: "pending" })).toBeNull();
    expect(
      montar({ paymentStatus: undefined, orderStatus: "cancelled" }),
    ).toBeNull();
  });
});

describe("CustomerPaymentBadge — o ícone muda com a situação, não só a cor", () => {
  function icone(
    paymentStatus: PaymentStatus,
    orderStatus?: OrderStatus,
  ): string {
    const selo = montar({ paymentStatus, orderStatus, variant: "lista" });
    const svg = selo?.querySelector("svg");
    expect(svg, `${paymentStatus}/${orderStatus}`).not.toBeNull();
    return svg?.innerHTML ?? "";
  }

  /** O desenho (as formas) que a biblioteca de ícones faz para este ícone. */
  function desenho(Icone: typeof Clock): string {
    const lado = document.createElement("div");
    document.body.appendChild(lado);
    const outraRaiz = createRoot(lado);
    act(() => {
      outraRaiz.render(<Icone />);
    });
    const formas = lado.querySelector("svg")?.innerHTML ?? "";
    act(() => outraRaiz.unmount());
    lado.remove();
    return formas;
  }

  it("confirmado, atenção, recusado, neutro e aguardando têm cinco ícones diferentes", () => {
    const confirmado = icone("pago", "processing");
    const atencao = icone("pago_apos_expirar", "cancelled");
    const recusado = icone("recusado", "pending");
    const neutro = icone("pago", "cancelled");
    const aguardando = icone("aguardando", "pending");
    const todos = [confirmado, atencao, recusado, neutro, aguardando];
    expect(new Set(todos).size).toBe(5);
  });

  it("cada situação usa o ícone que a significa: visto, alerta, X, traço e relógio", () => {
    expect(icone("pago", "processing")).toBe(desenho(CheckCircle2));
    expect(icone("pago_apos_expirar", "cancelled")).toBe(
      desenho(AlertTriangle),
    );
    expect(icone("recusado", "pending")).toBe(desenho(XCircle));
    expect(icone("pago", "cancelled")).toBe(desenho(MinusCircle));
    expect(icone("aguardando", "pending")).toBe(desenho(Clock));
  });

  it("a mesma situação sempre desenha o mesmo ícone (confirmado de dois jeitos)", () => {
    expect(icone("pago", "processing")).toBe(
      icone("recebido_na_entrega", "delivered"),
    );
    // aguardando e expirado dividem o relógio (nenhum dos dois é boa nem má notícia)
    expect(icone("aguardando", "pending")).toBe(icone("expirado", "pending"));
  });

  it("o ícone é decorativo (o texto ao lado já diz tudo ao leitor de tela)", () => {
    const selo = montar({
      paymentStatus: "pago",
      orderStatus: "processing",
      variant: "lista",
    });
    expect(selo?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("CustomerPaymentBadge — tamanhos do selo", () => {
  function texto(selo: HTMLElement | null): HTMLElement {
    return selo?.querySelector("span") as HTMLElement;
  }

  it("lista: 24 px de altura e texto de 11 px, com ícone", () => {
    const selo = montar({ paymentStatus: "pago", variant: "lista" });
    expect(selo?.classList.contains("h-6")).toBe(true);
    expect(selo?.classList.contains("h-7")).toBe(false);
    expect(texto(selo).classList.contains("text-[11px]")).toBe(true);
    expect(texto(selo).classList.contains("uppercase")).toBe(false);
    expect(selo?.querySelector("svg")).not.toBeNull();
  });

  it("perfil: 28 px de altura e texto de 12 px, com ícone", () => {
    const selo = montar({ paymentStatus: "pago", variant: "perfil" });
    expect(selo?.classList.contains("h-7")).toBe(true);
    expect(selo?.classList.contains("h-6")).toBe(false);
    expect(texto(selo).classList.contains("text-xs")).toBe(true);
    expect(texto(selo).classList.contains("text-[11px]")).toBe(false);
    expect(selo?.querySelector("svg")).not.toBeNull();
  });

  it("sem variante: letras maiúsculas e bolinha no lugar do ícone", () => {
    const selo = montar({ paymentStatus: "pago" });
    expect(selo?.classList.contains("py-1")).toBe(true);
    expect(selo?.classList.contains("h-6")).toBe(false);
    expect(selo?.classList.contains("h-7")).toBe(false);
    expect(texto(selo).classList.contains("uppercase")).toBe(true);
    expect(selo?.querySelector("svg")).toBeNull();
    expect(selo?.querySelector(".rounded-full.bg-emerald-500")).not.toBeNull();
  });

  it("a classe extra do chamador é somada, não troca as do selo", () => {
    const selo = montar({ paymentStatus: "pago", className: "ml-2" });
    expect(selo?.classList.contains("ml-2")).toBe(true);
    expect(selo?.classList.contains("rounded-full")).toBe(true);
  });
});
