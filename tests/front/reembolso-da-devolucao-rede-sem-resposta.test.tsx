// @vitest-environment jsdom
//
// Reembolso da devolução no painel, rede "pendurada" (conecta e não responde).
// Sem prazo, "Tentar de novo" e "Já devolvi por fora" ficavam apagados para
// sempre, sem aviso, e a ficha nunca relia. Aqui o estouro solta os botões,
// avisa que NÃO se sabe se o pedido foi feito, manda conferir a ficha e relê.
// Só a rede é dublada; o componente é o de verdade.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerDevolucaoDetalhe } from "@/lib/devolucao";
import type { DevolucaoDetalhe } from "@/types/devolucao";

type Resposta = { data: unknown; error: unknown };
const NUNCA = () => new Promise<Resposta>(() => {});
function pendente() {
  let resolver!: (r: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const { rpc, invoke, toast, confirmar } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  confirmar: vi.fn(),
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
function detalhe(): DevolucaoDetalhe {
  const d = lerDevolucaoDetalhe(DETALHE_CRU);
  if (!d) throw new Error("fixture de devolução inválida");
  return d;
}

const aoMudar = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;
let saldoPendurado = false;
let LINHA_ATUAL: Record<string, unknown> = LINHA;

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
      linhas: [LINHA_ATUAL],
    },
    error: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.clearAllMocks();
  saldoPendurado = false;
  LINHA_ATUAL = LINHA;
  confirmar.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmar);
  rpc.mockImplementation((nome: string) =>
    nome === "pedido_reembolsos_e_saldo"
      ? saldoPendurado
        ? NUNCA()
        : Promise.resolve(saldo())
      : Promise.resolve({ data: null, error: null }),
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
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function clicar(alvo: string) {
  await act(async () => {
    botao(alvo).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const avisosDeSemResposta = () =>
  toast.warning.mock.calls.filter(([m]) =>
    String(m).includes("Sem resposta da rede"),
  );

describe("reembolso da devolução com rede conectada e sem resposta", () => {
  it("Tentar de novo: a edge não responde, solta os botões, avisa e relê a ficha", async () => {
    await montar();
    invoke.mockImplementationOnce(NUNCA);

    await clicar("Tentar de novo");
    expect(botao("Tentar de novo").disabled).toBe(true);
    expect(botao("Já devolvi por fora").disabled).toBe(true);
    expect(aoMudar).not.toHaveBeenCalled();

    await avancar(30_000);

    expect(botao("Tentar de novo").disabled).toBe(false);
    expect(botao("Já devolvi por fora").disabled).toBe(false);
    expect(avisosDeSemResposta()).toHaveLength(1);
    const aviso = String(avisosDeSemResposta()[0][0]);
    expect(aviso).toContain("Não dá para saber se o pedido foi feito");
    expect(aviso).toContain("ficha");
    expect(toast.error).not.toHaveBeenCalled();
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("Tentar de novo: a resposta que chega depois do prazo não vira aviso de sucesso", async () => {
    await montar();
    const tardia = pendente();
    invoke.mockImplementationOnce(() => tardia.promessa);
    await clicar("Tentar de novo");
    await avancar(30_000);
    expect(avisosDeSemResposta()).toHaveLength(1);

    await act(async () =>
      tardia.resolver({
        data: { resultado: "reemitido", refund_id: "refund-2" },
        error: null,
      }),
    );

    expect(toast.success).not.toHaveBeenCalled();
    // Nenhuma segunda chamada (a que executa a linha nova) saiu sozinha.
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("Tentar de novo: se só a segunda chamada (executar a linha nova) pendura, termina como sucesso", async () => {
    await montar();
    invoke
      .mockResolvedValueOnce({
        data: { resultado: "reemitido", refund_id: "refund-2" },
        error: null,
      })
      .mockImplementationOnce(NUNCA);

    await clicar("Tentar de novo");
    expect(botao("Tentar de novo").disabled).toBe(true);
    await avancar(30_000);

    expect(botao("Tentar de novo").disabled).toBe(false);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("Já devolvi por fora: a RPC não responde, solta os botões, avisa e relê a ficha", async () => {
    await montar();
    rpc.mockImplementation((nome: string) =>
      nome === "pedido_reembolsos_e_saldo" ? Promise.resolve(saldo()) : NUNCA(),
    );

    await clicar("Já devolvi por fora");
    expect(botao("Já devolvi por fora").disabled).toBe(true);
    expect(aoMudar).not.toHaveBeenCalled();

    await avancar(20_000);

    expect(botao("Tentar de novo").disabled).toBe(false);
    expect(botao("Já devolvi por fora").disabled).toBe(false);
    expect(avisosDeSemResposta()).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("Já devolvi por fora: a RPC que responde dentro do prazo continua avisando o resultado", async () => {
    await montar();
    rpc.mockImplementation((nome: string) =>
      nome === "pedido_reembolsos_e_saldo"
        ? Promise.resolve(saldo())
        : Promise.resolve({ data: { resultado: "combinado" }, error: null }),
    );

    await clicar("Já devolvi por fora");
    await avancar(0);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(avisosDeSemResposta()).toHaveLength(0);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("Já devolvi por fora (depois de 7 dias): a RPC não responde, solta o botão, avisa e relê a ficha", async () => {
    vi.stubGlobal("prompt", vi.fn().mockReturnValue("DEVOLVI POR FORA"));
    LINHA_ATUAL = {
      ...LINHA,
      pode_ter_saido: true,
      por_fora_apos_espera_liberado: true,
    };
    await montar();
    rpc.mockImplementation((nome: string) =>
      nome === "pedido_reembolsos_e_saldo" ? Promise.resolve(saldo()) : NUNCA(),
    );

    await clicar("depois de 7 dias");
    expect(botao("depois de 7 dias").disabled).toBe(true);

    await avancar(20_000);

    expect(botao("depois de 7 dias").disabled).toBe(false);
    expect(avisosDeSemResposta()).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("a leitura do saldo que pendura termina no aviso de leitura, não fica em branco", async () => {
    saldoPendurado = true;
    await montar();
    expect(texto()).toBe("");

    await avancar(15_000);

    expect(texto()).toContain("Não consegui ler o reembolso desta devolução");
  });
});
