// A marca "esta conta está no meio da troca de senha"
// (`src/lib/recuperacao-de-senha-em-andamento.ts`): bordas de conta e de
// validade que `recuperacao-de-senha-em-andamento.test.ts` não segurava.
//
//  - a marca viva de UMA conta nunca é passada para OUTRA por `garantirRecuperacao`
//    (marca presa à conta da sessão do link);
//  - `garantirRecuperacao` e `vincularRecuperacao` tratam o instante exato do
//    vencimento como VENCIDO (a mesma régua de `recuperacaoEmAndamento`);
//  - vincular a conta a uma marca aberta pelo endereço NÃO renova a hora de
//    validade (o link do e-mail vale 1 hora desde que foi aberto);
//  - marca com a conta de tipo errado (storage adulterado ou de versão velha) é
//    descartada, não vira "conta que nunca bate".
//
// Relógio de mentira só para `Date`; storage em memória.
import {
  garantirRecuperacao,
  iniciarRecuperacao,
  recuperacaoEmAndamento,
  vincularRecuperacao,
} from "@/lib/recuperacao-de-senha-em-andamento";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE = "ikcous_recuperacao_de_senha";
const UM_MINUTO = 60 * 1000;
const UMA_HORA = 60 * UM_MINUTO;
const INICIO = new Date("2026-11-06T12:00:00Z");

let armazem: Map<string, string>;

function lerMarca(): { uid: unknown; ate: number } | null {
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
  vi.setSystemTime(INICIO);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("garantirRecuperacao — marca viva de outra conta", () => {
  it("não passa a marca de uma conta para a conta que chamou", () => {
    iniciarRecuperacao("conta-a");

    garantirRecuperacao("conta-b");

    expect(lerMarca()?.uid).toBe("conta-a");
    expect(recuperacaoEmAndamento("conta-b")).toBe(false);
  });

  it("marca viva sem conta recebe a conta que chamou (controle)", () => {
    iniciarRecuperacao(null);

    garantirRecuperacao("conta-a");

    expect(lerMarca()?.uid).toBe("conta-a");
  });
});

describe("o instante exato do vencimento é vencido", () => {
  it("garantirRecuperacao recomeça a marca com a conta nova e 1 hora inteira", () => {
    iniciarRecuperacao("conta-a");
    vi.setSystemTime(INICIO.getTime() + UMA_HORA);

    garantirRecuperacao("conta-b");

    expect(lerMarca()).toEqual({
      uid: "conta-b",
      ate: INICIO.getTime() + 2 * UMA_HORA,
    });
  });

  it("vincularRecuperacao não prende a conta a uma marca que acabou de vencer", () => {
    iniciarRecuperacao(null);
    vi.setSystemTime(INICIO.getTime() + UMA_HORA);

    vincularRecuperacao("conta-a");

    expect(lerMarca()?.uid).toBeNull();
  });

  it("um milissegundo antes do vencimento ainda vincula (controle)", () => {
    iniciarRecuperacao(null);
    vi.setSystemTime(INICIO.getTime() + UMA_HORA - 1);

    vincularRecuperacao("conta-a");

    expect(lerMarca()?.uid).toBe("conta-a");
  });
});

describe("vincular a conta não renova a validade", () => {
  it("a hora conta desde que o link foi aberto, mesmo se a conta só chega aos 59 minutos", () => {
    iniciarRecuperacao(null);
    const venceEm = INICIO.getTime() + UMA_HORA;

    vi.setSystemTime(INICIO.getTime() + 59 * UM_MINUTO);
    garantirRecuperacao("conta-a");
    expect(lerMarca()).toEqual({ uid: "conta-a", ate: venceEm });

    vi.setSystemTime(INICIO.getTime() + 61 * UM_MINUTO);
    expect(recuperacaoEmAndamento("conta-a")).toBe(false);
  });

  it("vincularRecuperacao também mantém o prazo original", () => {
    iniciarRecuperacao(null);
    const venceEm = INICIO.getTime() + UMA_HORA;

    vi.setSystemTime(INICIO.getTime() + 30 * UM_MINUTO);
    vincularRecuperacao("conta-a");

    expect(lerMarca()).toEqual({ uid: "conta-a", ate: venceEm });
  });
});

describe("marca com a conta de tipo errado", () => {
  it("é descartada: a seguinte começa do zero com a conta certa", () => {
    armazem.set(
      CHAVE,
      JSON.stringify({ uid: 123, ate: INICIO.getTime() + UMA_HORA }),
    );

    garantirRecuperacao("conta-a");

    expect(lerMarca()).toEqual({
      uid: "conta-a",
      ate: INICIO.getTime() + UMA_HORA,
    });
    expect(recuperacaoEmAndamento("conta-a")).toBe(true);
  });
});
