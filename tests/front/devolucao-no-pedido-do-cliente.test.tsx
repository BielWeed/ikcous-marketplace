// @vitest-environment jsdom
//
// Devolução/troca na tela do pedido do CLIENTE (OrderDetailsView): a linha
// "Solicitar devolução ou troca" só existe com pedido ENTREGUE, cliente
// logado e `devolucao_elegibilidade.pode`; sem poder (e sem devolução
// ainda), o motivo aparece discreto; com devolução, o cartão dela aparece.
// Convidado e pedido não entregue nem chegam a perguntar ao servidor.
//
// Molde de montagem: order-details-cartao-de-avaliacao-em-destaque.test.tsx.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { fetchUserOrders, updateOrderStatus, rpc, respostas } = vi.hoisted(
  () => ({
    fetchUserOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    rpc: vi.fn(),
    respostas: new Map<string, unknown>(),
  }),
);

const pedidoBase: Order = {
  id: "pedido-dev",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    { productId: "p-1", name: "Tênis", price: 100, quantity: 1, image: "" },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoBase;
let usuarioAtual: { id: string } | null = { id: "u-1" };

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders,
    updateOrderStatus,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: false,
      whatsappNumber: "34999999999",
      storeAddress: "Rua A, 10",
      businessHours: "Seg a Sex, 9h às 18h",
    },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    rpc,
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POLITICA = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
};

function elegibilidade(extra: Record<string, unknown> = {}) {
  return {
    pode: true,
    motivo_bloqueio: null,
    entregue_em: "2026-09-24T15:00:00Z",
    dias_desde_entrega: 2,
    modalidade: "local",
    metodos: ["entrega_na_loja"],
    prazos: {
      arrependimento_ate: "2026-10-01",
      troca_ate: "2026-10-24",
      vicio_ate: "2026-12-23",
    },
    janelas: { arrependimento: true, troca: true, vicio: true },
    itens: [
      {
        order_item_id: "oi-1",
        product_id: "p-1",
        product_name: "Tênis",
        image_url: null,
        quantidade: 1,
        ja_devolvida: 0,
        disponivel: 1,
        valor_unitario: 100,
      },
    ],
    politica: POLITICA,
    ...extra,
  };
}

const DETALHE = {
  id: "d-1",
  protocolo: "DV260926-ABCDE",
  order_id: "pedido-dev",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "reembolso",
  resolucao_final: null,
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "aprovada",
  valor_itens: 100,
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: null,
  codigo_postagem: null,
  etiqueta_url: null,
  coleta_em: null,
  mensagem_loja: "Traga com a etiqueta, por favor.",
  observacao_inspecao: null,
  entregue_em: "2026-09-24T15:00:00Z",
  prazo_ate: "2026-10-01",
  politica: POLITICA,
  created_at: "2026-09-26T10:00:00Z",
  aprovada_em: "2026-09-26T11:00:00Z",
  itens: [
    {
      id: "di-1",
      order_item_id: "oi-1",
      product_name: "Tênis",
      quantidade: 1,
      valor_unitario: 100,
    },
  ],
  eventos: [],
  pedido: null,
};

function eventoDeGeracao(created_at: string) {
  const servidor = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../supabase/functions/melhor-envio-etiqueta/index.ts",
    ),
    "utf8",
  );
  const nota = /const NOTA_CODIGO_DE_POSTAGEM_GERADO = '([^']+)'/.exec(
    servidor,
  )?.[1];
  if (!nota) throw new Error("Nota de geração não encontrada no servidor.");
  return { para_status: "aprovada", ator: "sistema", nota, created_at };
}

const ORIENTACAO_AO_CONVIDADO =
  "Para devolução ou troca, fale com a loja informando o número do pedido.";
const AVISO_CODIGO_VENCIDO =
  "Este código de postagem venceu. Fale com a loja para gerar outro.";

describe("OrderDetailsView — devolução ou troca do produto entregue", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    fetchUserOrders.mockReset();
    updateOrderStatus.mockReset();
    rpc.mockReset();
    respostas.clear();
    respostas.set("devolucao_elegibilidade", elegibilidade());
    respostas.set("devolucoes_do_pedido", []);
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
    pedidoAtual = pedidoBase;
    usuarioAtual = { id: "u-1" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  async function renderizar() {
    fetchUserOrders.mockResolvedValue([pedidoAtual]);
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-dev"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  async function mostrarDevolucao(campos: Record<string, unknown>) {
    const detalhe = { ...DETALHE, ...campos };
    respostas.set("devolucoes_do_pedido", [detalhe]);
    respostas.set("devolucao_detalhe", detalhe);
    await renderizar();
    const cartao = hospedeiro.querySelector('[data-testid="cartao-devolucao"]');
    expect(cartao).not.toBeNull();
    return cartao;
  }

  const botaoPedir = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      '[data-testid="acao-solicitar-devolucao"]',
    );
  const nomesDasRpcs = () => rpc.mock.calls.map((c) => c[0]);

  it("entregue + logado + elegível: a linha 'Solicitar devolução ou troca' aparece", async () => {
    await renderizar();

    expect(botaoPedir()?.textContent).toContain("Solicitar devolução ou troca");
    expect(hospedeiro.textContent).not.toContain(ORIENTACAO_AO_CONVIDADO);
    expect(rpc).toHaveBeenCalledWith("devolucao_elegibilidade", {
      p_order_id: "pedido-dev",
    });
  });

  it("tocar na linha abre a folha do pedido de devolução", async () => {
    await renderizar();
    await act(async () => {
      botaoPedir()?.click();
    });
    const folha = document.querySelector('[data-testid="folha-devolucao"]');
    expect(folha?.textContent).toContain("O que vai voltar?");
  });

  it("pedido ainda a caminho: nem linha nem pergunta ao servidor", async () => {
    pedidoAtual = { ...pedidoBase, status: "shipping" };
    await renderizar();

    expect(botaoPedir()).toBeNull();
    expect(nomesDasRpcs()).not.toContain("devolucao_elegibilidade");
  });

  it("convidado com pedido entregue recebe orientação, sem abrir devolução no app", async () => {
    usuarioAtual = null;
    await renderizar();

    expect(hospedeiro.textContent).toContain(ORIENTACAO_AO_CONVIDADO);
    expect(
      [...hospedeiro.querySelectorAll("button")].some(
        (botao) => botao.textContent?.trim() === "Falar com a loja",
      ),
    ).toBe(true);
    expect(botaoPedir()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("convidado com pedido a caminho não vê orientação de devolução", async () => {
    usuarioAtual = null;
    pedidoAtual = { ...pedidoBase, status: "shipping" };
    await renderizar();

    expect(hospedeiro.textContent).not.toContain(ORIENTACAO_AO_CONVIDADO);
    expect(botaoPedir()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  describe("validade do código de postagem", () => {
    const camposDaReversa = {
      modalidade: "nacional",
      metodo_retorno: "etiqueta_reversa",
      codigo_postagem: "PP123456789BR",
      etiqueta_url: "https://example.com/etiqueta.pdf",
    };

    it("exibe o prazo da reemissão em Brasília, não o do primeiro código", async () => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-07T01:30:00Z"));
      const nova = eventoDeGeracao("2026-09-30T01:30:00Z");
      const antiga = eventoDeGeracao("2026-09-26T10:00:00Z");
      const cartao = await mostrarDevolucao({
        ...camposDaReversa,
        eventos: [
          antiga,
          nova,
          { ...nova, nota: "Outro evento", created_at: "2026-10-02T12:00:00Z" },
        ],
      });

      expect(cartao?.textContent).toContain(
        "válido até 06/10 às 22:30 (horário de Brasília)",
      );
      expect(cartao?.textContent).not.toContain("em até 7 dias");
      expect(cartao?.textContent).not.toContain(AVISO_CODIGO_VENCIDO);
    });

    it.each([
      ["com", camposDaReversa.etiqueta_url],
      ["sem", null],
    ])(
      "avisa que venceu %s declaração pronta, sem orientar a postar",
      async (_, etiqueta_url) => {
        vi.spyOn(Date, "now").mockReturnValue(
          Date.parse("2026-10-07T01:30:00.001Z"),
        );
        const cartao = await mostrarDevolucao({
          ...camposDaReversa,
          etiqueta_url,
          eventos: [eventoDeGeracao("2026-09-30T01:30:00Z")],
        });

        expect(cartao?.textContent).toContain(AVISO_CODIGO_VENCIDO);
        expect(cartao?.textContent).not.toContain("leve o pacote");
        expect(cartao?.textContent).not.toContain("vale a pena esperar");
        expect(cartao?.textContent).not.toContain("válido até");
      },
    );

    it("mostra a validade mesmo enquanto a declaração ainda está em preparo", async () => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-01T12:00:00Z"));
      const cartao = await mostrarDevolucao({
        ...camposDaReversa,
        etiqueta_url: null,
        eventos: [eventoDeGeracao("2026-09-30T01:30:00Z")],
      });

      expect(cartao?.textContent).toContain(
        "válido até 06/10 às 22:30 (horário de Brasília)",
      );
      expect(cartao?.textContent).toContain("A loja está preparando");
    });

    it.each([
      ["sem o evento", []],
      ["com data ilegível", [eventoDeGeracao("sem-data")]],
    ])("%s: não inventa validade nem vencimento", async (_, eventos) => {
      const cartao = await mostrarDevolucao({ ...camposDaReversa, eventos });

      expect(cartao?.textContent).toContain("em até 7 dias");
      expect(cartao?.textContent).not.toContain("válido até");
      expect(cartao?.textContent).not.toContain(AVISO_CODIGO_VENCIDO);
    });
  });

  it("identifica só o item não recebido e preserva os preços e o reembolso", async () => {
    const cartao = await mostrarDevolucao({
      status: "concluida",
      resolucao_final: "reembolso",
      reembolso_manual: true,
      valor_itens: 100,
      valor_reembolso: 70,
      itens: [
        {
          id: "i-1",
          order_item_id: "oi-1",
          product_name: "Tênis",
          quantidade: 1,
          valor_unitario: 30,
          condicao: "ausente",
        },
        {
          id: "i-2",
          order_item_id: "oi-2",
          product_name: "Sandália",
          quantidade: 1,
          valor_unitario: 40,
          condicao: "usada",
        },
        {
          id: "i-3",
          order_item_id: "oi-3",
          product_name: "Bota",
          quantidade: 1,
          valor_unitario: 30,
          condicao: "danificada",
        },
      ],
    });
    const termos = [...(cartao?.querySelectorAll("dt") ?? [])];
    const termo = (nome: string) =>
      termos.find((linha) => linha.textContent?.includes(nome));

    expect(termo("Tênis")?.textContent).toContain("Não recebido pela loja");
    expect(termo("Sandália")?.textContent).toBe("1× Sandália");
    expect(termo("Bota")?.textContent).toBe("1× Bota");
    for (const [nome, valor] of [
      ["Tênis", /R\$\s*30,00/],
      ["Sandália", /R\$\s*40,00/],
      ["Bota", /R\$\s*30,00/],
      ["Reembolso", /R\$\s*70,00/],
    ] as const) {
      expect(termo(nome)?.nextElementSibling?.textContent).toMatch(valor);
    }
  });

  it("sem poder e sem devolução ainda: o motivo do servidor aparece discreto", async () => {
    respostas.set(
      "devolucao_elegibilidade",
      elegibilidade({
        pode: false,
        motivo_bloqueio:
          "O prazo para devolução ou troca deste pedido terminou.",
        janelas: { arrependimento: false, troca: false, vicio: false },
      }),
    );
    await renderizar();

    expect(botaoPedir()).toBeNull();
    expect(
      hospedeiro.querySelector('[data-testid="devolucao-indisponivel"]')
        ?.textContent,
    ).toContain("O prazo para devolução ou troca deste pedido terminou.");
  });

  it("com devolução em andamento: o cartão mostra protocolo, instrução e a mensagem da loja", async () => {
    respostas.set(
      "devolucao_elegibilidade",
      elegibilidade({
        pode: false,
        motivo_bloqueio:
          "Já existe uma devolução em andamento para este pedido.",
      }),
    );
    respostas.set("devolucoes_do_pedido", [
      {
        id: "d-1",
        protocolo: "DV260926-ABCDE",
        status: "aprovada",
        tipo: "arrependimento",
        resolucao_desejada: "reembolso",
        metodo_retorno: "entrega_na_loja",
        valor_itens: 100,
        created_at: "2026-09-26T10:00:00Z",
      },
    ]);
    respostas.set("devolucao_detalhe", DETALHE);
    await renderizar();

    const cartao = hospedeiro.querySelector('[data-testid="cartao-devolucao"]');
    expect(cartao?.textContent).toContain("DV260926-ABCDE");
    expect(cartao?.textContent).toContain("Devolução aprovada");
    expect(cartao?.textContent).toContain(
      "Leve o produto até a loja: Rua A, 10.",
    );
    expect(cartao?.textContent).toContain("Rua A, 10");
    expect(cartao?.textContent).toContain("Traga com a etiqueta, por favor.");
    expect(cartao?.textContent).toContain("Cancelar devolução");
    expect(rpc).toHaveBeenCalledWith("devolucao_detalhe", { p_id: "d-1" });
    // Já tem devolução: nem a linha de pedir, nem o motivo de bloqueio.
    expect(botaoPedir()).toBeNull();
    expect(
      hospedeiro.querySelector('[data-testid="devolucao-indisponivel"]'),
    ).toBeNull();
  });

  // Reembolso e vale concluídos já têm prova da orientação nos testes de
  // regras puras/reembolso-r1. Aqui ficam os outros ramos terminais.
  describe.each([
    ["recusada", null, "A loja não aprovou esta devolução."],
    ["cancelada", null, "Você cancelou esta devolução."],
    ["reprovada", null, "O produto não foi aceito na inspeção da loja."],
    [
      "concluida",
      "troca",
      "A troca foi confirmada. A loja combina com você a entrega do novo produto.",
    ],
  ])("cartão terminal %s", (status, resolucao_final, orientacao) => {
    it.each(["entrega_na_loja", "coleta", "envio_proprio", "etiqueta_reversa"])(
      "%s: orienta sem mandar entregar ou postar o produto",
      async (metodo_retorno) => {
        const detalhe = {
          ...DETALHE,
          status,
          resolucao_final,
          metodo_retorno,
          mensagem_loja: null,
          codigo_postagem: "PP123456789BR",
          etiqueta_url: "https://example.com/etiqueta.pdf",
          coleta_em: "2026-10-01T15:00:00Z",
        };
        respostas.set("devolucoes_do_pedido", [detalhe]);
        respostas.set("devolucao_detalhe", detalhe);
        await renderizar();

        const cartao = hospedeiro.querySelector(
          '[data-testid="cartao-devolucao"]',
        );
        expect(cartao).not.toBeNull();
        expect(cartao?.textContent).toContain(orientacao);
        // Frases reais dos métodos aprovados, inclusive coleta e DC-e.
        for (const instrucaoDeEntrega of [
          "Leve o produto até a loja",
          "A loja vai buscar o produto",
          "A loja vai combinar com você o dia e o horário da coleta",
          "A loja está gerando o código de postagem dos Correios",
          "Imprima a declaração de conteúdo",
          "A loja está preparando a declaração de conteúdo",
          "Embale o produto, poste nos Correios",
          "Envie para:",
          "Peça o endereço de envio à loja",
          "Já postou? Informe o código de rastreio",
          "Código de postagem (também é o rastreio)",
        ]) {
          expect(cartao?.textContent).not.toContain(instrucaoDeEntrega);
        }
        expect(cartao?.textContent).not.toMatch(/\b(leve|entregue)\b/i);
        expect(cartao?.querySelector("form, input")).toBeNull();
        const acoes = [...(cartao?.querySelectorAll("button, a") ?? [])].map(
          (acao) => acao.textContent?.trim(),
        );
        expect(acoes).not.toEqual(expect.arrayContaining(["Enviar"]));
        expect(acoes).not.toEqual(expect.arrayContaining(["Etiqueta"]));
        expect(acoes).not.toEqual(
          expect.arrayContaining(["Já postei o pacote"]),
        );
        expect(acoes).not.toEqual(
          expect.arrayContaining(["Cancelar devolução"]),
        );
      },
    );
  });

  it("envio próprio aprovado: o cartão diz para onde mandar o pacote", async () => {
    respostas.set(
      "devolucao_elegibilidade",
      elegibilidade({
        pode: false,
        motivo_bloqueio:
          "Já existe uma devolução em andamento para este pedido.",
      }),
    );
    respostas.set("devolucoes_do_pedido", [
      {
        id: "d-1",
        protocolo: "DV260926-ABCDE",
        status: "aprovada",
        tipo: "arrependimento",
        resolucao_desejada: "reembolso",
        metodo_retorno: "envio_proprio",
        valor_itens: 100,
        created_at: "2026-09-26T10:00:00Z",
      },
    ]);
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      modalidade: "nacional",
      metodo_retorno: "envio_proprio",
    });
    await renderizar();

    const cartao = hospedeiro.querySelector('[data-testid="cartao-devolucao"]');
    expect(cartao?.textContent).toContain("Envie para: Rua A, 10");
  });

  // A política gravada na devolução é cópia do dia do pedido; a loja pode ter
  // corrigido o endereço depois. A cliente vê o endereço de HOJE.
  it("a loja corrigiu o endereço depois do pedido: o cartão mostra o novo, não a cópia velha", async () => {
    respostas.set(
      "devolucao_elegibilidade",
      elegibilidade({
        pode: false,
        motivo_bloqueio:
          "Já existe uma devolução em andamento para este pedido.",
        politica: { ...POLITICA, endereco_devolucao: "Rua Nova, 99" },
      }),
    );
    respostas.set("devolucoes_do_pedido", [
      {
        id: "d-1",
        protocolo: "DV260926-ABCDE",
        status: "aprovada",
        tipo: "arrependimento",
        resolucao_desejada: "reembolso",
        metodo_retorno: "envio_proprio",
        valor_itens: 100,
        created_at: "2026-09-26T10:00:00Z",
      },
    ]);
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      modalidade: "nacional",
      metodo_retorno: "envio_proprio",
      politica: { ...POLITICA, endereco_devolucao: "Rua Velha, 1" },
    });
    await renderizar();

    const cartao = hospedeiro.querySelector('[data-testid="cartao-devolucao"]');
    expect(cartao?.textContent).toContain("Envie para: Rua Nova, 99");
    expect(cartao?.textContent).not.toContain("Rua Velha, 1");
  });

  it("a loja passou a usar o endereço da própria loja: o cartão não prende a cópia velha", async () => {
    respostas.set(
      "devolucao_elegibilidade",
      elegibilidade({
        pode: false,
        motivo_bloqueio:
          "Já existe uma devolução em andamento para este pedido.",
        politica: { ...POLITICA, endereco_devolucao: null },
      }),
    );
    respostas.set("devolucoes_do_pedido", [
      {
        id: "d-1",
        protocolo: "DV260926-ABCDE",
        status: "aprovada",
        tipo: "arrependimento",
        resolucao_desejada: "reembolso",
        metodo_retorno: "envio_proprio",
        valor_itens: 100,
        created_at: "2026-09-26T10:00:00Z",
      },
    ]);
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      modalidade: "nacional",
      metodo_retorno: "envio_proprio",
      politica: { ...POLITICA, endereco_devolucao: "Rua Velha, 1" },
    });
    await renderizar();

    const cartao = hospedeiro.querySelector('[data-testid="cartao-devolucao"]');
    expect(cartao?.textContent).toContain("Envie para: Rua A, 10");
    expect(cartao?.textContent).not.toContain("Rua Velha, 1");
  });

  it("devolução em trânsito com código: 'Rastrear devolução' leva ao Melhor Rastreio, sem espaços", async () => {
    respostas.set(
      "devolucao_elegibilidade",
      elegibilidade({
        pode: false,
        motivo_bloqueio:
          "Já existe uma devolução em andamento para este pedido.",
      }),
    );
    respostas.set("devolucoes_do_pedido", [
      {
        id: "d-1",
        protocolo: "DV260926-ABCDE",
        status: "em_transito",
        tipo: "arrependimento",
        resolucao_desejada: "reembolso",
        metodo_retorno: "etiqueta_reversa",
        valor_itens: 100,
        created_at: "2026-09-26T10:00:00Z",
      },
    ]);
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      status: "em_transito",
      metodo_retorno: "etiqueta_reversa",
      codigo_rastreio: "pp 123 456 789 br",
    });
    await renderizar();

    const link = [...hospedeiro.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Rastrear devolução"),
    );
    expect(link?.getAttribute("href")).toBe(
      "https://www.melhorrastreio.com.br/rastreio/PP123456789BR",
    );
  });

  // Achado 2 (rodada 6c, revisão de risco): `devolucao_detalhe` NÃO é
  // admin-only — o dono da devolução também lê (RLS de `devolucoes` dá
  // SELECT ao dono, e a RPC aceita `v_d.user_id = auth.uid() OR
  // is_admin()`), então `me_reverse_id` chega ao objeto parseado do CLIENTE
  // também desde a migration 75 (achado 1, rodada 6b, só passou a ENTRAR no
  // tipo/leitor). Isso não é o achado — o id sozinho não dá acesso a nada no
  // Melhor Envio. O que este teste prende é que o CARTÃO do cliente
  // (`DevolucaoDoPedidoCard`, via `useDevolucaoCliente`) nunca RENDERIZA
  // esse id — a ação de destravar o vínculo preso é só do painel do lojista
  // (`AcoesDaDevolucao`, `podeLiberarVinculoReverso`).
  it("achado 2 (rodada 6c): o cartão do cliente NUNCA mostra o me_reverse_id, mesmo com um vínculo real preso (mesma condição que liberaria o painel)", async () => {
    respostas.set(
      "devolucao_elegibilidade",
      elegibilidade({
        pode: false,
        motivo_bloqueio:
          "Já existe uma devolução em andamento para este pedido.",
      }),
    );
    respostas.set("devolucoes_do_pedido", [
      {
        id: "d-1",
        protocolo: "DV260926-ABCDE",
        status: "aprovada",
        tipo: "arrependimento",
        resolucao_desejada: "reembolso",
        metodo_retorno: "etiqueta_reversa",
        valor_itens: 100,
        created_at: "2026-09-26T10:00:00Z",
      },
    ]);
    const ID_QUE_NAO_PODE_APARECER = "me-rev-nao-deve-aparecer-na-tela";
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      metodo_retorno: "etiqueta_reversa",
      codigo_postagem: null,
      me_reverse_id: ID_QUE_NAO_PODE_APARECER,
    });
    await renderizar();

    const cartao = hospedeiro.querySelector('[data-testid="cartao-devolucao"]');
    expect(cartao).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain(ID_QUE_NAO_PODE_APARECER);
    expect(
      hospedeiro.querySelector('[data-testid="liberar-vinculo-reverso"]'),
    ).toBeNull();
  });
});
