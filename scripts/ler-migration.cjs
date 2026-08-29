/**
 * O caminho (e o conteúdo) de uma migration, resolvido nos DOIS andares que o
 * repositório tem desde o passo 0 (PR #320): a raiz `supabase/migrations/`
 * para as vivas e `supabase/migrations/_arquivadas/` para as anteriores à
 * baseline.
 *
 * POR QUE EXISTE: o arquivamento de 28/08/2026 quebrou em silêncio a família
 * de scripts que montava o caminho só da raiz — as ferramentas de PROVA de
 * migration, justamente as que existem para rodar antes de aplicar. Um
 * resolvedor só, N consumidores: consertar o mesmo bug seis vezes é o caminho
 * para o sétimo nascer quebrado.
 *
 * Falha ALTA de propósito: `resolverCaminhoMigration` devolve null em vez de
 * adivinhar, e `lerMigration` lança nomeando os DOIS andares. Nunca invente
 * um terceiro andar aqui sem registrar na mesa.
 */

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function resolverCaminhoMigration(nomeArquivo) {
  const andares = [
    path.join(PROJECT_ROOT, "supabase", "migrations", nomeArquivo),
    path.join(
      PROJECT_ROOT,
      "supabase",
      "migrations",
      "_arquivadas",
      nomeArquivo,
    ),
  ];
  for (const caminho of andares) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(caminho)) return caminho;
  }
  return null;
}

function lerMigration(nomeArquivo) {
  const caminho = resolverCaminhoMigration(nomeArquivo);
  if (!caminho) {
    throw new Error(
      `${nomeArquivo}: nao encontrada nem em supabase/migrations/ nem em supabase/migrations/_arquivadas/`,
    );
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(caminho, "utf8");
}

module.exports = { PROJECT_ROOT, resolverCaminhoMigration, lerMigration };
