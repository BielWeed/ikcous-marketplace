// A REGRA do aviso "transportadora sem pagamento pelo app" (14/10/2026).
//
// O defeito que ela serve: loja com transportadora ligada e pagamento pelo
// app desligado perde, em silêncio, toda venda para fora da cidade — o
// cliente só descobre no último passo do checkout, e o lojista nunca. As
// travas do checkout e do banco estão certas e não se mexem; a regra daqui só
// decide QUANDO o painel avisa o lojista.
//
// Três portas fechadas de propósito (cada uma é um falso alarme que o lojista
// pagante não perdoa):
//   - transportadora que não vende (sem chave, e-mail faltando, leitura
//     falhou, loja que atende só na cidade) NÃO acende o aviso;
//   - pagamento pelo app LIGADO NÃO acende;
//   - o estado do pagamento é o do painel (eco do que o servidor devolveu),
//     não o retrato velho do boot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { bootLigado } = vi.hoisted(() => ({ bootLigado: { valor: false } }));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => bootLigado.valor,
}));

import {
  AVISO_DE_PAUSAR,
  AVISO_DO_FRETE,
  transportadoraFicaSemPagamento,
  transportadoraVendeForaDaCidade,
} from "@/lib/aviso-transportadora-sem-pagamento";
import {
  esquecerEcoDoPagamentoPeloApp,
  pagamentoPeloAppAgora,
  publicarPagamentoPeloApp,
} from "@/lib/pagamento-pelo-app-no-painel";

describe("transportadoraVendeForaDaCidade", () => {
  it("transportadora ligada numa loja que atende o país: vende", () => {
    expect(
      transportadoraVendeForaDaCidade({
        cobertura: "national",
        nomesLigados: ["Melhor Envio"],
      }),
    ).toBe(true);
  });

  it("cobertura ausente vale 'national' (mesmo padrão da faixa-resumo)", () => {
    expect(
      transportadoraVendeForaDaCidade({
        cobertura: undefined,
        nomesLigados: ["Frenet"],
      }),
    ).toBe(true);
    expect(
      transportadoraVendeForaDaCidade({
        cobertura: "",
        nomesLigados: ["Frenet"],
      }),
    ).toBe(true);
  });

  it("loja que atende SÓ a cidade não vende por transportadora: sem aviso", () => {
    expect(
      transportadoraVendeForaDaCidade({
        cobertura: "local",
        nomesLigados: ["Melhor Envio"],
      }),
    ).toBe(false);
  });

  it("nenhuma ligada (lista vazia): não vende", () => {
    expect(
      transportadoraVendeForaDaCidade({
        cobertura: "national",
        nomesLigados: [],
      }),
    ).toBe(false);
  });

  it("leitura que não chegou ou falhou (null): NÃO chuta, não vende", () => {
    expect(
      transportadoraVendeForaDaCidade({
        cobertura: "national",
        nomesLigados: null,
      }),
    ).toBe(false);
  });
});

describe("transportadoraFicaSemPagamento", () => {
  it("transportadora vende + pagamento pelo app desligado: AVISA", () => {
    expect(
      transportadoraFicaSemPagamento({
        transportadoraVende: true,
        pagamentoPeloAppLigado: false,
      }),
    ).toBe(true);
  });

  it("transportadora vende + pagamento pelo app ligado: não avisa", () => {
    expect(
      transportadoraFicaSemPagamento({
        transportadoraVende: true,
        pagamentoPeloAppLigado: true,
      }),
    ).toBe(false);
  });

  it("sem transportadora, pagamento desligado é escolha da loja: não avisa", () => {
    expect(
      transportadoraFicaSemPagamento({
        transportadoraVende: false,
        pagamentoPeloAppLigado: false,
      }),
    ).toBe(false);
  });
});

describe("os textos falam com o lojista, sem jargão", () => {
  it("o aviso do Frete diz a consequência e a causa", () => {
    expect(AVISO_DO_FRETE.titulo).toBe(
      "Transportadora só funciona com pagamento pelo app ligado.",
    );
    expect(AVISO_DO_FRETE.detalhe).toContain(
      "Hoje seus clientes de outras cidades não conseguem finalizar a compra.",
    );
  });

  it("o aviso de pausar diz o que vai parar de vender", () => {
    expect(AVISO_DE_PAUSAR.titulo).toMatch(/transportadora/i);
    expect(AVISO_DE_PAUSAR.detalhe).toMatch(/outras cidades/i);
    expect(AVISO_DE_PAUSAR.detalhe).toMatch(/retomar/i);
  });
});

describe("pagamentoPeloAppAgora — o estado do painel, não o do boot", () => {
  beforeEach(() => {
    esquecerEcoDoPagamentoPeloApp();
  });
  afterEach(() => {
    esquecerEcoDoPagamentoPeloApp();
  });

  it("sem eco nenhum, vale o retrato do boot (ligado e desligado)", () => {
    bootLigado.valor = true;
    expect(pagamentoPeloAppAgora()).toBe(true);
    bootLigado.valor = false;
    expect(pagamentoPeloAppAgora()).toBe(false);
  });

  it("o eco do servidor VENCE o boot velho — nos dois sentidos", () => {
    bootLigado.valor = true;
    publicarPagamentoPeloApp(false);
    expect(pagamentoPeloAppAgora()).toBe(false);

    bootLigado.valor = false;
    publicarPagamentoPeloApp(true);
    expect(pagamentoPeloAppAgora()).toBe(true);
  });

  it("esquecer o eco devolve a palavra ao boot", () => {
    bootLigado.valor = true;
    publicarPagamentoPeloApp(false);
    esquecerEcoDoPagamentoPeloApp();
    expect(pagamentoPeloAppAgora()).toBe(true);
  });
});
