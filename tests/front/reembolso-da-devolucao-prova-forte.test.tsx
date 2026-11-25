// @vitest-environment jsdom
//
// Provas fortes do bloco de reembolso da ficha da devolução
// (ReembolsoDaDevolucao). É dinheiro: o que a lojista confirma na janelinha, de
// qual pedido o saldo foi lido, qual aviso cada resposta do servidor vira, e a
// resposta atrasada de uma leitura antiga que NÃO pode desfazer a mais nova.
// Valores escritos à mão.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerDevolucaoDetalhe } from "@/lib/devolucao";
import type { DevolucaoDetalhe } from "@/types/devolucao";

type Chamada = { tipo: "rpc" | "invoke"; nome: string; argumentos: unknown };
let CHAMADAS: Chamada[] = [];
let LEITURAS_DO_SALDO: Array<(v: unknown) => void> = [];
let SALDO_IMEDIATO: unknown = null;
let RESPOSTA_ACAO: unknown = { data: null, error: null };
let RESPOSTAS_INVOKE: Array<() => Promise<unknown>> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string, argumentos: unknown) => {
      CHAMADAS.push({ tipo: "rpc", nome, argumentos });
      if (nome === "pedido_reembolsos_e_saldo") {
        if (SALDO_IMEDIATO !== null) {
          return Promise.resolve({ data: SALDO_IMEDIATO, error: null });
        }
        return new Promise((resolver) => {
          LEITURAS_DO_SALDO.push((data) => resolver({ data, error: null }));
        });
      }
      return Promise.resolve(RESPOSTA_ACAO);
    }),
    functions: {
      invoke: vi.fn((nome: string, argumentos: unknown) => {
        CHAMADAS.push({ tipo: "invoke", nome, argumentos });
        const proxima = RESPOSTAS_INVOKE.shift();
        return proxima
          ? proxima()
          : Promise.resolve({ data: null, error: null });
      }),
    },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
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

function saldoCom(linhas: unknown[]) {
  return {
    total: 100,
    valor_estornado: 0,
    em_voo: 0,
    em_duvida: 0,
    manual: 0,
    disponivel: 100,
    reservado_por_fora: 0,
    linhas,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoMudar = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  CHAMADAS = [];
  LEITURAS_DO_SALDO = [];
  SALDO_IMEDIATO = saldoCom([linha()]);
  RESPOSTA_ACAO = { data: null, error: null };
  RESPOSTAS_INVOKE = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

function botao(alvo: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").includes(alvo),
  );
}

async function esperar() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((r) => setTimeout(r, 0));
  });
}

async function clicar(b: HTMLButtonElement | undefined) {
  await act(async () => {
    b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await esperar();
}

async function montar(d: DevolucaoDetalhe = detalhe()) {
  const { ReembolsoDaDevolucao } = await import(
    "@/components/admin/devolucoes/ReembolsoDaDevolucao"
  );
  await act(async () => {
    raiz.render(createElement(ReembolsoDaDevolucao, { detalhe: d, aoMudar }));
  });
  await esperar();
  return (novo: DevolucaoDetalhe) =>
    act(async () => {
      raiz.render(
        createElement(ReembolsoDaDevolucao, { detalhe: novo, aoMudar }),
      );
    });
}

describe("Reembolso da devolução — de qual pedido o saldo é lido", () => {
  it("lê o saldo do PEDIDO da devolução (não da devolução) e só mostra a linha do reembolso dela", async () => {
    SALDO_IMEDIATO = saldoCom([
      linha({ id: "refund-de-outra-devolucao", amount: 999 }),
      linha(),
    ]);
    await montar();

    const leituras = CHAMADAS.filter(
      (c) => c.nome === "pedido_reembolsos_e_saldo",
    );
    expect(leituras).toHaveLength(1);
    expect(leituras[0].argumentos).toEqual({ p_order_id: "pedido-1" });
    // a linha certa (R$ 50,00), nunca a de outra devolução do mesmo pedido
    expect(texto()).toMatch(/O reembolso de R\$\s50,00 não foi concluído/);
    expect(texto()).not.toContain("999");
  });
});

describe("Reembolso da devolução — leitura atrasada não desfaz a mais nova", () => {
  it("a resposta lenta da 1ª leitura chega depois da 2ª e é descartada", async () => {
    SALDO_IMEDIATO = null; // cada leitura fica pendurada até eu soltar
    const rerenderizar = await montar();
    expect(LEITURAS_DO_SALDO).toHaveLength(1);

    // a ficha relê (objeto `detalhe` novo): segunda leitura
    await rerenderizar(detalhe());
    await esperar();
    expect(LEITURAS_DO_SALDO).toHaveLength(2);

    // a 2ª responde primeiro: o dinheiro já saiu, não há o que decidir
    await act(async () => {
      LEITURAS_DO_SALDO[1](saldoCom([linha({ status: "concluido" })]));
    });
    await esperar();
    expect(botao("Tentar de novo")).toBeUndefined();
    expect(texto()).toBe("");

    // a 1ª (velha: "falhou") chega tarde e NÃO pode trazer os botões de volta
    await act(async () => {
      LEITURAS_DO_SALDO[0](saldoCom([linha({ status: "falhou" })]));
    });
    await esperar();
    expect(botao("Tentar de novo")).toBeUndefined();
    expect(botao("Já devolvi por fora")).toBeUndefined();
    expect(texto()).toBe("");
  });
});

describe("Reembolso da devolução — o que a lojista confirma antes de mexer em dinheiro", () => {
  it("'Tentar de novo' pergunta o valor certo e, se ela recusar, nada é enviado", async () => {
    const confirmar = vi.fn((_pergunta: string) => false);
    vi.stubGlobal("confirm", confirmar);
    await montar();

    await clicar(botao("Tentar de novo"));
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][0]).toMatch(
      /^Pedir de novo ao Mercado Pago o reembolso de R\$\s50,00\? O app confere antes se o anterior não saiu\.$/,
    );
    expect(CHAMADAS.filter((c) => c.tipo === "invoke")).toEqual([]);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("'Já devolvi por fora' pergunta o valor certo e, se ela recusar, nada é gravado", async () => {
    const confirmar = vi.fn((_pergunta: string) => false);
    vi.stubGlobal("confirm", confirmar);
    await montar();

    await clicar(botao("Já devolvi por fora"));
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][0]).toMatch(
      /^Registrar que você devolveu R\$\s50,00 por fora \(PIX ou dinheiro\)\? O app não pede mais este reembolso ao Mercado Pago\.$/,
    );
    expect(
      CHAMADAS.filter((c) => c.nome === "admin_devolucao_reembolso_por_fora"),
    ).toEqual([]);
  });

  it("o valor da pergunta é o da linha lida, não um valor fixo (R$ 123,45)", async () => {
    SALDO_IMEDIATO = saldoCom([linha({ amount: 123.45 })]);
    const confirmar = vi.fn((_pergunta: string) => false);
    vi.stubGlobal("confirm", confirmar);
    await montar();
    await clicar(botao("Tentar de novo"));
    expect(confirmar.mock.calls[0][0]).toMatch(/reembolso de R\$\s123,45\?/);
  });
});

describe("Reembolso da devolução — cada resposta da reemissão vira o aviso certo", () => {
  async function tentarDeNovoComResposta(corpo: unknown) {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    RESPOSTAS_INVOKE = [() => Promise.resolve({ data: corpo, error: null })];
    await montar();
    await clicar(botao("Tentar de novo"));
  }

  it("'reemitido': sucesso, e o clique manda executar a linha NOVA (não a velha)", async () => {
    RESPOSTAS_INVOKE = [
      () =>
        Promise.resolve({
          data: { resultado: "reemitido", refund_id: "refund-NOVO" },
          error: null,
        }),
      () => Promise.resolve({ data: { status: "concluido" }, error: null }),
    ];
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    await montar();
    await clicar(botao("Tentar de novo"));

    expect(toastMock.success).toHaveBeenCalledWith(
      "Nova tentativa de reembolso registrada. Confira o andamento nesta ficha.",
    );
    const invokes = CHAMADAS.filter((c) => c.tipo === "invoke");
    expect(invokes).toHaveLength(2);
    expect(invokes[0].argumentos).toEqual({
      body: {
        acao: "reemitir",
        devolucao_id: "dev-1",
        refund_esperado: "refund-1",
      },
    });
    expect(invokes[1].argumentos).toEqual({
      body: { refund_id: "refund-NOVO" },
    });
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("'ja_existia': só informa que a devolução mudou (não é erro)", async () => {
    await tentarDeNovoComResposta({ resultado: "ja_existia" });
    expect(toastMock.info).toHaveBeenCalledWith(
      "A devolução mudou. Os dados foram atualizados.",
    );
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    // não refez nada: só a reemissão foi chamada, e a ficha relê
    expect(CHAMADAS.filter((c) => c.tipo === "invoke")).toHaveLength(1);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("'sem_saldo_para_reemitir': erro com a frase exata", async () => {
    await tentarDeNovoComResposta({ resultado: "sem_saldo_para_reemitir" });
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith(
      "O pedido não tem saldo para refazer.",
    );
    expect(CHAMADAS.filter((c) => c.tipo === "invoke")).toHaveLength(1);
  });

  it("'indeterminado': AVISO (não sucesso, não erro) de que nada foi feito", async () => {
    await tentarDeNovoComResposta({ resultado: "indeterminado" });
    expect(toastMock.warning).toHaveBeenCalledWith(
      "O Mercado Pago não confirmou. Nada foi feito; tente mais tarde.",
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("sem 'resultado': mostra a mensagem do servidor; sem mensagem, a genérica", async () => {
    await tentarDeNovoComResposta({ erro: "Pedido não encontrado." });
    expect(toastMock.error).toHaveBeenCalledWith("Pedido não encontrado.");
    vi.clearAllMocks();
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await tentarDeNovoComResposta({});
    expect(toastMock.error).toHaveBeenCalledWith(
      "Não foi possível concluir agora. Tente de novo.",
    );
  });

  it("'combinado' (por fora): sucesso 'Registrado como devolvido por fora.' e manda os ids certos", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    RESPOSTA_ACAO = { data: { resultado: "combinado" }, error: null };
    await montar();
    await clicar(botao("Já devolvi por fora"));

    expect(toastMock.success).toHaveBeenCalledWith(
      "Registrado como devolvido por fora.",
    );
    const gravacao = CHAMADAS.find(
      (c) => c.nome === "admin_devolucao_reembolso_por_fora",
    );
    expect(gravacao?.argumentos).toEqual({
      p_devolucao_id: "dev-1",
      p_refund_esperado: "refund-1",
    });
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });
});

describe("Reembolso da devolução — resposta lenta mas dentro do prazo ainda vale", () => {
  it("a edge que demora 5 s (o prazo é 30 s) é esperada: nada de 'sem resposta da rede'", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    RESPOSTAS_INVOKE = [
      () =>
        new Promise((resolver) => {
          setTimeout(
            () =>
              resolver({
                data: { resultado: "reemitido", refund_id: "refund-NOVO" },
                error: null,
              }),
            5000,
          );
        }),
      () => Promise.resolve({ data: { status: "concluido" }, error: null }),
    ];
    await montar();
    await clicar(botao("Tentar de novo"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    expect(toastMock.success).toHaveBeenCalledWith(
      "Nova tentativa de reembolso registrada. Confira o andamento nesta ficha.",
    );
    expect(toastMock.warning).not.toHaveBeenCalled();
  });
});
