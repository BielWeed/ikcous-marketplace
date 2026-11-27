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
// servidor CONFIRMAR a anterior — inclusive com "já registrada") = chave nova. A LISTA em tela não decide:
// a linha que aparece nela depois de a rede cair é a MESMA intenção, e girar a chave ali pagava em dobro.
// O "Tentar de novo" de uma linha falhada segue na `solicitar_estorno_repetindo`, sem chave.
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
  respostaRpc: null as
    | null
    | ((args: Record<string, unknown>) => Promise<unknown>),
  chamadas: [] as Chamada[],
  leituras: 0,
  leiturasNoAviso: [] as number[],
  colunasLidas: [] as string[],
  leituraPendurada: false,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = (colunas: string) => {
        h.colunasLidas.push(colunas);
        return builder;
      };
      builder.eq = () => builder;
      builder.order = () => {
        h.leituras += 1;
        if (h.leituraPendurada) return new Promise(() => undefined);
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
        ? h.respostaRpc(args)
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
  linhas: Array<{ id: string }>;
  recarregar: () => void;
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

function linhaDaLista({ id, chave }: { id: string; chave: string | null }) {
  return {
    id,
    amount: 50,
    status: "solicitado",
    solicitado_por: "lojista",
    mp_status: null,
    mp_status_detail: null,
    tentativas: 0,
    ultimo_erro: null,
    motivo: "devolvi",
    created_at: "2026-11-27T10:00:00Z",
    concluido_em: null,
    chave_da_solicitacao: chave,
  };
}

/** `round(p_amount, 2)` do Postgres (numeric: metade para longe do zero), em centavos inteiros. */
function numeric2(valor: unknown): number {
  return Math.round(Number(valor) * 100 + 1e-7) / 100;
}

/** Um servidor que se comporta como `solicitar_estorno_com_chave`: a chave já vista devolve a MESMA linha
 * com `ja_registrada`; a nova grava a linha (que a próxima leitura da lista mostra). A resposta da PRIMEIRA
 * chamada se perde depois de gravar: rede que cai ("Failed to fetch") ou que nunca responde (prazo). A
 * chave já vista com OUTRO valor é recusada (P0001), como no servidor. */
function servidorQueLembraAChave({
  primeiraSePerde,
}: {
  primeiraSePerde: "rede" | "prazo";
}) {
  const gravadas = new Map<string, string>();
  const valores = new Map<string, number>();
  let vez = 0;
  h.respostaRpc = (args) => {
    vez += 1;
    const chave = String(args.p_chave);
    const existente = gravadas.get(chave);
    const valorGravado = valores.get(chave);
    if (
      valorGravado !== undefined &&
      valorGravado !== numeric2(args.p_amount)
    ) {
      return Promise.resolve({
        data: null,
        error: {
          code: "P0001",
          message:
            "Esta chave já foi usada em outra devolução. Peça a devolução de novo.",
        },
      });
    }
    if (existente) {
      return Promise.resolve({
        data: {
          refund_id: existente,
          amount: valorGravado,
          ja_registrada: true,
        },
        error: null,
      });
    }
    const id = `refund-${gravadas.size + 1}`;
    gravadas.set(chave, id);
    valores.set(chave, numeric2(args.p_amount));
    h.linhas = [...h.linhas, linhaDaLista({ id, chave })];
    if (vez === 1) {
      return primeiraSePerde === "rede"
        ? Promise.resolve({
            data: null,
            error: { message: "TypeError: Failed to fetch" },
          })
        : pendurada().promessa;
    }
    return Promise.resolve({
      data: { refund_id: id, amount: args.p_amount, ja_registrada: false },
      error: null,
    });
  };
  return gravadas;
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
  h.colunasLidas = [];
  h.leituraPendurada = false;
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

  it("CASO 2: outro valor é outra intenção (chave nova), mas NÃO apaga a de antes: voltar a R$ 50 repete a chave de R$ 50", async () => {
    // R$ 50 (K1) presa na trava, R$ 60 (K2), R$ 50 de novo: se a K1 ainda gravar e a terceira levasse chave
    // nova, nasceriam duas linhas de R$ 50 — o cliente receberia R$ 100.
    h.respostaRpc = () => pendurada().promessa;
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    await devolver(atual, 60, { esperarPrazo: true });
    await devolver(atual, 50, { esperarPrazo: true });

    expect(devolucoes()).toHaveLength(3);
    const [a, b, c] = chaves();
    expect(a).toEqual(expect.any(String));
    expect(b).not.toBe(a);
    expect(c).toBe(a);
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

  it("INVERTIDO: a resposta tardia que confirma a primeira NÃO encerra a intenção (a lojista não a viu, a releitura ainda pende): o próximo toque REPETE a chave", async () => {
    // Antes: a tardia apagava K em silêncio, com o saldo velho na tela, e o toque seguinte saía com chave
    // nova — em dobro.
    const rpc = pendurada();
    h.respostaRpc = () => rpc.promessa;
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    const [k] = chaves();
    // a releitura que a tardia dispara fica pendurada: a tela segue com o saldo de antes
    h.leituraPendurada = true;
    const leiturasAntes = h.leituras;
    await act(async () => {
      rpc.resolver({
        data: { refund_id: "refund-1", amount: 50, ja_registrada: false },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    // guarda: a tardia chegou e pediu a releitura (que não voltou)
    expect(h.leituras).toBeGreaterThan(leiturasAntes);

    h.respostaRpc = () =>
      Promise.resolve({
        data: { refund_id: "refund-1", amount: 50, ja_registrada: true },
        error: null,
      });
    await devolver(atual, 50);
    const [, deNovo] = chaves();
    expect(k).toEqual(expect.any(String));
    expect(deNovo).toBe(k);
    expect(h.chamadas.filter((c) => c.tipo === "invoke")).toEqual([]);
  });

  it("a resposta tardia da devolução de R$ 50 chega no meio da de R$ 30: a de R$ 30 segue repetindo a sua chave", async () => {
    // A checagem de chave do encerramento (só apaga se for ESTA) se prova em tests/front/chave-da-devolucao.test.ts.
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
      /Pedido #.*: esta devolução de R\$\s?50,00 já estava registrada .*Se você quer devolver MAIS R\$\s?50,00, toque em Devolver de novo\./,
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

  it("REDE CAIU depois de o servidor gravar e a lista relida JÁ mostra a linha: o toque do 'tente de novo' repete a chave (nunca paga em dobro)", async () => {
    const gravadas = servidorQueLembraAChave({ primeiraSePerde: "rede" });
    const { atual } = await montarSonda();
    await devolver(atual, 50);
    // A tela disse "sem conexão, tente de novo" e releu: a lista JÁ mostra a linha gravada com a chave.
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(atual().linhas.map((l) => l.id)).toEqual(["refund-1"]);

    // A lojista obedece e toca de novo, o MESMO valor.
    await devolver(atual, 50);
    const [k, deNovo] = chaves();
    expect(k).toEqual(expect.any(String));
    expect(deNovo).toBe(k);
    // O servidor reconheceu a intenção: uma linha só, e o Mercado Pago não foi acionado de novo.
    expect(gravadas.size).toBe(1);
    expect(h.chamadas.filter((c) => c.tipo === "invoke")).toEqual([]);
    const aviso = String(toastMock.info.mock.calls.at(-1)?.[0]);
    expect(aviso).toMatch(/já estava registrada/);
    expect(aviso).toMatch(/Se você quer devolver MAIS R\$\s?50,00/);
  });

  it("SEM RESPOSTA (prazo estourou) depois de o servidor gravar e a lista relida JÁ mostra a linha: o próximo toque repete a chave", async () => {
    const gravadas = servidorQueLembraAChave({ primeiraSePerde: "prazo" });
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    expect(atual().linhas.map((l) => l.id)).toEqual(["refund-1"]);

    await devolver(atual, 50);
    const [k, deNovo] = chaves();
    expect(k).toEqual(expect.any(String));
    expect(deNovo).toBe(k);
    expect(gravadas.size).toBe(1);
    expect(h.chamadas.filter((c) => c.tipo === "invoke")).toEqual([]);
    expect(String(toastMock.info.mock.calls.at(-1)?.[0])).toMatch(
      /Se você quer devolver MAIS R\$\s?50,00/,
    );
  });

  it("CASO 1 (a segunda devolução LEGÍTIMA de igual valor): a resposta se perdeu, a lista mostra a linha — o 1º toque repete a chave (já registrada), o 2º é intenção NOVA e é pedida de verdade", async () => {
    const gravadas = servidorQueLembraAChave({ primeiraSePerde: "prazo" });
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    expect(atual().linhas.map((l) => l.id)).toEqual(["refund-1"]);

    // Outro item, mesmo valor. O primeiro toque é a mesma intenção (o servidor diz "já registrada" e o aviso
    // ensina a saída); o segundo, depois do aviso, é uma devolução A MAIS.
    await devolver(atual, 50);
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    await devolver(atual, 50);

    const [k, deNovo, nova] = chaves();
    expect(deNovo).toBe(k);
    expect(nova).toEqual(expect.any(String));
    expect(nova).not.toBe(k);
    expect(gravadas.size).toBe(2);
    expect(
      h.chamadas.filter((c) => c.nome === "estornar-pagamento"),
    ).toHaveLength(1);
  });

  it("INVERTIDO: a leitura da lista NÃO traz a chave de cada linha (a lista não decide a chave)", async () => {
    // Antes (#2003): `chave_da_solicitacao` era lida para girar a chave quando a linha aparecia na lista.
    await montarSonda();
    expect(h.colunasLidas.length).toBeGreaterThan(0);
    for (const colunas of h.colunasLidas) {
      expect(colunas.split(",").map((c) => c.trim())).not.toContain(
        "chave_da_solicitacao",
      );
    }
  });

  it("fechar e reabrir a ficha com a devolução em voo: a lista mostra a linha de K e o toque REPETE K", async () => {
    const gravadas = servidorQueLembraAChave({ primeiraSePerde: "prazo" });
    const primeira = await montarSonda();
    await devolver(primeira.atual, 50, { esperarPrazo: true });
    primeira.desmontar();

    const segunda = await montarSonda();
    expect(segunda.atual().linhas.map((l) => l.id)).toEqual(["refund-1"]);
    await devolver(segunda.atual, 50);
    const [k, deNovo] = chaves();
    expect(k).toEqual(expect.any(String));
    expect(deNovo).toBe(k);
    expect(gravadas.size).toBe(1);
    expect(h.chamadas.filter((c) => c.tipo === "invoke")).toEqual([]);
  });

  it("1,005 e depois 1: chegam ao servidor já em centavos (1,01 e 1), cada um com a sua chave — nunca P0001", async () => {
    const gravadas = servidorQueLembraAChave({ primeiraSePerde: "prazo" });
    const { atual } = await montarSonda();
    await devolver(atual, 1.005, { esperarPrazo: true });
    await devolver(atual, 1);
    expect(devolucoes().map((c) => c.args?.p_amount)).toEqual([1.01, 1]);
    const [k101, k100] = chaves();
    expect(k100).not.toBe(k101);
    expect(gravadas.size).toBe(2);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("1,005 que DÁ CERTO encerra a intenção pelo valor em centavos (1,01): a próxima de 1,005 é intenção NOVA", async () => {
    const { atual } = await montarSonda();
    await devolver(atual, 1.005);
    await devolver(atual, 1.005);
    expect(devolucoes().map((c) => c.args?.p_amount)).toEqual([1.01, 1.01]);
    const [a, b] = chaves();
    expect(a).toEqual(expect.any(String));
    expect(b).not.toBe(a);
  });

  it("o aviso do 'já registrada' fala o valor da linha que o SERVIDOR devolveu e não aciona o Mercado Pago", async () => {
    h.respostaRpc = () =>
      Promise.resolve({
        data: { refund_id: "refund-1", amount: 70, ja_registrada: true },
        error: null,
      });
    const { atual } = await montarSonda();
    await devolver(atual, 50);
    const aviso = String(toastMock.info.mock.calls[0]?.[0]);
    expect(aviso).toMatch(/esta devolução de R\$\s?70,00 já estava registrada/);
    expect(aviso).toMatch(/devolver MAIS R\$\s?70,00/);
    expect(aviso).not.toMatch(/50,00/);
    expect(
      h.chamadas.filter((c) => c.nome === "estornar-pagamento"),
    ).toHaveLength(0);
  });

  it("a lista ainda NÃO mostra a linha da chave (o servidor segue esperando): a mesma devolução repete a chave", async () => {
    h.respostaRpc = () => pendurada().promessa;
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    // A lista mostra OUTRAS linhas (outra porta, outra chave) — não a desta intenção.
    h.linhas = [
      linhaDaLista({ id: "refund-cancelamento", chave: null }),
      linhaDaLista({ id: "refund-outra", chave: "outra-chave" }),
    ];
    await act(async () => {
      atual().recarregar();
    });
    await passar(0);
    await devolver(atual, 50, { esperarPrazo: true });
    const [a, b] = chaves();
    expect(a).toEqual(expect.any(String));
    expect(b).toBe(a);
  });

  it("reler a lista com a linha de R$ 50 no meio da devolução de R$ 30: a de R$ 30 segue repetindo a sua chave", async () => {
    // A checagem de chave do encerramento (só apaga se for ESTA) se prova em tests/front/chave-da-devolucao.test.ts.
    h.respostaRpc = () => pendurada().promessa;
    const { atual } = await montarSonda();
    await devolver(atual, 50, { esperarPrazo: true });
    await devolver(atual, 30, { esperarPrazo: true });
    const [k50] = chaves();
    h.linhas = [linhaDaLista({ id: "refund-50", chave: k50 as string })];
    await act(async () => {
      atual().recarregar();
    });
    await passar(0);
    await devolver(atual, 30, { esperarPrazo: true });
    const [, k30, k30DeNovo] = chaves();
    expect(k30).toEqual(expect.any(String));
    expect(k30DeNovo).toBe(k30);
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
