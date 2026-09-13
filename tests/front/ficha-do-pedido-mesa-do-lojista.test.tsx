// @vitest-environment jsdom
//
// T3 do lote B de telas admin (12/09/2026): a ficha do pedido vira a "mesa do
// lojista" — coluna única tipo comanda (largura máx. ~600px), barra de ação
// FIXA embaixo (imprimir · cancelar · avançar), frase-situação do dinheiro no
// cabeçalho da seção Pagamento e vocabulário de lojista no lugar do de
// operador ("GESTÃO OPERACIONAL", "Consolidado Financeiro", "Montante Final",
// "Logística & Rastreio"… saem; "Pagamento", "Total do pedido",
// "Entrega e rastreio"… entram).
//
// Aqui só APRESENTAÇÃO muda: os diálogos de dinheiro ("Recebeu os R$…?",
// "Este pedido não está com o pagamento confirmado") e o EstornoCard têm
// suítes próprias (ficha-do-pedido-pergunta-se-recebeu-ao-entregar,
// order-detail-aviso-pagamento-pendente, estorno-card-lojista-devolve-o-dinheiro)
// que não são editadas por esta tarefa e continuam valendo.
//
// Molde de montagem: order-detail-aviso-pagamento-pendente.test.tsx (renderiza
// <OrderDetail> direto, com @/lib/supabase e @/components/ui/alert-dialog
// mocados — OrderDetail.tsx importa `supabase` no topo e sem o mock a leitura
// de env var ausente explode por design; `items: []` evita o IntersectionObserver
// do LazyImage, que não existe no jsdom deste projeto).
import type { Order, OrderStatus, PaymentMethod } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(
  overrides: {
    status?: OrderStatus;
    paymentMethod?: PaymentMethod;
    paymentStatus?: Order["paymentStatus"];
    pagamentoRecebidoEm?: string | null;
    trackingCode?: string;
  } = {},
): Order {
  return {
    id: "ped-mesa",
    customer: {
      name: "Cliente Teste",
      whatsapp: "349998888777",
      address: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Patos de Minas",
      state: "MG",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: overrides.paymentMethod ?? "cash",
    status: overrides.status ?? "pending",
    paymentStatus: overrides.paymentStatus ?? null,
    createdAt: "2026-09-01T14:32:00.000Z",
    updatedAt: "2026-09-01T14:32:00.000Z",
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: overrides.pagamentoRecebidoEm ?? null,
    pagamentoRecebidoPor: null,
    // `Order["trackingCode"]` é `string | undefined` (opcional, NÃO aceita
    // null — diferente de `pagamentoRecebidoEm`): `?? null` aqui derrubava
    // o `tsc -b` do typecheck/build. `undefined` já casa com o opcional.
    trackingCode: overrides.trackingCode,
  };
}

describe("ficha do pedido (mesa do lojista) — frase-situação do dinheiro no cabeçalho de Pagamento", () => {
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
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  it("pagamento na entrega ainda sem recebimento: 'Falta receber na entrega · R$ 100,00'", async () => {
    await renderizar(pedidoFake({ paymentMethod: "cash" }));

    const texto = hospedeiro.textContent ?? "";
    // Âncora de render de verdade: a ficha desenhou o pedido.
    expect(texto).toContain("Pedido");
    expect(texto).toContain("Falta receber na entrega · R$ 100,00");
    // A frase é a SITUAÇÃO do cabeçalho da seção Pagamento: vem ANTES do
    // "Total do pedido" (que mora no corpo da mesma seção), não depois.
    expect(texto.indexOf("Falta receber na entrega")).toBeLessThan(
      texto.indexOf("Total do pedido"),
    );
  });

  it("pedido pago no site: 'Pago no site · R$ 100,00'", async () => {
    await renderizar(
      pedidoFake({ paymentMethod: "online", paymentStatus: "pago" }),
    );

    expect(hospedeiro.textContent).toContain("Pago no site · R$ 100,00");
  });

  it("pedido na entrega já recebido: 'Recebido na entrega · R$ 100,00'", async () => {
    await renderizar(
      pedidoFake({
        paymentMethod: "cash",
        pagamentoRecebidoEm: "2026-09-02T10:00:00.000Z",
      }),
    );

    expect(hospedeiro.textContent).toContain("Recebido na entrega · R$ 100,00");
  });

  it("pedido CANCELADO no dinheiro/pix/cartão da entrega, sem recebimento: 'Cancelado · nada a receber' — não manda cobrar pedido morto (achado 2 da revisão do PR 549)", async () => {
    await renderizar(
      pedidoFake({ status: "cancelled", paymentMethod: "cash" }),
    );

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Cancelado · nada a receber");
    expect(texto).not.toContain("Falta receber na entrega");
  });

  it("pedido CANCELADO aguardando no site também não promete dinheiro: a MESMA frase, não 'Aguardando pagamento no site'", async () => {
    await renderizar(
      pedidoFake({
        status: "cancelled",
        paymentMethod: "online",
        paymentStatus: "aguardando",
      }),
    );

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Cancelado · nada a receber");
    expect(texto).not.toContain("Aguardando pagamento no site");
  });
});

describe("ficha do pedido (mesa do lojista) — barra de ação fixa embaixo", () => {
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
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  // A barra de ação segue FIXA, mas desde a revisão cruzada do PR 549
  // (recado 20260912-2320, achado 1) ela SOBE acima do menu inferior do
  // admin no celular — o seletor antigo `div.fixed.bottom-0` não casa mais
  // no <lg. A âncora nova: ancestral .fixed com o padrão mobile-safe
  // (bottom calculado até lg, no pé a partir de lg).
  function barraDoBotao(
    botao: Element | null | undefined,
  ): Element | null | undefined {
    const barra = botao?.closest("div.fixed");
    expect(barra?.className).toContain("bottom-[calc(6.5rem");
    expect(barra?.className).toContain("lg:bottom-0");
    return barra;
  }

  it("'Cancelar pedido' (rótulo novo, era 'Abortar Operação') mora na barra fixa, sempre visível ao rolar", async () => {
    await renderizar(pedidoFake({ status: "pending" }));

    const botaoCancelar = hospedeiro.querySelector(
      'button[title="Cancelar pedido"]',
    ) as HTMLButtonElement | null;
    expect(botaoCancelar).not.toBeNull();
    expect(botaoCancelar?.textContent).toContain("Cancelar pedido");

    // A barra é FIXA (a ação do momento sempre na mão, sem rolar ao topo) e
    // no celular mora ACIMA do menu inferior do admin (jsdom não faz layout:
    // é o padrão de classe que garante, conferido por leitura estática na
    // revisão do PR 549).
    expect(barraDoBotao(botaoCancelar)).not.toBeNull();
  });

  it("avançar é o botão primário dourado com o rótulo 'Avançar → <próxima etapa>', na MESMA barra fixa", async () => {
    await renderizar(pedidoFake({ status: "pending" }));

    const botaoAvancar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Avançar →"),
    );
    expect(botaoAvancar).toBeDefined();
    // pending → próxima etapa é "Separação" (rótulo do statusConfig).
    expect(botaoAvancar?.textContent).toContain("Separação");
    expect(barraDoBotao(botaoAvancar)).not.toBeNull();
  });

  it("imprimir continua na barra, com o mesmo title de sempre", async () => {
    await renderizar(pedidoFake({ status: "pending" }));

    const botaoImprimir = hospedeiro.querySelector(
      'button[title="Imprimir Pedido"]',
    );
    expect(botaoImprimir).not.toBeNull();
    expect(barraDoBotao(botaoImprimir)).not.toBeNull();
  });

  it("no celular a barra sobe acima do menu inferior do admin e o rodapé da ficha acompanha (achado 1 da revisão do PR 549)", async () => {
    await renderizar(pedidoFake({ status: "pending" }));

    // O padrão mobile-safe já é conferido por botão nos testes de cima;
    // aqui entra a OUTRA metade do achado: o fim da ficha ("Anotações
    // internas") precisa de padding que cubra a barra LEVANTADA no <lg
    // (6.5rem de offset + ~69px de barra ≈ 173px; pb-44 = 176px) — o pb-28
    // antigo (112px) deixava o fim atrás. A partir de lg a barra volta ao
    // pé: pb-28 chega.
    const folha = hospedeiro.querySelector("div.min-h-screen");
    expect(folha?.className).toContain("pb-44");
    expect(folha?.className).toContain("lg:pb-28");
  });

  it("pedido finalizado (delivered): sem 'Cancelar pedido' e sem 'Avançar' — as guardas do header antigo migraram junto", async () => {
    await renderizar(pedidoFake({ status: "delivered" }));

    expect(
      hospedeiro.querySelector('button[title="Cancelar pedido"]'),
    ).toBeNull();
    const botaoAvancar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Avançar →"),
    );
    expect(botaoAvancar).toBeUndefined();
    // A barra não desaparece: imprimir continua.
    expect(
      hospedeiro.querySelector('button[title="Imprimir Pedido"]'),
    ).not.toBeNull();
  });
});

describe("ficha do pedido (mesa do lojista) — vocabulário novo", () => {
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
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  it("'GESTÃO OPERACIONAL' saiu; 'Total do pedido' e 'Anotações internas' entraram", async () => {
    await renderizar(pedidoFake({ status: "pending" }));

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("GESTÃO OPERACIONAL");
    expect(texto).toContain("Total do pedido");
    expect(texto).toContain("Anotações internas");
  });

  it("tabela do vocabulário: Consolidado Financeiro/Montante Final/Taxa Logística/BONIFICADO/Liquidação/Rede PIX/Contato Comercial/Portfólio Ativo/Notas Operacionais/Logística & Rastreio/Código Cadastrado saem; Pagamento/Frete/GRÁTIS/Como vai ser pago/PIX/Entrega e rastreio/Código de rastreio entram", async () => {
    // PIX na entrega com frete grátis: cobre "Frete → GRÁTIS" e "Rede PIX →
    // PIX". Com código de rastreio gravado: o rótulo de EXIBIÇÃO "Código de
    // rastreio" (era "Código Cadastrado") renderiza de verdade — sem código e
    // fora do modo edição, só o convite do estado vazio aparece.
    await renderizar(
      pedidoFake({
        status: "pending",
        paymentMethod: "pix",
        trackingCode: "BR123456789BR",
      }),
    );

    const texto = hospedeiro.textContent ?? "";
    for (const velho of [
      "Consolidado Financeiro",
      "Montante Final",
      "Taxa Logística",
      "BONIFICADO",
      "Liquidação",
      "Rede PIX",
      "Contato Comercial",
      "Portfólio Ativo",
      "Notas Operacionais",
      "Logística & Rastreio",
      "Código Cadastrado",
    ]) {
      expect(texto).not.toContain(velho);
    }
    for (const novo of [
      "Pagamento",
      "Frete",
      "GRÁTIS",
      "Como vai ser pago",
      "PIX",
      "Entrega e rastreio",
      "Código de rastreio",
    ]) {
      expect(texto).toContain(novo);
    }
  });

  it("método cartão na entrega: 'Cartão de crédito' (era 'Rede Crédito')", async () => {
    await renderizar(pedidoFake({ paymentMethod: "card" }));

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Cartão de crédito");
    expect(texto).not.toContain("Rede Crédito");
  });
});

describe("ficha do pedido (mesa do lojista) — coluna única tipo comanda", () => {
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
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  it("as seções descem na ordem da comanda: Cliente → Itens → Pagamento → Entrega e rastreio → Anotações internas", async () => {
    await renderizar(pedidoFake({ status: "pending" }));

    const texto = hospedeiro.textContent ?? "";
    const posicoes = [
      "Cliente",
      "Itens do Pedido",
      "Total do pedido",
      "Entrega e rastreio",
      "Anotações internas",
    ].map((termo) => texto.indexOf(termo));
    // Sanidade: TODAS as seções renderizaram (indexOf -1 mentiria na ordem).
    for (const posicao of posicoes) {
      expect(posicao).toBeGreaterThan(-1);
    }
    // A ordem é estritamente crescente — a comanda desce, não espalha. (Sem
    // indexação `posicoes[i]` no laço: acende
    // `security/detect-object-injection` neste projeto.)
    let anterior: number | undefined;
    for (const posicao of posicoes) {
      if (anterior !== undefined) {
        expect(posicao).toBeGreaterThan(anterior);
      }
      anterior = posicao;
    }
  });

  it("nenhum card em grid lateral: as classes do layout de 2 colunas (lg:grid-cols-3, lg:col-span-2) sumiram da ficha", async () => {
    await renderizar(pedidoFake({ status: "pending" }));

    expect(hospedeiro.querySelector(".lg\\:grid-cols-3")).toBeNull();
    expect(hospedeiro.querySelector(".lg\\:col-span-2")).toBeNull();
  });
});
