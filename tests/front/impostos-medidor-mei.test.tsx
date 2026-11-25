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
//    e o aviso da faixa continua visível (quem passou do limite precisa saber).
// Dados inventados; nenhuma loja específica.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MedidorMei } from "@/components/admin/financeiro/impostos/MedidorMei";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import {
  type MedidorDoMei,
  type MotivoSemContaDoMedidor,
  medirLimiteDoMei,
} from "@/lib/fiscal/medidor-mei";
import { classeDoTexto } from "@/lib/tons-de-estado";

const ANO = 2026;

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
  opcoes: { readonly ocultos?: boolean; readonly ano?: number } = {},
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
    expect(titulo.textContent).toBe("Dentro do limite");
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
    expect(titulo.textContent).toBe("Passou do limite em até 20%");
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
    expect(titulo.textContent).toBe("Passou do limite em mais de 20%");
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
      [81_000, "100%", "Dentro do limite"], // exatamente 100% ainda está dentro
      [80_999.99, "99%", "Dentro do limite"], // nunca arredonda para 100% dentro
      [81_000.01, "101%", "Passou do limite em até 20%"], // 1 centavo a mais já passou
      [97_200, "120%", "Passou do limite em até 20%"], // exatamente 120% ainda é "até 20%"
      [97_200.01, "121%", "Passou do limite em mais de 20%"],
      // Percentual inteiro EXATO que a divisão em ponto flutuante erra por um resíduo
      // (23.490/81.000 = 28,999999999999996; 89.100/81.000 = 110,00000000000001).
      [23_490, "29%", "Dentro do limite"],
      [89_100, "110%", "Passou do limite em até 20%"],
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
    expect(tituloDaFaixa(h).textContent).toBe("Dentro do limite");
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
    expect(tituloDaFaixa(h).textContent).toBe(
      "Passou do limite em mais de 20%",
    );
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
