// @vitest-environment jsdom
//
// A data do cabeçalho do Início (antes no cartão "Hoje") e a coluna "Hoje" do gráfico de 14 dias eram
// calculadas só ao desenhar: com o Início aberto de um dia para o outro, ou
// voltando do segundo plano, continuavam em ontem. Relógio falso cruzando a
// meia-noite de São Paulo (UTC−3: 03:00Z). 14/10/2026 é uma quarta-feira.
import { DataDeHoje } from "@/components/admin/inicio/DataDeHoje";
import { SerieDe14Dias } from "@/components/admin/inicio/SerieDe14Dias";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ANTES_DA_MEIA_NOITE = "2026-10-14T02:59:50Z"; // 13/10, 23:59:50 em SP
const DEPOIS_DA_MEIA_NOITE = "2026-10-14T03:00:10Z"; // 14/10, 00:00:10 em SP

/** 14 dias terminando em 14/10/2026. */
const SERIE = Array.from({ length: 14 }, (_, i) => {
  const dia = new Date(Date.UTC(2026, 9, 14 - (13 - i)));
  return { dia: dia.toISOString().slice(0, 10), receita: i + 1 };
});

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("o Início acompanha o relógio através da meia-noite", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  const textoDaData = () =>
    hospedeiro.querySelector('[data-testid="inicio-data"]')?.textContent;

  it("a data do cabeçalho troca sozinha quando o dia vira com a tela aberta", async () => {
    await act(async () => raiz.render(<DataDeHoje />));
    expect(textoDaData()).toBe("Terça, 13 de outubro");
    await avancar(12_000);
    expect(textoDaData()).toBe("Quarta, 14 de outubro");
  });

  it("a data do cabeçalho troca quando o app volta a ficar visível no dia seguinte", async () => {
    await act(async () => raiz.render(<DataDeHoje />));
    expect(textoDaData()).toBe("Terça, 13 de outubro");
    // O celular congelou o app (sem temporizador) e o relógio andou.
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(textoDaData()).toBe("Quarta, 14 de outubro");
  });

  it("controle: sem virada de dia, a data não muda", async () => {
    await act(async () => raiz.render(<DataDeHoje />));
    await act(async () => {
      vi.setSystemTime(new Date("2026-10-14T02:59:55Z"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(textoDaData()).toBe("Terça, 13 de outubro");
  });

  const colunaDeHoje = () =>
    hospedeiro
      .querySelector('[data-testid="serie-14d-coluna"][data-hoje="true"]')
      ?.getAttribute("data-dia");

  it("a coluna 'Hoje' do gráfico anda para o dia novo na virada", async () => {
    await act(async () =>
      raiz.render(<SerieDe14Dias serie={SERIE} carregando={false} />),
    );
    expect(colunaDeHoje()).toBe("2026-10-13");
    await avancar(12_000);
    expect(colunaDeHoje()).toBe("2026-10-14");
  });

  it("a coluna 'Hoje' também anda quando o app volta do segundo plano", async () => {
    await act(async () =>
      raiz.render(<SerieDe14Dias serie={SERIE} carregando={false} />),
    );
    expect(colunaDeHoje()).toBe("2026-10-13");
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(colunaDeHoje()).toBe("2026-10-14");
  });
});
