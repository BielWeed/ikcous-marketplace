import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAVE_MOTIVO_DE_RECARGA,
  atualizacaoTrocouDeBuild,
  descreveMotivoDeRecarga,
  gravaMotivoDeRecarga,
  gravaOrigemDeAtualizacao,
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
});
