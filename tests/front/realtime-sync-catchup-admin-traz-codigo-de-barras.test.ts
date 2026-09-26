import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C5.1 → realtimeSyncEngine-952 — a garantia mudou de mecanismo, o compromisso
 * não: o catch-up do ADMIN continua trazendo `codigo_barras` para o cofre.
 *
 * ANTES (C5.1): o ramo admin buscava detalhes na TABELA `produtos` com uma
 * LISTA EXPLÍCITA de colunas (nascida no laudo #2 do PR #395 para contornar o
 * SELECT negado de `custo`), e este teste travava `codigo, codigo_barras`
 * dentro da lista — coluna nova esquecida na lista era coluna que o PDV não
 * bipava até a próxima carga completa.
 *
 * AGORA (-952, frentes/pwa.json da passagem de 17/09): a lista foi APOSENTADA.
 * O ramo admin lê a MESMA VIEW do `fetchProducts` (`vw_produtos_admin`) com
 * `*, product_variants(*)` — um esquema só, do qual `codigo_barras` (e
 * qualquer coluna futura) participa sozinho. A prova PROFUNDA (a coluna
 * chegando viva ao cofre pelo mapper) é comportamental, em
 * tests/front/realtime-catchup-usa-o-mesmo-esquema-da-vitrine.test.ts; esta
 * aqui é a catraca estática: se alguém devolver uma lista de colunas escolhida
 * à mão ao catch-up de detalhes, ou trocar a view pela tabela, estes dois
 * regex falham antes de o defeito chegar ao PDV.
 *
 * `path.resolve` com `import.meta.dirname` de propósito: caminho ESTÁTICO aos
 * olhos do security/detect-non-literal-fs-filename, sem acordar warning novo.
 */
const texto = readFileSync(
  path.resolve(import.meta.dirname, "../../src/lib/realtimeSyncEngine.ts"),
  "utf8",
);

describe("catchUp admin (realtimeSyncEngine.ts) traz codigo_barras", () => {
  it("não existe mais lista de colunas escolhida a dedo no catch-up de detalhes", () => {
    // A assinatura da lista antiga: "codigo, codigo_barras" lado a lado. Se
    // este regex casar, alguém recriou a lista (e esqueceu a próxima coluna
    // nova do PDV nela).
    expect(texto).not.toMatch(/\bcodigo,\s*codigo_barras\b/);
  });

  it("o ramo admin busca os detalhes na vw_produtos_admin, a porta do fetchProducts", () => {
    const casamento = texto.match(
      /from\(\s*isAdmin\s*\?\s*"vw_produtos_admin"/,
    );
    expect(casamento).not.toBeNull();
  });
});
