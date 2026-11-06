// @vitest-environment jsdom
//
// Financeiro — Extrato com muitos lançamentos: a lista aparece em blocos
// (~100 por vez, sempre fechando o dia) com "Ver mais", em vez de desenhar
// milhares de linhas de uma vez. Totais e saldo do dia seguem sobre TODOS os
// lançamentos, e o bloco volta ao inicial quando muda período, conta ou filtro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AbaExtrato } from "@/components/admin/financeiro/AbaExtrato";
import { CONTA_BANCARIA } from "@/types/financeiro";

const DIAS = 21;
const POR_DIA = 12; // 252 lançamentos de R$ 10,00 (R$ 2.520,00 no total)

const extrato = () =>
  Array.from({ length: DIAS * POR_DIA }, (_, i) => ({
    id: `l${i}`,
    origem: "manual",
    tipo: "entrada",
    status: "realizado",
    valor: 10,
    data: `2026-10-${String(Math.floor(i / POR_DIA) + 1).padStart(2, "0")}`,
    conta_id: CONTA_BANCARIA,
    conta_nome: "Conta bancária",
    categoria_nome: "Vendas",
    descricao: `Lançamento ${i}`,
    editavel: false,
  }));

const noop = () => {};
let raiz: Root;
let hospedeiro: HTMLDivElement;

function tela(inicio = "2026-10-01") {
  return (
    <AbaExtrato
      ativo
      intervalo={{ inicio, fim: "2026-10-31" }}
      hoje="2026-10-31"
      versao={0}
      contas={[]}
      rotuloDoPeriodo="Outubro de 2026"
      abrirFolha={noop}
      aoNovoLancamento={noop}
    />
  );
}

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const linhasNaTela = () => hospedeiro.querySelectorAll("li").length;
const botao = (texto: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(texto),
  );
const topo = () =>
  hospedeiro.querySelector('section[aria-label="Resultado do período"]')
    ?.textContent;

async function clicar(texto: string) {
  await act(async () => {
    botao(texto)?.click();
  });
}

beforeEach(async () => {
  rpcFalso.mockReset();
  rpcFalso.mockResolvedValue({ data: extrato(), error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(tela());
  });
  await esperar();
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("Extrato em blocos", () => {
  it("lista longa mostra só o primeiro bloco (fechando o dia) e o botão diz quantos faltam", () => {
    // 9 dias de 12 = 108 (o primeiro múltiplo de dia que passa de 100).
    expect(linhasNaTela()).toBe(108);
    expect(botao("Ver mais")?.textContent).toContain("144");
    // O rótulo do grupo continua contando TODOS os lançamentos.
    expect(
      hospedeiro
        .querySelector('[role="group"][aria-label$="lançamentos"]')
        ?.getAttribute("aria-label"),
    ).toBe("252 lançamentos");
  });

  it("Ver mais soma outro bloco até acabar, e o botão some", async () => {
    await clicar("Ver mais");
    expect(linhasNaTela()).toBe(204);
    await clicar("Ver mais");
    expect(linhasNaTela()).toBe(252);
    expect(botao("Ver mais")).toBeUndefined();
  });

  it("os totais do topo não mudam com o corte nem com o Ver mais", async () => {
    const antes = topo();
    expect(antes).toContain("2.520,00");
    await clicar("Ver mais");
    expect(topo()).toBe(antes);
  });

  it("trocar o filtro volta ao primeiro bloco", async () => {
    await clicar("Ver mais");
    expect(linhasNaTela()).toBe(204);
    await clicar("Entradas");
    expect(linhasNaTela()).toBe(108);
  });

  it("trocar o período volta ao primeiro bloco", async () => {
    await clicar("Ver mais");
    expect(linhasNaTela()).toBe(204);
    await act(async () => {
      raiz.render(tela("2026-09-01"));
    });
    await esperar();
    expect(linhasNaTela()).toBe(108);
  });

  it("lista curta não mostra o botão", async () => {
    rpcFalso.mockResolvedValue({ data: extrato().slice(0, 30), error: null });
    await act(async () => {
      raiz.render(tela("2026-08-01"));
    });
    await esperar();
    expect(linhasNaTela()).toBe(30);
    expect(botao("Ver mais")).toBeUndefined();
  });
});
