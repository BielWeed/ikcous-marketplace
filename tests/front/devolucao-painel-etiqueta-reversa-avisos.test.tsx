// @vitest-environment jsdom
//
// Achados A2 (revisão de risco pré-publicação de 26/09/2026 sobre a etiqueta
// reversa do Melhor Envio, PR #666): as correções R6 (DC-e pendente) e R8
// (código vencido) já saíam da edge `melhor-envio-etiqueta`, mas
// `src/lib/devolucao.ts` descartava `aviso`/`dce_pendente`/`expirado` no
// leitor, e o botão "Gerar código de postagem" sumia do painel assim que
// `codigo_postagem` era gravado — mesmo sem a DC-e ter chegado. O lojista via
// só o toast de sucesso e não tinha como buscar a declaração de conteúdo de
// novo (nem saber que faltava): o cliente ia para os Correios sem ela.
//
// Este arquivo prende as DUAS pontas: o toast de aviso aparece, e a ação
// "Buscar DC-e / conferir código" continua na tela enquanto `etiqueta_url`
// for nulo.
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
    contagem: { aprovada: 1 },
    itens: [LINHA],
  });
  respostas.set("devolucao_detalhe", detalheDe());
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
  );
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

async function abrirFicha() {
  await montar();
  await clicar(
    hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-rev"]'),
  );
  expect(
    hospedeiro.querySelector('[data-testid="detalhe-devolucao"]'),
  ).not.toBeNull();
}

describe("painel de devoluções — avisos da etiqueta reversa (achado A2)", () => {
  it("sem código: o botão pede para GERAR", async () => {
    await abrirFicha();
    expect(botao("Gerar código de postagem")).toBeTruthy();
    expect(botao("Buscar DC-e / conferir código")).toBeFalsy();
  });

  it("gera o código, a DC-e não vem (dce_pendente): toast de aviso aparece e o botão continua, agora para BUSCAR a DC-e", async () => {
    invoke.mockImplementationOnce(async () => {
      // A releitura seguinte (`carregar()`) já reflete o código gravado —
      // mesma forma que a edge grava de verdade.
      respostas.set(
        "devolucao_detalhe",
        detalheDe({ codigo_postagem: "PX999BR", etiqueta_url: null }),
      );
      return {
        data: {
          ok: true,
          already: false,
          codigo_postagem: "PX999BR",
          etiqueta_url: null,
          me_reverse_id: "me-rev-1",
          dce_pendente: true,
          aviso:
            "O código de postagem saiu, mas a DC-e não veio do Melhor Envio agora.",
        },
        error: null,
      };
    });

    await abrirFicha();
    await clicar(botao("Gerar código de postagem"));

    expect(invoke).toHaveBeenCalledWith(
      "melhor-envio-etiqueta",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "gerar_devolucao_reversa",
          devolucao_id: "d-rev",
        }),
      }),
    );
    // O toast de SUCESSO continua saindo (o código existe de verdade)...
    expect(toast.success).toHaveBeenCalled();
    // ...mas agora tem um aviso À PARTE — antes este campo era descartado.
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("DC-e"),
      expect.objectContaining({ duration: expect.any(Number) }),
    );
    // A ação continua na tela: sem a DC-e, "gerar_etiqueta" não sai da lista
    // (src/lib/devolucao.ts:acoesDoLojista) — só o RÓTULO muda.
    expect(botao("Gerar código de postagem")).toBeFalsy();
    expect(botao("Buscar DC-e / conferir código")).toBeTruthy();
  });

  it("com código E DC-e prontos, o botão de gerar/buscar some da tela", async () => {
    respostas.set(
      "devolucao_detalhe",
      detalheDe({
        codigo_postagem: "PX999BR",
        etiqueta_url: "https://melhorenvio.com.br/dace.pdf",
      }),
    );
    await abrirFicha();
    expect(botao("Gerar código de postagem")).toBeFalsy();
    expect(botao("Buscar DC-e / conferir código")).toBeFalsy();
  });

  it("código vencido (expirado) enquanto a DC-e ainda não veio: o toast de aviso cita o vencimento, e o botão de buscar continua na tela", async () => {
    // `expirado` só é alcançável pela tela enquanto `etiqueta_url` for nulo —
    // com os dois campos prontos a ação some (acoesDoLojista), e não há hoje
    // outro caminho no painel para chamar `gerar_devolucao_reversa` de novo.
    invoke.mockImplementationOnce(async () => {
      respostas.set(
        "devolucao_detalhe",
        detalheDe({ codigo_postagem: "PX111BR", etiqueta_url: null }),
      );
      return {
        data: {
          ok: true,
          already: true,
          codigo_postagem: "PX111BR",
          etiqueta_url: null,
          me_reverse_id: "me-rev-1",
          validade_ate: "2026-01-01T00:00:00.000Z",
          expirado: true,
          dce_pendente: true,
          aviso:
            "O código de postagem venceu em 01/01/2026. Reemita o código em Meus envios.",
        },
        error: null,
      };
    });

    await abrirFicha();
    await clicar(botao("Gerar código de postagem"));

    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("venceu"),
      expect.any(Object),
    );
  });

  // Achado N1 (revisão de risco, rodada 2): o toast de sucesso dizia "o
  // cliente já vê no pedido" mesmo quando a devolução deixou de estar
  // aprovada durante o checkout (achado A1) — o cliente pode nem ver mais a
  // etiqueta na tela dele.
  it("achado N1: a devolução deixou de estar aprovada durante o checkout — o toast de sucesso NÃO promete que o cliente já vê no pedido", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        already: false,
        codigo_postagem: "PX777BR",
        etiqueta_url: "https://melhorenvio.com.br/dace.pdf",
        me_reverse_id: "me-rev-1",
        aviso:
          'Atenção: esta devolução não está mais aprovada (status atual: "cancelada"), mas o envio reverso me-rev-1 já foi PAGO no Melhor Envio agora. Cancele esse envio reverso no Melhor Envio.',
      },
      error: null,
    });

    await abrirFicha();
    await clicar(botao("Gerar código de postagem"));

    expect(toast.success).toHaveBeenCalledWith(
      expect.not.stringContaining("O cliente já vê no pedido"),
    );
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("Melhor Envio"),
      expect.any(Object),
    );
  });
});
