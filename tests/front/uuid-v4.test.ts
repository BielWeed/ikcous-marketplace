import { gerarUuidV4 } from "@/lib/uuid-v4";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("gerador UUID v4 compartilhado", () => {
  it("consulta crypto a cada chamada e mantém o receptor de randomUUID", () => {
    const crypto = {
      randomUUID: vi.fn(function (this: unknown) {
        expect(this).toBe(crypto);
        return "00000000-0000-4000-8000-000000000001";
      }),
      getRandomValues: vi.fn(),
    };
    vi.stubGlobal("crypto", crypto);
    expect(gerarUuidV4()).toBe("00000000-0000-4000-8000-000000000001");
    expect(crypto.getRandomValues).not.toHaveBeenCalled();
    crypto.randomUUID.mockReturnValue("00000000-0000-4000-8000-000000000002");
    expect(gerarUuidV4()).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("sem randomUUID, conserva os bits aleatórios e fixa versão e variante", () => {
    const crypto = {
      getRandomValues(bytes: Uint8Array) {
        expect(this).toBe(crypto);
        expect(bytes).toHaveLength(16);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i;
        return bytes;
      },
    };
    vi.stubGlobal("crypto", crypto);
    expect(gerarUuidV4()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("não troca falha da fonte aleatória por uma chave insegura", () => {
    const falha = new Error("fonte indisponível");
    vi.stubGlobal("crypto", {
      getRandomValues: () => {
        throw falha;
      },
    });
    expect(() => gerarUuidV4()).toThrow(falha);
  });
});
