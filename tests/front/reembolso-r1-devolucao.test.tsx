// @vitest-environment jsdom
//
// Lote R1 do reembolso (15/10/2026): o bloco do reembolso na ficha da
// devolução do painel (`ReembolsoDaDevolucao`), o texto da cliente
// (`instrucaoParaOCliente` + `DevolucaoDoPedidoCard`) e as regras puras do
// contrato (`src/lib/reembolso-em-duvida.ts`).
//
// O veredito "pode ter saído" é do SERVIDOR (RPC `pedido_reembolsos_e_saldo`):
// a tela só decide os botões a partir dele. jsdom não vê CSS — aqui só se
// afirma texto, botões e chamadas, nunca layout.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { instrucaoParaOCliente, lerDevolucaoDetalhe } from "@/lib/devolucao";
import {
  acoesDaLinha,
  lerReembolsosESaldo,
  lerSaidaAposEspera,
} from "@/lib/reembolso-em-duvida";
import type { DevolucaoDetalhe } from "@/types/devolucao";

// ---------------------------------------------------------------------------
// Dublê do Supabase: a RPC do saldo, as RPCs de ação e a edge.
// ---------------------------------------------------------------------------
type Chamada = { tipo: "rpc" | "invoke"; nome: string; argumentos: unknown };
let CHAMADAS: Chamada[] = [];
let LINHA_DO_SALDO: Record<string, unknown> = {};
let RESPOSTA_ACAO: unknown = { data: null, error: null };
let RESPOSTAS_INVOKE: unknown[] = [];
let STATUS_DA_LINHA_CLIENTE: string | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string, argumentos: unknown) => {
      if (nome === "pedido_reembolsos_e_saldo") {
        return Promise.resolve({
          data: {
            total: 100,
            valor_estornado: 0,
            em_voo: 0,
            em_duvida: 0,
            manual: 0,
            disponivel: 100,
            linhas: [LINHA_DO_SALDO],
          },
          error: null,
        });
      }
      CHAMADAS.push({ tipo: "rpc", nome, argumentos });
      return Promise.resolve(RESPOSTA_ACAO);
    }),
    functions: {
      invoke: vi.fn((nome: string, argumentos: unknown) => {
        CHAMADAS.push({ tipo: "invoke", nome, argumentos });
        return Promise.resolve(
          RESPOSTAS_INVOKE.shift() ?? { data: null, error: null },
        );
      }),
    },
    from: vi.fn(() => {
      const b: Record<string, unknown> = {};
      b.select = vi.fn(() => b);
      b.eq = vi.fn(() => b);
      b.maybeSingle = vi.fn(() =>
        Promise.resolve({
          data:
            STATUS_DA_LINHA_CLIENTE === null
              ? null
              : { status: STATUS_DA_LINHA_CLIENTE },
          error: null,
        }),
      );
      return b;
    }),
    storage: { from: vi.fn() },
  },
}));

const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};
vi.mock("sonner", () => ({ toast: toastMock }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function linha(extra: Record<string, unknown> = {}) {
  return {
    id: "refund-1",
    status: "falhou",
    amount: 50,
    pode_ter_saido: false,
    por_fora_liberado_em: null,
    por_fora_apos_espera_liberado: false,
    substituida_por_manual: false,
    eh_pix: true,
    ...extra,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoMudar = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  CHAMADAS = [];
  LINHA_DO_SALDO = linha();
  RESPOSTA_ACAO = { data: null, error: null };
  RESPOSTAS_INVOKE = [];
  STATUS_DA_LINHA_CLIENTE = null;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

function botao(alvo: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").includes(alvo),
  );
}

async function clicar(b: HTMLButtonElement | undefined) {
  await act(async () => {
    b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function montarBloco(d: DevolucaoDetalhe = detalhe()) {
  const { ReembolsoDaDevolucao } = await import(
    "@/components/admin/devolucoes/ReembolsoDaDevolucao"
  );
  await act(async () => {
    raiz.render(createElement(ReembolsoDaDevolucao, { detalhe: d, aoMudar }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ---------------------------------------------------------------------------
describe("regras puras do contrato R1", () => {
  it("acoesDaLinha: só repete o que o servidor garante que não saiu", () => {
    const base = {
      por_fora_liberado_em: null,
      por_fora_apos_espera_liberado: false,
      substituida_por_manual: false,
    } as const;
    const nada = {
      podeRepetir: false,
      confirmando: false,
      porForaAposEspera: false,
      jaPorFora: false,
    };
    expect(
      acoesDaLinha({ ...base, status: "falhou", pode_ter_saido: false }),
    ).toEqual({ ...nada, podeRepetir: true });
    expect(
      acoesDaLinha({ ...base, status: "falhou", pode_ter_saido: true }),
    ).toEqual({ ...nada, confirmando: true });
    // Só o booleano do servidor libera a saída dos 7 dias.
    expect(
      acoesDaLinha({
        ...base,
        status: "falhou",
        pode_ter_saido: true,
        por_fora_apos_espera_liberado: true,
      }),
    ).toEqual({ ...nada, confirmando: true, porForaAposEspera: true });
    expect(
      acoesDaLinha({
        ...base,
        status: "concluido",
        pode_ter_saido: true,
        por_fora_apos_espera_liberado: true,
      }),
    ).toEqual(nada);
    // Marca de uso preenchida: nenhuma ação, só "já registrado".
    expect(
      acoesDaLinha({
        status: "falhou",
        pode_ter_saido: true,
        por_fora_apos_espera_liberado: true,
        por_fora_liberado_em: "2026-10-16T00:00:00Z",
        substituida_por_manual: false,
      }),
    ).toEqual({ ...nada, jaPorFora: true });
    // Substituída pelo manual: o pode_ter_saido=false do servidor é "não conta como
    // dúvida", NUNCA "o dinheiro não saiu" — nada de repetir nem de saída dos 7 dias.
    expect(
      acoesDaLinha({
        ...base,
        status: "falhou",
        pode_ter_saido: false,
        por_fora_apos_espera_liberado: true,
        substituida_por_manual: true,
      }),
    ).toEqual({ ...nada, jaPorFora: true });
    expect(
      acoesDaLinha({
        ...base,
        status: "em_processamento",
        pode_ter_saido: true,
      }).podeRepetir,
    ).toBe(false);
  });

  it("lerReembolsosESaldo recusa forma inesperada (uma linha sem veredito derruba tudo)", () => {
    const ok = {
      total: "100.00",
      valor_estornado: 0,
      em_voo: 0,
      em_duvida: 0,
      manual: 0,
      disponivel: 100,
      linhas: [linha()],
    };
    expect(lerReembolsosESaldo(ok)?.total).toBe(100);
    expect(
      lerReembolsosESaldo({
        ...ok,
        linhas: [linha({ pode_ter_saido: "sim" })],
      }),
    ).toBeNull();
    expect(
      lerReembolsosESaldo({
        ...ok,
        linhas: [linha({ por_fora_apos_espera_liberado: undefined })],
      }),
    ).toBeNull();
    expect(
      lerReembolsosESaldo({
        ...ok,
        linhas: [linha({ substituida_por_manual: undefined })],
      }),
    ).toBeNull();
    expect(lerReembolsosESaldo({ ...ok, em_duvida: null })).toBeNull();
    expect(lerReembolsosESaldo(null)).toBeNull();
  });

  it("lerReembolsosESaldo nunca devolve disponível NEGATIVO (a linha em voo resolvida por fora conta duas vezes na conta crua)", () => {
    const cru = {
      total: 100,
      valor_estornado: 0,
      em_voo: 100,
      em_duvida: 0,
      manual: 100,
      disponivel: "-100.00",
      linhas: [linha({ status: "em_processamento" })],
    };
    expect(lerReembolsosESaldo(cru)?.disponivel).toBe(0);
    expect(lerReembolsosESaldo({ ...cru, disponivel: 30 })?.disponivel).toBe(
      30,
    );
  });

  it("lerSaidaAposEspera: só 'combinado'/'registrado' gravou; recusa sem erro nunca vira 'registrado'", () => {
    // Os dois sucessos reais das RPCs da migration 20261241.
    expect(
      lerSaidaAposEspera({ resultado: "combinado", risco_de_dobro: true }),
    ).toEqual({ gravou: true });
    expect(
      lerSaidaAposEspera({ resultado: "registrado", risco_de_dobro: true }),
    ).toEqual({ gravou: true });
    // Recusas que o servidor devolve SEM erro.
    for (const resultado of [
      "aguarde",
      "sem_espera",
      "em_andamento",
      "ja_concluido",
      "reembolso_mudou",
    ]) {
      expect(lerSaidaAposEspera({ resultado }).gravou).toBe(false);
    }
    const aguarde = lerSaidaAposEspera({ resultado: "aguarde" });
    expect(!aguarde.gravou && aguarde.aviso).toContain(
      "Ainda não passaram 7 dias",
    );
    // Forma inesperada (ou chave do protótipo) também é "nada gravado".
    for (const v of [null, undefined, "ok", {}, { resultado: "toString" }]) {
      const s = lerSaidaAposEspera(v);
      expect(s).toEqual({
        gravou: false,
        aviso: "O reembolso mudou. Os dados foram atualizados.",
      });
    }
  });
});

// ---------------------------------------------------------------------------
describe("ReembolsoDaDevolucao — o painel ganha os botões que o servidor já tinha", () => {
  it("D1: falhou e nada saiu — 'Tentar de novo' chama a reemissão e depois executa a linha nova", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    RESPOSTAS_INVOKE = [
      {
        data: { resultado: "reemitido", refund_id: "refund-2" },
        error: null,
      },
      { data: { status: "em_processamento" }, error: null },
    ];
    await montarBloco();

    expect(texto()).toContain(
      "O reembolso de R$ 50,00 não foi concluído pelo Mercado Pago.",
    );
    await clicar(botao("Tentar de novo"));

    const invokes = CHAMADAS.filter((c) => c.tipo === "invoke");
    expect(invokes).toEqual([
      {
        tipo: "invoke",
        nome: "estornar-pagamento",
        argumentos: {
          body: {
            acao: "reemitir",
            devolucao_id: "dev-1",
            refund_esperado: "refund-1",
          },
        },
      },
      {
        tipo: "invoke",
        nome: "estornar-pagamento",
        argumentos: { body: { refund_id: "refund-2" } },
      },
    ]);
    expect(aoMudar).toHaveBeenCalled();
  });

  it("D2: falhou e nada saiu — 'Já devolvi por fora' chama a RPC normal com a linha esperada", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    RESPOSTA_ACAO = {
      data: { resultado: "combinado", detalhe: "ok", risco_de_dobro: false },
      error: null,
    };
    await montarBloco();

    await clicar(botao("Já devolvi por fora"));

    expect(CHAMADAS).toEqual([
      {
        tipo: "rpc",
        nome: "admin_devolucao_reembolso_por_fora",
        argumentos: {
          p_devolucao_id: "dev-1",
          p_refund_esperado: "refund-1",
        },
      },
    ]);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("D3: pode ter saído — SEM 'Tentar de novo' e sem 'por fora' normal; só 'não repita'", async () => {
    LINHA_DO_SALDO = linha({ pode_ter_saido: true });
    await montarBloco();

    expect(texto()).toContain(
      "A loja está confirmando com o Mercado Pago, não repita.",
    );
    expect(botao("Tentar de novo")).toBeUndefined();
    expect(botao("Já devolvi por fora")).toBeUndefined();
  });

  it("D4: servidor liberou os 7 dias — confirmação forte e RPC com a frase fixa", async () => {
    LINHA_DO_SALDO = linha({
      pode_ter_saido: true,
      por_fora_apos_espera_liberado: true,
    });
    await montarBloco();

    // Retorno REAL de admin_devolucao_reembolso_por_fora_apos_espera (20261241).
    RESPOSTA_ACAO = {
      data: {
        resultado: "combinado",
        detalhe: "apos_espera",
        risco_de_dobro: true,
        refund_id: "refund-1",
      },
      error: null,
    };
    expect(botao("Tentar de novo")).toBeUndefined();
    const promptMock = vi.fn().mockReturnValue("outra coisa");
    vi.stubGlobal("prompt", promptMock);
    await clicar(botao("Já devolvi por fora (depois de 7 dias)"));
    expect(CHAMADAS).toEqual([]);
    expect(promptMock.mock.calls[0][0]).toContain("o cliente recebe em dobro");

    promptMock.mockReturnValue("DEVOLVI POR FORA");
    await clicar(botao("Já devolvi por fora (depois de 7 dias)"));

    expect(CHAMADAS).toEqual([
      {
        tipo: "rpc",
        nome: "admin_devolucao_reembolso_por_fora_apos_espera",
        argumentos: {
          p_devolucao_id: "dev-1",
          p_refund_esperado: "refund-1",
          p_confirmacao: "DEVOLVI POR FORA",
        },
      },
    ]);
    // Nenhum pedido ao Mercado Pago na saída por fora.
    expect(CHAMADAS.some((c) => c.tipo === "invoke")).toBe(false);
    expect(toastMock.warning).toHaveBeenCalledWith(
      expect.stringContaining("Registrado como devolvido por fora."),
    );
  });

  it("D4c: servidor RECUSA a saída dos 7 dias sem erro (`resultado: aguarde`) — a tela não diz 'registrado'", async () => {
    LINHA_DO_SALDO = linha({
      pode_ter_saido: true,
      por_fora_apos_espera_liberado: true,
    });
    RESPOSTA_ACAO = {
      data: {
        resultado: "aguarde",
        detalhe: "antes_de_7_dias",
        refund_id: "refund-1",
        liberado_a_partir_de: "2026-10-22T10:00:00Z",
      },
      error: null,
    };
    await montarBloco();
    vi.stubGlobal("prompt", vi.fn().mockReturnValue("DEVOLVI POR FORA"));

    await clicar(botao("Já devolvi por fora (depois de 7 dias)"));

    expect(CHAMADAS).toHaveLength(1);
    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(toastMock.info).toHaveBeenCalledWith(
      expect.stringContaining("Ainda não passaram 7 dias"),
    );
    // A ficha relê mesmo na recusa.
    expect(aoMudar).toHaveBeenCalled();
  });

  it("D4b: booleano do servidor false — sem saída dos 7 dias; marca de uso preenchida — só 'já registrado'", async () => {
    LINHA_DO_SALDO = linha({ pode_ter_saido: true });
    await montarBloco();
    expect(botao("Já devolvi por fora")).toBeUndefined();

    LINHA_DO_SALDO = linha({
      pode_ter_saido: true,
      por_fora_apos_espera_liberado: true,
      por_fora_liberado_em: "2026-10-16T10:00:00Z",
    });
    await montarBloco(detalhe({ updated_at: "2026-10-16T10:00:00Z" }));
    expect(texto()).toContain("Você já registrou que devolveu por fora.");
    expect(hospedeiro.querySelectorAll("button")).toHaveLength(0);
  });

  it("D5: em andamento — só o texto, nenhum botão", async () => {
    LINHA_DO_SALDO = linha({
      status: "em_processamento",
      pode_ter_saido: true,
    });
    await montarBloco();

    expect(texto()).toContain("Reembolso de R$ 50,00 em andamento");
    expect(hospedeiro.querySelectorAll("button")).toHaveLength(0);
  });

  it("D6: concluído, manual ou sem refund_id — o bloco não aparece", async () => {
    LINHA_DO_SALDO = linha({ status: "concluido" });
    await montarBloco();
    expect(hospedeiro.textContent).toBe("");

    LINHA_DO_SALDO = linha();
    await montarBloco(detalhe({ reembolso_manual: true, refund_id: null }));
    expect(hospedeiro.textContent).toBe("");
  });

  it("D7: reemissão que o banco manda resolver por fora — avisa e NÃO executa nada", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    RESPOSTAS_INVOKE = [
      {
        data: {
          resultado: "use_por_fora",
          detalhe: "sem_prova_de_que_nao_saiu",
        },
        error: null,
      },
    ];
    await montarBloco();
    await clicar(botao("Tentar de novo"));

    expect(CHAMADAS.filter((c) => c.tipo === "invoke")).toHaveLength(1);
    expect(toastMock.warning).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("texto da cliente — só diz 'liberado' com o dinheiro confirmado", () => {
  it("C1: instrucaoParaOCliente — 'liberado' só com a linha concluída", () => {
    const d = detalhe();
    expect(instrucaoParaOCliente(d, {}, "concluido")).toContain(
      "liberado pelo Mercado Pago",
    );
    for (const status of [null, "solicitado", "em_processamento", "falhou"]) {
      const frase = instrucaoParaOCliente(d, {}, status);
      expect(frase).not.toContain("liberado");
      expect(frase).toBe(
        "A loja está confirmando sua devolução com o Mercado Pago.",
      );
    }
  });

  it("C2: reembolso manual continua 'combinado com a loja'", () => {
    const d = detalhe({ reembolso_manual: true, refund_id: null });
    expect(instrucaoParaOCliente(d, {})).toContain("combinado com a loja");
  });

  async function montarCartaoDaCliente() {
    const { DevolucaoDoPedidoCard } = await import(
      "@/components/devolucao/DevolucaoDoPedidoCard"
    );
    await act(async () => {
      raiz.render(
        createElement(DevolucaoDoPedidoCard, {
          atual: detalhe(),
          anteriores: [],
          enderecoDaLoja: null,
          horarioDaLoja: null,
          onCancelar: vi.fn(),
          onInformarEnvio: vi.fn(),
        }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("C3: cartão da cliente com a linha ainda em processamento diz que a loja está confirmando", async () => {
    STATUS_DA_LINHA_CLIENTE = "em_processamento";
    await montarCartaoDaCliente();

    expect(texto()).toContain(
      "A loja está confirmando sua devolução com o Mercado Pago.",
    );
    expect(texto()).not.toContain("liberado pelo Mercado Pago");
  });

  it("C4: cartão da cliente com a linha concluída diz 'liberado'", async () => {
    STATUS_DA_LINHA_CLIENTE = "concluido";
    await montarCartaoDaCliente();

    expect(texto()).toContain("liberado pelo Mercado Pago");
  });
});
