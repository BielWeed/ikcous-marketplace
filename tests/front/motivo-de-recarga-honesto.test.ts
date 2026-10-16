import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAVE_MOTIVO_DE_RECARGA,
  CHAVE_ORIGEM_DE_ATUALIZACAO,
  CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO,
  atualizacaoTrocouDeBuild,
  consumirOrigemDaAtualizacao,
  descreveMotivoDeRecarga,
  gravaMotivoDeRecarga,
  gravaOrigemDeAtualizacao,
  gravaVersaoEsperadaDaAtualizacao,
  limpaMotivoDeRecarga,
} from "../../src/lib/motivo-de-recarga";

// jsdom desta árvore não traz localStorage nem sessionStorage (ver _REGRAS):
// stubs mínimos honestos. A evidência de build mora em sessionStorage (achado
// 1 da revisão: por aba, invisível às irmãs) — o motivo nominal segue no
// localStorage, compartilhado.
const memoria = new Map<string, string>();
const memoriaDeSessao = new Map<string, string>();

const stubDeStorage = (mapa: Map<string, string>) => ({
  getItem: (k: string) => mapa.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mapa.set(k, String(v));
  },
  removeItem: (k: string) => {
    mapa.delete(k);
  },
  clear: () => {
    mapa.clear();
  },
});

describe("motivo-de-recarga — o toast do boot diz a verdade (laudo #2, P-1)", () => {
  beforeEach(() => {
    memoria.clear();
    memoriaDeSessao.clear();
    vi.stubGlobal("localStorage", stubDeStorage(memoria));
    vi.stubGlobal("sessionStorage", stubDeStorage(memoriaDeSessao));
  });

  afterEach(() => {
    memoria.clear();
    vi.unstubAllGlobals();
  });

  it("update real: título honesto de atualização com tom de sucesso", () => {
    const d = descreveMotivoDeRecarga("atualizacao-aplicada");
    expect(d).toEqual({
      titulo: "Sistema Atualizado",
      descricao: "A loja foi atualizada para a versão mais recente.",
      tom: "success",
    });
  });

  it("erro de módulo recuperado: NÃO diz que atualizou — info, com o fato", () => {
    const d = descreveMotivoDeRecarga("recuperacao-erro-modulo");
    expect(d?.titulo).not.toBe("Sistema Atualizado");
    expect(d?.tom).toBe("info");
    expect(d?.descricao).toContain("Nenhuma versão nova foi instalada");
  });

  it("crash recuperado: warning, sem disfarce de atualização", () => {
    const d = descreveMotivoDeRecarga("recuperacao-crash");
    expect(d?.titulo).toBe("O aplicativo se recuperou");
    expect(d?.tom).toBe("warning");
    expect(d?.titulo).not.toBe("Sistema Atualizado");
  });

  it("sentinela reiniciou o app: info honesta", () => {
    const d = descreveMotivoDeRecarga("recuperacao-sentinela");
    expect(d?.tom).toBe("info");
    expect(d?.titulo).not.toBe("Sistema Atualizado");
  });

  it("legado 'Sistema atualizado e otimizado.' (era gravado só por update real) continua virando atualização", () => {
    const d = descreveMotivoDeRecarga("Sistema atualizado e otimizado.");
    expect(d?.tom).toBe("success");
    expect(d?.titulo).toBe("Sistema Atualizado");
  });

  it("legados de recuperação (texto cru pré-conserto) deixam de fingir atualização", () => {
    expect(
      descreveMotivoDeRecarga("Auto-recuperação (Erro de Módulo)")?.tom,
    ).toBe("info");
    expect(
      descreveMotivoDeRecarga("Failed to fetch dynamically imported module")
        ?.tom,
    ).toBe("info");
    expect(
      descreveMotivoDeRecarga("Fatal Crash: Cannot read properties of undef")
        ?.tom,
    ).toBe("warning");
    expect(
      descreveMotivoDeRecarga("Sentinel Recovery: Pulse loss (301234ms)")?.tom,
    ).toBe("info");
    // nenhum legado de recuperação vira "Sistema Atualizado"
    for (const legado of [
      "Auto-recuperação (Erro de Módulo)",
      "Failed to fetch dynamically imported module",
      "Fatal Crash: x",
      "Sentinel Recovery: Pulse loss (1ms)",
    ]) {
      expect(descreveMotivoDeRecarga(legado)?.titulo).not.toBe(
        "Sistema Atualizado",
      );
    }
  });

  it("motivo desconhecido: recarregado, sem inventar atualização", () => {
    const d = descreveMotivoDeRecarga("motivo-que-nao-existe");
    expect(d?.titulo).not.toBe("Sistema Atualizado");
    expect(d?.tom).toBe("info");
    expect(d?.descricao).toBe("motivo-que-nao-existe");
  });

  it("sem motivo gravado: nada a exibir", () => {
    expect(descreveMotivoDeRecarga(null)).toBeNull();
  });

  it("grava/limpa usa a chave do protocolo", () => {
    gravaMotivoDeRecarga("recuperacao-crash");
    expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBe(
      "recuperacao-crash",
    );
    limpaMotivoDeRecarga();
    expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBeNull();
  });

  // ── Peça 22/09: apply sem evidência não pode virar "Sistema Atualizado" ──

  it("atualizacao NÃO confirmada (apply pendurado/sem prova): neutro, sem inventar sucesso", () => {
    const d = descreveMotivoDeRecarga("atualizacao-nao-confirmada");
    expect(d?.titulo).not.toBe("Sistema Atualizado");
    expect(d?.tom).toBe("info");
    expect(d?.descricao).toContain("não houve confirmação");
  });

  it("evidência de build: origem DIFERENTE do build atual é a prova da troca — e a leitura consome", () => {
    gravaOrigemDeAtualizacao("1.5.0-sha.aaa1111");
    expect(atualizacaoTrocouDeBuild("1.5.1-sha.bbb2222")).toBe(true);
    // Consumida na leitura: sem origem nova, a próxima é false.
    expect(atualizacaoTrocouDeBuild("1.5.1-sha.bbb2222")).toBe(false);
  });

  it("evidência de build: MESMO build (purge que não curou, recarga de segurança) NÃO é atualização", () => {
    gravaOrigemDeAtualizacao("1.5.1-sha.aaa1111");
    expect(atualizacaoTrocouDeBuild("1.5.1-sha.aaa1111")).toBe(false);
  });

  it("evidência de build: sem origem gravada, sem evidência — false", () => {
    expect(atualizacaoTrocouDeBuild("1.5.1-sha.bbb2222")).toBe(false);
  });

  it("duas abas: localStorage é compartilhado, sessionStorage é POR ABA — o boot de B não consome a evidência de A", () => {
    // Achado 1 da revisão: em localStorage, qualquer aba que boota na janela
    // do apply consumia (e destruía) a evidência de quem aplicava — A
    // atualizava de verdade e recebia o neutro. Em sessionStorage isso não
    // existe: a evidência é da aba que aplicou.
    const sessaoA = stubDeStorage(new Map());
    const sessaoB = stubDeStorage(new Map());

    // Aba A começa o apply: origem na SESSÃO dela; o motivo nominal segue no
    // localStorage, que é o mesmo para as duas abas.
    vi.stubGlobal("sessionStorage", sessaoA);
    gravaOrigemDeAtualizacao("1.5.0-sha.aaa1111");
    gravaMotivoDeRecarga("atualizacao-aplicada");

    // Aba B boota no meio da janela: vê o localStorage de A...
    vi.stubGlobal("sessionStorage", sessaoB);
    expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBe(
      "atualizacao-aplicada",
    );
    // ...mas NÃO vê evidência nenhuma — e a leitura de B não pode remover a
    // de A (storages de sessão são independentes por aba).
    expect(atualizacaoTrocouDeBuild("1.5.1-sha.bbb2222")).toBe(false);

    // Aba A conclui o apply e recarrega: a sessão DELA sobreviveu ao boot de
    // B e ao reload — evidência intacta, consumida UMA vez.
    vi.stubGlobal("sessionStorage", sessaoA);
    expect(atualizacaoTrocouDeBuild("1.5.1-sha.bbb2222")).toBe(true);
    expect(atualizacaoTrocouDeBuild("1.5.1-sha.bbb2222")).toBe(false);
  });
  // ── Atualização única (16/10): a origem também diz DE ONDE veio ──────────

  describe("consumirOrigemDaAtualizacao — lê, limpa e devolve de onde veio", () => {
    it("origem diferente do build atual: trocou, e `de` é a versão de origem", () => {
      gravaOrigemDeAtualizacao("1.5.31-sha.aaa1111");
      expect(consumirOrigemDaAtualizacao("1.5.32-sha.bbb2222")).toEqual({
        trocouDeBuild: true,
        de: "1.5.31-sha.aaa1111",
        versaoEsperada: null,
      });
    });

    it("consome: a segunda leitura não encontra mais nada", () => {
      gravaOrigemDeAtualizacao("1.5.31-sha.aaa1111");
      consumirOrigemDaAtualizacao("1.5.32-sha.bbb2222");
      expect(consumirOrigemDaAtualizacao("1.5.32-sha.bbb2222")).toEqual({
        trocouDeBuild: false,
        de: null,
        versaoEsperada: null,
      });
      expect(sessionStorage.getItem(CHAVE_ORIGEM_DE_ATUALIZACAO)).toBeNull();
    });

    it("MESMO build (recarga que não curou): não trocou — sem sucesso inventado", () => {
      gravaOrigemDeAtualizacao("1.5.31-sha.aaa1111");
      expect(
        consumirOrigemDaAtualizacao("1.5.31-sha.aaa1111").trocouDeBuild,
      ).toBe(false);
    });

    it("sem origem gravada: sem evidência e `de` nulo", () => {
      expect(consumirOrigemDaAtualizacao("1.5.32-sha.bbb2222")).toEqual({
        trocouDeBuild: false,
        de: null,
        versaoEsperada: null,
      });
    });

    it("sessionStorage LANÇANDO: devolve 'não trocou' em vez de derrubar o boot", () => {
      vi.stubGlobal("sessionStorage", {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      });
      expect(consumirOrigemDaAtualizacao("1.5.32")).toEqual({
        trocouDeBuild: false,
        de: null,
        versaoEsperada: null,
      });
    });

    it("atualizacaoTrocouDeBuild continua igual (mesmo veredito, também consome)", () => {
      gravaOrigemDeAtualizacao("1.5.31-sha.aaa1111");
      expect(atualizacaoTrocouDeBuild("1.5.32-sha.bbb2222")).toBe(true);
      expect(sessionStorage.getItem(CHAVE_ORIGEM_DE_ATUALIZACAO)).toBeNull();
    });

    // ── A tentativa carrega a versão-alvo esperada (16/10) ─────────────────

    describe("versão esperada: o sucesso só vale se a que chegou serve à esperada", () => {
      it("chegou a versão esperada: trocou, com a esperada devolvida", () => {
        gravaOrigemDeAtualizacao("1.5.31-sha.aaa1111");
        gravaVersaoEsperadaDaAtualizacao("1.5.32");
        expect(consumirOrigemDaAtualizacao("1.5.32-sha.bbb2222")).toEqual({
          trocouDeBuild: true,
          de: "1.5.31-sha.aaa1111",
          versaoEsperada: "1.5.32",
        });
      });

      it("chegou uma versão MAIS NOVA que a esperada (deploy no meio do caminho): também é sucesso", () => {
        gravaOrigemDeAtualizacao("1.5.31-sha.aaa1111");
        gravaVersaoEsperadaDaAtualizacao("1.5.32");
        expect(
          consumirOrigemDaAtualizacao("1.5.33-sha.ccc3333").trocouDeBuild,
        ).toBe(true);
      });

      it("chegou build DIFERENTE mas de versão MENOR que a esperada: NÃO é sucesso (neutro, nunca 'Pronto')", () => {
        gravaOrigemDeAtualizacao("1.5.30-sha.aaa1111");
        gravaVersaoEsperadaDaAtualizacao("1.5.32");
        const r = consumirOrigemDaAtualizacao("1.5.31-sha.bbb2222");
        expect(r.trocouDeBuild).toBe(false);
        expect(r.de).toBe("1.5.30-sha.aaa1111");
      });

      it("chegou versão ilegível: NÃO é sucesso", () => {
        gravaOrigemDeAtualizacao("1.5.30-sha.aaa1111");
        gravaVersaoEsperadaDaAtualizacao("1.5.32");
        expect(consumirOrigemDaAtualizacao("dev").trocouDeBuild).toBe(false);
      });

      it("sem versão esperada gravada, vale só a troca de build (comportamento de sempre)", () => {
        gravaOrigemDeAtualizacao("1.5.30-sha.aaa1111");
        expect(
          consumirOrigemDaAtualizacao("1.5.31-sha.bbb2222").trocouDeBuild,
        ).toBe(true);
      });

      it("esperada ilegível não contradiz ninguém (nada a comparar)", () => {
        gravaOrigemDeAtualizacao("1.5.30-sha.aaa1111");
        gravaVersaoEsperadaDaAtualizacao("lixo");
        expect(
          consumirOrigemDaAtualizacao("1.5.31-sha.bbb2222").trocouDeBuild,
        ).toBe(true);
      });

      it("a leitura LIMPA as duas chaves (a esperada não vaza para o próximo boot)", () => {
        gravaOrigemDeAtualizacao("1.5.30-sha.aaa1111");
        gravaVersaoEsperadaDaAtualizacao("1.5.32");
        consumirOrigemDaAtualizacao("1.5.32-sha.bbb2222");
        expect(sessionStorage.getItem(CHAVE_ORIGEM_DE_ATUALIZACAO)).toBeNull();
        expect(
          sessionStorage.getItem(CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO),
        ).toBeNull();
        gravaOrigemDeAtualizacao("1.5.32-sha.bbb2222");
        expect(
          consumirOrigemDaAtualizacao("1.5.33-sha.ccc3333").trocouDeBuild,
        ).toBe(true);
      });

      it("esperada sem origem (o apply nunca partiu): sem evidência, e a esperada some", () => {
        gravaVersaoEsperadaDaAtualizacao("1.5.32");
        expect(consumirOrigemDaAtualizacao("1.5.32-sha.bbb2222")).toEqual({
          trocouDeBuild: false,
          de: null,
          versaoEsperada: "1.5.32",
        });
        expect(
          sessionStorage.getItem(CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO),
        ).toBeNull();
      });

      it("gravar esperada nula/vazia apaga a anterior; storage lançando não derruba", () => {
        gravaVersaoEsperadaDaAtualizacao("1.5.32");
        gravaVersaoEsperadaDaAtualizacao(null);
        expect(
          sessionStorage.getItem(CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO),
        ).toBeNull();
        vi.stubGlobal("sessionStorage", {
          getItem: () => {
            throw new Error("x");
          },
          setItem: () => {
            throw new Error("x");
          },
          removeItem: () => {
            throw new Error("x");
          },
        });
        expect(() => gravaVersaoEsperadaDaAtualizacao("1.5.32")).not.toThrow();
      });

      it("atualizacaoTrocouDeBuild herda a regra (o consumidor de hoje, o App, ganha a proteção)", () => {
        gravaOrigemDeAtualizacao("1.5.30-sha.aaa1111");
        gravaVersaoEsperadaDaAtualizacao("1.5.32");
        expect(atualizacaoTrocouDeBuild("1.5.31-sha.bbb2222")).toBe(false);
      });
    });
  });
});
