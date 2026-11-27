// @vitest-environment jsdom
//
// A devolução PARCIAL repetida não vira duas devoluções (migration 20261640000000).
//
// O defeito: a lojista devolve R$ 50 de um pedido de R$ 200; a RPC estoura os 20 s na tela, mas o servidor
// ainda grava (esperando a trava do pedido). A releitura mostra R$ 200 e ela devolve R$ 50 de novo: sem uma
// chave da INTENÇÃO, o servidor não tem como saber que é a mesma e cria a segunda linha (o cliente recebe R$ 100).
//
// Aqui: o botão "Devolver" chama `solicitar_estorno_com_chave` com uma chave gerada UMA vez por intenção
// (pedido + valor) e repetida em toda retentativa da mesma intenção — inclusive depois do "não dá para
// saber", de fechar e reabrir a ficha e de recarregar a página. Intenção nova (outro valor, ou depois de o
// servidor confirmar a anterior) = chave nova. O "Tentar de novo" de uma linha falhada segue na
// `solicitar_estorno_repetindo` (o servidor já reconhece a linha), sem chave.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SALDO_PADRAO = {
  total: 200,
  valor_estornado: 0,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel: 200,
  reservado_por_fora: 0,
  linhas: [],
};

type Chamada = {
  tipo: "rpc" | "invoke";
  nome: string;
  args?: Record<string, unknown>;
};

const h = vi.hoisted(() => ({
  linhas: [] as Record<string, unknown>[],
  saldo: null as unknown,
  respostaRpc: null as null | (() => Promise<unknown>),
  chamadas: [] as Chamada[],
  leituras: 0,
  leiturasNoAviso: [] as number[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () => {
        h.leituras += 1;
        return Promise.resolve({ data: h.linhas, error: null });
      };
      return builder;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      if (nome === "pedido_reembolsos_e_saldo") {
        return Promise.resolve({ data: h.saldo, error: null });
      }
      h.chamadas.push({ tipo: "rpc", nome, args });
      return h.respostaRpc
        ? h.respostaRpc()
        : Promise.resolve({
            data: { refund_id: "refund-1", amount: args.p_amount },
            error: null,
          });
    },
    functions: {
      invoke: (nome: string) => {
        h.chamadas.push({ tipo: "invoke", nome });
        return Promise.resolve({ data: { status: "concluido" }, error: null });
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
const PEDIDO = "pedido-1640";

interface Leitura {
  enviando: boolean;
  solicitarEstorno: (args: {
    amount: number;
    motivo: string;
    repetindo?: string;
  }) => Promise<void>;
}

const raizes: Array<{ unmount: () => void }> = [];

async function montarSonda(orderId = PEDIDO) {
  const { useEstornosDoPedido } = await import("@/hooks/useEstornosDoPedido");
  const leituras: Leitura[] = [];
  function Sonda() {
    leituras.push(useEstornosDoPedido(orderId) as unknown as Leitura);
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
  return {
    atual: () => leituras[leituras.length - 1] as Leitura,
    desmontar: () =>
      act(() => {
        root.unmount();
      }),
  };
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

const devolucoes = () =>
  h.chamadas.filter(
    (c) => c.tipo === "rpc" && c.nome === "solicitar_estorno_com_chave",
  );
const chaves = () => devolucoes().map((c) => c.args?.p_chave);

async function devolver(
  atual: () => Leitura,
  amount: number,
  { esperarPrazo = false } = {},
) {
  await act(async () => {
    void atual().solicitarEstorno({ amount, motivo: "devolvi" });
  });
  await passar(esperarPrazo ? PRAZO_DA_RPC_MS : 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  h.linhas = [];
  h.saldo = SALDO_PADRAO;
  h.respostaRpc = null;
  h.chamadas = [];
  h.leituras = 0;
  h.leiturasNoAviso = [];
  toastMock.warning.mockImplementation(() => {
    h.leiturasNoAviso.push(h.leituras);
  });
});

afterEach(() => {
  for (const raiz of raizes.splice(0)) {
    act(() => {
      raiz.unmount();
    });
  }
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useRealTimers();
});

describe("useEstornosDoPedido — a mesma intenção leva a mesma chave", () => {
  it("o DEFEITO: estourou o prazo e a lojista devolve o MESMO valor de novo → a segunda chamada leva a MESMA chave", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const { atual } = await montarSonda();

    await devolver(atual, 50, { esperarPrazo: true });
    // A releitura mostra o saldo cheio (o servidor ainda espera a trava do pedido).
    expect(atual().enviando).toBe(false);
    await devolver(atual, 50, { esperarPrazo: true });

    expect(devolucoes()).toHaveLength(2);
    const [primeira, segunda] = chaves();
    expect(typeof primeira).toBe("string");
    expect(primeira).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(segunda).toBe(primeira);
    expect(devolucoes()[0]?.args).toEqual({
      p_order_id: PEDIDO,
      p_amount: 50,
      p_motivo: "devolvi",
      p_chave: primeira,
    });
    // ninguém mais chama o caminho antigo, sem chave
    expect(h.chamadas.some((c) => c.nome === "solicitar_estorno")).toBe(false);
  });

  it("a mesma intenção sobrevive a fechar e reabrir a ficha (e a recarregar a página)", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const primeira = await montarSonda();
    await devolver(primeira.atual, 50, { esperarPrazo: true });
    primeira.desmontar();

    const segunda = await montarSonda();
    await devolver(segunda.atual, 50, { esperarPrazo: true });

    expect(devolucoes()).toHaveLength(2);
    const [a, b] = chaves();
    expect(a).toEqual(expect.any(String));
    expect(b).toBe(a);
  });

  it("outro valor é outra intenção: chave nova (e a de antes deixa de valer)", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    await devolver(atual, 30, { esperarPrazo: true });
    await devolver(atual, 50, { esperarPrazo: true });

    const [a, b, c] = chaves();
    expect(b).not.toBe(a);
    expect(c).not.toBe(a);
    expect(c).not.toBe(b);
  });

  it("50 e 50,00 são o mesmo valor (centavos), 50,01 não é", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    await devolver(atual, 50.0, { esperarPrazo: true });
    await devolver(atual, 50.01, { esperarPrazo: true });
    const [a, b, c] = chaves();
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("outro pedido nunca herda a chave", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const a = await montarSonda("pedido-A");
    await devolver(a.atual, 50, { esperarPrazo: true });
    const b = await montarSonda("pedido-B");
    await devolver(b.atual, 50, { esperarPrazo: true });
    const [ka, kb] = chaves();
    expect(kb).not.toBe(ka);
  });

  it("o servidor confirmou (refund_id): a próxima devolução, mesmo de igual valor, é intenção NOVA", async () => {
    const { atual } = await montarSonda();
    await devolver(atual, 50);
    await devolver(atual, 50);
    const [a, b] = chaves();
    expect(b).not.toBe(a);
    expect(
      h.chamadas.filter((c) => c.nome === "estornar-pagamento"),
    ).toHaveLength(2);
  });

  it("o servidor recusou (erro): tentar de novo com o mesmo valor repete a chave (a recusa não grava nada)", async () => {
    h.respostaRpc = () =>
      Promise.resolve({
        data: null,
        error: { message: "Cancele o pedido antes de devolver o dinheiro." },
      });
    const { atual } = await montarSonda();
    await devolver(atual, 50);
    await devolver(atual, 50);
    expect(devolucoes()).toHaveLength(2);
    const [a, b] = chaves();
    expect(a).toEqual(expect.any(String));
    expect(b).toBe(a);
    expect(toastMock.error).toHaveBeenCalledTimes(2);
  });

  it("a resposta tardia que confirma a primeira encerra a intenção: o próximo toque é intenção nova", async () => {
    const rpc = pendurada();
    h.respostaRpc = () => rpc.promessa;
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    await act(async () => {
      rpc.resolver({
        data: { refund_id: "refund-1", amount: 50, ja_registrada: false },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    h.respostaRpc = null;
    await devolver(atual, 50);
    const [a, b] = chaves();
    expect(b).not.toBe(a);
  });

  it("a resposta tardia de OUTRA intenção não apaga a chave da intenção em curso", async () => {
    const rpc50 = pendurada();
    h.respostaRpc = () => rpc50.promessa;
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    h.respostaRpc = () => pendurada().promessa;
    await devolver(atual, 30, { esperarPrazo: true });
    // A de R$ 50 chega agora: ela confirma a SUA intenção, não a de R$ 30.
    await act(async () => {
      rpc50.resolver({ data: { refund_id: "refund-50" }, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    await devolver(atual, 30, { esperarPrazo: true });
    expect(devolucoes()).toHaveLength(3);
    const [, k30, k30DeNovo] = chaves();
    expect(k30).toEqual(expect.any(String));
    expect(k30DeNovo).toBe(k30);
  });

  it("o servidor diz que a intenção JÁ estava registrada: avisa, não aciona o Mercado Pago de novo e encerra a intenção", async () => {
    h.respostaRpc = () =>
      Promise.resolve({
        data: { refund_id: "refund-1", amount: 50, ja_registrada: true },
        error: null,
      });
    const { atual } = await montarSonda();
    const leiturasAntes = h.leituras;
    await devolver(atual, 50);

    expect(h.chamadas.filter((c) => c.tipo === "invoke")).toEqual([]);
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    expect(toastMock.info.mock.calls[0]?.[0]).toMatch(
      /Pedido #.*: esta devolução já estava registrada/,
    );
    expect(h.leituras).toBeGreaterThan(leiturasAntes);
    expect(atual().enviando).toBe(false);

    h.respostaRpc = null;
    await devolver(atual, 50);
    const [a, b] = chaves();
    expect(b).not.toBe(a);
  });

  it("o 'Tentar de novo' de uma linha falhada segue na repetindo, sem chave e sem mexer na intenção em curso", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    await act(async () => {
      void atual().solicitarEstorno({
        amount: 30,
        motivo: "",
        repetindo: "refund-falhou",
      });
    });
    await passar(PRAZO_DA_RPC_MS);
    await devolver(atual, 50, { esperarPrazo: true });

    expect(devolucoes()).toHaveLength(2);
    const repeticao = h.chamadas.find(
      (c) => c.nome === "solicitar_estorno_repetindo",
    );
    expect(repeticao?.args).toEqual({
      p_refund_id: "refund-falhou",
      p_motivo: "",
    });
    const [a, b] = chaves();
    expect(a).toEqual(expect.any(String));
    expect(b).toBe(a);
  });

  it("o aviso do estouro não afirma que a lista foi atualizada antes de reler", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const { atual } = await montarSonda();
    const leiturasAntes = h.leituras;
    await devolver(atual, 50, { esperarPrazo: true });

    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    const aviso = String(toastMock.warning.mock.calls[0]?.[0]);
    expect(aviso).toMatch(/Não dá para saber se a devolução foi registrada/);
    // O aviso sai ANTES da releitura: ele não pode dizer que a lista já foi atualizada.
    expect(h.leiturasNoAviso).toEqual([leiturasAntes]);
    expect(aviso).not.toMatch(/foi atualizada/);
    expect(aviso).toMatch(/Confira a lista de devoluções/);
    expect(h.leituras).toBeGreaterThan(leiturasAntes);
  });
});
