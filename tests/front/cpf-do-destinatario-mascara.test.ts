import {
  cpfValido,
  formatarCpfEnquantoDigita,
  mascararCpf,
  somenteDigitos,
} from "@/lib/cpf-do-destinatario";
import { describe, expect, it } from "vitest";

describe("formatarCpfEnquantoDigita do destinatário", () => {
  it.each([
    ["", ""],
    ["5", "5"],
    ["529", "529"],
    ["5299", "529.9"],
    ["529982", "529.982"],
    ["5299822", "529.982.2"],
    ["529982247", "529.982.247"],
    ["5299822472", "529.982.247-2"],
    ["52998224725", "529.982.247-25"],
  ])("digitação normal de %s continua com a máscara %s", (entrada, saida) => {
    expect(formatarCpfEnquantoDigita(entrada)).toBe(saida);
  });

  it.each(["529.982.247-25", " 529 982 247 25 ", "529.982.247-25\n"])(
    "colado com pontuação ou espaços (%j) vira o mesmo CPF válido",
    (colado) => {
      const campo = formatarCpfEnquantoDigita(colado);
      expect(campo).toBe("529.982.247-25");
      expect(cpfValido(somenteDigitos(campo))).toBe(true);
    },
  );

  it("colado com dígitos a mais NÃO vira outro CPF válido em silêncio", () => {
    // 12345678909 é válido; 12345678909000 era cortado para ele sem aviso.
    const campo = formatarCpfEnquantoDigita("12345678909000");
    expect(campo).toBe("123.456.789-09000");
    expect(somenteDigitos(campo)).toBe("12345678909000");
    expect(cpfValido(somenteDigitos(campo))).toBe(false);
  });

  it("um dígito a mais depois de um CPF completo reprova o campo", () => {
    const campo = formatarCpfEnquantoDigita("529.982.247-250");
    expect(somenteDigitos(campo)).toBe("529982247250");
    expect(cpfValido(somenteDigitos(campo))).toBe(false);
  });

  it("apagar o excesso devolve o CPF válido", () => {
    const campo = formatarCpfEnquantoDigita("12345678909000");
    const apagado = formatarCpfEnquantoDigita(campo.slice(0, -3));
    expect(apagado).toBe("123.456.789-09");
    expect(cpfValido(somenteDigitos(apagado))).toBe(true);
  });

  it("colagem gigante fica limitada a 14 dígitos e continua reprovando", () => {
    const campo = formatarCpfEnquantoDigita("1234567890912345678");
    expect(somenteDigitos(campo)).toHaveLength(14);
    expect(cpfValido(somenteDigitos(campo))).toBe(false);
  });
});

describe("mascararCpf do destinatário", () => {
  it.each(["52998224725", "529.982.247-25"])(
    "oculta os sete primeiros dígitos e exibe somente os quatro últimos de %s",
    (entrada) => {
      expect(mascararCpf(entrada)).toBe("***.***.*47-25");
    },
  );

  it.each(["5299822472", "529982247250", "", null])(
    "oculta tudo quando a entrada não tem onze dígitos: %s",
    (entrada) => {
      expect(mascararCpf(entrada)).toBe("***.***.***-**");
    },
  );

  it.each(["52998224725", "529.982.247-25"])(
    "não revela o prefixo privado do CPF recebido como %s",
    (entrada) => {
      const saida = mascararCpf(entrada);
      expect(saida).not.toContain("5299822");
      expect(saida).not.toContain("529.982.2");
    },
  );
});
