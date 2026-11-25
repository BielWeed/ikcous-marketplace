"use strict";
/**
 * Prova VIVA das consultas 163a/163b (chaves de frete so o servidor: public.store_shipping_credentials), com a migration
 * 20261407 real. Mesmo molde do portao 56 (conferencia-de-banco-comum.cjs): a base nasce do zero com SO as migrations
 * anteriores; a 163b (antes) fica POSITIVA e a 163a reprova nas duas linhas do navegador (anon e authenticated); aplica a
 * 20261407 e a 163a fica POSITIVA nas 6 linhas e a 163b reprova as mesmas duas.
 *
 * Depois, UM estrago por vez (cada um num savepoint), e SO a(s) linha(s) certa(s) vira `nao`: GRANT de tabela e de COLUNA
 * para anon/authenticated/PUBLIC, privilegio herdado por pertencer a outro papel (service_role, pg_read_all_data), perda de
 * privilegio do service_role, RLS desligada, tabela sumida; e, na 163b, o que o rollback padrao NAO reproduz (privilegio
 * parcial, WITH GRANT OPTION, grant de coluna, grantor que nao e o dono).
 *
 * Dado que ja existia antes: uma credencial INVENTADA e' gravada na base anterior; a migration nao a toca e a ponte com o
 * comportamento real e' medida: antes, anon e authenticated ainda alcancam a tabela; depois, permission denied; o
 * service_role segue com acesso (o do efemero nao tem BYPASSRLS: so o privilegio e' medido). A linha `postgres` do rol NAO tem estrago possivel aqui (o `postgres` do efemero e'
 * superusuario: has_table_privilege e' sempre true) e fica registrada como limite da prova. Na 163b a clausula
 * "sem opcao de delegar" e' redundante com a do grantor (um grant com GRANT OPTION tambem sai pela segunda): nenhum estrago a isola.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/chaves-de-frete-so-o-servidor-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");

const A = "163a-conferir-chaves-de-frete-so-o-servidor-aplicado";
const B = "163b-antes-chaves-de-frete-so-o-servidor-base-vigente";
const T = "public.store_shipping_credentials";
const CREDENCIAL = '{"token":"CREDENCIAL-INVENTADA-DA-PROVA-163"}';

const { rodarProva } = criarBancada({
  prefixo: "p163",
  arquivo: "20261407000000_chaves_de_frete_so_o_servidor.sql",
  a: A,
  b: B,
  titulo: "Portao das chaves de frete so o servidor (163a/163b)",
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
    tentar,
    marcar,
  } = H;
  const I = {
    anon: item(A, "store_shipping_credentials: anon"),
    auth: item(A, "store_shipping_credentials: authenticated"),
    serv: item(A, "store_shipping_credentials: service_role"),
    pg: item(A, "store_shipping_credentials: postgres"),
    pub: item(A, "store_shipping_credentials: PUBLIC"),
    rls: item(A, "store_shipping_credentials: RLS"),
  };
  // A 163b tem o MESMO rol da 163a (mesmos textos de item).
  for (const [k, v] of Object.entries(I)) assert.equal(item(B, v), v, k);
  const TODOS = Object.values(I);

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: uma credencial inventada, gravada ANTES da migration (committada no molde do clone).
  await usar(antes, (c) =>
    c.query(
      `INSERT INTO ${T} (provider, credentials) VALUES ('prova163', $1::jsonb)`,
      [CREDENCIAL],
    ),
  );
  const fotoDaLinha = async (c) =>
    (
      await c.query(
        `SELECT provider, credentials, updated_at FROM ${T} ORDER BY provider`,
      )
    ).rows;

  // ---------- ANTES: 163b positiva, 163a reprova so o navegador ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, [I.anon, I.auth]);
      // A ponte com o mundo real: antes da migration o navegador ainda ALCANCA a tabela (a RLS so filtra linhas).
      for (const papel of ["anon", "authenticated"]) {
        assert.equal(
          await tentar(c, papel, `SELECT count(*) FROM ${T}`),
          null,
          `${papel} deveria alcancar a tabela antes da migration`,
        );
      }
    }),
  );
  marcar(
    "163b positiva (6 linhas) e 163a reprova SO anon e authenticated na base criada com as migrations anteriores a 20261407",
  );

  // ---------- 163b: um estrago por vez (base anterior) ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      const c163b = [
        [
          "anon perde um privilegio (DELETE)",
          `REVOKE DELETE ON ${T} FROM anon`,
          [I.anon],
        ],
        [
          "authenticated perde tudo",
          `REVOKE ALL ON ${T} FROM authenticated`,
          [I.auth],
        ],
        [
          "anon ganha WITH GRANT OPTION",
          `GRANT ALL ON ${T} TO anon WITH GRANT OPTION`,
          [I.anon],
        ],
        [
          "authenticated ganha grant de COLUNA alem do da tabela",
          `GRANT SELECT (credentials) ON ${T} TO authenticated`,
          [I.auth],
        ],
        [
          "anon ganha grant de COLUNA alem do da tabela",
          `GRANT UPDATE (credentials) ON ${T} TO anon`,
          [I.anon],
        ],
        [
          "service_role perde tudo",
          `REVOKE ALL ON ${T} FROM service_role`,
          [I.serv],
        ],
        [
          "service_role perde so o TRUNCATE",
          `REVOKE TRUNCATE ON ${T} FROM service_role`,
          [I.serv],
        ],
        [
          "PUBLIC ganha SELECT na tabela",
          `GRANT SELECT ON ${T} TO PUBLIC`,
          [I.pub],
        ],
        [
          "PUBLIC ganha SELECT numa coluna",
          `GRANT SELECT (credentials) ON ${T} TO PUBLIC`,
          [I.pub],
        ],
        [
          "RLS desligada",
          `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`,
          [I.rls],
        ],
        ["tabela sumida", `DROP TABLE ${T}`, TODOS],
      ];
      for (const [rotulo, sql, itens] of c163b) {
        await sabotar(c, rotulo, B, sql, itens);
      }
      // Grantor que NAO e o dono: um papel com GRANT OPTION concede de novo o que ja existia (o rollback padrao nao reproduz).
      await sabotar(
        c,
        "grant de anon feito por outro grantor",
        B,
        [
          "CREATE ROLE p163_outro_grantor NOLOGIN",
          `GRANT ALL ON ${T} TO p163_outro_grantor WITH GRANT OPTION`,
          "SET LOCAL ROLE p163_outro_grantor",
          `GRANT SELECT ON ${T} TO anon`,
          "RESET ROLE",
        ],
        [I.anon],
      );
    }),
  );

  // ---------- DEPOIS: aplica a migration real e confere as duas ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await fotoDaLinha(c);
      assert.equal(antesDaMigration.length, 1, "a credencial ja existia");
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, [I.anon, I.auth]);
      marcar(
        "163a: as 6 linhas ok=true apos aplicar a 20261407; 163b reprova SO anon e authenticated",
      );
      // Os dados que ja existiam ficam byte a byte; a migration so tirou o acesso direto do navegador.
      assert.deepEqual(await fotoDaLinha(c), antesDaMigration);
      for (const papel of ["anon", "authenticated"]) {
        assert.equal(
          await tentar(c, papel, `SELECT count(*) FROM ${T}`),
          "42501",
          `${papel} deveria levar permission denied depois da migration`,
        );
        assert.equal(
          await tentar(c, papel, `UPDATE ${T} SET credentials = '{}'::jsonb`),
          "42501",
        );
      }
      // O servidor segue alcancando a tabela (o service_role do efemero nao tem BYPASSRLS: aqui so o privilegio e' medido).
      assert.equal(
        await tentar(c, "service_role", `SELECT count(*) FROM ${T}`),
        null,
      );
      assert.equal(
        await tentar(c, "service_role", `UPDATE ${T} SET updated_at = now()`),
        null,
      );
      marcar(
        "dado que ja existia: a credencial fica intacta, anon e authenticated levam permission denied e o service_role segue com acesso",
      );

      // Reaplicar e idempotente: a mesma 163a positiva.
      await c.query(MIGRATION);
      await consulta(c, A);
      marcar("reaplicar a 20261407 deixa a 163a positiva (idempotente)");

      const c163a = [
        [
          "authenticated ganha SELECT na tabela",
          `GRANT SELECT ON ${T} TO authenticated`,
          [I.auth],
        ],
        [
          "authenticated ganha SELECT numa COLUNA (so a coluna da chave)",
          `GRANT SELECT (credentials) ON ${T} TO authenticated`,
          [I.auth],
        ],
        [
          "anon ganha SELECT numa COLUNA",
          `GRANT SELECT (credentials) ON ${T} TO anon`,
          [I.anon],
        ],
        [
          "anon ganha INSERT numa COLUNA",
          `GRANT INSERT (credentials) ON ${T} TO anon`,
          [I.anon],
        ],
        [
          "anon ganha UPDATE numa COLUNA",
          `GRANT UPDATE (credentials) ON ${T} TO anon`,
          [I.anon],
        ],
        [
          "authenticated ganha REFERENCES numa COLUNA",
          `GRANT REFERENCES (provider) ON ${T} TO authenticated`,
          [I.auth],
        ],
        [
          "anon ganha so INSERT na tabela",
          `GRANT INSERT ON ${T} TO anon`,
          [I.anon],
        ],
        [
          "anon volta a ter tudo (o rollback)",
          `GRANT ALL ON ${T} TO anon`,
          [I.anon],
        ],
        [
          "authenticated volta a ter tudo (o rollback)",
          `GRANT ALL ON ${T} TO authenticated`,
          [I.auth],
        ],
        [
          "authenticated herda o service_role (membro do papel)",
          "GRANT service_role TO authenticated",
          [I.auth],
        ],
        [
          "anon herda pg_read_all_data (membro do papel)",
          "GRANT pg_read_all_data TO anon",
          [I.anon],
        ],
        [
          "PUBLIC ganha SELECT na tabela (anon e authenticated herdam)",
          `GRANT SELECT ON ${T} TO PUBLIC`,
          [I.anon, I.auth, I.pub],
        ],
        [
          "PUBLIC ganha SELECT numa coluna (anon e authenticated herdam)",
          `GRANT SELECT (credentials) ON ${T} TO PUBLIC`,
          [I.anon, I.auth, I.pub],
        ],
        [
          "service_role perde tudo",
          `REVOKE ALL ON ${T} FROM service_role`,
          [I.serv],
        ],
        [
          "service_role perde so o DELETE",
          `REVOKE DELETE ON ${T} FROM service_role`,
          [I.serv],
        ],
        [
          "RLS desligada",
          `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`,
          [I.rls],
        ],
        ["tabela sumida", `DROP TABLE ${T}`, TODOS],
      ];
      for (const [rotulo, sql, itens] of c163a) {
        await sabotar(c, rotulo, A, sql, itens);
      }
    }),
  );
});
