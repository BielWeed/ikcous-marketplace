import { mascararCpf } from "@/lib/cpf-do-destinatario";
import { describe, expect, it } from "vitest";

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
