// Caça por mutação em `src/config/cor-da-loja.ts` (25/11/2026), complemento dos
// três arquivos `cor-da-loja-*` e de `marca-legivel-sobre-branco`. Os valores
// abaixo são ESCRITOS À MÃO (hexadecimais e tokens), conferidos fora do código
// de produção com uma conta independente (fórmula padrão do WCAG), nunca
// calculados aqui com a função que está sendo testada.
//
// O que passava sem ninguém reclamar:
//   1. a validação do campo recusar um dígito hexadecimal válido (`[0-8a-f]`
//      deixava o 9 de fora: "#999999" e "#ff9900" voltavam "formato");
//   2. a "faixa do meio" do texto sobre a cor (onde nem o texto claro nem o
//      escuro chegam a 4,5:1) ter só o lado do preto provado — o lado do branco
//      podia sair trocado e a lojista de uma cor azul-média ficava com texto
//      preto onde o branco lê melhor — e a referência de branco ser #fefefe;
//   3. a cor que JÁ lê bem sobre branco ser reconstruída (e mudar uns pontos)
//      porque a checagem usava o branco do tema (#fafafa) em vez do #ffffff;
//   4. o escurecimento parar um passo cedo ou tarde: só se provava "passa de
//      4,7:1 e mantém o matiz", nunca QUAL cor sai.
import {
  corDaMarcaSobreBranco,
  corPrimariaEfetiva,
  defaultStoreConfig,
  razaoDeContraste,
  textoSobreACorDaLoja,
  validaCorDaLoja,
} from "@/config/cor-da-loja";
import { describe, expect, it } from "vitest";

const DIGITOS = "0123456789abcdef";

// Mais três buracos achados na mesma varredura:
//   5. cor com dígitos DEMAIS ("#ffffff80", 8 dígitos; "#1234567", 7) ou de
//      MENOS ("#12345") era lida como se fosse uma cor boa (a regex perdia o
//      `^`, o `$` ou aceitava "5 ou mais") — o certo é tratar como inválida
//      (preta na conta de contraste, devolvida sem mexer na cor escurecida);
//   6. a escada de luminância (`c / 12,92` na ponta escura) mudar de ponto:
//      #050505, #0b0b0b e #0c0c0c ficavam com contraste diferente sem que
//      nenhuma checagem de 4,5:1 ou 4,7:1 chegasse perto;
//   7. o texto escuro do tema (#18181b) ser trocado por um cinza mais claro,
//      que só aparece em cinzas médios (#888888) — os testes só olhavam cores
//      muito claras ou muito escuras;
//   8. a leitura da cor do banco (`corPrimariaEfetiva`) devolver a cor
//      reescrita em minúsculas em vez de exatamente como está gravada.

describe("validaCorDaLoja — todos os 16 dígitos hexadecimais, em todas as posições", () => {
  it("cada dígito é aceito na posição 1, 2, 3, 4, 5 e 6 (e volta em minúsculas)", () => {
    const base = "a1b2c3";
    for (let posicao = 0; posicao < 6; posicao++) {
      for (const digito of DIGITOS) {
        const cor = `#${base.slice(0, posicao)}${digito}${base.slice(posicao + 1)}`;
        expect(validaCorDaLoja(cor), cor).toEqual({ ok: true, cor });
      }
    }
  });

  it("o nove, que ficava de fora, passa: #999999 e #ff9900", () => {
    expect(validaCorDaLoja("#999999")).toEqual({ ok: true, cor: "#999999" });
    expect(validaCorDaLoja("#ff9900")).toEqual({ ok: true, cor: "#ff9900" });
  });

  it("os vizinhos dos intervalos NÃO são dígitos: / : ` g e G recusam por formato", () => {
    // "/" vem antes do 0, ":" depois do 9, "`" antes do a, "g" depois do f.
    for (const ruim of ["/", ":", "`", "g", "G"]) {
      for (const posicao of [0, 5]) {
        const cor = `#${"12abcd".slice(0, posicao)}${ruim}${"12abcd".slice(posicao + 1)}`;
        expect(validaCorDaLoja(cor), cor).toEqual({
          ok: false,
          motivo: "formato",
        });
      }
    }
  });
});

describe("textoSobreACorDaLoja — a faixa do meio escolhe o texto de maior contraste", () => {
  // Cinzas vizinhos que ficam um de cada lado do empate branco/preto:
  // #757575 lê um pouco melhor com texto BRANCO (4,61:1 contra 4,56:1 do preto)
  // e #767676 um pouco melhor com texto PRETO (4,62:1 contra 4,54:1 do branco).
  // Nenhum dos dois chega a 4,5:1 com o texto claro (#fafafa) nem com o escuro
  // (#18181b) do tema, por isso o tema não serve e entra o preto ou o branco.
  it("#757575 leva branco puro; #767676 leva preto puro", () => {
    expect(textoSobreACorDaLoja("#757575")).toBe("0 0% 100%");
    expect(textoSobreACorDaLoja("#767676")).toBe("0 0% 0%");
  });

  it("azuis e verdes de luminosidade na beira do empate também levam branco puro", () => {
    // Luminância relativa 0,1784 e 0,1784: abaixo do ponto de empate (0,1791),
    // então o branco (4,60:1) vence o preto (4,57:1) por pouco.
    expect(textoSobreACorDaLoja("#006ff3")).toBe("0 0% 100%");
    expect(textoSobreACorDaLoja("#00874b")).toBe("0 0% 100%");
  });
});

describe("cor com a quantidade errada de dígitos é inválida (preta na conta, intacta no escurecimento)", () => {
  it.each([
    ["8 dígitos (com alfa)", "#ffffff80"],
    ["7 dígitos", "#1234567"],
    ["5 dígitos", "#12345"],
    ["8 dígitos com lixo na frente", "#zz123456"],
  ])("%s (%s): luminância zero, como o preto", (_nome, ruim) => {
    // Preto contra branco = (1 + 0,05) / (0 + 0,05) = 21.
    expect(razaoDeContraste(ruim, "#ffffff")).toBeCloseTo(21, 5);
    // O texto sobre uma cor preta é o claro do tema.
    expect(textoSobreACorDaLoja(ruim)).toBe("0 0% 98%");
    // O escurecimento devolve o que recebeu, sem inventar uma cor.
    expect(corDaMarcaSobreBranco(ruim)).toBe(ruim);
  });

  it("o texto que não é cor volta exatamente como veio, com os espaços", () => {
    expect(corDaMarcaSobreBranco("  não é cor ")).toBe("  não é cor ");
  });
});

describe("razaoDeContraste — a ponta escura da escala (valores conferidos fora do código)", () => {
  // Contra o preto: (L + 0,05) / 0,05, com L pela fórmula do WCAG.
  it.each([
    ["#050505", 1.03035],
    ["#060606", 1.03642],
    ["#080808", 1.04856],
    ["#0b0b0b", 1.06693],
    ["#0c0c0c", 1.07353],
  ])("%s contra #000000 dá %f", (cor, esperado) => {
    expect(razaoDeContraste(cor, "#000000")).toBeCloseTo(esperado, 4);
  });
});

describe("textoSobreACorDaLoja — cinzas médios levam o texto ESCURO do tema", () => {
  it("#888888 e #8e8e8e: 5,0:1 e 5,4:1 com o escuro (#18181b), só 3,4:1 e 3,1:1 com o claro", () => {
    expect(textoSobreACorDaLoja("#888888")).toBe("240 5.9% 10%");
    expect(textoSobreACorDaLoja("#8e8e8e")).toBe("240 5.9% 10%");
  });
});

describe("corPrimariaEfetiva — devolve a cor exatamente como está no banco", () => {
  it("maiúsculas gravadas no banco não são reescritas na leitura", () => {
    expect(
      corPrimariaEfetiva({ ...defaultStoreConfig, primaryColor: "#FFD400" }),
    ).toBe("#FFD400");
  });
});

describe("corDaMarcaSobreBranco — cor que já lê bem fica idêntica; a que não lê sai exatamente esta", () => {
  it("azuis a 4,74:1 e 4,73:1 do branco (acima de 4,7) NÃO são tocados", () => {
    // Contra o #fafafa do tema estas duas ficariam abaixo de 4,7 e seriam
    // reconstruídas ("#0069fc" viraria "#0068fa"): a conta é contra #ffffff.
    expect(corDaMarcaSobreBranco("#0069fc")).toBe("#0069fc");
    expect(corDaMarcaSobreBranco("#006cf3")).toBe("#006cf3");
  });

  it("o cinza que passa por um passo de diferença (#747474 → #737373) para no primeiro que chega a 4,7:1", () => {
    expect(corDaMarcaSobreBranco("#747474")).toBe("#737373");
    expect(corDaMarcaSobreBranco("#757575")).toBe("#737373");
    expect(corDaMarcaSobreBranco("#767676")).toBe("#737373");
  });

  it.each([
    ["amarelo", "#ffd400", "#856e00"],
    ["rosa choque", "#ff69b4", "#e00070"],
    ["azul médio", "#3b82f6", "#156af4"],
    ["verde médio", "#22c55e", "#17823e"],
    ["laranja", "#f97316", "#bd5005"],
    ["ciano", "#06b6d4", "#047b90"],
  ])(
    "%s %s sai como %s (a primeira luz, de 1 em 1%, que chega a 4,7:1)",
    (_nome, cor, esperada) => {
      expect(corDaMarcaSobreBranco(cor)).toBe(esperada);
    },
  );
});
