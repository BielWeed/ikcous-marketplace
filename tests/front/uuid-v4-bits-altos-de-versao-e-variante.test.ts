// O UUID v4 de reserva (`src/lib/uuid-v4.ts`, usado onde o navegador não tem
// `randomUUID`, como numa página em HTTP) precisa ZERAR os bits altos antes de
// fixar a versão e a variante. O teste do módulo usa bytes pequenos (0 a 15),
// em que a máscara não faz diferença; com bytes de valor alto, sem a máscara a
// versão sairia 4f, 5f... e a variante c0, e o "UUID v4" deixaria de ser v4.
import { gerarUuidV4 } from "@/lib/uuid-v4";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

function comBytes(valor: (indice: number) => number) {
  vi.stubGlobal("crypto", {
    getRandomValues(bytes: Uint8Array) {
      bytes.set(Array.from({ length: bytes.length }, (_, i) => valor(i)));
      return bytes;
    },
  });
}

describe("UUID v4 de reserva — versão e variante com bytes de valor alto", () => {
  it("bytes todos 0xff: versão 4 e variante 'b' (10xx), o resto preservado", () => {
    comBytes(() => 0xff);
    expect(gerarUuidV4()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("bytes todos 0x00: versão 4 e variante 8", () => {
    comBytes(() => 0x00);
    expect(gerarUuidV4()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("qualquer sorteio sai com o formato de UUID v4", () => {
    for (const semente of [0x00, 0x3f, 0x40, 0x7f, 0x80, 0xbf, 0xc0, 0xff]) {
      comBytes((i) => (semente + i * 17) % 256);
      expect(gerarUuidV4()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});
