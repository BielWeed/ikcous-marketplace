// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) — seletor de período do Financeiro.
// A escolha do período decide QUAIS dias entram em todas as contas da tela
// (saldo, resultado, extrato): botão marcado errado ou clique que entrega outro
// período mostra números de outro intervalo sem avisar.
//
// O que os testes antigos não viam:
//  - só o período atual fica marcado (`aria-pressed`) e com o ícone de "certo";
//  - cada botão entrega o SEU período a quem escuta (e "Personalizado" não
//    entrega período nenhum: pede a folha de datas);
//  - a folha de datas abre com as datas que já estavam escolhidas (ou hoje), só
//    aplica depois de validar, entrega início e fim na ordem certa e apaga o
//    erro assim que a pessoa mexe em qualquer das duas datas.
// Dados inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  OpcoesDePeriodo,
  PeriodoPersonalizadoFolha,
  SeletorDePeriodo,
} from "@/components/admin/financeiro/SeletorDePeriodo";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HOJE = "2026-10-15";
const ROTULOS = [
  "Mês atual",
  "Mês anterior",
  "7 dias",
  "30 dias",
  "Ano",
  "Personalizado",
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.removeAttribute("style");
  document.body.className = "";
});

const normalizar = (t: string | null | undefined) =>
  (t ?? "")
    .replaceAll(String.fromCharCode(160), " ")
    .replace(/\s+/g, " ")
    .trim();

function botaoDe(
  dentro: ParentNode,
  rotulo: string,
  exato = false,
): HTMLButtonElement {
  const achado = [...dentro.querySelectorAll("button")].find((b) => {
    const t = normalizar(b.textContent);
    return exato ? t === rotulo : t.startsWith(rotulo);
  });
  if (!achado) throw new Error(`botão não achado: ${rotulo}`);
  return achado as HTMLButtonElement;
}

function clicar(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

describe("OpcoesDePeriodo (lista do celular)", () => {
  function montar(preset: Parameters<typeof OpcoesDePeriodo>[0]["periodo"]) {
    const aoEscolher = vi.fn();
    const aoPedirPersonalizado = vi.fn();
    act(() => {
      raiz.render(
        <OpcoesDePeriodo
          periodo={preset}
          hoje={HOJE}
          aoEscolher={aoEscolher}
          aoPedirPersonalizado={aoPedirPersonalizado}
        />,
      );
    });
    return { aoEscolher, aoPedirPersonalizado };
  }

  const marcados = () =>
    [...hospedeiro.querySelectorAll("button")]
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => normalizar(b.textContent));

  it("só o período atual fica marcado, e só ele tem o ícone de 'certo'", () => {
    montar({ preset: "7d" });
    const botoes = [...hospedeiro.querySelectorAll("button")];
    expect(botoes).toHaveLength(6);
    expect(marcados()).toHaveLength(1);
    expect(marcados()[0]).toMatch(/^7 dias/);
    for (const b of botoes) {
      const ativo = b.getAttribute("aria-pressed") === "true";
      expect(b.querySelectorAll("svg.lucide-check")).toHaveLength(
        ativo ? 1 : 0,
      );
      expect(b.querySelectorAll("svg.lucide-calendar-range")).toHaveLength(
        ativo ? 0 : 1,
      );
    }
  });

  it("trocar o período troca a marca", () => {
    montar({ preset: "ano" });
    expect(marcados()[0]).toMatch(/^Ano/);
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    montar({ preset: "personalizado" });
    expect(marcados()).toHaveLength(1);
    expect(marcados()[0]).toMatch(/^Personalizado/);
  });

  it.each([
    ["Mês atual", "mes_atual"],
    ["Mês anterior", "mes_anterior"],
    ["7 dias", "7d"],
    ["30 dias", "30d"],
    ["Ano", "ano"],
  ])(
    "tocar em '%s' entrega { preset: '%s' } e não pede a folha",
    (rotulo, preset) => {
      const { aoEscolher, aoPedirPersonalizado } = montar({ preset: "7d" });
      clicar(botaoDe(hospedeiro, rotulo));
      expect(aoEscolher).toHaveBeenCalledTimes(1);
      expect(aoEscolher).toHaveBeenCalledWith({ preset });
      expect(aoPedirPersonalizado).not.toHaveBeenCalled();
    },
  );

  it("tocar em 'Personalizado' pede a folha de datas e não escolhe período", () => {
    const { aoEscolher, aoPedirPersonalizado } = montar({ preset: "7d" });
    clicar(botaoDe(hospedeiro, "Personalizado"));
    expect(aoPedirPersonalizado).toHaveBeenCalledTimes(1);
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("cada linha diz o intervalo que escolhe (o do mês, o do ano e a instrução do personalizado)", () => {
    montar({ preset: "7d" });
    const sub = (rotulo: string) =>
      normalizar(botaoDe(hospedeiro, rotulo).textContent);
    expect(sub("Mês atual")).toMatch(/Outubro de 2026/);
    expect(sub("Mês anterior")).toMatch(/Setembro de 2026/);
    expect(sub("7 dias")).toMatch(/Últimos 7 dias/);
    expect(sub("30 dias")).toMatch(/Últimos 30 dias/);
    expect(sub("Ano")).toMatch(/Ano de 2026/);
    expect(sub("Personalizado")).toMatch(/Escolha o primeiro e o último dia/);
  });
});

describe("SeletorDePeriodo (linha do computador)", () => {
  function montar(
    preset: Parameters<typeof SeletorDePeriodo>[0]["periodo"],
    comOpcoes = true,
  ) {
    const aoEscolher = vi.fn();
    const aoPedirPersonalizado = vi.fn();
    const aoPedirOpcoes = vi.fn();
    act(() => {
      raiz.render(
        <SeletorDePeriodo
          periodo={preset}
          rotulo="Outubro de 2026"
          aoEscolher={aoEscolher}
          aoPedirPersonalizado={aoPedirPersonalizado}
          aoPedirOpcoes={comOpcoes ? aoPedirOpcoes : undefined}
        />,
      );
    });
    return { aoEscolher, aoPedirPersonalizado, aoPedirOpcoes };
  }

  const grupo = () => hospedeiro.querySelector('[role="group"]') as HTMLElement;

  it("o chip do celular diz o período e abre a lista de opções", () => {
    const { aoPedirOpcoes, aoEscolher } = montar({ preset: "mes_atual" });
    const chip = hospedeiro.querySelector(
      'button[aria-label="Período: Outubro de 2026"]',
    ) as HTMLButtonElement;
    expect(chip).not.toBeNull();
    clicar(chip);
    expect(aoPedirOpcoes).toHaveBeenCalledTimes(1);
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("só o período atual fica marcado e destacado", () => {
    montar({ preset: "30d" });
    const botoes = [...grupo().querySelectorAll("button")];
    expect(botoes.map((b) => normalizar(b.textContent))).toEqual(ROTULOS);
    const marcados = botoes.filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(marcados.map((b) => normalizar(b.textContent))).toEqual(["30 dias"]);
    expect(marcados[0]?.className).toContain("border-foreground");
    for (const b of botoes) {
      if (b === marcados[0]) continue;
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(b.className).not.toContain("border-foreground");
      expect(b.className).toContain("text-zinc-400");
    }
  });

  it.each([
    ["Mês atual", "mes_atual"],
    ["Mês anterior", "mes_anterior"],
    ["7 dias", "7d"],
    ["30 dias", "30d"],
    ["Ano", "ano"],
  ])("tocar em '%s' entrega { preset: '%s' }", (rotulo, preset) => {
    const { aoEscolher, aoPedirPersonalizado } = montar({
      preset: "personalizado",
    });
    clicar(botaoDe(grupo(), rotulo, true));
    expect(aoEscolher).toHaveBeenCalledWith({ preset });
    expect(aoEscolher).toHaveBeenCalledTimes(1);
    expect(aoPedirPersonalizado).not.toHaveBeenCalled();
  });

  it("tocar em 'Personalizado' pede a folha de datas e não escolhe período", () => {
    const { aoEscolher, aoPedirPersonalizado } = montar({ preset: "7d" });
    clicar(botaoDe(grupo(), "Personalizado", true));
    expect(aoPedirPersonalizado).toHaveBeenCalledTimes(1);
    expect(aoEscolher).not.toHaveBeenCalled();
  });
});

describe("PeriodoPersonalizadoFolha", () => {
  function montar(inicial: { inicio: string; fim: string } | null) {
    const aoAplicar = vi.fn();
    const aoFechar = vi.fn();
    act(() => {
      raiz.render(
        <PeriodoPersonalizadoFolha
          inicial={inicial}
          hoje={HOJE}
          aoFechar={aoFechar}
          aoAplicar={aoAplicar}
        />,
      );
    });
    return { aoAplicar, aoFechar };
  }

  const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
  const inicio = () => campo("fin-periodo-inicio");
  const fim = () => campo("fin-periodo-fim");
  const alerta = () => document.querySelector('[role="alert"]');

  function digitar(el: HTMLInputElement, valor: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(el, valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const aplicar = () => clicar(botaoDe(document.body, "Aplicar período"));

  it("sem período anterior, as duas datas abrem em hoje", () => {
    montar(null);
    expect(inicio().value).toBe(HOJE);
    expect(fim().value).toBe(HOJE);
  });

  it("com período anterior, as duas datas abrem com ele (cada uma no seu campo)", () => {
    montar({ inicio: "2026-03-01", fim: "2026-03-31" });
    expect(inicio().value).toBe("2026-03-01");
    expect(fim().value).toBe("2026-03-31");
  });

  it("aplica início e fim na ordem certa, sem mostrar erro", () => {
    const { aoAplicar } = montar({ inicio: "2026-03-01", fim: "2026-03-31" });
    aplicar();
    expect(aoAplicar).toHaveBeenCalledTimes(1);
    expect(aoAplicar).toHaveBeenCalledWith({
      inicio: "2026-03-01",
      fim: "2026-03-31",
    });
    expect(alerta()).toBeNull();
  });

  it("datas fora de ordem: mostra o motivo e NÃO aplica", () => {
    const { aoAplicar } = montar({ inicio: "2026-03-31", fim: "2026-03-01" });
    aplicar();
    expect(aoAplicar).not.toHaveBeenCalled();
    expect(normalizar(alerta()?.textContent)).toBe(
      "A data de fim vem antes da data de início.",
    );
  });

  it("mexer na data de INÍCIO apaga o erro; mexer na de FIM também", () => {
    const { aoAplicar } = montar({ inicio: "2026-03-31", fim: "2026-03-01" });
    aplicar();
    expect(alerta()).not.toBeNull();

    digitar(inicio(), "2026-02-01");
    expect(alerta()).toBeNull();
    expect(aoAplicar).not.toHaveBeenCalled();

    // Volta a errar (início depois do fim) e agora corrige pela data de FIM.
    digitar(inicio(), "2026-03-31");
    aplicar();
    expect(alerta()).not.toBeNull();
    digitar(fim(), "2026-04-30");
    expect(alerta()).toBeNull();

    aplicar();
    expect(aoAplicar).toHaveBeenCalledWith({
      inicio: "2026-03-31",
      fim: "2026-04-30",
    });
  });
});
