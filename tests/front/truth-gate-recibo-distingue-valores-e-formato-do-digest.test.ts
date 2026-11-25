// O recibo do Truth Gate (`src/utils/truth_gate.ts`): o hash tem que identificar
// O QUE foi validado. O teste de Deno cobre "payloads diferentes, hashes
// diferentes" com número e texto; aqui ficam os tipos de valor e as bordas do
// digest que uma caça por mutação mostrou sem guarda:
//
//   - `null` e `undefined`, `NaN`, `Infinity` e `-Infinity`, função e símbolo,
//     datas, `[1,2]` contra `[12]`: cada um precisa dar um hash próprio;
//   - a MESMA referência em dois lugares do payload (compartilhada, não
//     circular) tem que dar o hash da cópia estrutural;
//   - o digest é de 64 bits em hexadecimal: 16 caracteres sempre, com zero à
//     esquerda e sem sinal de menos, e as duas metades não são cópia uma da
//     outra;
//   - o instante e o veredito (aviso de margem, que não está no payload da
//     variação) entram no hash;
//   - um vetor de referência trava a reprodutibilidade entre navegadores e
//     versões: mudar a ordem das chaves, as sementes ou a constante do FNV
//     muda o hash, e isso só pode acontecer de propósito.
import { TruthGate } from "@/utils/truth_gate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INSTANTE = "2026-08-05T00:00:00.000Z";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date(INSTANTE));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Hash do recibo de um produto válido que carrega `extra` como campo solto. */
const hashDe = (extra: unknown): string =>
  TruthGate.verifyProductAxiom({ id: "p-1", extra }).hash;

describe("cada tipo de valor dá um hash próprio", () => {
  it("null, undefined e a ausência do campo são três coisas diferentes", () => {
    const hashes = [
      TruthGate.verifyProductAxiom({ id: "p-1", extra: null }).hash,
      TruthGate.verifyProductAxiom({ id: "p-1", extra: undefined }).hash,
      TruthGate.verifyProductAxiom({ id: "p-1" }).hash,
    ];
    expect(new Set(hashes).size).toBe(3);
  });

  it("NaN, Infinity, -Infinity e null não colidem entre si nem com 0", () => {
    const hashes = [
      hashDe(Number.NaN),
      hashDe(Number.POSITIVE_INFINITY),
      hashDe(Number.NEGATIVE_INFINITY),
      hashDe(null),
      hashDe(0),
    ];
    expect(new Set(hashes).size).toBe(5);
  });

  it("função e símbolo não colidem", () => {
    expect(hashDe(() => 1)).not.toBe(hashDe(Symbol("s")));
  });

  it("bigint 1 e bigint 2 não colidem", () => {
    expect(hashDe(1n)).not.toBe(hashDe(2n));
  });

  it("datas diferentes dão hashes diferentes, e a mesma data dá o mesmo", () => {
    const janeiro = new Date("2026-01-01T00:00:00.000Z");
    const junho = new Date("2026-06-01T00:00:00.000Z");
    expect(hashDe(janeiro)).not.toBe(hashDe(junho));
    expect(hashDe(janeiro)).toBe(hashDe(new Date("2026-01-01T00:00:00.000Z")));
  });

  it("[1,2] e [12] não colidem (o separador do array conta)", () => {
    expect(hashDe([1, 2])).not.toBe(hashDe([12]));
    expect(hashDe(["a", "b"])).not.toBe(hashDe(["ab"]));
  });

  it("o número 1 e o texto '1' não colidem", () => {
    expect(hashDe(1)).not.toBe(hashDe("1"));
  });
});

describe("a mesma referência em dois lugares não é ciclo", () => {
  it("objeto repetido no payload dá o hash da cópia estrutural", () => {
    const repetido = { k: 1 };
    const compartilhado = hashDe({ x: [repetido, repetido] });
    const copiado = hashDe({ x: [{ k: 1 }, { k: 1 }] });
    expect(compartilhado).toBe(copiado);
  });

  it("ciclo de verdade segue sem estourar a pilha", () => {
    const ciclo: Record<string, unknown> = { k: 1 };
    ciclo.volta = ciclo;
    expect(hashDe(ciclo)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("o digest tem sempre 16 caracteres hexadecimais, de 64 bits de verdade", () => {
  const amostra = Array.from({ length: 300 }, (_, i) => ({
    id: `produto-${i}`,
    price: i,
  }));

  it("nenhum hash tem sinal de menos, letra fora de a-f nem menos de 16 caracteres", () => {
    for (const produto of amostra) {
      const { hash } = TruthGate.verifyProductAxiom(produto);
      expect(hash, produto.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("as duas metades do digest não são cópia uma da outra", () => {
    for (const produto of amostra) {
      const { hash } = TruthGate.verifyProductAxiom(produto);
      expect(hash.slice(0, 8), produto.id).not.toBe(hash.slice(8));
    }
  });

  it("trezentos payloads diferentes dão trezentos hashes diferentes", () => {
    const hashes = new Set(
      amostra.map((p) => TruthGate.verifyProductAxiom(p).hash),
    );
    expect(hashes.size).toBe(amostra.length);
  });
});

describe("instante e veredito entram no hash", () => {
  it("o mesmo payload validado um segundo depois dá outro hash", () => {
    const antes = TruthGate.verifyProductAxiom({ id: "p-1", price: 10 });
    vi.setSystemTime(new Date("2026-08-05T00:00:01.000Z"));
    const depois = TruthGate.verifyProductAxiom({ id: "p-1", price: 10 });
    expect(antes.timestamp).toBe(INSTANTE);
    expect(depois.timestamp).toBe("2026-08-05T00:00:01.000Z");
    expect(depois.hash).not.toBe(antes.hash);
  });

  it("o mesmo payload no mesmo instante dá o mesmo hash", () => {
    const a = TruthGate.verifyProductAxiom({ id: "p-1", price: 10 });
    const b = TruthGate.verifyProductAxiom({ id: "p-1", price: 10 });
    expect(a.hash).toBe(b.hash);
  });

  it("variação igual com e sem aviso de margem (custo do pai) dá hashes diferentes", () => {
    // O custo do pai vem no contexto, não no payload: só o aviso o separa.
    const variacao = { name: "Cor", value: "Azul", priceOverride: 10 };
    const comAviso = TruthGate.verifyVariantAxiom(variacao, { costPrice: 20 });
    const semAviso = TruthGate.verifyVariantAxiom(variacao, { costPrice: 5 });
    expect(comAviso.warnings).toHaveLength(1);
    expect(semAviso.warnings).toHaveLength(0);
    expect(comAviso.hash).not.toBe(semAviso.hash);
  });
});

describe("vetor de referência: o hash é reprodutível entre execuções", () => {
  // Valores do hash gravados da execução de 25/11/2026 com o relógio parado em
  // INSTANTE. Se este teste cair, o formato do digest mudou: confira que foi de
  // propósito e atualize os dois valores.
  it("produto", () => {
    const { hash } = TruthGate.verifyProductAxiom({
      name: "Camiseta Azul",
      price: 49.9,
      stock: 12,
      tags: ["a", "b"],
      dimensoes: { largura: 2, altura: 1 },
    });
    expect(hash).toBe("03375603901d0605");
  });

  it("variação", () => {
    const { hash } = TruthGate.verifyVariantAxiom(
      { name: "Cor", value: "Azul", stockIncrement: 3, priceOverride: 10 },
      { costPrice: 20 },
    );
    expect(hash).toBe("6e2724c8d2bd44e6");
  });
});
