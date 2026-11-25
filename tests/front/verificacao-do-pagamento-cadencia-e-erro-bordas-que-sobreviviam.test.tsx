// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) na TELA `VerificacaoDoPagamento`: os testes
// vizinhos leem os prazos pelas constantes EXPORTADAS (`INTERVALO_...`,
// `MAXIMO_...`, `TEMPO_LIMITE_...`), então trocar a constante (30 s -> 29 s,
// 5 toques -> 6, 35 s -> 36 s) passava sem derrubar nada. Aqui os valores
// entram como NÚMEROS escritos à mão — o contrato que a cliente sente: "espere
// meio minuto", "no máximo cinco toques", "a consulta desiste aos 35 s".
// Também fica aqui o erro da consulta lido pelo valor literal.
//
// Mutantes equivalentes (anotados, sem teste que os derrube):
//   - tirar a checagem de "resposta mais recente" (`numero !==
//     sequenciaRef.current`): com a consulta em voo a tela está em
//     "consultando", estado em que o botão de verificar nem existe, então
//     duas consultas nunca se sobrepõem;
//   - tirar `botaoEmEspera` ou `!podeVerificarDeNovo` da guarda do toque: o
//     botão fica `disabled` / some do DOM nesses mesmos casos, e um clique
//     nunca chega ao `onClick` (defesa em profundidade, sem efeito visível).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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
const SEM_REGISTRO = {
  verificacao: "sem_registro",
  paymentId: null,
  expiraEm: "2999-01-01T00:00:00.000Z",
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onRetomadaLiberada = vi.fn();

beforeAll(async () => {
  await import("@/components/checkout/VerificacaoDoPagamento");
}, 60_000);

beforeEach(() => {
  criarPagamento.mockReset();
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

async function montar() {
  await act(async () => {
    raiz.render(
      <VerificacaoDoPagamento
        orderId={PEDIDO}
        onVerMeusPedidos={vi.fn()}
        onRetomadaLiberada={onRetomadaLiberada}
      />,
    );
  });
  await esvaziar();
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const texto = () => hospedeiro.textContent ?? "";
const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  ) as HTMLButtonElement | undefined;

async function tocar(rotulo: string) {
  await act(async () => {
    botao(rotulo)?.click();
  });
  await avancar(0);
}

describe("VerificacaoDoPagamento — os prazos que a cliente sente", () => {
  it("os três prazos são os combinados: 30 s entre consultas, 5 toques, 35 s de espera pela edge", () => {
    expect(INTERVALO_ENTRE_VERIFICACOES_MS).toBe(30_000);
    expect(MAXIMO_DE_VERIFICACOES_PELO_BOTAO).toBe(5);
    expect(TEMPO_LIMITE_DA_VERIFICACAO_MS).toBe(35_000);
  });

  it("'Verificar de novo' destrava aos 30.000 ms, não aos 29.999", async () => {
    vi.useFakeTimers();
    criarPagamento.mockResolvedValue(SEM_REGISTRO);
    await montar();

    await avancar(29_999);
    expect(botao("Verificar de novo")?.disabled).toBe(true);

    await avancar(1);
    expect(botao("Verificar de novo")?.disabled).toBe(false);
  });

  it("depois de um toque o botão volta a esperar 30 s inteiros (a espera é renovada a cada consulta)", async () => {
    vi.useFakeTimers();
    criarPagamento.mockResolvedValue(SEM_REGISTRO);
    await montar();
    await avancar(30_000);
    await tocar("Verificar de novo");
    expect(criarPagamento).toHaveBeenCalledTimes(2);

    await avancar(29_999);
    expect(botao("Verificar de novo")?.disabled).toBe(true);
    await avancar(1);
    expect(botao("Verificar de novo")?.disabled).toBe(false);
  });

  it("no máximo CINCO toques: o sexto não existe — o botão some e a frase explica", async () => {
    vi.useFakeTimers();
    criarPagamento.mockResolvedValue(SEM_REGISTRO);
    await montar();

    for (let toque = 1; toque <= 5; toque++) {
      await avancar(30_000);
      await tocar("Verificar de novo");
      expect(criarPagamento).toHaveBeenCalledTimes(1 + toque);
    }

    await avancar(30_000);
    expect(botao("Verificar de novo")).toBeUndefined();
    expect(texto()).toContain("Você já verificou várias vezes.");
    expect(criarPagamento).toHaveBeenCalledTimes(6);
  });

  it("gastos os cinco toques, a frase 'já verificou várias vezes' só vale onde o botão existiria: com o pagamento já 'pago' ela não aparece", async () => {
    vi.useFakeTimers();
    criarPagamento.mockResolvedValue(SEM_REGISTRO);
    await montar();

    for (let toque = 1; toque <= 5; toque++) {
      await avancar(30_000);
      if (toque === 5) {
        criarPagamento.mockResolvedValueOnce({ verificacao: "pago" });
      }
      await tocar("Verificar de novo");
    }

    expect(texto()).toContain("Pagamento recebido.");
    expect(texto()).not.toContain("Você já verificou várias vezes.");
    expect(botao("Verificar de novo")).toBeUndefined();
  });

  it("a consulta que não responde desiste aos 35.000 ms, não antes: aos 34.999 ainda 'consultando'", async () => {
    vi.useFakeTimers();
    criarPagamento.mockImplementation(() => new Promise(() => {}));
    await montar();

    await avancar(34_999);
    expect(texto()).toContain("Consultando o pagamento com o banco");

    await avancar(1);
    expect(texto()).not.toContain("Consultando o pagamento com o banco");
    expect(texto()).toContain("Não foi possível consultar o pagamento agora.");
  });
});

describe("VerificacaoDoPagamento — o aviso de espera acompanha o botão", () => {
  it("'Aguarde alguns segundos…' aparece enquanto o botão espera e SOME quando ele destrava", async () => {
    vi.useFakeTimers();
    criarPagamento.mockResolvedValue(SEM_REGISTRO);
    await montar();
    expect(texto()).toContain(
      "Aguarde alguns segundos para verificar de novo.",
    );

    await avancar(30_000);

    expect(botao("Verificar de novo")?.disabled).toBe(false);
    expect(texto()).not.toContain(
      "Aguarde alguns segundos para verificar de novo.",
    );
  });
});

describe("VerificacaoDoPagamento — o desafio 3DS só termina com o aviso certo do banco", () => {
  const ORIGEM_DO_BANCO = "https://www.mercadopago.com.br";

  it.each([
    ["status que ainda não é COMPLETE", { status: "PENDING" }],
    ["mensagem sem status", { qualquerCoisa: 1 }],
    ["texto solto", "carregando"],
    ["nulo", null],
  ])(
    "mensagem do Mercado Pago com %s NÃO fecha o quadro",
    async (_rotulo, dados) => {
      criarPagamento.mockResolvedValue({
        verificacao: "desafio3ds",
        paymentId: "ORD-3DS-9",
        desafio3ds: { url: "https://www.mercadopago.com.br/3ds/desafio?x=1" },
        expiraEm: "2999-01-01T00:00:00.000Z",
      });
      await montar();
      expect(hospedeiro.querySelector("iframe")).not.toBeNull();

      await act(async () => {
        globalThis.dispatchEvent(
          new MessageEvent("message", { data: dados, origin: ORIGEM_DO_BANCO }),
        );
      });
      await esvaziar();

      expect(hospedeiro.querySelector("iframe")).not.toBeNull();
      expect(texto()).not.toContain("Confirmação enviada ao banco.");
    },
  );

  it("CONTROLE: o mesmo aviso com status COMPLETE fecha o quadro", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: "ORD-3DS-9",
      desafio3ds: { url: "https://www.mercadopago.com.br/3ds/desafio?x=1" },
      expiraEm: "2999-01-01T00:00:00.000Z",
    });
    await montar();

    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: ORIGEM_DO_BANCO,
        }),
      );
    });
    await esvaziar();

    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(texto()).toContain("Confirmação enviada ao banco.");
  });
});

describe("VerificacaoDoPagamento — o erro da consulta é lido pelo valor literal", () => {
  const alerta = () => hospedeiro.querySelector('[role="alert"]');

  it.each([
    ["sem mensagem", undefined],
    ["com mensagem vazia", ""],
    ["com mensagem só de espaços", "   "],
  ])(
    "409 terminal %s: a frase padrão, sem texto cru",
    async (_rotulo, mensagem) => {
      criarPagamento.mockRejectedValue(
        Object.assign(new Error(mensagem), {
          terminal: true,
          httpStatus: 409,
        }),
      );
      await montar();

      expect(alerta()?.textContent).toContain(
        "Este pedido não pode ser pago agora.",
      );
    },
  );

  it("terminal com mensagem própria: mostra a frase da edge", async () => {
    criarPagamento.mockRejectedValue(
      Object.assign(new Error("Pedido cancelado pela loja."), {
        terminal: true,
        httpStatus: 409,
      }),
    );
    await montar();

    expect(alerta()?.textContent).toContain("Pedido cancelado pela loja.");
    expect(botao("Verificar de novo")).toBeUndefined();
  });

  it("`terminal` que não é literalmente true (texto 'true', número 1) continua indisponível, com 'Verificar de novo'", async () => {
    for (const terminal of ["true", 1]) {
      criarPagamento.mockReset();
      criarPagamento.mockRejectedValue(
        Object.assign(new Error("frase da edge"), { terminal }),
      );
      await act(async () => {
        raiz.render(<div />);
      });
      await montar();

      expect(alerta()?.textContent).toContain(
        "Não foi possível consultar o pagamento agora.",
      );
      expect(texto()).not.toContain("frase da edge");
      expect(botao("Verificar de novo")).toBeDefined();
    }
  });

  it("terminal com status 504 segue terminal (só o 503 é passageiro)", async () => {
    criarPagamento.mockRejectedValue(
      Object.assign(new Error("fora do ar"), {
        terminal: true,
        httpStatus: 504,
      }),
    );
    await montar();

    expect(alerta()?.textContent).toContain("fora do ar");
    expect(botao("Verificar de novo")).toBeUndefined();
  });

  it("falha SEM corpo (rejeição `null`): indisponível, nunca quebra a tela", async () => {
    criarPagamento.mockRejectedValue(null);
    await montar();

    expect(alerta()?.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(botao("Verificar de novo")).toBeDefined();
  });
});
