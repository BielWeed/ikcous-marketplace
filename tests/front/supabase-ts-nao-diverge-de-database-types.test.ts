// TDD da tarefa supabase-1 (frente vitrine-e-banco): src/types/supabase.ts é
// uma cópia gerada por `supabase gen types` que parou no commit 984b0a5
// enquanto database.types.ts seguiu recebendo migration nova — 839 linhas de
// diferença (colunas como mp_public_key sumidas, tabelas de backup já
// aposentadas ainda listadas). A regra da casa (.claude/commands/nova-
// migration.md: "supabase.ts é cópia órfã e byte-a-byte idêntica ... não
// deixe divergir, zero importadores") só se sustenta se as duas metades
// forem verdade ao mesmo tempo. Este teste tranca as três pontas para a
// divergência não voltar:
//   1. o arquivo duplicado não existe mais — não há como ele divergir de
//      novo se não existe;
//   2. nenhuma fonte de src/ importa dele (o único importador vivo era
//      useCoupons.ts:5, que devia importar de @/types/database.types);
//   3. knip.json parou de proteger o arquivo morto na lista de ignorados —
//      sem essa entrada, o knip volta a poder acusar o arquivo se ele
//      reaparecer por engano (ex.: alguém rodar `supabase gen types` com a
//      flag antiga de novo).
//
// Lê o disco em vez de importar módulo: importar `@/types/supabase` faria o
// teste EXIGIR o arquivo que ele deveria provar ausente, e um `import type`
// de um arquivo inexistente não quebra em runtime (tipos somem na
// compilação) — só um `existsSync`/glob prova a ausência de verdade.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const ARQUIVO_DIVERGENTE = path.join(RAIZ, "src/types/supabase.ts");

describe("supabase-1: src/types/supabase.ts não volta a divergir de database.types.ts", () => {
  it("o arquivo de tipos duplicado foi apagado", () => {
    expect(existsSync(ARQUIVO_DIVERGENTE)).toBe(false);
  });

  it("nenhuma fonte de src/ importa de @/types/supabase", () => {
    const FONTES = import.meta.glob<string>("/src/**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    // Controle de glob não-vazio (convenção da casa, ver
    // guarda-de-cor-sai-junto-com-a-escrita.test.ts): verde com zero
    // arquivos varridos não é evidência de nada.
    expect(Object.keys(FONTES).length).toBeGreaterThan(150);
    const importadores = Object.entries(FONTES)
      .filter(([, texto]) => /@\/types\/supabase["']/.test(texto))
      .map(([caminho]) => caminho);
    expect(importadores).toEqual([]);
  });

  it("knip.json não ignora mais o arquivo divergente", () => {
    const knip = JSON.parse(
      readFileSync(path.join(RAIZ, "knip.json"), "utf-8"),
    ) as { ignore?: string[] };
    expect(knip.ignore ?? []).not.toContain("src/types/supabase.ts");
  });
});
