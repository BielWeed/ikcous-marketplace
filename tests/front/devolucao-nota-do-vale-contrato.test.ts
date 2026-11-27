// O app não emite vale-troca (a loja cria o vale fora do app), mas
// `admin_devolucao_concluir` grava "Vale-troca emitido" no histórico da
// devolução. O painel troca essa frase em `notaDoEventoParaLoja` — e a troca
// só acontece se o texto do banco for EXATAMENTE o da constante. Este teste
// prende os dois: se uma migration nova recriar a função com outra frase, ele
// fica vermelho antes de o painel voltar a dizer "emitido" em silêncio.
//
// Roda no CI, que NAO tem banco: a ancora e' o arquivo de migration em disco,
// lido por `import.meta.glob` com `?raw` (sem API de Node — ver o comentario
// de `recusa-do-pedido-ancora-nas-migrations.test.ts`).
import { describe, expect, it } from "vitest";

import { NOTA_VALE_GRAVADA_PELO_BANCO } from "@/lib/devolucao";

const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const RECRIA_A_FUNCAO =
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(public\.)?admin_devolucao_concluir\s*\(/i;

// Rollback não conta: ele desfaz, não é o corpo que fica no ar. Nome do
// arquivo começa pela versão, então a ordem alfabética é a ordem de aplicação.
const queRecriam = Object.entries(MIGRATIONS)
  .filter(([caminho]) => !caminho.includes("/rollback-"))
  .filter(([, sql]) => RECRIA_A_FUNCAO.test(sql))
  .sort(([a], [b]) => a.localeCompare(b));

describe("contrato: a frase do vale-troca que o banco grava", () => {
  it("o glob casou o diretório de migrations e achou quem recria a função", () => {
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(20);
    expect(queRecriam.length).toBeGreaterThan(0);
  });

  it("a migration mais recente que recria admin_devolucao_concluir grava a frase da constante", () => {
    const [caminho, sql] = queRecriam[queRecriam.length - 1];
    expect(
      sql,
      `${caminho}: mudou a frase no banco — reveja notaDoEventoParaLoja`,
    ).toContain(`ELSE '${NOTA_VALE_GRAVADA_PELO_BANCO}'`);
  });
});
