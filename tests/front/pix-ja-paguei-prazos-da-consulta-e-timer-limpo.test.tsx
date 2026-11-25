// @vitest-environment jsdom
//
// Teste de MUTAÇÃO (24/11/2026) do "Já paguei — verificar" da tela do PIX e do
// relógio local (`comTempoLimite`) que protege a tela de uma rede presa.
//
// O que protege:
// - a consulta ao servidor que nunca responde solta o botão em 35 s (nem antes,
//   nem depois). Trocar 35_000 por 36_000 não derrubava teste nenhum: a cliente
//   ficaria presa em "Verificando…" um segundo a mais sem que ninguém visse;
// - a releitura do checkout (depois de o servidor dizer "pago") também tem
//   prazo, o de `PRAZO_DA_CONSULTA_DO_CHECKOUT_MS`. Sem ele, uma releitura
//   pendurada deixava o botão em "Verificando…" para sempre — e a cliente que
//   JÁ PAGOU sem saída, com medo de pagar de novo;
// - nos 15 s de espera entre consultas o botão fica DESABILITADO de verdade
//   (tirar `liberaEm !== 0` do `disabled` deixava o botão com cara de ativo
//   e mudo: o toque era ignorado sem explicação);
// - reabrir a tela do MESMO PIX não devolve o orçamento (5 consultas) nem
//   pula a espera de 15 s (iniciar `total`/`liberaEm` em 0 não derrubava teste);
// - a resposta 'pago' que chega DEPOIS de a cliente sair da tela não relê o
//   checkout (tirar a guarda `montadoRef` não derrubava teste nenhum);
// - `comTempoLimite` apaga o próprio relógio quando a resposta chega a tempo
//   (sem isso cada consulta deixava um timer de 20-35 s vivo atrás de si) e
//   estoura EXATAMENTE no prazo.
import {
  PagamentoOnline,
  comTempoLimite,
} from "@/components/checkout/PagamentoOnline";
import { PRAZO_DA_CONSULTA_DO_CHECKOUT_MS } from "@/lib/prazo-da-requisicao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROTULO = "Já paguei — verificar";
const VERIFICANDO = "Verificando…";
const AINDA_NAO_CONFIRMADO = "Ainda não confirmado.";
const AVISO_ESGOTADO = "As verificações manuais deste Pix acabaram.";

function botao(hospedeiro: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) =>
      (b.textContent ?? "").includes(ROTULO) ||
      (b.textContent ?? "").includes(VERIFICANDO),
  );
}

describe("PIX — prazos da consulta 'Já paguei' e relógio local limpo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    criarPagamento.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  // Cada teste usa um pedido/pagamento próprio: o orçamento de consultas é
  // guardado por tentativa, num mapa que vive a execução inteira do app.
  async function abrirPixEClicar(
    idDoPedido: string,
    respostaDaConsulta: () => Promise<unknown>,
    relerPagamento: () => Promise<boolean | undefined> | undefined = vi.fn(),
  ) {
    criarPagamento.mockImplementation(
      (args: { orderId: string; metodo: string }) =>
        args.metodo === "pix"
          ? Promise.resolve({
              paymentId: `pay-${idDoPedido}`,
              statusPagamento: "aguardando",
              expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              qrCode: "000201-codigo-copia-e-cola",
              qrCodeBase64: "abc123",
            })
          : respostaDaConsulta(),
    );
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId={idDoPedido}
          valor={100}
          onErro={() => {}}
          onRelerPagamentoPix={relerPagamento}
        />,
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      botao(hospedeiro)?.click();
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  const consultasEnviadas = () =>
    criarPagamento.mock.calls.filter(
      ([args]) => (args as { metodo: string }).metodo === "verificar",
    ).length;

  async function fecharEReabrirOPix(idDoPedido: string) {
    await act(async () => {
      raiz.render(null);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(botao(hospedeiro)).toBeUndefined();
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId={idDoPedido}
          valor={100}
          onErro={() => {}}
          onRelerPagamentoPix={vi.fn()}
        />,
      );
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("reabrir o mesmo PIX não devolve o orçamento: depois de 5 consultas, a tela reaberta já diz que acabaram e o botão segue desabilitado", async () => {
    await abrirPixEClicar("ped-orc-1", () =>
      Promise.resolve({ verificacao: "pix" }),
    );
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      await act(async () => {
        botao(hospedeiro)?.click();
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(consultasEnviadas()).toBe(5);
    expect(hospedeiro.textContent).toContain(AVISO_ESGOTADO);

    await fecharEReabrirOPix("ped-orc-1");

    expect(hospedeiro.textContent).toContain(AVISO_ESGOTADO);
    expect(botao(hospedeiro)?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(botao(hospedeiro)?.disabled).toBe(true);
    expect(consultasEnviadas()).toBe(5);
  });

  it("reabrir o mesmo PIX também não pula a espera de 15 s: o botão volta desabilitado e só libera no que faltava", async () => {
    await abrirPixEClicar("ped-orc-2", () =>
      Promise.resolve({ verificacao: "pix" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await fecharEReabrirOPix("ped-orc-2");

    expect(botao(hospedeiro)?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(botao(hospedeiro)?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(botao(hospedeiro)?.disabled).toBe(false);
  });

  it("consulta que nunca responde: segue 'Verificando…' até 34,999 s e solta o botão em 35 s, dizendo que não confirmou", async () => {
    await abrirPixEClicar("ped-prazo-1", () => new Promise(() => {}));
    expect(botao(hospedeiro)?.textContent).toContain(VERIFICANDO);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(34_999);
    });
    expect(botao(hospedeiro)?.textContent).toContain(VERIFICANDO);
    expect(botao(hospedeiro)?.disabled).toBe(true);
    expect(hospedeiro.textContent).not.toContain(AINDA_NAO_CONFIRMADO);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(botao(hospedeiro)?.textContent).toContain(ROTULO);
    expect(hospedeiro.textContent).toContain(AINDA_NAO_CONFIRMADO);
    // A espera de 15 s entre consultas já passou: pode tentar de novo.
    expect(botao(hospedeiro)?.disabled).toBe(false);
  });

  it("servidor diz 'pago' mas a releitura do checkout fica pendurada: o botão solta no prazo da consulta do checkout, sem prometer confirmação", async () => {
    await abrirPixEClicar(
      "ped-prazo-2",
      () => Promise.resolve({ verificacao: "pago" }),
      () => new Promise<boolean | undefined>(() => {}),
    );
    expect(botao(hospedeiro)?.textContent).toContain(VERIFICANDO);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_CHECKOUT_MS - 1);
    });
    expect(botao(hospedeiro)?.textContent).toContain(VERIFICANDO);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(botao(hospedeiro)?.textContent).toContain(ROTULO);
    expect(hospedeiro.textContent).toContain(AINDA_NAO_CONFIRMADO);
  });

  it("consulta já terminou: o botão fica DESABILITADO nos 15 s de espera (não só ignora o toque) e volta em 15 s", async () => {
    await abrirPixEClicar("ped-prazo-5", () =>
      Promise.resolve({ verificacao: "pix" }),
    );
    expect(criarPagamento).toHaveBeenCalledTimes(2); // PIX + 1 consulta
    expect(botao(hospedeiro)?.textContent).toContain(ROTULO);
    expect(botao(hospedeiro)?.disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(botao(hospedeiro)?.disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(botao(hospedeiro)?.disabled).toBe(false);
    await act(async () => {
      botao(hospedeiro)?.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(criarPagamento).toHaveBeenCalledTimes(3);
  });

  it("a cliente saiu da tela do PIX com a consulta em voo: a resposta 'pago' que chega depois NÃO dispara releitura do checkout", async () => {
    let responder: (resposta: { verificacao: string }) => void = () => {};
    const relerPagamento = vi.fn(async () => true as boolean | undefined);
    await abrirPixEClicar(
      "ped-prazo-3",
      () =>
        new Promise<{ verificacao: string }>((resolve) => {
          responder = resolve;
        }),
      relerPagamento,
    );

    act(() => {
      raiz.unmount();
    });
    await act(async () => {
      responder({ verificacao: "pago" });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(relerPagamento).not.toHaveBeenCalled();
  });

  it("CONTROLE: com a cliente ainda na tela, o mesmo 'pago' relê o checkout uma vez e o botão volta ao normal", async () => {
    const relerPagamento = vi.fn(async () => true as boolean | undefined);
    await abrirPixEClicar(
      "ped-prazo-4",
      () => Promise.resolve({ verificacao: "pago" }),
      relerPagamento,
    );

    expect(relerPagamento).toHaveBeenCalledTimes(1);
    // A releitura confirmou: nada de "Ainda não confirmado".
    expect(hospedeiro.textContent).not.toContain(AINDA_NAO_CONFIRMADO);
  });
});

describe("comTempoLimite — o relógio local", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resposta que chega a tempo apaga o próprio relógio: nenhum timer fica vivo atrás da consulta", async () => {
    const resposta = comTempoLimite(Promise.resolve("ok"), 20_000);
    expect(vi.getTimerCount()).toBe(1);
    await expect(resposta).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falha que chega a tempo também apaga o relógio, e a falha original segue sem virar 'tempo limite'", async () => {
    const resposta = comTempoLimite(
      Promise.reject(new Error("rede caiu")),
      20_000,
    );
    await expect(resposta).rejects.toThrow("rede caiu");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sem resposta, estoura EXATAMENTE no prazo (1 ms antes ainda espera) com o erro marcado tempoLimite", async () => {
    const resposta = comTempoLimite(new Promise<string>(() => {}), 1_000);
    const desfecho = vi.fn();
    resposta.then(
      () => desfecho("resolveu"),
      (erro: { tempoLimite?: boolean }) => desfecho(erro),
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(desfecho).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(desfecho).toHaveBeenCalledTimes(1);
    expect(desfecho.mock.calls[0]?.[0]).toMatchObject({ tempoLimite: true });
  });
});
