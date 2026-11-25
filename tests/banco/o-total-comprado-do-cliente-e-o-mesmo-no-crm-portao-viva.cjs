"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (as migrations e os rollbacks), nunca de entrada de rede; so PG efemero. */
/**
 * Prova VIVA das consultas 155a/155b (o total comprado do cliente e o mesmo no CRM, na lista e na ficha: o corpo de
 * get_admin_customers_paged e de get_admin_user_detail), com a migration 20261403 real. Mesmo molde do portao 56
 * (conferencia-de-banco-comum.cjs): a base nasce do zero com SO as migrations anteriores; a 155b (antes) fica POSITIVA e a
 * 155a reprova SO as duas linhas de corpo; aplica a 20261403 e a 155a fica POSITIVA nas 5 linhas, enquanto a 155b reprova
 * as mesmas duas.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`: corpo trocado (so o texto) em
 * cada funcao, sobrecarga, atributos (SECURITY INVOKER, STABLE, STRICT, search_path) e EXECUTE (anon, PUBLIC, perda do
 * authenticated ou do service_role, anon herdando o authenticated), funcao apagada.
 *
 * SUCESSORA: a 155a aceita o corpo da migration 20261412 (o CRM ignora reembolso integral: hashes bdac47... e 169d...) como
 * se fosse o desta; aqui as migrations 20261404 a 20261412 sao aplicadas em ordem por cima da 20261403 e a 155a segue
 * POSITIVA, enquanto a 155b reprova. Dado que ja existia: um perfil gravado ANTES da migration fica byte a byte.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento do total (CRM = lista = ficha) e'
 * da prova o-total-comprado-do-cliente-so-conta-pagamento-reconhecido-viva.cjs e das dos corpos; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-total-comprado-do-cliente-e-o-mesmo-no-crm-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");

const A =
  "155a-conferir-o-total-comprado-do-cliente-e-o-mesmo-no-crm-na-lista-e-na-ficha-aplicado";
const B =
  "155b-antes-o-total-comprado-do-cliente-e-o-mesmo-no-crm-na-lista-e-na-ficha-base-vigente";
const ARQUIVO =
  "20261403000000_o_total_comprado_do_cliente_e_o_mesmo_no_crm_na_lista_e_na_ficha.sql";
const SUCESSORA = "20261412000000";
const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const L = "public.get_admin_customers_paged(text,text,text,integer,integer)";
const F = "public.get_admin_user_detail(uuid)";
const U_CLI = "d1550000-0000-4000-8000-000000000001";

const { rodarProva } = criarBancada({
  prefixo: "p155",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao do total comprado do cliente igual ao do CRM (155a/155b)",
});

rodarProva(async (H) => {
  const {
    MIGRATION,
    usar,
    criar,
    montarBase,
    emTransacao,
    consulta,
    item,
    sabotar,
    trocarCorpo,
    marcar,
  } = H;
  const i = {
    lista: item(A, "get_admin_customers_paged: corpo exato"),
    ficha: item(A, "get_admin_user_detail: corpo exato"),
    listaAttr: item(A, "get_admin_customers_paged: uma so"),
    fichaAttr: item(A, "get_admin_user_detail: uma so"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v.slice(0, 40)), v, `${k}: a 155b tem o mesmo rol`);
  }

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: uma cliente gravada ANTES da migration.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao155.teste', '{}'::jsonb)",
      [U_CLI],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente Prova', 'customer')",
      [U_CLI],
    );
  });
  const foto = async (c) =>
    (await c.query("SELECT * FROM public.profiles ORDER BY id")).rows;

  // Estragos que valem para os dois estados (o rol da 155b e' o da 155a; muda so o hash esperado).
  const estragos = [
    ["corpo da lista com outro texto", (c) => trocarCorpo(c, L), [i.lista]],
    ["corpo da ficha com outro texto", (c) => trocarCorpo(c, F), [i.ficha]],
    [
      "lista repetida (sobrecarga)",
      "CREATE FUNCTION public.get_admin_customers_paged(integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
      [i.listaAttr],
    ],
    [
      "ficha repetida (sobrecarga)",
      "CREATE FUNCTION public.get_admin_user_detail(integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
      [i.fichaAttr],
    ],
    [
      "lista SECURITY INVOKER",
      `ALTER FUNCTION ${L} SECURITY INVOKER`,
      [i.listaAttr],
    ],
    [
      "ficha SECURITY INVOKER",
      `ALTER FUNCTION ${F} SECURITY INVOKER`,
      [i.fichaAttr],
    ],
    ["lista STABLE", `ALTER FUNCTION ${L} STABLE`, [i.listaAttr]],
    ["ficha STABLE", `ALTER FUNCTION ${F} STABLE`, [i.fichaAttr]],
    ["lista STRICT", `ALTER FUNCTION ${L} STRICT`, [i.listaAttr]],
    ["ficha STRICT", `ALTER FUNCTION ${F} STRICT`, [i.fichaAttr]],
    [
      "lista sem o extensions no search_path",
      `ALTER FUNCTION ${L} SET search_path = public`,
      [i.listaAttr],
    ],
    [
      "ficha com search_path a mais",
      `ALTER FUNCTION ${F} SET search_path = public, extensions`,
      [i.fichaAttr],
    ],
    [
      "anon ganha EXECUTE na lista",
      `GRANT EXECUTE ON FUNCTION ${L} TO anon`,
      [i.listaAttr],
    ],
    [
      "anon ganha EXECUTE na ficha",
      `GRANT EXECUTE ON FUNCTION ${F} TO anon`,
      [i.fichaAttr],
    ],
    [
      "PUBLIC ganha EXECUTE na lista",
      `GRANT EXECUTE ON FUNCTION ${L} TO PUBLIC`,
      [i.listaAttr],
    ],
    [
      "PUBLIC ganha EXECUTE na ficha",
      `GRANT EXECUTE ON FUNCTION ${F} TO PUBLIC`,
      [i.fichaAttr],
    ],
    [
      "authenticated perde EXECUTE na lista",
      `REVOKE EXECUTE ON FUNCTION ${L} FROM authenticated`,
      [i.listaAttr],
    ],
    [
      "authenticated perde EXECUTE na ficha",
      `REVOKE EXECUTE ON FUNCTION ${F} FROM authenticated`,
      [i.fichaAttr],
    ],
    [
      "service_role perde EXECUTE na lista",
      `REVOKE EXECUTE ON FUNCTION ${L} FROM service_role`,
      [i.listaAttr],
    ],
    [
      "service_role perde EXECUTE na ficha",
      `REVOKE EXECUTE ON FUNCTION ${F} FROM service_role`,
      [i.fichaAttr],
    ],
    [
      "anon herda o authenticated (membro do papel)",
      "GRANT authenticated TO anon",
      [i.listaAttr, i.fichaAttr],
    ],
    ["lista apagada", `DROP FUNCTION ${L}`, [i.lista, i.listaAttr]],
    ["ficha apagada", `DROP FUNCTION ${F}`, [i.ficha, i.fichaAttr]],
  ];

  // ---------- ANTES ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, [i.lista, i.ficha]);
      for (const [rotulo, sql, itens] of estragos) {
        await sabotar(c, rotulo, B, sql, itens);
      }
    }),
  );
  marcar(
    "155b positiva (5 linhas) e 155a reprova SO as duas linhas de corpo na base criada so com migrations anteriores a 20261403",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const perfisAntes = await foto(c);
      assert.equal(perfisAntes.length, 1);
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, [i.lista, i.ficha]);
      assert.deepEqual(await foto(c), perfisAntes);
      marcar(
        "155a: as 5 linhas ok=true apos aplicar a 20261403; 155b reprova SO as duas linhas de corpo; o perfil que ja existia fica byte a byte",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      marcar("reaplicar a 20261403 deixa a 155a positiva (idempotente)");
      for (const [rotulo, sql, itens] of estragos) {
        await sabotar(c, rotulo, A, sql, itens);
      }
    }),
  );

  // ---------- SUCESSORA: a 155a continua positiva depois da 20261412 ----------
  const sucessora = await criar("sucessora", antes);
  await usar(sucessora, (c) =>
    emTransacao(c, async () => {
      await c.query(MIGRATION);
      const entre = fs
        .readdirSync(MIGRATIONS, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".sql"))
        .map((e) => e.name)
        .filter(
          (n) =>
            !n.startsWith("rollback-") &&
            n > ARQUIVO &&
            n.split("_")[0] <= SUCESSORA,
        )
        .sort();
      assert.equal(entre.at(-1).split("_")[0], SUCESSORA);
      for (const nome of entre) {
        await c.query(fs.readFileSync(path.join(MIGRATIONS, nome), "utf8"));
      }
      await consulta(c, A);
      await consulta(c, B, [i.lista, i.ficha]);
      // E a sucessora trocada por outra coisa NAO passa: o corpo da lista com outro texto reprova so a linha da lista.
      await sabotar(
        c,
        "depois da 20261412, a lista com outro texto reprova",
        A,
        (cc) => trocarCorpo(cc, L),
        [i.lista],
      );
      marcar(
        `a 155a aceita o corpo da sucessora ${SUCESSORA} (migrations ${entre[0].split("_")[0]} a ${SUCESSORA} aplicadas em ordem): POSITIVA; 155b reprova so os dois corpos`,
      );
    }),
  );
});
