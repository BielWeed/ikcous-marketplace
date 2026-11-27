// @vitest-environment jsdom
//
// `solicitarEstorno` com a rede "pendurada" (conecta e não responde). Antes, a
// RPC `solicitar_estorno` e a edge `estornar-pagamento` não tinham prazo: o
// botão ficava em "Devolvendo…" para sempre, sem aviso e sem releitura.
//
// É DINHEIRO. Estourar o prazo NÃO prova que nada foi gravado: a RPC pode ter
// criado a linha do estorno (e o cron a executa em até 10 minutos). Por isso:
//   - a tela NUNCA aciona o Mercado Pago depois de um estouro da RPC (ela nem
//     sabe o id da linha), nem quando a resposta tardia chega;
//   - relê o saldo e as linhas e só ENTÃO solta o botão ("enviando" segue
//     verdadeiro até a releitura terminar) — o botão volta a valer com o
//     estado real, a linha do estorno aparecendo se ela existir;
//   - a releitura pendurada também tem prazo (15 s) e cai no erro de leitura,
//     que esconde o botão de devolver.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SALDO_PADRAO = {
  total: 100,
  valor_estornado: 0,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel: 100,
  reservado_por_fora: 0,
  linhas: [],
};

const h = vi.hoisted(() => ({
  linhas: [] as Record<string, unknown>[],
  saldo: null as unknown,
  leituraPendurada: false,
  respostaRpc: null as null | (() => Promise<unknown>),
  respostaInvoke: null as null | (() => Promise<unknown>),
  chamadas: [] as Array<{ tipo: "rpc" | "invoke"; nome: string }>,
  leituras: 0,
}));

const nuncaResponde = () => new Promise<never>(() => undefined);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () => {
        h.leituras += 1;
        return h.leituraPendurada
          ? nuncaResponde()
          : Promise.resolve({ data: h.linhas, error: null });
      };
      return builder;
    },
    rpc: (nome: string) => {
      if (nome === "pedido_reembolsos_e_saldo") {
        return h.leituraPendurada
          ? nuncaResponde()
          : Promise.resolve({ data: h.saldo, error: null });
      }
      h.chamadas.push({ tipo: "rpc", nome });
      return h.respostaRpc
        ? h.respostaRpc()
        : Promise.resolve({ data: { refund_id: "refund-1" }, error: null });
    },
    functions: {
      invoke: (nome: string) => {
        h.chamadas.push({ tipo: "invoke", nome });
        return h.respostaInvoke
          ? h.respostaInvoke()
          : Promise.resolve({ data: { status: "concluido" }, error: null });
      },
    },
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

const PRAZO_DA_RPC_MS = 20_000;
const PRAZO_DA_EDGE_MS = 30_000;
const PRAZO_DA_LEITURA_MS = 15_000;

interface Leitura {
  linhas: Array<{ id: string; status: string; amount: number }>;
  disponivel: number;
  erro: boolean;
  enviando: boolean;
  solicitarEstorno: (args: {
    amount: number;
    motivo: string;
    repetindo?: string;
  }) => Promise<void>;
}

const raizes: Array<{ unmount: () => void }> = [];

async function montarSonda() {
  const { useEstornosDoPedido } = await import("@/hooks/useEstornosDoPedido");
  const leituras: Leitura[] = [];
  function Sonda() {
    leituras.push(useEstornosDoPedido("pedido-1") as unknown as Leitura);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  raizes.push(root);
  await act(async () => {
    root.render(createElement(Sonda));
  });
  await passar(0);
  return () => leituras[leituras.length - 1] as Leitura;
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function pendurada() {
  let resolver: (valor: unknown) => void = () => undefined;
  const promessa = new Promise<unknown>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const linhaSolicitada = {
  id: "refund-1",
  amount: 100,
  status: "solicitado",
  solicitado_por: "lojista",
  mp_status: null,
  mp_status_detail: null,
  tentativas: 0,
  ultimo_erro: null,
  motivo: null,
  created_at: "2026-11-27T10:00:00.000Z",
  concluido_em: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.linhas = [];
  h.saldo = SALDO_PADRAO;
  h.leituraPendurada = false;
  h.respostaRpc = null;
  h.respostaInvoke = null;
  h.chamadas = [];
  h.leituras = 0;
});

afterEach(() => {
  for (const raiz of raizes.splice(0)) {
    act(() => {
      raiz.unmount();
    });
  }
  document.body.innerHTML = "";
  // A chave da devolução (src/lib/chave-da-devolucao.ts) mora no localStorage.
  localStorage.clear();
  vi.useRealTimers();
});

describe("useEstornosDoPedido — ações com prazo, sem estorno em dobro", () => {
  it.each([
    { caso: "solicitar_estorno_com_chave", repetindo: undefined },
    { caso: "solicitar_estorno_repetindo", repetindo: "refund-falhou" },
  ])(
    "$caso pendurada: em 20 s avisa que não dá para saber, relê e só então solta — sem acionar o Mercado Pago",
    async ({ caso, repetindo }) => {
      h.respostaRpc = () => pendurada().promessa;
      const atual = await montarSonda();
      expect(h.leituras).toBe(1);

      await act(async () => {
        void atual().solicitarEstorno({
          amount: 100,
          motivo: "",
          ...(repetindo ? { repetindo } : {}),
        });
      });
      await passar(PRAZO_DA_RPC_MS - 1);
      expect(atual().enviando).toBe(true);
      expect(h.leituras).toBe(1);

      // O servidor criou a linha; a resposta é que não chegou.
      h.linhas = [linhaSolicitada];
      h.saldo = { ...SALDO_PADRAO, em_voo: 100, disponivel: 0 };
      await passar(1);

      expect(h.chamadas).toEqual([{ tipo: "rpc", nome: caso }]);
      expect(h.leituras).toBe(2);
      expect(atual().enviando).toBe(false);
      expect(atual().linhas.map((l) => l.id)).toEqual(["refund-1"]);
      expect(atual().disponivel).toBe(0);
      expect(toastMock.warning).toHaveBeenCalledTimes(1);
      expect(toastMock.warning.mock.calls[0]?.[0]).toMatch(
        /Não dá para saber se a devolução foi registrada/,
      );
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(toastMock.error).not.toHaveBeenCalled();
    },
  );

  it("estourou a RPC e a releitura também pendura: 'enviando' segura até a releitura estourar e cai no erro de leitura", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const atual = await montarSonda();
    await act(async () => {
      void atual().solicitarEstorno({ amount: 100, motivo: "" });
    });

    h.leituraPendurada = true;
    await passar(PRAZO_DA_RPC_MS);
    await passar(PRAZO_DA_LEITURA_MS - 1);
    // Sem o estado real na tela, o botão não volta a valer.
    expect(atual().enviando).toBe(true);
    expect(atual().erro).toBe(false);

    await passar(1);
    expect(atual().enviando).toBe(false);
    expect(atual().erro).toBe(true);
    expect(h.chamadas.filter((c) => c.tipo === "invoke")).toEqual([]);
  });

  it("a releitura do estouro descartada por outra leitura ainda em voo NÃO solta o botão sobre o saldo antigo", async () => {
    // Uma devolução anterior em andamento liga a releitura ao voltar à aba.
    h.linhas = [{ ...linhaSolicitada, id: "refund-antigo", amount: 10 }];
    h.saldo = { ...SALDO_PADRAO, em_voo: 10, disponivel: 90 };
    h.respostaRpc = () => pendurada().promessa;
    const atual = await montarSonda();
    expect(atual().disponivel).toBe(90);
    await act(async () => {
      void atual().solicitarEstorno({ amount: 90, motivo: "" });
    });

    h.leituraPendurada = true;
    await passar(PRAZO_DA_RPC_MS); // estourou: a releitura desta ação começa
    await passar(10_000);
    // A lojista volta à aba: outra leitura começa e passa na frente.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await passar(PRAZO_DA_LEITURA_MS - 10_000);
    // A releitura da ação foi descartada e a outra ainda não chegou: a tela só
    // tem o saldo de ANTES do toque, então o botão continua preso.
    expect(atual().disponivel).toBe(90);
    expect(atual().enviando).toBe(true);

    // Com a rede pendurada o relógio de 15 s segue atropelando as leituras: a
    // tela tenta no máximo 3 releituras e para no erro de leitura, que esconde
    // o botão de devolver — nunca o solta sobre o saldo de antes do toque.
    await passar(2 * PRAZO_DA_LEITURA_MS + 1);
    expect(atual().enviando).toBe(false);
    expect(atual().erro).toBe(true);
    expect(h.chamadas).toEqual([
      { tipo: "rpc", nome: "solicitar_estorno_com_chave" },
    ]);
  });

  it("durante a releitura do estouro, um 2º toque não chama a RPC de novo", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const atual = await montarSonda();
    await act(async () => {
      void atual().solicitarEstorno({ amount: 100, motivo: "" });
    });
    h.leituraPendurada = true;
    await passar(PRAZO_DA_RPC_MS);

    await act(async () => {
      void atual().solicitarEstorno({ amount: 100, motivo: "" });
    });

    expect(h.chamadas).toEqual([
      { tipo: "rpc", nome: "solicitar_estorno_com_chave" },
    ]);
    await passar(PRAZO_DA_LEITURA_MS);
  });

  it("a resposta TARDIA da RPC abandonada só relê: nunca aciona o Mercado Pago nem avisa de novo", async () => {
    const rpc = pendurada();
    h.respostaRpc = () => rpc.promessa;
    const atual = await montarSonda();
    await act(async () => {
      void atual().solicitarEstorno({ amount: 100, motivo: "" });
    });
    await passar(PRAZO_DA_RPC_MS);
    expect(h.leituras).toBe(2);

    h.linhas = [linhaSolicitada];
    h.saldo = { ...SALDO_PADRAO, em_voo: 100, disponivel: 0 };
    await act(async () => {
      rpc.resolver({ data: { refund_id: "refund-1" }, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(h.chamadas.filter((c) => c.tipo === "invoke")).toEqual([]);
    expect(h.leituras).toBe(3);
    expect(atual().linhas.map((l) => l.id)).toEqual(["refund-1"]);
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("edge pendurada depois da linha criada: em 30 s diz que o cron aciona, relê e solta", async () => {
    h.respostaInvoke = () => pendurada().promessa;
    const atual = await montarSonda();
    await act(async () => {
      void atual().solicitarEstorno({ amount: 100, motivo: "" });
    });
    await passar(PRAZO_DA_EDGE_MS - 1);
    expect(atual().enviando).toBe(true);
    expect(toastMock.info).not.toHaveBeenCalled();

    h.linhas = [linhaSolicitada];
    h.saldo = { ...SALDO_PADRAO, em_voo: 100, disponivel: 0 };
    await passar(1);

    expect(h.chamadas).toEqual([
      { tipo: "rpc", nome: "solicitar_estorno_com_chave" },
      { tipo: "invoke", nome: "estornar-pagamento" },
    ]);
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    expect(toastMock.info.mock.calls[0]?.[0]).toMatch(
      /o Mercado Pago é acionado em até 10 minutos/,
    );
    expect(atual().enviando).toBe(false);
    expect(atual().disponivel).toBe(0);
    expect(atual().linhas.map((l) => l.id)).toEqual(["refund-1"]);
  });

  it("resposta normal dentro do prazo: igual a antes, sem temporizador de prazo sobrando", async () => {
    const atual = await montarSonda();
    await act(async () => {
      await atual().solicitarEstorno({ amount: 100, motivo: "" });
    });

    expect(h.chamadas).toEqual([
      { tipo: "rpc", nome: "solicitar_estorno_com_chave" },
      { tipo: "invoke", nome: "estornar-pagamento" },
    ]);
    expect(atual().enviando).toBe(false);
    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
