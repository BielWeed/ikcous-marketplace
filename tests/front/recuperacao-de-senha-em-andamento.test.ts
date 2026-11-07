// A marca "esta conta está no meio da troca de senha" (src/lib/recuperacao-de-
// senha-em-andamento.ts): validade, conta, sessão e storage quebrado. O fluxo
// com o AuthProvider (recarregar a tela) está em
// auth-recarregar-na-nova-senha-continua-na-nova-senha.test.tsx.
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";
import {
  esquecerRecuperacao,
  garantirRecuperacao,
  iniciarRecuperacao,
  recuperacaoEmAndamento,
  vincularRecuperacao,
} from "@/lib/recuperacao-de-senha-em-andamento";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE = "ikcous_recuperacao_de_senha";
const UMA_HORA = 60 * 60 * 1000;

let armazem: Map<string, string>;

function lerMarca(): { uid: string | null; ate: number } | null {
  const texto = armazem.get(CHAVE);
  return texto ? JSON.parse(texto) : null;
}

beforeEach(() => {
  armazem = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("recuperação de senha em andamento", () => {
  it("a chave sobrevive à purga de versão (vive e morre junto da sessão)", () => {
    expect(chaveSobreviveAPurga(CHAVE)).toBe(true);
  });

  it("iniciar grava conta e prazo de 1 hora; com a mesma conta na sessão, vale", () => {
    iniciarRecuperacao("conta-a");

    expect(lerMarca()).toEqual({ uid: "conta-a", ate: Date.now() + UMA_HORA });
    expect(recuperacaoEmAndamento("conta-a")).toBe(true);
  });

  it("sem marca, não é recuperação (caso comum de quem só abriu o app)", () => {
    expect(recuperacaoEmAndamento("conta-a")).toBe(false);
  });

  it("limite: vale até o último milissegundo e vence no instante do prazo", () => {
    iniciarRecuperacao("conta-a");

    vi.setSystemTime(Date.now() + UMA_HORA - 1);
    expect(recuperacaoEmAndamento("conta-a")).toBe(true);

    vi.setSystemTime(Date.now() + 1);
    expect(recuperacaoEmAndamento("conta-a")).toBe(false);
    expect(armazem.has(CHAVE)).toBe(false);
  });

  it("outra conta na sessão: não vale e a marca é apagada", () => {
    iniciarRecuperacao("conta-a");

    expect(recuperacaoEmAndamento("conta-b")).toBe(false);
    expect(armazem.has(CHAVE)).toBe(false);
  });

  it("sem sessão (uid nulo): não vale e a marca é apagada", () => {
    iniciarRecuperacao("conta-a");

    expect(recuperacaoEmAndamento(null)).toBe(false);
    expect(armazem.has(CHAVE)).toBe(false);
  });

  it("marca aberta pelo endereço (sem conta) mas SEM sessão no aparelho: não vale e é apagada", () => {
    iniciarRecuperacao(null);

    expect(recuperacaoEmAndamento(null)).toBe(false);
    expect(armazem.has(CHAVE)).toBe(false);
  });

  it("marca aberta pelo endereço (sem conta ainda) vale para a sessão que existir e depois fica presa a ela", () => {
    iniciarRecuperacao(null);
    expect(recuperacaoEmAndamento("conta-a")).toBe(true);

    vincularRecuperacao("conta-a");
    expect(lerMarca()?.uid).toBe("conta-a");
    expect(recuperacaoEmAndamento("conta-b")).toBe(false);
  });

  it("vincular não mexe numa marca que já tem dona, nem numa vencida, nem cria marca do nada", () => {
    iniciarRecuperacao("conta-a");
    vincularRecuperacao("conta-b");
    expect(lerMarca()?.uid).toBe("conta-a");

    esquecerRecuperacao();
    vincularRecuperacao("conta-b");
    expect(armazem.has(CHAVE)).toBe(false);

    iniciarRecuperacao(null);
    vi.setSystemTime(Date.now() + UMA_HORA + 1);
    vincularRecuperacao("conta-b");
    expect(lerMarca()?.uid).toBeNull();
  });

  it("garantir NÃO renova o prazo de uma marca viva (só o link aberto de novo renova)", () => {
    iniciarRecuperacao("conta-a");
    const original = lerMarca()!.ate;

    vi.setSystemTime(Date.now() + 30 * 60 * 1000);
    garantirRecuperacao("conta-a");
    expect(lerMarca()!.ate).toBe(original);

    iniciarRecuperacao("conta-a");
    expect(lerMarca()!.ate).toBeGreaterThan(original);
  });

  it("garantir começa uma marca nova quando não há ou quando a anterior venceu", () => {
    garantirRecuperacao("conta-a");
    expect(lerMarca()).toEqual({ uid: "conta-a", ate: Date.now() + UMA_HORA });

    vi.setSystemTime(Date.now() + UMA_HORA + 5);
    garantirRecuperacao("conta-a");
    expect(lerMarca()?.ate).toBe(Date.now() + UMA_HORA);
  });

  it("garantir completa a conta de uma marca viva que não tinha", () => {
    iniciarRecuperacao(null);
    garantirRecuperacao("conta-a");
    expect(lerMarca()?.uid).toBe("conta-a");
  });

  it("esquecer apaga; esquecer sem marca não lança", () => {
    iniciarRecuperacao("conta-a");
    esquecerRecuperacao();
    expect(armazem.has(CHAVE)).toBe(false);
    expect(() => esquecerRecuperacao()).not.toThrow();
  });

  it.each([
    ["texto que não é JSON", "isto não é json {"],
    ["JSON de outro formato", JSON.stringify({ qualquer: "coisa" })],
    [
      "prazo que não é número",
      JSON.stringify({ uid: "conta-a", ate: "amanhã" }),
    ],
    ["prazo infinito", '{"uid":"conta-a","ate":1e999}'],
    [
      "conta que não é texto",
      JSON.stringify({ uid: 42, ate: Date.now() + 1000 }),
    ],
    ["null", "null"],
  ])(
    "marca corrompida (%s): ignorada, apagada e nunca lança",
    (_nome, texto) => {
      armazem.set(CHAVE, texto);

      expect(() => recuperacaoEmAndamento("conta-a")).not.toThrow();
      expect(recuperacaoEmAndamento("conta-a")).toBe(false);
      expect(armazem.has(CHAVE)).toBe(false);
    },
  );

  it("storage que lança em tudo (modo privado, cheio, bloqueado): nenhuma função derruba o app", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });

    expect(() => iniciarRecuperacao("conta-a")).not.toThrow();
    expect(() => garantirRecuperacao("conta-a")).not.toThrow();
    expect(() => vincularRecuperacao("conta-a")).not.toThrow();
    expect(() => esquecerRecuperacao()).not.toThrow();
    expect(recuperacaoEmAndamento("conta-a")).toBe(false);
  });

  it("sem localStorage nenhum (ambiente sem DOM): tudo segue sem lançar", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(() => iniciarRecuperacao("conta-a")).not.toThrow();
    expect(recuperacaoEmAndamento("conta-a")).toBe(false);
    expect(() => esquecerRecuperacao()).not.toThrow();
  });
});
