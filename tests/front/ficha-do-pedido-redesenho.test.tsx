// @vitest-environment jsdom
//
// Redesenho VISUAL da ficha do pedido do painel (08/10/2026, aprovado pelo
// dono): menos caixas, o dinheiro logo depois da trilha, "Entrega" juntando
// cliente + endereço + forma de entrega, a conta do pedido dentro de "Itens" e
// o envio (etiqueta, rastreio, anotações) em linhas simples.
//
// Regra-mãe: SÓ aparência e ordem mudam. Os diálogos de dinheiro, o
// "Marcar como recebido"/"Desfazer", o EstornoCard e as condições de cada
// botão têm suítes próprias (ficha-do-pedido-pergunta-se-recebeu-ao-entregar,
// order-detail-aviso-pagamento-pendente, ficha-do-pedido-estorno-pela-ficha…)
// que continuam valendo. Aqui se prova o que o desenho novo promete.
//
// Molde de montagem: ficha-do-pedido-mesa-do-lojista.test.tsx (`items: []`
// evita o IntersectionObserver do LazyImage, que não existe no jsdom).
import type { Order, OrderStatus, PaymentMethod } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Linha do pedido que o EtiquetaDoPedidoCard lê (`marketplace_orders`). Cada
// teste de etiqueta escolhe o que o "banco" devolve; os demais ficam em
// `null` (card mostra "Pedido não encontrado", sem ruído).
const { linhaDaEtiqueta } = vi.hoisted(() => ({
  linhaDaEtiqueta: { data: null as Record<string, unknown> | null },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: linhaDaEtiqueta.data, error: null }),
        }),
      }),
      // Salvar anotação/rastreio da ficha (`update(...).eq("id", ...)`).
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(
  overrides: {
    status?: OrderStatus;
    paymentMethod?: PaymentMethod;
    paymentStatus?: Order["paymentStatus"];
    pagamentoRecebidoEm?: string | null;
    trackingCode?: string;
    notes?: string;
    discount?: number;
    couponCode?: string;
    shipping?: number;
    canal?: Order["canal"];
    retiradaNaLoja?: boolean;
    enderecoDeRetirada?: string;
  } = {},
): Order {
  const shipping = overrides.shipping ?? 0;
  const discount = overrides.discount ?? 0;
  return {
    id: "ped-redesenho-123456",
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
    shipping,
    discount,
    couponCode: overrides.couponCode,
    total: 100 + shipping - discount,
    paymentMethod: overrides.paymentMethod ?? "cash",
    status: overrides.status ?? "pending",
    paymentStatus: overrides.paymentStatus ?? null,
    createdAt: "2026-09-01T14:32:00.000Z",
    updatedAt: "2026-09-01T14:32:00.000Z",
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: overrides.pagamentoRecebidoEm ?? null,
    pagamentoRecebidoPor: null,
    trackingCode: overrides.trackingCode,
    notes: overrides.notes,
    canal: overrides.canal,
    retiradaNaLoja: overrides.retiradaNaLoja,
    enderecoDeRetirada: overrides.enderecoDeRetirada,
  };
}

describe("ficha do pedido (redesenho 08/10/2026)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    linhaDaEtiqueta.data = null;
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

  async function renderizar(
    order: Order,
    props: {
      onRegistrarPagamento?: (id: string, recebido: boolean) => Promise<void>;
    } = {},
  ) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={vi.fn()} {...props} />,
      );
    });
    // O EtiquetaDoPedidoCard lê o pedido numa promessa: deixa assentar.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const porId = (id: string) =>
    hospedeiro.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  const botao = (texto: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(texto),
    );

  // Elementos-folha (sem filhos) cujo texto é EXATAMENTE `texto`.
  const folhasComTexto = (texto: string) =>
    Array.from(hospedeiro.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && el.textContent === texto,
    );

  describe("cabeçalho e trilha", () => {
    it("pedido vivo: título curto + data e hora; o status do pedido é lido na TRILHA, não em selo no cabeçalho", async () => {
      await renderizar(pedidoFake({ status: "processing" }));

      const titulo = hospedeiro.querySelector("h1");
      expect(titulo?.textContent).toMatch(/^Pedido #[A-Z0-9]{6}$/);
      expect(titulo?.className).not.toContain("uppercase");
      expect(titulo?.className).toContain("text-[22px]");
      expect(titulo?.className).not.toContain("font-bold");
      // Data e hora logo abaixo, no formato "25/09/2026 às 15:38".
      expect(hospedeiro.querySelector("header")?.textContent).toMatch(
        /\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/,
      );
      // Sem selo de status do pedido ("Em Separação") no cabeçalho...
      expect(folhasComTexto("Em Separação")).toHaveLength(0);
      // ...e a trilha continua com os mesmos quatro rótulos.
      for (const rotulo of ["Novo", "Separação", "Trânsito", "Finalizado"]) {
        expect(folhasComTexto(rotulo)).toHaveLength(1);
      }
    });

    it("pedido CANCELADO não tem trilha: o aviso 'Pedido cancelado' é o status (sem selo repetido)", async () => {
      await renderizar(pedidoFake({ status: "cancelled" }));

      const cabecalho = hospedeiro.querySelector("header");
      expect(cabecalho).not.toBeNull();
      const texto = hospedeiro.textContent ?? "";
      expect(cabecalho?.textContent).toContain("Pedido cancelado");
      expect(texto).toContain(
        "Este pedido foi cancelado e não pode prosseguir.",
      );
      // O selo "Cancelado" não repete o aviso.
      expect(folhasComTexto("Cancelado")).toHaveLength(0);
      for (const rotulo of ["Novo", "Separação", "Trânsito", "Finalizado"]) {
        expect(folhasComTexto(rotulo)).toHaveLength(0);
      }
    });

    it("status FORA da trilha que não é cancelado (ex.: 'new' do banco) mostra o selo do pedido no cabeçalho", async () => {
      await renderizar(pedidoFake({ status: "new" as unknown as OrderStatus }));

      const cabecalho = hospedeiro.querySelector("header");
      const selo = Array.from(cabecalho?.querySelectorAll("span") ?? []).find(
        (s) => s.textContent === "Novo Pedido",
      );
      expect(selo).toBeDefined();
    });

    it("pagamento que PRECISA DE ATENÇÃO (pago + cancelado) mantém o selo no cabeçalho, além do bloco do dinheiro", async () => {
      await renderizar(
        pedidoFake({
          status: "cancelled",
          paymentMethod: "online",
          paymentStatus: "pago",
        }),
      );

      const noCabecalho = hospedeiro.querySelectorAll("header .selo-ficha");
      expect(noCabecalho).toHaveLength(1);
      expect(noCabecalho[0].textContent).toContain(
        "Pago e cancelado — precisa de atenção",
      );
      expect(
        porId("bloco-dinheiro")?.querySelectorAll(".selo-ficha"),
      ).toHaveLength(1);
    });

    it("a frase de espera do pedido parado fica no cabeçalho, em linha discreta", async () => {
      const velho = pedidoFake({ status: "pending" });
      velho.createdAt = new Date(
        Date.now() - 5 * 24 * 60 * 60 * 1000,
      ).toISOString();
      await renderizar(velho);

      const cabecalho = hospedeiro.querySelector("header");
      expect(cabecalho?.textContent).toContain(
        "Este pedido espera você há 5 dias.",
      );
    });
  });

  describe("bloco do dinheiro", () => {
    it("ordem fixa: trilha → dinheiro → entrega → itens → envio", async () => {
      await renderizar(pedidoFake({ status: "pending" }));

      const dinheiro = porId("bloco-dinheiro");
      const entrega = porId("bloco-entrega");
      const itens = porId("bloco-itens");
      const envio = porId("envio-lista");
      const trilha = hospedeiro.querySelector("ol");
      for (const bloco of [trilha, dinheiro, entrega, itens, envio]) {
        expect(bloco).not.toBeNull();
      }
      const segue = (a: Node, b: Node) =>
        Boolean(
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      expect(segue(trilha as Node, dinheiro as Node)).toBe(true);
      expect(segue(dinheiro as Node, entrega as Node)).toBe(true);
      expect(segue(entrega as Node, itens as Node)).toBe(true);
      expect(segue(itens as Node, envio as Node)).toBe(true);
    });

    it("total grande + forma de pagamento + UMA frase de situação, tudo no mesmo bloco", async () => {
      await renderizar(pedidoFake({ paymentMethod: "pix" }));

      const dinheiro = porId("bloco-dinheiro");
      const texto = dinheiro?.textContent ?? "";
      expect(texto).toContain("Total do pedido");
      expect(texto).toMatch(/R\$\s*100,00/);
      expect(texto).toContain("PIX");
      expect(texto).toContain("Falta receber na entrega · R$ 100,00");
      // A caixa "Como vai ser pago" saiu: a forma já está ao lado do total.
      expect(hospedeiro.textContent).not.toContain("Como vai ser pago");
    });

    it("a situação do pagamento aparece UMA vez só: UM selo (elemento) e UMA frase, no bloco do dinheiro", async () => {
      await renderizar(
        pedidoFake({ paymentMethod: "online", paymentStatus: "pago" }),
      );

      const texto = hospedeiro.textContent ?? "";
      // Conta o ELEMENTO do selo (nos casos de atenção a frase repete o
      // rótulo do selo de propósito, então contar texto enganaria).
      expect(hospedeiro.querySelectorAll(".selo-ficha")).toHaveLength(1);
      expect(
        porId("bloco-dinheiro")?.querySelectorAll(".selo-ficha"),
      ).toHaveLength(1);
      expect(texto.split("Pago no site · R$ 100,00")).toHaveLength(2);
      expect(hospedeiro.querySelector("header")?.textContent).not.toContain(
        "Pago",
      );
    });

    it("pagamento na entrega: o selo também aparece uma vez só", async () => {
      await renderizar(pedidoFake({ paymentMethod: "cash" }));

      expect(hospedeiro.querySelectorAll(".selo-ficha")).toHaveLength(1);
      expect(folhasComTexto("Sem cobrança online")).toHaveLength(1);
    });

    it("o selo vai em LINHA PRÓPRIA no bloco do dinheiro (não divide linha com a frase nem com o total)", async () => {
      await renderizar(pedidoFake({ paymentMethod: "cash" }));

      const selo = porId("bloco-dinheiro")?.querySelector(".selo-ficha");
      const frase = Array.from(
        porId("bloco-dinheiro")?.querySelectorAll("p") ?? [],
      ).find((p) => p.textContent?.includes("Falta receber"));
      expect(selo).not.toBeNull();
      expect(frase).toBeDefined();
      // Frase e selo são irmãos de um contêiner EM COLUNA (sem `flex-wrap`),
      // não vizinhos de linha.
      expect(selo?.parentElement).toBe(frase?.parentElement);
      expect(selo?.parentElement?.className).not.toMatch(/\bflex\b/);
    });

    it("o bloco do dinheiro tem o título 'Pagamento' (h3)", async () => {
      await renderizar(pedidoFake());

      const titulo = porId("bloco-dinheiro")?.querySelector("h3");
      expect(titulo?.textContent).toBe("Pagamento");
      expect(porId("bloco-entrega")?.querySelector("h3")?.textContent).toBe(
        "Entrega",
      );
      expect(porId("bloco-itens")?.querySelector("h3")?.textContent).toBe(
        "Itens do pedido",
      );
    });

    it("'Marcar como recebido' mora no bloco do dinheiro e chama o registro com (id, true)", async () => {
      const onRegistrar = vi.fn().mockResolvedValue(undefined);
      await renderizar(pedidoFake({ paymentMethod: "cash" }), {
        onRegistrarPagamento: onRegistrar,
      });

      const marcar = botao("Marcar como recebido");
      expect(marcar).toBeDefined();
      expect(porId("bloco-dinheiro")?.contains(marcar as Node)).toBe(true);

      await act(async () => {
        marcar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onRegistrar).toHaveBeenCalledWith("ped-redesenho-123456", true);
    });

    it("já recebido: 'Recebido em <data>' + 'Desfazer' no bloco do dinheiro, e Desfazer chama (id, false)", async () => {
      const onRegistrar = vi.fn().mockResolvedValue(undefined);
      await renderizar(
        pedidoFake({
          paymentMethod: "cash",
          pagamentoRecebidoEm: "2026-09-02T10:00:00.000Z",
        }),
        { onRegistrarPagamento: onRegistrar },
      );

      const dinheiro = porId("bloco-dinheiro");
      expect(dinheiro?.textContent).toMatch(/Recebido em/);
      expect(botao("Marcar como recebido")).toBeUndefined();
      const desfazer = botao("Desfazer");
      expect(dinheiro?.contains(desfazer as Node)).toBe(true);
      await act(async () => {
        desfazer?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onRegistrar).toHaveBeenCalledWith("ped-redesenho-123456", false);
    });

    it.each([
      ["pedido cancelado", { status: "cancelled" as const }],
      [
        "pagamento pelo site (a loja não confirma o que o gateway confirma)",
        { paymentMethod: "online" as const, paymentStatus: "pago" as const },
      ],
    ])(
      "some quando `podeRegistrarPagamento` é falso: %s",
      async (_nome, extra) => {
        await renderizar(pedidoFake(extra), {
          onRegistrarPagamento: vi.fn().mockResolvedValue(undefined),
        });

        expect(botao("Marcar como recebido")).toBeUndefined();
        expect(botao("Desfazer")).toBeUndefined();
      },
    );

    it("sem `onRegistrarPagamento` (montagem de teste) o bloco não oferece o botão", async () => {
      await renderizar(pedidoFake({ paymentMethod: "cash" }));

      expect(botao("Marcar como recebido")).toBeUndefined();
    });
  });

  describe("bloco Entrega", () => {
    it("junta nome, WhatsApp e endereço, com 'Copiar endereço' e 'Ver no Maps'", async () => {
      await renderizar(pedidoFake());

      const entrega = porId("bloco-entrega");
      const texto = entrega?.textContent ?? "";
      expect(texto).toContain("Cliente Teste");
      expect(texto).toContain("349998888777");
      expect(texto).toContain("Rua das Flores, 123");
      expect(texto).toContain("Patos de Minas/MG");
      expect(
        entrega?.querySelector('button[title="Copiar Endereço"]'),
      ).not.toBeNull();
      expect(
        entrega?.querySelector('a[title="Ver no Google Maps"]'),
      ).not.toBeNull();
      expect(
        entrega?.querySelector('button[title="Conversar no WhatsApp"]'),
      ).not.toBeNull();
    });

    it("o endereço é legível: sem caixa alta forçada", async () => {
      await renderizar(pedidoFake());

      const entrega = porId("bloco-entrega");
      expect(entrega?.innerHTML).not.toContain("uppercase");
    });

    it("com nota do checkout: 'Como vai: <nome> · <prazo>' ('1 dias' vira '1 dia')", async () => {
      await renderizar(
        pedidoFake({
          notes: "Frete Escolhido: Correios — SEDEX (Prazo: 1 dias)",
        }),
      );

      const linha = porId("forma-de-entrega");
      expect(linha).not.toBeNull();
      expect(linha?.textContent).toContain(
        "Como vai: Correios — SEDEX · 1 dia",
      );
      expect(porId("bloco-entrega")?.contains(linha as Node)).toBe(true);
    });

    it("com duas notas de frete, a ÚLTIMA vence", async () => {
      await renderizar(
        pedidoFake({
          notes:
            "Frete Escolhido: Antigo (Prazo: 9 dias); Frete Escolhido: Loggi Ponto (Prazo: 3 dias)",
        }),
      );

      expect(porId("forma-de-entrega")?.textContent).toContain(
        "Loggi Ponto · 3 dias",
      );
    });

    it("sem nota de frete: a linha 'Como vai' não aparece", async () => {
      await renderizar(pedidoFake({ notes: "Entregar depois das 18h" }));

      expect(porId("forma-de-entrega")).toBeNull();
      expect(hospedeiro.textContent).not.toContain("Como vai:");
    });

    it("retirada na loja: o painel esmeralda continua e a linha diz 'Retirada na loja'", async () => {
      await renderizar(
        pedidoFake({
          retiradaNaLoja: true,
          enderecoDeRetirada: "Rua da Loja, 10",
          notes: "Retirada na loja: Rua da Loja, 10",
        }),
      );

      const painel = hospedeiro.querySelector(
        '[aria-label="Retirada na loja"]',
      );
      expect(painel?.textContent).toContain("Rua da Loja, 10");
      expect(porId("forma-de-entrega")?.textContent).toContain(
        "Como vai: Retirada na loja",
      );
    });
  });

  describe("bloco Itens", () => {
    it("traz a conta do pedido (Subtotal, Frete, Total) e ela SAIU do bloco do dinheiro", async () => {
      await renderizar(pedidoFake({ shipping: 15 }));

      const itens = porId("bloco-itens")?.textContent ?? "";
      expect(itens).toContain("Subtotal");
      expect(itens).toMatch(/R\$\s*100,00/);
      expect(itens).toContain("Frete");
      expect(itens).toMatch(/R\$\s*15,00/);
      expect(itens).toContain("Total");
      expect(itens).toMatch(/R\$\s*115,00/);

      const dinheiro = porId("bloco-dinheiro")?.textContent ?? "";
      expect(dinheiro).not.toContain("Subtotal");
      expect(dinheiro).not.toContain("Frete");
    });

    it("frete zero diz 'Grátis'; desconto e cupom só aparecem quando existem", async () => {
      await renderizar(pedidoFake({ shipping: 0 }));

      let itens = porId("bloco-itens")?.textContent ?? "";
      expect(itens).toContain("Grátis");
      expect(itens).not.toContain("Desconto");

      await renderizar(
        pedidoFake({ shipping: 0, discount: 10, couponCode: "BEMVINDA" }),
      );
      itens = porId("bloco-itens")?.textContent ?? "";
      expect(itens).toContain("Desconto");
      expect(itens).toContain("BEMVINDA");
      expect(itens).toMatch(/-\s*R\$\s*10,00/);
      expect(itens).toMatch(/R\$\s*90,00/);
    });

    it("cupom de valor ZERO (ex.: frete grátis) continua aparecendo: a condição é `discount > 0 || couponCode`", async () => {
      await renderizar(pedidoFake({ discount: 0, couponCode: "FRETEGRATIS" }));

      const itens = porId("bloco-itens")?.textContent ?? "";
      expect(itens).toContain("Desconto");
      expect(itens).toContain("FRETEGRATIS");
    });
  });

  describe("envio em linhas simples", () => {
    it("etiqueta INDISPONÍVEL vira rótulo + motivo cinza; o motivo do sistema aparece INTEIRO e quebra linha (toque não mostra title)", async () => {
      linhaDaEtiqueta.data = {
        id: "ped-redesenho-123456",
        status: "processing",
        payment_status: "pago",
        shipping: 0,
        shipping_cost: null,
        tracking_code: null,
        shipping_label_id: null,
        shipping_label_url: null,
        notes: null,
        shipping_option_id: "local-delivery",
        cpf: null,
      };
      await renderizar(pedidoFake({ status: "processing" }));

      const linha = porId("etiqueta-indisponivel");
      expect(linha).not.toBeNull();
      expect(linha?.textContent).toContain("Etiqueta de envio");
      const motivo =
        "Este pedido foi por entrega local — quem despacha é a própria loja. Não existe etiqueta pela API do Melhor Envio para este caso.";
      const pMotivo = Array.from(linha?.querySelectorAll("p") ?? []).find(
        (p) => p.textContent === motivo,
      );
      // O motivo é o que o SISTEMA devolveu (sem inventar outro), por inteiro...
      expect(pMotivo).toBeDefined();
      // ...sem corte por CSS (truncate/line-clamp) e sem depender de `title`.
      expect(pMotivo?.className).not.toMatch(
        /truncate|line-clamp|whitespace-nowrap/,
      );
      expect(pMotivo?.className).toMatch(/\btext-xs\b|\btext-sm\b/);
      expect(pMotivo?.getAttribute("title")).toBeNull();
      // Sem o aviso âmbar grande de antes.
      expect(hospedeiro.textContent).not.toContain(
        "Etiqueta pelo app indisponível",
      );
      expect(
        document.getElementById("etiqueta-do-pedido")?.innerHTML,
      ).not.toContain("border-amber");
    });

    it("venda de balcão (presencial) não tem linha de etiqueta", async () => {
      await renderizar(pedidoFake({ canal: "presencial" }));

      expect(document.getElementById("etiqueta-do-pedido")).toBeNull();
      expect(hospedeiro.textContent).not.toContain("Etiqueta de envio");
    });

    it("rastreio vazio: linha com 'Adicionar'; tocar abre o campo ali mesmo (mesmo id) e digita em maiúsculas", async () => {
      await renderizar(pedidoFake());

      const lista = porId("envio-lista");
      expect(lista).not.toBeNull();
      expect(lista?.querySelector("#tracking-input")).toBeNull();
      const adicionar = botao("Adicionar rastreio");
      expect(adicionar).toBeDefined();
      expect(lista?.contains(adicionar as Node)).toBe(true);

      await act(async () => {
        adicionar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const campo = lista?.querySelector<HTMLInputElement>("#tracking-input");
      expect(campo).not.toBeNull();

      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(campo),
        "value",
      )?.set;
      await act(async () => {
        setter?.call(campo, "br123");
        campo?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(campo?.value).toBe("BR123");
    });

    it("rastreio preenchido: código em fonte mono + copiar / rastrear / editar", async () => {
      await renderizar(pedidoFake({ trackingCode: "BR123456789BR" }));

      const lista = porId("envio-lista");
      const codigo = Array.from(lista?.querySelectorAll("span") ?? []).find(
        (s) => s.textContent === "BR123456789BR",
      );
      expect(codigo?.className).toContain("font-mono");
      expect(
        lista?.querySelector('button[title="Copiar Código"]'),
      ).not.toBeNull();
      expect(
        lista?.querySelector('a[title="Rastrear nos Correios"]'),
      ).not.toBeNull();
      expect(
        lista?.querySelector('button[title="Editar Código"]'),
      ).not.toBeNull();
    });

    it("anotação vazia: linha com 'Adicionar'; tocar abre o campo ali mesmo (mesmo id)", async () => {
      await renderizar(pedidoFake());

      const lista = porId("envio-lista");
      const adicionar = botao("Adicionar anotação");
      expect(lista?.contains(adicionar as Node)).toBe(true);
      expect(lista?.querySelector("#notes-textarea")).toBeNull();

      await act(async () => {
        adicionar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(lista?.querySelector("#notes-textarea")).not.toBeNull();
    });

    it("anotação preenchida: o texto aparece INTEIRO (observação + variante + frete), sem aspas nem itálico, com as quebras de linha, e 'Editar'", async () => {
      const nota =
        "Entregar depois das 18h\nProduto: Tamanho G\nFrete Escolhido: Correios — SEDEX (Prazo: 2 dias)";
      await renderizar(pedidoFake({ notes: nota }));

      const lista = porId("envio-lista");
      const texto = Array.from(lista?.querySelectorAll("p") ?? []).find((p) =>
        p.textContent?.includes("Entregar depois das 18h"),
      );
      expect(texto).toBeDefined();
      expect(texto?.textContent).toBe(nota);
      expect(texto?.className).toContain("whitespace-pre-line");
      expect(texto?.className).not.toMatch(/italic|truncate|line-clamp/);
      expect(botao("Editar")).toBeDefined();
    });

    it("a linha 'Como vai' lê as anotações LOCAIS: depois de salvar uma anotação sem a frase do frete, ela some em vez de ficar velha", async () => {
      await renderizar(
        pedidoFake({
          notes: "Frete Escolhido: Correios — SEDEX (Prazo: 2 dias)",
        }),
      );
      expect(porId("forma-de-entrega")).not.toBeNull();

      await act(async () => {
        botao("Editar")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      const campo =
        hospedeiro.querySelector<HTMLTextAreaElement>("#notes-textarea");
      expect(campo).not.toBeNull();
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(campo),
        "value",
      )?.set;
      await act(async () => {
        setter?.call(campo, "Só uma observação nova");
        campo?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        botao("Salvar")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(hospedeiro.textContent).toContain("Só uma observação nova");
      expect(porId("forma-de-entrega")).toBeNull();
    });
  });

  describe("visual", () => {
    // Régua de aparência da ficha: nenhuma letra abaixo de 12px, nada em caixa
    // alta espaçada, sem "vidro" pesado e NENHUMA classe `print:` (a impressão
    // esconde a ficha por `body * { visibility: hidden }` e mostra só o
    // recibo — ver OrderReceipt.tsx).
    function infratoresDeVisual(): string[] {
      const folha = hospedeiro.querySelector(".min-h-screen");
      expect(folha).not.toBeNull();
      const infratores: string[] = [];
      for (const el of Array.from(folha?.querySelectorAll("*") ?? [])) {
        // O recibo (só na impressão) e os selos de status (componente
        // compartilhado, não editado aqui) ficam de fora da régua.
        if (el.closest(".print\\:block") || el.closest(".selo-ficha")) continue;
        const classe = el.getAttribute("class") ?? "";
        if (
          /text-\[(?:\d|1[01])(?:\.5)?px\]/.test(classe) ||
          /\btracking-\[0\.2em\]/.test(classe) ||
          /\badmin-glass\b/.test(classe) ||
          /(?:^|\s)print:/.test(classe) ||
          (/\buppercase\b/.test(classe) && el.tagName !== "INPUT")
        ) {
          infratores.push(`${el.tagName.toLowerCase()}.${classe}`);
        }
      }
      return infratores;
    }

    const linhaDe = (over: Record<string, unknown>) => ({
      id: "ped-redesenho-123456",
      status: "processing",
      payment_status: "pago",
      shipping: 0,
      shipping_cost: null,
      tracking_code: null,
      shipping_label_id: null,
      shipping_label_url: null,
      notes: null,
      shipping_option_id: "melhor-envio-3",
      cpf: "52998224725",
      ...over,
    });

    const pedidoCompleto = () =>
      pedidoFake({
        status: "processing",
        paymentMethod: "online",
        paymentStatus: "pago",
        trackingCode: "BR123456789BR",
        notes: "Frete Escolhido: Correios — SEDEX (Prazo: 2 dias)",
      });

    it.each([
      ["etiqueta disponível", {}],
      [
        "etiqueta emitida",
        {
          shipping_label_id: "lbl-1",
          shipping_label_url: "https://x.test/e.pdf",
        },
      ],
      ["etiqueta pede CPF", { cpf: null }],
      ["etiqueta indisponível", { shipping_option_id: "local-delivery" }],
    ])("régua de aparência: %s", async (_nome, over) => {
      linhaDaEtiqueta.data = linhaDe(over);
      await renderizar(pedidoCompleto());

      expect(infratoresDeVisual()).toEqual([]);
    });

    it("régua de aparência: etiqueta com a confirmação de compra aberta", async () => {
      linhaDaEtiqueta.data = linhaDe({});
      await renderizar(pedidoCompleto());
      await act(async () => {
        botao("Gerar etiqueta")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      expect(botao("Confirmar e gerar")).toBeDefined();

      expect(infratoresDeVisual()).toEqual([]);
    });

    it("régua de aparência: pedido cancelado, entregue e com campos de edição abertos", async () => {
      await renderizar(pedidoFake({ status: "cancelled" }));
      expect(infratoresDeVisual()).toEqual([]);

      await renderizar(pedidoFake({ status: "delivered" }));
      expect(infratoresDeVisual()).toEqual([]);

      await renderizar(pedidoFake({ status: "processing" }));
      await act(async () => {
        botao("Adicionar rastreio")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        botao("Adicionar anotação")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      expect(hospedeiro.querySelector("#tracking-input")).not.toBeNull();
      expect(hospedeiro.querySelector("#notes-textarea")).not.toBeNull();
      expect(infratoresDeVisual()).toEqual([]);
    });

    it("a barra de ação é filha direta da folha, sticky, de fundo opaco, com botão principal de 44px (h-11) e sem caixa alta", async () => {
      await renderizar(pedidoFake({ status: "pending" }));

      const avancar = botao("Avançar →");
      expect(avancar?.className).toMatch(/\bh-11\b/);
      expect(avancar?.className).not.toContain("uppercase");
      const cancelar = hospedeiro.querySelector<HTMLButtonElement>(
        'button[title="Cancelar pedido"]',
      );
      expect(cancelar?.className).toMatch(/\bh-11\b/);
      expect(cancelar?.className).not.toContain("uppercase");

      const barra = avancar?.closest("div.sticky");
      const folha = hospedeiro.querySelector("div.min-h-screen");
      expect(barra?.parentElement).toBe(folha);
      expect(barra?.className).not.toMatch(/bg-admin-bg\/\d+/);
      expect(barra?.className).toContain("bg-admin-bg");
    });
  });
});
