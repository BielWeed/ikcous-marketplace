// @ts-nocheck
// Texto, hashes e fiação do lote; comportamento (papéis reais, RLS, mutantes) fica na prova viva PG17.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const NOME = "20261247000000_a_nota_interna_do_pedido_nao_chega_a_cliente.sql";
const TABELA = "marketplace_order_internal_notes";
const ler = (n) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${n}`, import.meta.url),
  ).replace(/\r/g, "");
const arquivo = (n) =>
  Deno.readTextFileSync(new URL(`../${n}`, import.meta.url)).replace(/\r/g, "");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const destrutivo = ler(`rollback-manual-destrutivo-${NOME}`);
const md5 = (s) => createHash("md5").update(s).digest("hex");
// Só tira as linhas de comentário: removerRuido também apaga o texto entre aspas, que aqui é o que se confere.
const sql = (s) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

Deno.test("247: sem controle de transação; trava de tempo; nada que apague ou reescreva dado existente", () => {
  for (const s of [migration, rollback, destrutivo]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(s)).achados, []);
    assert(s.includes("SET LOCAL lock_timeout = '5s'"));
    assert(s.includes("SET LOCAL statement_timeout = '30s'"));
  }
  const m = sql(migration);
  // Aditiva: nenhuma instrução da migration lê, copia, atualiza ou apaga linha de pedido/nota.
  assert(!/\bUPDATE\s+public\./i.test(m));
  assert(!/\bDELETE\s+FROM\b/i.test(m));
  assert(!/\bINSERT\s+INTO\b/i.test(m));
  assert(!/\bDROP\s+TABLE\b/i.test(m));
  assert(!/\bmarketplace_orders\s+(ADD|DROP|ALTER)/i.test(m));
  assert(!/\bnotes\b\s*=/.test(m), "a coluna notes não pode ser tocada");
  assert(
    !/DROP\s+TABLE/i.test(sql(rollback)),
    "o rollback comum preserva a tabela",
  );
  assert(!/DELETE\s+FROM/i.test(sql(rollback)));
});

Deno.test("247: a política usa a porta feita para política (rls_admin_atual), nunca is_admin()/is_admin_atual()", () => {
  const m = sql(migration);
  const politica = m.match(/CREATE POLICY[\s\S]*?;/)[0];
  assert(politica.includes("FOR ALL TO authenticated"));
  assert(
    politica.includes("USING ((SELECT public.rls_admin_atual()))") &&
      politica.includes("WITH CHECK ((SELECT public.rls_admin_atual()))"),
  );
  assert(!/is_admin\s*\(/.test(politica));
  assert.equal((m.match(/CREATE POLICY/g) || []).length, 1);
  assert(!/FOR (SELECT|INSERT|UPDATE|DELETE)\b/.test(politica));
  assert(!/TO (public|anon|service_role)/i.test(politica));
});

Deno.test("247: tabela, RLS, ACL explícita e gatilho do carimbo", () => {
  const m = sql(migration);
  assert(m.includes(`CREATE TABLE IF NOT EXISTS public.${TABELA}`));
  assert(
    m.includes(
      "order_id uuid PRIMARY KEY REFERENCES public.marketplace_orders(id) ON DELETE CASCADE",
    ),
  );
  assert(m.includes("note text NOT NULL"));
  assert(m.includes("updated_at timestamptz NOT NULL DEFAULT now()"));
  assert(m.includes("updated_by uuid DEFAULT auth.uid()"));
  assert(
    !/REFERENCES\s+auth\./i.test(m),
    "updated_by não pode ter FK para auth.users",
  );
  assert(m.includes("CHECK (note ~ '[^[:space:]]' AND length(note) <= 2000)"));
  assert(m.includes(`ALTER TABLE public.${TABELA} ENABLE ROW LEVEL SECURITY`));
  // REVOKE explícito de PUBLIC e anon ANTES do GRANT ao authenticated.
  const rev = m.indexOf(
    `REVOKE ALL ON TABLE public.${TABELA} FROM PUBLIC, anon, authenticated, service_role`,
  );
  const gr = m.indexOf(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${TABELA} TO authenticated`,
  );
  assert(rev > 0 && gr > rev);
  assert(!/GRANT[^;]*\bTO (anon|PUBLIC|service_role)/i.test(m));
  assert(!/ALTER PUBLICATION/i.test(m), "fora do realtime");
  assert(m.includes("BEFORE INSERT OR UPDATE ON"));
  // O corpo do carimbo é o do hash que as consultas 50a/50b carregam.
  const corpo = migration.match(
    /CREATE OR REPLACE FUNCTION public\.carimba_nota_interna_do_pedido\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  )[1];
  assert(corpo.includes("NEW.updated_at := now();"));
  assert(corpo.includes("NEW.updated_by := auth.uid();"));
  for (const consulta of [
    "50a-conferir-nota-interna-do-pedido-aplicado",
    "50b-antes-nota-interna-do-pedido-base-vigente",
  ])
    assert(
      arquivo(`scripts/publicacao/consultas/${consulta}.sql`).includes(
        md5(corpo),
      ),
      consulta,
    );
  for (const s of [migration, rollback, destrutivo])
    if (s.includes("md5(replace(p.prosrc")) assert(s.includes(md5(corpo)));
});

Deno.test("247: pré-voo recusa antes de escrever; o pós-voo da migration exige o estado aberto", () => {
  const antes = migration.slice(
    0,
    migration.indexOf("CREATE OR REPLACE FUNCTION"),
  );
  for (const trecho of [
    "B1_BASELINE_DIVERGENT",
    "pg_policy",
    "pg_constraint",
    "pg_trigger",
    "aclexplode",
    "pg_publication_tables",
    "rls_admin_atual",
    "is_admin_atual",
    "tgenabled",
  ])
    assert(antes.includes(trecho), trecho);
  assert(
    !/CREATE\s|DROP\s|GRANT\s|REVOKE\s|ALTER\s/.test(sql(antes)),
    "o pré-voo escreve",
  );
  assert(migration.includes("$conferencia_20261247$"));
  assert(
    migration.indexOf("$conferencia_20261247$") >
      migration.indexOf("CREATE POLICY"),
  );
});

Deno.test("247: rollback comum fecha a porta e preserva; destrutivo exige confirmação e a porta fechada", () => {
  const r = sql(rollback);
  assert(
    r.includes(
      `DROP POLICY IF EXISTS nota_interna_so_admin_atual ON public.${TABELA}`,
    ),
  );
  assert(
    r.includes(
      `REVOKE ALL ON TABLE public.${TABELA} FROM PUBLIC, anon, authenticated, service_role`,
    ),
  );
  assert(!/DISABLE ROW LEVEL SECURITY/i.test(r));
  assert(destrutivo.includes("app.confirmo_apagar_notas_internas"));
  assert(destrutivo.includes("NOTAS_INTERNAS_SO_COM_O_DONO"));
  assert(destrutivo.includes("NOTAS_INTERNAS_ROLLBACK_COMUM_PRIMEIRO"));
  assert(sql(destrutivo).includes(`DROP TABLE IF EXISTS public.${TABELA}`));
  assert(
    destrutivo.indexOf("NOTAS_INTERNAS_ROLLBACK_COMUM_PRIMEIRO") <
      destrutivo.indexOf("DROP TABLE"),
  );
});

Deno.test("247: nenhuma outra migration usa o número, e a tabela nasce só nesta", () => {
  for (const e of Deno.readDirSync(
    new URL("../supabase/migrations/", import.meta.url),
  )) {
    if (!/^\d{14}_.*\.sql$/.test(e.name) || e.name === NOME) continue;
    assert(!e.name.startsWith("20261247"), e.name);
    assert(
      !new RegExp(`CREATE TABLE[^;]*${TABELA}`, "i").test(ler(e.name)),
      e.name,
    );
  }
});

Deno.test("247: a prova viva roda no CI e o roteiro de privacidade apaga as anotações", () => {
  assert(
    arquivo(".github/workflows/rpc-ci.yml").includes(
      "node tests/banco/rodar-isolado.cjs tests/banco/nota-interna-do-pedido-viva.cjs",
    ),
  );
  const roteiro = arquivo("docs/runbooks/atender-pedido-de-privacidade.md");
  assert(
    roteiro.includes(
      `DELETE FROM public.${TABELA}\n     WHERE order_id IN (SELECT id FROM public.marketplace_orders WHERE user_id = v_id);`,
    ),
  );
  assert(roteiro.includes("anotações internas dos pedidos apagadas"));
  // O passo fica DEPOIS do UPDATE dos pedidos e antes das devoluções.
  assert(
    roteiro.indexOf("pedidos anonimizados (continuam existindo)") <
      roteiro.indexOf(`DELETE FROM public.${TABELA}`) &&
      roteiro.indexOf(`DELETE FROM public.${TABELA}`) <
        roteiro.indexOf("-- Devoluções: o que a cliente escreveu"),
  );
  assert(
    arquivo("tests/banco/anonimizar-conta-ensaio-viva.cjs").includes(
      "anotações internas dos pedidos apagadas: 2",
    ),
  );
});

Deno.test("247: lote 50 tem rols fechados, hashes reais, menu e veredito sem linha faltante", async () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO, lerCanais, decidirLote } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const a = "50a-conferir-nota-interna-do-pedido-aplicado";
  const b = "50b-antes-nota-interna-do-pedido-base-vigente";
  const lote = lerCanais().provasDeObjetos.find((p) => p.consulta === a);
  assert.deepEqual(lote.versoes, ["20261247000000"]);
  assert.equal(lote.ausenciaConfirmadaPor, b);
  assert.equal(lote.backfillLedger, undefined);
  assert.equal(lote.nuncaAplicar, undefined);
  for (const [nome, sqlDaConsulta] of [
    [a, arquivo(`scripts/publicacao/consultas/${a}.sql`)],
    [b, arquivo(`scripts/publicacao/consultas/${b}.sql`)],
  ]) {
    assert(CONSULTAS_DE_ROL_FECHADO.has(nome));
    const rol = new Map(Object.entries(conf.ROL_FECHADO_POR_CONSULTA)).get(
      nome,
    );
    assert.equal(rol.length, 6);
    assert.equal(conf.contarStatements(sqlDaConsulta), 1);
    const itens = [...sqlDaConsulta.matchAll(/SELECT '([^']+)', 'sim'/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(itens, rol);
    const rows = rol.map((item) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(conf.estruturaDoRolFechado(rows, rol), null);
    assert.notEqual(conf.estruturaDoRolFechado(rows.slice(1), rol), null);
    assert(
      arquivo(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nome}`,
      ),
    );
    assert(
      arquivo(".github/workflows/rpc-ci.yml").includes(
        `"scripts/publicacao/consultas/${nome}.sql"`,
      ),
    );
    // só catálogo: nenhuma leitura da tabela de notas nem de pedidos
    assert(
      !new RegExp(`FROM\\s+public\\.${TABELA}\\b`, "i").test(sqlDaConsulta),
    );
    assert(!/FROM\s+public\.marketplace_orders\b/i.test(sqlDaConsulta));
  }
  const prova = (estado) => ({
    estado,
    motivo: "fixture",
    run: { createdAt: "2026-10-16T18:00:00Z" },
  });
  const decidir = (faltam, p, d = new Map()) =>
    decidirLote({
      lote,
      faltam,
      exigeProva: true,
      prova: prova(p),
      diagnostico: d,
    });
  assert.equal(decidir(lote.versoes, "SEM_EVIDENCIA").acao, "CONFERIR");
  assert.equal(decidir(lote.versoes, "POSITIVA").acao, "PARAR");
  assert.equal(decidir(lote.versoes, "NEGATIVA").acao, "CONFERIR");
  assert.equal(
    decidir(lote.versoes, "NEGATIVA", new Map([[b, prova("POSITIVA")]])).acao,
    "APLICAR",
  );
  assert.equal(
    decidir(lote.versoes, "NEGATIVA", new Map([[b, prova("NEGATIVA")]])).acao,
    "PARAR",
  );
  assert.equal(decidir([], "POSITIVA").acao, "NADA");
});
