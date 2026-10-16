// "Até onde você entrega?" — o lojista que atende de propósito só o próprio
// bairro precisa poder dizer "é isso mesmo" sem redigitar nada (16/10/2026).
//
// A saída escolhida grava os 5 primeiros números do CEP da loja no "alcance" —
// e isso só é honesto se der EXATAMENTE a mesma regra do alcance VAZIO, nas
// três cópias da regra (banco `is_local_cep`, edge `calculate-shipping` e
// `cepEhLocal` na tela). Esta prova cobre a cópia da tela e, por espelho, as
// outras duas (o contrato é guardado por `cep-local-espelha-o-banco`; o banco
// foi conferido por execução, ver o relatório do PR).
//
// Também prova a outra metade: "Incluir a região deste CEP" nunca TIRA ninguém
// da entrega (nem a região da própria loja, quando o alcance estava vazio) e
// nunca muda o SENTIDO do que o lojista já tinha escrito (dois CEPs completos
// separados por vírgula são uma faixa — acrescentar um terceiro item viraria
// três CEPs exatos).
import { describe, expect, it } from "vitest";

import { cepEhLocal } from "@/lib/cep-local";
import {
  alcanceEhSoPertoDaLoja,
  incluirRegiaoNoAlcance,
  prefixoDoCepDaLoja,
  resumoDoAlcance,
} from "@/lib/loja-pronta";

const CEP_DA_LOJA = "38400-100";
const PREFIXO = "38400";

// Bateria: mesma região, região vizinha, com e sem hífen, CEP geral (000),
// incompleto, inválido, vazio e com lixo.
const DESTINOS = [
  "38400-100",
  "38400100",
  "38400-000",
  "38400-999",
  "38400999",
  "38401-000",
  "38399-999",
  "38500-000",
  "38500000",
  "38409-999",
  "38410-000",
  "01310-100",
  "00000-000",
  "38400",
  "384",
  "3",
  "",
  "abc",
  "38.400-100",
  " 38400-100 ",
  "384001000",
  "38400-1",
];

describe("gravar os 5 primeiros números da loja = deixar o alcance vazio", () => {
  it("o prefixo vem do CEP completo da loja, com ou sem hífen", () => {
    expect(prefixoDoCepDaLoja("38400-100")).toBe(PREFIXO);
    expect(prefixoDoCepDaLoja("38400100")).toBe(PREFIXO);
    expect(prefixoDoCepDaLoja("38400")).toBeNull();
  });

  it("para toda a bateria de CEPs, prefixo gravado e alcance vazio respondem igual", () => {
    for (const origem of [CEP_DA_LOJA, "38400100", "38500-000", "01310-100"]) {
      const prefixo = prefixoDoCepDaLoja(origem) as string;
      for (const destino of DESTINOS) {
        expect(
          cepEhLocal(origem, destino, prefixo),
          `origem ${origem} destino ${JSON.stringify(destino)}`,
        ).toBe(cepEhLocal(origem, destino, ""));
      }
    }
  });

  it("e a bateria não é trivial: tem CEP que entra e CEP que fica de fora", () => {
    const respostas = DESTINOS.map((d) => cepEhLocal(CEP_DA_LOJA, d, PREFIXO));
    expect(respostas).toContain(true);
    expect(respostas).toContain(false);
    expect(cepEhLocal(CEP_DA_LOJA, "38400-999", PREFIXO)).toBe(true);
    expect(cepEhLocal(CEP_DA_LOJA, "38401-000", PREFIXO)).toBe(false);
    // O CEP geral da cidade (000) também: 5 números iguais entram, outros não.
    expect(cepEhLocal("38500-000", "38500-777", "38500")).toBe(true);
    expect(cepEhLocal("38500-000", "38501-000", "38500")).toBe(false);
  });

  it("um prefixo de 4 dígitos NÃO é equivalente (o mutante que a prova pega)", () => {
    // 38410-000 fica fora do alcance vazio e entra com "3841"... e o contrário:
    // "3840" deixa entrar 38409-999, que o alcance vazio recusa.
    expect(cepEhLocal(CEP_DA_LOJA, "38409-999", "3840")).toBe(true);
    expect(cepEhLocal(CEP_DA_LOJA, "38409-999", "")).toBe(false);
  });
});

describe("alcanceEhSoPertoDaLoja", () => {
  it("é só perto quando o alcance é exatamente os 5 números da loja", () => {
    expect(alcanceEhSoPertoDaLoja(CEP_DA_LOJA, "38400")).toBe(true);
    expect(alcanceEhSoPertoDaLoja(CEP_DA_LOJA, "  38400  ")).toBe(true);
  });

  it("vazio, outro prefixo, lista e faixa não são 'só perto'", () => {
    for (const faixa of [
      "",
      "   ",
      "38500",
      "38400, 38500",
      "38400-000, 38415-999",
      "3840",
    ]) {
      expect(
        alcanceEhSoPertoDaLoja(CEP_DA_LOJA, faixa),
        JSON.stringify(faixa),
      ).toBe(false);
    }
  });

  it("sem CEP completo da loja nunca é 'só perto'", () => {
    expect(alcanceEhSoPertoDaLoja("", "38400")).toBe(false);
    expect(alcanceEhSoPertoDaLoja(null, "38400")).toBe(false);
  });
});

describe("incluirRegiaoNoAlcance", () => {
  it("alcance vazio: a região da loja continua dentro (vazio já era ela)", () => {
    const novo = incluirRegiaoNoAlcance("", CEP_DA_LOJA, "38500-123");
    expect(novo).toBe("38400, 38500");
    expect(cepEhLocal(CEP_DA_LOJA, "38400-100", novo)).toBe(true);
    expect(cepEhLocal(CEP_DA_LOJA, "38500-999", novo)).toBe(true);
    expect(cepEhLocal(CEP_DA_LOJA, "38600-000", novo)).toBe(false);
  });

  it("acrescenta os 5 primeiros números do CEP do cliente, com ou sem hífen", () => {
    expect(incluirRegiaoNoAlcance("38400", CEP_DA_LOJA, "38500-123")).toBe(
      "38400, 38500",
    );
    expect(incluirRegiaoNoAlcance("38400", CEP_DA_LOJA, "38500123")).toBe(
      "38400, 38500",
    );
  });

  it("não duplica: incluir duas vezes a mesma região não muda o texto", () => {
    const uma = incluirRegiaoNoAlcance("38400", CEP_DA_LOJA, "38500-123");
    const duas = incluirRegiaoNoAlcance(uma, CEP_DA_LOJA, "38500-999");
    expect(duas).toBe(uma);
    expect(incluirRegiaoNoAlcance("38400", CEP_DA_LOJA, "38400-777")).toBe(
      "38400",
    );
  });

  it("CEP do cliente incompleto ou sem loja: devolve o texto como estava", () => {
    expect(incluirRegiaoNoAlcance("38400", CEP_DA_LOJA, "3850")).toBe("38400");
    expect(incluirRegiaoNoAlcance("38400", CEP_DA_LOJA, "")).toBe("38400");
    expect(incluirRegiaoNoAlcance("", "", "38500-123")).toBe("");
  });

  // O BURACO que esta função fecha: dois CEPs completos separados por vírgula
  // são a FAIXA entre eles. Um terceiro item faria o servidor ler "três CEPs
  // exatos" e a faixa inteira deixaria de entregar.
  it("dois CEPs completos (uma faixa) continuam sendo a MESMA faixa depois de incluir", () => {
    const antes = "38400-000, 38409-999";
    const depois = incluirRegiaoNoAlcance(antes, CEP_DA_LOJA, "38500-123");
    for (const destino of ["38400-000", "38404-500", "38409-999", "38405000"]) {
      expect(cepEhLocal(CEP_DA_LOJA, destino, antes), destino).toBe(true);
      expect(cepEhLocal(CEP_DA_LOJA, destino, depois), destino).toBe(true);
    }
    expect(cepEhLocal(CEP_DA_LOJA, "38500-777", depois)).toBe(true);
    expect(cepEhLocal(CEP_DA_LOJA, "38410-000", depois)).toBe(false);
    // O mutante ingênuo (só colar no fim) quebra a faixa:
    const ingenuo = `${antes}, 38500`;
    expect(cepEhLocal(CEP_DA_LOJA, "38404-500", ingenuo)).toBe(false);
  });

  it("faixa em bloco longo e CEP único exato também são preservados", () => {
    for (const antes of [
      "38400000-38409999",
      "38400-100",
      "38400-100, 38400-200, 38400-300",
      "38400000-38409999, 38450",
    ]) {
      const depois = incluirRegiaoNoAlcance(antes, CEP_DA_LOJA, "38500-123");
      for (const destino of DESTINOS) {
        if (cepEhLocal(CEP_DA_LOJA, destino, antes)) {
          expect(
            cepEhLocal(CEP_DA_LOJA, destino, depois),
            `${antes} -> ${depois} :: ${destino}`,
          ).toBe(true);
        }
      }
      expect(cepEhLocal(CEP_DA_LOJA, "38500-777", depois)).toBe(true);
    }
  });

  it("nunca tira ninguém: tudo que entrava antes continua entrando (varredura)", () => {
    const antes = [
      "",
      "38400",
      "38400, 38450",
      "38400-000, 38409-999",
      "38400000-38409999",
      "38400-100",
      "texto sem numero",
    ];
    for (const faixa of antes) {
      const depois = incluirRegiaoNoAlcance(faixa, CEP_DA_LOJA, "38500-123");
      for (const destino of DESTINOS) {
        if (cepEhLocal(CEP_DA_LOJA, destino, faixa)) {
          expect(
            cepEhLocal(CEP_DA_LOJA, destino, depois),
            `${JSON.stringify(faixa)} -> ${depois} :: ${destino}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("resumoDoAlcance (o que a faixa-resumo promete)", () => {
  it("alcance vazio: os CEPs que começam com os 5 números da loja", () => {
    expect(resumoDoAlcance(CEP_DA_LOJA, "")).toBe("CEPs que começam com 38400");
    expect(resumoDoAlcance(CEP_DA_LOJA, undefined)).toBe(
      "CEPs que começam com 38400",
    );
  });

  it("um prefixo só: os CEPs que começam com ele", () => {
    expect(resumoDoAlcance(CEP_DA_LOJA, "38500")).toBe(
      "CEPs que começam com 38500",
    );
  });

  it("lista, faixa ou CEP exato: 'CEPs que você escolheu'", () => {
    for (const faixa of [
      "38400, 38500",
      "38400-000, 38409-999",
      "38400000-38409999",
      "38400-100",
    ]) {
      expect(resumoDoAlcance(CEP_DA_LOJA, faixa), faixa).toBe(
        "CEPs que você escolheu",
      );
    }
  });

  it("sem CEP completo e sem alcance: não inventa região", () => {
    expect(resumoDoAlcance("", "")).toBe("CEPs perto da loja");
    expect(resumoDoAlcance("384", "")).toBe("CEPs perto da loja");
  });
});
