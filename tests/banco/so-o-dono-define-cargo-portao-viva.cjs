"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (as migrations e os rollbacks), nunca de entrada de rede; so PG efemero. */
/**
 * Prova VIVA das consultas 88a/88b (so o dono da loja define cargo: definir_cargo, o gatilho
 * tr_papel_so_pelo_definir_cargo, dono_da_loja e cargo_log), com a migration 20261383 real.
 * Mesmo molde do portao 56 (conferencia-de-banco-comum.cjs): a base nasce do zero com SO as migrations anteriores;
 * a 88b (antes) fica POSITIVA nas 8 linhas e a 88a reprova tudo menos o controle; aplica a 20261383 e a 88a fica POSITIVA
 * nas 9 linhas, enquanto a 88b reprova SO as tres linhas de "ainda nao existe".
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`. Na 88a: corpo trocado, funcao
 * repetida (sobrecarga), atributos (SECURITY INVOKER, STABLE, STRICT, search_path), EXECUTE aberto para anon, service_role,
 * PUBLIC ou herdado por pertencer a outro papel, EXECUTE perdido pelo authenticated, gatilho desligado, apagado, em outro
 * momento/granularidade/evento ou apontando para outra funcao, RLS desligada, FORCE, politica a mais, politica de outro
 * comando/papel, escrita (cada privilegio, para authenticated e service_role) ou leitura indevida (tabela e coluna, anon e
 * PUBLIC), e as tres garantias da tabela do dono (uma linha so, CHECK, FK sem cascata). Na 88b: cada "ainda nao existe"
 * violado e cada pre-condicao da migration (portas do admin atual, tres gatilhos de papel, profiles/auth.users) quebrada.
 *
 * Dado que ja existia antes: perfis (admin e cliente) e contas gravados ANTES da migration; depois dela ficam byte a byte,
 * o admin continua admin e as duas tabelas nascem vazias. Cadastrar o dono (o passo manual) NAO muda a 88a (ela nao le linha).
 * O rollback comum deixa as tabelas: a 88b reprova SO a linha das tabelas, e so o destrutivo (com a confirmacao) a zera.
 *
 * LIMITES conhecidos (medidos por mutacao do .sql): a clausula "PUBLIC sem EXECUTE" do definir_cargo e o bit BEFORE do gatilho
 * sao redundantes com outras clausulas da mesma linha (o anon herda o PUBLIC; a ordem dos gatilhos so inclui BEFORE de linha),
 * entao nenhum estrago as isola. E a 88a NAO ve grant de COLUNA de escrita para authenticated/service_role em dono_da_loja e
 * cargo_log (has_table_privilege nao conta coluna; so o anon passa por has_any_column_privilege): a RLS sem politica de
 * escrita segura, mas a consulta nao enxerga. Nao esta afirmado aqui de proposito.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (so o dono nomeia, nomeado nao
 * nomeia, PATCH de admin barrado) e' da prova definir-cargo-so-o-dono-viva.cjs; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/so-o-dono-define-cargo-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");

const A = "88a-conferir-so-o-dono-define-cargo-aplicado";
const B = "88b-antes-so-o-dono-define-cargo-ausente";
const ARQUIVO = "20261383000000_so_o_dono_da_loja_define_cargo.sql";
const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const lerSql = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const ROLLBACK = lerSql(`rollback-manual-${ARQUIVO}`);
const DESTRUTIVO = lerSql(`rollback-manual-destrutivo-${ARQUIVO}`);

const DC = "public.definir_cargo(uuid, text)";
const GT = "public.papel_so_pelo_definir_cargo()";
const PERFIS = "public.profiles";
const DONO = "public.dono_da_loja";
const LOG = "public.cargo_log";
const U_DONO = "d8800000-0000-4000-8000-000000000001";
const U_ADM = "d8800000-0000-4000-8000-000000000002";
const U_CLI = "d8800000-0000-4000-8000-000000000003";

const { rodarProva } = criarBancada({
  prefixo: "p88",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao do so o dono define cargo (88a/88b)",
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
  const a = {
    corpo: item(A, "definir_cargo: uma so"),
    atributos: item(A, "definir_cargo: atributos"),
    execute: item(A, "definir_cargo: EXECUTE"),
    gatilhoFn: item(A, "papel_so_pelo_definir_cargo: uma so"),
    gatilho: item(A, "gatilho tr_papel_so_pelo_definir_cargo"),
    rls: item(A, "dono_da_loja e cargo_log: tabelas comuns"),
    privilegios: item(A, "dono_da_loja e cargo_log: so SELECT"),
    unica: item(A, "dono_da_loja: no maximo uma linha"),
    controle: item(A, "controle:"),
  };
  const b = {
    funcoes: item(B, "definir_cargo e papel_so_pelo_definir_cargo: ainda NAO"),
    gatilho: item(B, "gatilho tr_papel_so_pelo_definir_cargo: ainda NAO"),
    tabelas: item(B, "dono_da_loja e cargo_log: ainda NAO"),
    portas: item(B, "as portas do admin atual"),
    tres: item(B, "os tres gatilhos de papel"),
    ordem: item(B, "a ordem dos gatilhos"),
    perfis: item(B, "profiles.role e auth.users"),
    controle: item(B, "controle:"),
  };
  const TODOS_A_MENOS_CONTROLE = Object.values(a).filter(
    (i) => i !== a.controle,
  );

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: um admin (o futuro dono), outro admin e uma cliente, gravados ANTES da migration.
  await usar(antes, async (c) => {
    for (const id of [U_DONO, U_ADM, U_CLI]) {
      await c.query(
        "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@portao88.teste', '{}'::jsonb)",
        [id],
      );
    }
    await c.query(
      `INSERT INTO ${PERFIS} (id, full_name, role) VALUES ($1, 'Dono', 'admin'), ($2, 'Admin', 'admin'), ($3, 'Cliente', 'customer')`,
      [U_DONO, U_ADM, U_CLI],
    );
  });
  const foto = async (c) =>
    (
      await c.query(
        `SELECT p.id, p.role, u.raw_app_meta_data
           FROM ${PERFIS} p JOIN auth.users u ON u.id = p.id ORDER BY p.id`,
      )
    ).rows;
  const contar = async (c, tabela) =>
    (await c.query(`SELECT count(*)::int AS n FROM ${tabela}`)).rows[0].n;

  // ---------- ANTES: 88b positiva; 88a reprova tudo menos o controle ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, TODOS_A_MENOS_CONTROLE);

      // ---------- 88b: um estrago por vez (base anterior) ----------
      const fnVazia =
        "CREATE FUNCTION public.p88_vazia() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$";
      const estragosB = [
        [
          "definir_cargo ja existe",
          "CREATE FUNCTION public.definir_cargo(uuid, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
          [b.funcoes],
        ],
        [
          "papel_so_pelo_definir_cargo ja existe",
          "CREATE FUNCTION public.papel_so_pelo_definir_cargo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
          [b.funcoes],
        ],
        [
          "o gatilho novo ja existe em profiles (de outra funcao)",
          [
            fnVazia,
            `CREATE TRIGGER tr_papel_so_pelo_definir_cargo BEFORE UPDATE ON ${PERFIS} FOR EACH ROW EXECUTE FUNCTION public.p88_vazia()`,
          ],
          [b.gatilho],
        ],
        ["dono_da_loja ja existe", `CREATE TABLE ${DONO} (x int)`, [b.tabelas]],
        ["cargo_log ja existe", `CREATE TABLE ${LOG} (x int)`, [b.tabelas]],
        [
          "is_admin_atual com outro corpo",
          (c) => trocarCorpo(c, "public.is_admin_atual()"),
          [b.portas],
        ],
        [
          "rls_admin_atual com outro corpo",
          (c) => trocarCorpo(c, "public.rls_admin_atual()"),
          [b.portas],
        ],
        [
          "authenticated sem EXECUTE em rls_admin_atual",
          "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
          [b.portas],
        ],
        [
          "rls_admin_atual apagada",
          "DROP FUNCTION public.rls_admin_atual() CASCADE",
          [b.portas],
        ],
        [
          "tr_prevent_role_change desligado",
          `ALTER TABLE ${PERFIS} DISABLE TRIGGER tr_prevent_role_change`,
          [b.tres],
        ],
        [
          "tr_ensure_role_protection desligado",
          `ALTER TABLE ${PERFIS} DISABLE TRIGGER tr_ensure_role_protection`,
          [b.tres],
        ],
        [
          "tr_sync_profile_role_to_auth desligado",
          `ALTER TABLE ${PERFIS} DISABLE TRIGGER tr_sync_profile_role_to_auth`,
          [b.tres],
        ],
        [
          "ensure_role_protection com outro corpo",
          (c) => trocarCorpo(c, "public.ensure_role_protection()"),
          [b.tres],
        ],
        [
          "prevent_role_change com outro corpo",
          (c) => trocarCorpo(c, "public.prevent_role_change()"),
          [b.tres],
        ],
        [
          "handle_profile_role_sync_to_auth com outro corpo",
          (c) => trocarCorpo(c, "public.handle_profile_role_sync_to_auth()"),
          [b.tres],
        ],
        [
          "tr_sync_profile_role_to_auth apagado",
          `DROP TRIGGER tr_sync_profile_role_to_auth ON ${PERFIS}`,
          [b.tres],
        ],
        [
          "tr_prevent_role_change apagado (some tambem da ordem)",
          `DROP TRIGGER tr_prevent_role_change ON ${PERFIS}`,
          [b.tres, b.ordem],
        ],
        [
          "tr_ensure_role_protection renomeado (quebra a ordem)",
          `ALTER TRIGGER tr_ensure_role_protection ON ${PERFIS} RENAME TO tr_zz_ensure`,
          [b.tres, b.ordem],
        ],
        [
          "RLS de profiles desligada",
          `ALTER TABLE ${PERFIS} DISABLE ROW LEVEL SECURITY`,
          [b.perfis],
        ],
        [
          "profiles.role renomeada",
          `ALTER TABLE ${PERFIS} RENAME COLUMN role TO papel`,
          [b.perfis],
        ],
        [
          "auth.users.raw_app_meta_data renomeada",
          "ALTER TABLE auth.users RENAME COLUMN raw_app_meta_data TO meta_antiga",
          [b.perfis],
        ],
      ];
      for (const [rotulo, sql, itens] of estragosB) {
        await sabotar(c, rotulo, B, sql, itens);
      }
    }),
  );
  marcar(
    "88b positiva (8 linhas) e 88a reprova as 8 linhas que nao sao o controle na base criada so com migrations anteriores a 20261383",
  );

  // ---------- DEPOIS: aplica a migration real ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const perfisAntes = await foto(c);
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, [b.funcoes, b.gatilho, b.tabelas]);
      marcar(
        "88a: as 9 linhas ok=true apos aplicar a 20261383; 88b reprova SO as 3 linhas de 'ainda nao existe'",
      );
      // Dado que ja existia: nada foi tocado, o admin segue admin, as duas tabelas nascem vazias.
      assert.deepEqual(await foto(c), perfisAntes);
      assert.equal(await contar(c, DONO), 0);
      assert.equal(await contar(c, LOG), 0);
      marcar(
        "dado que ja existia: perfis e contas ficam byte a byte, o admin continua admin, dono_da_loja e cargo_log nascem vazias",
      );
      // Reaplicar: mesmo estado, mesma 88a.
      await c.query(MIGRATION);
      await consulta(c, A);
      marcar("reaplicar a 20261383 deixa a 88a positiva (idempotente)");
      // Cadastrar o dono (o passo manual) nao muda nada na 88a: ela so le catalogo.
      await c.query(`INSERT INTO ${DONO} (user_id) VALUES ($1)`, [U_DONO]);
      await consulta(c, A);
      await consulta(c, B, [b.funcoes, b.gatilho, b.tabelas]);
      assert.equal(await contar(c, DONO), 1);
      await c.query(`DELETE FROM ${DONO}`);
      marcar(
        "88a segue positiva com o dono cadastrado e com a tabela vazia (nao le linha)",
      );

      // ---------- 88a: um estrago por vez ----------
      const fnVazia =
        "CREATE FUNCTION public.p88_vazia() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$";
      const trig = (quando, escopo, evento, fn = GT) => [
        `DROP TRIGGER tr_papel_so_pelo_definir_cargo ON ${PERFIS}`,
        `CREATE TRIGGER tr_papel_so_pelo_definir_cargo ${quando} ${evento} ON ${PERFIS} ${escopo} EXECUTE FUNCTION ${fn}`,
      ];
      const estragosA = [
        // --- definir_cargo ---
        [
          "definir_cargo com outro corpo (so o texto)",
          (cc) => trocarCorpo(cc, DC),
          [a.corpo],
        ],
        [
          "definir_cargo repetida (sobrecarga)",
          "CREATE FUNCTION public.definir_cargo(uuid, text, text) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
          [a.corpo],
        ],
        [
          "definir_cargo SECURITY INVOKER",
          `ALTER FUNCTION ${DC} SECURITY INVOKER`,
          [a.atributos],
        ],
        ["definir_cargo STABLE", `ALTER FUNCTION ${DC} STABLE`, [a.atributos]],
        ["definir_cargo STRICT", `ALTER FUNCTION ${DC} STRICT`, [a.atributos]],
        [
          "definir_cargo com search_path = public",
          `ALTER FUNCTION ${DC} SET search_path = public`,
          [a.atributos],
        ],
        [
          "definir_cargo sem search_path fixo",
          `ALTER FUNCTION ${DC} RESET search_path`,
          [a.atributos],
        ],
        [
          "anon ganha EXECUTE em definir_cargo",
          `GRANT EXECUTE ON FUNCTION ${DC} TO anon`,
          [a.execute],
        ],
        [
          "service_role ganha EXECUTE em definir_cargo",
          `GRANT EXECUTE ON FUNCTION ${DC} TO service_role`,
          [a.execute],
        ],
        [
          "PUBLIC ganha EXECUTE em definir_cargo",
          `GRANT EXECUTE ON FUNCTION ${DC} TO PUBLIC`,
          [a.execute],
        ],
        [
          "anon herda o authenticated (membro do papel: herda tambem o SELECT das tabelas)",
          "GRANT authenticated TO anon",
          [a.execute, a.privilegios],
        ],
        [
          "authenticated perde EXECUTE em definir_cargo",
          `REVOKE EXECUTE ON FUNCTION ${DC} FROM authenticated`,
          [a.execute],
        ],
        [
          "definir_cargo apagada",
          `DROP FUNCTION ${DC}`,
          [a.corpo, a.atributos, a.execute],
        ],
        // --- o gatilho e a funcao dele ---
        [
          "papel_so_pelo_definir_cargo com outro corpo (so o texto)",
          (cc) => trocarCorpo(cc, GT),
          [a.gatilhoFn],
        ],
        [
          "papel_so_pelo_definir_cargo repetida (sobrecarga)",
          "CREATE FUNCTION public.papel_so_pelo_definir_cargo(int) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
          [a.gatilhoFn],
        ],
        [
          "papel_so_pelo_definir_cargo SECURITY DEFINER",
          `ALTER FUNCTION ${GT} SECURITY DEFINER`,
          [a.gatilhoFn],
        ],
        [
          "papel_so_pelo_definir_cargo com search_path = public",
          `ALTER FUNCTION ${GT} SET search_path = public`,
          [a.gatilhoFn],
        ],
        [
          "anon ganha EXECUTE no gatilho",
          `GRANT EXECUTE ON FUNCTION ${GT} TO anon`,
          [a.gatilhoFn],
        ],
        [
          "authenticated ganha EXECUTE no gatilho",
          `GRANT EXECUTE ON FUNCTION ${GT} TO authenticated`,
          [a.gatilhoFn],
        ],
        [
          "service_role ganha EXECUTE no gatilho",
          `GRANT EXECUTE ON FUNCTION ${GT} TO service_role`,
          [a.gatilhoFn],
        ],
        [
          "PUBLIC ganha EXECUTE no gatilho",
          `GRANT EXECUTE ON FUNCTION ${GT} TO PUBLIC`,
          [a.gatilhoFn],
        ],
        [
          "gatilho desligado",
          `ALTER TABLE ${PERFIS} DISABLE TRIGGER tr_papel_so_pelo_definir_cargo`,
          [a.gatilho],
        ],
        [
          "gatilho apagado",
          `DROP TRIGGER tr_papel_so_pelo_definir_cargo ON ${PERFIS}`,
          [a.gatilho],
        ],
        [
          "gatilho vira AFTER UPDATE",
          trig("AFTER", "FOR EACH ROW", "UPDATE"),
          [a.gatilho],
        ],
        [
          "gatilho vira FOR EACH STATEMENT",
          trig("BEFORE", "FOR EACH STATEMENT", "UPDATE"),
          [a.gatilho],
        ],
        [
          "gatilho vira BEFORE INSERT (nao vigia o UPDATE)",
          trig("BEFORE", "FOR EACH ROW", "INSERT"),
          [a.gatilho],
        ],
        [
          "gatilho aponta para outra funcao",
          [
            fnVazia,
            ...trig("BEFORE", "FOR EACH ROW", "UPDATE", "public.p88_vazia()"),
          ],
          [a.gatilho],
        ],
        [
          "tr_ensure_role_protection renomeado (quebra a ordem)",
          `ALTER TRIGGER tr_ensure_role_protection ON ${PERFIS} RENAME TO tr_zz_ensure`,
          [a.gatilho],
        ],
        [
          "papel_so_pelo_definir_cargo apagada junto com o gatilho",
          `DROP FUNCTION ${GT} CASCADE`,
          [a.gatilhoFn, a.gatilho],
        ],
        // --- as duas tabelas: RLS e politicas ---
        [
          "RLS de cargo_log desligada",
          `ALTER TABLE ${LOG} DISABLE ROW LEVEL SECURITY`,
          [a.rls],
        ],
        [
          "RLS de dono_da_loja desligada",
          `ALTER TABLE ${DONO} DISABLE ROW LEVEL SECURITY`,
          [a.rls],
        ],
        [
          "FORCE ROW LEVEL SECURITY em dono_da_loja",
          `ALTER TABLE ${DONO} FORCE ROW LEVEL SECURITY`,
          [a.rls],
        ],
        [
          "politica de SELECT a mais em dono_da_loja",
          `CREATE POLICY p88_extra ON ${DONO} FOR SELECT TO authenticated USING (true)`,
          [a.rls],
        ],
        [
          "politica de INSERT em cargo_log",
          `CREATE POLICY p88_escrita ON ${LOG} FOR INSERT TO authenticated WITH CHECK (true)`,
          [a.rls],
        ],
        [
          "politica de dono_da_loja vira FOR ALL",
          [
            `DROP POLICY dono_da_loja_select_policy ON ${DONO}`,
            `CREATE POLICY dono_da_loja_select_policy ON ${DONO} FOR ALL TO authenticated USING (true)`,
          ],
          [a.rls],
        ],
        [
          "politica de cargo_log vira TO public",
          [
            `DROP POLICY cargo_log_select_policy ON ${LOG}`,
            `CREATE POLICY cargo_log_select_policy ON ${LOG} FOR SELECT TO public USING (true)`,
          ],
          [a.rls],
        ],
        [
          "politica de cargo_log tambem para anon",
          [
            `DROP POLICY cargo_log_select_policy ON ${LOG}`,
            `CREATE POLICY cargo_log_select_policy ON ${LOG} FOR SELECT TO authenticated, anon USING (true)`,
          ],
          [a.rls],
        ],
        [
          "politica de dono_da_loja vira RESTRICTIVE",
          [
            `DROP POLICY dono_da_loja_select_policy ON ${DONO}`,
            `CREATE POLICY dono_da_loja_select_policy ON ${DONO} AS RESTRICTIVE FOR SELECT TO authenticated USING (true)`,
          ],
          [a.rls],
        ],
        [
          "politica de dono_da_loja apagada",
          `DROP POLICY dono_da_loja_select_policy ON ${DONO}`,
          [a.rls],
        ],
        // --- as duas tabelas: privilegios ---
        [
          "anon ganha SELECT em dono_da_loja",
          `GRANT SELECT ON ${DONO} TO anon`,
          [a.privilegios],
        ],
        [
          "anon ganha SELECT numa coluna de dono_da_loja",
          `GRANT SELECT (user_id) ON ${DONO} TO anon`,
          [a.privilegios],
        ],
        [
          "PUBLIC ganha SELECT em cargo_log",
          `GRANT SELECT ON ${LOG} TO PUBLIC`,
          [a.privilegios],
        ],
        [
          "authenticated perde o SELECT de dono_da_loja",
          `REVOKE SELECT ON ${DONO} FROM authenticated`,
          [a.privilegios],
        ],
        [
          "service_role perde o SELECT de cargo_log",
          `REVOKE SELECT ON ${LOG} FROM service_role`,
          [a.privilegios],
        ],
        ...[
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
          "REFERENCES",
          "TRIGGER",
        ].flatMap((p) =>
          ["authenticated", "service_role"].map((papel, i) => [
            `${papel} ganha ${p} em ${i ? "cargo_log" : "dono_da_loja"}`,
            `GRANT ${p} ON ${i ? LOG : DONO} TO ${papel}`,
            [a.privilegios],
          ]),
        ),
        // --- dono_da_loja: no maximo uma linha ---
        [
          "CHECK (loja) apagado",
          `ALTER TABLE ${DONO} DROP CONSTRAINT dono_da_loja_uma_so_check`,
          [a.unica],
        ],
        [
          "chave primaria apagada",
          `ALTER TABLE ${DONO} DROP CONSTRAINT dono_da_loja_pkey`,
          [a.unica],
        ],
        [
          "FK de user_id apagada",
          `ALTER TABLE ${DONO} DROP CONSTRAINT dono_da_loja_user_id_fkey`,
          [a.unica],
        ],
        [
          "FK de user_id apagando em cascata",
          [
            `ALTER TABLE ${DONO} DROP CONSTRAINT dono_da_loja_user_id_fkey`,
            `ALTER TABLE ${DONO} ADD CONSTRAINT dono_da_loja_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE`,
          ],
          [a.unica],
        ],
        [
          "FK de user_id sem RESTRICT (NO ACTION)",
          [
            `ALTER TABLE ${DONO} DROP CONSTRAINT dono_da_loja_user_id_fkey`,
            `ALTER TABLE ${DONO} ADD CONSTRAINT dono_da_loja_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id)`,
          ],
          [a.unica],
        ],
        // --- tabela sumida ---
        ["cargo_log apagada", `DROP TABLE ${LOG}`, [a.rls, a.privilegios]],
        [
          "dono_da_loja apagada",
          `DROP TABLE ${DONO}`,
          [a.rls, a.privilegios, a.unica],
        ],
      ];
      for (const [rotulo, sql, itens] of estragosA) {
        await sabotar(c, rotulo, A, sql, itens);
      }

      // ---------- rollback: o comum deixa as tabelas; o destrutivo (com a confirmacao) as apaga ----------
      await c.query(ROLLBACK);
      await consulta(c, B, [b.tabelas]);
      await consulta(c, A, [
        a.corpo,
        a.atributos,
        a.execute,
        a.gatilhoFn,
        a.gatilho,
        a.rls,
      ]);
      assert.equal(await contar(c, DONO), 0);
      assert.deepEqual(await foto(c), perfisAntes);
      marcar(
        "rollback comum: tira funcoes, gatilho e politicas e deixa as tabelas; a 88b reprova SO a linha das tabelas; perfis intactos",
      );
      await c.query("SET LOCAL app.confirmo_apagar_cargos = 'APAGAR'");
      await c.query(DESTRUTIVO);
      await consulta(c, B);
      await consulta(c, A, TODOS_A_MENOS_CONTROLE);
      assert.deepEqual(await foto(c), perfisAntes);
      marcar(
        "rollback destrutivo: a 88b volta a ser POSITIVA (8 linhas) e a 88a reprova tudo menos o controle; perfis intactos",
      );
    }),
  );
});
