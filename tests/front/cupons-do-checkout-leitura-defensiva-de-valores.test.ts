// Fronteiras da leitura defensiva da RPC `cupons_do_checkout` que nenhum teste
// prendia (achadas por mutação, 24/11/2026): tirar o piso de zero de
// minimo/falta/desconto, trocar `aplica === true` por "qualquer verdadeiro",
// deixar o cupom que NÃO vale concorrer a "melhor" e tirar o arredondamento do
// selo grande passavam com a suíte inteira verde. São os números e o selo que a
// cliente lê no cartão do cupom — o servidor decide o desconto de verdade, mas
// a tela não pode mostrar "economize -R$ 5" nem destacar um cupom que não vale.
import {
  destaqueDoCupom,
  lerCuponsDoCheckout,
  melhorCupom,
  porcentagem,
  progressoAteOMinimo,
} from "@/lib/cupons-do-checkout";
import { describe, expect, it } from "vitest";

const linha = (extra: Record<string, unknown> = {}) => ({
  codigo: "VITRINE10",
  tipo: "percentage",
  valor: 10,
  minimo: 100,
  valido_ate: null,
  exclusivo: false,
  aplica: true,
  falta: 0,
  desconto: 12,
  ...extra,
});

describe("cupons do checkout — linha incoerente da RPC", () => {
  it("mínimo, falta e desconto negativos viram zero; 'aplica' só vale com true de verdade", () => {
    const [negativos] = lerCuponsDoCheckout([
      linha({ minimo: -50, falta: -30, desconto: -5 }),
    ]);
    expect(negativos.minimo).toBe(0);
    expect(negativos.falta).toBe(0);
    expect(negativos.desconto).toBe(0);

    // 1, "true" e "sim" não liberam o cupom; só o booleano true.
    for (const aplica of [1, "true", "sim", {}, []]) {
      const [c] = lerCuponsDoCheckout([linha({ aplica })]);
      expect(c.aplica, JSON.stringify(aplica)).toBe(false);
    }
    expect(lerCuponsDoCheckout([linha({ aplica: true })])[0].aplica).toBe(true);
  });

  it("cupom que NÃO vale não é 'o melhor' (mesmo com desconto positivo na linha); falta negativa não passa de 100%", () => {
    const cupons = lerCuponsDoCheckout([
      linha({ codigo: "NAOVALE", aplica: false, desconto: 99, falta: 10 }),
      linha({ codigo: "VALE", aplica: true, desconto: 5 }),
    ]);
    expect(melhorCupom(cupons)).toBe("VALE");
    expect(progressoAteOMinimo({ minimo: 100, falta: -40 })).toBe(100);
  });

  it("selo: 14,999 é 'R$ 15' (não 'R$ 14,999' nem 'R$ 15,00') e 10,004% é '10%'", () => {
    expect(destaqueDoCupom({ tipo: "fixed", valor: 14.999 })).toBe("R$ 15");
    expect(destaqueDoCupom({ tipo: "fixed", valor: 14.994 })).toBe("R$ 14,99");
    expect(porcentagem(10.004)).toBe("10%");
    expect(porcentagem(10.006)).toBe("10,01%");
  });
});
