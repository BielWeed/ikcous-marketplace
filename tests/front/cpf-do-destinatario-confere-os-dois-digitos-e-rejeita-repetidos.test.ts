// O que este teste protege: a conferência de CPF do destinatário (a tela da
// etiqueta de envio) só aceita o número quando OS DOIS dígitos verificadores
// batem e quando não é uma sequência de dígito repetido. Os testes vizinhos
// só cobrem a máscara; sem estes casos, trocar o `&&` dos dois dígitos por
// `||`, conferir só um deles ou tirar a recusa de "111.111.111-11" deixava
// CPF falso passar para o Melhor Envio sem nenhum teste cair.
// Também fixa o contrato de `somenteDigitos`: número vale, o resto vira "".
import { cpfValido, somenteDigitos } from "@/lib/cpf-do-destinatario";
import { describe, expect, it } from "vitest";

// 529.982.247-25 é válido: d1 = 2 e d2 = 5.
describe("cpfValido do destinatário — os dois dígitos verificadores", () => {
  it("aceita o CPF com os dois dígitos certos, com ou sem máscara", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("529.982.247-25")).toBe(true);
  });

  it("recusa quando só o primeiro dígito verificador está errado", () => {
    // d1 = 3 (errado), d2 = 5 (o certo para a base correta).
    expect(cpfValido("529.982.247-35")).toBe(false);
  });

  it("recusa quando só o segundo dígito verificador está errado", () => {
    // d1 = 2 (certo), d2 = 6 (errado).
    expect(cpfValido("529.982.247-26")).toBe(false);
  });

  it("recusa quando os dois dígitos verificadores estão errados", () => {
    expect(cpfValido("529.982.247-00")).toBe(false);
  });
});

describe("cpfValido do destinatário — sequência de dígito repetido", () => {
  it.each([
    "000.000.000-00",
    "111.111.111-11",
    "222.222.222-22",
    "99999999999",
  ])("recusa %s, mesmo que a conta dos verificadores feche", (cpf) => {
    expect(cpfValido(cpf)).toBe(false);
  });
});

describe("cpfValido do destinatário — tamanho e tipo da entrada", () => {
  it.each(["", "5299822472", "529982247250", "abc"])(
    "recusa %j (não tem exatamente 11 dígitos)",
    (entrada) => {
      expect(cpfValido(entrada)).toBe(false);
    },
  );

  it("aceita o CPF recebido como número (sem zero à esquerda)", () => {
    expect(cpfValido(52998224725)).toBe(true);
  });

  it.each([null, undefined, {}, true, ["52998224725"]])(
    "recusa entrada que não é texto nem número: %j",
    (entrada) => {
      expect(cpfValido(entrada)).toBe(false);
    },
  );
});

describe("somenteDigitos do destinatário", () => {
  it("tira a pontuação do texto", () => {
    expect(somenteDigitos("529.982.247-25")).toBe("52998224725");
  });

  it("converte número em dígitos", () => {
    expect(somenteDigitos(52998224725)).toBe("52998224725");
  });

  it.each([null, undefined, {}, true, ["529"]])(
    "devolve vazio para %j em vez de inventar dígitos",
    (entrada) => {
      expect(somenteDigitos(entrada)).toBe("");
    },
  );
});
