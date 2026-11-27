// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) em `comTempoLimite` e `dispararPagamentoPix`
// (PagamentoOnline.tsx) — as bordas que defeitos de UMA linha atravessavam
// sem derrubar nenhum teste:
//   - o prazo local errava por 1 ms (+1) e ninguém notava: os vizinhos testam
//     por FAIXA ("10 s = dentro; +90 s = fora");
//   - o timer do prazo ficava pendurado depois da resposta (vazamento de
//     relógio, sem erro visível);
//   - o QR chegando só em um dos dois formatos (copia-e-cola OU imagem);
//   - o campo `aguardando`, `ticketUrl`, `paymentId` e `expiraEm` entregues
//     ao pai;
//   - a identidade da promessa no cache por pedido (uma chamada ATRASADA da
//     tentativa velha não pode apagar a promessa da tentativa NOVA);
//   - cancelar a tela antes da resposta (nem erro nem QR chegam ao pai);
//   - o erro "nulo" e os sinais `terminal` / `cartaoEmAnalise` lidos pelo
//     valor literal `true`.
//
// Mutantes equivalentes (anotados, sem teste que os derrube):
//   - `promessa.catch(() => {})` dentro de `comTempoLimite`: a original já
//     tem o `.finally(...)` encadeado, e a derivada entra no `Promise.race`
//     (que a assina); nenhuma rejeição tardia fica sem ouvinte. Apagar a
//     linha não muda nada observável — o teste da rejeição tardia abaixo
//     prova isso e fica de guarda, caso a linha deixe de ser redundante.
//   - a mensagem interna "tempo limite esgotado": nenhum consumidor a lê
//     (todos olham a marca `tempoLimite: true`), então ela não é contrato.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// `PagamentoOnline` importa `useOrders` -> `@/lib/supabase`, que explode sem
// variáveis de ambiente. Nada do Supabase de verdade roda aqui.
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento: vi.fn() }),
}));

type Modulo = typeof import("@/components/checkout/PagamentoOnline");

// O cache de promessas por pedido mora em módulo: cada teste reimporta do
// zero para não herdar a promessa pendurada do anterior.
async function importarLimpo(): Promise<Modulo> {
  vi.resetModules();
  return import("@/components/checkout/PagamentoOnline");
}

type Resposta = Awaited<
  ReturnType<Parameters<Modulo["dispararPagamentoPix"]>[0]["criarPagamento"]>
>;

const RESPOSTA_COM_QR = {
  paymentId: "pay-bordas-1",
  statusPagamento: "aguardando",
  expiraEm: "2999-01-01T00:00:00.000Z",
  qrCode: "00020126-copia-e-cola",
  qrCodeBase64: "iVBORw0KGgo=",
  ticketUrl: "https://exemplo.invalid/ticket/1",
} as unknown as Resposta;

function pendurada(): Promise<Resposta> {
  return new Promise<Resposta>(() => {});
}

function adiada() {
  let resolver!: (r: Resposta) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<Resposta>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

// Aquece a compilação do módulo (a 1ª importação, com o Vite frio, passa dos
// 5 s do teste e derrubaria o primeiro caso por prazo, não por defeito).
beforeAll(async () => {
  await import("@/components/checkout/PagamentoOnline");
}, 60_000);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("comTempoLimite — o prazo é exato e o relógio não vaza", () => {
  it("estoura em prazoMs e não 1 ms depois: aos 4.999 ms ainda espera, aos 5.000 ms rejeita marcado", async () => {
    vi.useFakeTimers();
    const { comTempoLimite } = await importarLimpo();
    const desfecho = vi.fn();

    comTempoLimite(pendurada(), 5_000).then(
      () => desfecho("resolveu"),
      (erro) => desfecho(erro),
    );

    await vi.advanceTimersByTimeAsync(4_999);
    expect(desfecho).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(desfecho).toHaveBeenCalledTimes(1);
    expect(desfecho.mock.calls[0][0]).toMatchObject({ tempoLimite: true });
  });

  it("resposta dentro do prazo: devolve o valor e NÃO deixa o timer do prazo pendurado", async () => {
    vi.useFakeTimers();
    const { comTempoLimite } = await importarLimpo();

    await expect(comTempoLimite(Promise.resolve("ok"), 5_000)).resolves.toBe(
      "ok",
    );

    expect(vi.getTimerCount()).toBe(0);
  });

  it("falha dentro do prazo: repassa o MESMO erro, sem a marca de tempo limite, e também limpa o timer", async () => {
    vi.useFakeTimers();
    const { comTempoLimite } = await importarLimpo();
    const erro = new Error("rede caiu");

    const desfecho = await comTempoLimite(Promise.reject(erro), 5_000).then(
      () => null,
      (e) => e,
    );

    expect(desfecho).toBe(erro);
    expect((desfecho as { tempoLimite?: unknown }).tempoLimite).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejeição TARDIA da original (depois do estouro) não vira rejeição não tratada", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { comTempoLimite } = await importarLimpo();
    const naoTratadas: unknown[] = [];
    const ouvinte = (motivo: unknown) => naoTratadas.push(motivo);
    process.on("unhandledRejection", ouvinte);
    try {
      const { promessa, rejeitar } = adiada();
      const desfecho = vi.fn();
      comTempoLimite(promessa, 1_000).catch(desfecho);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(desfecho).toHaveBeenCalledTimes(1);

      rejeitar(new Error("chegou tarde"));
      // `unhandledRejection` só dispara depois da fila de microtarefas e do
      // próximo turno do Node: devolve o relógio real para deixar passar.
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(naoTratadas).toEqual([]);
    } finally {
      process.off("unhandledRejection", ouvinte);
    }
  });
});

describe("dispararPagamentoPix — o prazo da criação do PIX", () => {
  it("o prazo é de 20 s (TEMPO_LIMITE_CRIACAO_PIX_MS) e a frase do erro é a que a cliente lê", async () => {
    const modulo = await importarLimpo();

    // Valor fixado de propósito: a mensagem diz à cliente que o Pix "está
    // demorando"; trocar o prazo muda quanto ela olha para um spinner.
    expect(modulo.TEMPO_LIMITE_CRIACAO_PIX_MS).toBe(20_000);
    expect(modulo.MENSAGEM_TEMPO_LIMITE_PIX).toBe(
      "O Pix está demorando mais que o normal para ser gerado. Verifique sua conexão e toque em Tentar de novo.",
    );
  });

  it("sem resposta, o erro recuperável sai exatamente no prazo: 1 ms antes nada, no prazo uma vez só", async () => {
    vi.useFakeTimers();
    const modulo = await importarLimpo();
    const onErro = vi.fn();
    const onPix = vi.fn();

    modulo.dispararPagamentoPix({
      orderId: "ped-prazo-exato",
      criarPagamento: vi.fn(pendurada),
      onErro,
      onPix,
    });

    await vi.advanceTimersByTimeAsync(modulo.TEMPO_LIMITE_CRIACAO_PIX_MS - 1);
    expect(onErro).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro).toHaveBeenCalledWith(
      "O Pix está demorando mais que o normal para ser gerado. Verifique sua conexão e toque em Tentar de novo.",
      "recuperavel",
    );
    expect(onPix).not.toHaveBeenCalled();
  });

  it("depois da resposta com QR, o timer do prazo some (nenhum relógio pendurado)", async () => {
    vi.useFakeTimers();
    const modulo = await importarLimpo();

    modulo.dispararPagamentoPix({
      orderId: "ped-timer-limpo",
      criarPagamento: vi.fn().mockResolvedValue(RESPOSTA_COM_QR),
      onErro: vi.fn(),
      onPix: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("dispararPagamentoPix — o que chega ao pai quando há QR", () => {
  it("entrega o PIX completo: id, QR nos dois formatos, prazo e link do comprovante — aguardando = true", async () => {
    const modulo = await importarLimpo();
    const onPix = vi.fn();
    const onErro = vi.fn();

    modulo.dispararPagamentoPix({
      orderId: "ped-campos",
      criarPagamento: vi.fn().mockResolvedValue(RESPOSTA_COM_QR),
      onErro,
      onPix,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onErro).not.toHaveBeenCalled();
    expect(onPix).toHaveBeenCalledTimes(1);
    expect(onPix).toHaveBeenCalledWith({
      paymentId: "pay-bordas-1",
      aguardando: true,
      qrCodeBase64: "iVBORw0KGgo=",
      qrCode: "00020126-copia-e-cola",
      expiraEm: "2999-01-01T00:00:00.000Z",
      ticketUrl: "https://exemplo.invalid/ticket/1",
    });
  });

  // Caça de 26/11/2026: 'pago' COM QR desenhava o QR (com `aguardando`
  // false) — "Copiar código Pix" de um PIX já pago. Agora é confirmação.
  it("status 'pago' COM QR não desenha o QR: é confirmação (o dinheiro já entrou)", async () => {
    const modulo = await importarLimpo();
    const onPix = vi.fn();
    const onErro = vi.fn();
    const onConfirmado = vi.fn();

    modulo.dispararPagamentoPix({
      orderId: "ped-pago-com-qr",
      criarPagamento: vi
        .fn()
        .mockResolvedValue({ ...RESPOSTA_COM_QR, statusPagamento: "pago" }),
      onErro,
      onPix,
      onConfirmado,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onConfirmado).toHaveBeenCalledTimes(1);
    expect(onPix).not.toHaveBeenCalled();
    expect(onErro).not.toHaveBeenCalled();
  });

  for (const [rotulo, parcial] of [
    ["só o copia-e-cola (sem a imagem)", { qrCodeBase64: undefined }],
    ["só a imagem (sem o copia-e-cola)", { qrCode: undefined }],
  ] as const) {
    it(`QR ${rotulo} já basta: o pai recebe o PIX, não um erro`, async () => {
      const modulo = await importarLimpo();
      const onPix = vi.fn();
      const onErro = vi.fn();

      modulo.dispararPagamentoPix({
        orderId: `ped-qr-parcial-${rotulo.length}`,
        criarPagamento: vi
          .fn()
          .mockResolvedValue({ ...RESPOSTA_COM_QR, ...parcial }),
        onErro,
        onPix,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onErro).not.toHaveBeenCalled();
      expect(onPix).toHaveBeenCalledTimes(1);
    });
  }

  it("resposta de erro nunca chama onPix (nem com `undefined`) e 'pago' sem QR só chama onConfirmado", async () => {
    const modulo = await importarLimpo();
    const onPix = vi.fn();
    const onErro = vi.fn();
    const onConfirmado = vi.fn();

    modulo.dispararPagamentoPix({
      orderId: "ped-erro-sem-onpix",
      criarPagamento: vi
        .fn()
        .mockResolvedValue({ statusPagamento: "recusado" }),
      onErro,
      onPix,
      onConfirmado,
    });
    modulo.dispararPagamentoPix({
      orderId: "ped-pago-sem-qr",
      criarPagamento: vi.fn().mockResolvedValue({
        paymentId: "pay-9",
        statusPagamento: "pago",
        expiraEm: "2999-01-01T00:00:00.000Z",
      }),
      onErro,
      onPix,
      onConfirmado,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onConfirmado).toHaveBeenCalledTimes(1);
    expect(onPix).not.toHaveBeenCalled();
  });

  it("'pago' sem QR e sem onConfirmado: não quebra e não inventa erro nem QR", async () => {
    const modulo = await importarLimpo();
    const onPix = vi.fn();
    const onErro = vi.fn();

    modulo.dispararPagamentoPix({
      orderId: "ped-pago-sem-ouvinte",
      criarPagamento: vi
        .fn()
        .mockResolvedValue({ paymentId: "pay-8", statusPagamento: "pago" }),
      onErro,
      onPix,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onErro).not.toHaveBeenCalled();
    expect(onPix).not.toHaveBeenCalled();
  });
});

describe("dispararPagamentoPix — cancelar a tela antes da resposta", () => {
  it("cancelou antes de a cobrança voltar: nem QR, nem erro, nem confirmação chegam ao pai", async () => {
    const modulo = await importarLimpo();
    const onPix = vi.fn();
    const onErro = vi.fn();
    const onConfirmado = vi.fn();
    const { promessa, resolver } = adiada();

    const cancelar = modulo.dispararPagamentoPix({
      orderId: "ped-cancela-resposta",
      criarPagamento: vi.fn(() => promessa),
      onErro,
      onPix,
      onConfirmado,
    });
    cancelar();
    resolver(RESPOSTA_COM_QR);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onPix).not.toHaveBeenCalled();
    expect(onErro).not.toHaveBeenCalled();
    expect(onConfirmado).not.toHaveBeenCalled();
  });

  it("cancelou antes de a cobrança FALHAR: o erro da tentativa velha não chega ao pai", async () => {
    const modulo = await importarLimpo();
    const onErro = vi.fn();
    const { promessa, rejeitar } = adiada();

    const cancelar = modulo.dispararPagamentoPix({
      orderId: "ped-cancela-falha",
      criarPagamento: vi.fn(() => promessa),
      onErro,
      onPix: vi.fn(),
    });
    cancelar();
    rejeitar(Object.assign(new Error("recusou"), { terminal: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onErro).not.toHaveBeenCalled();
  });

  it("cancelou antes do prazo estourar: o erro do tempo limite também não chega ao pai", async () => {
    vi.useFakeTimers();
    const modulo = await importarLimpo();
    const onErro = vi.fn();

    const cancelar = modulo.dispararPagamentoPix({
      orderId: "ped-cancela-prazo",
      criarPagamento: vi.fn(pendurada),
      onErro,
      onPix: vi.fn(),
    });
    cancelar();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onErro).not.toHaveBeenCalled();
  });
});

describe("dispararPagamentoPix — o cache por pedido guarda a promessa CERTA", () => {
  it("a resposta ATRASADA da tentativa velha não apaga a promessa da tentativa nova", async () => {
    vi.useFakeTimers();
    const modulo = await importarLimpo();
    const velha = adiada();
    const nova = adiada();
    const criarPagamento = vi
      .fn()
      .mockImplementationOnce(() => velha.promessa)
      .mockImplementationOnce(() => nova.promessa);
    const base = { orderId: "ped-cache-atrasada", criarPagamento };

    // 1ª tentativa: estoura o prazo e sai do cache (o "Tentar de novo" cria outra).
    modulo.dispararPagamentoPix({ ...base, onErro: vi.fn(), onPix: vi.fn() });
    await vi.advanceTimersByTimeAsync(modulo.TEMPO_LIMITE_CRIACAO_PIX_MS);
    // 2ª tentativa: promessa nova, ainda em voo.
    modulo.dispararPagamentoPix({ ...base, onErro: vi.fn(), onPix: vi.fn() });
    expect(criarPagamento).toHaveBeenCalledTimes(2);

    // A resposta da 1ª finalmente chega — não pode derrubar a entrada da 2ª.
    velha.resolver(RESPOSTA_COM_QR);
    await vi.advanceTimersByTimeAsync(0);

    // Uma remontagem (StrictMode) agora precisa reaproveitar a 2ª, não
    // cobrar uma terceira vez o mesmo pedido.
    modulo.dispararPagamentoPix({ ...base, onErro: vi.fn(), onPix: vi.fn() });
    expect(criarPagamento).toHaveBeenCalledTimes(2);
  });

  it("o estouro de uma ligação velha não apaga a promessa da tentativa nova", async () => {
    vi.useFakeTimers();
    const modulo = await importarLimpo();
    const criarPagamento = vi.fn(pendurada);
    const base = { orderId: "ped-cache-estouro", criarPagamento };

    // Duas telas coladas à MESMA promessa pendurada (ligações vivas, 5 s de
    // diferença): a primeira estoura aos 20 s e libera o cache.
    modulo.dispararPagamentoPix({ ...base, onErro: vi.fn(), onPix: vi.fn() });
    await vi.advanceTimersByTimeAsync(5_000);
    modulo.dispararPagamentoPix({ ...base, onErro: vi.fn(), onPix: vi.fn() });
    expect(criarPagamento).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(
      modulo.TEMPO_LIMITE_CRIACAO_PIX_MS - 5_000 + 1_000,
    );
    // Já fora do cache: "Tentar de novo" cria a promessa NOVA.
    modulo.dispararPagamentoPix({ ...base, onErro: vi.fn(), onPix: vi.fn() });
    expect(criarPagamento).toHaveBeenCalledTimes(2);

    // A segunda ligação velha estoura (aos 25 s) e NÃO pode levar a nova junto.
    await vi.advanceTimersByTimeAsync(5_000);
    modulo.dispararPagamentoPix({ ...base, onErro: vi.fn(), onPix: vi.fn() });
    expect(criarPagamento).toHaveBeenCalledTimes(2);
  });
});

describe("dispararPagamentoPix — o erro que chega ao pai é lido pelo valor literal", () => {
  async function dispararComFalha(orderId: string, falha: unknown) {
    const modulo = await importarLimpo();
    const onErro = vi.fn();
    modulo.dispararPagamentoPix({
      orderId,
      criarPagamento: vi.fn().mockRejectedValue(falha),
      onErro,
      onPix: vi.fn(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return onErro;
  }

  it("falha SEM corpo (rejeição `undefined`): recuperável, frase padrão, sem terceiro argumento", async () => {
    const onErro = await dispararComFalha("ped-falha-nula", undefined);

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro).toHaveBeenCalledWith(
      "Não foi possível gerar a cobrança.",
      "recuperavel",
    );
  });

  it("`terminal` só vale quando é literalmente true: 1 e 'true' continuam recuperáveis", async () => {
    const comNumero = await dispararComFalha(
      "ped-terminal-numero",
      Object.assign(new Error("x"), { terminal: 1 }),
    );
    const comTexto = await dispararComFalha(
      "ped-terminal-texto",
      Object.assign(new Error("y"), { terminal: "true" }),
    );

    expect(comNumero).toHaveBeenCalledWith("x", "recuperavel");
    expect(comTexto).toHaveBeenCalledWith("y", "recuperavel");
  });

  it("terminal com outro status HTTP (504) segue terminal — só o 503 é passageiro", async () => {
    const onErro = await dispararComFalha(
      "ped-terminal-504",
      Object.assign(new Error("fora do ar"), {
        terminal: true,
        httpStatus: 504,
      }),
    );

    expect(onErro).toHaveBeenCalledWith("fora do ar", "terminal");
  });

  it("cartão em análise: o sinal vai como terceiro argumento, com a categoria que a edge mandou", async () => {
    const terminal = await dispararComFalha(
      "ped-analise-terminal",
      Object.assign(new Error("em análise"), {
        terminal: true,
        httpStatus: 409,
        cartaoEmAnalise: true,
      }),
    );
    const recuperavel = await dispararComFalha(
      "ped-analise-recuperavel",
      Object.assign(new Error("502 ambíguo"), {
        terminal: false,
        httpStatus: 502,
        cartaoEmAnalise: true,
      }),
    );

    expect(terminal).toHaveBeenCalledWith(
      "em análise",
      "terminal",
      "cartaoEmAnalise",
    );
    expect(recuperavel).toHaveBeenCalledWith(
      "502 ambíguo",
      "recuperavel",
      "cartaoEmAnalise",
    );
  });

  it("`cartaoEmAnalise` que não é literalmente true NÃO vira sinal (sem terceiro argumento)", async () => {
    const onErro = await dispararComFalha(
      "ped-analise-texto",
      Object.assign(new Error("z"), { cartaoEmAnalise: "sim" }),
    );

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro.mock.calls[0]).toEqual(["z", "recuperavel"]);
  });
});
