// @vitest-environment node
// Contraprova isolada: versões coexistentes compartilham o mesmo storage.
// Só decide; não executa recuperação, listeners, service worker ou rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VERSAO_A = "0.0.0-prova-a";
const VERSAO_B = "0.0.0-prova-b";
let armazem: Map<string, string>;

async function carregarVersao(versao: string) {
  vi.resetModules();
  vi.stubGlobal("__APP_VERSION__", versao);
  return await import("@/lib/recuperacao-chunk");
}

function lerRegistro(chave: string) {
  const cru = localStorage.getItem(chave);
  return cru
    ? (JSON.parse(cru) as { versao: string; count: number; lastAt: number })
    : null;
}

beforeEach(() => {
  armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("teto da recuperação entre duas versões reais do módulo", () => {
  it("controle: A consome dois degraus e recusa o terceiro", async () => {
    const a = await carregarVersao(VERSAO_A);
    expect(armazem.size).toBe(0);

    expect(a.reportarErroChunk(1000, true)).toEqual({
      dono: true,
      acao: "ciclo-sw",
    });
    expect(lerRegistro(`${a.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_A}`)).toEqual({
      versao: VERSAO_A,
      count: 1,
      lastAt: 1000,
    });
    expect(a.reportarErroChunk(17000, true)).toEqual({
      dono: true,
      acao: "purge",
    });
    expect(a.reportarErroChunk(34000, true)).toEqual({
      dono: false,
      acao: "recusar",
    });
    expect(lerRegistro(`${a.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_A}`)).toEqual({
      versao: VERSAO_A,
      count: 2,
      lastAt: 17000,
    });
  });

  it("B não deve apagar o cooldown de A dentro da mesma janela", async () => {
    const a = await carregarVersao(VERSAO_A);
    const storageCompartilhado = globalThis.localStorage;
    const b = await carregarVersao(VERSAO_B);
    expect(a.reportarErroChunk).not.toBe(b.reportarErroChunk);
    expect(globalThis.localStorage).toBe(storageCompartilhado);
    expect(armazem.size).toBe(0);

    expect(a.reportarErroChunk(1000, true)).toEqual({
      dono: true,
      acao: "ciclo-sw",
    });
    expect(lerRegistro(`${a.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_A}`)).toEqual({
      versao: VERSAO_A,
      count: 1,
      lastAt: 1000,
    });
    expect(b.reportarErroChunk(1001, true)).toEqual({
      dono: true,
      acao: "ciclo-sw",
    });
    const registroDeB = lerRegistro(`${b.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_B}`);
    expect(registroDeB).toEqual({
      versao: VERSAO_B,
      count: 1,
      lastAt: 1001,
    });

    const retornoDeA = a.reportarErroChunk(1002, true);
    expect(
      retornoDeA,
      JSON.stringify({
        registroDeB,
        registroAposRetornoDeA: lerRegistro(
          `${a.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_A}`,
        ),
      }),
    ).toEqual({ dono: false, acao: "recusar" });
  });

  it("controle: B mantém seus dois degraus depois de A esgotar os próprios", async () => {
    const a = await carregarVersao(VERSAO_A);
    const storageCompartilhado = globalThis.localStorage;
    const b = await carregarVersao(VERSAO_B);
    expect(a.reportarErroChunk).not.toBe(b.reportarErroChunk);
    expect(globalThis.localStorage).toBe(storageCompartilhado);
    expect(armazem.size).toBe(0);

    expect(a.reportarErroChunk(1000, true)).toEqual({
      dono: true,
      acao: "ciclo-sw",
    });
    expect(a.reportarErroChunk(17000, true)).toEqual({
      dono: true,
      acao: "purge",
    });
    expect(lerRegistro(`${a.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_A}`)).toEqual({
      versao: VERSAO_A,
      count: 2,
      lastAt: 17000,
    });

    expect(b.reportarErroChunk(17001, true)).toEqual({
      dono: true,
      acao: "ciclo-sw",
    });
    expect(lerRegistro(`${b.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_B}`)).toEqual({
      versao: VERSAO_B,
      count: 1,
      lastAt: 17001,
    });
    expect(b.reportarErroChunk(33001, true)).toEqual({
      dono: true,
      acao: "purge",
    });
    expect(b.reportarErroChunk(50001, true)).toEqual({
      dono: false,
      acao: "recusar",
    });
    expect(lerRegistro(`${b.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_B}`)).toEqual({
      versao: VERSAO_B,
      count: 2,
      lastAt: 33001,
    });
  });

  it("B não deve devolver a A os dois degraus já consumidos", async () => {
    const a = await carregarVersao(VERSAO_A);
    const storageCompartilhado = globalThis.localStorage;
    const b = await carregarVersao(VERSAO_B);
    expect(a.reportarErroChunk).not.toBe(b.reportarErroChunk);
    expect(a.CHAVE_RECUPERACAO_CHUNK).toBe(b.CHAVE_RECUPERACAO_CHUNK);
    expect(globalThis.localStorage).toBe(storageCompartilhado);
    expect(armazem.size).toBe(0);

    // A permanece viva depois da importação de B: a versão foi capturada
    // pelo módulo real, não é uma reimplementação consultando a global.
    expect(a.reportarErroChunk(1000, true)).toEqual({
      dono: true,
      acao: "ciclo-sw",
    });
    expect(lerRegistro(`${a.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_A}`)).toEqual({
      versao: VERSAO_A,
      count: 1,
      lastAt: 1000,
    });
    expect(a.reportarErroChunk(17000, true)).toEqual({
      dono: true,
      acao: "purge",
    });
    expect(lerRegistro(`${a.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_A}`)).toEqual({
      versao: VERSAO_A,
      count: 2,
      lastAt: 17000,
    });

    // Somente B escreve seu registro, chamando a função de produção.
    expect(b.reportarErroChunk(17001, true)).toEqual({
      dono: true,
      acao: "ciclo-sw",
    });
    const registroDeB = lerRegistro(`${b.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_B}`);
    expect(registroDeB).toEqual({
      versao: VERSAO_B,
      count: 1,
      lastAt: 17001,
    });

    const terceiraDeA = a.reportarErroChunk(17002, true);
    expect(
      terceiraDeA,
      JSON.stringify({
        registroDeB,
        registroAposRetornoDeA: lerRegistro(
          `${a.CHAVE_RECUPERACAO_CHUNK}:${VERSAO_A}`,
        ),
      }),
    ).toEqual({ dono: false, acao: "recusar" });
  });
});
