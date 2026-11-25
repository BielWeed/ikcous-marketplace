// @vitest-environment jsdom
//
// "Vendas pagas hoje" (Início do painel): os números que a lojista lê de
// manhã. Provas diretas do cartão, sem montar a tela inteira (caça por
// mutação, 24/11/2026):
//  - "1 venda" no singular e "N vendas" no plural, inclusive "0 vendas";
//  - o botão "Ver pedidos em aberto" só nasce com pedido esperando (zero e
//    ausente não desenham nada) e só com a ação de abrir ligada;
//  - singular/plural do "esperando para preparar";
//  - a divisão App/Balcão aparece quando QUALQUER um dos dois tem número
//    (o outro vira "—"), e some só quando os dois são desconhecidos;
//  - enquanto carrega e ainda não há dado, o cartão mostra o esqueleto
//    ocupado; com dado em mãos, o número ganha do "carregando".
import { HojeNaLoja } from "@/components/admin/inicio/HojeNaLoja";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Hoje = PainelInicio["hoje"];

const hojeBase: Hoje = {
  receita: 250,
  online: 100,
  presencial: 150,
  pedidos: 3,
  receitaSemanaPassada: 200,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar(props: Parameters<typeof HojeNaLoja>[0]) {
  await act(async () => {
    raiz.render(<HojeNaLoja {...props} />);
  });
}

const texto = () => hospedeiro.textContent ?? "";
const botaoPreparar = () =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Ver pedidos em aberto"),
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("HojeNaLoja: contagem de vendas", () => {
  it("1 venda no singular", async () => {
    await montar({
      hoje: { ...hojeBase, pedidos: 1 },
      carregando: false,
    });
    expect(texto()).toMatch(/1\s*venda(?!s)/);
    expect(texto()).not.toContain("1 vendas");
  });

  it("0 vendas e 3 vendas no plural", async () => {
    await montar({ hoje: { ...hojeBase, pedidos: 0 }, carregando: false });
    expect(texto()).toMatch(/0\s*vendas/);

    await montar({ hoje: { ...hojeBase, pedidos: 3 }, carregando: false });
    expect(texto()).toMatch(/3\s*vendas/);
  });
});

describe("HojeNaLoja: botão de preparar pedidos", () => {
  it("não desenha nada quando não há pedido esperando (zero ou ausente)", async () => {
    const aoPreparar = vi.fn();
    await montar({
      hoje: hojeBase,
      carregando: false,
      paraPreparar: 0,
      onPreparar: aoPreparar,
    });
    expect(botaoPreparar()).toBeUndefined();
    expect(texto()).not.toContain("esperando para preparar");

    await montar({
      hoje: hojeBase,
      carregando: false,
      paraPreparar: null,
      onPreparar: aoPreparar,
    });
    expect(botaoPreparar()).toBeUndefined();
    expect(texto()).not.toContain("esperando para preparar");
  });

  it("sem a ação de abrir ligada, não promete um botão que não faz nada", async () => {
    await montar({ hoje: hojeBase, carregando: false, paraPreparar: 4 });
    expect(botaoPreparar()).toBeUndefined();
    expect(texto()).not.toContain("esperando para preparar");
  });

  it("1 pedido esperando no singular, N no plural, e o botão chama a ação uma vez", async () => {
    const aoPreparar = vi.fn();
    await montar({
      hoje: hojeBase,
      carregando: false,
      paraPreparar: 1,
      onPreparar: aoPreparar,
    });
    expect(texto()).toContain("1 pedido esperando para preparar");
    expect(texto()).not.toContain("1 pedidos esperando");

    await montar({
      hoje: hojeBase,
      carregando: false,
      paraPreparar: 5,
      onPreparar: aoPreparar,
    });
    expect(texto()).toContain("5 pedidos esperando para preparar");

    await act(async () => botaoPreparar()?.click());
    expect(aoPreparar).toHaveBeenCalledTimes(1);
  });
});

describe("HojeNaLoja: divisão App e Balcão", () => {
  it("com só um dos dois canais conhecido, mostra a divisão e o outro vira traço", async () => {
    await montar({
      hoje: { ...hojeBase, online: 90, presencial: null },
      carregando: false,
    });
    expect(hospedeiro.querySelector("dl")).not.toBeNull();
    const valores = Array.from(hospedeiro.querySelectorAll("dd")).map((dd) =>
      dd.textContent?.replace(/\s/g, " ").trim(),
    );
    expect(valores).toHaveLength(2);
    expect(valores[0]).toContain("90");
    expect(valores[1]).toBe("—");

    await montar({
      hoje: { ...hojeBase, online: null, presencial: 40 },
      carregando: false,
    });
    const depois = Array.from(hospedeiro.querySelectorAll("dd")).map((dd) =>
      dd.textContent?.replace(/\s/g, " ").trim(),
    );
    expect(depois[0]).toBe("—");
    expect(depois[1]).toContain("40");
  });

  it("com os dois desconhecidos, a divisão some", async () => {
    await montar({
      hoje: { ...hojeBase, online: null, presencial: null },
      carregando: false,
    });
    expect(hospedeiro.querySelector("dl")).toBeNull();
  });
});

describe("HojeNaLoja: carregando", () => {
  it("sem dado e carregando: esqueleto ocupado, sem número nem botão", async () => {
    await montar({
      hoje: null,
      carregando: true,
      paraPreparar: 3,
      onPreparar: vi.fn(),
    });
    expect(hospedeiro.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(hospedeiro.querySelector("dl")).toBeNull();
    expect(botaoPreparar()).toBeUndefined();
  });

  it("com dado em mãos, o número ganha do 'carregando' (atualização em segundo plano)", async () => {
    await montar({ hoje: hojeBase, carregando: true });
    expect(hospedeiro.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(texto()).toMatch(/250,00/);
    expect(hospedeiro.querySelector("dl")).not.toBeNull();
  });
});
