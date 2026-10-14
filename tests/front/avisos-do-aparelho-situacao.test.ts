// @vitest-environment jsdom
//
// A tabela de decisão do cartão "este aparelho não recebe aviso de pedido
// novo" (`src/lib/avisos-do-aparelho.ts`): QUAL cartão mostrar para cada
// combinação de suporte, permissão, inscrição e instalação — e o "Agora não"
// de 7 dias. A tela só desenha o que esta função manda.
import {
  CHAVE_DO_ADIAMENTO_DOS_AVISOS,
  type EntradaDaSituacao,
  PASSOS_PARA_INSTALAR_NO_IOS,
  PRAZO_DO_ADIAMENTO_DOS_AVISOS_MS,
  adiamentoEstaValendo,
  adiarOsAvisos,
  lerAdiamentoDosAvisos,
  passosParaLiberarOsAvisos,
  situacaoDosAvisos,
} from "@/lib/avisos-do-aparelho";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE: EntradaDaSituacao = {
  sondado: true,
  isSupported: true,
  permission: "default",
  temInscricao: false,
  ehApple: false,
  instalado: false,
};

describe("situacaoDosAvisos", () => {
  it.each([
    ["sonda em andamento: não se sabe nada", { sondado: false }, "sondando"],
    [
      "inscrito com permissão: ligado",
      { permission: "granted", temInscricao: true },
      "ligados",
    ],
    [
      "inscrito mas a permissão foi revogada: não entrega nada",
      { permission: "denied", temInscricao: true },
      "bloqueado",
    ],
    [
      "permissão dada e inscrição perdida (Sair e Entrar): dá para ligar de novo",
      { permission: "granted", temInscricao: false },
      "ligar",
    ],
    ["nunca perguntou: dá para ligar", { permission: "default" }, "ligar"],
    ["escolheu Bloquear", { permission: "denied" }, "bloqueado"],
    ["navegador sem push", { isSupported: false }, "sem-suporte"],
    [
      "iPhone na aba do Safari: só com o app instalado",
      { ehApple: true, instalado: false, isSupported: false },
      "instalar-no-ios",
    ],
    [
      "iPhone na aba, mesmo que o navegador dissesse que suporta",
      { ehApple: true, instalado: false, isSupported: true },
      "instalar-no-ios",
    ],
    [
      "iPhone com o app instalado: liga com um toque",
      { ehApple: true, instalado: true },
      "ligar",
    ],
    [
      "iPhone instalado mas antigo demais para aviso",
      { ehApple: true, instalado: true, isSupported: false },
      "sem-suporte",
    ],
    [
      "Android instalado sem inscrição: liga",
      { ehApple: false, instalado: true },
      "ligar",
    ],
  ] as [string, Partial<EntradaDaSituacao>, string][])(
    "%s",
    (_nome, ajuste, esperado) => {
      expect(situacaoDosAvisos({ ...BASE, ...ajuste })).toBe(esperado);
    },
  );
});

describe("passos escritos para quem não é do ramo", () => {
  it("o caminho do iPhone cita Compartilhar e Adicionar à Tela de Início", () => {
    const todos = PASSOS_PARA_INSTALAR_NO_IOS.join(" ");
    expect(todos).toContain("Compartilhar");
    expect(todos).toContain("Adicionar à Tela de Início");
  });

  it("cada lugar tem o seu caminho, e o do app instalado leva o nome da loja", () => {
    const aba = passosParaLiberarOsAvisos(
      { instalado: false, ehApple: false },
      "Loja X",
    );
    const android = passosParaLiberarOsAvisos(
      { instalado: true, ehApple: false },
      "Loja X",
    );
    const apple = passosParaLiberarOsAvisos(
      { instalado: true, ehApple: true },
      "Loja X",
    );

    expect(aba.join(" ")).toContain("Permissões");
    expect(aba.join(" ")).not.toContain("Loja X");
    expect(android.join(" ")).toContain("Apps");
    expect(android.join(" ")).toContain("Loja X");
    expect(apple.join(" ")).toContain("Ajustes");
    expect(apple.join(" ")).toContain("Loja X");
    expect(new Set([aba[0], android[0], apple[0]]).size).toBe(3);
  });
});

describe("o adiamento (Agora não)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("vale por 7 dias: grava a data e o relógio decide", () => {
    expect(PRAZO_DO_ADIAMENTO_DOS_AVISOS_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const ate = adiarOsAvisos(1_000);
    expect(ate).toBe(1_000 + PRAZO_DO_ADIAMENTO_DOS_AVISOS_MS);
    expect(lerAdiamentoDosAvisos()).toBe(ate);
    expect(adiamentoEstaValendo(ate, ate - 1)).toBe(true);
    expect(adiamentoEstaValendo(ate, ate)).toBe(false);
  });

  it("sem registro, ou com lixo gravado, não há adiamento", () => {
    expect(lerAdiamentoDosAvisos()).toBeNull();
    localStorage.setItem(CHAVE_DO_ADIAMENTO_DOS_AVISOS, "talvez");
    expect(lerAdiamentoDosAvisos()).toBeNull();
    expect(adiamentoEstaValendo(null, 5)).toBe(false);
  });

  it("armazenamento bloqueado não lança", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(lerAdiamentoDosAvisos()).toBeNull();
    expect(() => adiarOsAvisos(10)).not.toThrow();
  });
});
