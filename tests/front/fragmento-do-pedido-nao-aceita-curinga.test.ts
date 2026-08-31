// Laudo caça-bugs do molde (30-31/08/2026), achado A4: o fragmento de
// `get_orders_by_whatsapp_v3` entrava cru em `LIKE '%' || fragmento` —
// quatro underscores casam qualquer uuid e devolvem o histórico inteiro do
// usuário. A migration 20261035000000 recusa o curinga (`%`, `_`, `\`)
// ANTES da busca, e NÃO copia a whitelist do OTP v2 de propósito: o mesmo
// parâmetro também casa `tracking_code`, que tem letras fora de a-f.
//
// Roda no CI, que NAO tem banco: a ancora e' o arquivo de migration em
// disco, nunca `pg_get_functiondef`. `import.meta.glob` com `?raw` le os
// arquivos sem API de Node nenhuma (mesmo padrao de
// `recusa-do-pedido-ancora-nas-migrations.test.ts` — node:fs aqui derruba
// o typecheck E o lint:ratchet; ver o comentario de la).
import { describe, expect, it } from "vitest";

const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ARQUIVO = "/supabase/migrations/20261035000000_fragmento_do_pedido_nao_aceita_curinga.sql";

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

const migration = ler("20261035000000_fragmento_do_pedido_nao_aceita_curinga.sql");
const rollback = ler("rollback-manual-20261035000000_fragmento_do_pedido_nao_aceita_curinga.sql");

describe("o fragmento do pedido não aceita curinga (20261035000000)", () => {
  // As travas de vacuidade (mesma receita do teste-âncora de recusa): glob
  // que casa o diretório inteiro e corpus que não está vazio.
  it("o glob casou o diretório inteiro de migrations", () => {
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(20);
  });

  it("o corpus lido não está vazio", () => {
    expect(sql.length).toBeGreaterThan(100000);
  });

  it("a migration existe no disco", () => {
    expect(migration, `sumiu: ${ARQUIVO}`).toBeDefined();
  });

  it("recria a função com a MESMA assinatura (sem sobrecarga silenciosa)", () => {
    expect(migration).toContain(
      'get_orders_by_whatsapp_v3("p_phone_number" "text", "p_customer_email" "text", "p_order_fragment" "text") RETURNS SETOF "jsonb"',
    );
    expect(migration).toContain("CREATE OR REPLACE FUNCTION");
  });

  it("recusa os três curingas de LIKE antes da busca", () => {
    // A classe [%_\\] no SQL (duas barras no fonte = uma barra no regex).
    expect(migration).toContain("IF p_order_fragment ~ '[%_\\\\]' THEN");
    expect(migration).toContain("'Fragmento inválido.'");
  });

  it("a linha vulnerável continua existindo — a guarda é que chegou antes dela", () => {
    // Se alguém "consertar" removendo o LIKE do tracking_code, este teste
    // acusa: a promessa da migration é GUARDA ANTES, não remoção silenciosa
    // da busca por rastreio.
    expect(migration).toContain(
      "o.id::text LIKE '%' || p_order_fragment OR o.tracking_code LIKE '%' || p_order_fragment",
    );
  });

  it("não tem BEGIN/COMMIT fora de comentário (o ROLLBACK da prova tem que valer)", () => {
    const semComentarios = migration.split("\n")
      .filter((linha) => !linha.trim().startsWith("--"))
      .join("\n");
    expect(semComentarios).not.toMatch(/\b(BEGIN|COMMIT)\s*;/);
  });

  it("o rollback devolve o corpo SEM a guarda — e confessa isso no cabeçalho", () => {
    expect(rollback, "rollback versionado sumiu").toBeDefined();
    expect(rollback).toContain("CREATE OR REPLACE FUNCTION");
    expect(rollback).toContain("'Fragmento muito curto.");
    expect(rollback).not.toContain("[%_\\\\]");
    expect(rollback).toMatch(/REABRE o buraco/);
  });
});
