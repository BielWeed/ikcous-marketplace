// @vitest-environment jsdom
//
// Tela de Devoluções do painel (AdminDevolucoesView): da lista à ficha e à
// CONCLUSÃO. A regra que este arquivo prende é a do dinheiro: quando
// `admin_devolucao_concluir` devolve `refund_id` (pedido pago pelo app), o
// front aciona a edge `estornar-pagamento` com `{refund_id}` — o mesmo
// caminho do EstornoCard; se a edge falhar, o aviso diz que o reembolso
// ficou na fila (o cron executa em até 10 min). Reembolso manual não chama
// edge nenhuma e manda o lojista devolver em mãos/PIX. Prova também o Voltar
// do aparelho fechando a ficha e o `onSetDirty` do formulário.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke, createSignedUrl, toast, respostas } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  createSignedUrl: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
  respostas: new Map<string, unknown>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    functions: { invoke },
    storage: { from: () => ({ createSignedUrl }) },
  },
}));

vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: "d-1",
  protocolo: "DV260926-ABCDE",
  order_id: "o-1",
  cliente_nome: "Maria",
  cliente_whatsapp: "34999999999",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  status: "recebida",
  resolucao_desejada: "reembolso",
  metodo_retorno: "envio_proprio",
  modalidade: "nacional",
  valor_itens: 199.8,
  prazo_ate: "2026-10-01",
  created_at: "2026-09-26T10:00:00Z",
};

const DETALHE = {
  ...LINHA,
  detalhe: "Ficou apertado.",
  resolucao_final: null,
  valor_frete_ida: 20,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: ["u-1/o-1/a.jpg"],
  codigo_rastreio: "AB123456789BR",
  codigo_postagem: null,
  etiqueta_url: null,
  me_reverse_id: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-09-24T15:00:00Z",
  politica: null,
  aprovada_em: "2026-09-26T11:00:00Z",
  postada_em: "2026-09-26T12:00:00Z",
  recebida_em: "2026-09-27T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [
    {
      id: "di-1",
      order_item_id: "oi-1",
      product_id: "p-1",
      variant_id: null,
      product_name: "Tênis",
      image_url: null,
      quantidade: 2,
      valor_unitario: 99.9,
      condicao: null,
      reestocar: null,
      reestocado_em: null,
    },
  ],
  eventos: [
    {
      id: 1,
      de_status: null,
      para_status: "solicitada",
      ator: "cliente",
      nota: null,
      created_at: "2026-09-26T10:00:00Z",
    },
  ],
  pedido: {
    id: "o-1",
    total: 219.8,
    shipping: 20,
    payment_method: "online",
    payment_status: "pago",
    canal: "online",
    customer_name: "Maria",
    whatsapp: "34999999999",
    shipping_label_id: null,
    shipping_option_id: null,
  },
};

const onNavigate = vi.fn();
const onSetDirty = vi.fn();
const onSetBackOverride = vi.fn();

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  respostas.clear();
  respostas.set("admin_devolucoes_listar", {
    total: 1,
    contagem: { recebida: 1 },
    itens: [LINHA],
  });
  respostas.set("devolucao_detalhe", DETALHE);
  respostas.set("admin_devolucao_concluir", {
    id: "d-1",
    status: "concluida",
    resolucao: "reembolso",
    valor_reembolso: 219.8,
    refund_id: "ref-1",
    reembolso_manual: false,
    reestocados: 2,
  });
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
  );
  invoke.mockResolvedValue({ data: { ok: true }, error: null });
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://assinada/a.jpg" },
    error: null,
  });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  document.body.className = "";
  vi.unstubAllGlobals();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

async function montar() {
  const { AdminDevolucoesView } = await import(
    "@/views/admin/AdminDevolucoesView"
  );
  await act(async () => {
    raiz.render(
      <AdminDevolucoesView
        onNavigate={onNavigate}
        active
        onSetDirty={onSetDirty}
        onSetBackOverride={onSetBackOverride}
      />,
    );
  });
  await drenar();
}

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}

async function abrirEConcluirComoNova() {
  await montar();
  await clicar(hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]'));
  expect(
    hospedeiro.querySelector('[data-testid="detalhe-devolucao"]'),
  ).not.toBeNull();
  await clicar(botao("Concluir"));
  await clicar(botao("Nova, sem uso"));
  await clicar(botao("Concluir devolução"));
}

describe("AdminDevolucoesView — concluir e devolver o dinheiro", () => {
  it("lista com chips de contagem, ficha com foto assinada e trilha", async () => {
    await montar();

    expect(rpc).toHaveBeenCalledWith(
      "admin_devolucoes_listar",
      expect.objectContaining({ p_status: null, p_busca: null }),
    );
    const lista = hospedeiro.querySelector('[data-testid="lista-devolucoes"]');
    expect(lista?.textContent).toContain("DV260926-ABCDE");
    expect(lista?.textContent).toContain("Maria");
    expect(hospedeiro.textContent).toContain("Recebidas1");

    await clicar(
      hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]'),
    );
    const ficha = hospedeiro.querySelector('[data-testid="detalhe-devolucao"]');
    expect(ficha?.textContent).toContain("Ficou apertado.");
    expect(createSignedUrl).toHaveBeenCalledWith("u-1/o-1/a.jpg", 600);
    expect(
      ficha?.querySelector('img[src="https://assinada/a.jpg"]'),
    ).not.toBeNull();
    expect(ficha?.textContent).toContain("Histórico");
  });

  it("refund_id na resposta: chama estornar-pagamento com o refund_id, depois da RPC", async () => {
    await abrirEConcluirComoNova();

    expect(globalThis.confirm).toHaveBeenCalledWith(
      expect.stringContaining("pelo Mercado Pago"),
    );
    expect(rpc).toHaveBeenCalledWith("admin_devolucao_concluir", {
      p_id: "d-1",
      p_resolucao: "reembolso",
      p_itens: [{ item_id: "di-1", condicao: "nova", reestocar: true }],
      // Padrão: itens + frete de ida (o pedido voltou inteiro).
      p_valor_reembolso: 219.8,
      p_observacao: null,
    });
    expect(invoke).toHaveBeenCalledWith("estornar-pagamento", {
      body: { refund_id: "ref-1" },
    });
    const ordemRpc =
      rpc.mock.invocationCallOrder[
        rpc.mock.calls.findIndex((c) => c[0] === "admin_devolucao_concluir")
      ];
    expect(ordemRpc).toBeLessThan(invoke.mock.invocationCallOrder[0]);
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("enviado ao Mercado Pago"),
    );
  });

  it("edge falhou: o reembolso fica na fila e o aviso diz isso (sem erro vermelho)", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("503") });
    await abrirEConcluirComoNova();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("acionado em até 10 minutos"),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reembolso manual: nenhuma edge, e o lojista é mandado devolver em mãos/PIX", async () => {
    respostas.set("admin_devolucao_concluir", {
      id: "d-1",
      status: "concluida",
      resolucao: "reembolso",
      valor_reembolso: 219.8,
      refund_id: null,
      reembolso_manual: true,
      reestocados: 0,
    });
    await abrirEConcluirComoNova();

    expect(invoke).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("em mãos ou por PIX"),
      expect.anything(),
    );
  });

  it("o card da ficha do pedido abre AQUELA devolução na tela de Devoluções", async () => {
    respostas.set("devolucoes_do_pedido", [
      {
        id: "d-1",
        protocolo: "DV260926-ABCDE",
        status: "solicitada",
        tipo: "arrependimento",
        resolucao_desejada: "reembolso",
        metodo_retorno: "envio_proprio",
        valor_itens: 199.8,
        created_at: "2026-09-26T10:00:00Z",
      },
    ]);
    const { DevolucaoDoPedidoAdminCard } = await import(
      "@/components/admin/orders/DevolucaoDoPedidoAdminCard"
    );
    const onAbrirDevolucoes = vi.fn();
    await act(async () => {
      raiz.render(
        <DevolucaoDoPedidoAdminCard
          orderId="o-1"
          onAbrirDevolucoes={onAbrirDevolucoes}
        />,
      );
    });
    await drenar();

    const card = hospedeiro.querySelector(
      '[data-testid="devolucao-do-pedido-admin"]',
    );
    expect(card?.textContent).toContain("Aguardando a sua resposta");
    await clicar(card?.querySelector("button"));
    expect(onAbrirDevolucoes).toHaveBeenCalledTimes(1);

    // A tela de Devoluções nasce com a ficha pedida já aberta.
    await montar();
    expect(
      hospedeiro.querySelector('[data-testid="detalhe-devolucao"]'),
    ).not.toBeNull();
    expect(rpc).toHaveBeenCalledWith("devolucao_detalhe", { p_id: "d-1" });
  });

  it("sem condição do item, não chama a RPC e explica", async () => {
    await montar();
    await clicar(
      hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]'),
    );
    await clicar(botao("Concluir"));
    await clicar(botao("Concluir devolução"));

    expect(
      rpc.mock.calls.some((c) => c[0] === "admin_devolucao_concluir"),
    ).toBe(false);
    expect(hospedeiro.textContent).toContain(
      "Informe a condição de cada item recebido.",
    );
  });

  it("formulário tocado liga onSetDirty; o Voltar do aparelho fecha a ficha", async () => {
    await montar();
    await clicar(
      hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]'),
    );
    await clicar(botao("Concluir"));
    await clicar(botao("Nova, sem uso"));
    expect(onSetDirty).toHaveBeenLastCalledWith(true);

    const registro = onSetBackOverride.mock.calls
      .map((c) => c[0])
      .filter((f): f is () => () => void => typeof f === "function")
      .at(-1);
    expect(registro).toBeTruthy();
    // Com rascunho, o Voltar confirma antes de descartar.
    await act(async () => {
      registro?.()();
    });
    await drenar();
    expect(globalThis.confirm).toHaveBeenCalled();
    expect(
      hospedeiro.querySelector('[data-testid="detalhe-devolucao"]'),
    ).toBeNull();
    expect(onSetBackOverride).toHaveBeenLastCalledWith(null);
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });
});
