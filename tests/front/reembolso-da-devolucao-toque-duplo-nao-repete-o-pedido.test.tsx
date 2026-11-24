// @vitest-environment jsdom
//
// Bloco do reembolso na ficha da devolução (`ReembolsoDaDevolucao`): dois
// toques seguidos em "Já devolvi por fora" ou "Tentar de novo" — antes de a
// tela redesenhar o botão como desligado — só podem mandar UM pedido ao
// servidor. É dinheiro: o segundo pedido de reemissão ou de "por fora" abre
// caminho para o cliente receber em dobro.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerDevolucaoDetalhe } from "@/lib/devolucao";
import type { DevolucaoDetalhe } from "@/types/devolucao";

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, functions: { invoke } },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SALDO = {
  total: 100,
  valor_estornado: 0,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel: 100,
  reservado_por_fora: 0,
  linhas: [
    {
      id: "refund-1",
      status: "falhou",
      amount: 50,
      pode_ter_saido: false,
      por_fora_liberado_em: null,
      por_fora_apos_espera_liberado: false,
      substituida_por_manual: false,
      eh_pix: true,
    },
  ],
};

function detalhe(): DevolucaoDetalhe {
  const d = lerDevolucaoDetalhe({
    id: "dev-1",
    protocolo: "DV261015-ABCDE",
    order_id: "pedido-1",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
    resolucao_desejada: "reembolso",
    resolucao_final: "reembolso",
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "concluida",
    valor_itens: 50,
    valor_reembolso: 50,
    refund_id: "refund-1",
    reembolso_manual: false,
    created_at: "2026-09-26T10:00:00Z",
    itens: [],
    eventos: [],
  });
  if (!d) throw new Error("fixture de devolução inválida");
  return d;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoMudar = vi.fn();
let liberarAcao: (resposta: unknown) => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  // A ação fica "em voo" (pendurada) até o teste liberar: é o intervalo em que
  // o segundo toque chega.
  const emVoo = new Promise((resolve) => {
    liberarAcao = resolve;
  });
  rpc.mockImplementation((nome: string) =>
    nome === "pedido_reembolsos_e_saldo"
      ? Promise.resolve({ data: SALDO, error: null })
      : emVoo,
  );
  invoke.mockImplementation(() => emVoo);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  liberarAcao({ data: null, error: null });
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

function botao(alvo: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(alvo),
  );
}

async function montar() {
  const { ReembolsoDaDevolucao } = await import(
    "@/components/admin/devolucoes/ReembolsoDaDevolucao"
  );
  await act(async () => {
    raiz.render(
      createElement(ReembolsoDaDevolucao, { detalhe: detalhe(), aoMudar }),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// Dois toques no MESMO instante: a tela ainda não teve como desligar o botão.
async function tocarDuasVezes(alvo: string) {
  const b = botao(alvo);
  expect(b).toBeTruthy();
  await act(async () => {
    b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("ReembolsoDaDevolucao — toque duplo", () => {
  it("'Já devolvi por fora' tocado duas vezes registra uma vez só", async () => {
    await montar();
    await tocarDuasVezes("Já devolvi por fora");

    const porFora = rpc.mock.calls.filter(
      ([nome]) => nome === "admin_devolucao_reembolso_por_fora",
    );
    expect(porFora).toHaveLength(1);
  });

  it("'Tentar de novo' tocado duas vezes pede a reemissão uma vez só", async () => {
    await montar();
    await tocarDuasVezes("Tentar de novo");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("estornar-pagamento", {
      body: {
        acao: "reemitir",
        devolucao_id: "dev-1",
        refund_esperado: "refund-1",
      },
    });
  });
});
