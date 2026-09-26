// O select de forma do lançamento manual (FORMAS_DO_LANCAMENTO) tem de caber
// no CHECK de fin_lancamentos.forma_pagamento — senão "Dinheiro" salva com
// 23514 no banco e a lojista vê só "não foi possível salvar". A âncora é a
// própria migration, não a memória de quem escreveu a tela.
//
// `import.meta.glob(..., '?raw')` em vez de `node:fs` pelo mesmo motivo de
// tests/front/deployment-explica-as-duas-origens-de-credencial.test.ts.
import { describe, expect, it } from "vitest";

import { FORMAS_DO_LANCAMENTO } from "../../src/lib/financeiro";

const MIGRATIONS = import.meta.glob<string>(
  "/supabase/migrations/20261177000000_o_financeiro_da_loja_nasce.sql",
  { query: "?raw", import: "default", eager: true },
);

function formasDoCheck(): string[] {
  const sql = Object.values(MIGRATIONS)[0] ?? "";
  const trecho = sql.match(
    /forma_pagamento IS NULL OR forma_pagamento IN \(([^)]*)\)/,
  );
  if (!trecho?.[1]) return [];
  return [...trecho[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? "");
}

describe("forma do lançamento manual × CHECK do banco", () => {
  it("acha o CHECK na migration", () => {
    expect(formasDoCheck().length).toBeGreaterThan(0);
  });

  it("toda forma oferecida na tela passa no CHECK", () => {
    const aceitas = new Set(formasDoCheck());
    for (const forma of FORMAS_DO_LANCAMENTO) {
      expect(aceitas.has(forma), forma).toBe(true);
    }
  });
});
