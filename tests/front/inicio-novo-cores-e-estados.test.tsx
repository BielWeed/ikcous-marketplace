// @vitest-environment jsdom
//
// Novo Início (21/10/2026), regra das cores do dono: verde = positivo,
// vermelho = negativo, âmbar = atenção, cinza = neutro; pontinho + texto,
// número e glifo na cor, nunca bloco pintado, e a cor nunca é a única pista.
import {
  DataDeHoje,
  dataPorExtenso,
} from "@/components/admin/inicio/DataDeHoje";
import { DinheiroNasContas } from "@/components/admin/inicio/DinheiroNasContas";
import { EstadoDaConexao } from "@/components/admin/inicio/EstadoDaConexao";
import { HojeNaLoja } from "@/components/admin/inicio/HojeNaLoja";
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import { SerieDe14Dias } from "@/components/admin/inicio/SerieDe14Dias";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAINEL: PainelInicio = {
  hoje: {
    receita: 1482,
    online: 1102,
    presencial: 380,
    pedidos: 9,
    receitaSemanaPassada: 1256,
  },
  mes: {
    receita: 18640,
    receitaMesAnterior: 16643,
    pedidos: 112,
    ticketMedio: 166.43,
    lucroEstimado: 4210,
  },
  saldoTotal: 6820,
  aReceber7d: 2340,
  aPagar7d: 1180,
  contasVencidas: 2,
  pendencias: {
    pedidosParaPreparar: 12,
    devolucoesAbertas: 0,
    caixaAberto: false,
    estoqueBaixo: 3,
  },
  serie14d: [],
};

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
});
const montar = (ui: React.ReactNode) => act(() => raiz.render(ui));
const texto = (el: Element | null) =>
  (el?.textContent ?? "").split(String.fromCharCode(160)).join(" ");

describe("data do cabeçalho", () => {
  it("diz 'Quarta, 21 de outubro' (sem -feira, com maiúscula)", () => {
    expect(dataPorExtenso(new Date("2026-10-21T15:00:00Z"))).toBe(
      "Quarta, 21 de outubro",
    );
    montar(<DataDeHoje />);
    expect(tela.querySelector('[data-testid="inicio-data"]')).not.toBeNull();
  });
});

describe("Ao vivo / estado da conexão", () => {
  const casos: [string, boolean, boolean, boolean, string, string, string][] = [
    [
      "conectado",
      false,
      false,
      false,
      "Ao vivo",
      "text-emerald-400",
      "conectado",
    ],
    [
      "atualizando",
      false,
      true,
      false,
      "Atualizando",
      "text-amber-400",
      "sua loja",
    ],
    [
      "sem internet",
      true,
      false,
      false,
      "Sem internet",
      "text-red-400",
      "desatualizados",
    ],
    [
      "falha",
      false,
      false,
      true,
      "Sem atualizar",
      "text-red-400",
      "atualizar os números",
    ],
  ];
  it.each(casos)(
    "%s: texto + cor + frase completa para leitor de tela",
    (_n, off, car, fal, visivel, cor, sr) => {
      montar(<EstadoDaConexao offline={off} carregando={car} falhou={fal} />);
      const status = tela.querySelector('[role="status"]');
      expect(texto(status)).toContain(visivel);
      expect(status?.querySelector(`.${cor}`)).not.toBeNull();
      expect(status?.querySelector(".sr-only")?.textContent).toContain(sr);
    },
  );
});

describe("destaque do dia", () => {
  it("variação verde com seta, janela honesta, e botão branco só com pedidos", () => {
    const onPreparar = vi.fn();
    montar(
      <HojeNaLoja
        hoje={PAINEL.hoje}
        carregando={false}
        paraPreparar={12}
        onPreparar={onPreparar}
      />,
    );
    expect(texto(tela)).toContain(
      "18% a mais que no mesmo dia da semana passada, até esta hora",
    );
    expect(tela.querySelector("span.text-emerald-400 svg")).not.toBeNull();
    expect(texto(tela)).toContain("12 pedidos esperando para preparar");
    const botao = tela.querySelector("button");
    expect(botao?.className).toContain("bg-white");
    act(() => botao?.click());
    expect(onPreparar).toHaveBeenCalledTimes(1);

    montar(
      <HojeNaLoja
        hoje={PAINEL.hoje}
        carregando={false}
        paraPreparar={0}
        onPreparar={onPreparar}
      />,
    );
    expect(tela.querySelector("button")).toBeNull();
  });

  it("sem base de comparação, texto cinza neutro", () => {
    montar(
      <HojeNaLoja
        hoje={{ ...PAINEL.hoje, receitaSemanaPassada: 0 }}
        carregando={false}
      />,
    );
    expect(texto(tela)).toContain("sem base de comparação");
    expect(tela.querySelector("span.text-zinc-400 svg")).toBeNull();
  });
});

describe("Para fazer", () => {
  it("tudo em dia fica verde e sem pendências", () => {
    const limpo: PainelInicio = {
      ...PAINEL,
      contasVencidas: 0,
      pendencias: {
        ...PAINEL.pendencias,
        pedidosParaPreparar: 0,
        estoqueBaixo: 0,
      },
    };
    montar(
      <ParaFazer painel={limpo} carregando={false} onNavigate={vi.fn()} />,
    );
    const verde = Array.from(tela.querySelectorAll("p.text-emerald-400")).find(
      (p) => p.textContent === "Tudo em dia",
    );
    expect(verde).toBeDefined();
    expect(texto(tela)).not.toContain("pendências");
  });
});

describe("Este mês e Dinheiro nas contas", () => {
  it("lucro negativo fica vermelho; positivo, verde", () => {
    montar(<NumerosDoMes painel={PAINEL} carregando={false} />);
    expect(tela.querySelector("p.text-emerald-400")?.textContent).toContain(
      "4.210",
    );
    montar(
      <NumerosDoMes
        painel={{ ...PAINEL, mes: { ...PAINEL.mes, lucroEstimado: -1250 } }}
        carregando={false}
      />,
    );
    expect(tela.querySelector("p.text-red-400")?.textContent).toContain(
      "1.250",
    );
  });

  it("saldo branco (vermelho se negativo), a receber verde, a pagar vermelho com vencidas", () => {
    montar(
      <DinheiroNasContas
        painel={PAINEL}
        carregando={false}
        onNavigate={vi.fn()}
      />,
    );
    const valor = (inicio: string) =>
      Array.from(tela.querySelectorAll("button"))
        .find((b) => (b.getAttribute("aria-label") ?? "").startsWith(inicio))
        ?.querySelector("strong");
    expect(valor("Saldo")?.className).toContain("text-white");
    expect(valor("A receber")?.className).toContain("text-emerald-400");
    expect(valor("A pagar")?.className).toContain("text-red-400");
    expect(texto(tela)).toContain("2 vencidas");
    montar(
      <DinheiroNasContas
        painel={{ ...PAINEL, saldoTotal: -480 }}
        carregando={false}
        onNavigate={vi.fn()}
      />,
    );
    expect(valor("Saldo")?.className).toContain("text-red-400");
  });
});

describe("gráfico dos 14 dias", () => {
  const serie = Array.from({ length: 14 }, (_, i) => ({
    dia: new Date(Date.UTC(2026, 9, 8 + i)).toISOString().slice(0, 10),
    receita: 10 + i,
  }));
  it("barras neutras e só o último dia na cor do resultado", () => {
    montar(<SerieDe14Dias serie={serie} carregando={false} />);
    const barras = tela.querySelectorAll('[data-testid="serie-14d-barra"]');
    expect(barras).toHaveLength(14);
    expect(barras[13].className).toContain("bg-emerald-400");
    expect(barras[0].className).toContain("bg-zinc-600");
    montar(
      <SerieDe14Dias
        serie={serie}
        carregando={false}
        tomDoUltimoDia="negativo"
      />,
    );
    expect(
      tela.querySelectorAll('[data-testid="serie-14d-barra"]')[13].className,
    ).toContain("bg-red-400");
  });
});
