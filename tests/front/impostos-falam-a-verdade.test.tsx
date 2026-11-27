// @vitest-environment jsdom
//
// Aba Impostos: três frases que afirmavam algo falso (caça de 27/11/2026). Nenhum número
// muda aqui; o que se prova é só o TEXTO e a condição que escolhe o texto.
//  1  a receita da aba é só pedidos + balcão: lançamento feito à mão no Financeiro, mesmo
//     na categoria "Vendas", não entra no medidor do MEI nem na estimativa do Simples, e
//     os avisos dizem isso com todas as letras (antes mandavam somar só "o que você
//     vendeu sem registrar aqui", e ela registrou aqui);
//  2  devoluções que igualam ou passam as vendas do mês: a tela não diz "Sem vendas neste
//     mês" quando houve venda;
//  3  RBT12 deduzida pela média (poucos meses, empresa nova): acima do sublimite/teto a
//     frase fala em PROJEÇÃO, nunca em "as vendas dos últimos 12 meses".
// Dados inventados; nenhuma loja específica.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { AVISO_DA_ESTIMATIVA } from "@/components/admin/financeiro/impostos/AvisoDaEstimativa";
import { EstimativaSimples } from "@/components/admin/financeiro/impostos/EstimativaSimples";
import { SemEstimativa } from "@/components/admin/financeiro/impostos/SemEstimativa";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { estimarDasDoSimples } from "@/lib/fiscal/estimativa-simples";
import {
  TEXTOS_DO_MEDIDOR_DO_MEI,
  efeitoDoVeredito,
} from "@/lib/fiscal/textos";

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

function montar(no: React.ReactNode): string {
  raiz = createRoot(hospedeiro);
  const atual = raiz;
  act(() => {
    atual.render(no);
  });
  return (hospedeiro.textContent ?? "").replaceAll(
    String.fromCharCode(160),
    " ",
  );
}

const LANCAMENTO_MANUAL_NAO_ENTRA =
  "lançamentos feitos à mão no Financeiro (mesmo na categoria Vendas)";

describe("1 — lançamento manual em Vendas não entra, e o texto diz isso", () => {
  it("o aviso fixo do medidor do MEI manda somar os lançamentos manuais por conta própria", () => {
    const aviso = TEXTOS_DO_MEDIDOR_DO_MEI.avisoFixo;
    expect(aviso).toContain("vendas feitas pelo app (pedidos e balcão)");
    expect(aviso).toContain(LANCAMENTO_MANUAL_NAO_ENTRA);
    expect(aviso).toContain("some por sua conta");
    // A frase antiga dizia que só faltava o que NÃO foi registrado aqui.
    expect(aviso).not.toContain(
      "Este número só tem as vendas registradas no app.",
    );
  });

  it("'dentro do limite' manda conferir também os lançamentos manuais", () => {
    for (const anoDeAbertura of [false, true]) {
      expect(efeitoDoVeredito("dentro", anoDeAbertura)).toContain(
        "lançamentos de venda feitos à mão no Financeiro",
      );
    }
  });

  it("o aviso da estimativa do Simples diz que os lançamentos manuais não entram", () => {
    expect(AVISO_DA_ESTIMATIVA).toContain(LANCAMENTO_MANUAL_NAO_ENTRA);
    expect(AVISO_DA_ESTIMATIVA).toContain(
      "vendas feitas pelo app (pedidos e balcão)",
    );
  });
});

describe("2 — devolução igual ou maior que a venda não vira 'Sem vendas'", () => {
  const tela = (receitaDoMes: number, vendasDoMes?: number) => (
    <EstimativaSimples
      estimativa={{ estado: "com_estimativa", valor: 0 }}
      competencia="2026-10"
      receitaDoMes={receitaDoMes}
      vendasDoMes={vendasDoMes}
    />
  );

  it("houve venda e as devoluções igualaram ou passaram: diz isso, e não 'Sem vendas'", () => {
    for (const liquida of [0, -50]) {
      const texto = montar(tela(liquida, 500));
      expect(texto, `líquida ${liquida}`).toContain(
        "As devoluções deste mês igualaram ou passaram as vendas, então não há imposto estimado.",
      );
      expect(texto, `líquida ${liquida}`).not.toContain("Sem vendas neste mês");
      expect(texto, `líquida ${liquida}`).not.toContain("cerca de");
      act(() => raiz?.unmount());
      raiz = null;
    }
  });

  it("sem venda nenhuma: continua 'Sem vendas neste mês'", () => {
    const texto = montar(tela(0, 0));
    expect(texto).toContain("Sem vendas neste mês");
    expect(texto).not.toContain("devoluções deste mês");
  });

  it("sem saber a venda bruta: uma frase verdadeira nos dois casos", () => {
    const texto = montar(tela(0));
    expect(texto).toContain("Sem receita líquida neste mês");
    expect(texto).not.toContain("Sem vendas neste mês");
  });
});

describe("3 — acima do sublimite ou do teto pela média: a frase fala em projeção", () => {
  type CadastroDaConta = Pick<
    CadastroFiscal,
    "regime" | "atividade" | "abertaEm" | "vendeNoAppDesde"
  >;
  const SIMPLES: CadastroDaConta = {
    regime: "simples",
    atividade: "comercio",
    abertaEm: null,
    vendeNoAppDesde: "2025-01-01",
  };
  const doze = (valor: number): Record<string, number> => {
    const meses: Record<string, number> = {};
    for (let m = 10; m <= 12; m += 1) meses[`2025-${m}`] = valor;
    for (let m = 1; m <= 9; m += 1) meses[`2026-0${m}`] = valor;
    return meses;
  };

  it("poucos meses no app: o resultado marca que a RBT12 é projeção", () => {
    const base = {
      cadastro: { ...SIMPLES, vendeNoAppDesde: "2026-09-01" },
      competencia: "2026-10",
      receitaDoMes: 1_000,
    };
    expect(
      estimarDasDoSimples({ ...base, receitasMensais: { "2026-09": 500_000 } }),
    ).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_teto",
      projecao: true,
    });
    expect(
      estimarDasDoSimples({ ...base, receitasMensais: { "2026-09": 350_000 } }),
    ).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_sublimite",
      projecao: true,
    });
  });

  it("empresa nova (média da vida dela x 12, ou o 1º mês x 12): também é projeção", () => {
    const nova = {
      ...SIMPLES,
      abertaEm: "2026-08-01",
      vendeNoAppDesde: "2026-08-01",
    };
    expect(
      estimarDasDoSimples({
        cadastro: nova,
        competencia: "2026-10",
        receitaDoMes: 1_000,
        receitasMensais: { "2026-08": 500_000, "2026-09": 500_000 },
      }),
    ).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_teto",
      projecao: true,
    });
    expect(
      estimarDasDoSimples({
        cadastro: nova,
        competencia: "2026-08",
        receitaDoMes: 500_000,
        receitasMensais: {},
      }),
    ).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_teto",
      projecao: true,
    });
  });

  it("12 meses medidos de verdade: soma real, sem a marca de projeção", () => {
    expect(
      estimarDasDoSimples({
        cadastro: SIMPLES,
        competencia: "2026-10",
        receitaDoMes: 1_000,
        receitasMensais: doze(500_000),
      }),
    ).toEqual({ estado: "sem_estimativa", motivo: "acima_do_teto" });
  });

  it("a tela, com projeção, diz 'pela média dos meses registrados no app' e nunca 'as vendas dos últimos 12 meses'", () => {
    const teto = montar(
      <SemEstimativa
        estimativa={{
          estado: "sem_estimativa",
          motivo: "acima_do_teto",
          projecao: true,
        }}
      />,
    );
    expect(teto).toContain(
      "Pela média dos meses registrados no app, a projeção de 12 meses passa do teto do Simples Nacional.",
    );
    expect(teto).not.toContain("últimos 12 meses");
    act(() => raiz?.unmount());
    raiz = null;

    const sublimite = montar(
      <SemEstimativa
        estimativa={{
          estado: "sem_estimativa",
          motivo: "acima_do_sublimite",
          projecao: true,
        }}
      />,
    );
    expect(sublimite).toContain(
      "Pela média dos meses registrados no app, a projeção de 12 meses passa do sublimite do Simples Nacional",
    );
    expect(sublimite).not.toContain("últimos 12 meses");
  });

  it("a tela, sem projeção, mantém 'As vendas dos últimos 12 meses'", () => {
    const teto = montar(
      <SemEstimativa
        estimativa={{ estado: "sem_estimativa", motivo: "acima_do_teto" }}
      />,
    );
    expect(teto).toContain(
      "As vendas dos últimos 12 meses passaram do teto do Simples Nacional.",
    );
  });
});
