// Protege a máscara do CPF do cadastro/checkout (`formatarCpf`, src/lib/cpf.ts)
// em CADA comprimento de 0 a 11 dígitos, digitando tecla a tecla. Os testes
// vizinhos só olham 3, 6, 9 e 11 dígitos: trocar `> 3` por `> 4` fazia o 4º
// dígito sumir da tela ("1234" virava "123"), e trocar `> 9` por `> 10` fazia
// o 10º sumir ("1234567890" virava "123.456.789") sem nenhum teste cair.
import { formatarCpf, somenteDigitosDoCpf } from "@/lib/cpf";
import { describe, expect, it } from "vitest";

const CPF_DIGITADO = "52998224725";

const ESPERADO_POR_TECLA = [
  "",
  "5",
  "52",
  "529",
  "529.9",
  "529.98",
  "529.982",
  "529.982.2",
  "529.982.24",
  "529.982.247",
  "529.982.247-2",
  "529.982.247-25",
];

describe("formatarCpf: cada tecla digitada mostra todos os dígitos", () => {
  it.each(ESPERADO_POR_TECLA.map((formatado, qtd) => ({ qtd, formatado })))(
    'com $qtd dígito(s) mostra "$formatado" e guarda os dígitos crus',
    ({ qtd, formatado }) => {
      const digitado = CPF_DIGITADO.slice(0, qtd);
      expect(formatarCpf(digitado)).toEqual({ limpo: digitado, formatado });
    },
  );

  it("nenhuma tecla perde dígito: a máscara sem pontuação é sempre o que foi digitado", () => {
    for (let qtd = 0; qtd <= CPF_DIGITADO.length; qtd++) {
      const digitado = CPF_DIGITADO.slice(0, qtd);
      expect(somenteDigitosDoCpf(formatarCpf(digitado).formatado)).toBe(
        digitado,
      );
    }
  });

  it("reformatar o que já está mascarado não muda nada (editar no meio do campo)", () => {
    for (let qtd = 0; qtd <= CPF_DIGITADO.length; qtd++) {
      const uma = formatarCpf(CPF_DIGITADO.slice(0, qtd)).formatado;
      expect(formatarCpf(uma).formatado).toBe(uma);
    }
  });
});

describe("formatarCpf e somenteDigitosDoCpf com o campo vazio", () => {
  it("texto sem dígito nenhum vira campo vazio, sem pontuação solta", () => {
    expect(formatarCpf("")).toEqual({ limpo: "", formatado: "" });
    expect(formatarCpf(" .-/ abc")).toEqual({ limpo: "", formatado: "" });
  });

  it("valor ausente (null/undefined vindo de dado antigo) vira vazio, não quebra a tela", () => {
    expect(somenteDigitosDoCpf(null as unknown as string)).toBe("");
    expect(somenteDigitosDoCpf(undefined as unknown as string)).toBe("");
    expect(formatarCpf(undefined as unknown as string)).toEqual({
      limpo: "",
      formatado: "",
    });
  });

  it("espaços e quebras de linha colados junto do CPF são descartados", () => {
    expect(formatarCpf("  529 982\t247\n25 ").formatado).toBe("529.982.247-25");
  });
});
