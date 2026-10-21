// O gatilho da 20261347000000 recusa o MESMO codigo de barras em produto e variacao com 23505. A lojista ja
// le uma frase propria para isso (mensagemAmigavelErroProduto reconhece 23505 + "codigo_barras"). Esta prova
// segura o contrato nos dois lados: o erro que o banco levanta (lido do proprio SQL) tem a forma que a
// tradutora reconhece, e a tradutora devolve a frase amigavel -- nunca o texto cru nem o generico.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { mensagemAmigavelErroProduto } from "@/hooks/useProducts";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do proprio teste.
const SQL = readFileSync(
  new URL(
    "../../supabase/migrations/20261347000000_o_codigo_de_barras_nao_repete_entre_produto_e_variacao.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/\r/g, "");

const FRASE_DA_LOJISTA =
  "Este código de barras já está em outro produto ou variação.";

describe("o 23505 do gatilho de codigo de barras chega a lojista em portugues claro", () => {
  it("o SQL levanta 23505 com a frase e com o detalhe que cita codigo_barras, nas duas funcoes", () => {
    const raises = SQL.split("RAISE EXCEPTION 'Este código de barras").slice(1);
    expect(raises).toHaveLength(2);
    for (const r of raises) {
      expect(r).toContain("já está em uso por outro produto ou variação.'");
      expect(r).toContain("ERRCODE = '23505'");
      expect(r).toMatch(/DETAIL = 'Key \(codigo_barras\)=\('/);
    }
  });

  it.each([
    ["variacao contra produto", "ja esta num produto (produtos)."],
    ["produto contra variacao", "ja esta numa variacao (product_variants)."],
  ])("traduz o erro como o PostgREST o entrega (%s)", (_rotulo, fim) => {
    const erroDoPostgrest = {
      code: "23505",
      message:
        "Este código de barras já está em uso por outro produto ou variação.",
      details: `Key (codigo_barras)=(7891000000011) ${fim}`,
      hint: "Use outro codigo.",
    };
    for (const acao of ["cadastrar", "atualizar"] as const) {
      expect(mensagemAmigavelErroProduto(erroDoPostgrest, acao)).toBe(
        FRASE_DA_LOJISTA,
      );
    }
  });

  it("23505 de OUTRA coluna continua sem essa frase (nao rouba o SKU nem o generico)", () => {
    const outro = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "produtos_pkey"',
      details: "Key (id)=(1) already exists.",
    };
    expect(mensagemAmigavelErroProduto(outro, "cadastrar")).not.toBe(
      FRASE_DA_LOJISTA,
    );
  });
});
