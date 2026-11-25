"use strict";
/**
 * Prova VIVA das consultas 151a/151b (o banner tem imagem propria no computador: a coluna opcional desktop_image_url em
 * public.banners), com a migration 20261399999000 real. Mesmo molde do portao 56 (conferencia-de-banco-comum.cjs): a base nasce
 * do zero com SO as migrations anteriores; a 151b (antes) fica POSITIVA nas 3 linhas e a 151a reprova SO a linha da coluna
 * nova; aplica a 20261399999000 e a 151a fica POSITIVA, enquanto a 151b reprova a mesma linha.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`. Antes: a RLS desligada, a
 * image_url apagada ou com outro tipo, a tabela sumida e a coluna nova ja existindo (a migration "pela metade"). Depois: a RLS
 * desligada, a image_url apagada ou com outro tipo, a coluna nova apagada, renomeada, com outro tipo, NOT NULL, com DEFAULT,
 * gerada, com privilegio proprio (GRANT de coluna) ou com o comentario trocado/apagado.
 *
 * LIMITE DO DESENHO (nao e' defeito da consulta, esta escrito para nao ser lido como cobertura): o rol so confere a RLS
 * LIGADA e a forma da coluna. Policies apagadas (RLS ligada sem nenhuma policy: a vitrine nao le mais nenhum banner) e GRANT de
 * tabela para anon passam POSITIVOS; plantados aqui com o rotulo "fora do rol", para a lacuna ficar escrita.
 *
 * Dado que ja existia: um banner gravado antes da migration fica byte a byte depois dela (a coluna nova nasce NULL, e a
 * image_url segue como reserva). ACHADO da MIGRATION (nao da consulta): reaplicar a 20261399999000 FALHA com 42701 (coluna ja
 * existe), porque o ADD COLUMN nao tem IF NOT EXISTS; a falha e' segura (nada e gravado) e a prova a trava.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-banner-tem-imagem-propria-no-computador-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");

const A = "151a-conferir-o-banner-tem-imagem-propria-no-computador-aplicado";
const B = "151b-antes-o-banner-tem-imagem-propria-no-computador-ausente";
const ARQUIVO = "20261399999000_o_banner_tem_imagem_propria_no_computador.sql";
const T = "public.banners";
const BANNER = "d1510000-0000-4000-8000-000000000001";
const IMAGEM = "https://exemplo.invalid/prova151.png";

const { rodarProva } = criarBancada({
  prefixo: "p151",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao da imagem do banner no computador (151a/151b)",
});

rodarProva(async (H) => {
  const {
    MIGRATION,
    usar,
    criar,
    montarBase,
    emTransacao,
    isolado,
    consulta,
    item,
    sabotar,
    marcar,
  } = H;
  const i = {
    rls: item(A, "banners: tabela comum com RLS ligada"),
    img: item(A, "banners: image_url text preservada"),
    colA: item(A, "banners: desktop_image_url text opcional"),
  };
  const colB = item(B, "banners: desktop_image_url ainda ausente");
  assert.equal(item(B, i.rls), i.rls);
  assert.equal(item(B, i.img), i.img);

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: um banner gravado ANTES da migration.
  await usar(antes, (c) =>
    c.query(
      `INSERT INTO ${T} (id, image_url, title, active) VALUES ($1, $2, 'Banner da prova 151', true)`,
      [BANNER, IMAGEM],
    ),
  );
  const linhaDoBanner = async (c) =>
    (await c.query(`SELECT * FROM ${T} WHERE id = $1`, [BANNER])).rows;

  // ---------- ANTES: 151b positiva; 151a reprova so a coluna nova ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, [i.colA]);
      const estragosB = [
        [
          "RLS desligada",
          `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`,
          [i.rls],
        ],
        [
          "image_url apagada",
          `ALTER TABLE ${T} DROP COLUMN image_url`,
          [i.img],
        ],
        [
          "image_url com outro tipo (varchar)",
          `ALTER TABLE ${T} ALTER COLUMN image_url TYPE varchar(300)`,
          [i.img],
        ],
        [
          "a coluna nova ja existe (a migration entrou pela metade)",
          `ALTER TABLE ${T} ADD COLUMN desktop_image_url text`,
          [colB],
        ],
        [
          "a coluna nova ja existe com outro tipo (ainda assim a coluna nao esta ausente)",
          `ALTER TABLE ${T} ADD COLUMN desktop_image_url integer`,
          [colB],
        ],
        [
          "tabela sumida (sem tabela, a ausencia da coluna continua 'sim')",
          `DROP TABLE ${T} CASCADE`,
          [i.rls, i.img],
        ],
      ];
      for (const [rotulo, sql, itens] of estragosB) {
        await sabotar(c, rotulo, B, sql, itens);
      }
    }),
  );
  marcar(
    "151b positiva (3 linhas) e 151a reprova SO a coluna nova na base criada com as migrations anteriores a 20261399999000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await linhaDoBanner(c);
      assert.equal(antesDaMigration.length, 1, "o banner ja existia");
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, [colB]);
      marcar(
        "151a: as 3 linhas ok=true apos aplicar a 20261399999000; 151b reprova SO a coluna nova",
      );
      // Dado que ja existia: o banner fica como era, mais a coluna nova NULL (a image_url segue como reserva).
      const depoisDaMigration = await linhaDoBanner(c);
      const { desktop_image_url: nova, ...resto } = depoisDaMigration[0];
      assert.equal(nova, null);
      assert.deepEqual([resto], antesDaMigration);
      assert.equal(resto.image_url, IMAGEM);
      marcar(
        "dado que ja existia: o banner fica intacto, a imagem do computador nasce NULL e a image_url segue como reserva",
      );
      // ACHADO sobre a MIGRATION (nao sobre a consulta): ela NAO e' idempotente. O ADD COLUMN nao tem IF NOT EXISTS, entao
      // reaplicar falha com 42701 (coluna ja existe). E' falha SEGURA (aborta, nada e gravado pela metade, e o aplicador nao
      // reaplica uma versao do ledger), mas quem rodar o arquivo duas vezes a mao leva erro. A prova trava o comportamento
      // medido e confere que a falha nao muda nada.
      await isolado(c, async () => {
        let codigo = null;
        try {
          await c.query(MIGRATION);
        } catch (erro) {
          codigo = erro.code;
        }
        assert.equal(
          codigo,
          "42701",
          "reaplicar a migration falha com coluna ja existente",
        );
      });
      await consulta(c, A);
      assert.deepEqual(await linhaDoBanner(c), depoisDaMigration);
      marcar(
        "ACHADO da migration: reaplicar a 20261399999000 FALHA (42701, ADD COLUMN sem IF NOT EXISTS); a falha e' segura: a 151a segue positiva e o banner intacto",
      );

      const estragosA = [
        [
          "RLS desligada",
          `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`,
          [i.rls],
        ],
        [
          "image_url apagada",
          `ALTER TABLE ${T} DROP COLUMN image_url`,
          [i.img],
        ],
        [
          "image_url com outro tipo (varchar)",
          `ALTER TABLE ${T} ALTER COLUMN image_url TYPE varchar(300)`,
          [i.img],
        ],
        [
          "coluna nova apagada",
          `ALTER TABLE ${T} DROP COLUMN desktop_image_url`,
          [i.colA],
        ],
        [
          "coluna nova renomeada",
          `ALTER TABLE ${T} RENAME COLUMN desktop_image_url TO imagem_pc`,
          [i.colA],
        ],
        [
          "coluna nova com outro tipo (varchar)",
          `ALTER TABLE ${T} ALTER COLUMN desktop_image_url TYPE varchar(300)`,
          [i.colA],
        ],
        [
          "coluna nova NOT NULL",
          [
            `UPDATE ${T} SET desktop_image_url = ''`,
            `ALTER TABLE ${T} ALTER COLUMN desktop_image_url SET NOT NULL`,
          ],
          [i.colA],
        ],
        [
          "coluna nova com DEFAULT",
          `ALTER TABLE ${T} ALTER COLUMN desktop_image_url SET DEFAULT ''`,
          [i.colA],
        ],
        [
          "coluna nova GERADA a partir da image_url",
          [
            `ALTER TABLE ${T} DROP COLUMN desktop_image_url`,
            `ALTER TABLE ${T} ADD COLUMN desktop_image_url text GENERATED ALWAYS AS (image_url) STORED`,
            "COMMENT ON COLUMN public.banners.desktop_image_url IS 'Imagem opcional para computador; NULL mantém image_url como reserva.'",
          ],
          [i.colA],
        ],
        [
          "coluna nova com privilegio proprio (GRANT de coluna para anon)",
          `GRANT SELECT (desktop_image_url) ON ${T} TO anon`,
          [i.colA],
        ],
        [
          "comentario da coluna nova trocado",
          `COMMENT ON COLUMN ${T}.desktop_image_url IS 'outro texto'`,
          [i.colA],
        ],
        [
          "comentario da coluna nova apagado",
          `COMMENT ON COLUMN ${T}.desktop_image_url IS NULL`,
          [i.colA],
        ],
        ["tabela sumida", `DROP TABLE ${T} CASCADE`, [i.rls, i.img, i.colA]],
        // Fora do rol (ver o cabecalho): a consulta nao olha policy nem GRANT de tabela.
        [
          "fora do rol: todas as policies de banners apagadas (RLS ligada, ninguem le)",
          async (cc) => {
            const r = await cc.query(
              "SELECT polname FROM pg_policy WHERE polrelid = 'public.banners'::regclass",
            );
            assert.ok(r.rows.length > 0, "banners tem policy a apagar");
            for (const { polname } of r.rows) {
              await cc.query(`DROP POLICY "${polname}" ON ${T}`);
            }
          },
          [],
        ],
        [
          "fora do rol: anon ganha INSERT/UPDATE/DELETE na tabela",
          `GRANT INSERT, UPDATE, DELETE ON ${T} TO anon`,
          [],
        ],
      ];
      for (const [rotulo, sql, itens] of estragosA) {
        await sabotar(c, rotulo, A, sql, itens);
      }
    }),
  );
});
