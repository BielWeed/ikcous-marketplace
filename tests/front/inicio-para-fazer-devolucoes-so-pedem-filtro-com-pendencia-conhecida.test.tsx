// @vitest-environment jsdom
//
// "Para fazer" do Início, linha "Devoluções abertas". Ao tocar nela com
// devoluções em andamento, o Início deixa um recado para a tela Devoluções
// abrir já no filtro "abertas" (o recado vale uma vez). Mas com a contagem
// DESCONHECIDA (o banco não respondeu: a linha mostra "—"), o toque só leva à
// tela: não existe pendência conhecida para filtrar, então nenhum recado é
// deixado (senão a tela abriria filtrada como se houvesse devoluções).
import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import {
  consumirFiltroDeDevolucoes,
  espiarFiltroDeDevolucoes,
} from "@/lib/aviso-leva-a-devolucoes-solicitadas";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function painelCom(devolucoesAbertas: number | null): PainelInicio {
  return {
    hoje: {
      receita: 100,
      online: 60,
      presencial: 40,
      pedidos: 2,
      receitaSemanaPassada: 50,
    },
    mes: {
      receita: 1000,
      receitaMesAnterior: 900,
      pedidos: 10,
      ticketMedio: 100,
      lucroEstimado: 300,
    },
    saldoTotal: 500,
    aReceber7d: 200,
    aPagar7d: 150,
    contasVencidas: 0,
    pendencias: {
      pedidosParaPreparar: 0,
      devolucoesAbertas,
      caixaAberto: false,
      estoqueBaixo: 0,
    },
    serie14d: [],
  };
}

let tela: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  consumirFiltroDeDevolucoes(); // começa sem recado pendente
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});

afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  consumirFiltroDeDevolucoes();
});

function linhaDeDevolucoes(): HTMLButtonElement | undefined {
  return Array.from(tela.querySelectorAll("button")).find((botao) =>
    (botao.getAttribute("aria-label") ?? "").startsWith("Devoluções abertas:"),
  );
}

function desenhar(devolucoesAbertas: number | null, onNavigate = vi.fn()) {
  act(() => {
    raiz.render(
      <ParaFazer
        painel={painelCom(devolucoesAbertas)}
        carregando={false}
        onNavigate={onNavigate}
      />,
    );
  });
  return onNavigate;
}

describe("Para fazer: o recado das devoluções abertas", () => {
  it("2 devoluções abertas: o toque leva à tela e deixa o recado 'abertas'", () => {
    const onNavigate = desenhar(2);
    const linha = linhaDeDevolucoes();
    expect(linha).toBeTruthy();
    act(() => linha?.click());
    expect(onNavigate).toHaveBeenCalledWith("admin-devolucoes");
    expect(espiarFiltroDeDevolucoes()).toBe("abertas");
  });

  it("contagem desconhecida (—): o toque leva à tela e NÃO deixa recado", () => {
    const onNavigate = desenhar(null);
    const linha = linhaDeDevolucoes();
    expect(linha).toBeTruthy();
    expect(linha?.textContent).toContain("—");
    act(() => linha?.click());
    expect(onNavigate).toHaveBeenCalledWith("admin-devolucoes");
    expect(espiarFiltroDeDevolucoes()).toBeNull();
  });

  it("zero devolução aberta: a linha nem aparece", () => {
    desenhar(0);
    expect(linhaDeDevolucoes()).toBeUndefined();
    expect(espiarFiltroDeDevolucoes()).toBeNull();
  });
});
