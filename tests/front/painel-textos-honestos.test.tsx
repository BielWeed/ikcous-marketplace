// @vitest-environment jsdom
//
// Três textos do painel da lojista que não batiam com o número ao lado:
//   (a) "Vendas pagas no mês" dizia "vs. mês anterior", mas o banco compara do dia 1
//       até o MESMO dia do mês passado (`painel_inicio`, receita_mes_anterior);
//   (b) "A receber / A pagar em 7 dias" somava também o que JÁ VENCEU
//       (`venc <= hoje + 7`), enquanto o Financeiro separa "Vencido" de "Próximos 7 dias";
//   (c) o aviso de estoque dizia "1 unidade restantes".
// Só o TEXTO muda: os valores mostrados continuam os que o banco manda.
import { DinheiroNasContas } from "@/components/admin/inicio/DinheiroNasContas";
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import { type EntradaDeAvisos, montarAvisos } from "@/utils/avisos-do-lojista";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAINEL = {
  hoje: {
    receita: 350,
    online: 200,
    presencial: 150,
    pedidos: 4,
    receitaSemanaPassada: 280,
  },
  mes: {
    receita: 4200,
    receitaMesAnterior: 10000,
    pedidos: 12,
    ticketMedio: 350,
    lucroEstimado: 1000,
  },
  saldoTotal: 8765.43,
  aReceber7d: 1200.5,
  aPagar7d: 300,
  contasVencidas: 2,
  pendencias: {
    pedidosParaPreparar: 0,
    devolucoesAbertas: 0,
    caixaAberto: false,
    estoqueBaixo: 0,
  },
  serie14d: [],
} as const;

// O Intl põe um espaço sem quebra entre "R$" e o número: trocar por espaço comum.
const ESPACO_SEM_QUEBRA = String.fromCharCode(160);
const texto = (el: Element | null) =>
  (el?.textContent ?? "").split(ESPACO_SEM_QUEBRA).join(" ");

describe("Início: os textos dizem a janela que o banco calcula", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onNavigate = vi.fn();

  beforeEach(async () => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <>
          <NumerosDoMes painel={PAINEL} carregando={false} />
          <DinheiroNasContas
            painel={PAINEL}
            carregando={false}
            onNavigate={onNavigate}
          />
        </>,
      );
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("(a) a variação do mês diz 'mesmos dias do mês anterior', não 'mês anterior'", () => {
    const pagina = texto(hospedeiro);
    // 4200 / 10000: queda de 58%, dita com a janela inteira.
    expect(pagina).toContain("58% a menos que nos mesmos dias do mês anterior");
    expect(pagina).not.toContain("vs. mês anterior");
    expect(pagina).not.toContain("que no mês anterior");
  });

  it("(b) 'A receber' e 'A pagar' dizem que incluem o que já venceu", () => {
    const pagina = texto(hospedeiro);
    expect(
      texto(hospedeiro.querySelector('[aria-label^="A receber —"]')),
    ).toContain("Vencidas + próximos 7 dias");
    expect(
      texto(hospedeiro.querySelector('[aria-label^="A pagar —"]')),
    ).toContain("Vencidas + próximos 7 dias");
    expect(pagina).not.toContain("A receber em 7 dias");
    expect(pagina).not.toContain("A pagar em 7 dias");
  });

  it("(b2) os valores mostrados não mudam e o botão continua levando ao Financeiro", () => {
    const pagina = texto(hospedeiro);
    expect(pagina).toContain("R$ 1.200,50");
    expect(pagina).toContain("R$ 300,00");
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("A pagar —"),
    );
    expect(botao).toBeTruthy();
    act(() => botao?.click());
    expect(onNavigate).toHaveBeenCalledWith("admin-financeiro");
  });
});

describe("Aviso de estoque: singular e plural de 'restante'", () => {
  const VAZIO: EntradaDeAvisos = {
    pedidos: [],
    perguntasPendentes: 0,
    avaliacoes: [],
    produtos: [],
  };

  function detalheDoEstoque(stock: number): string {
    const avisos = montarAvisos({
      ...VAZIO,
      produtos: [
        {
          id: "p-1",
          name: "Caneta 3D",
          stock,
          estoqueMinimo: null,
          created_at: "2026-08-20T09:00:00.000Z",
        },
      ],
    });
    return avisos[0].detalhe;
  }

  it.each([
    [0, "Sem nenhuma unidade"],
    [1, "1 unidade restante"],
    [2, "2 unidades restantes"],
    [5, "5 unidades restantes"],
  ])("estoque %i → %s", (stock, esperado) => {
    expect(detalheDoEstoque(stock)).toBe(esperado);
  });
});
