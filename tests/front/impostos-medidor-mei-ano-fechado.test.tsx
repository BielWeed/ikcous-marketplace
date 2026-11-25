// @vitest-environment jsdom
//
// Medidor do MEI em janeiro: "2026 fechado" (decisão do sócio, 25/11/2026, item 7). Em
// janeiro de 2027, enquanto os valores de 2027 não foram conferidos, o medidor mostra o ano
// que acabou de fechar com o limite DELE (R$ 81.000,00), nunca um limite que não vale. O
// número só tem as vendas registradas no app (é um mínimo), então a frase nunca afirma que
// "você vendeu X" sem dizer que é o que o app registrou, e o aviso fixo continua embaixo.
//
// Componente de APRESENTAÇÃO: recebe o resultado de `medirLimiteDoMei` para 2026.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MedidorMei } from "@/components/admin/financeiro/impostos/MedidorMei";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import {
  type CoberturaDaReceita,
  medirLimiteDoMei,
} from "@/lib/fiscal/medidor-mei";
import { TEXTOS_DO_MEDIDOR_DO_MEI } from "@/lib/fiscal/textos";

const COMPLETA: CoberturaDaReceita = { tipo: "completa" };
const PARCIAL: CoberturaDaReceita = {
  tipo: "parcial",
  motivo: "comecou_depois_do_inicio",
  desde: "2026-03-01",
};

let raiz: Root | null = null;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
});

afterEach(() => {
  if (raiz) {
    const atual = raiz;
    act(() => {
      atual.unmount();
    });
  }
  raiz = null;
  hospedeiro.remove();
});

const semNbsp = (t: string | null | undefined) =>
  (t ?? "")
    .replaceAll(String.fromCharCode(160), " ")
    .replace(/\s+/g, " ")
    .trim();

function montarFechado(
  receita: number,
  opcoes: {
    readonly cobertura?: CoberturaDaReceita;
    readonly ocultos?: boolean;
    readonly abertaEm?: string | null;
  } = {},
): HTMLElement {
  raiz = createRoot(hospedeiro);
  const atual = raiz;
  const medidor = medirLimiteDoMei({
    receitaAcumulada: receita,
    ano: 2026,
    cadastro: { abertaEm: opcoes.abertaEm ?? null },
  });
  act(() => {
    atual.render(
      <ContextoValoresOcultos.Provider value={opcoes.ocultos ?? false}>
        <MedidorMei
          medidor={medidor}
          ano={2026}
          receitaAcumulada={receita}
          cobertura={opcoes.cobertura ?? COMPLETA}
          fechado
        />
      </ContextoValoresOcultos.Provider>,
    );
  });
  return hospedeiro;
}

const frase = (h: HTMLElement) =>
  semNbsp(h.querySelector("[data-ano-fechado]")?.textContent);

describe("MedidorMei — '2026 fechado'", () => {
  it("cobertura completa: a frase diz o que o app registrou e o limite DE 2026 (R$ 81.000,00)", () => {
    const h = montarFechado(12_345.67);
    expect(frase(h)).toBe(
      "2026 fechado: pelo que o app registrou, você vendeu R$ 12.345,67 de R$ 81.000,00 (limite de 2026).",
    );
    expect(semNbsp(h.textContent)).toContain("Limite do MEI em 2026");
  });

  it("cobertura parcial (o app começou depois de janeiro): não diz 'você vendeu'; diz o que o app registrou", () => {
    const h = montarFechado(8_000, { cobertura: PARCIAL });
    expect(frase(h)).toBe(
      "2026 fechado: o app registrou R$ 8.000,00 em vendas de 2026. O limite de 2026 era R$ 81.000,00.",
    );
    expect(frase(h)).not.toContain("você vendeu");
  });

  it("o aviso fixo (só as vendas do app contam) continua embaixo", () => {
    const h = montarFechado(12_345.67);
    expect(semNbsp(h.textContent)).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.avisoFixo,
    );
    expect(
      h.querySelector('[role="note"][aria-label="Aviso sobre o medidor"]'),
    ).not.toBeNull();
  });

  it("o único limite na tela é o de 2026: nunca R$ 110 mil nem outro valor, e sem barra de percentual de um ano que acabou", () => {
    const h = montarFechado(12_345.67);
    const texto = semNbsp(h.textContent);
    expect(texto).toContain("R$ 81.000,00");
    expect(texto).not.toMatch(/110\.000|2027/);
    expect(h.querySelector("[data-barra-enchimento]")).toBeNull();
  });

  it("ano de abertura: o limite de 2026 é o proporcional, e a frase usa ele (aberta em outubro: 3 meses x R$ 6.750 = R$ 20.250,00)", () => {
    const h = montarFechado(5_000, { abertaEm: "2026-10-05" });
    expect(frase(h)).toBe(
      "2026 fechado: pelo que o app registrou, você vendeu R$ 5.000,00 de R$ 20.250,00 (limite de 2026).",
    );
  });

  it("passou do limite de 2026 (cobertura completa): alerta que o total real é este número ou mais e manda falar com contador ou Sebrae", () => {
    const h = montarFechado(90_000);
    const alerta = h.querySelector('[role="alert"]');
    expect(alerta).not.toBeNull();
    const texto = semNbsp(alerta?.textContent);
    expect(texto).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.acimaDoLimiteComCoberturaParcial.titulo,
    );
    expect(texto).toContain("Fale logo com um contador ou com o Sebrae");
  });

  it("passou do limite de 2026 (cobertura parcial): o mesmo alerta", () => {
    const h = montarFechado(90_000, { cobertura: PARCIAL });
    expect(h.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("exatamente no limite (R$ 81.000,00) NÃO é alerta: ultrapassar é passar do valor", () => {
    const h = montarFechado(81_000);
    expect(h.querySelector('[role="alert"]')).toBeNull();
  });

  it("devolução maior que a venda: mostra R$ 0,00, nunca negativo", () => {
    const h = montarFechado(-300);
    expect(frase(h)).toContain("você vendeu R$ 0,00 de R$ 81.000,00");
  });

  it("Ocultar valores: o que vendeu vira máscara; o limite da lei e o rótulo ficam", () => {
    const h = montarFechado(12_345.67, { ocultos: true });
    const texto = semNbsp(h.querySelector("[data-ano-fechado]")?.textContent);
    expect(texto).not.toContain("12.345");
    expect(texto).toContain("2026 fechado");
    expect(texto).toContain("R$ 81.000,00");
    expect(texto).toContain("Valor oculto");
  });

  it("sem o 'fechado' o medidor é o normal de sempre (a frase do ano fechado não aparece)", () => {
    raiz = createRoot(hospedeiro);
    const atual = raiz;
    act(() => {
      atual.render(
        <ContextoValoresOcultos.Provider value={false}>
          <MedidorMei
            medidor={medirLimiteDoMei({
              receitaAcumulada: 1_000,
              ano: 2026,
              cadastro: { abertaEm: null },
            })}
            ano={2026}
            receitaAcumulada={1_000}
            cobertura={COMPLETA}
          />
        </ContextoValoresOcultos.Provider>,
      );
    });
    expect(hospedeiro.querySelector("[data-ano-fechado]")).toBeNull();
    expect(semNbsp(hospedeiro.textContent)).not.toContain("fechado");
  });

  it("ano 'fechado' sem conta (abertura depois do ano): mostra o aviso do núcleo, sem frase de vendas", () => {
    const h = montarFechado(0, { abertaEm: "2027-01-05" });
    expect(h.querySelector("[data-ano-fechado]")).toBeNull();
    expect(semNbsp(h.textContent)).toContain("é depois de 2026");
  });
});
