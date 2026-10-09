import type { LinhaEstornoDoPedido } from "@/hooks/useEstornosDoPedido";
// @vitest-environment jsdom
//
// Painel simples, onda 3, frente "pedidos-e-dinheiro" (spec §6, glossário):
// o resto do jargão do lado do dinheiro sai da tela de Pedidos.
//   - "Estorno devido" → "Devolver ao cliente" (aviso de cancelados e o guia
//     que cita a lista pelo nome);
//   - "chargeback" → "contestação no cartão" (quadro "Devolução de dinheiro");
//   - "SKU" → "código" (ficha do pedido e busca manual do caixa);
//   - "Ticket Médio" → "Valor médio por venda" (cartão do topo de Pedidos).
//
// SÓ TEXTO: nenhum valor, botão, RPC ou condição muda. Por isso cada caso
// abaixo monta o componente de verdade com os mesmos dados de sempre e só
// confere as palavras que a lojista lê.
//
// Mesmo casco da casa: createRoot + act do React puro, sem
// @testing-library/react.
import type { EstornoEmCurso } from "@/hooks/useEstornosEmCursoDosPedidos";
import { estadoInicialDaVenda } from "@/hooks/useVendaPresencial";
import { padroesProibidosDoPainel } from "@/lib/glossario-do-painel";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));

// A ficha do pedido busca o código dos itens em `vw_produtos_admin` com
// `.select().in()`; o card de etiqueta usa `.eq().maybeSingle()`. O builder
// devolve um código cadastrado para o produto do teste.
vi.mock("@/lib/supabase", () => {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() =>
    Promise.resolve({
      data: [{ id: "produto-com-codigo", codigo: "CAM-01" }],
      error: null,
    }),
  );
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: null }),
  );
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(),
      functions: { invoke: vi.fn() },
      channel: vi.fn(),
      removeChannel: vi.fn(),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Fonte lida pelo Vite (`?raw`), mesmo padrão do teste do guia
// (admin-orders-guia-do-pagamento-que-nao-fechou): em jsdom o
// `import.meta.url` não é `file:` e `readFileSync` não serve.
const FONTES = import.meta.glob<string>(
  [
    "/src/views/admin/AlertasCancelados.tsx",
    "/src/views/admin/AdminOrdersView.tsx",
    "/src/components/admin/orders/GuiaDoPagamentoQueNaoFechou.tsx",
    "/src/components/admin/orders/EstornoCard.tsx",
    "/src/components/admin/orders/OrderDetail.tsx",
    "/src/components/admin/pdv/CupomDaVenda.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** Mesma regra da guarda (painel-sem-jargao): linha de comentário não conta;
 * linha que CONTINUA um `{/* … *\/}` sem começar com `*` conta. */
function jargaoForaDeComentario(fonte: string): string[] {
  const achados: string[] = [];
  for (const linha of fonte.split("\n")) {
    const limpa = linha.trim();
    if (
      limpa.startsWith("//") ||
      limpa.startsWith("/*") ||
      limpa.startsWith("*") ||
      limpa.startsWith("{/*")
    ) {
      continue;
    }
    for (const padrao of padroesProibidosDoPainel()) {
      if (padrao.test(linha)) achados.push(limpa);
    }
  }
  return achados;
}

const textoDe = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("pedidos e dinheiro — nenhum termo técnico do glossário nos arquivos da frente", () => {
  it.each(Object.keys(FONTES))("%s", (caminho) => {
    const fonte = new Map(Object.entries(FONTES)).get(caminho) ?? "";
    expect(fonte.length).toBeGreaterThan(0);
    expect(jargaoForaDeComentario(fonte)).toEqual([]);
  });

  // O cartão do topo de Pedidos lê `stats.avgTicket` como sempre; só o
  // rótulo muda (a Onda F, depois, decide se o cartão fica).
  it("o cartão do topo de Pedidos se chama “Valor médio por venda”", () => {
    const fonte =
      new Map(Object.entries(FONTES)).get(
        "/src/views/admin/AdminOrdersView.tsx",
      ) ?? "";
    expect(fonte).toContain('label: "Valor médio por venda",');
  });
});

describe("pedidos e dinheiro — o que a lojista lê", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    useEstornosDoPedidoMock.mockReset();
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

  it("aviso de cancelados: a lista do dinheiro se chama “Devolver ao cliente”, e o aviso do topo aponta para ela pelo mesmo nome", async () => {
    const { AlertasCancelados } = await import(
      "@/views/admin/AlertasCancelados"
    );
    const pedido = {
      id: "pedido-pago-cancelado",
      total: 80,
      customer: { name: "Cliente Teste" },
      status: "cancelled",
      paymentStatus: "pago",
    } as unknown as Order;
    const conferido: EstornoEmCurso = {
      tipo: "conferido",
      emCurso: 0,
      pedidoPeloApp: 0,
      sistema: 0,
      semConfirmacao: 0,
      concluido: 0,
    };
    await act(async () => {
      raiz.render(
        <AlertasCancelados
          pagoCanceladoCount={1}
          avisoPagoAposCancelado="1 pedido pago e cancelado"
          pedidosEsperandoRetorno={[]}
          pedidosParaDevolverAgora={[pedido]}
          estornosEmCurso={new Map([[pedido.id, conferido]])}
          incompleto={false}
          confirmandoRetornoId={null}
          onConfirmarRetorno={vi.fn()}
          estornandoId={null}
          onRegistrarEstorno={vi.fn()}
          onVerPedidos={vi.fn()}
        />,
      );
    });
    const alavanca = hospedeiro.querySelector<HTMLButtonElement>(
      '[data-testid="alertas-cancelados-alavanca"]',
    );
    await act(async () => {
      alavanca?.click();
    });

    const cabecalhos = Array.from(hospedeiro.querySelectorAll("h3")).map(
      textoDe,
    );
    expect(cabecalhos).toContain("Devolver ao cliente");
    // O resumo do botão (nome acessível e dica) usa o mesmo nome da lista.
    expect(alavanca?.getAttribute("aria-label")).toContain(
      "devolver ao cliente (1)",
    );
    expect(alavanca?.getAttribute("aria-label")).not.toMatch(/estorno devido/i);
    const paragrafoDoAviso = Array.from(hospedeiro.querySelectorAll("p"))
      .map(textoDe)
      .find((t) => t.includes("O dinheiro entrou e o pedido está cancelado"));
    expect(paragrafoDoAviso).toContain("em Devolver ao cliente");
    // O resto da lista não muda: a sublista e o botão de registro ficam.
    expect(hospedeiro.textContent).toContain("Devolver agora (1)");
    expect(hospedeiro.textContent).toContain("Já estornei no Mercado Pago");
    expect(hospedeiro.textContent).not.toContain("Estorno devido");
  });

  // Revisão da onda 3 (BLOQUEIA, layout × dinheiro): com o texto em 11px, no
  // celular de 360px a linha "NOME LONGO · R$ 150,00" passava da largura e o
  // `truncate` da linha inteira escondia o VALOR atrás da reticência. O jsdom
  // não mede largura; o contrato é de classe: só o nome encurta, o valor não
  // encolhe, e o botão "O produto voltou" desce para baixo do pedido no
  // celular.
  it("listas do aviso de cancelados: no celular só o NOME encurta; o valor nunca some e o botão não espreme o pedido", async () => {
    const { AlertasCancelados } = await import(
      "@/views/admin/AlertasCancelados"
    );
    const nomeLongo = "Maria Aparecida Souza de Oliveira Santos";
    const paraDevolver = {
      id: "pedido-devolver",
      total: 150,
      customer: { name: nomeLongo },
      status: "cancelled",
      paymentStatus: "pago",
    } as unknown as Order;
    const esperandoRetorno = {
      id: "pedido-voltando",
      total: 150,
      customer: { name: nomeLongo },
      status: "cancelled",
      cancelledAfterShipping: true,
    } as unknown as Order;
    await act(async () => {
      raiz.render(
        <AlertasCancelados
          pagoCanceladoCount={0}
          avisoPagoAposCancelado=""
          pedidosEsperandoRetorno={[esperandoRetorno]}
          pedidosParaDevolverAgora={[paraDevolver]}
          estornosEmCurso={new Map()}
          incompleto={false}
          confirmandoRetornoId={null}
          onConfirmarRetorno={vi.fn()}
          estornandoId={null}
          onRegistrarEstorno={vi.fn()}
          onVerPedidos={vi.fn()}
        />,
      );
    });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          '[data-testid="alertas-cancelados-alavanca"]',
        )
        ?.click();
    });

    // "Devolver agora": o valor (mesmo data-testid de sempre) não encolhe, o
    // nome encurta, e quem segura os dois não corta nada.
    const itemDevolver = hospedeiro.querySelector(
      '[data-testid="devolver-agora-item-pedido-devolver"]',
    );
    const valor = itemDevolver?.querySelector(
      '[data-testid="devolver-agora-valor"]',
    );
    expect(textoDe(valor ?? null)).toBe("R$ 150,00");
    expect(valor?.classList.contains("shrink-0")).toBe(true);
    expect(valor?.classList.contains("truncate")).toBe(false);
    expect(valor?.previousElementSibling?.classList.contains("truncate")).toBe(
      true,
    );
    expect(textoDe(valor?.previousElementSibling ?? null)).toBe(
      `${nomeLongo} ·`,
    );
    expect(valor?.parentElement?.classList.contains("truncate")).toBe(false);
    expect(textoDe(valor?.parentElement ?? null)).toBe(
      `${nomeLongo} · R$ 150,00`,
    );

    // "Esperando o produto voltar": a linha empilha no celular (botão
    // embaixo) e só fica lado a lado a partir de `sm`.
    const botaoVoltou = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => textoDe(b) === "O produto voltou",
    );
    const linha = botaoVoltou?.closest("li");
    expect(linha?.classList.contains("flex-col")).toBe(true);
    expect(linha?.classList.contains("sm:flex-row")).toBe(true);
    const valorDoRetorno = Array.from(
      linha?.querySelectorAll("span") ?? [],
    ).find((s) => textoDe(s) === "R$ 150,00");
    expect(valorDoRetorno?.classList.contains("shrink-0")).toBe(true);
    expect(
      valorDoRetorno?.previousElementSibling?.classList.contains("truncate"),
    ).toBe(true);
    expect(valorDoRetorno?.parentElement?.classList.contains("truncate")).toBe(
      false,
    );
  });

  it("guia do pagamento que não fechou: cita a lista como “Devolver ao cliente” e fala em contestação no cartão", async () => {
    const { GuiaDoPagamentoQueNaoFechou } = await import(
      "@/components/admin/orders/GuiaDoPagamentoQueNaoFechou"
    );
    await act(async () => {
      raiz.render(<GuiaDoPagamentoQueNaoFechou />);
    });
    const texto = textoDe(hospedeiro);
    expect(texto).toContain("“Devolver ao cliente”");
    expect(texto).toContain("uma contestação no cartão desse pagamento");
    expect(texto).not.toContain("Estorno devido");
    expect(texto).not.toMatch(/chargeback/i);
  });

  it.each([
    [
      "em_processamento",
      "Contestação no cartão de R$ 30,00 em análise no Mercado Pago — o valor fica reservado até a decisão.",
    ],
    [
      "concluido",
      "Contestação no cartão de R$ 30,00 decidida contra a loja em",
    ],
  ] as const)(
    "quadro “Devolução de dinheiro”: contestação %s em palavras da loja",
    async (status, frase) => {
      const linha: LinhaEstornoDoPedido = {
        id: "refund-1",
        amount: 30,
        status,
        solicitado_por: "sistema",
        mp_status: "charged_back",
        mp_status_detail: null,
        tentativas: 1,
        ultimo_erro: null,
        motivo: null,
        created_at: "2026-09-01T10:00:00.000Z",
        concluido_em:
          status === "concluido" ? "2026-09-02T10:00:00.000Z" : null,
      };
      useEstornosDoPedidoMock.mockReturnValue({
        linhas: [linha],
        pago: 100,
        devolvido: status === "concluido" ? 30 : 0,
        emCurso: status === "concluido" ? 0 : 30,
        disponivel: 70,
        carregando: false,
        pedidoCarregado: true,
        erro: false,
        recarregar: vi.fn(),
        solicitarEstorno: vi.fn(),
        enviando: false,
      });
      const { EstornoCard } = await import(
        "@/components/admin/orders/EstornoCard"
      );
      const pedido = {
        id: "pedido-contestado",
        customer: { name: "Cliente Teste", whatsapp: "34999999999" },
        items: [],
        subtotal: 100,
        shipping: 0,
        discount: 0,
        total: 100,
        paymentMethod: "online",
        status: "cancelled",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        cancelledAfterShipping: false,
        paymentStatus: "pago",
      } as Order;
      await act(async () => {
        raiz.render(<EstornoCard order={pedido} />);
      });
      const texto = textoDe(hospedeiro);
      expect(texto).toContain(frase);
      expect(texto).not.toMatch(/chargeback/i);
    },
  );

  it("ficha do pedido: o código do produto aparece como “Código interno:”, sem “SKU”", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const pedido = {
      id: "pedido-com-codigo",
      customer: {
        name: "Cliente Teste",
        whatsapp: "34999999999",
        address: "Rua das Flores",
        number: "123",
        neighborhood: "Centro",
        city: "Patos de Minas",
        state: "MG",
      },
      items: [
        {
          productId: "produto-com-codigo",
          name: "Camiseta",
          price: 20,
          quantity: 1,
          image: "",
        },
      ],
      subtotal: 20,
      shipping: 0,
      discount: 0,
      total: 20,
      paymentMethod: "pix",
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cancelledAfterShipping: false,
    } as Order;
    await act(async () => {
      raiz.render(<OrderDetail order={pedido} onStatusChange={vi.fn()} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(hospedeiro.textContent).toContain("Código interno: CAM-01");
    expect(hospedeiro.textContent).not.toMatch(/\bSKU\b/);
  });

  it("caixa: a busca manual pede “nome ou código interno”", async () => {
    const { CupomDaVenda } = await import(
      "@/components/admin/pdv/CupomDaVenda"
    );
    await act(async () => {
      raiz.render(
        <CupomDaVenda
          estado={estadoInicialDaVenda(() => "chave-fixa")}
          despachar={vi.fn()}
          subtotal={0}
          buscarProdutos={vi.fn().mockResolvedValue([])}
          onNavigate={vi.fn()}
          feedback={null}
        />,
      );
    });
    const rotulo = hospedeiro.querySelector(
      'label[for="busca-manual-de-produto"]',
    );
    expect(textoDe(rotulo)).toBe(
      "Buscar produto por nome ou código interno (sem código de barras)",
    );
  });
});
