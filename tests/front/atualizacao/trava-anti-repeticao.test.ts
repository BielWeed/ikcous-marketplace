// TRAVA ANTI-REPETIÇÃO — no máximo 2 tentativas por versão-alvo em cada
// aparelho. Existe porque já houve loop de recarregamento (julho): a versão
// nova não entrava, o app recarregava, via a atualização de novo, recarregava...
//
// Regra de segurança desta peça: STORAGE QUE NÃO CONFIRMA = NÃO INSTALA. A
// contagem é gravada e lida de volta; sem confirmação, a reserva é negada.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_DA_TRAVA_DE_ATUALIZACAO,
  MAX_TENTATIVAS_POR_VERSAO,
  podeTentarAtualizar,
  reservarTentativa,
  tentativasFeitas,
} from "@/lib/atualizacao/trava-anti-repeticao";
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";

const local = new Map<string, string>();
const stub = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => {
    m.set(k, String(v));
  },
  removeItem: (k: string) => {
    m.delete(k);
  },
});

const storageQueLanca = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("trava anti-repeticao", () => {
  beforeEach(() => {
    local.clear();
    vi.stubGlobal("localStorage", stub(local));
  });

  it("o limite é 2 e a chave sobrevive à purga (prefixo da lista branca)", () => {
    expect(MAX_TENTATIVAS_POR_VERSAO).toBe(2);
    expect(chaveSobreviveAPurga(CHAVE_DA_TRAVA_DE_ATUALIZACAO)).toBe(true);
  });

  it("a 1ª e a 2ª tentativa passam; a 3ª para a mesma versão-alvo é negada", () => {
    expect(podeTentarAtualizar("1.5.32-sha.a")).toBe(true);
    expect(reservarTentativa("1.5.32-sha.a")).toBe(true);
    expect(reservarTentativa("1.5.32-sha.a")).toBe(true);
    expect(tentativasFeitas("1.5.32-sha.a")).toBe(2);
    expect(podeTentarAtualizar("1.5.32-sha.a")).toBe(false);
    expect(reservarTentativa("1.5.32-sha.a")).toBe(false);
    // negar não consome nada e continua negando
    expect(reservarTentativa("1.5.32-sha.a")).toBe(false);
    expect(tentativasFeitas("1.5.32-sha.a")).toBe(2);
  });

  it("não há 'mesma rodada' que pule a conta: duas reservas seguidas gastam duas", () => {
    // (a exclusão mútua entre abas é do exclusao-de-instalacao; a trava conta
    // o que lhe pedem, sem janela de perdão)
    expect(reservarTentativa("alvo")).toBe(true);
    expect(reservarTentativa("alvo")).toBe(true);
    expect(reservarTentativa("alvo")).toBe(false);
  });

  it("versão-alvo DIFERENTE zera a conta (uma correção nova não fica presa pela antiga)", () => {
    reservarTentativa("1.5.32-sha.a");
    reservarTentativa("1.5.32-sha.a");
    expect(podeTentarAtualizar("1.5.32-sha.a")).toBe(false);
    expect(podeTentarAtualizar("1.5.33-sha.b")).toBe(true);
    expect(reservarTentativa("1.5.33-sha.b")).toBe(true);
    expect(tentativasFeitas("1.5.33-sha.b")).toBe(1);
  });

  it("valor corrompido no storage vale como primeira tentativa (nunca trava para sempre)", () => {
    local.set(CHAVE_DA_TRAVA_DE_ATUALIZACAO, "{isso não é json");
    expect(podeTentarAtualizar("alvo")).toBe(true);
    expect(reservarTentativa("alvo")).toBe(true);
    expect(tentativasFeitas("alvo")).toBe(1);
  });

  it("JSON de outra forma (lixo válido) também vale como primeira tentativa", () => {
    local.set(CHAVE_DA_TRAVA_DE_ATUALIZACAO, JSON.stringify({ x: 1 }));
    expect(podeTentarAtualizar("alvo")).toBe(true);
  });

  it("a conta mora no localStorage: outra página (módulo novo) vê as tentativas já gastas", () => {
    reservarTentativa("alvo");
    reservarTentativa("alvo");
    // a "outra página" lê o mesmo storage
    expect(podeTentarAtualizar("alvo")).toBe(false);
  });

  describe("storage que não confirma = NÃO instala", () => {
    it("localStorage LANÇANDO: nega a reserva e não pode tentar (sem como contar, sem instalar)", () => {
      vi.stubGlobal("localStorage", storageQueLanca);
      expect(() => reservarTentativa("alvo")).not.toThrow();
      expect(reservarTentativa("alvo")).toBe(false);
      expect(podeTentarAtualizar("alvo")).toBe(false);
      expect(tentativasFeitas("alvo")).toBe(0);
    });

    it("escrita falha (quota): nega", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      });
      expect(reservarTentativa("alvo")).toBe(false);
    });

    it("escrita 'aceita' mas a leitura de volta não confere: nega (não conseguiu CONFIRMAR)", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => null, // sempre vazio: a gravação não pegou
        setItem: () => {},
        removeItem: () => {},
      });
      expect(reservarTentativa("alvo")).toBe(false);
    });

    it("outra aba ganhou a corrida de escrita (leu de volta uma contagem diferente): nega", () => {
      let gravado: string | null = null;
      vi.stubGlobal("localStorage", {
        getItem: () => gravado,
        setItem: () => {
          // o valor que fica NÃO é o que esta aba gravou
          gravado = JSON.stringify({ alvo: "alvo", count: 2, ultimaEm: 1 });
        },
        removeItem: () => {},
      });
      expect(reservarTentativa("alvo")).toBe(false);
    });
  });
});
