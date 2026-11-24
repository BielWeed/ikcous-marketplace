// Aviso de estoque do sino/Notificações (`montarAvisos`): o que o lojista LÊ
// e a fronteira exata do mínimo do produto.
//
// Os testes irmãos (avisos-do-lojista.test.ts e ...-estoque-urgencia.test.ts)
// provam quem entra, a ordem e o destino, mas nenhum prendia as PALAVRAS:
// trocar "acabou" por "está acabando", ou "1 unidade restante" por
// "1 unidades restantes", passava em silêncio. Aqui as frases e as bordas.
import { describe, expect, it } from "vitest";

import {
  type EntradaDeAvisos,
  LIMIAR_PADRAO_DE_ESTOQUE,
  montarAvisos,
} from "@/utils/avisos-do-lojista";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

function avisosDe(
  stock: number,
  estoqueMinimo: number | null = null,
  name = "Caneta 3D",
) {
  return montarAvisos({
    ...VAZIO,
    produtos: [
      {
        id: "prod-1",
        name,
        stock,
        estoqueMinimo,
        created_at: "2026-08-20T09:00:00.000Z",
      },
    ],
  });
}

describe("aviso de estoque: o que o lojista lê", () => {
  it("estoque ZERO: diz que acabou e que não sobrou nenhuma unidade", () => {
    const [aviso] = avisosDe(0);

    expect(aviso?.titulo).toBe("Caneta 3D acabou");
    expect(aviso?.detalhe).toBe("Sem nenhuma unidade");
  });

  it("estoque 1: 'está acabando' e '1 unidade restante' no singular", () => {
    const [aviso] = avisosDe(1);

    expect(aviso?.titulo).toBe("Caneta 3D está acabando");
    expect(aviso?.detalhe).toBe("1 unidade restante");
  });

  it("estoque 2: plural com o número exato", () => {
    const [aviso] = avisosDe(2);

    expect(aviso?.titulo).toBe("Caneta 3D está acabando");
    expect(aviso?.detalhe).toBe("2 unidades restantes");
  });

  it("estoque no limite do padrão (5): plural com 5, não 'acabou'", () => {
    const [aviso] = avisosDe(LIMIAR_PADRAO_DE_ESTOQUE);

    expect(aviso?.titulo).toBe("Caneta 3D está acabando");
    expect(aviso?.detalhe).toBe("5 unidades restantes");
  });

  it("o id do aviso é 'estoque:' + id do produto (a chave do aviso lido)", () => {
    const [aviso] = avisosDe(2);

    expect(aviso?.id).toBe("estoque:prod-1");
  });

  it("o nome do produto entra inteiro no título", () => {
    const [aviso] = avisosDe(0, null, "Conjunto de lençóis queen");

    expect(aviso?.titulo).toBe("Conjunto de lençóis queen acabou");
  });
});

describe("aviso de estoque: fronteira exata do mínimo do produto", () => {
  it("sem mínimo: 5 avisa e 6 não (o padrão vale)", () => {
    expect(avisosDe(5, null)).toHaveLength(1);
    expect(avisosDe(6, null)).toHaveLength(0);
  });

  it("mínimo 10: 10 avisa (igual ao mínimo) e 11 não", () => {
    expect(avisosDe(10, 10)).toHaveLength(1);
    expect(avisosDe(11, 10)).toHaveLength(0);
  });

  it("mínimo 2 (abaixo do padrão): 2 avisa e 3 não, mesmo o 3 estando abaixo de 5", () => {
    expect(avisosDe(2, 2)).toHaveLength(1);
    expect(avisosDe(3, 2)).toHaveLength(0);
  });

  it("mínimo 0 ('não me avise'): só avisa quando zera; 1 já não avisa", () => {
    expect(avisosDe(0, 0)).toHaveLength(1);
    expect(avisosDe(1, 0)).toHaveLength(0);
  });

  it("mínimo 0 e estoque zero ainda diz 'acabou' (zerar sempre é alerta)", () => {
    const [aviso] = avisosDe(0, 0);

    expect(aviso?.titulo).toBe("Caneta 3D acabou");
  });

  it("estoque NaN não vira alerta nem derruba a montagem dos avisos", () => {
    expect(avisosDe(Number.NaN, null)).toHaveLength(0);
  });
});
