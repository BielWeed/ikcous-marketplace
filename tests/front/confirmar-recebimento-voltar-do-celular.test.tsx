// @vitest-environment jsdom
//
// Na ficha do pedido, "Marcar como recebido" abre a pergunta "Registrar
// recebimento" (dinheiro). Ela não tinha entrada no histórico: o Voltar do
// celular saía da ficha com a pergunta aberta. Agora usa
// `useVoltarFechaAFolha`: o Voltar fecha SÓ a pergunta e a ficha fica.
// Histórico REAL do jsdom e um "App" simulado que só navega quando a tela do
// histórico muda. Molde: barra-de-busca-voltar-do-celular.test.tsx.
import { ConfirmarRecebimento } from "@/components/admin/orders/ConfirmarRecebimento";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

let raiz: Root;
let hospedeiro: HTMLDivElement;
let navegacoesDoApp: string[];
const ouvintes: Array<(e: PopStateEvent) => void> = [];
const gravar = vi.fn(async () => {});

const tela = () =>
  `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

beforeEach(() => {
  globalThis.history.replaceState({ view: "home" }, "", "/");
  globalThis.history.pushState({ view: "admin-orders" }, "", "/pedidos");
  navegacoesDoApp = [];
  gravar.mockClear();
  let mostrada = tela();
  const ouvinte = () => {
    const alvo = tela();
    if (alvo === mostrada) return;
    mostrada = alvo;
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
  document.body.innerHTML = "";
  for (const o of ouvintes.splice(0)) {
    globalThis.removeEventListener("popstate", o);
  }
});

const janela = () => document.querySelector('[role="dialog"]');
const botao = (texto: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === texto,
  );

async function abrirPergunta() {
  await act(async () => {
    raiz.render(<ConfirmarRecebimento total={100} aoConfirmar={gravar} />);
    await esperar(0);
  });
  await act(async () => {
    botao("Marcar como recebido")?.click();
    await esperar(0);
  });
}

async function apertarVoltar() {
  await act(async () => {
    globalThis.history.back();
    await esperar();
  });
}

describe("ConfirmarRecebimento — a pergunta e o Voltar do celular", () => {
  it("aberta, a pergunta ganha UMA entrada no histórico, na mesma tela", async () => {
    await abrirPergunta();
    expect(janela()).not.toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);
    expect(globalThis.location.pathname).toBe("/pedidos");
  });

  it("o Voltar fecha SÓ a pergunta: a ficha não troca e nada é gravado", async () => {
    await abrirPergunta();
    await apertarVoltar();

    expect(janela()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.location.pathname).toBe("/pedidos");
    expect(globalThis.history.state?.view).toBe("admin-orders");
    expect(gravar).not.toHaveBeenCalled();
  });

  it("'Ainda não' devolve a entrada: o Voltar seguinte é do roteador", async () => {
    await abrirPergunta();
    await act(async () => {
      botao("Ainda não")?.click();
      await esperar(200);
    });

    expect(janela()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
    expect(navegacoesDoApp).toEqual([]);

    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });

  it("'Recebi' grava uma vez, fecha e também devolve a entrada", async () => {
    await abrirPergunta();
    await act(async () => {
      botao("Recebi")?.click();
      await esperar(200);
    });

    expect(gravar).toHaveBeenCalledTimes(1);
    expect(janela()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
    expect(navegacoesDoApp).toEqual([]);
  });
});
