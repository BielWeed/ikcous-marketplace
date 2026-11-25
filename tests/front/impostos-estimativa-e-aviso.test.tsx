// @vitest-environment jsdom
//
// Aba Impostos — estimativa do DAS, aviso fixo e "sem estimativa" na tela
// (Tarefa 19 da Gestão Fiscal). RISCO: dinheiro na tela.
//
// São componentes de APRESENTAÇÃO (props -> tela). O que o teste prova:
//  - TODA estimativa vem com o aviso fixo, no texto EXATO do parecer do sócio;
//  - "cerca de R$ 410": de 10 em 10, sem centavos; nunca "cerca de R$ 0"
//    (receita positiva com DAS arredondado a zero vira "menos de R$ 10");
//  - cor neutra e ícone de calculadora; nenhum tom de significado;
//  - regime sem conta mostra a frase honesta e NENHUM número;
//  - série incompleta: "faltam N meses", e nenhum número;
//  - a estimativa nunca vira valor devido nem tem botão/link que a lance;
//  - "Ocultar valores": a tela escondida é idêntica para valores diferentes.
// Dados inventados; nenhuma loja específica.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  AVISO_DA_ESTIMATIVA,
  AvisoDaEstimativa,
} from "@/components/admin/financeiro/impostos/AvisoDaEstimativa";
import { EstimativaSimples } from "@/components/admin/financeiro/impostos/EstimativaSimples";
import { SemEstimativa } from "@/components/admin/financeiro/impostos/SemEstimativa";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import {
  type EstimativaDoSimples,
  type MotivoSemEstimativa,
  estimarDasDoSimples,
} from "@/lib/fiscal/estimativa-simples";
import { fraseSemEstimativa } from "@/lib/fiscal/textos";

// O texto EXATO do parecer do sócio (24/11/2026), copiado à mão: se a tela mudar
// uma vírgula, este teste cai.
const AVISO_DO_PARECER =
  "Isto é uma estimativa feita com as vendas que passaram pelo IKCOUS. Não é o valor da sua guia. Vendas fora do app não entram, e produtos com ICMS-ST ou PIS/Cofins monofásico costumam pagar menos. O valor certo está na guia do Simples (PGDAS-D) ou com o seu contador.";

type Cadastro = Pick<CadastroFiscal, "regime" | "atividade">;
const SIMPLES_COMERCIO: Cadastro = {
  regime: "simples",
  atividade: "comercio",
};

let raiz: Root | null = null;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
});

afterEach(() => {
  desmontar();
  hospedeiro.remove();
});

function desmontar() {
  if (raiz) {
    const atual = raiz;
    act(() => {
      atual.unmount();
    });
  }
  raiz = null;
}

/** Desmonta e dá um hospedeiro novo (para montar duas telas no mesmo teste). */
function recomeçar() {
  desmontar();
  hospedeiro.remove();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
}

function montar(no: React.ReactNode, ocultos = false): HTMLElement {
  raiz = createRoot(hospedeiro);
  const atual = raiz;
  act(() => {
    atual.render(
      <ContextoValoresOcultos.Provider value={ocultos}>
        {no}
      </ContextoValoresOcultos.Provider>,
    );
  });
  return hospedeiro;
}

const semNbsp = (t: string | null | undefined) =>
  (t ?? "").replaceAll(String.fromCharCode(160), " ");
const textoDe = (el: HTMLElement) => semNbsp(el.textContent);

const comEstimativa = (valor: number): EstimativaDoSimples => ({
  estado: "com_estimativa",
  valor,
});

function estimativa(
  valor: number,
  receitaDoMes = 4_000,
  competencia = "2026-10",
) {
  return (
    <EstimativaSimples
      estimativa={comEstimativa(valor)}
      competencia={competencia}
      receitaDoMes={receitaDoMes}
    />
  );
}

const TONS_DE_SIGNIFICADO = /(?:text|bg|border)-(?:emerald|red|amber|sky)-\d+/;

describe("AvisoDaEstimativa — o texto fixo do parecer", () => {
  it("é exatamente o texto do parecer do sócio, na constante e na tela", () => {
    expect(AVISO_DA_ESTIMATIVA).toBe(AVISO_DO_PARECER);
    const h = montar(<AvisoDaEstimativa />);
    const nota = h.querySelector('[role="note"]') as HTMLElement;
    expect(nota).not.toBeNull();
    expect(textoDe(nota)).toBe(AVISO_DO_PARECER);
    expect(nota.getAttribute("aria-label")).toBe("Aviso sobre a estimativa");
  });
});

describe("EstimativaSimples — o número", () => {
  it("mostra 'cerca de R$ 410', sem centavos, com o aviso fixo embaixo", () => {
    const h = montar(estimativa(410));
    const texto = textoDe(h);
    expect(texto).toContain("cerca de R$ 410");
    expect(texto).not.toMatch(/410,/);
    expect(texto).not.toContain("R$ 410,00");
    // O aviso vem EMBAIXO do número, no mesmo cartão.
    const nota = h.querySelector('[role="note"]') as HTMLElement;
    expect(textoDe(nota)).toBe(AVISO_DO_PARECER);
    const numero = h.querySelector("[data-estimativa-valor]") as HTMLElement;
    expect(
      numero.compareDocumentPosition(nota) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("diz que é a estimativa do app, do DAS, e de qual mês de vendas", () => {
    const h = montar(estimativa(410));
    const texto = textoDe(h);
    expect(texto).toContain("Estimativa do app");
    expect(texto).toContain("DAS");
    expect(texto).toContain("outubro de 2026");
  });

  it("arredonda de 10 em 10 mesmo que o valor venha quebrado (metade sobe)", () => {
    const casos: ReadonlyArray<readonly [number, string]> = [
      [414.9, "cerca de R$ 410"],
      [405, "cerca de R$ 410"],
      [404.99, "cerca de R$ 400"],
      [10, "cerca de R$ 10"],
      [12_340, "cerca de R$ 12.340"],
    ];
    for (const [valor, esperado] of casos) {
      const h = montar(estimativa(valor));
      expect(textoDe(h), `valor ${valor}`).toContain(esperado);
      expect(textoDe(h), `valor ${valor}`).not.toMatch(/,\d\d/);
      recomeçar();
    }
  });

  it("DAS arredondado a zero com receita positiva: 'menos de R$ 10', nunca 'cerca de R$ 0'", () => {
    for (const valor of [0, 4, 4.99]) {
      const h = montar(estimativa(valor, 120));
      const texto = textoDe(h);
      expect(texto, `valor ${valor}`).toContain("menos de R$ 10");
      expect(texto, `valor ${valor}`).not.toMatch(/cerca de R\$ 0\b/);
      expect(texto, `valor ${valor}`).not.toContain("R$ 0,");
      // Com número (ainda que "menos de"), o aviso vem junto.
      expect(textoDe(h.querySelector('[role="note"]') as HTMLElement)).toBe(
        AVISO_DO_PARECER,
      );
      recomeçar();
    }
  });

  it("DAS zero sem receita no mês: diz que não houve venda, sem 'cerca de' e sem R$", () => {
    for (const receita of [0, -50]) {
      const h = montar(estimativa(0, receita));
      const texto = textoDe(h);
      expect(texto).toContain("Sem vendas neste mês");
      expect(texto).not.toContain("cerca de");
      expect(texto).not.toContain("R$");
      recomeçar();
    }
  });

  it("valor que não é um número de verdade nunca vira 'cerca de': mostra aviso de que não deu para calcular", () => {
    for (const valor of [Number.NaN, Number.POSITIVE_INFINITY, -30]) {
      const h = montar(estimativa(valor));
      const texto = textoDe(h);
      expect(texto, `valor ${valor}`).not.toContain("cerca de");
      expect(texto, `valor ${valor}`).not.toContain("R$");
      expect(texto, `valor ${valor}`).toContain("Não deu para calcular");
      recomeçar();
    }
  });

  it("competência inválida não derruba a tela e não inventa mês", () => {
    const h = montar(estimativa(410, 4_000, "2026-13"));
    expect(textoDe(h)).toContain("cerca de R$ 410");
    expect(textoDe(h)).not.toMatch(/undefined|NaN|Invalid/);
  });
});

describe("EstimativaSimples — cor neutra e ícone de calculadora", () => {
  it("tem o ícone de calculadora e nenhuma cor de significado", () => {
    const h = montar(estimativa(410));
    expect(h.querySelector("svg.lucide-calculator")).not.toBeNull();
    expect(h.innerHTML).not.toMatch(TONS_DE_SIGNIFICADO);
    // A calculadora e o aviso usam o tom neutro do painel.
    expect(h.innerHTML).toContain("text-zinc-400");
  });

  it("o 'menos de R$ 10' e o 'sem vendas' também são neutros", () => {
    const menos = montar(estimativa(0, 120));
    expect(menos.innerHTML).not.toMatch(TONS_DE_SIGNIFICADO);
    recomeçar();
    const sem = montar(estimativa(0, 0));
    expect(sem.innerHTML).not.toMatch(TONS_DE_SIGNIFICADO);
  });
});

describe("EstimativaSimples — nunca é valor devido nem ação", () => {
  it("não tem botão, link nem campo; não fala em 'devido', 'pagar' nem em lançar", () => {
    const telas: React.ReactNode[] = [
      estimativa(410),
      estimativa(0, 120),
      estimativa(0, 0),
      <EstimativaSimples
        key="faltam"
        estimativa={{
          estado: "sem_estimativa",
          motivo: "faltam_meses",
          faltam: 3,
        }}
        competencia="2026-10"
        receitaDoMes={4_000}
      />,
    ];
    for (const tela of telas) {
      const h = montar(tela);
      expect(h.querySelector("button, a, input, select, textarea")).toBeNull();
      expect(h.querySelector("[tabindex]")).toBeNull();
      const texto = textoDe(h).toLowerCase();
      expect(texto).not.toMatch(
        /devid|você deve|a pagar|lançar|lance |despesa|vencimento/,
      );
      recomeçar();
    }
  });

  it("o texto diz que é estimativa e que o valor certo está na guia", () => {
    const h = montar(estimativa(410));
    const texto = textoDe(h);
    expect(texto).toContain("Não é o valor da sua guia");
    expect(texto).toContain("estimativa");
  });
});

describe("EstimativaSimples — série incompleta e recusas do núcleo", () => {
  it("o núcleo real recusa por série incompleta: 'Faltam 12 meses' e nenhum número", () => {
    const resultado = estimarDasDoSimples({
      cadastro: {
        ...SIMPLES_COMERCIO,
        abertaEm: null,
        vendeNoAppDesde: "2026-08-01",
      },
      competencia: "2026-10",
      receitaDoMes: 4_000,
      receitasMensais: {},
    });
    expect(resultado).toEqual({
      estado: "sem_estimativa",
      motivo: "faltam_meses",
      faltam: 12,
    });
    const h = montar(
      <EstimativaSimples
        estimativa={resultado}
        competencia="2026-10"
        receitaDoMes={4_000}
      />,
    );
    const texto = textoDe(h);
    expect(texto).toContain("Faltam 12 meses");
    expect(texto).not.toContain("R$");
    expect(texto).not.toContain("cerca de");
    // Sem número, sem aviso da estimativa (não há estimativa para avisar).
    expect(h.querySelector('[role="note"]')).toBeNull();
  });

  it("singular e plural de 'faltam N meses'", () => {
    const tela = (faltam: number) => (
      <SemEstimativa
        estimativa={{
          estado: "sem_estimativa",
          motivo: "faltam_meses",
          faltam,
        }}
      />
    );
    const um = montar(tela(1));
    expect(textoDe(um)).toContain("Falta 1 mês");
    expect(textoDe(um)).not.toContain("Faltam");
    recomeçar();
    const tres = montar(tela(3));
    expect(textoDe(tres)).toContain("Faltam 3 meses");
  });

  it("'faltam' que não é um número positivo não vira 'Faltam NaN meses'", () => {
    for (const faltam of [0, -2, Number.NaN, 2.5]) {
      const h = montar(
        <SemEstimativa
          estimativa={{
            estado: "sem_estimativa",
            motivo: "faltam_meses",
            faltam,
          }}
        />,
      );
      const texto = textoDe(h);
      expect(texto, `faltam ${faltam}`).not.toMatch(/NaN|-\d|2,5|2\.5/);
      expect(texto, `faltam ${faltam}`).toContain("Ainda faltam meses");
      recomeçar();
    }
  });

  it("todo motivo de recusa do núcleo tem texto próprio, sem número e sem aviso", () => {
    // `Record` completo: um motivo novo no núcleo faz este arquivo não compilar.
    const MOTIVOS: Record<
      Exclude<MotivoSemEstimativa, "faltam_meses">,
      true
    > = {
      simples_com_servico: true,
      presumido: true,
      real: true,
      nao_sei: true,
      mei: true,
      competencia_invalida: true,
      ano_nao_conferido: true,
      receita_invalida: true,
      sem_mes_de_inicio_das_vendas: true,
      abertura_invalida: true,
      competencia_antes_da_abertura: true,
      mes_antes_das_vendas_no_app: true,
      acima_do_sublimite: true,
      acima_do_teto: true,
    };
    const vistos = new Set<string>();
    for (const motivo of Object.keys(MOTIVOS) as Array<
      Exclude<MotivoSemEstimativa, "faltam_meses">
    >) {
      const h = montar(
        <EstimativaSimples
          estimativa={{ estado: "sem_estimativa", motivo }}
          competencia="2026-10"
          receitaDoMes={4_000}
        />,
      );
      const texto = textoDe(h);
      expect(texto.length, motivo).toBeGreaterThan(20);
      expect(texto, motivo).not.toContain("R$");
      expect(texto, motivo).not.toContain("cerca de");
      expect(h.querySelector('[role="note"]'), motivo).toBeNull();
      expect(texto, motivo).not.toMatch(/undefined|NaN/);
      vistos.add(texto);
      recomeçar();
    }
    // Nenhum motivo cai num texto genérico repetido, exceto os 4 de regime
    // (cada um tem a sua frase honesta, mas todos são frases distintas também).
    expect(vistos.size).toBe(Object.keys(MOTIVOS).length);
  });
});

describe("SemEstimativa — regime sem conta: a frase honesta e nenhum número", () => {
  const SEM_CONTA: ReadonlyArray<Cadastro> = [
    { regime: "simples", atividade: "com_servico" },
    { regime: "presumido", atividade: "comercio" },
    { regime: "presumido", atividade: "com_servico" },
    { regime: "real", atividade: "comercio" },
    { regime: "nao_sei", atividade: "comercio" },
    { regime: "nao_sei", atividade: "com_servico" },
  ];

  for (const cadastro of SEM_CONTA) {
    it(`${cadastro.regime} / ${cadastro.atividade}: a frase do núcleo, inteira, e nada de número`, () => {
      const frase = fraseSemEstimativa(cadastro);
      expect(frase).not.toBeNull();
      const h = montar(<SemEstimativa cadastro={cadastro} />);
      const texto = textoDe(h);
      expect(texto).toContain(frase as string);
      expect(texto).toContain("Ainda não fazemos estimativa");
      expect(texto).toContain(
        "Seu caderno de guias e o arquivo para o contador funcionam normalmente.",
      );
      expect(texto).not.toMatch(/\d/);
      expect(texto).not.toContain("R$");
      expect(h.querySelector('[role="note"]')).toBeNull();
      expect(h.querySelector("button, a, input")).toBeNull();
    });

    it(`${cadastro.regime} / ${cadastro.atividade}: pelo motivo do núcleo dá a MESMA frase`, () => {
      const resultado = estimarDasDoSimples({
        cadastro: {
          ...cadastro,
          abertaEm: null,
          vendeNoAppDesde: "2026-01-01",
        },
        competencia: "2026-10",
        receitaDoMes: 4_000,
        receitasMensais: {},
      });
      expect(resultado.estado).toBe("sem_estimativa");
      const direto = montar(<SemEstimativa cadastro={cadastro} />);
      const frase = textoDe(direto);
      recomeçar();
      const pelaEstimativa = montar(
        <EstimativaSimples
          estimativa={resultado}
          competencia="2026-10"
          receitaDoMes={4_000}
        />,
      );
      expect(textoDe(pelaEstimativa)).toBe(frase);
    });
  }

  it("quem TEM conta (Simples só comércio) nunca recebe a frase de 'não fazemos estimativa para'", () => {
    const h = montar(
      <SemEstimativa
        estimativa={{
          estado: "sem_estimativa",
          motivo: "faltam_meses",
          faltam: 2,
        }}
      />,
    );
    expect(textoDe(h)).not.toContain("Ainda não fazemos estimativa para");
    expect(textoDe(h)).toContain("Faltam 2 meses");
  });
});

describe("EstimativaSimples — Ocultar valores", () => {
  it("com Ocultar ligado o valor some, o aviso fica, e duas estimativas dão a mesma tela", () => {
    const pequena = montar(estimativa(30, 500), true);
    const htmlPequena = pequena.innerHTML;
    expect(textoDe(pequena)).toContain("Valor oculto");
    expect(textoDe(pequena)).not.toContain("30");
    expect(textoDe(pequena.querySelector('[role="note"]') as HTMLElement)).toBe(
      AVISO_DO_PARECER,
    );
    recomeçar();
    const grande = montar(estimativa(12_340, 90_000), true);
    expect(textoDe(grande)).not.toContain("12.340");
    expect(grande.innerHTML).toBe(htmlPequena);
  });

  it("com Ocultar ligado, 'sem vendas no mês' também fica escondido (dá a mesma tela de qualquer mês)", () => {
    const semVenda = montar(estimativa(0, 0), true);
    expect(textoDe(semVenda)).not.toContain("Sem vendas");
    const htmlSemVenda = semVenda.innerHTML;
    recomeçar();
    const comVenda = montar(estimativa(30, 500), true);
    expect(comVenda.innerHTML).toBe(htmlSemVenda);
  });

  it("com Ocultar desligado (controle) o valor aparece", () => {
    const h = montar(estimativa(12_340, 90_000), false);
    expect(textoDe(h)).toContain("cerca de R$ 12.340");
    expect(textoDe(h)).not.toContain("Valor oculto");
  });
});

describe("estrutura e acessibilidade", () => {
  it("a estimativa é uma seção com nome; o ícone é decorativo (aria-hidden)", () => {
    const h = montar(estimativa(410));
    const secao = h.querySelector("section") as HTMLElement;
    expect(secao.getAttribute("aria-label")).toBe("Estimativa do DAS");
    const icone = h.querySelector("svg.lucide-calculator") as SVGElement;
    expect(
      icone.getAttribute("aria-hidden") ??
        icone.closest("[aria-hidden]")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
