// @vitest-environment jsdom
//
// Bordas do cartão da devolução na tela do pedido (DevolucaoDoPedidoCard) que
// a mutação achou sem teste:
//  - dinheiro na tela: reembolso de R$ 0,00 não vira o total, a linha do item
//    é quantidade x preço, frete zero não ganha linha, valor ausente não vira
//    "ajustado pela loja";
//  - cabeçalho troca x devolução, mensagem da loja, "outras devoluções" e o
//    link de rastreio só enquanto o produto está a caminho;
//  - forma de informar o envio: etiqueta reversa com código não pede digitação,
//    envio próprio com código solto continua pedindo;
//  - a atualização obrigatória espera enquanto o rastreio é digitado ou enviado;
//  - a leitura do reembolso para de repetir quando termina, repete a cada 15 s
//    enquanto não terminou e não herda o status de outra devolução.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Desfecho } from "@/hooks/useDevolucaoCliente";
import { motivosDeOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import type { DevolucaoDetalhe, ResumoDevolucao } from "@/types/devolucao";

let statusDoReembolso: string | null = null;
const tabelasLidas: string[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn((tabela: string) => {
      tabelasLidas.push(tabela);
      const b: Record<string, unknown> = {};
      b.select = vi.fn(() => b);
      b.eq = vi.fn(() => b);
      b.maybeSingle = vi.fn(() =>
        Promise.resolve({
          data:
            statusDoReembolso === null ? null : { status: statusDoReembolso },
          error: null,
        }),
      );
      return b;
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function detalhe(extra: Partial<DevolucaoDetalhe> = {}): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV1",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "desisti",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: "reembolso",
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "concluida",
    valor_itens: 100,
    valor_frete_ida: 20,
    valor_reembolso: 120,
    refund_id: null,
    reembolso_manual: true,
    fotos: [],
    codigo_rastreio: null,
    codigo_postagem: null,
    me_reverse_id: null,
    etiqueta_url: null,
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: null,
    entregue_em: null,
    prazo_ate: "2026-11-10",
    politica: null,
    created_at: "2026-11-01T12:00:00Z",
    aprovada_em: null,
    postada_em: null,
    recebida_em: null,
    concluida_em: "2026-11-03T12:00:00Z",
    encerrada_em: null,
    itens: [
      {
        id: "i-1",
        order_item_id: "oi-1",
        product_id: "p-1",
        variant_id: null,
        product_name: "Camiseta",
        image_url: null,
        quantidade: 2,
        valor_unitario: 50,
        condicao: "nova",
        reestocar: false,
        reestocado_em: null,
      },
    ],
    eventos: [],
    pedido: null,
    ...extra,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onCancelar = vi.fn<(id: string) => Promise<Desfecho>>();
const onInformarEnvio =
  vi.fn<(id: string, codigo: string) => Promise<Desfecho>>();

beforeEach(() => {
  statusDoReembolso = null;
  tabelasLidas.length = 0;
  onCancelar.mockReset();
  onInformarEnvio.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

async function desenhar(
  extra: Partial<DevolucaoDetalhe> = {},
  anteriores: readonly ResumoDevolucao[] = [],
) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  await act(async () => {
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={detalhe(extra)}
        anteriores={anteriores}
        enderecoDaLoja={null}
        horarioDaLoja={null}
        onCancelar={onCancelar}
        onInformarEnvio={onInformarEnvio}
      />,
    );
  });
}

const textoDoCartao = () => hospedeiro.textContent ?? "";

function valorDaLinha(rotulo: string) {
  return Array.from(hospedeiro.querySelectorAll("dt")).find(
    (dt) => dt.textContent === rotulo,
  )?.nextElementSibling?.textContent;
}

function botao(texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(texto),
  );
}

function campoDoRastreio() {
  return hospedeiro.querySelector<HTMLInputElement>(
    'input[id^="rastreio-devolucao-"]',
  );
}

function digitar(campo: HTMLInputElement, valor: string) {
  const escrever = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    escrever?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const leiturasDoReembolso = () =>
  tabelasLidas.filter((t) => t === "order_refunds").length;

describe("cartão da devolução: dinheiro na tela", () => {
  it("reembolso decidido em R$ 0,00 mostra R$ 0,00 — nunca o total do pedido", async () => {
    await desenhar({ valor_reembolso: 0 });
    expect(valorDaLinha("Reembolso")).toContain("0,00");
    expect(valorDaLinha("Reembolso")).not.toContain("120,00");
    expect(textoDoCartao()).toContain("O valor final do reembolso");
  });

  it("a linha de cada item é quantidade x preço, não o preço de uma unidade", async () => {
    await desenhar();
    const linha = Array.from(hospedeiro.querySelectorAll("dt")).find((dt) =>
      dt.textContent?.includes("2× Camiseta"),
    );
    expect(linha?.nextElementSibling?.textContent).toContain("100,00");
  });

  it("frete de ida zero não ganha uma linha de R$ 0,00; frete cobrado aparece", async () => {
    await desenhar({ valor_frete_ida: 0, valor_reembolso: 100 });
    expect(valorDaLinha("Frete de ida")).toBeUndefined();
    await desenhar({ valor_frete_ida: 20 });
    expect(valorDaLinha("Frete de ida")).toContain("20,00");
  });

  it("sem valor de reembolso definido, mostra o total como 'Valor' e não fala em ajuste", async () => {
    await desenhar({ valor_reembolso: null });
    expect(valorDaLinha("Valor")).toContain("120,00");
    expect(valorDaLinha("Reembolso")).toBeUndefined();
    expect(textoDoCartao()).not.toContain("O valor final do reembolso");
  });

  it("reembolso maior que o pedido não é tratado como reembolso reduzido", async () => {
    await desenhar({ valor_reembolso: 150 });
    expect(valorDaLinha("Reembolso")).toContain("150,00");
    expect(textoDoCartao()).not.toContain("O valor final do reembolso");
  });
});

describe("cartão da devolução: cabeçalho, mensagem e histórico", () => {
  it("o cabeçalho diz 'Troca' só para troca e 'Devolução' para o resto", async () => {
    await desenhar({ tipo: "troca" });
    expect(textoDoCartao()).toContain("Troca · Troca");
    await desenhar({ tipo: "arrependimento" });
    expect(textoDoCartao()).toContain("Devolução · Arrependimento");
    expect(textoDoCartao()).not.toContain("Troca · Arrependimento");
  });

  it("'Mensagem da loja' só existe quando a loja escreveu algo", async () => {
    await desenhar({ mensagem_loja: null });
    expect(textoDoCartao()).not.toContain("Mensagem da loja");
    await desenhar({ mensagem_loja: "Traga com a etiqueta." });
    expect(textoDoCartao()).toContain("Mensagem da loja");
    expect(textoDoCartao()).toContain("Traga com a etiqueta.");
  });

  it("'Outras devoluções deste pedido' só aparece quando há outras", async () => {
    await desenhar({}, []);
    expect(textoDoCartao()).not.toContain("Outras devoluções deste pedido");
    await desenhar({}, [
      {
        id: "d-0",
        protocolo: "DV0",
        status: "recusada",
        tipo: "troca",
        resolucao_desejada: "troca",
        metodo_retorno: "envio_proprio",
        valor_itens: 10,
        created_at: "2026-10-01T12:00:00Z",
      },
    ]);
    expect(textoDoCartao()).toContain("Outras devoluções deste pedido");
    expect(textoDoCartao()).toContain("DV0");
  });

  it("o link de rastreio só aparece com o produto a caminho", async () => {
    const rastreio = { codigo_rastreio: "AB123456789BR" };
    await desenhar({
      ...rastreio,
      status: "em_transito",
      metodo_retorno: "envio_proprio",
    });
    expect(textoDoCartao()).toContain("Rastrear devolução");
    for (const status of ["aprovada", "recebida", "concluida"] as const) {
      await desenhar({ ...rastreio, status, metodo_retorno: "envio_proprio" });
      expect(textoDoCartao()).not.toContain("Rastrear devolução");
    }
  });
});

describe("cartão da devolução: como informar o envio", () => {
  it("etiqueta reversa com código gerado: só o botão 'Já postei', sem campo para digitar", async () => {
    await desenhar({
      status: "aprovada",
      metodo_retorno: "etiqueta_reversa",
      codigo_postagem: "PX123BR",
      etiqueta_url: "https://exemplo.test/dce.pdf",
      reembolso_manual: false,
      resolucao_final: null,
      valor_reembolso: null,
    });
    expect(botao("Já postei o pacote")).toBeDefined();
    expect(campoDoRastreio()).toBeNull();
  });

  it("envio próprio com código de postagem solto no registro continua pedindo o rastreio", async () => {
    await desenhar({
      status: "aprovada",
      metodo_retorno: "envio_proprio",
      codigo_postagem: "SOLTO123",
      resolucao_final: null,
      valor_reembolso: null,
      reembolso_manual: false,
    });
    expect(campoDoRastreio()).not.toBeNull();
    expect(botao("Já postei o pacote")).toBeUndefined();
  });
});

describe("cartão da devolução: a atualização obrigatória espera o envio", () => {
  const aprovada = {
    status: "aprovada" as const,
    resolucao_final: null,
    valor_reembolso: null,
    reembolso_manual: false,
  };
  const motivoDoRastreio = "rastreio-de-devolucao-digitado";

  it("campo vazio não segura a atualização; digitar segura; apagar solta", async () => {
    await desenhar({ ...aprovada, metodo_retorno: "envio_proprio" });
    expect(motivosDeOperacaoSensivel()).not.toContain(motivoDoRastreio);

    const campo = campoDoRastreio();
    if (!campo) throw new Error("campo do rastreio não apareceu");
    digitar(campo, "ab123456789br");
    expect(motivosDeOperacaoSensivel()).toContain(motivoDoRastreio);

    digitar(campo, "");
    expect(motivosDeOperacaoSensivel()).not.toContain(motivoDoRastreio);
  });

  it("'Já postei' segura a atualização enquanto envia, trava o botão e envia uma vez só", async () => {
    let terminar: (d: Desfecho) => void = () => {};
    onInformarEnvio.mockImplementation(
      () =>
        new Promise<Desfecho>((resolver) => {
          terminar = resolver;
        }),
    );
    await desenhar({
      ...aprovada,
      metodo_retorno: "etiqueta_reversa",
      codigo_postagem: "PX123BR",
      etiqueta_url: "https://exemplo.test/dce.pdf",
    });
    expect(motivosDeOperacaoSensivel()).not.toContain(motivoDoRastreio);

    await act(async () => {
      botao("Já postei o pacote")?.click();
    });
    expect(motivosDeOperacaoSensivel()).toContain(motivoDoRastreio);
    const durante = botao("Já postei o pacote") as HTMLButtonElement;
    expect(durante.disabled).toBe(true);
    await act(async () => {
      durante.click();
    });
    expect(onInformarEnvio).toHaveBeenCalledTimes(1);
    expect(onInformarEnvio).toHaveBeenCalledWith("d-1", "PX123BR");

    await act(async () => {
      terminar({ ok: true, valor: undefined });
    });
    expect(motivosDeOperacaoSensivel()).not.toContain(motivoDoRastreio);
  });
});

describe("cartão da devolução: leitura do reembolso em andamento", () => {
  const reembolsoDoMercadoPago = {
    status: "concluida" as const,
    resolucao_final: "reembolso" as const,
    reembolso_manual: false,
    refund_id: "refund-1",
    valor_reembolso: 120,
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it.each(["concluido", "falhou", "recusado"])(
    "status '%s' é final: a leitura não se repete",
    async (final) => {
      statusDoReembolso = final;
      await desenhar(reembolsoDoMercadoPago);
      expect(leiturasDoReembolso()).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000);
      });
      expect(leiturasDoReembolso()).toBe(1);
    },
  );

  it("enquanto o dinheiro não saiu, relê a cada 15 segundos — nem antes, nem parado", async () => {
    statusDoReembolso = "em_processamento";
    await desenhar(reembolsoDoMercadoPago);
    expect(leiturasDoReembolso()).toBe(1);
    expect(textoDoCartao()).toContain("A loja está confirmando sua devolução");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    expect(leiturasDoReembolso()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(leiturasDoReembolso()).toBe(2);
  });

  it("outra devolução no mesmo cartão não herda o 'liberado' da anterior", async () => {
    statusDoReembolso = "concluido";
    await desenhar(reembolsoDoMercadoPago);
    expect(textoDoCartao()).toContain("liberado pelo Mercado Pago");

    // A segunda devolução ainda não tem leitura (a linha do livro não veio).
    statusDoReembolso = null;
    await desenhar({
      ...reembolsoDoMercadoPago,
      id: "d-2",
      refund_id: "refund-2",
    });
    expect(textoDoCartao()).not.toContain("liberado pelo Mercado Pago");
    expect(textoDoCartao()).toContain("A loja está confirmando sua devolução");
  });
});
