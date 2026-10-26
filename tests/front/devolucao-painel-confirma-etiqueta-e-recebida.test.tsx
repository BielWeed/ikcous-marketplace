// @vitest-environment jsdom
//
// Achados 2 e 6 da caçada de 26/10/2026 (painel de devolução):
//  2. "Gerar código de postagem" pagava com o saldo do Melhor Envio num toque.
//     A etiqueta de ida tem confirmação obrigatória; a de volta não tinha.
//     Agora o 1º toque só abre a confirmação, a compra sai no "Confirmar e
//     gerar" e "Cancelar" não chama nada. ("Buscar DC-e / conferir código"
//     não compra — a edge não cobra de novo —, então segue em um toque.)
//  6. "Marcar como recebida" era um toque só, sem volta, colado em "Marcar a
//     caminho": mesmo padrão, com confirmação curta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke, toast, respostas } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
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
    storage: { from: () => ({ createSignedUrl: vi.fn() }) },
  },
}));

vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: "d-rev",
  protocolo: "DV260926-REVER",
  order_id: "o-rev",
  cliente_nome: "João",
  cliente_whatsapp: "34999998888",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  status: "aprovada",
  resolucao_desejada: "reembolso",
  metodo_retorno: "etiqueta_reversa",
  modalidade: "nacional",
  valor_itens: 159.8,
  prazo_ate: "2026-10-01",
  created_at: "2026-09-26T10:00:00Z",
};

function detalheDe(over: Record<string, unknown> = {}) {
  return {
    ...LINHA,
    detalhe: null,
    resolucao_final: null,
    valor_frete_ida: 0,
    valor_reembolso: null,
    refund_id: null,
    reembolso_manual: false,
    fotos: [],
    codigo_rastreio: null,
    codigo_postagem: null,
    etiqueta_url: null,
    me_reverse_id: null,
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: null,
    entregue_em: "2026-09-20T15:00:00Z",
    politica: null,
    aprovada_em: "2026-09-26T11:00:00Z",
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [],
    eventos: [],
    pedido: {
      id: "o-rev",
      total: 159.8,
      shipping: 0,
      payment_method: "online",
      payment_status: "pago",
      canal: "online",
      customer_name: "João",
      whatsapp: "34999998888",
      shipping_label_id: "lbl-me-1",
      shipping_option_id: "melhor-envio-2",
    },
    ...over,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  respostas.clear();
  respostas.set("admin_devolucoes_listar", {
    total: 1,
    contagem: { aprovada: 1 },
    itens: [LINHA],
  });
  respostas.set("devolucao_detalhe", detalheDe());
  respostas.set("admin_devolucao_registrar", {
    id: "d-rev",
    status: "recebida",
  });
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
  );
  invoke.mockResolvedValue({
    data: {
      ok: true,
      already: false,
      codigo_postagem: "PX999BR",
      etiqueta_url: "https://melhorenvio.com.br/dace.pdf",
      me_reverse_id: "me-rev-1",
    },
    error: null,
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
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

async function abrirFicha() {
  const { AdminDevolucoesView } = await import(
    "@/views/admin/AdminDevolucoesView"
  );
  await act(async () => {
    raiz.render(
      <AdminDevolucoesView
        onNavigate={vi.fn()}
        active
        onSetDirty={vi.fn()}
        onSetBackOverride={vi.fn()}
      />,
    );
  });
  await drenar();
  await clicar(
    hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-rev"]'),
  );
  expect(
    hospedeiro.querySelector('[data-testid="detalhe-devolucao"]'),
  ).not.toBeNull();
}

const chamouAEtiqueta = () =>
  invoke.mock.calls.some((c) => c[0] === "melhor-envio-etiqueta");
const chamouRecebida = () =>
  rpc.mock.calls.some(
    (c) =>
      c[0] === "admin_devolucao_registrar" && c[1]?.p_evento === "recebida",
  );

describe("gerar o código de postagem da devolução — confirmação antes de gastar o saldo", () => {
  it("o 1º toque só abre a confirmação, que cita o saldo do Melhor Envio; nada é comprado", async () => {
    await abrirFicha();
    await clicar(botao("Gerar código de postagem"));

    const caixa = hospedeiro.querySelector(
      '[data-testid="confirmar-etiqueta-reversa"]',
    );
    expect(caixa).not.toBeNull();
    expect(caixa?.textContent).toContain("saldo da SUA conta no Melhor Envio");
    expect(botao("Confirmar e gerar")).toBeTruthy();
    expect(chamouAEtiqueta()).toBe(false);
  });

  it("Confirmar e gerar: a compra sai uma vez, para a devolução certa", async () => {
    await abrirFicha();
    await clicar(botao("Gerar código de postagem"));
    await clicar(botao("Confirmar e gerar"));

    const chamadas = invoke.mock.calls.filter(
      (c) => c[0] === "melhor-envio-etiqueta",
    );
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0][1]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          action: "gerar_devolucao_reversa",
          devolucao_id: "d-rev",
        }),
      }),
    );
    expect(
      hospedeiro.querySelector('[data-testid="confirmar-etiqueta-reversa"]'),
    ).toBeNull();
  });

  it("Cancelar: nada é comprado e o botão original volta", async () => {
    await abrirFicha();
    await clicar(botao("Gerar código de postagem"));
    await clicar(botao("Cancelar"));

    expect(chamouAEtiqueta()).toBe(false);
    expect(
      hospedeiro.querySelector('[data-testid="confirmar-etiqueta-reversa"]'),
    ).toBeNull();
    expect(botao("Gerar código de postagem")).toBeTruthy();
  });

  it("código já existe (só falta a DC-e): o botão apenas busca, sem pedir confirmação de compra", async () => {
    respostas.set(
      "devolucao_detalhe",
      detalheDe({ codigo_postagem: "PX111BR", etiqueta_url: null }),
    );
    await abrirFicha();
    await clicar(botao("Buscar DC-e / conferir código"));

    expect(
      hospedeiro.querySelector('[data-testid="confirmar-etiqueta-reversa"]'),
    ).toBeNull();
    expect(chamouAEtiqueta()).toBe(true);
  });
});

describe("marcar a devolução como recebida — confirmação curta", () => {
  it("o 1º toque só abre a confirmação; a RPC não é chamada", async () => {
    await abrirFicha();
    await clicar(botao("Marcar como recebida"));

    const caixa = hospedeiro.querySelector(
      '[data-testid="confirmar-recebida"]',
    );
    expect(caixa).not.toBeNull();
    expect(caixa?.textContent).toContain("já chegou na loja");
    expect(chamouRecebida()).toBe(false);
  });

  it("Confirmar recebimento: a RPC sai uma vez com o evento recebida", async () => {
    await abrirFicha();
    await clicar(botao("Marcar como recebida"));
    await clicar(botao("Confirmar recebimento"));

    expect(
      rpc.mock.calls.filter(
        (c) =>
          c[0] === "admin_devolucao_registrar" && c[1]?.p_evento === "recebida",
      ),
    ).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith("admin_devolucao_registrar", {
      p_id: "d-rev",
      p_evento: "recebida",
    });
  });

  it("Cancelar: a RPC não é chamada e o botão original volta", async () => {
    await abrirFicha();
    await clicar(botao("Marcar como recebida"));
    await clicar(botao("Cancelar"));

    expect(chamouRecebida()).toBe(false);
    expect(botao("Marcar como recebida")).toBeTruthy();
    expect(
      hospedeiro.querySelector('[data-testid="confirmar-recebida"]'),
    ).toBeNull();
  });
});
