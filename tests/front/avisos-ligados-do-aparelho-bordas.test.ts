// Marcador "esta conta já ligou os avisos neste aparelho" (caça por mutação):
// o apagar-tudo ao soltar o aparelho (só as chaves do marcador, sem pular
// nenhuma), uma conta não enxerga o marcador da outra, armazenamento
// bloqueado nunca lança, e a tentativa de religar é UMA por conta por carga.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PREFIXO_AVISOS_LIGADOS,
  avisosEstavamLigados,
  esquecerAvisosLigados,
  esquecerTodosOsAvisosLigados,
  marcarAvisosLigados,
  reservarTentativaDeReligar,
} from "@/lib/avisos-ligados-do-aparelho";

// Armazenamento em memória que, como o de verdade, renumera as posições
// quando uma chave é apagada.
class Armazenamento {
  private itens = new Map<string, string>();
  get length() {
    return this.itens.size;
  }
  key(i: number) {
    return [...this.itens.keys()].at(i) ?? null;
  }
  getItem(k: string) {
    return this.itens.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.itens.set(k, v);
  }
  removeItem(k: string) {
    this.itens.delete(k);
  }
  chaves() {
    return [...this.itens.keys()];
  }
}

function instalar() {
  const armazenamento = new Armazenamento();
  vi.stubGlobal("localStorage", armazenamento);
  return armazenamento;
}

function bloqueado() {
  const falha = () => {
    throw new Error("armazenamento bloqueado");
  };
  vi.stubGlobal("localStorage", {
    get length() {
      return falha();
    },
    key: falha,
    getItem: falha,
    setItem: falha,
    removeItem: falha,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("avisos ligados: marcador por conta", () => {
  it("marcar vale só para a conta marcada", () => {
    const s = instalar();
    marcarAvisosLigados("conta-a");
    expect(avisosEstavamLigados("conta-a")).toBe(true);
    expect(avisosEstavamLigados("conta-b")).toBe(false);
    expect(s.chaves()).toEqual([`${PREFIXO_AVISOS_LIGADOS}conta-a`]);
  });

  it("marcador gravado vazio ainda conta como ligado (só ausência é 'não')", () => {
    const s = instalar();
    s.setItem(`${PREFIXO_AVISOS_LIGADOS}conta-c`, "");
    expect(avisosEstavamLigados("conta-c")).toBe(true);
  });

  it("esquecer uma conta não apaga a vizinha", () => {
    instalar();
    marcarAvisosLigados("conta-a");
    marcarAvisosLigados("conta-b");
    esquecerAvisosLigados("conta-a");
    expect(avisosEstavamLigados("conta-a")).toBe(false);
    expect(avisosEstavamLigados("conta-b")).toBe(true);
  });

  it("o prefixo começa com ikcous_ (a lista branca da limpeza depende disso)", () => {
    expect(PREFIXO_AVISOS_LIGADOS.startsWith("ikcous_")).toBe(true);
  });
});

describe("avisos ligados: soltar o aparelho esquece todas as contas", () => {
  it("apaga todos os marcadores seguidos, sem pular nenhum, e só eles", () => {
    const s = instalar();
    s.setItem("antes", "x");
    marcarAvisosLigados("c1");
    marcarAvisosLigados("c2");
    marcarAvisosLigados("c3");
    marcarAvisosLigados("c4");
    s.setItem("ikcous_outra_coisa", "y");
    s.setItem("depois", "z");
    esquecerTodosOsAvisosLigados();
    expect(s.chaves()).toEqual(["antes", "ikcous_outra_coisa", "depois"]);
    for (const conta of ["c1", "c2", "c3", "c4"])
      expect(avisosEstavamLigados(conta)).toBe(false);
  });

  it("sem nenhum marcador, não mexe em nada", () => {
    const s = instalar();
    s.setItem("qualquer", "1");
    esquecerTodosOsAvisosLigados();
    expect(s.chaves()).toEqual(["qualquer"]);
  });
});

describe("avisos ligados: armazenamento bloqueado nunca lança", () => {
  it("todas as funções seguem calmas e a conta conta como 'não ligada'", () => {
    bloqueado();
    expect(() => marcarAvisosLigados("conta-x")).not.toThrow();
    expect(() => esquecerAvisosLigados("conta-x")).not.toThrow();
    expect(() => esquecerTodosOsAvisosLigados()).not.toThrow();
    expect(avisosEstavamLigados("conta-x")).toBe(false);
  });
});

describe("avisos ligados: religar sozinho é uma tentativa por conta por carga", () => {
  it("primeira vez true, depois false, e outra conta tem a sua vez", () => {
    expect(reservarTentativaDeReligar("conta-religar-1")).toBe(true);
    expect(reservarTentativaDeReligar("conta-religar-1")).toBe(false);
    expect(reservarTentativaDeReligar("conta-religar-1")).toBe(false);
    expect(reservarTentativaDeReligar("conta-religar-2")).toBe(true);
    expect(reservarTentativaDeReligar("conta-religar-2")).toBe(false);
  });
});
