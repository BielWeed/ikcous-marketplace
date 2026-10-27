// @vitest-environment jsdom
//
// Lote 230: nas Devoluções do painel, as perguntas de DINHEIRO saem da caixa
// nativa do navegador e passam a ser a janela do app:
//   - "Concluir devolução" com reembolso (devolver pelo Mercado Pago / registrar);
//   - "Tentar de novo" e "Já devolvi por fora" do reembolso que não fechou.
// Cada fluxo prova: a janela abre com o valor em destaque e o verbo da ação,
// `confirm` NÃO é chamado, confirmar executa UMA vez (duplo toque inclusive) e
// desistir não executa nada.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerDevolucaoDetalhe } from "@/lib/devolucao";

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
  fotos: [],
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

const LINHA_DO_SALDO = {
  id: "refund-1",
  status: "falhou",
  amount: 50,
  pode_ter_saido: false,
  por_fora_liberado_em: null,
  por_fora_apos_espera_liberado: false,
  substituida_por_manual: false,
  eh_pix: true,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let nativo: ReturnType<typeof vi.fn>;

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
  respostas.set("pedido_reembolsos_e_saldo", {
    total: 100,
    valor_estornado: 0,
    em_voo: 0,
    em_duvida: 0,
    manual: 0,
    disponivel: 100,
    reservado_por_fora: 0,
    linhas: [LINHA_DO_SALDO],
  });
  respostas.set("admin_devolucao_reembolso_por_fora", {
    resultado: "combinado",
    detalhe: "ok",
    risco_de_dobro: false,
  });
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
  );
  invoke.mockResolvedValue({
    data: { resultado: "reemitido", refund_id: "refund-2" },
    error: null,
  });
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "x" }, error: null });
  nativo = vi.fn(() => true);
  vi.stubGlobal("confirm", nativo);
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

const normal = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

function botao(onde: ParentNode, texto: string) {
  return Array.from(onde.querySelectorAll("button")).find(
    (b) => normal(b.textContent) === texto,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}

const janela = () =>
  document.querySelector<HTMLElement>('[data-testid="confirmar-acao"]');

describe("lote 230 — Concluir devolução com reembolso", () => {
  async function ateOConcluir() {
    // Sem leitura de saldo: vale o padrão (itens + frete de ida = R$ 219,80).
    respostas.delete("pedido_reembolsos_e_saldo");
    const { AdminDevolucoesView } = await import(
      "@/views/admin/AdminDevolucoesView"
    );
    await act(async () => {
      raiz.render(
        <AdminDevolucoesView
          onNavigate={vi.fn()}
          selectedDevolucaoId={undefined}
          active
          onSetDirty={vi.fn()}
          onSetBackOverride={vi.fn()}
        />,
      );
    });
    await drenar();
    await clicar(
      hospedeiro.querySelector<HTMLElement>('[data-devolucao="d-1"]'),
    );
    await clicar(botao(hospedeiro, "Concluir"));
    await clicar(botao(hospedeiro, "Nova, sem uso"));
    await clicar(botao(hospedeiro, "Concluir devolução"));
  }

  const concluiuNoBanco = () =>
    rpc.mock.calls.some((c) => c[0] === "admin_devolucao_concluir");

  it("pago pelo app: janela com o valor e 'Devolver R$ ...', sem confirm nativo e sem gravar antes da resposta", async () => {
    await ateOConcluir();

    expect(nativo).not.toHaveBeenCalled();
    const j = janela();
    expect(j).not.toBeNull();
    expect(normal(j?.querySelector("p")?.textContent)).toBe("R$ 219,80");
    expect(normal(j?.textContent)).toContain(
      "O dinheiro sai da sua conta do Mercado Pago e não dá para desfazer.",
    );
    const botoes = Array.from(j?.querySelectorAll("button") ?? []);
    expect(botoes.map((b) => normal(b.textContent))).toEqual([
      "Voltar",
      "Devolver R$ 219,80",
    ]);
    expect(concluiuNoBanco()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("confirmar conclui UMA vez, mesmo com duplo toque, e manda estornar uma vez", async () => {
    await ateOConcluir();
    const acao = botao(janela() as HTMLElement, "Devolver R$ 219,80");
    await act(async () => {
      acao?.click();
      acao?.click();
    });
    await drenar();

    expect(nativo).not.toHaveBeenCalled();
    expect(
      rpc.mock.calls.filter((c) => c[0] === "admin_devolucao_concluir"),
    ).toHaveLength(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("estornar-pagamento", {
      body: { refund_id: "ref-1" },
    });
  });

  it("'Voltar' desiste: nada é gravado e nada é devolvido", async () => {
    await ateOConcluir();
    await clicar(botao(janela() as HTMLElement, "Voltar"));

    expect(nativo).not.toHaveBeenCalled();
    expect(concluiuNoBanco()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(janela()).toBeNull();
  });

  it("pedido que o app não cobrou: o verbo é 'Registrar reembolso' e a janela não promete Mercado Pago", async () => {
    respostas.set("devolucao_detalhe", {
      ...DETALHE,
      pedido: { ...DETALHE.pedido, payment_method: "dinheiro" },
    });
    await ateOConcluir();

    expect(nativo).not.toHaveBeenCalled();
    const j = janela();
    expect(normal(j?.textContent)).toContain(
      "Este pedido não foi pago pelo app: você devolve o dinheiro ao cliente em mãos ou por PIX.",
    );
    expect(
      Array.from(j?.querySelectorAll("button") ?? []).map((b) =>
        normal(b.textContent),
      ),
    ).toEqual(["Voltar", "Registrar reembolso"]);
  });
});

describe("lote 230 — reembolso que não fechou (Tentar de novo / por fora)", () => {
  async function montarBloco() {
    const d = lerDevolucaoDetalhe({
      ...DETALHE,
      status: "concluida",
      resolucao_final: "reembolso",
      valor_reembolso: 50,
      refund_id: "refund-1",
      concluida_em: "2026-09-28T12:00:00Z",
    });
    if (!d) throw new Error("fixture de devolução inválida");
    const { ReembolsoDaDevolucao } = await import(
      "@/components/admin/devolucoes/ReembolsoDaDevolucao"
    );
    await act(async () => {
      raiz.render(
        createElement(ReembolsoDaDevolucao, { detalhe: d, aoMudar: vi.fn() }),
      );
    });
    await drenar();
  }

  it("'Tentar de novo': janela com R$ 50,00; confirmar pede o reembolso UMA vez; sem confirm nativo", async () => {
    await montarBloco();
    await clicar(botao(hospedeiro, "Tentar de novo"));

    expect(nativo).not.toHaveBeenCalled();
    expect(normal(janela()?.querySelector("p")?.textContent)).toBe("R$ 50,00");
    expect(invoke).not.toHaveBeenCalled();

    const acao = botao(janela() as HTMLElement, "Pedir de novo");
    await act(async () => {
      acao?.click();
      acao?.click();
    });
    await drenar();

    const reemitidos = invoke.mock.calls.filter(
      (c) => (c[1] as { body: { acao?: string } }).body.acao === "reemitir",
    );
    expect(reemitidos).toHaveLength(1);
  });

  it("'Tentar de novo' + 'Voltar': não pede nada ao Mercado Pago", async () => {
    await montarBloco();
    await clicar(botao(hospedeiro, "Tentar de novo"));
    await clicar(botao(janela() as HTMLElement, "Voltar"));

    expect(nativo).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("'Já devolvi por fora': janela com o valor; confirmar registra UMA vez; 'Voltar' não registra", async () => {
    await montarBloco();
    await clicar(botao(hospedeiro, "Já devolvi por fora"));
    expect(nativo).not.toHaveBeenCalled();
    expect(normal(janela()?.querySelector("p")?.textContent)).toBe("R$ 50,00");

    await clicar(botao(janela() as HTMLElement, "Voltar"));
    const registrou = () =>
      rpc.mock.calls.filter(
        (c) => c[0] === "admin_devolucao_reembolso_por_fora",
      );
    expect(registrou()).toHaveLength(0);

    await clicar(botao(hospedeiro, "Já devolvi por fora"));
    const acao = botao(janela() as HTMLElement, "Registrar devolução");
    await act(async () => {
      acao?.click();
      acao?.click();
    });
    await drenar();
    expect(registrou()).toHaveLength(1);
    expect(nativo).not.toHaveBeenCalled();
  });
});
