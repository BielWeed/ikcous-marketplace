// @vitest-environment jsdom
//
// C5 (front B2, 02/10/2026) — a verificação do C4 aberta DENTRO da sessão,
// logo depois de um POST de cartão que voltou sem order confirmada. A
// resposta desse POST JÁ É a primeira consulta: a tela começa por ela
// (`pontoDePartida`), sem chamar a edge sozinha, e "Verificar de novo" só
// pelo botão, com a mesma espera de 30 s e o mesmo máximo — e SEMPRE
// `metodo: "verificar"`, nunca um POST de cartão nem um token novo.
//
// Mesmo andaime de verificacao-do-pagamento.test.tsx.
import { StrictMode, act, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERVALO_ENTRE_VERIFICACOES_MS,
  MAXIMO_DE_VERIFICACOES_PELO_BOTAO,
  VerificacaoDoPagamento,
} from "@/components/checkout/VerificacaoDoPagamento";

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";
// 15:00 UTC cai no dia 03/10 em qualquer fuso do Brasil e em UTC (CI).
const CANCELAMENTO_AUTOMATICO = "2026-10-03T15:00:00.000Z";

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onVerMeusPedidos = vi.fn();
const onFalarComALoja = vi.fn();
const onRetomadaLiberada = vi.fn();

beforeEach(() => {
  criarPagamento.mockReset();
  onVerMeusPedidos.mockReset();
  onFalarComALoja.mockReset();
  onRetomadaLiberada.mockReset();
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
  vi.restoreAllMocks();
});

type PontoDePartida = Parameters<
  typeof VerificacaoDoPagamento
>[0]["pontoDePartida"];

async function montar(pontoDePartida: PontoDePartida) {
  await act(async () => {
    raiz.render(
      <VerificacaoDoPagamento
        orderId={PEDIDO}
        onVerMeusPedidos={onVerMeusPedidos}
        onFalarComALoja={onFalarComALoja}
        onRetomadaLiberada={onRetomadaLiberada}
        pontoDePartida={pontoDePartida}
      />,
    );
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const texto = () => hospedeiro.textContent ?? "";
const botoes = () =>
  Array.from(hospedeiro.querySelectorAll("button")).map((b) =>
    (b.textContent ?? "").trim(),
  );
const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  ) as HTMLButtonElement | undefined;

function semSaidaQueCobraOuCancela() {
  for (const proibido of [
    "Pagar com PIX",
    "Cancelar pedido",
    "Tentar outro cartão",
    "Tentar de novo",
    "Fazer um novo pedido",
  ]) {
    expect(botoes()).not.toContain(proibido);
  }
  expect(texto()).not.toMatch(/em análise/i);
}

async function tocar(rotulo: string) {
  await act(async () => {
    botao(rotulo)?.click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("VerificacaoDoPagamento com pontoDePartida — a resposta do POST é a primeira consulta", () => {
  it("sem_registro: texto honesto com a data REAL, ZERO chamadas ao montar, sem PIX/cancelar/cartão novo", async () => {
    vi.useFakeTimers();
    await montar({
      verificacao: "sem_registro",
      canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
    });

    expect(criarPagamento).not.toHaveBeenCalled();
    expect(texto()).toContain(
      "Não conseguimos confirmar com o banco se o pagamento com cartão deste pedido foi feito.",
    );
    expect(texto()).toContain("Nenhuma cobrança nova será feita por aqui.");
    expect(texto()).toContain(
      "Se o banco confirmar, o pedido aparece como pago em Meus pedidos.",
    );
    expect(texto()).toContain(
      "Se nenhuma cobrança aparecer, o pedido é cancelado automaticamente até 03/10/2026 às",
    );
    expect(botoes()).toContain("Falar com a loja");
    expect(botoes()).toContain("Ver meus pedidos");
    semSaidaQueCobraOuCancela();

    // Sem toque, nada se repete.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("sem_registro sem data (o 'aguardando' sem order): não inventa data", async () => {
    await montar({ verificacao: "sem_registro" });
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(texto()).toContain(
      "Se nenhuma cobrança aparecer, o pedido é cancelado automaticamente.",
    );
    expect(texto()).not.toContain("Invalid Date");
    semSaidaQueCobraOuCancela();
  });

  it("indisponivel: alerta honesto em role=alert, região de status montada, ZERO chamadas ao montar", async () => {
    await montar({ verificacao: "indisponivel" });
    expect(criarPagamento).not.toHaveBeenCalled();
    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(
      hospedeiro.querySelector('[role="status"][aria-live="polite"]'),
    ).not.toBeNull();
    // Nenhuma região viva dentro de outra.
    expect(
      hospedeiro.querySelectorAll(
        '[aria-live] [aria-live], [aria-live] [role="alert"]',
      ),
    ).toHaveLength(0);
    semSaidaQueCobraOuCancela();
  });

  for (const pontoDePartida of [
    { verificacao: "sem_registro" as const },
    { verificacao: "indisponivel" as const },
  ]) {
    it(`${pontoDePartida.verificacao}: 'Verificar de novo' espera 30 s desde o POST, só usa metodo 'verificar', e para no máximo`, async () => {
      vi.useFakeTimers();
      criarPagamento.mockResolvedValue({
        verificacao: "sem_registro",
        paymentId: null,
        expiraEm: PRAZO_FUTURO,
        canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
      });
      await montar(pontoDePartida);

      expect(botao("Verificar de novo")?.disabled).toBe(true);
      await tocar("Verificar de novo");
      expect(criarPagamento).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VERIFICACOES_MS - 1);
      });
      expect(botao("Verificar de novo")?.disabled).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      for (let toque = 1; toque <= MAXIMO_DE_VERIFICACOES_PELO_BOTAO; toque++) {
        expect(botao("Verificar de novo")?.disabled).toBe(false);
        await tocar("Verificar de novo");
        expect(criarPagamento).toHaveBeenCalledTimes(toque);
        expect(criarPagamento.mock.calls.at(-1)?.[0]).toEqual({
          orderId: PEDIDO,
          metodo: "verificar",
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VERIFICACOES_MS);
        });
      }
      expect(botao("Verificar de novo")).toBeUndefined();
      expect(criarPagamento).toHaveBeenCalledTimes(
        MAXIMO_DE_VERIFICACOES_PELO_BOTAO,
      );
      for (const chamada of criarPagamento.mock.calls) {
        expect(chamada[0].metodo).toBe("verificar");
        expect(chamada[0]).not.toHaveProperty("token");
      }
    });
  }

  it("a consulta pelo botão que prova a vaga livre devolve ao pai (sem cobrar nada sozinha)", async () => {
    vi.useFakeTimers();
    criarPagamento.mockResolvedValue({
      verificacao: "livre",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
    });
    await montar({ verificacao: "indisponivel" });
    expect(criarPagamento).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VERIFICACOES_MS);
    });
    await tocar("Verificar de novo");
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(onRetomadaLiberada).toHaveBeenCalledWith("livre");
  });

  it("CONTROLE: sem pontoDePartida continua a cadência do C4 (UMA consulta sozinha ao abrir)", async () => {
    criarPagamento.mockReturnValue(new Promise(() => {}));
    await montar(undefined);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: PEDIDO,
      metodo: "verificar",
    });
  });

  // Revisão do C5 (bloqueio de a11y): o leitor de tela só anuncia mudança numa
  // região viva que JÁ existia. Com o ponto de partida aplicado no estado
  // inicial, a região nascia cheia junto com ela — e o `sem_registro` do POST
  // nunca era anunciado. O primeiro commit tem de sair com a região de status
  // MONTADA e VAZIA; o texto entra no commit seguinte, no MESMO nó, e ainda
  // sem chamada nenhuma à edge.
  for (const [nome, ponto] of [
    [
      "sem_registro do C3 (com a data)",
      {
        verificacao: "sem_registro" as const,
        canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
      },
    ],
    [
      "'aguardando' sem paymentId (sem_registro sem data)",
      { verificacao: "sem_registro" as const },
    ],
  ] as const) {
    for (const estrito of [false, true]) {
      it(`a11y, ${nome}${estrito ? " em StrictMode" : ""}: 1º commit com a região de status vazia, o texto entra depois no MESMO nó, sem chamar a edge`, async () => {
        const primeiroCommit: Array<{
          regiao: Element | null;
          texto: string | null;
        }> = [];
        // Efeito de LAYOUT de um irmão que só renderiza uma vez: roda no
        // primeiro commit, antes dos efeitos passivos da verificação.
        function Sonda() {
          useLayoutEffect(() => {
            const regiao = hospedeiro.querySelector(
              '[role="status"][aria-live="polite"]',
            );
            primeiroCommit.push({
              regiao,
              texto: regiao?.textContent ?? null,
            });
          }, []);
          return null;
        }
        const arvore = (
          <>
            <VerificacaoDoPagamento
              orderId={PEDIDO}
              onVerMeusPedidos={onVerMeusPedidos}
              onFalarComALoja={onFalarComALoja}
              onRetomadaLiberada={onRetomadaLiberada}
              pontoDePartida={ponto}
            />
            <Sonda />
          </>
        );
        await act(async () => {
          raiz.render(estrito ? <StrictMode>{arvore}</StrictMode> : arvore);
        });
        for (let i = 0; i < 4; i++) {
          await act(async () => {
            await Promise.resolve();
          });
        }

        expect(primeiroCommit.length).toBeGreaterThan(0);
        const [primeiro] = primeiroCommit;
        expect(primeiro.regiao).not.toBeNull();
        expect(primeiro.texto).toBe("");

        const regiaoAgora = hospedeiro.querySelector(
          '[role="status"][aria-live="polite"]',
        );
        expect(regiaoAgora).toBe(primeiro.regiao);
        expect(regiaoAgora?.textContent).toContain(
          "Não conseguimos confirmar com o banco se o pagamento com cartão deste pedido foi feito.",
        );
        expect(criarPagamento).not.toHaveBeenCalled();
        semSaidaQueCobraOuCancela();
      });
    }
  }

  it("a11y, indisponivel: o alerta entra DEPOIS do primeiro commit (inserido, é anunciado), sem chamar a edge", async () => {
    const alertaNoPrimeiroCommit: Array<Element | null> = [];
    function Sonda() {
      useLayoutEffect(() => {
        alertaNoPrimeiroCommit.push(hospedeiro.querySelector('[role="alert"]'));
      }, []);
      return null;
    }
    await act(async () => {
      raiz.render(
        <>
          <VerificacaoDoPagamento
            orderId={PEDIDO}
            onVerMeusPedidos={onVerMeusPedidos}
            onFalarComALoja={onFalarComALoja}
            onRetomadaLiberada={onRetomadaLiberada}
            pontoDePartida={{ verificacao: "indisponivel" }}
          />
          <Sonda />
        </>,
      );
    });
    expect(alertaNoPrimeiroCommit).toEqual([null]);
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(criarPagamento).not.toHaveBeenCalled();
  });
});
