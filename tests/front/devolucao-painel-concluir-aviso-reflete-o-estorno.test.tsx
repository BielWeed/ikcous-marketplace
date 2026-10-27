// @vitest-environment jsdom
//
// Achado 1 da caçada de 26/10/2026 (dinheiro, só no TEXTO): ao concluir a
// devolução com reembolso, o aviso dizia "Reembolso enviado ao Mercado Pago"
// olhando só `error` da chamada. A edge `estornar-pagamento` responde
// `status: 'falhou' | 'recusado'` com HTTP 200 e `'em_processamento'` com 202
// (nenhum dos três é `error` no supabase-js), e só `'concluido'` quer dizer que
// o Mercado Pago confirmou. O fluxo e os dados não mudam: aqui se prende que o
// AVISO reflete o status real, e que sem status legível ele não afirma sucesso.
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
  detalhe: null,
  resolucao_final: null,
  valor_frete_ida: 20,
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
  eventos: [],
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
    reestocados: 0,
  });
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
  );
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
  vi.unstubAllGlobals();
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

async function concluirComReembolso() {
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
  await clicar(hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]'));
  await clicar(botao("Concluir"));
  await clicar(botao("Nova, sem uso"));
  await clicar(botao("Concluir devolução"));
  expect(invoke).toHaveBeenCalledTimes(1);
}

/** Todo texto de aviso que saiu, de qualquer tipo de toast. */
function textosDosAvisos(): string[] {
  return [toast.success, toast.info, toast.warning, toast.error].flatMap((t) =>
    t.mock.calls.map((c) => String(c[0])),
  );
}

describe("concluir devolução — o aviso do reembolso reflete o status da edge", () => {
  it("concluido: sucesso, o Mercado Pago confirmou", async () => {
    invoke.mockResolvedValue({
      data: { status: "concluido", valor: 219.8 },
      error: null,
    });
    await concluirComReembolso();

    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("enviado ao Mercado Pago"),
    );
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it.each(["falhou", "recusado"])(
    "%s (HTTP 200): NÃO diz que o reembolso foi enviado; avisa que o Mercado Pago não devolveu",
    async (status) => {
      invoke.mockResolvedValue({
        data: { status, valor: 219.8, texto: "x" },
        error: null,
      });
      await concluirComReembolso();

      expect(toast.success).not.toHaveBeenCalled();
      expect(textosDosAvisos().join("\n")).not.toContain("enviado ao Mercado");
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringMatching(/Devolução concluída, mas .*Mercado Pago/),
        expect.anything(),
      );
      // A devolução em si CONCLUIU: não é erro vermelho.
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  // Devolução só existe para pedido ENTREGUE: na ficha do pedido o cartão
  // "Devolução de dinheiro" fica travado em "Cancele o pedido antes…" e o
  // "Tentar de novo" dele recusa (beco sem saída que empurra a lojista a
  // cancelar pedido entregue). A nova tentativa certa é o "Tentar de novo" do
  // reembolso DESTA devolução, logo abaixo das ações, na mesma tela.
  it.each(["falhou", "recusado"])(
    "%s: manda para o 'Tentar de novo' desta devolução, nunca para o pedido",
    async (status) => {
      invoke.mockResolvedValue({ data: { status }, error: null });
      await concluirComReembolso();

      const [texto] = toast.warning.mock.calls[0] as [string];
      expect(texto).toContain("Logo abaixo, nesta devolução");
      expect(texto).toContain("Tentar de novo");
      expect(texto).not.toMatch(/pedido, em Devolução de dinheiro/);
      expect(texto).not.toMatch(/Abra o pedido/);
    },
  );

  it("em andamento e sem status legível também apontam para esta devolução, não para o pedido", async () => {
    invoke.mockResolvedValue({
      data: { status: "em_processamento" },
      error: null,
    });
    await concluirComReembolso();
    expect(String(toast.info.mock.calls[0][0])).toContain("nesta devolução");
    expect(String(toast.info.mock.calls[0][0])).not.toContain(
      "no pedido, em Devolução de dinheiro",
    );
  });

  it("em_processamento (HTTP 202): diz que está em andamento, sem afirmar envio", async () => {
    invoke.mockResolvedValue({
      data: { status: "em_processamento", texto: "x" },
      error: null,
    });
    await concluirComReembolso();

    expect(toast.success).not.toHaveBeenCalled();
    expect(textosDosAvisos().join("\n")).not.toContain("enviado ao Mercado");
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("em andamento"),
    );
  });

  it("resposta sem status legível: não afirma sucesso", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await concluirComReembolso();

    expect(toast.success).not.toHaveBeenCalled();
    expect(textosDosAvisos().join("\n")).not.toContain("enviado ao Mercado");
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("Não consegui confirmar"),
    );
  });

  it("resposta vazia (data nulo): não afirma sucesso", async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await concluirComReembolso();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("Não consegui confirmar"),
    );
  });
});
