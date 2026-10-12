import { describe, expect, it } from "vitest";

import { LIMIAR_PADRAO_DE_ESTOQUE } from "@/utils/avisos-do-lojista";

// ── O "Estoque baixo" do Início usa o MESMO limiar do front ──
//
// Onda I do painel simples (I1): o cartão do Início
// (`painel_inicio()->'pendencias'->>'estoque_baixo'`) contava com limiar fixo
// 3 e por variação, enquanto o front (`precisaDeReposicao`), o sino e o KPI de
// `get_admin_analytics_v2` usam `COALESCE(estoque_minimo, 5)` sobre o estoque
// efetivo. A 20261212000000 alinhou o banco; este teste prende o limiar do
// SQL VIVO ao do front.
//
// Mesmo desenho do bloco de equivalência de
// dashboard-diz-o-que-falta-para-vender.test.tsx: NÃO ancora num nome de
// arquivo fixo — varre todas as migrations, fica com as que REDEFINEM
// `painel_inicio` e mede contra a de MAIOR carimbo (a viva, seja qual for).
describe("o limiar do Início é o mesmo do front", () => {
  const TODAS_AS_MIGRATIONS = import.meta.glob<string>(
    "/supabase/migrations/*.sql",
    { query: "?raw", import: "default", eager: true },
  );

  const REDEFINICOES = Object.entries(TODAS_AS_MIGRATIONS)
    .filter(([caminho]) => !caminho.includes("/rollback-manual-"))
    .filter(([, sql]) =>
      /CREATE OR REPLACE FUNCTION\s+public\.painel_inicio\(/.test(sql),
    )
    // Carimbo de 14 dígitos no começo do nome: ordem alfabética = cronológica
    // (a guarda abaixo confere o formato antes de confiar nisso).
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const CAMINHOS = REDEFINICOES.map(([caminho]) => caminho);
  const VIVA = REDEFINICOES.at(-1);
  const CAMINHO_DA_VIVA = VIVA?.[0] ?? "";
  const SQL_DA_VIVA = VIVA?.[1] ?? "";

  // O corpo de painel_inicio, do CREATE dela até o próximo CREATE OR REPLACE
  // FUNCTION (ou o fim do arquivo) — a viva pode redefinir outras funções.
  const INICIO_DO_CORPO = SQL_DA_VIVA.search(
    /CREATE OR REPLACE FUNCTION\s+public\.painel_inicio\(/,
  );
  const RESTO = INICIO_DO_CORPO < 0 ? "" : SQL_DA_VIVA.slice(INICIO_DO_CORPO);
  const FIM = RESTO.slice(1).search(/CREATE OR REPLACE FUNCTION/);
  const CORPO_DA_VIVA = FIM < 0 ? RESTO : RESTO.slice(0, FIM + 1);
  const TRECHO_DO_ESTOQUE_BAIXO = CORPO_DA_VIVA.slice(
    Math.max(0, CORPO_DA_VIVA.indexOf("'estoque_baixo'")),
    CORPO_DA_VIVA.indexOf("'serie_14d'"),
  );

  it("achou as redefinições de painel_inicio (a 20261178000000 que a criou, a 20261199000000 e a 20261212000000) — sem isso, tudo abaixo passaria por vacuidade", () => {
    for (const carimbo of [
      "20261178000000",
      "20261199000000",
      "20261212000000",
    ]) {
      expect(CAMINHOS.some((c) => c.includes(carimbo))).toBe(true);
    }
  });

  it("cada migration aceita começa com carimbo de exatamente 14 dígitos", () => {
    const foraDoPadrao = CAMINHOS.filter(
      (caminho) => !/^\d{14}_/.test(caminho.split("/").at(-1) ?? ""),
    );
    expect(foraDoPadrao).toEqual([]);
  });

  it("a viva NÃO é um arquivo de rollback", () => {
    expect(CAMINHO_DA_VIVA).not.toMatch(/rollback-manual/);
  });

  it("o trecho medido é o `estoque_baixo` de painel_inicio", () => {
    expect(CORPO_DA_VIVA).toMatch(
      /^CREATE OR REPLACE FUNCTION\s+public\.painel_inicio\(/,
    );
    expect(TRECHO_DO_ESTOQUE_BAIXO).toMatch(/^'estoque_baixo'/);
  });

  it("COALESCE(p.estoque_minimo, N) do SQL VIVO é o MESMO N de LIMIAR_PADRAO_DE_ESTOQUE — e é o único limiar do trecho", () => {
    const limiares = [
      ...TRECHO_DO_ESTOQUE_BAIXO.matchAll(
        /COALESCE\(p\.estoque_minimo,\s*(\d+)\)/g,
      ),
    ].map((m) => Number(m[1]));
    expect(
      limiares.length,
      `o literal COALESCE(p.estoque_minimo, N) sumiu ou mudou de forma na migration VIVA (${CAMINHO_DA_VIVA})`,
    ).toBeGreaterThan(0);
    expect(limiares.every((n) => n === LIMIAR_PADRAO_DE_ESTOQUE)).toBe(true);
  });

  it("o Início soma as variações ATIVAS (estoque efetivo), não decide por variação", () => {
    expect(TRECHO_DO_ESTOQUE_BAIXO).toMatch(
      /sum\(COALESCE\(pv\.stock_increment, 0\)\) FILTER \(WHERE pv\.active\)/,
    );
    expect(TRECHO_DO_ESTOQUE_BAIXO).not.toMatch(
      /COALESCE\(pv\.stock_increment, 0\) <= COALESCE\(p\.estoque_minimo/,
    );
  });
});
