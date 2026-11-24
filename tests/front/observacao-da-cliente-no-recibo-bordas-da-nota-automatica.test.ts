// A observação que sai no papel (OBSERVAÇÃO:) é o texto da cliente SEM as linhas
// que o checkout acrescenta sozinho. Bordas da retirada que o teste do papel
// não prendia (o teste dele passa o pedido inteiro; aqui é a função):
//   - a nota automática é um BLOCO PRÓPRIO (linha em branco antes). Frase igual
//     da cliente, colada na linha de cima com um Enter só, é dela e fica;
//   - espaço ou quebra de linha SOBRANDO depois da nota automática não a
//     esconde do filtro (a nota some mesmo assim);
//   - endereço de retirada com espaço nas pontas casa com a nota gravada;
//   - linha só com espaços entre parágrafos conta como linha em branco.
import { observacaoDaClienteNoRecibo } from "@/lib/observacao-da-cliente-no-recibo";
import { NOTA_AUTOMATICA_DA_RETIRADA } from "@/lib/texto-da-retirada";
import { describe, expect, it } from "vitest";

const ENDERECO = "Rua X, 10";

describe("observacaoDaClienteNoRecibo — nota automática da retirada", () => {
  it.each([
    ["nota com o endereço", `Retirada na loja: ${ENDERECO}`],
    ["nota com o aviso padrão", NOTA_AUTOMATICA_DA_RETIRADA],
    ["rótulo sozinho", "Retirada na loja"],
  ])(
    "tira a nota automática (%s) mesmo com quebra de linha e espaço sobrando no fim",
    (_nome, nota) => {
      for (const sobra of ["", "\n", "\n\n", "  ", " \r\n"]) {
        expect(
          observacaoDaClienteNoRecibo(
            `Deixar na portaria\n\n${nota}${sobra}`,
            ENDERECO,
          ),
        ).toBe("Deixar na portaria");
      }
    },
  );

  it("endereço de retirada com espaço nas pontas ainda casa com a nota gravada", () => {
    expect(
      observacaoDaClienteNoRecibo(
        `Deixar na portaria\n\nRetirada na loja: ${ENDERECO}`,
        `  ${ENDERECO}  `,
      ),
    ).toBe("Deixar na portaria");
  });

  it("frase da cliente igual à nota, colada com UM Enter só, é dela e fica", () => {
    expect(
      observacaoDaClienteNoRecibo(
        `Chego às 17h\nRetirada na loja: ${ENDERECO}`,
        ENDERECO,
      ),
    ).toBe(`Chego às 17h\nRetirada na loja: ${ENDERECO}`);
  });

  it("linha só com espaços entre parágrafos vira UMA linha em branco", () => {
    expect(observacaoDaClienteNoRecibo("A\n   \nB")).toBe("A\n\nB");
    expect(observacaoDaClienteNoRecibo("A\n \n\t\n   \nB")).toBe("A\n\nB");
  });

  it("sem observação nenhuma devolve vazio (nunca 'undefined')", () => {
    expect(observacaoDaClienteNoRecibo(undefined, ENDERECO)).toBe("");
    expect(observacaoDaClienteNoRecibo("   \n  ", ENDERECO)).toBe("");
  });
});
