// @vitest-environment jsdom
//
// C4 (M1, 02/10/2026) — retomada de um pedido de CARTÃO EM DÚVIDA (vaga com
// sentinela `verificando:`). Antes: a tela não chamava nada e prometia
// "daqui a alguns minutos (...) continua de onde parou" — falso, nada resolvia
// o sentinela sozinho. Agora `VerificacaoDoPagamento` pede à edge a CONSULTA
// sem cobrança (`criarPagamento({ orderId, metodo: "verificar" })`) UMA vez
// sozinha e, depois, só pelo botão (30 s entre toques, no máximo 5), e mostra
// cada `verificacao` do contrato com texto verdadeiro.
//
// Mesmo andaime de pagamento-com-cartao.test.tsx: `act` puro, sem
// @testing-library; `criarPagamento` é o dublê do `useOrders`.
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERVALO_ENTRE_VERIFICACOES_MS,
  MAXIMO_DE_VERIFICACOES_PELO_BOTAO,
  TEMPO_LIMITE_DA_VERIFICACAO_MS,
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
const URL_DO_DESAFIO = "https://www.mercadopago.com.br/3ds/desafio?x=1";
// Prazo da reserva no FUTURO (a consulta pode liberar a retomada) e no
// PASSADO (a retomada não reabre: o prazo acabou).
const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";
const PRAZO_VENCIDO = "2000-01-01T00:00:00.000Z";
// 15:00 UTC cai no dia 03/10 em qualquer fuso do Brasil e em UTC (CI).
const CANCELAMENTO_AUTOMATICO = "2026-10-03T15:00:00.000Z";

const erroDaEdge = (mensagem: string, terminal: boolean) =>
  Object.assign(new Error(mensagem), { terminal, cartaoEmAnalise: false });

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

async function esvaziar() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function elemento(props: { comWhatsapp?: boolean } = {}) {
  return (
    <VerificacaoDoPagamento
      orderId={PEDIDO}
      onVerMeusPedidos={onVerMeusPedidos}
      onFalarComALoja={
        props.comWhatsapp === false ? undefined : onFalarComALoja
      }
      onRetomadaLiberada={onRetomadaLiberada}
    />
  );
}

async function montar(
  props: { comWhatsapp?: boolean; estrito?: boolean } = {},
) {
  await act(async () => {
    raiz.render(
      props.estrito ? (
        <StrictMode>{elemento(props)}</StrictMode>
      ) : (
        elemento(props)
      ),
    );
  });
  await esvaziar();
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
const regiaoStatus = () =>
  hospedeiro.querySelector('[role="status"][aria-live="polite"]');
const regiaoAlerta = () => hospedeiro.querySelector('[role="alert"]');

/** O que NUNCA pode aparecer enquanto a cobrança está em dúvida. */
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
  expect(hospedeiro.querySelector("iframe")).toBeNull();
}

describe("VerificacaoDoPagamento — a consulta que abre sozinha", () => {
  it("ao montar chama criarPagamento UMA vez, com exatamente { orderId, metodo: 'verificar' } (nada de cartão, nada de PIX)", async () => {
    criarPagamento.mockReturnValue(new Promise(() => {}));
    await montar();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: PEDIDO,
      metodo: "verificar",
    });
    // Enquanto a consulta não volta: região de status anuncia a espera.
    expect(regiaoStatus()?.textContent).toContain(
      "Consultando o pagamento com o banco…",
    );
    semSaidaQueCobraOuCancela();
  });

  it("StrictMode (monta, desmonta, remonta): uma chamada só, e a resposta ainda chega à tela", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "sem_registro",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
      canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
    });
    await montar({ estrito: true });
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(texto()).toContain("Não conseguimos confirmar com o banco");
  });

  it("novo render do pai com a consulta em voo não repete a chamada", async () => {
    criarPagamento.mockReturnValue(new Promise(() => {}));
    await montar();
    await act(async () => {
      raiz.render(elemento());
    });
    await act(async () => {
      raiz.render(elemento({ comWhatsapp: false }));
    });
    await esvaziar();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("reload no meio (desmonta com a consulta em voo e abre de novo): uma chamada por abertura, e a resposta da tela velha não pinta a nova", async () => {
    let resolverAVelha: (r: unknown) => void = () => {};
    criarPagamento.mockReturnValueOnce(
      new Promise((resolve) => {
        resolverAVelha = resolve;
      }),
    );
    await montar();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    act(() => {
      raiz.unmount();
    });

    // "Reload": a tela abre de novo do zero.
    raiz = createRoot(hospedeiro);
    criarPagamento.mockResolvedValueOnce({
      verificacao: "em_analise",
      paymentId: "ORD-VIVA-1",
      expiraEm: PRAZO_FUTURO,
    });
    await montar();
    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(texto()).toContain("Pagamento em análise pelo banco.");

    // A resposta atrasada da abertura anterior chega — e é uma que mandaria o
    // pai para a escolha da forma: a tela que já saiu não decide nada.
    await act(async () => {
      resolverAVelha({
        verificacao: "livre",
        paymentId: null,
        expiraEm: PRAZO_FUTURO,
      });
    });
    await esvaziar();
    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(texto()).toContain("Pagamento em análise pelo banco.");
    expect(onRetomadaLiberada).not.toHaveBeenCalled();
  });

  it("não grava nada em localStorage nem sessionStorage", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    criarPagamento.mockResolvedValue({
      verificacao: "sem_registro",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
      canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
    });
    await montar();
    expect(local).not.toHaveBeenCalled();
  });
});

describe("VerificacaoDoPagamento — um estado do contrato, um texto verdadeiro", () => {
  it("sem_registro: data REAL do cancelamento automático, 'Falar com a loja', 'Verificar de novo' e 'Ver meus pedidos' — sem PIX, sem cancelar, sem pedido novo", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "sem_registro",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
      canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
    });
    await montar();

    const status = regiaoStatus()?.textContent ?? "";
    expect(status).toContain(
      "Não conseguimos confirmar com o banco se o pagamento com cartão deste pedido foi feito.",
    );
    expect(status).toContain("Nenhuma cobrança nova será feita por aqui.");
    expect(status).toContain(
      "Se o banco confirmar, o pedido aparece como pago em Meus pedidos.",
    );
    expect(status).toMatch(
      /Se nenhuma cobrança aparecer, o pedido é cancelado automaticamente até 03\/10\/2026 às \d{2}:\d{2}\./,
    );
    expect(botoes()).toEqual([
      "Falar com a loja",
      "Verificar de novo",
      "Ver meus pedidos",
    ]);
    semSaidaQueCobraOuCancela();
    for (const promessaFalsa of [
      "em análise",
      "daqui a alguns minutos",
      "continua de onde parou",
      "pedido novo",
    ]) {
      expect(texto()).not.toContain(promessaFalsa);
    }
    expect(regiaoAlerta()).toBeNull();

    act(() => {
      botao("Falar com a loja")?.click();
    });
    expect(onFalarComALoja).toHaveBeenCalledTimes(1);
    act(() => {
      botao("Ver meus pedidos")?.click();
    });
    expect(onVerMeusPedidos).toHaveBeenCalledTimes(1);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("sem_registro numa loja SEM WhatsApp: só 'Verificar de novo' e 'Ver meus pedidos'", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "sem_registro",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
      canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
    });
    await montar({ comWhatsapp: false });
    expect(botoes()).toEqual(["Verificar de novo", "Ver meus pedidos"]);
  });

  it("sem_registro sem data legível: não inventa data (nada de 'Invalid Date')", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "sem_registro",
      paymentId: null,
      expiraEm: null,
    });
    await montar();
    expect(texto()).toContain(
      "Se nenhuma cobrança aparecer, o pedido é cancelado automaticamente.",
    );
    expect(texto()).not.toContain("Invalid");
    expect(texto()).not.toContain("até");
  });

  it("indisponivel (503 da edge, não terminal): alerta honesto e 'Verificar de novo'", async () => {
    criarPagamento.mockRejectedValue(
      erroDaEdge("Não foi possível consultar o pagamento agora.", false),
    );
    await montar();
    expect(regiaoAlerta()?.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(botoes()).toEqual(["Verificar de novo", "Ver meus pedidos"]);
    semSaidaQueCobraOuCancela();
  });

  it("rede caiu (erro sem corpo): mesma tela de indisponível, com a frase fixa — nunca o texto cru", async () => {
    criarPagamento.mockRejectedValue(
      erroDaEdge("Não foi possível gerar a cobrança.", false),
    );
    await montar();
    expect(regiaoAlerta()?.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(texto()).not.toContain("gerar a cobrança");
  });

  it("consulta que nunca responde: depois do tempo limite vira indisponível (o botão não fica preso em 'consultando')", async () => {
    vi.useFakeTimers();
    criarPagamento.mockReturnValue(new Promise(() => {}));
    await montar();
    expect(texto()).toContain("Consultando o pagamento com o banco…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_DA_VERIFICACAO_MS);
    });
    expect(regiaoAlerta()?.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("409 terminal: a frase da edge em alerta, só 'Ver meus pedidos' (verificar de novo daria a mesma resposta)", async () => {
    criarPagamento.mockRejectedValue(
      erroDaEdge("O prazo para pagar este pedido acabou.", true),
    );
    await montar();
    expect(regiaoAlerta()?.textContent).toContain(
      "O prazo para pagar este pedido acabou.",
    );
    expect(botoes()).toEqual(["Ver meus pedidos"]);
  });

  it("404 terminal (não é dono / não existe): alerta e só 'Ver meus pedidos'", async () => {
    criarPagamento.mockRejectedValue(
      erroDaEdge("Pedido não encontrado.", true),
    );
    await montar();
    expect(regiaoAlerta()?.textContent).toContain("Pedido não encontrado.");
    expect(botoes()).toEqual(["Ver meus pedidos"]);
  });

  for (const paymentId of ["ORD-APROVADA-1", null]) {
    it(`pago (paymentId ${paymentId === null ? "null — vaga ainda com sentinela" : "presente"}): decide pelo status, texto conservador que não promete 'pedido confirmado'`, async () => {
      criarPagamento.mockResolvedValue({
        verificacao: "pago",
        paymentId,
        expiraEm: PRAZO_FUTURO,
      });
      await montar();
      expect(regiaoStatus()?.textContent).toContain(
        "Pagamento recebido. A confirmação do pedido aparece em Meus pedidos.",
      );
      expect(texto()).not.toMatch(/pedido confirmado/i);
      expect(botoes()).toEqual(["Ver meus pedidos"]);
      expect(onRetomadaLiberada).not.toHaveBeenCalled();
    });
  }

  it("pago com o prazo da reserva já vencido (o banco pode ter gravado pago_apos_expirar): mesmo texto conservador", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "pago",
      paymentId: "ORD-APROVADA-2",
      expiraEm: PRAZO_VENCIDO,
    });
    await montar();
    expect(texto()).toContain(
      "Pagamento recebido. A confirmação do pedido aparece em Meus pedidos.",
    );
    expect(texto()).not.toMatch(/pedido confirmado/i);
  });

  it("em_analise COM paymentId (order existe): 'Pagamento em análise pelo banco.'", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "em_analise",
      paymentId: "ORD-VIVA-1",
      expiraEm: PRAZO_FUTURO,
    });
    await montar();
    expect(regiaoStatus()?.textContent).toContain(
      "Pagamento em análise pelo banco.",
    );
    expect(botoes()).toEqual(["Verificar de novo", "Ver meus pedidos"]);
    semSaidaQueCobraOuCancela();
  });

  for (const paymentId of [null, "", undefined]) {
    it(`em_analise SEM paymentId (${JSON.stringify(paymentId)}): nunca promete 'em análise' — cai no indisponível`, async () => {
      criarPagamento.mockResolvedValue({
        verificacao: "em_analise",
        paymentId,
        expiraEm: PRAZO_FUTURO,
      });
      await montar();
      expect(texto()).not.toContain("em análise");
      expect(regiaoAlerta()?.textContent).toContain(
        "Não foi possível consultar o pagamento agora.",
      );
    });
  }

  it("verificacao desconhecida ou corpo estranho: falha fechada no indisponível", async () => {
    criarPagamento.mockResolvedValue({ verificacao: "aprovadissimo" });
    await montar();
    expect(regiaoAlerta()?.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(onRetomadaLiberada).not.toHaveBeenCalled();
  });

  it("desafio3ds com URL do Mercado Pago: abre o desafio (iframe) sem formulário de cartão e sem PIX; o 'concluído' do banco não dispara consulta sozinho", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: "ORD-3DS-1",
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });
    await montar();
    expect(regiaoStatus()?.textContent).toContain(
      "Seu banco pediu uma confirmação de segurança para este pagamento.",
    );
    const quadro = hospedeiro.querySelector("iframe");
    expect(quadro?.getAttribute("src")).toBe(URL_DO_DESAFIO);
    // Com o quadro do banco aberto, nada que o desmonte: nem PIX, nem outro
    // cartão, nem "Verificar de novo" (revisão do C4, item 4).
    expect(botoes()).toEqual(["Ver meus pedidos"]);

    // Mensagem de origem estranha: ignorada.
    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://mercadopago.com.golpe.io",
        }),
      );
    });
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();

    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });
    await esvaziar();
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(regiaoStatus()?.textContent).toContain(
      "Confirmação enviada ao banco. Toque em “Verificar de novo” para ver a resposta.",
    );
    // Depois do "concluído", o botão que o texto promete existe.
    expect(botoes()).toEqual(["Verificar de novo", "Ver meus pedidos"]);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("desafio3ds: passados os 30 s com o quadro do banco aberto, 'Verificar de novo' continua escondido (tocar remontaria o quadro); depois do 'concluído' ele aparece já liberado e consulta", async () => {
    vi.useFakeTimers();
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: "ORD-3DS-1",
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(hospedeiro.querySelector("iframe")?.getAttribute("src")).toBe(
      URL_DO_DESAFIO,
    );
    expect(botao("Verificar de novo")).toBeUndefined();
    expect(texto()).not.toContain("Aguarde alguns segundos");
    expect(criarPagamento).toHaveBeenCalledTimes(1);

    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });
    expect(botao("Verificar de novo")?.disabled).toBe(false);
    await act(async () => {
      botao("Verificar de novo")?.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(criarPagamento).toHaveBeenCalledTimes(2);
  });

  for (const paymentId of [null, "", undefined]) {
    it(`desafio3ds SEM paymentId (${JSON.stringify(paymentId)}): não abre desafio nenhum — cai no indisponível`, async () => {
      criarPagamento.mockResolvedValue({
        verificacao: "desafio3ds",
        paymentId,
        desafio3ds: { url: URL_DO_DESAFIO },
        expiraEm: PRAZO_FUTURO,
      });
      await montar();
      expect(hospedeiro.querySelector("iframe")).toBeNull();
      expect(texto()).not.toContain("confirmação de segurança");
      expect(regiaoAlerta()?.textContent).toContain(
        "Não foi possível consultar o pagamento agora.",
      );
    });
  }

  it("desafio3ds com URL fora do Mercado Pago: NÃO abre o iframe", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: "ORD-3DS-2",
      desafio3ds: { url: "https://golpe.example/3ds" },
      expiraEm: PRAZO_FUTURO,
    });
    await montar();
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(texto()).toContain("não pôde ser aberta aqui");
    expect(botoes()).toEqual(["Verificar de novo", "Ver meus pedidos"]);
  });

  for (const verificacao of ["livre", "recusado", "pix"] as const) {
    it(`${verificacao} dentro do prazo: devolve a retomada ao pai (UMA vez), sem cobrar nada aqui`, async () => {
      criarPagamento.mockResolvedValue({
        verificacao,
        paymentId: verificacao === "pix" ? "123456789" : null,
        expiraEm: PRAZO_FUTURO,
      });
      await montar();
      expect(onRetomadaLiberada).toHaveBeenCalledTimes(1);
      expect(onRetomadaLiberada).toHaveBeenCalledWith(verificacao);
      expect(criarPagamento).toHaveBeenCalledTimes(1);
    });
  }

  it("recusado com o prazo vencido: diz as duas verdades e não reabre a retomada", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "recusado",
      paymentId: null,
      expiraEm: PRAZO_VENCIDO,
    });
    await montar();
    // Revisão do C4 (bloqueio): `recusado` inclui o 3DS que só expirou —
    // "não foi concluído", nunca "não foi aprovado" (veredito A2, item 4).
    expect(texto()).toContain(
      "O pagamento com cartão não foi concluído. O prazo para pagar este pedido acabou.",
    );
    expect(texto()).not.toContain("não foi aprovado");
    expect(onRetomadaLiberada).not.toHaveBeenCalled();
    expect(botoes()).toEqual(["Ver meus pedidos"]);
  });

  it("livre com o prazo vencido: 'O prazo para pagar este pedido acabou.' sem reabrir a retomada", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "livre",
      paymentId: null,
      expiraEm: PRAZO_VENCIDO,
    });
    await montar();
    expect(texto()).toContain("O prazo para pagar este pedido acabou.");
    expect(texto()).not.toContain("não foi aprovado");
    expect(texto()).not.toContain("não foi concluído");
    expect(onRetomadaLiberada).not.toHaveBeenCalled();
  });
});

describe("VerificacaoDoPagamento — cadência (uma sozinha, depois só pelo botão)", () => {
  const SEM_REGISTRO = {
    verificacao: "sem_registro",
    paymentId: null,
    expiraEm: PRAZO_FUTURO,
    canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
  };

  async function tocar(rotulo: string) {
    await act(async () => {
      botao(rotulo)?.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("sem toque, nada se repete: 10 minutos depois continua UMA chamada", async () => {
    vi.useFakeTimers();
    criarPagamento.mockResolvedValue(SEM_REGISTRO);
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("o botão espera 30 s desde a última consulta, conta só toque de verdade, e some depois do máximo", async () => {
    vi.useFakeTimers();
    criarPagamento.mockResolvedValue(SEM_REGISTRO);
    await montar();
    expect(criarPagamento).toHaveBeenCalledTimes(1);

    // Antes dos 30 s: desativado, e tocar não chama nada.
    expect(botao("Verificar de novo")?.disabled).toBe(true);
    await tocar("Verificar de novo");
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VERIFICACOES_MS - 1);
    });
    expect(botao("Verificar de novo")?.disabled).toBe(true);

    for (let toque = 1; toque <= MAXIMO_DE_VERIFICACOES_PELO_BOTAO; toque++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VERIFICACOES_MS);
      });
      expect(botao("Verificar de novo")?.disabled).toBe(false);
      await tocar("Verificar de novo");
      expect(criarPagamento).toHaveBeenCalledTimes(1 + toque);
      expect(criarPagamento.mock.calls.at(-1)?.[0]).toEqual({
        orderId: PEDIDO,
        metodo: "verificar",
      });
      // Toque duplo logo em seguida: o botão já voltou a esperar.
      await tocar("Verificar de novo");
      expect(criarPagamento).toHaveBeenCalledTimes(1 + toque);
    }

    // Depois do máximo, o botão some — e o tempo não traz ele de volta.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(botao("Verificar de novo")).toBeUndefined();
    expect(texto()).toContain(
      "Você já verificou várias vezes. Acompanhe a situação em Meus pedidos.",
    );
    expect(criarPagamento).toHaveBeenCalledTimes(
      1 + MAXIMO_DE_VERIFICACOES_PELO_BOTAO,
    );
  });

  it("indisponível também respeita a espera, e a nova consulta pode trazer outro estado", async () => {
    vi.useFakeTimers();
    criarPagamento
      .mockRejectedValueOnce(
        erroDaEdge("Não foi possível consultar o pagamento agora.", false),
      )
      .mockResolvedValueOnce({
        verificacao: "em_analise",
        paymentId: "ORD-VIVA-2",
        expiraEm: PRAZO_FUTURO,
      });
    await montar();
    expect(botao("Verificar de novo")?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VERIFICACOES_MS);
    });
    await tocar("Verificar de novo");
    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(regiaoAlerta()).toBeNull();
    expect(texto()).toContain("Pagamento em análise pelo banco.");
  });
});
