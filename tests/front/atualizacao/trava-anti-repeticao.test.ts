// TRAVA ANTI-REPETIÇÃO — no máximo 2 tentativas por versão-alvo em cada
// aparelho. Existe porque já houve loop de recarregamento (julho): a versão
// nova não entrava, o app recarregava, via a atualização de novo, recarregava...
//
// Regra de segurança desta peça: STORAGE QUE NÃO CONFIRMA = NÃO INSTALA. A
// contagem é gravada e lida de volta; sem confirmação, a reserva é negada.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_DA_TRAVA_DE_ATUALIZACAO,
  CHAVE_DA_TRAVA_POR_ORIGEM,
  MAX_TENTATIVAS_POR_VERSAO,
  devolverTentativa,
  podeTentarAtualizar,
  reservarTentativa,
  tentativasDaOrigem,
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
  // ── O teto por build de ORIGEM (16/10, revisão Opus) ─────────────────────
  //
  // A chave por versão-alvo sozinha é contornável: ela muda entre aberturas
  // ("1.5.32-sha.x" vs "desconhecida-de-1.5.0") e o canal realtime aceita
  // qualquer string como versão. O teto por origem não depende do alvo: no
  // máximo 2 tentativas automáticas saindo do MESMO build instalado.
  describe("teto por build de origem", () => {
    it("a chave sobrevive à purga (pwa_)", () => {
      expect(chaveSobreviveAPurga(CHAVE_DA_TRAVA_POR_ORIGEM)).toBe(true);
    });

    it("2 tentativas saindo da mesma origem esgotam o teto, QUALQUER que seja o alvo", () => {
      expect(reservarTentativa("alvo-A", "1.5.0-sha.o")).toBe(true);
      expect(reservarTentativa("alvo-B", "1.5.0-sha.o")).toBe(true);
      // alvo novinho em folha, mas a origem já gastou as 2
      expect(podeTentarAtualizar("alvo-C", "1.5.0-sha.o")).toBe(false);
      expect(reservarTentativa("alvo-C", "1.5.0-sha.o")).toBe(false);
      expect(tentativasDaOrigem("1.5.0-sha.o")).toBe(2);
    });

    it("ALTERNAR as chaves (versão real / desconhecida-de / lixo do realtime) NÃO escapa do teto", () => {
      const origem = "1.5.0-sha.o";
      const alvos = [
        "1.5.32-sha.real",
        `desconhecida-de-${origem}`,
        "binary-v24",
        "1.5.33-sha.outra",
        "x".repeat(40),
        "1.5.32-sha.real",
      ];
      let passaram = 0;
      for (const alvo of alvos) {
        if (reservarTentativa(alvo, origem)) passaram += 1;
      }
      expect(passaram).toBe(2);
    });

    it("origem DIFERENTE (o app foi atualizado de verdade) zera o teto", () => {
      reservarTentativa("alvo-A", "1.5.0-sha.o");
      reservarTentativa("alvo-B", "1.5.0-sha.o");
      expect(podeTentarAtualizar("alvo-C", "1.5.0-sha.o")).toBe(false);
      expect(podeTentarAtualizar("alvo-C", "1.5.32-sha.nova-origem")).toBe(
        true,
      );
      expect(reservarTentativa("alvo-C", "1.5.32-sha.nova-origem")).toBe(true);
      expect(tentativasDaOrigem("1.5.32-sha.nova-origem")).toBe(1);
    });

    it("sem origem informada, vale só a conta por alvo (compatível com quem não passa)", () => {
      expect(reservarTentativa("a")).toBe(true);
      expect(reservarTentativa("b")).toBe(true);
      expect(reservarTentativa("c")).toBe(true);
    });

    it("a gravação do teto de origem também é CONFIRMADA lendo de volta: não confirmou, não reserva", () => {
      vi.stubGlobal("localStorage", {
        getItem: (k: string) =>
          k === CHAVE_DA_TRAVA_POR_ORIGEM ? null : (local.get(k) ?? null),
        setItem: (k: string, v: string) => {
          if (k !== CHAVE_DA_TRAVA_POR_ORIGEM) local.set(k, v);
        },
        removeItem: (k: string) => {
          local.delete(k);
        },
      });
      expect(reservarTentativa("alvo", "1.5.0-sha.o")).toBe(false);
    });

    it("valor corrompido do teto de origem vale como zero (não trava para sempre)", () => {
      local.set(CHAVE_DA_TRAVA_POR_ORIGEM, "{lixo");
      expect(podeTentarAtualizar("alvo", "1.5.0-sha.o")).toBe(true);
      expect(reservarTentativa("alvo", "1.5.0-sha.o")).toBe(true);
    });
  });

  describe("devolverTentativa (recusa ANTES de apagar qualquer coisa)", () => {
    it("devolve a que foi gasta, nos dois contadores: recusas 'agora não' nunca esgotam o orçamento", () => {
      for (let i = 0; i < 10; i += 1) {
        expect(reservarTentativa("alvo", "1.5.0-sha.o")).toBe(true);
        devolverTentativa("alvo", "1.5.0-sha.o");
      }
      expect(tentativasFeitas("alvo")).toBe(0);
      expect(tentativasDaOrigem("1.5.0-sha.o")).toBe(0);
    });

    it("não passa de zero e não mexe em outro alvo/origem", () => {
      devolverTentativa("alvo", "1.5.0-sha.o");
      expect(tentativasFeitas("alvo")).toBe(0);
      reservarTentativa("alvo-A", "o1");
      devolverTentativa("alvo-B", "o2");
      expect(tentativasFeitas("alvo-A")).toBe(1);
      expect(tentativasDaOrigem("o1")).toBe(1);
    });

    it("storage lançando: não derruba", () => {
      vi.stubGlobal("localStorage", storageQueLanca);
      expect(() => devolverTentativa("alvo", "o")).not.toThrow();
    });
  });
});
