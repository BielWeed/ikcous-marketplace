// Bordas do código interno automático (`src/utils/sku-automatico.ts`) que
// `sku-automatico.test.ts` não segurava: o número exato de tentativas para
// achar um código livre, a comparação de ocupados com espaço, o sorteio que
// passa do tamanho do alfabeto, a primeira palavra curta do nome e as duas
// fontes de sorteio (crypto, e Math.random quando não existe crypto).
import {
  ALFABETO_DO_CODIGO,
  prefixoDoCodigo,
  sufixoDoCodigo,
  sufixoLivre,
} from "@/utils/sku-automatico";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sufixoLivre — quantas vezes tenta", () => {
  it("com tudo ocupado sorteia exatamente 25 vezes e devolve o último sorteio", () => {
    const gerar = vi.fn<() => string>(() => "AAAA");
    const sufixo = sufixoLivre("CAM", ["CAM-AAAA"], gerar);
    expect(gerar).toHaveBeenCalledTimes(25);
    expect(sufixo).toBe("AAAA");
  });

  it("para na primeira tentativa livre, sem sortear a mais", () => {
    const gerar = vi.fn<() => string>(() => "BBBB");
    expect(sufixoLivre("CAM", ["CAM-AAAA"], gerar)).toBe("BBBB");
    expect(gerar).toHaveBeenCalledTimes(1);
  });
});

describe("sufixoLivre — ocupados vindos do formulário", () => {
  it("código ocupado com espaço nas pontas e em minúsculas ainda conta como ocupado", () => {
    const sorteios = ["AAAA", "BBBB"];
    const gerar = vi.fn<() => string>(() => sorteios.shift() ?? "ZZZZ");
    expect(sufixoLivre("CAM", ["  cam-aaaa "], gerar)).toBe("BBBB");
  });
});

describe("sufixoDoCodigo — sorteio maior que o alfabeto", () => {
  it("reduz por módulo ao tamanho do alfabeto: 31 é a última letra, 32 volta à primeira", () => {
    const ultima = ALFABETO_DO_CODIGO.length - 1;
    expect(sufixoDoCodigo(() => ultima)).toBe("ZZZZ");
    expect(sufixoDoCodigo(() => ALFABETO_DO_CODIGO.length)).toBe("2222");
    expect(sufixoDoCodigo(() => ALFABETO_DO_CODIGO.length + 1)).toBe("3333");
  });
});

describe("prefixoDoCodigo — primeira palavra do nome", () => {
  it("sem categoria, usa SÓ a primeira palavra, mesmo curta (não completa com a seguinte)", () => {
    expect(prefixoDoCodigo("", "Ox rosa")).toBe("OX");
  });

  it("primeira palavra sem letra nem número cai em PRD, mesmo que a seguinte tenha", () => {
    expect(prefixoDoCodigo("", "- Camiseta")).toBe("PRD");
  });
});

describe("sufixoDoCodigo — fontes de sorteio padrão", () => {
  it("usa o crypto do aparelho e reduz cada número ao alfabeto", () => {
    const numeros = [33, 64, 31, 0];
    vi.stubGlobal("crypto", {
      getRandomValues: (buffer: Uint32Array) => {
        buffer[0] = numeros.shift() ?? 0;
        return buffer;
      },
    });
    // 33 % 32 = 1 ('3'), 64 % 32 = 0 ('2'), 31 ('Z'), 0 ('2')
    expect(sufixoDoCodigo()).toBe("32Z2");
  });

  it("sem crypto, cai para Math.random e escolhe a letra proporcional", () => {
    vi.stubGlobal("crypto", undefined);
    const sorteios = [0, 0.5, 0.99, 0.03];
    vi.spyOn(Math, "random").mockImplementation(() => sorteios.shift() ?? 0);
    // índices 0, 16, 31, 0 do alfabeto
    expect(sufixoDoCodigo()).toBe("2JZ2");
  });
});
