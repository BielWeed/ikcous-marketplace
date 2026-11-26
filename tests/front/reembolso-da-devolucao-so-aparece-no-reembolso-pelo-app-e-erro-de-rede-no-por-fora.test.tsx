// @vitest-environment jsdom
//
// Caça por mutação em ReembolsoDaDevolucao (dinheiro). Três bordas que nenhum
// teste percebia:
//  1) O bloco só existe para devolução CONCLUÍDA, com resolução REEMBOLSO, que
//     NÃO foi manual e que tem um reembolso gravado. Fora disso nem consulta o
//     saldo (se consultasse, uma linha parada de outro pedido apareceria na
//     ficha de uma devolução que nunca pediu dinheiro pelo app).
//  2) "Já devolvi por fora" (comum e depois de 7 dias): se o servidor devolve
//     erro de rede, a lojista lê "Sem conexão com a internet", não o aviso
//     genérico — nada é dado como registrado.
//  3) O aviso "Sem resposta da rede" fica na tela 12 segundos, tempo para ler a
//     frase longa e conferir a ficha.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerDevolucaoDetalhe } from "@/lib/devolucao";
import type { DevolucaoDetalhe } from "@/types/devolucao";

type Resposta = { data: unknown; error: unknown };
const NUNCA = () => new Promise<Resposta>(() => {});

const { rpc, invoke, toast } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, functions: { invoke } },
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: "refund-1",
  status: "falhou",
  amount: 50,
  pode_ter_saido: false,
  por_fora_liberado_em: null,
  por_fora_apos_espera_liberado: false,
  substituida_por_manual: false,
  eh_pix: true,
};
const DETALHE_CRU = {
  id: "dev-1",
  protocolo: "DV261015-ABCDE",
  order_id: "pedido-1",
  user_id: "u-1",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "reembolso",
  resolucao_final: "reembolso",
  modalidade: "nacional",
  metodo_retorno: "envio_proprio",
  status: "concluida",
  valor_itens: 50,
  valor_frete_ida: 0,
  valor_reembolso: 50,
  refund_id: "refund-1",
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
  prazo_ate: "2026-10-01",
  politica: null,
  created_at: "2026-09-26T10:00:00Z",
  updated_at: "2026-09-26T10:00:00Z",
  aprovada_em: "2026-09-26T11:00:00Z",
  postada_em: null,
  recebida_em: "2026-09-27T12:00:00Z",
  concluida_em: "2026-09-28T12:00:00Z",
  encerrada_em: null,
  itens: [],
  eventos: [],
  pedido: null,
};
function detalhe(extra: Record<string, unknown> = {}): DevolucaoDetalhe {
  const d = lerDevolucaoDetalhe({ ...DETALHE_CRU, ...extra });
  if (!d) throw new Error("fixture de devolução inválida");
  return d;
}

const aoMudar = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;
let linhaAtual: Record<string, unknown> = LINHA;
let respostaDaAcao: Resposta = { data: null, error: null };

function saldo(): Resposta {
  return {
    data: {
      total: 100,
      valor_estornado: 0,
      em_voo: 0,
      em_duvida: 0,
      manual: 0,
      disponivel: 100,
      reservado_por_fora: 0,
      linhas: [linhaAtual],
    },
    error: null,
  };
}
const leiturasDoSaldo = () =>
  rpc.mock.calls.filter(([nome]) => nome === "pedido_reembolsos_e_saldo");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.clearAllMocks();
  linhaAtual = LINHA;
  respostaDaAcao = { data: null, error: null };
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.stubGlobal(
    "prompt",
    vi.fn(() => "DEVOLVI POR FORA"),
  );
  rpc.mockImplementation((nome: string) =>
    nome === "pedido_reembolsos_e_saldo"
      ? Promise.resolve(saldo())
      : Promise.resolve(respostaDaAcao),
  );
  invoke.mockImplementation(() => Promise.resolve({ data: null, error: null }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
const botao = (alvo: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(alvo),
  ) as HTMLButtonElement;

async function montar(d: DevolucaoDetalhe = detalhe()) {
  const { ReembolsoDaDevolucao } = await import(
    "@/components/admin/devolucoes/ReembolsoDaDevolucao"
  );
  await act(async () => {
    raiz.render(createElement(ReembolsoDaDevolucao, { detalhe: d, aoMudar }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function clicar(alvo: string) {
  await act(async () => {
    botao(alvo).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("quando o bloco de reembolso existe", () => {
  it("controle: concluída + reembolso + pelo app + reembolso gravado mostra o bloco", async () => {
    await montar();
    expect(leiturasDoSaldo()).toHaveLength(1);
    expect(texto()).toContain("O reembolso de");
    expect(texto()).toContain("não foi concluído pelo Mercado Pago");
  });

  it.each([
    ["ainda recebida (não concluída)", { status: "recebida" }],
    ["resolução final é troca", { resolucao_final: "troca" }],
    ["reembolso foi manual", { reembolso_manual: true }],
    ["sem reembolso gravado (refund_id nulo)", { refund_id: null }],
  ])("não consulta o saldo nem mostra nada quando %s", async (_caso, extra) => {
    await montar(detalhe(extra));
    expect(leiturasDoSaldo()).toHaveLength(0);
    expect(texto()).toBe("");
    expect(hospedeiro.querySelector("section")).toBeNull();
  });
});

describe("'Já devolvi por fora' com erro de rede no servidor", () => {
  it("comum: mostra 'Sem conexão com a internet', não o aviso genérico, e não diz que registrou", async () => {
    await montar();
    respostaDaAcao = { data: null, error: { message: "Failed to fetch" } };
    await clicar("Já devolvi por fora");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Sem conexão com a internet. Confira a rede e tente de novo.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("depois de 7 dias: mesmo aviso de rede e nada registrado", async () => {
    linhaAtual = {
      ...LINHA,
      pode_ter_saido: true,
      por_fora_apos_espera_liberado: true,
    };
    await montar();
    respostaDaAcao = { data: null, error: { message: "Failed to fetch" } };
    await clicar("depois de 7 dias");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Sem conexão com a internet. Confira a rede e tente de novo.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("aviso de rede sem resposta", () => {
  it("fica 12 segundos na tela", async () => {
    await montar();
    invoke.mockImplementationOnce(NUNCA);
    await clicar("Tentar de novo");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const avisos = toast.warning.mock.calls.filter(([m]) =>
      String(m).includes("Sem resposta da rede"),
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0][1]).toEqual({ duration: 12_000 });
  });
});
