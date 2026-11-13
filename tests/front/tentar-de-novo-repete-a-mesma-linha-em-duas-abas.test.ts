// @vitest-environment jsdom
//
// "Tentar de novo" numa devolução que falhou (DINHEIRO). Defeito: o botão chamava `solicitar_estorno`, que NÃO diz qual
// linha falhada está sendo repetida; em duas abas (ou duas pessoas da loja) na MESMA falhada de R$ 30, cada toque criava
// uma linha nova e o Mercado Pago recebia DOIS pedidos de R$ 30 (a chave de idempotência é o id da linha): podiam sair
// R$ 60. Agora o toque manda o id da linha falhada para `solicitar_estorno_repetindo` (migration 20261399991000): o valor
// sai da linha, a segunda chamada volta com `ja_repetida` e o MESMO refund_id, e só quem criou a repetição aciona o
// Mercado Pago.
//
// O servidor aqui é um dublê com a semântica do banco (a PROVA do banco está em
// tests/banco/repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-viva.cjs): `solicitar_estorno` cria uma linha a cada
// chamada; `solicitar_estorno_repetindo` cria UMA repetição por falhada e devolve a mesma nas chamadas seguintes.
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface LinhaDoServidor {
  id: string;
  amount: number;
  status: string;
  repetidaPor: string | null;
}

type ArgumentosDaRpc = Record<string, unknown>;
type Chamada =
  | { tipo: "rpc"; nome: string; argumentos: ArgumentosDaRpc }
  | { tipo: "invoke"; nome: string; argumentos: unknown };

let SERVIDOR: LinhaDoServidor[] = [];
let CONTADOR = 0;
let CHAMADAS: Chamada[] = [];
let RESPOSTA_FORCADA: unknown = null;

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

function nascer(amount: number): LinhaDoServidor {
  CONTADOR += 1;
  const linha = {
    id: `nova-${CONTADOR}`,
    amount,
    status: "solicitado",
    repetidaPor: null,
  };
  SERVIDOR.push(linha);
  return linha;
}

/** O que o banco responde (semântica de solicitar_estorno e de solicitar_estorno_repetindo). */
function servidor(nome: string, argumentos: ArgumentosDaRpc) {
  if (nome === "solicitar_estorno") {
    const nova = nascer(Number(argumentos.p_amount));
    return { data: { refund_id: nova.id, amount: nova.amount }, error: null };
  }
  const origem = SERVIDOR.find((l) => l.id === argumentos.p_refund_id);
  if (!origem) {
    return { data: null, error: { message: "Devolução não encontrada." } };
  }
  const jaFeita = SERVIDOR.find((l) => l.id === origem.repetidaPor);
  if (jaFeita) {
    return {
      data: {
        refund_id: jaFeita.id,
        amount: origem.amount,
        ja_repetida: true,
        status: jaFeita.status,
      },
      error: null,
    };
  }
  const nova = nascer(origem.amount);
  origem.repetidaPor = nova.id;
  return {
    data: {
      refund_id: nova.id,
      amount: nova.amount,
      ja_repetida: false,
      refund_anterior: origem.id,
    },
    error: null,
  };
}

function criarBuilderLinhas() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve({ data: [], error: null }).then(
      resolve as never,
      reject as never,
    );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => criarBuilderLinhas()),
    rpc: vi.fn((nome: string, argumentos: ArgumentosDaRpc) => {
      if (nome === "pedido_reembolsos_e_saldo") {
        return Promise.resolve({ data: SALDO_PADRAO, error: null });
      }
      CHAMADAS.push({ tipo: "rpc", nome, argumentos });
      if (RESPOSTA_FORCADA) return Promise.resolve(RESPOSTA_FORCADA);
      // Assíncrono de propósito: as duas abas se entrelaçam como duas requisições de verdade.
      return new Promise((resolve) => {
        setTimeout(() => resolve(servidor(nome, argumentos)), 0);
      });
    }),
    functions: {
      invoke: vi.fn((nome: string, argumentos: unknown) => {
        CHAMADAS.push({ tipo: "invoke", nome, argumentos });
        return Promise.resolve({ data: { status: "concluido" }, error: null });
      }),
    },
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

interface LeituraDoHook {
  solicitarEstorno: (args: {
    amount: number;
    motivo: string;
    repetindo?: string;
  }) => Promise<void>;
  enviando: boolean;
}

const raizes: Array<{ unmount: () => void }> = [];

/** Uma "aba": uma instância própria do hook (cada uma com a SUA trava de clique duplo). */
async function abrirAba(orderId = "pedido-1") {
  const { useEstornosDoPedido } = await import("@/hooks/useEstornosDoPedido");
  const leituras: LeituraDoHook[] = [];

  function Sonda() {
    leituras.push(useEstornosDoPedido(orderId) as unknown as LeituraDoHook);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  raizes.push(root);
  await act(async () => {
    root.render(createElement(Sonda));
  });
  await act(async () => {});
  return { atual: () => leituras[leituras.length - 1] };
}

const rpcs = () =>
  CHAMADAS.filter(
    (c): c is Extract<Chamada, { tipo: "rpc" }> => c.tipo === "rpc",
  );
const invokes = () => CHAMADAS.filter((c) => c.tipo === "invoke");

beforeEach(() => {
  vi.clearAllMocks();
  CHAMADAS = [];
  CONTADOR = 0;
  RESPOSTA_FORCADA = null;
  // A linha que falhou (R$ 30) e da qual o Mercado Pago garantiu que nada saiu.
  SERVIDOR = [
    { id: "falhada-1", amount: 30, status: "falhou", repetidaPor: null },
  ];
});

afterEach(() => {
  for (const raiz of raizes.splice(0)) {
    act(() => {
      raiz.unmount();
    });
  }
  document.body.innerHTML = "";
});

describe("Tentar de novo — a mesma linha falhada, duas abas", () => {
  it("DUAS ABAS tocam na MESMA falhada de R$ 30: só UMA repetição existe e o Mercado Pago é acionado UMA vez", async () => {
    const abaA = await abrirAba();
    const abaB = await abrirAba();

    await act(async () => {
      await Promise.all([
        abaA
          .atual()
          .solicitarEstorno({ amount: 30, motivo: "", repetindo: "falhada-1" }),
        abaB
          .atual()
          .solicitarEstorno({ amount: 30, motivo: "", repetindo: "falhada-1" }),
      ]);
    });

    // O servidor tem UMA linha viva de R$ 30 (R$ 60 era o defeito)
    expect(
      SERVIDOR.filter((l) => l.status === "solicitado").map((l) => l.amount),
    ).toEqual([30]);
    // ... e o Mercado Pago é acionado UMA vez, com o id dessa linha
    expect(invokes()).toEqual([
      {
        tipo: "invoke",
        nome: "estornar-pagamento",
        argumentos: { body: { refund_id: "nova-1" } },
      },
    ]);
    // Nenhuma das duas abas usou o caminho antigo, que não sabe qual linha repete
    expect(rpcs().map((c) => c.nome)).toEqual([
      "solicitar_estorno_repetindo",
      "solicitar_estorno_repetindo",
    ]);
    // A aba que chegou depois avisa, em português, que já foi repetida
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    expect(String(toastMock.info.mock.calls[0]?.[0])).toContain(
      `Pedido #${numeroDoPedido("pedido-1")}: esta devolução já foi repetida`,
    );
  });

  it("o toque manda SÓ o id da linha falhada (o valor sai do servidor) e depois aciona o Mercado Pago com a linha nova", async () => {
    const aba = await abrirAba();

    await act(async () => {
      await aba
        .atual()
        .solicitarEstorno({ amount: 30, motivo: "", repetindo: "falhada-1" });
    });

    expect(CHAMADAS).toEqual([
      {
        tipo: "rpc",
        nome: "solicitar_estorno_repetindo",
        argumentos: { p_refund_id: "falhada-1", p_motivo: "" },
      },
      {
        tipo: "invoke",
        nome: "estornar-pagamento",
        argumentos: { body: { refund_id: "nova-1" } },
      },
    ]);
  });

  it("o botão que sobrou depois do sucesso: tocar de novo na falhada antiga não aciona o Mercado Pago outra vez", async () => {
    const aba = await abrirAba();
    await act(async () => {
      await aba
        .atual()
        .solicitarEstorno({ amount: 30, motivo: "", repetindo: "falhada-1" });
    });
    // O Mercado Pago confirmou a repetição; a linha antiga segue 'falhou' na tela.
    const repeticao = SERVIDOR.find((l) => l.id === "nova-1");
    if (repeticao) repeticao.status = "concluido";

    await act(async () => {
      await aba
        .atual()
        .solicitarEstorno({ amount: 30, motivo: "", repetindo: "falhada-1" });
    });

    expect(invokes()).toHaveLength(1);
    expect(SERVIDOR.filter((l) => l.status !== "falhou")).toHaveLength(1);
  });

  it("ja_repetida: nenhum invoke e o aviso leva o número do pedido", async () => {
    RESPOSTA_FORCADA = {
      data: {
        refund_id: "nova-9",
        amount: 30,
        ja_repetida: true,
        status: "solicitado",
      },
      error: null,
    };
    const aba = await abrirAba("pedido-7");

    await act(async () => {
      await aba
        .atual()
        .solicitarEstorno({ amount: 30, motivo: "", repetindo: "falhada-1" });
    });

    expect(invokes()).toHaveLength(0);
    expect(toastMock.info).toHaveBeenCalledWith(
      `Pedido #${numeroDoPedido("pedido-7")}: esta devolução já foi repetida (por outra aba ou por outra pessoa da loja). Acompanhe a linha mais nova.`,
    );
  });

  it("recusa do banco (ex.: o dinheiro pode já ter saído): toast com a frase do banco, nenhum invoke", async () => {
    RESPOSTA_FORCADA = {
      data: null,
      error: {
        message:
          "A loja está confirmando esta devolução com o Mercado Pago, não repita.",
      },
    };
    const aba = await abrirAba();

    await act(async () => {
      await aba
        .atual()
        .solicitarEstorno({ amount: 30, motivo: "", repetindo: "falhada-1" });
    });

    expect(invokes()).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalledWith(
      `Devolução do pedido #${numeroDoPedido("pedido-1")}: A loja está confirmando esta devolução com o Mercado Pago, não repita.`,
    );
  });

  it("controle: sem `repetindo` o caminho de sempre segue (solicitar_estorno com o valor)", async () => {
    const aba = await abrirAba();

    await act(async () => {
      await aba.atual().solicitarEstorno({ amount: 50, motivo: "teste" });
    });

    expect(rpcs()).toEqual([
      {
        tipo: "rpc",
        nome: "solicitar_estorno",
        argumentos: { p_order_id: "pedido-1", p_amount: 50, p_motivo: "teste" },
      },
    ]);
    expect(invokes()).toHaveLength(1);
  });
});
