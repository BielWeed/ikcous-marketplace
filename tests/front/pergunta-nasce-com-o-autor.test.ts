// Laudo caça-bugs do molde (30-31/08/2026), achado A5: a
// `questions_insert_policy` só exigia login — não amarrava
// `questions.user_id` ao chamador, então qualquer usuário logado podia
// inserir pergunta pública assinada com o user_id de OUTRA pessoa. É a
// mesma classe dos fabricáveis já fechados (verified em 20261030000000,
// status em 20261031000000). A 20261036000000 amarra o autor.
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

const ARQUIVO =
  "/supabase/migrations/20261036000000_pergunta_nasce_com_o_autor.sql";

const sql = Object.values(MIGRATIONS).join("\n");

// Acesso por CONTEUDO, nao por indice: MIGRATIONS com chave em variavel
// dispara security/detect-object-injection (+31 warnings derrubariam o
// teto do lint-ratchet na primeira rodada). O padrao da casa
// (guarda-de-cor-sai-junto-com-a-escrita.test.ts) e iterar Object.entries
// com desestruturacao - mesma coisa aqui, embrulhada em helper.
const ler = (sufixo: string): string => {
  const par = Object.entries(MIGRATIONS).find(([caminho]) =>
    caminho.endsWith(sufixo),
  );
  return par ? par[1] : "";
};

const migration = ler("20261036000000_pergunta_nasce_com_o_autor.sql");
const rollback = ler(
  "rollback-manual-20261036000000_pergunta_nasce_com_o_autor.sql",
);

describe("a pergunta nasce assinada pelo próprio autor (20261036000000)", () => {
  it("o glob casou o diretório inteiro de migrations", () => {
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(20);
  });

  it("o corpus lido não está vazio", () => {
    expect(sql.length).toBeGreaterThan(100000);
  });

  it("a migration existe no disco", () => {
    expect(migration, `sumiu: ${ARQUIVO}`).toBeDefined();
  });

  it("derruba a policy velha antes de recriar (idempotente)", () => {
    expect(migration).toContain(
      "DROP POLICY IF EXISTS questions_insert_policy",
    );
    expect(migration).toContain("CREATE POLICY questions_insert_policy");
  });

  it("amarra user_id ao chamador — a regra inteira da correção", () => {
    expect(migration).toContain("user_id = (SELECT auth.uid())");
  });

  it("continua valendo só para authenticated (anon nunca escreveu aqui)", () => {
    expect(migration).toContain("FOR INSERT TO authenticated");
  });

  it("não tem BEGIN/COMMIT fora de comentário", () => {
    const semComentarios = migration
      .split("\n")
      .filter((linha) => !linha.trim().startsWith("--"))
      .join("\n");
    expect(semComentarios).not.toMatch(/\b(BEGIN|COMMIT)\s*;/);
  });

  it("o rollback devolve a policy do baseline e confessa o buraco que reabre", () => {
    expect(rollback, "rollback versionado sumiu").toBeDefined();
    expect(rollback).toContain("CREATE POLICY questions_insert_policy");
    expect(rollback).toContain("IS NOT NULL");
    expect(rollback).not.toContain("user_id = (SELECT auth.uid())");
    expect(rollback).toMatch(/REABRE o buraco/);
  });
});
