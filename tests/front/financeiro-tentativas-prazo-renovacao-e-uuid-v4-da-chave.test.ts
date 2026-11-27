// @vitest-environment jsdom
// Duas pontas soltas das chaves de tentativa do Financeiro (as que impedem
// lançar duas vezes o mesmo dinheiro quando a resposta se perde), achadas pela
// caça por mutação:
//  - `tentativasEmAberto`: o prazo de 10 minutos valia "até 10 min incluso" e
//    ninguém testava o minuto exato; guardar de novo a mesma tentativa deve
//    RENOVAR o prazo e trocar a chave (o teste antigo só guardava uma vez);
//    `esquecerTodasAsChavesEmAberto` não tinha teste algum.
//  - `tentativasDoCaixa`: o valor guardado só é reaproveitado se for UUID v4
//    de verdade (versão 4, variante 8/9/a/b); a validação aceitava qualquer
//    UUID e nenhum teste usava um que não fosse v4.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chaveDaTentativaDoCaixa } from "@/components/admin/financeiro/tentativasDoCaixa";
import {
  chaveEmAbertoDoConteudo,
  esquecerChaveEmAberto,
  esquecerTodasAsChavesEmAberto,
  guardarChaveEmAberto,
} from "@/components/admin/financeiro/tentativasEmAberto";

const DEZ_MINUTOS = 10 * 60_000;
const AGORA = 1_800_000_000_000;
const ARMAZEM = "fin-lancamento-tentativas-em-aberto";
const A = JSON.stringify({ descricao: "Aluguel", valor: 120 });
const B = JSON.stringify({ descricao: "Internet", valor: 99 });
const DONO = "8a1f0c2e-2222-4222-8222-000000000002";

describe("tentativas em aberto do lançamento: prazo e renovação", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no minuto 10 exato a chave ainda vale; um milissegundo depois, não", () => {
    guardarChaveEmAberto(DONO, A, "chave-1");
    vi.setSystemTime(AGORA + DEZ_MINUTOS);
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBe("chave-1");
    vi.setSystemTime(AGORA + DEZ_MINUTOS + 1);
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBeNull();
  });

  it("guardar de novo a mesma tentativa renova o prazo de 10 minutos", () => {
    guardarChaveEmAberto(DONO, A, "chave-1");
    vi.setSystemTime(AGORA + 9 * 60_000);
    guardarChaveEmAberto(DONO, A, "chave-1");
    // 18 minutos depois do primeiro registro, 9 depois do segundo: vale.
    vi.setSystemTime(AGORA + 18 * 60_000);
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBe("chave-1");
    // 10 min e 1 ms depois do segundo registro: venceu.
    vi.setSystemTime(AGORA + 9 * 60_000 + DEZ_MINUTOS + 1);
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBeNull();
  });

  it("guardar outra chave para o mesmo conteúdo troca a chave guardada", () => {
    guardarChaveEmAberto(DONO, A, "chave-1");
    guardarChaveEmAberto(DONO, A, "chave-2");
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBe("chave-2");
  });

  it("conteúdo vencido já guardado volta a valer se for guardado de novo", () => {
    guardarChaveEmAberto(DONO, A, "chave-1");
    vi.setSystemTime(AGORA + DEZ_MINUTOS + 1);
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBeNull();
    guardarChaveEmAberto(DONO, A, "chave-3");
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBe("chave-3");
  });

  it("esquecer um conteúdo não apaga a chave de outro", () => {
    guardarChaveEmAberto(DONO, A, "chave-a");
    guardarChaveEmAberto(DONO, B, "chave-b");
    esquecerChaveEmAberto(DONO, A);
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBeNull();
    expect(chaveEmAbertoDoConteudo(DONO, B)).toBe("chave-b");
  });

  it("esquecer um conteúdo que nunca foi guardado não quebra nem apaga os outros", () => {
    guardarChaveEmAberto(DONO, B, "chave-b");
    expect(() => esquecerChaveEmAberto(DONO, A)).not.toThrow();
    expect(chaveEmAbertoDoConteudo(DONO, B)).toBe("chave-b");
  });

  it("esquecer todas limpa todos os conteúdos de uma vez, e guardar de novo depois funciona", () => {
    guardarChaveEmAberto(DONO, A, "chave-a");
    guardarChaveEmAberto(DONO, B, "chave-b");
    esquecerTodasAsChavesEmAberto();
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBeNull();
    expect(chaveEmAbertoDoConteudo(DONO, B)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(ARMAZEM) ?? "null")).toEqual({});
    guardarChaveEmAberto(DONO, A, "chave-nova");
    expect(chaveEmAbertoDoConteudo(DONO, A)).toBe("chave-nova");
  });

  it("esquecer todas sem nada guardado não quebra", () => {
    expect(() => esquecerTodasAsChavesEmAberto()).not.toThrow();
  });
});

describe("chaveDaTentativaDoCaixa: só reaproveita o que é UUID v4 de verdade", () => {
  const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const endereco = `ikcous_fin_caixa_tentativa:${JSON.stringify(["ana", "sess-1", "sangria"])}`;

  beforeEach(() => localStorage.clear());

  it.each([
    ["versão 1 (não é v4)", "11111111-1111-1111-8111-111111111111"],
    ["versão 5 (não é v4)", "11111111-1111-5111-8111-111111111111"],
    ["variante c (fora de 8/9/a/b)", "11111111-1111-4111-c111-111111111111"],
    ["variante 7 (fora de 8/9/a/b)", "11111111-1111-4111-7111-111111111111"],
    ["curto demais", "11111111-1111-4111-8111-11111111111"],
    ["letra fora de hexadecimal", "1111111g-1111-4111-8111-111111111111"],
  ])("guardado %s é descartado e trocado por um v4 válido", (_nome, ruim) => {
    localStorage.setItem(endereco, ruim);
    const chave = chaveDaTentativaDoCaixa("ana", "sess-1", "sangria");
    expect(chave).not.toBe(ruim);
    expect(chave).toMatch(UUID_V4);
    // O que ficou guardado é a chave nova: a próxima chamada devolve a mesma.
    expect(localStorage.getItem(endereco)).toBe(chave);
    expect(chaveDaTentativaDoCaixa("ana", "sess-1", "sangria")).toBe(chave);
  });

  it.each([
    "11111111-1111-4111-8111-111111111111",
    "11111111-1111-4111-9111-111111111111",
    "11111111-1111-4111-a111-111111111111",
    "11111111-1111-4111-b111-111111111111",
    "ABCDEF12-1111-4111-B111-ABCDEF123456",
  ])("v4 válido %s guardado antes é reaproveitado, sem trocar", (valido) => {
    localStorage.setItem(endereco, valido);
    expect(chaveDaTentativaDoCaixa("ana", "sess-1", "sangria")).toBe(valido);
    expect(localStorage.getItem(endereco)).toBe(valido);
  });
});
