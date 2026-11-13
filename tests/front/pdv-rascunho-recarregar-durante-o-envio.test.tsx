// @vitest-environment jsdom
//
// Balcão — recarregar a tela (F5, aba restaurada pelo celular, atualização do
// PWA) NO MEIO do envio de uma venda. A resposta ainda não chegou, então a
// venda pode JÁ ter sido gravada no banco. Antes, o rascunho só guardava a
// incerteza depois que a rede falhava (`erro` = frase de rede); recarregar com
// `enviando: true` voltava com `erro: null`, o Cancelar jurava "Nada é
// registrado" e jogava fora a chave de idempotência — refazer a venda gravava
// DUAS vendas e baixava o estoque duas vezes para um único recebimento.
//
// Parte pura (serializar/ler) e o ciclo do hook (debounce, "grava ao sair",
// recibo, recusa). Mesmo molde de
// tests/front/venda-presencial-rascunho-nao-revive-venda-registrada.test.tsx:
// `createRoot` + `act` puro do React, Sonda por callback, fake timers ligados
// ANTES do render. Dados inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EstadoDaVenda,
  type OpcoesDoVendaPresencial,
  type VendaPresencialEmUso,
  estadoInicialDaVenda,
  lerRascunho,
  serializarRascunho,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";
import { MENSAGEM_DE_REDE_DA_VENDA } from "@/lib/erro-da-venda-presencial";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AGORA = Date.parse("2026-11-12T15:00:00-03:00");
const CHAVE_DO_RASCUNHO = "admin_pdv_venda_draft:lojista-1";

const ITEM = {
  chave: "prod-1::",
  productId: "prod-1",
  variantId: null,
  nome: "Caneca Azul",
  variacao: null,
  preco: 10,
  quantidade: 1,
  estoque: 5,
  imagem: "",
};

function cupomFechando(
  sessao: Pick<EstadoDaVenda, "enviando" | "erro">,
): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-1"),
    etapa: "fechamento",
    pagamento: "cash",
    itens: [ITEM],
    ...sessao,
  };
}

describe("rascunho do balcão — recarregar durante o envio (parte pura)", () => {
  it("enviando: true grava o fato talvezGravada, e a leitura devolve a frase de rede", () => {
    const disco = serializarRascunho(
      cupomFechando({ enviando: true, erro: null }),
      AGORA,
    );
    expect(JSON.parse(disco).talvezGravada).toBe(true);
    // Só o fato vai ao disco: nem o texto, nem `enviando`.
    expect(disco).not.toContain(MENSAGEM_DE_REDE_DA_VENDA);
    expect(JSON.parse(disco).enviando).toBeUndefined();

    const lido = lerRascunho(disco, AGORA);
    expect(lido?.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
    // A tela volta parada (não fica "enviando" para sempre) e com a MESMA
    // chave: é ela que faz a nova tentativa devolver a venda que já entrou.
    expect(lido?.enviando).toBe(false);
    expect(lido?.chaveDeIdempotencia).toBe("chave-1");
    expect(lido?.itens).toHaveLength(1);
  });

  it("sem envio em curso e sem erro, nada é gravado (cupom comum continua sem aviso)", () => {
    const disco = serializarRascunho(
      cupomFechando({ enviando: false, erro: null }),
      AGORA,
    );
    expect("talvezGravada" in JSON.parse(disco)).toBe(false);
    expect(lerRascunho(disco, AGORA)?.erro).toBeNull();
  });

  it("recusa conhecida (estoque) com o envio já encerrado NÃO grava a incerteza", () => {
    const disco = serializarRascunho(
      cupomFechando({
        enviando: false,
        erro: "Estoque insuficiente (Disponível: 1, Solicitado: 3)",
      }),
      AGORA,
    );
    expect("talvezGravada" in JSON.parse(disco)).toBe(false);
    expect(lerRascunho(disco, AGORA)?.erro).toBeNull();
  });

  it("falha de rede (enviando: false + frase de rede) segue gravando, como antes", () => {
    const disco = serializarRascunho(
      cupomFechando({ enviando: false, erro: MENSAGEM_DE_REDE_DA_VENDA }),
      AGORA,
    );
    expect(JSON.parse(disco).talvezGravada).toBe(true);
    expect(lerRascunho(disco, AGORA)?.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
  });
});

function criarArmazenamentoEmMemoria() {
  const mapa = new Map<string, string>();
  return {
    getItem: (chave: string) => mapa.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      mapa.set(chave, valor);
    },
    removeItem: (chave: string) => {
      mapa.delete(chave);
    },
  };
}

function Sonda({
  opcoes,
  aoAtualizar,
}: {
  readonly opcoes?: OpcoesDoVendaPresencial;
  readonly aoAtualizar: (venda: VendaPresencialEmUso) => void;
}) {
  const venda = useVendaPresencial(opcoes);
  aoAtualizar(venda);
  return null;
}

function ultimo(aoAtualizar: ReturnType<typeof vi.fn>): VendaPresencialEmUso {
  return aoAtualizar.mock.calls.at(-1)![0];
}

describe("useVendaPresencial — recarregar durante o envio (ciclo do hook)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazenamento = criarArmazenamentoEmMemoria();

  function opcoes(gerarChave: () => string): OpcoesDoVendaPresencial {
    return {
      armazenamento,
      userId: "lojista-1",
      gerarChave,
      atrasoDeGravacaoMs: 50,
    };
  }

  async function montar(gerarChave: () => string) {
    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <Sonda opcoes={opcoes(gerarChave)} aoAtualizar={aoAtualizar} />,
      );
    });
    return aoAtualizar;
  }

  async function desmontarERemontar(gerarChave: () => string) {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    return montar(gerarChave);
  }

  /** Cupom com uma caneca paga em dinheiro, já gravado em disco. */
  async function prepararCupom() {
    const aoAtualizar = await montar(() => "chave-fixa");
    await act(async () => {
      ultimo(aoAtualizar).despachar({
        tipo: "item_adicionado_manualmente",
        item: ITEM,
        em: 0,
      });
    });
    await act(async () => {
      ultimo(aoAtualizar).despachar({
        tipo: "pagamento_escolhido",
        pagamento: "cash",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    return aoAtualizar;
  }

  beforeEach(() => {
    armazenamento.removeItem(CHAVE_DO_RASCUNHO);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  it("envio pendente (resposta nunca chega): o rascunho já tem a marca e o recarregamento volta com o aviso e a mesma chave", async () => {
    const aoAtualizar = await prepararCupom();
    // Antes de tocar em Registrar o cupom está no disco, sem marca.
    expect(
      JSON.parse(armazenamento.getItem(CHAVE_DO_RASCUNHO)!).talvezGravada,
    ).toBeUndefined();

    await act(async () => {
      ultimo(aoAtualizar).despachar({ tipo: "envio_iniciado" });
    });
    expect(ultimo(aoAtualizar).estado.enviando).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(
      JSON.parse(armazenamento.getItem(CHAVE_DO_RASCUNHO)!).talvezGravada,
    ).toBe(true);

    // F5: a aba nova lê o disco.
    const depoisDoF5 = await desmontarERemontar(() => "chave-nova");
    const restaurada = ultimo(depoisDoF5);
    expect(restaurada.restaurado).toBe(true);
    expect(restaurada.estado.enviando).toBe(false);
    expect(restaurada.estado.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
    expect(restaurada.estado.chaveDeIdempotencia).toBe("chave-fixa");
    expect(restaurada.estado.itens).toHaveLength(1);
  });

  it("recarregar DENTRO do atraso de gravação: o 'grava ao sair' (pagehide) já leva a marca", async () => {
    const aoAtualizar = await prepararCupom();
    await act(async () => {
      ultimo(aoAtualizar).despachar({ tipo: "envio_iniciado" });
    });
    // O atraso (50 ms) ainda não passou: só o pagehide pode salvar a marca.
    expect(
      JSON.parse(armazenamento.getItem(CHAVE_DO_RASCUNHO)!).talvezGravada,
    ).toBeUndefined();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(
      JSON.parse(armazenamento.getItem(CHAVE_DO_RASCUNHO)!).talvezGravada,
    ).toBe(true);
  });

  it("venda registrada: o rascunho some e nenhuma gravação pendente do envio o devolve com a marca", async () => {
    const aoAtualizar = await prepararCupom();
    await act(async () => {
      ultimo(aoAtualizar).despachar({ tipo: "envio_iniciado" });
    });
    // A resposta chega DENTRO do atraso: a gravação com a marca ainda estava
    // agendada e tem de morrer com o recibo.
    await act(async () => {
      ultimo(aoAtualizar).despachar({
        tipo: "venda_registrada",
        recibo: {
          orderId: "ped-1",
          numero: "PED001",
          criadoEm: new Date(0).toISOString(),
          total: 10,
          subtotal: 10,
          desconto: 0,
          pagamento: "cash",
          cliente: { tipo: "sem_cliente" },
          itens: [],
          jaExistia: false,
        },
      });
    });
    expect(armazenamento.getItem(CHAVE_DO_RASCUNHO)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(armazenamento.getItem(CHAVE_DO_RASCUNHO)).toBeNull();
    // Mesmo o "grava ao sair" não tem mais nada pendente para gravar.
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(armazenamento.getItem(CHAVE_DO_RASCUNHO)).toBeNull();
  });

  it("recusa conhecida (estoque) ao fim do envio: o rascunho fica SEM a marca", async () => {
    const aoAtualizar = await prepararCupom();
    await act(async () => {
      ultimo(aoAtualizar).despachar({ tipo: "envio_iniciado" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(
      JSON.parse(armazenamento.getItem(CHAVE_DO_RASCUNHO)!).talvezGravada,
    ).toBe(true);

    await act(async () => {
      ultimo(aoAtualizar).despachar({
        tipo: "envio_falhou",
        mensagem: "Estoque insuficiente (Disponível: 1, Solicitado: 3)",
        efeito: "fecha",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(
      "talvezGravada" in JSON.parse(armazenamento.getItem(CHAVE_DO_RASCUNHO)!),
    ).toBe(false);
  });

  it("falha de rede ao fim do envio: a marca continua no disco", async () => {
    const aoAtualizar = await prepararCupom();
    await act(async () => {
      ultimo(aoAtualizar).despachar({ tipo: "envio_iniciado" });
    });
    await act(async () => {
      ultimo(aoAtualizar).despachar({
        tipo: "envio_falhou",
        mensagem: MENSAGEM_DE_REDE_DA_VENDA,
        efeito: "abre",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(
      JSON.parse(armazenamento.getItem(CHAVE_DO_RASCUNHO)!).talvezGravada,
    ).toBe(true);
  });
});
