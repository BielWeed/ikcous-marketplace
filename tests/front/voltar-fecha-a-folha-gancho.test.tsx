// @vitest-environment jsdom
//
// O GANCHO `useVoltarFechaAFolha` em si, sem tela nenhuma por cima: duas
// garantias novas que as folhas do cliente (avaliação, devolução, filtros,
// privacidade) pedem.
//   1. DUAS FOLHAS EMPILHADAS fecham UMA por vez, de cima para baixo. Antes, o
//      ouvinte da folha de baixo (registrado primeiro) tratava o Voltar e a de
//      cima ficava aberta.
//   2. A folha que RECUSA fechar (a pergunta "descartar o texto?", o envio em
//      andamento) devolve `false`: a entrada que o Voltar consumiu é empurrada
//      de novo, senão o Voltar seguinte tirava a cliente da tela inteira.
// Histórico REAL do jsdom (`history.back()` de verdade) e um "App" simulado
// que só navega quando a tela do histórico muda (o "já estamos no mesmo
// destino" do `syncWithUrl`). Molde: politicas-voltar-do-aparelho.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVoltarFechaAFolha } from "@/hooks/useVoltarFechaAFolha";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface Props {
  readonly baixoAberta: boolean;
  readonly cimaAberta: boolean;
  readonly aoVoltarBaixo: () => boolean | undefined;
  readonly aoVoltarCima: () => boolean | undefined;
}

function Duas({ baixoAberta, cimaAberta, aoVoltarBaixo, aoVoltarCima }: Props) {
  useVoltarFechaAFolha(baixoAberta, aoVoltarBaixo);
  useVoltarFechaAFolha(cimaAberta, aoVoltarCima);
  return null;
}

describe("useVoltarFechaAFolha — empilhadas e recusa de fechar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let navegacoesDoApp: string[];
  const ouvintes: Array<(e: PopStateEvent) => void> = [];

  const telaDoHistorico = () =>
    `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

  beforeEach(() => {
    globalThis.history.replaceState({ view: "home" }, "", "/");
    globalThis.history.pushState({ view: "pedido" }, "", "/pedido");
    navegacoesDoApp = [];
    let telaMostrada = telaDoHistorico();
    const ouvinte = () => {
      const alvo = telaDoHistorico();
      if (alvo === telaMostrada) return;
      telaMostrada = alvo;
      navegacoesDoApp.push(alvo);
    };
    ouvintes.push(ouvinte);
    globalThis.addEventListener("popstate", ouvinte);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    for (const o of ouvintes.splice(0)) {
      globalThis.removeEventListener("popstate", o);
    }
  });

  async function renderizar(props: Props) {
    await act(async () => {
      raiz.render(<Duas {...props} />);
      await esperar();
    });
  }

  async function apertarVoltar() {
    await act(async () => {
      globalThis.history.back();
      await esperar(60);
    });
    await act(async () => {
      await esperar(120);
    });
  }

  it("duas folhas empilhadas: o Voltar fecha a de CIMA, o seguinte a de baixo, e o App nunca troca de tela", async () => {
    const fechadas: string[] = [];
    const base = {
      aoVoltarBaixo: () => {
        fechadas.push("baixo");
        return undefined;
      },
      aoVoltarCima: () => {
        fechadas.push("cima");
        return undefined;
      },
    };
    await renderizar({ ...base, baixoAberta: true, cimaAberta: false });
    await renderizar({ ...base, baixoAberta: true, cimaAberta: true });
    expect(globalThis.history.state).toMatchObject({
      view: "pedido",
      folhaDePolitica: true,
    });

    await apertarVoltar();
    expect(fechadas).toEqual(["cima"]);
    // Quem é dono de `aberta` fecha a de cima, como a tela faz.
    await renderizar({ ...base, baixoAberta: true, cimaAberta: false });

    await apertarVoltar();
    expect(fechadas).toEqual(["cima", "baixo"]);
    await renderizar({ ...base, baixoAberta: false, cimaAberta: false });

    expect(globalThis.history.state).toEqual({ view: "pedido" });
    expect(globalThis.location.pathname).toBe("/pedido");
    expect(navegacoesDoApp).toEqual([]);
  });

  it("fechar a folha de CIMA pelo X não deixa a de baixo tratar o retorno como Voltar", async () => {
    const aoVoltarBaixo = vi.fn(() => undefined);
    const aoVoltarCima = vi.fn(() => undefined);
    const props = { aoVoltarBaixo, aoVoltarCima };
    await renderizar({ ...props, baixoAberta: true, cimaAberta: true });

    // O X da de cima: a tela só desliga `aberta`; o gancho devolve a entrada.
    await renderizar({ ...props, baixoAberta: true, cimaAberta: false });
    await act(async () => {
      await esperar(200);
    });

    expect(aoVoltarBaixo).not.toHaveBeenCalled();
    expect(aoVoltarCima).not.toHaveBeenCalled();
    // A entrada da de baixo continua lá, e o Voltar agora é DELA.
    expect(globalThis.history.state).toMatchObject({
      view: "pedido",
      folhaDePolitica: true,
    });
    await apertarVoltar();
    expect(aoVoltarBaixo).toHaveBeenCalledTimes(1);
    expect(navegacoesDoApp).toEqual([]);
  });

  it("folha que recusa fechar (devolve false): a entrada volta, e o Voltar seguinte ainda é da folha", async () => {
    const tentativas: number[] = [];
    const aoVoltarBaixo = () => {
      tentativas.push(tentativas.length + 1);
      // 1ª e 2ª: "perguntei se descarta" (continua aberta). 3ª: fechou.
      return tentativas.length >= 3 ? undefined : false;
    };
    await renderizar({
      baixoAberta: true,
      cimaAberta: false,
      aoVoltarBaixo,
      aoVoltarCima: () => undefined,
    });
    const entradas = globalThis.history.length;

    await apertarVoltar();
    expect(tentativas).toHaveLength(1);
    // Recusou: a entrada foi empurrada de novo, com a marca.
    expect(globalThis.history.state).toMatchObject({
      view: "pedido",
      folhaDePolitica: true,
    });
    expect(globalThis.history.length).toBe(entradas);
    expect(globalThis.location.pathname).toBe("/pedido");

    await apertarVoltar();
    expect(tentativas).toHaveLength(2);
    expect(globalThis.history.state).toMatchObject({ folhaDePolitica: true });

    await apertarVoltar();
    expect(tentativas).toHaveLength(3);
    // Fechou de verdade: sem entrada empurrada de sobra, tela intacta.
    expect(globalThis.history.state).toEqual({ view: "pedido" });
    expect(navegacoesDoApp).toEqual([]);
  });

  it("folha que fecha (devolve nada) NÃO empurra entrada de volta", async () => {
    const props = {
      aoVoltarBaixo: () => undefined,
      aoVoltarCima: () => undefined,
    };
    await renderizar({ ...props, baixoAberta: true, cimaAberta: false });
    await apertarVoltar();
    // A tela, dona de `aberta`, fecha a folha.
    await renderizar({ ...props, baixoAberta: false, cimaAberta: false });
    expect(globalThis.history.state).toEqual({ view: "pedido" });
    // O Voltar seguinte já é do roteador.
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });
});
