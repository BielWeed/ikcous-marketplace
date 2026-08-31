// Laudo caça-bugs do molde (30-31/08/2026), achado C3: a noite dos 6 PRs
// matou o WhatsApp de fábrica na RPC (20261033000000) e no dado, mas a
// COLUNA `store_config.whatsapp_number` continuava com
// DEFAULT '5534999999999' — qualquer INSERT que omitisse a coluna
// replantaria o número inventado. A 20261037000000 dá o DROP DEFAULT que
// ficou de fora (o passo 1 do molde de 4 passos da casa).
//
// Roda no CI, que NAO tem banco: a ancora e' o arquivo de migration em
// disco (`import.meta.glob` com `?raw`, sem API de Node — ver o comentario
// de `recusa-do-pedido-ancora-nas-migrations.test.ts`).
import { describe, expect, it } from "vitest";

const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ARQUIVO = "/supabase/migrations/20261037000000_a_fabrica_do_whatsapp_morre_na_coluna.sql";

const sql = Object.values(MIGRATIONS).join("\n");

// Acesso por CONTEUDO, nao por indice: MIGRATIONS com chave em variavel
// dispara security/detect-object-injection (+31 warnings derrubariam o
// teto do lint-ratchet na primeira rodada). O padrao da casa
// (guarda-de-cor-sai-junto-com-a-escrita.test.ts) e iterar Object.entries
// com desestruturacao - mesma coisa aqui, embrulhada em helper.
const ler = (sufixo: string): string => {
  const par = Object.entries(MIGRATIONS).find(([caminho]) => caminho.endsWith(sufixo));
  return par ? par[1] : "";
};

const migration = ler("20261037000000_a_fabrica_do_whatsapp_morre_na_coluna.sql");
const rollback = ler("rollback-manual-20261037000000_a_fabrica_do_whatsapp_morre_na_coluna.sql");

describe("a fábrica do WhatsApp morre na coluna (20261037000000)", () => {
  it("o glob casou o diretório inteiro de migrations", () => {
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(20);
  });

  it("o corpus lido não está vazio", () => {
    expect(sql.length).toBeGreaterThan(100000);
  });

  it("a migration existe no disco e derruba SÓ o default do whatsapp", () => {
    expect(migration, `sumiu: ${ARQUIVO}`).toBeDefined();
    expect(migration).toContain(
      "ALTER TABLE public.store_config ALTER COLUMN whatsapp_number DROP DEFAULT;",
    );
    // O default da coluna business_hours já foi derrubado pela
    // 20261029000000 — uma segunda linha aqui não erraria o banco (DROP sem
    // default é no-op), mas desmentiria o cabeçalho da própria migration.
    // A promessa deste arquivo é UMA coluna.
    expect(migration).not.toMatch(/^\s*ALTER TABLE public\.store_config ALTER COLUMN business_hours DROP DEFAULT;/m);
  });

  it("não toca em linha de dado nenhuma (só metadado da coluna)", () => {
    const semComentarios = migration.split("\n")
      .filter((linha) => !linha.trim().startsWith("--"))
      .join("\n");
    expect(semComentarios).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/);
  });

  it("não tem BEGIN/COMMIT fora de comentário", () => {
    const semComentarios = migration.split("\n")
      .filter((linha) => !linha.trim().startsWith("--"))
      .join("\n");
    expect(semComentarios).not.toMatch(/\b(BEGIN|COMMIT)\s*;/);
  });

  it("o rollback replanta o default de fábrica — e confessa isso", () => {
    expect(rollback, "rollback versionado sumiu").toBeDefined();
    expect(rollback).toContain(
      "ALTER COLUMN whatsapp_number SET DEFAULT '5534999999999'::text",
    );
    expect(rollback).toMatch(/REPLANTA o default de fábrica/);
  });
});
