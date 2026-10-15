import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @vitest-environment jsdom
//
// O período personalizado do Financeiro validava até 5 anos, mas o banco
// (`fin_resumo`, `fin_extrato`, `fin_dre`) recusa `p_fim - p_inicio > 400`
// com "Período inválido (até 400 dias)". Resultado: a lojista escolhia 2 anos,
// tocava em Aplicar e só então a consulta voltava com erro técnico. A tela
// passa a recusar, com a frase certa, o que o banco recusaria.
import { PeriodoPersonalizadoFolha } from "@/components/admin/financeiro/SeletorDePeriodo";
import {
  MAXIMO_DE_DIAS_DO_PERIODO,
  intervaloDoPeriodo,
  validarIntervalo,
} from "@/lib/financeiro";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A folha só usa a validação; o cliente do Supabase não é tocado aqui.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** `inicio` + `dias` dias, em `YYYY-MM-DD` (calendário puro, sem fuso). */
function somar(inicio: string, dias: number): string {
  const [ano, mes, dia] = inicio.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias))
    .toISOString()
    .slice(0, 10);
}

const INICIO = "2026-01-01";

describe("validarIntervalo — o mesmo limite do banco (400 dias)", () => {
  it("o limite da tela é 400", () => {
    expect(MAXIMO_DE_DIAS_DO_PERIODO).toBe(400);
  });

  it.each([
    [0, "um dia só (início == fim)", true],
    [30, "um mês", true],
    [364, "o ano inteiro", true],
    [399, "um dia abaixo do limite", true],
    [400, "no limite: o banco ainda aceita (fim - início = 400)", true],
    [401, "um dia acima: o banco recusa", false],
    [730, "dois anos: a tela deixava passar, o banco recusa", false],
    [1826, "perto de 5 anos: o antigo limite da tela", false],
  ])("%s dias de diferença (%s) → aceito? %s", (dias, _caso, aceito) => {
    const fim = somar(INICIO, dias);
    expect(validarIntervalo(INICIO, fim) === null).toBe(aceito);
    expect(
      intervaloDoPeriodo(
        { preset: "personalizado", personalizado: { inicio: INICIO, fim } },
        "2026-09-26",
      ) !== null,
    ).toBe(aceito);
  });

  it("a recusa fala em dias, em português, e não em anos nem no erro técnico do banco", () => {
    const frase = validarIntervalo(INICIO, somar(INICIO, 401));
    expect(frase).toContain("400 dias");
    expect(frase).not.toContain("5 anos");
    expect(frase).not.toContain("Período inválido");
  });

  it("as outras recusas seguem iguais (data ausente, fim antes do início)", () => {
    expect(validarIntervalo("", "2026-03-01")).toBe(
      "Informe a data de início.",
    );
    expect(validarIntervalo("2026-03-01", "")).toBe("Informe a data de fim.");
    expect(validarIntervalo("2026-03-02", "2026-03-01")).toBe(
      "A data de fim vem antes da data de início.",
    );
  });
});

describe("o limite da tela acompanha o do banco (anti-deriva)", () => {
  // Pasta fixa de migrations do próprio repositório, não entrada de usuário.
  /* eslint-disable security/detect-non-literal-fs-filename */
  const PASTA = join(process.cwd(), "supabase", "migrations");
  const ARQUIVOS = readdirSync(PASTA)
    .filter((nome) => /^\d{14}_.*\.sql$/.test(nome))
    .sort();

  /** O limite de dias da ÚLTIMA definição de cada função, em ordem de migration. */
  function limitesVigentes(): Map<string, number> {
    const vigentes = new Map<string, number>();
    const definicao =
      /CREATE OR REPLACE FUNCTION public\.(fin_resumo|fin_extrato|fin_dre)\(([\s\S]*?)\n\$[a-z_]*\$;/gi;
    for (const arquivo of ARQUIVOS) {
      const sql = readFileSync(join(PASTA, arquivo), "utf8");
      for (const casamento of sql.matchAll(definicao)) {
        const limite = /p_fim\s*-\s*p_inicio\s*>\s*(\d+)/.exec(casamento[2]);
        if (limite) vigentes.set(casamento[1], Number(limite[1]));
      }
    }
    return vigentes;
  }
  /* eslint-enable security/detect-non-literal-fs-filename */

  it.each(["fin_resumo", "fin_extrato", "fin_dre"])(
    "%s recusa exatamente o que a tela recusa",
    (funcao) => {
      expect(limitesVigentes().get(funcao)).toBe(MAXIMO_DE_DIAS_DO_PERIODO);
    },
  );
});

describe("PeriodoPersonalizadoFolha — a mensagem chega à lojista", () => {
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
  });

  async function abrir(inicial: { inicio: string; fim: string }) {
    const aoAplicar = vi.fn();
    await act(async () =>
      raiz.render(
        <PeriodoPersonalizadoFolha
          inicial={inicial}
          hoje="2026-09-26"
          aoFechar={vi.fn()}
          aoAplicar={aoAplicar}
        />,
      ),
    );
    return aoAplicar;
  }

  async function aplicar() {
    const botao = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Aplicar período"),
    );
    expect(botao).toBeTruthy();
    await act(async () => botao?.click());
  }

  it("dois anos: mostra a frase dos 400 dias e NÃO aplica", async () => {
    const aoAplicar = await abrir({ inicio: INICIO, fim: somar(INICIO, 730) });
    await aplicar();
    const alerta = document.body.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain("400 dias");
    expect(aoAplicar).not.toHaveBeenCalled();
  });

  it("400 dias: aplica", async () => {
    const intervalo = { inicio: INICIO, fim: somar(INICIO, 400) };
    const aoAplicar = await abrir(intervalo);
    await aplicar();
    expect(aoAplicar).toHaveBeenCalledWith(intervalo);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });
});
