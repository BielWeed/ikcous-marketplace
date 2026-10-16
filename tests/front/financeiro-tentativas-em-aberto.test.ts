// @vitest-environment jsdom
// A chave de uma tentativa sem resposta sobrevive a recarregar a página
// (sessionStorage) e não guarda o conteúdo do lançamento em texto puro.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MODULO = "@/components/admin/financeiro/tentativasEmAberto";
const CONTEUDO = JSON.stringify({ descricao: "Aluguel segredo", valor: 120 });

describe("tentativas em aberto do lançamento", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("recarregar a página (módulo novo) devolve a mesma chave para o mesmo conteúdo", async () => {
    const antes = await import(MODULO);
    antes.guardarChaveEmAberto(CONTEUDO, "chave-1");
    vi.resetModules(); // equivale a recarregar: a memória do módulo some
    const depois = await import(MODULO);
    expect(depois.chaveEmAbertoDoConteudo(CONTEUDO)).toBe("chave-1");
    expect(depois.chaveEmAbertoDoConteudo(`${CONTEUDO} `)).toBeNull();
  });

  it("não grava descrição nem valor em texto puro", async () => {
    const m = await import(MODULO);
    m.guardarChaveEmAberto(CONTEUDO, "chave-1");
    const bruto = JSON.stringify({ ...sessionStorage });
    expect(bruto).not.toContain("Aluguel");
    expect(bruto).not.toContain("120");
  });

  it("sucesso esquece a chave, inclusive depois de recarregar", async () => {
    const m = await import(MODULO);
    m.guardarChaveEmAberto(CONTEUDO, "chave-1");
    m.esquecerChaveEmAberto(CONTEUDO);
    vi.resetModules();
    const depois = await import(MODULO);
    expect(depois.chaveEmAbertoDoConteudo(CONTEUDO)).toBeNull();
  });

  it("vence em 10 minutos", async () => {
    vi.useFakeTimers();
    const m = await import(MODULO);
    m.guardarChaveEmAberto(CONTEUDO, "chave-1");
    vi.advanceTimersByTime(10 * 60_000 - 1);
    expect(m.chaveEmAbertoDoConteudo(CONTEUDO)).toBe("chave-1");
    vi.advanceTimersByTime(2);
    expect(m.chaveEmAbertoDoConteudo(CONTEUDO)).toBeNull();
  });

  it("sem sessionStorage funciona só pela memória do módulo", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const m = await import(MODULO);
    m.guardarChaveEmAberto(CONTEUDO, "chave-1");
    expect(m.chaveEmAbertoDoConteudo(CONTEUDO)).toBe("chave-1");
  });

  it("registro corrompido no armazenamento é ignorado", async () => {
    sessionStorage.setItem("fin-lancamento-tentativas-em-aberto", "{nao-json");
    const m = await import(MODULO);
    expect(m.chaveEmAbertoDoConteudo(CONTEUDO)).toBeNull();
  });
});
