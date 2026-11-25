// @vitest-environment jsdom
//
// Aba Impostos — medidor do limite do MEI na tela (Tarefa 18 da Gestão Fiscal).
//
// O componente é de APRESENTAÇÃO: recebe o resultado de `medirLimiteDoMei` e
// desenha. O teste monta com o resultado REAL do núcleo (para provar que os dois
// conversam) e prova:
//  - as três faixas, cada uma com texto + ícone + cor de significado (nunca só cor);
//  - o número mostrado nunca contradiz a faixa (100,004% não aparece como "100%");
//  - ano não conferido: aviso no lugar do número (nada de R$ nem %);
//  - "Ocultar valores": nada do dinheiro nem do percentual aparece, a tela
//    escondida é IDÊNTICA para duas receitas diferentes (não vaza a ordem de grandeza),
//    e o aviso da faixa continua visível (quem passou do limite precisa saber);
//  - o aviso fixo "só conta as vendas feitas pelo IKCOUS" está em TODO estado;
//  - cobertura PARCIAL (o app não vendia desde o começo do período medido): o número
//    vem rotulado "Vendas registradas no IKCOUS neste ano" e NENHUMA frase conclui enquadramento
//    ("dentro do limite", "nada muda"); só passar do teto mostra o alerta de acima do
//    limite, sem a faixa nem o efeito (o total real é igual ou maior).
// Dados inventados; nenhuma loja específica.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MedidorMei } from "@/components/admin/financeiro/impostos/MedidorMei";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import {
  type CoberturaDaReceita,
  type MedidorDoMei,
  type MotivoSemContaDoMedidor,
  medirLimiteDoMei,
} from "@/lib/fiscal/medidor-mei";
import { TEXTOS_DO_MEDIDOR_DO_MEI } from "@/lib/fiscal/textos";
import { classeDoTexto } from "@/lib/tons-de-estado";

const ANO = 2026;
const COMPLETA: CoberturaDaReceita = { tipo: "completa" };
const PARCIAL_SEM_DATA: CoberturaDaReceita = {
  tipo: "parcial",
  motivo: "sem_data_de_inicio",
};
const PARCIAL_COMECOU_DEPOIS: CoberturaDaReceita = {
  tipo: "parcial",
  motivo: "comecou_depois_do_inicio",
  desde: "2026-03-01",
};

// Os títulos do ano COMPLETO: o número é um mínimo, então tudo começa com o prefixo.
const DENTRO = "Pelo que o IKCOUS registrou, você está dentro do limite";
const ATE_20 = "Pelo que o IKCOUS registrou, você passou do limite em até 20%";
const ACIMA_20 =
  "Pelo que o IKCOUS registrou, você passou do limite em mais de 20%";

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

function montar(
  medidor: MedidorDoMei,
  receitaAcumulada: number,
  opcoes: {
    readonly ocultos?: boolean;
    readonly ano?: number;
    readonly cobertura?: CoberturaDaReceita;
  } = {},
): HTMLElement {
  raiz = createRoot(hospedeiro);
  const atual = raiz;
  act(() => {
    atual.render(
      <ContextoValoresOcultos.Provider value={opcoes.ocultos ?? false}>
        <MedidorMei
          medidor={medidor}
          ano={opcoes.ano ?? ANO}
          receitaAcumulada={receitaAcumulada}
          cobertura={opcoes.cobertura ?? COMPLETA}
        />
      </ContextoValoresOcultos.Provider>,
    );
  });
  return hospedeiro;
}

function desmontar() {
  if (raiz) {
    const atual = raiz;
    act(() => {
      atual.unmount();
    });
  }
  raiz = null;
}

const semNbsp = (t: string | null | undefined) =>
  (t ?? "").replaceAll(String.fromCharCode(160), " ");
const textoDe = (el: HTMLElement) => semNbsp(el.textContent);

/** O medidor REAL do núcleo, para o ano cheio (sem data de abertura). */
const medirReal = (receitaAcumulada: number, ano = ANO) =>
  medirLimiteDoMei({ receitaAcumulada, ano, cadastro: { abertaEm: null } });

const tituloDaFaixa = (h: HTMLElement) =>
  h.querySelector<HTMLElement>("[data-faixa-titulo]") as HTMLElement;
const iconeDaFaixa = (h: HTMLElement) =>
  h.querySelector<SVGElement>("[data-faixa-icone]") as SVGElement;

describe("MedidorMei — as três faixas", () => {
  it("dentro do limite: texto, ícone de certo e cor de positivo", () => {
    const medidor = medirReal(40_500); // 50% do teto
    expect(medidor.estado).toBe("com_conta");
    const h = montar(medidor, 40_500);

    const titulo = tituloDaFaixa(h);
    expect(titulo.textContent).toBe(DENTRO);
    expect(titulo.className).toContain(classeDoTexto("positivo"));
    const icone = iconeDaFaixa(h);
    expect(icone.getAttribute("class")).toContain("lucide-circle-check");
    expect(icone.getAttribute("aria-hidden")).toBe("true");
    expect(textoDe(h)).toContain("50%");
    expect(textoDe(h)).toContain("R$ 81.000,00");
    // O efeito vem do núcleo, não é reescrito na tela.
    if (medidor.estado === "com_conta") {
      expect(textoDe(h)).toContain(medidor.efeito);
    }
  });

  it("até 20% acima: texto, ícone de alerta e cor de atenção", () => {
    const medidor = medirReal(90_000); // 111,1%
    expect(medidor.estado === "com_conta" && medidor.faixa).toBe(
      "excesso_ate_20",
    );
    const h = montar(medidor, 90_000);

    const titulo = tituloDaFaixa(h);
    expect(titulo.textContent).toBe(ATE_20);
    expect(titulo.className).toContain(classeDoTexto("atencao"));
    expect(iconeDaFaixa(h).getAttribute("class")).toContain(
      "lucide-triangle-alert",
    );
    expect(textoDe(h)).toContain("112%");
    if (medidor.estado === "com_conta") {
      expect(textoDe(h)).toContain(medidor.efeito);
    }
    expect(textoDe(h)).not.toContain("Fale com o seu contador hoje");
  });

  it("mais de 20% acima: texto, ícone de parada, cor de negativo e o 'fale com o contador'", () => {
    const medidor = medirReal(100_000); // 123,5%
    expect(medidor.estado === "com_conta" && medidor.faixa).toBe(
      "excesso_acima_20",
    );
    const h = montar(medidor, 100_000);

    const titulo = tituloDaFaixa(h);
    expect(titulo.textContent).toBe(ACIMA_20);
    expect(titulo.className).toContain(classeDoTexto("negativo"));
    expect(iconeDaFaixa(h).getAttribute("class")).toContain(
      "lucide-octagon-alert",
    );
    expect(textoDe(h)).toContain("124%");
    expect(textoDe(h)).toContain("Fale com o seu contador hoje");
    if (medidor.estado === "com_conta") {
      expect(textoDe(h)).toContain(medidor.efeito);
    }
  });

  it("cada faixa tem cor, ícone E texto próprios (a cor nunca é a única pista)", () => {
    const vistos = new Set<string>();
    for (const receita of [40_500, 90_000, 100_000]) {
      const h = montar(medirReal(receita), receita);
      const titulo = tituloDaFaixa(h);
      expect(titulo.textContent?.length).toBeGreaterThan(5);
      vistos.add(
        [
          titulo.textContent,
          titulo.className.match(/text-(?:emerald|amber|red)-\d+/)?.[0],
          iconeDaFaixa(h)
            .getAttribute("class")
            ?.match(/lucide-[a-z-]+/)?.[0],
        ].join("|"),
      );
      desmontar();
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
    }
    expect(vistos.size).toBe(3);
  });

  it("o número mostrado nunca contradiz a faixa (fronteiras em centavos)", () => {
    const casos: ReadonlyArray<readonly [number, string, string]> = [
      [81_000, "100%", DENTRO], // exatamente 100% ainda está dentro
      [80_999.99, "99%", DENTRO], // nunca arredonda para 100% dentro
      [81_000.01, "101%", ATE_20], // 1 centavo a mais já passou
      [97_200, "120%", ATE_20], // exatamente 120% ainda é "até 20%"
      [97_200.01, "121%", ACIMA_20],
      // Percentual inteiro EXATO que a divisão em ponto flutuante erra por um resíduo
      // (23.490/81.000 = 28,999999999999996; 89.100/81.000 = 110,00000000000001).
      [23_490, "29%", DENTRO],
      [89_100, "110%", ATE_20],
    ];
    for (const [receita, percentual, titulo] of casos) {
      const h = montar(medirReal(receita), receita);
      expect(tituloDaFaixa(h).textContent, `faixa de ${receita}`).toBe(titulo);
      expect(textoDe(h), `percentual de ${receita}`).toContain(percentual);
      desmontar();
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
    }
  });

  it("receita negativa (devoluções) mostra 0% e dentro do limite", () => {
    const h = montar(medirReal(-500), -500);
    expect(textoDe(h)).toContain("0%");
    expect(tituloDaFaixa(h).textContent).toBe(DENTRO);
    expect(textoDe(h)).not.toContain("−");
  });

  it("ano de abertura: diz que o limite é proporcional e mostra os meses", () => {
    const medidor = medirLimiteDoMei({
      receitaAcumulada: 10_000,
      ano: ANO,
      cadastro: { abertaEm: "2026-10-15" },
    });
    expect(medidor.estado).toBe("com_conta");
    const h = montar(medidor, 10_000);
    expect(textoDe(h)).toContain("3 meses");
    expect(textoDe(h)).toContain("R$ 20.250,00");
  });

  it("ano de abertura com 1 mês só: singular", () => {
    const medidor = medirLimiteDoMei({
      receitaAcumulada: 1_000,
      ano: ANO,
      cadastro: { abertaEm: "2026-12-01" },
    });
    const h = montar(medidor, 1_000);
    expect(textoDe(h)).toContain("1 mês");
    expect(textoDe(h)).not.toContain("1 meses");
  });

  it("a barra enche até o limite e para no fim da escala (nunca passa de 100% de largura)", () => {
    const largura = (receita: number) => {
      const h = montar(medirReal(receita), receita);
      const enchimento = h.querySelector<HTMLElement>(
        "[data-barra-enchimento]",
      ) as HTMLElement;
      const w = Number.parseFloat(enchimento.style.width);
      desmontar();
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      return w;
    };
    expect(largura(0)).toBe(0);
    // 50% do teto numa escala que vai até 120%.
    expect(largura(40_500)).toBeCloseTo((50 / 120) * 100, 1);
    // O limite fica na marca de 100/120 da barra.
    expect(largura(81_000)).toBeCloseTo((100 / 120) * 100, 1);
    expect(largura(500_000)).toBe(100);
  });
});

describe("MedidorMei — sem conta: aviso no lugar do número", () => {
  it("ano não conferido: diz de qual ano são os valores e qual não foi conferido, sem R$ nem %", () => {
    const medidor = medirReal(50_000, 2027);
    expect(medidor).toEqual({
      estado: "sem_conta",
      motivo: "ano_nao_conferido",
    });
    const h = montar(medidor, 50_000, { ano: 2027 });
    const texto = textoDe(h);
    expect(texto).toContain("valores da lei de 2026");
    expect(texto).toContain("os de 2027 ainda não foram conferidos");
    expect(texto).not.toContain("R$");
    expect(texto).not.toContain("%");
    expect(h.querySelector("[data-faixa-titulo]")).toBeNull();
    expect(h.querySelector("[data-barra-enchimento]")).toBeNull();
    // Nem o teto de 2026 emprestado: nenhum valor de dinheiro de lugar nenhum.
    expect(texto).not.toMatch(/81\.000|81 mil/);
  });

  const MOTIVOS: Record<MotivoSemContaDoMedidor, string> = {
    ano_nao_conferido: "ainda não foram conferidos",
    receita_invalida: "Não deu para somar",
    abertura_invalida: "data de abertura",
    abertura_depois_do_ano: "depois de 2026",
  };
  for (const [motivo, trecho] of Object.entries(MOTIVOS)) {
    it(`motivo ${motivo}: aviso próprio, sem número`, () => {
      const h = montar(
        {
          estado: "sem_conta",
          motivo: motivo as MotivoSemContaDoMedidor,
        },
        12_345,
      );
      const texto = textoDe(h);
      expect(texto).toContain(trecho);
      expect(texto).not.toContain("R$");
      expect(texto).not.toContain("%");
      expect(texto).not.toContain("12.345");
      expect(h.querySelector("[data-faixa-titulo]")).toBeNull();
    });
  }
});

describe("MedidorMei — Ocultar valores", () => {
  it("com Ocultar ligado, nem o dinheiro nem o percentual aparecem", () => {
    const h = montar(medirReal(63_000), 63_000, { ocultos: true });
    const texto = textoDe(h);
    expect(texto).toContain("Valor oculto");
    expect(texto).not.toContain("63.000");
    expect(texto).not.toContain("77%");
    expect(texto).not.toMatch(/\d+%/);
    // A barra entregaria o percentual pelo tamanho: não existe escondida.
    expect(h.querySelector("[data-barra-enchimento]")).toBeNull();
  });

  it("com Ocultar ligado, duas receitas da mesma faixa dão exatamente a mesma tela", () => {
    const pouco = montar(medirReal(2_000), 2_000, { ocultos: true });
    const htmlPouco = pouco.innerHTML;
    desmontar();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const quase = montar(medirReal(80_000), 80_000, { ocultos: true });
    expect(quase.innerHTML).toBe(htmlPouco);
  });

  it("com Ocultar ligado, o aviso de quem passou do limite continua na tela", () => {
    const medidor = medirReal(100_000);
    const h = montar(medidor, 100_000, { ocultos: true });
    expect(tituloDaFaixa(h).textContent).toBe(ACIMA_20);
    expect(textoDe(h)).toContain("Fale com o seu contador hoje");
    if (medidor.estado === "com_conta") {
      expect(textoDe(h)).toContain(medidor.efeito);
    }
  });

  it("com Ocultar desligado (controle), o dinheiro e o percentual aparecem", () => {
    const h = montar(medirReal(63_000), 63_000);
    expect(textoDe(h)).toContain("R$ 63.000,00");
    expect(textoDe(h)).toContain("77%");
    expect(h.querySelector("[data-barra-enchimento]")).not.toBeNull();
    expect(textoDe(h)).not.toContain("Valor oculto");
  });
});

describe("MedidorMei — acessibilidade e estrutura", () => {
  it("é uma seção com nome e título do ano; a barra é decoração e o texto leva a informação", () => {
    const h = montar(medirReal(40_500), 40_500);
    const secao = h.querySelector("section") as HTMLElement;
    expect(secao.getAttribute("aria-label")).toBe("Limite do MEI em 2026");
    expect(h.querySelector("h2")?.textContent).toBe("Limite do MEI em 2026");
    expect(
      h.querySelector("[data-barra-enchimento]")?.closest("[aria-hidden]"),
    ).not.toBeNull();
    // Só apresentação: nenhum botão, link ou campo.
    expect(h.querySelector("button, a, input, select, textarea")).toBeNull();
  });
});

const AVISO_FIXO =
  "Este número só tem as vendas registradas no IKCOUS. O que você vendeu sem registrar aqui (Instagram, WhatsApp, feira) também conta para o limite do MEI: some por sua conta.";

const aviso = (h: HTMLElement) =>
  h.querySelector<HTMLElement>(
    '[role="note"][aria-label="Aviso sobre o medidor"]',
  );

/** Desmonta e prepara um hospedeiro limpo, para montar de novo no mesmo teste. */
function recomecar() {
  desmontar();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
}

describe("MedidorMei — ano completo: o número é um mínimo, o veredito nunca promete", () => {
  it("cada faixa mostra o título e o efeito com 'Pelo que o IKCOUS registrou,' e nunca diz que nada muda", () => {
    for (const [receita, titulo] of [
      [10_000, DENTRO],
      [90_000, ATE_20],
      [120_000, ACIMA_20],
    ] as const) {
      const medidor = medirReal(receita);
      const h = montar(medidor, receita);
      expect(tituloDaFaixa(h).textContent).toBe(titulo);
      if (medidor.estado === "com_conta") {
        expect(medidor.efeito).toMatch(/^Pelo que o IKCOUS registrou, /);
        expect(textoDe(h)).toContain(medidor.efeito);
      }
      const t = textoDe(h).toLowerCase();
      expect(t).not.toContain("nada muda");
      expect(t).not.toContain("por causa da receita");
      recomecar();
    }
  });

  it("dentro do limite pede para conferir as vendas feitas por fora", () => {
    const h = montar(medirReal(10_000), 10_000);
    expect(textoDe(h)).toContain(
      "Pelo que o IKCOUS registrou, você está dentro do limite do MEI. Confira as vendas feitas por fora do app: elas também contam para o limite.",
    );
  });
});

describe("MedidorMei — o aviso fixo de que só contam as vendas pelo IKCOUS", () => {
  it("o texto da constante é o do pedido, palavra por palavra", () => {
    expect(TEXTOS_DO_MEDIDOR_DO_MEI.avisoFixo).toBe(AVISO_FIXO);
  });

  it("aparece com cobertura completa, em qualquer faixa", () => {
    for (const receita of [10_000, 90_000, 120_000]) {
      const h = montar(medirReal(receita), receita);
      expect(aviso(h)?.textContent).toBe(AVISO_FIXO);
      recomecar();
    }
  });

  it("aparece com cobertura parcial, nos dois motivos", () => {
    for (const cobertura of [PARCIAL_SEM_DATA, PARCIAL_COMECOU_DEPOIS]) {
      const h = montar(medirReal(10_000), 10_000, { cobertura });
      expect(aviso(h)?.textContent).toBe(AVISO_FIXO);
      recomecar();
    }
  });

  it("aparece com Ocultar valores ligado (o aviso não é um valor)", () => {
    const oculto = montar(medirReal(63_000), 63_000, { ocultos: true });
    expect(aviso(oculto)?.textContent).toBe(AVISO_FIXO);
    recomecar();
    const ocultoParcial = montar(medirReal(63_000), 63_000, {
      ocultos: true,
      cobertura: PARCIAL_SEM_DATA,
    });
    expect(aviso(ocultoParcial)?.textContent).toBe(AVISO_FIXO);
  });

  it("NÃO aparece nas telas sem número: ali vale só a instrução daquela tela", () => {
    const motivos: MotivoSemContaDoMedidor[] = [
      "ano_nao_conferido",
      "receita_invalida",
      "abertura_invalida",
      "abertura_depois_do_ano",
    ];
    for (const cobertura of [COMPLETA, PARCIAL_SEM_DATA]) {
      for (const motivo of motivos) {
        const h = montar({ estado: "sem_conta", motivo }, 12_345, {
          cobertura,
        });
        expect(aviso(h), `${motivo}`).toBeNull();
        expect(textoDe(h)).not.toContain("Instagram");
        recomecar();
      }
    }
    // o caso real do ano não conferido, pelo núcleo
    const real = montar(medirReal(50_000, 2027), 50_000, { ano: 2027 });
    expect(aviso(real)).toBeNull();
    expect(textoDe(real)).toContain("ainda não foram conferidos");
  });
});

describe("MedidorMei — cobertura parcial: o número sem veredito", () => {
  // O veredito de quem está dentro do limite: título da faixa e o efeito do núcleo.
  const semVeredito = (h: HTMLElement) => {
    const t = textoDe(h).toLowerCase();
    expect(t).not.toContain("dentro do limite");
    expect(t).not.toContain("nada muda");
    expect(t).not.toContain("enquadramento como mei");
    expect(h.querySelector("[data-faixa-titulo]")).toBeNull();
    expect(h.querySelector("[data-faixa-icone]")).toBeNull();
  };

  it("R$ 15 mil pelo app: mostra o valor rotulado, sem % e sem barra, e diz que não dá para concluir", () => {
    const h = montar(medirReal(15_000), 15_000, {
      cobertura: PARCIAL_COMECOU_DEPOIS,
    });
    const texto = textoDe(h);
    expect(texto).toContain(TEXTOS_DO_MEDIDOR_DO_MEI.rotuloDoNumeroParcial);
    expect(texto).toContain("Vendas registradas no IKCOUS neste ano");
    expect(texto).toContain("R$ 15.000,00");
    expect(texto).toContain("Limite: R$ 81.000,00");
    expect(texto).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.comecou_depois_do_inicio(
        "2026-03-01",
      ),
    );
    // o percentual daria a impressão de "já usei 18% do limite": não existe aqui
    expect(texto).not.toMatch(/\d+%/);
    expect(h.querySelector("[data-barra-enchimento]")).toBeNull();
    semVeredito(h);
  });

  it("sem a data de início: o texto pede o mês no cadastro fiscal e também não conclui", () => {
    const h = montar(medirReal(15_000), 15_000, {
      cobertura: PARCIAL_SEM_DATA,
    });
    expect(textoDe(h)).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.sem_data_de_inicio,
    );
    expect(textoDe(h)).toContain("cadastro fiscal");
    expect(textoDe(h)).toContain("R$ 15.000,00");
    semVeredito(h);
  });

  it("os dois motivos têm texto próprio, e nenhum é vazio", () => {
    const a = TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.sem_data_de_inicio;
    const b =
      TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.comecou_depois_do_inicio(
        "2026-03-01",
      );
    expect(a).not.toBe(b);
    expect(a.trim().length).toBeGreaterThan(20);
    expect(b.trim().length).toBeGreaterThan(20);
  });

  it("o texto de quem começou depois de janeiro diz o mês por extenso, e o cartão não tem subtítulo", () => {
    const h = montar(medirReal(15_000), 15_000, {
      cobertura: PARCIAL_COMECOU_DEPOIS,
    });
    expect(textoDe(h)).toContain(
      "O IKCOUS só tem as suas vendas a partir de março.",
    );
    expect(textoDe(h)).toContain(
      "some a este número o que você vendeu antes disso neste ano",
    );
    // o subtítulo "Só as vendas feitas pelo IKCOUS contam..." foi removido
    expect(h.querySelector("h2")?.parentElement?.querySelector("p")).toBeNull();
    expect(textoDe(h)).not.toContain("contam neste número");
    // e outro mês muda a frase
    recomecar();
    const outro = montar(medirReal(15_000), 15_000, {
      cobertura: {
        tipo: "parcial",
        motivo: "comecou_depois_do_inicio",
        desde: "2026-11-01",
      },
    });
    expect(textoDe(outro)).toContain("a partir de novembro.");
  });

  it("sem a data de início: a instrução exata, sem 'a partir de'", () => {
    const h = montar(medirReal(15_000), 15_000, {
      cobertura: PARCIAL_SEM_DATA,
    });
    expect(textoDe(h)).toContain(
      "Falta informar, no cadastro fiscal, o mês em que você começou a vender pelo IKCOUS. Sem isso, não dá para mostrar quanto do limite você já usou.",
    );
    expect(textoDe(h)).not.toContain("a partir de");
  });

  it("o alerta de acima do limite tem o texto decidido, sem telefone", () => {
    const h = montar(medirReal(100_000), 100_000, {
      cobertura: PARCIAL_COMECOU_DEPOIS,
    });
    const alerta = h.querySelector<HTMLElement>('[role="alert"]');
    expect(alerta?.textContent).toContain(
      "Suas vendas no IKCOUS, sozinhas, já passam do limite",
    );
    expect(alerta?.textContent).toContain(
      "O limite conta todas as vendas do ano, registradas aqui ou não. Então o seu total é este número ou mais. Fale logo com um contador ou com o Sebrae, que atende MEI de graça: quem passa do limite tem prazo para avisar a Receita.",
    );
    expect(alerta?.textContent).not.toMatch(/\d{4}[ -]?\d{4}|\(\d{2}\)|0800/);
  });

  it("controle: a MESMA receita com cobertura completa mostra o veredito e o percentual", () => {
    const h = montar(medirReal(15_000), 15_000);
    expect(tituloDaFaixa(h).textContent).toBe(DENTRO);
    expect(textoDe(h)).toContain("18%");
    expect(textoDe(h)).toContain("Vendas do ano: R$ 15.000,00");
    expect(textoDe(h)).not.toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.rotuloDoNumeroParcial,
    );
  });

  it("passou do teto só com as vendas do app: o alerta de acima do limite aparece, sem a faixa nem o efeito do núcleo", () => {
    // R$ 100 mil só pelo app: já passa do teto (e o total real é igual ou maior).
    const medidor = medirReal(100_000);
    const h = montar(medidor, 100_000, { cobertura: PARCIAL_COMECOU_DEPOIS });
    const alerta = h.querySelector<HTMLElement>('[role="alert"]');
    expect(alerta).not.toBeNull();
    expect(alerta?.textContent).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.acimaDoLimiteComCoberturaParcial.titulo,
    );
    expect(alerta?.textContent).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.acimaDoLimiteComCoberturaParcial.texto,
    );
    expect(textoDe(h)).toContain("R$ 100.000,00");
    // "em mais de 20%" seria uma conta sobre um número que pode estar abaixo do real
    expect(textoDe(h)).not.toContain("passou do limite em");
    if (medidor.estado === "com_conta") {
      expect(textoDe(h)).not.toContain(medidor.efeito);
    }
    expect(aviso(h)?.textContent).toBe(AVISO_FIXO);
    // e não diz "dentro do limite" nem a explicação de quem está abaixo
    expect(textoDe(h).toLowerCase()).not.toContain("dentro do limite");
    expect(textoDe(h)).not.toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.comecou_depois_do_inicio(
        "2026-03-01",
      ),
    );
  });

  it("a borda do teto: exatamente R$ 81.000 ainda não é alerta; um centavo a mais é", () => {
    const noTeto = montar(medirReal(81_000), 81_000, {
      cobertura: PARCIAL_SEM_DATA,
    });
    expect(noTeto.querySelector('[role="alert"]')).toBeNull();
    semVeredito(noTeto);
    recomecar();
    const passou = montar(medirReal(81_000.01), 81_000.01, {
      cobertura: PARCIAL_SEM_DATA,
    });
    expect(passou.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("controle: com cobertura completa, passar do teto continua sendo a faixa de sempre (não o texto do parcial)", () => {
    const h = montar(medirReal(100_000), 100_000);
    expect(tituloDaFaixa(h).textContent).toBe(ACIMA_20);
    expect(textoDe(h)).not.toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.acimaDoLimiteComCoberturaParcial.titulo,
    );
  });

  it("ano de abertura: o limite proporcional continua explicado no parcial", () => {
    const medidor = medirLimiteDoMei({
      receitaAcumulada: 10_000,
      ano: ANO,
      cadastro: { abertaEm: "2026-10-15" },
    });
    const h = montar(medidor, 10_000, { cobertura: PARCIAL_COMECOU_DEPOIS });
    expect(textoDe(h)).toContain("3 meses");
    expect(textoDe(h)).toContain("Limite: R$ 20.250,00");
  });

  it("com Ocultar valores: o dinheiro some, o aviso fixo e o alerta de acima do limite ficam", () => {
    const pouco = montar(medirReal(2_000), 2_000, {
      ocultos: true,
      cobertura: PARCIAL_SEM_DATA,
    });
    const htmlPouco = pouco.innerHTML;
    expect(textoDe(pouco)).toContain("Valor oculto");
    expect(textoDe(pouco)).not.toContain("2.000");
    expect(aviso(pouco)?.textContent).toBe(AVISO_FIXO);
    recomecar();
    // outra receita da mesma situação: a tela escondida é idêntica
    const mais = montar(medirReal(70_000), 70_000, {
      ocultos: true,
      cobertura: PARCIAL_SEM_DATA,
    });
    expect(mais.innerHTML).toBe(htmlPouco);
    recomecar();
    const acima = montar(medirReal(100_000), 100_000, {
      ocultos: true,
      cobertura: PARCIAL_SEM_DATA,
    });
    expect(acima.querySelector('[role="alert"]')).not.toBeNull();
    expect(textoDe(acima)).not.toContain("100.000");
  });
});
