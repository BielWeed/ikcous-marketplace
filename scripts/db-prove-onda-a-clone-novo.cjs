#!/usr/bin/env node
/**
 * PROVA DA ONDA A NAS DIMENSÕES DO SEU ALVO — grants de COLUNA e schema
 * STORAGE. O db-prove-rollback.cjs genérico é cego para as duas (medido
 * 01/09/2026: "ACL de coluna (pg_attribute.attacl) — só ACL de tabela entra"
 * e "objetos fora do schema public (…storage)" constam das dimensões NÃO
 * medidas), e por isso ele RECUSOU a prova com INSTRUMENTO_QUEBRADO em vez
 * de dar verde falso. Este script mede o que ele não vê.
 *
 * Tudo em UMA transação terminada em ROLLBACK (resíduo zero):
 *
 *   FASE CLONE (controle positivo do defeito): simula o estado de um projeto
 *   Supabase NOVO (grants PADRÃO: SELECT de TABELA para anon e authenticated)
 *   e prova que anon/authenticated LÊEM `custo` — o vazamento do laudo I-1.
 *
 *   FASE CONCERTO: aplica a 20261070000000 por extenso e mede o estado alvo
 *   (anon sem SELECT; authenticated 29 colunas; custo NEGADO por porta real
 *   com SET LOCAL ROLE).
 *
 *   FASE ROLLBACK: aplica o rollback-manual da 70 e mede que o SELECT de
 *   TABELA volta (o rollback é FIEL — e volta a vazar, como documentado).
 *
 *   FASE STORAGE: aplica a 20261071000000 por extenso e mede buckets, as seis
 *   policies admin-only com is_admin, e que as três largas de banner morrem.
 *
 * USO: node scripts/db-prove-onda-a-clone-novo.cjs   (DATABASE_URL do .env)
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");
const MIG = (nome) => path.join(RAIZ, "supabase", "migrations", nome);

let falhas = 0;
function asserir(condicao, rotulo) {
  if (condicao) {
    console.log(`  ok  ${rotulo}`);
  } else {
    falhas += 1;
    console.error(`  FALHOU  ${rotulo}`);
  }
}

// Uma consulta que ESPERA falhar (permission denied) aborta a transação da
// prova — o SAVEPOINT é a cerca: o erro fica contido e o ROLLBACK TO devolve
// a transação limpa para o próximo passo.
async function tenta(client, sql) {
  await client.query("SAVEPOINT sp_tenta");
  let ok = true;
  let msg = "";
  try {
    await client.query(sql);
  } catch (e) {
    ok = false;
    msg = String(e.message);
  }
  await client.query("ROLLBACK TO SAVEPOINT sp_tenta");
  return { ok, msg };
}

async function main() {
  const envPath = path.join(RAIZ, ".env");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
  const env = fs.readFileSync(envPath, "utf8");
  const linha = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  const dbUrl = linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
  const sql70 = fs.readFileSync(
    MIG("20261070000000_os_grants_de_coluna_nascem_no_repositorio.sql"),
    "utf8",
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
  const rollback70 = fs.readFileSync(
    MIG(
      "rollback-manual-20261070000000_os_grants_de_coluna_nascem_no_repositorio.sql",
    ),
    "utf8",
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
  const sql71 = fs.readFileSync(
    MIG("20261071000000_o_storage_nasce_no_repositorio.sql"),
    "utf8",
  );

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query("RESET ALL");

    // ============ FASE CLONE: o estado de projeto novo ======================
    await client.query("GRANT SELECT ON public.produtos TO anon");
    await client.query("GRANT SELECT ON public.produtos TO authenticated");

    const leuAnon = await tenta(
      client,
      "SET LOCAL ROLE anon; SELECT custo FROM public.produtos LIMIT 1",
    );
    asserir(
      leuAnon.ok,
      "FASE CLONE: anon lê custo com o grant padrão — o vazamento do laudo I-1 é real",
    );
    const leuAuth = await tenta(
      client,
      "SET LOCAL ROLE authenticated; SELECT custo FROM public.produtos LIMIT 1",
    );
    asserir(
      leuAuth.ok,
      "FASE CLONE: authenticated lê custo com o grant padrão — a margem sai pela porta REST",
    );

    // ============ FASE CONCERTO: a 20261070000000 por extenso ===============
    await client.query(sql70);

    const negouAuth = await tenta(
      client,
      "SET LOCAL ROLE authenticated; SELECT custo FROM public.produtos LIMIT 1",
    );
    asserir(
      !negouAuth.ok && negouAuth.msg.includes("permission denied"),
      `FASE CONCERTO: authenticated tenta custo e leva permission denied (${negouAuth.msg || "LEU — buraco aberto"})`,
    );
    const leuPublicas = await tenta(
      client,
      "SET LOCAL ROLE authenticated; SELECT id, nome, preco_venda, ativo FROM public.produtos LIMIT 1",
    );
    asserir(
      leuPublicas.ok,
      "FASE CONCERTO: authenticated segue lendo colunas públicas",
    );
    const custoAnon = (
      await client.query(
        "SELECT has_column_privilege('anon','public.produtos','custo','SELECT') AS t",
      )
    ).rows[0].t;
    const custoAuth = (
      await client.query(
        "SELECT has_column_privilege('authenticated','public.produtos','custo','SELECT') AS t",
      )
    ).rows[0].t;
    asserir(custoAnon === false, "catálogo: anon custo SELECT = false");
    asserir(
      custoAuth === false,
      "catálogo: authenticated custo SELECT = false",
    );
    const nColunas = (
      await client.query(
        `SELECT count(*)::int AS n FROM information_schema.column_privileges
          WHERE table_schema='public' AND table_name='produtos'
            AND grantee='authenticated' AND privilege_type='SELECT'`,
      )
    ).rows[0].n;
    asserir(
      nColunas === 29,
      `authenticated SELECT por coluna = 29 (${nColunas})`,
    );

    // ============ FASE ROLLBACK: o rollback-manual da 70 é fiel =============
    await client.query(rollback70);
    const voltouAnon = (
      await client.query(
        "SELECT has_table_privilege('anon','public.produtos','SELECT') AS t",
      )
    ).rows[0].t;
    asserir(
      voltouAnon === true,
      "FASE ROLLBACK: anon volta a ter SELECT de tabela — rollback restaura o estado anterior (e o vazamento, como seu próprio cabeçalho documenta)",
    );

    // restaura o estado do concerto para a prova de storage seguir coesa
    await client.query(sql70);

    // ============ FASE STORAGE: a 20261071000000 por extenso ================
    await client.query(sql71);

    const buckets = (
      await client.query(
        "SELECT id, public FROM storage.buckets WHERE id IN ('products','banners') ORDER BY id",
      )
    ).rows;
    asserir(
      buckets.length === 2 && buckets.every((b) => b.public === true),
      "FASE STORAGE: buckets products e banners existem, públicos",
    );
    const admin = (
      await client.query(
        `SELECT policyname, cmd, coalesce(qual,'') || ' ' || coalesce(with_check,'') AS corpo
           FROM pg_policies
          WHERE schemaname='storage'
            AND (policyname LIKE '% (products)' OR policyname LIKE '% (banners)')
          ORDER BY policyname`,
      )
    ).rows;
    asserir(
      admin.length === 6 && admin.every((p) => p.corpo.includes("is_admin")),
      `FASE STORAGE: 6 policies Admin de products/banners (Insert/Update/Delete), todas com is_admin (${admin.length})`,
    );
    const largas = (
      await client.query(
        `SELECT count(*)::int AS n FROM pg_policies
          WHERE schemaname='storage' AND policyname IN (
            'Authenticated Upload Banners Bucket',
            'Authenticated Update Banners Bucket',
            'Authenticated Delete Banners Bucket')`,
      )
    ).rows[0].n;
    asserir(
      largas === 0,
      "FASE STORAGE: as 3 policies largas de banner (qualquer logado escrevia) não existem mais",
    );
    const rls = (
      await client.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass",
      )
    ).rows[0].relrowsecurity;
    asserir(rls === true, "RLS de storage.objects segue habilitada");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(
    falhas === 0
      ? "\nPROVA COMPLETA: todas as asserções passaram. Nada foi gravado (ROLLBACK)."
      : `\nPROVA REPROVADA: ${falhas} asserção(ões) falharam. NADA foi gravado (ROLLBACK).`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("[PROVA FALHOU]", e.message);
  process.exit(1);
});
