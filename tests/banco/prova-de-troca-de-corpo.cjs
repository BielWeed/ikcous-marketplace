"use strict";

/**
 * Esqueleto compartilhado das provas VIVAS das migrations que trocam o corpo de UMA funcao (lote 231: 20261395000000,
 * 20261395100000 e 20261395200000). Nao e' uma prova por si: cada `*-viva.cjs` traz a semente, o comportamento e os mutantes dele e
 * usa isto para as provas de MIGRATION, que sao as mesmas em todas (as mesmas do molde 20261394100000):
 *
 *  - o corpo novo e' o vivo com SO a troca declarada (um inverso escrito a parte no teste desfaz a troca e tem de dar o vivo
 *    byte a byte) e o rollback traz o vivo byte a byte;
 *  - reaplicar 2x e em CRLF = mesmo estado (hash, OID, ACL, atributos); o rollback devolve o `prosrc` IDENTICO (md5 e sha256) e a
 *    mesma ACL; o segundo rollback recusa; ida e volta termina igual;
 *  - o pre-voo recusa SEM escrever em cada estado ruim (e o rollback tambem); o pos-voo recusa cada estrago;
 *  - o pos-voo reprovando desfaz a troca (conexao SEM BEGIN: o arquivo vai como UMA mensagem);
 *  - as consultas `a`/`b`: rol fechado de 4 linhas, positivas no estado certo, desvios nos itens certos.
 *
 * Somente Postgres EFEMERO (rodar-isolado.cjs: clone descartavel); nunca banco de loja (efemero.cjs recusa).
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp --
 * Os caminhos vem do proprio repositorio (as migrations e as consultas), nunca de entrada de rede; os padroes de
 * RegExp sao montados da versao da migration (um literal do arquivo que usa isto), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(RAIZ, "supabase", "migrations");
const CONSULTAS = path.join(RAIZ, "scripts", "publicacao", "consultas");
const norm = (s) => s.replace(/\r\n/g, "\n");
const emCRLF = (s) => norm(s).replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const lerMigration = (nome) =>
  norm(fs.readFileSync(path.join(MIGRATIONS, nome), "utf8"));
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");

/** Do `CREATE OR REPLACE FUNCTION public.<fn>(` ao delimitador de fechamento: { cabeca (ate o delimitador de abertura), corpo }. */
function funcaoDe(sql, fn, delim) {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `declaracao de ${fn} nao achada`);
  const ab = sql.indexOf(delim, ini);
  const corpoIni = ab + delim.length;
  const fim = sql.indexOf(delim, corpoIni);
  return { cabeca: sql.slice(ini, corpoIni), corpo: sql.slice(corpoIni, fim) };
}

function criar(cfg) {
  const {
    arq,
    origem, // { arquivo, fn }
    fn,
    delim,
    sig, // "public.x(uuid, text)" para to_regprocedure
    hAntes,
    hDepois,
    volatil, // "v" ou "s"
    aclDeSempre, // ["authenticated=X/postgres", "postgres=X/postgres", "service_role=X/postgres"]
    consulta, // { a, b, rotulos: [4 rotulos], fixos: [rotulos que ficam ok nos dois estados], marca: rotulo da marca }
    inverso, // (corpoNovo) => corpo vivo (a troca desfeita, escrita a parte)
    estragosDaConsulta = [], // [[sql sabotagem, rotulo que cai]]
  } = cfg;

  const MIGRATION = lerMigration(arq);
  const ROLLBACK = lerMigration(`rollback-manual-${arq}`);
  const ANTIGA = funcaoDe(lerMigration(origem.arquivo), fn, delim);
  const NOVA = funcaoDe(MIGRATION, fn, delim);
  const ROL = funcaoDe(ROLLBACK, fn, delim);
  const decl = (f, corpo = f.corpo) => `${f.cabeca}${corpo}${delim};`;
  const CONSULTA_A = lerConsulta(consulta.a);
  const CONSULTA_B = lerConsulta(consulta.b);
  const CONFERIR_BANCO = fs.readFileSync(
    path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
    "utf8",
  );
  // MODO MUTANTE DE ARQUIVO (PROVA_ARQUIVO_MUTADO=1): quem edita o ARQUIVO da migration para sabotar o corpo roda so a prova de
  // COMPORTAMENTO, sem as travas de hash e de bytes que reprovariam a edicao antes de qualquer comportamento ser medido. Nunca em CI.
  const MUTADO = process.env.PROVA_ARQUIVO_MUTADO === "1";

  assert.equal(md5(ANTIGA.corpo), hAntes, "o corpo vivo mudou");
  if (!MUTADO) {
    assert.equal(md5(NOVA.corpo), hDepois, "o corpo desta migration mudou");
    assert.equal(
      ROL.corpo,
      ANTIGA.corpo,
      "o rollback nao e o corpo vivo byte a byte",
    );
    assert.equal(ROL.cabeca, ANTIGA.cabeca, "a declaracao do rollback mudou");
    assert.equal(
      NOVA.cabeca,
      ANTIGA.cabeca,
      "a declaracao mudou (assinatura, atributos)",
    );
    assert.equal(
      inverso(NOVA.corpo),
      ANTIGA.corpo,
      "o corpo novo nao e o vivo com SO a troca declarada, byte a byte",
    );
  }

  const T = { C: null, PROVAS: [], MUTADO };
  const prova = (nome, corpo) => T.PROVAS.push({ nome, corpo });
  Object.assign(T, {
    prova,
    MIGRATION,
    ROLLBACK,
    ANTIGA,
    NOVA,
    ROL,
    decl,
    funcaoDe,
    md5,
    sha256,
    emCRLF,
    lerMigration,
    lerConsulta,
    CONFERIR_BANCO,
  });

  T.instalarNova = () => T.C.query(MUTADO ? decl(NOVA) : MIGRATION);
  T.instalarAntiga = () => T.C.query(decl(ANTIGA));
  const hashVivo = async () =>
    (
      await T.C.query(
        "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
        [sig],
      )
    ).rows[0]?.h;
  const prosrcVivo = async () =>
    (
      await T.C.query(
        "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
        [sig],
      )
    ).rows[0]?.prosrc;
  const retrato = async () => ({
    h: await hashVivo(),
    src: sha256(await prosrcVivo()),
    oid: (await T.C.query("SELECT to_regprocedure($1)::oid::text AS o", [sig]))
      .rows[0].o,
    acl: (
      await T.C.query(
        "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
        [sig],
      )
    ).rows[0]?.a,
    atributos: (
      await T.C.query(
        "SELECT (to_jsonb(p) - 'prosrc')::text AS a FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
        [sig],
      )
    ).rows[0]?.a,
  });
  Object.assign(T, { hashVivo, prosrcVivo, retrato });

  /** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
  T.aplicar = async (sql) => {
    await T.C.query("SAVEPOINT arquivo");
    try {
      await T.C.query(sql);
      await T.C.query("RELEASE SAVEPOINT arquivo");
      return null;
    } catch (e) {
      await T.C.query("ROLLBACK TO SAVEPOINT arquivo");
      return { erro: e.message, codigo: e.code };
    }
  };

  /** Uma transacao por caso, sempre desfeita, ja no estado pedido: "antes" (corpo vivo de antes) ou "depois" (migration). */
  T.emTransacao = async (f, { estado = "antes" } = {}) => {
    await T.C.query("BEGIN");
    try {
      if (estado === "antes" || estado === "depois") {
        await T.instalarAntiga();
        assert.equal(await hashVivo(), hAntes, "o estado ANTES nao montou");
      }
      if (estado === "depois") {
        await T.instalarNova();
        if (!MUTADO)
          assert.equal(await hashVivo(), hDepois, "o estado DEPOIS nao montou");
      }
      return await f();
    } finally {
      await T.C.query("ROLLBACK");
    }
  };

  /** Roda `sql` como `papel`; o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo}. */
  T.tentar = async (papel, sql, params = []) => {
    await T.C.query("SAVEPOINT tentativa");
    try {
      if (papel) await T.C.query(`SET LOCAL ROLE ${papel}`);
      const linhas = (await T.C.query(sql, params)).rows;
      await T.C.query("RESET ROLE");
      await T.C.query("RELEASE SAVEPOINT tentativa");
      return { linhas };
    } catch (e) {
      await T.C.query("ROLLBACK TO SAVEPOINT tentativa");
      await T.C.query("RESET ROLE");
      return { erro: e.message, codigo: e.code };
    }
  };

  /** Roda todas as verificacoes de `CHECKS`, cada uma numa transacao propria que termina em ROLLBACK. */
  T.todasAsVerificacoes = async (CHECKS, montarEstado, semear) => {
    const falhas = [];
    for (const [nome, check] of Object.entries(CHECKS)) {
      await T.C.query("BEGIN");
      try {
        await montarEstado();
        await semear();
        for (const f of await check()) falhas.push(f);
      } catch (e) {
        falhas.push(`${nome}: EXCECAO ${e.message}`);
      } finally {
        await T.C.query("ROLLBACK");
      }
    }
    return falhas;
  };

  /** Mutantes: cada um instala o corpo antigo, troca o corpo NOVO sabotado e roda as verificacoes; as certas tem de ficar vermelhas. */
  T.mutantes = (MUTANTES, CHECKS, semear) => {
    for (const [nome, { aplica, vermelho }] of Object.entries(MUTANTES)) {
      prova(`MUTANTE vermelho — ${nome}`, async () => {
        const instalar = async () => {
          await T.instalarAntiga();
          const mutado = aplica(NOVA.corpo);
          assert.notEqual(mutado, NOVA.corpo, "a sabotagem nao mudou o corpo");
          await T.C.query(decl(NOVA, mutado));
        };
        const falhas = await T.todasAsVerificacoes(CHECKS, instalar, semear);
        assert.ok(falhas.length > 0, `o mutante "${nome}" NAO ficou vermelho`);
        for (const alvo of vermelho)
          assert.ok(
            falhas.some((x) => x.includes(alvo)),
            `o mutante "${nome}" devia reprovar a verificacao "${alvo}"; reprovou: ${falhas.slice(0, 6).join(" | ")}`,
          );
        console.log(
          `    (vermelho em ${falhas.length} verificacoes; ex.: ${falhas[0]})`,
        );
      });
    }
  };

  // -------------------------------------------------------------------------
  // MIGRATION: idempotencia, CRLF, rollback, pre-voo, pos-voo, atomicidade
  // -------------------------------------------------------------------------
  const trocaVolatil = volatil === "s" ? "VOLATILE" : "STABLE";
  prova(
    "MIGRATION: reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL, atributos); o rollback devolve o prosrc IDENTICO (md5 e sha256) e a mesma ACL; o segundo rollback RECUSA; ida e volta termina igual",
    () =>
      T.emTransacao(async () => {
        const original = await retrato();
        assert.equal(original.src, sha256(ANTIGA.corpo));
        assert.deepEqual(
          (
            await T.C.query(
              "SELECT coalesce(array_agg(x::text ORDER BY x::text), '{}') AS a FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE p.oid = to_regprocedure($1)",
              [sig],
            )
          ).rows[0].a,
          aclDeSempre,
        );
        assert.equal(await T.aplicar(MIGRATION), null);
        const um = await retrato();
        assert.equal(um.h, hDepois);
        assert.equal(await T.aplicar(MIGRATION), null);
        assert.deepEqual(await retrato(), um, "reaplicar mudou o estado");
        assert.equal(await T.aplicar(emCRLF(MIGRATION)), null);
        const crlf = await retrato();
        assert.equal(crlf.h, um.h, "CRLF: o hash (sem CR) tem de ser o mesmo");
        assert.equal(crlf.oid, um.oid);
        assert.equal(crlf.acl, um.acl);
        assert.equal(crlf.atributos, um.atributos);
        assert.equal(await T.aplicar(ROLLBACK), null);
        assert.deepEqual(
          await retrato(),
          original,
          "o rollback nao devolveu o estado original byte a byte",
        );
        const segundo = await T.aplicar(ROLLBACK);
        assert.ok(segundo, "o segundo rollback devia recusar");
        assert.match(segundo.erro, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await retrato(),
          original,
          "o segundo rollback escreveu",
        );
        assert.equal(await T.aplicar(MIGRATION), null);
        assert.equal(await T.aplicar(emCRLF(ROLLBACK)), null);
        assert.equal((await retrato()).h, hAntes, "rollback em CRLF");
        assert.equal(await T.aplicar(MIGRATION), null);
        assert.deepEqual(await retrato(), um, "ida, volta e ida");
      }),
  );

  const ESTADOS_RUINS = {
    "corpo desconhecido (um comentario a mais)": () =>
      T.C.query(
        decl(ANTIGA, `${ANTIGA.corpo}\n-- redefinicao que ninguem revisou\n`),
      ),
    [`atributo diferente (${trocaVolatil})`]: () =>
      T.C.query(`ALTER FUNCTION ${sig} ${trocaVolatil}`),
    "atributo diferente (SECURITY INVOKER)": () =>
      T.C.query(`ALTER FUNCTION ${sig} SECURITY INVOKER`),
    "atributo diferente (search_path)": () =>
      T.C.query(`ALTER FUNCTION ${sig} SET search_path = public, pg_temp`),
    [`sobrecarga (outra ${fn})`]: () =>
      T.C.query(
        `CREATE FUNCTION public.${fn}(x integer, y integer, z integer, w integer, v integer, u integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
      ),
    "funcao ausente (apagada)": () => T.C.query(`DROP FUNCTION ${sig}`),
    "ACL aberta (PUBLIC executa)": () =>
      T.C.query(`GRANT EXECUTE ON FUNCTION ${sig} TO PUBLIC`),
    "ACL aberta (anon executa)": () =>
      T.C.query(`GRANT EXECUTE ON FUNCTION ${sig} TO anon`),
    "authenticated sem EXECUTE": () =>
      T.C.query(`REVOKE EXECUTE ON FUNCTION ${sig} FROM authenticated`),
    "service_role sem EXECUTE": () =>
      T.C.query(`REVOKE EXECUTE ON FUNCTION ${sig} FROM service_role`),
    ...(cfg.estadosRuinsExtras || {}),
  };
  prova(
    "MIGRATION: o pre-voo recusa SEM escrever em cada estado ruim (B1_BASELINE_DIVERGENT; o corpo nao muda) e o rollback-manual tambem",
    () =>
      T.emTransacao(async () => {
        for (const [nome, ruim] of Object.entries(ESTADOS_RUINS)) {
          await T.C.query("SAVEPOINT ruim");
          await ruim();
          const fotoAntes = await prosrcVivo();
          const erro = await T.aplicar(MIGRATION);
          assert.ok(erro, `${nome}: a migration devia recusar`);
          assert.match(
            erro.erro,
            /B1_BASELINE_DIVERGENT/,
            `${nome}: ${erro.erro}`,
          );
          assert.equal(
            await prosrcVivo(),
            fotoAntes,
            `${nome}: o pre-voo escreveu`,
          );
          // O rollback so confere o corpo DESTA migration: nos estados ruins de corpo (que partem do antigo) ele recusa por isso.
          const rb = await T.aplicar(ROLLBACK);
          assert.ok(rb, `${nome}: o rollback-manual devia recusar`);
          assert.match(
            rb.erro,
            /B1_BASELINE_DIVERGENT/,
            `${nome}: rollback: ${rb.erro}`,
          );
          assert.equal(
            await prosrcVivo(),
            fotoAntes,
            `${nome}: o pre-voo do rollback escreveu`,
          );
          await T.C.query("ROLLBACK TO SAVEPOINT ruim");
        }
      }),
  );

  // O mesmo, mas partindo do estado NOVO: o rollback tambem recusa atributo/ACL estranhos (nao so corpo antigo).
  prova(
    "MIGRATION: o pre-voo do ROLLBACK recusa SEM escrever atributo e ACL estranhos no estado novo",
    () =>
      T.emTransacao(
        async () => {
          for (const [nome, ruim] of Object.entries(ESTADOS_RUINS)) {
            if (/corpo desconhecido|ausente|sobrecarga/.test(nome)) continue;
            await T.C.query("SAVEPOINT ruim");
            await ruim();
            const fotoAntes = await prosrcVivo();
            const rb = await T.aplicar(ROLLBACK);
            assert.ok(rb, `${nome}: o rollback devia recusar`);
            assert.match(
              rb.erro,
              /B1_BASELINE_DIVERGENT/,
              `${nome}: ${rb.erro}`,
            );
            assert.equal(await prosrcVivo(), fotoAntes, `${nome}: escreveu`);
            await T.C.query("ROLLBACK TO SAVEPOINT ruim");
          }
        },
        { estado: "depois" },
      ),
  );

  const bloco = (sql, nome) => {
    const ini = sql.indexOf(`DO $${nome}$`);
    const fim = sql.indexOf(`END $${nome}$;`) + `END $${nome}$;`.length;
    assert.ok(ini >= 0 && fim > ini, `bloco ${nome} nao achado`);
    return sql.slice(ini, fim);
  };
  const v = arq.slice(0, 14);
  prova(
    "MIGRATION: o pos-voo PASSA no estado novo e RECUSA corpo antigo, a troca duplicada, atributo mudado, PUBLIC/anon abertos e authenticated sem EXECUTE; mudar o dono entre o pre-voo e o pos-voo tambem reprova",
    () =>
      T.emTransacao(async () => {
        const PREVOO = bloco(MIGRATION, `preflight_${v}`);
        const POSVOO = bloco(MIGRATION, `posvoo_${v}`);
        assert.equal(await T.aplicar(MIGRATION), null);
        assert.equal(await T.aplicar(PREVOO), null);
        assert.equal(
          await T.aplicar(POSVOO),
          null,
          "o pos-voo reprovou o estado bom",
        );
        const estragos = [
          ["corpo antigo", () => T.C.query(decl(ANTIGA)), /corpo vivo/],
          [
            "a troca duplicada (hash diferente)",
            () => T.C.query(decl(NOVA, `${NOVA.corpo}\n-- um byte a mais\n`)),
            /corpo vivo/,
          ],
          [
            `atributo (${trocaVolatil})`,
            () => T.C.query(`ALTER FUNCTION ${sig} ${trocaVolatil}`),
            /atributos de .* mudaram/,
          ],
          [
            "PUBLIC aberto",
            () => T.C.query(`GRANT EXECUTE ON FUNCTION ${sig} TO PUBLIC`),
            /ACL de/,
          ],
          [
            "anon aberto",
            () => T.C.query(`GRANT EXECUTE ON FUNCTION ${sig} TO anon`),
            /ACL de/,
          ],
          [
            "authenticated sem EXECUTE",
            () =>
              T.C.query(`REVOKE EXECUTE ON FUNCTION ${sig} FROM authenticated`),
            /ACL de/,
          ],
        ];
        for (const [nome, estrago, padrao] of estragos) {
          await T.C.query("SAVEPOINT estrago");
          await estrago();
          const erro = await T.aplicar(POSVOO);
          assert.ok(erro, `${nome}: o pos-voo devia recusar`);
          assert.match(erro.erro, new RegExp(`POSVOO_${v}`));
          assert.match(erro.erro, padrao, `${nome}: ${erro.erro}`);
          await T.C.query("ROLLBACK TO SAVEPOINT estrago");
        }
        await T.C.query("SAVEPOINT dono");
        await T.C.query("CREATE ROLE dono_troca_395 NOLOGIN");
        await T.C.query(`ALTER FUNCTION ${sig} OWNER TO dono_troca_395`);
        const erroDono = await T.aplicar(POSVOO);
        assert.ok(erroDono, "mudar o dono devia reprovar o pos-voo");
        assert.match(erroDono.erro, new RegExp(`POSVOO_${v}`));
        await T.C.query("ROLLBACK TO SAVEPOINT dono");
      }),
  );

  prova(
    "MIGRATION: o pos-voo reprovando DESFAZ a troca — uma migration cujo corpo novo sai com 1 byte a mais aborta no pos-voo e a funcao fica como estava; o arquivo vai como UMA mensagem (uma transacao implicita, conexao SEM BEGIN)",
    async () => {
      const sabotada = MIGRATION.replace(decl(NOVA), () =>
        decl(NOVA, `${NOVA.corpo}\n-- um byte a mais\n`),
      );
      assert.notEqual(sabotada, MIGRATION);
      const solto = new Client({ connectionString: lerDatabaseUrlEfemera() });
      await solto.connect();
      try {
        await solto.query(decl(ANTIGA)); // estado ANTES, de verdade (clone descartavel)
        const lido = async () =>
          (
            await solto.query(
              "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
              [sig],
            )
          ).rows[0].h;
        assert.equal(await lido(), hAntes);
        await assert.rejects(
          () => solto.query(sabotada),
          new RegExp(`POSVOO_${v}`),
        );
        assert.equal(
          await lido(),
          hAntes,
          "o pos-voo reprovou mas a troca ficou gravada",
        );
        await solto.query(MIGRATION);
        assert.equal(await lido(), hDepois);
        await solto.query(ROLLBACK);
        assert.equal(await lido(), hAntes);
        await assert.rejects(
          () => solto.query(ROLLBACK),
          /B1_BASELINE_DIVERGENT/,
        );
        assert.equal(await lido(), hAntes);
        await solto.query(MIGRATION);
        assert.equal(await lido(), hDepois);
      } finally {
        await solto.end();
      }
    },
  );

  // -------------------------------------------------------------------------
  // CONSULTAS a / b
  // -------------------------------------------------------------------------
  const rodarConsulta = async (sql) => (await T.C.query(sql)).rows;
  const mapa = (linhas) =>
    Object.fromEntries(linhas.map((l) => [l.item, l.ok]));
  prova(
    "CONSULTAS: a e b tem rol fechado de 4 linhas (os rotulos do conferir-banco), positivas no estado certo; a `a` reprova no ANTES e a `b` no DEPOIS, nos itens certos; cada desvio da `a` cai no item certo",
    async () => {
      const rodarTodas = async () => ({
        a: await rodarConsulta(CONSULTA_A),
        b: await rodarConsulta(CONSULTA_B),
      });
      const depois = await T.emTransacao(rodarTodas, { estado: "depois" });
      const antes = await T.emTransacao(rodarTodas, { estado: "antes" });
      for (const c of [depois.a, depois.b, antes.a, antes.b]) {
        assert.equal(c.length, 4, "rol fechado de 4 linhas");
        assert.equal(new Set(c.map((l) => l.item)).size, 4);
        assert.deepEqual(
          c.map((l) => l.item).sort(),
          [...consulta.rotulos].sort(),
          "rotulos fora do rol esperado",
        );
      }
      for (const l of [...depois.a, ...depois.b])
        assert.ok(
          CONFERIR_BANCO.includes(`"${l.item}"`),
          `rotulo fora do rol do conferir-banco: ${l.item}`,
        );
      assert.ok(
        depois.a.every((l) => l.ok),
        JSON.stringify(depois.a.filter((l) => !l.ok)),
      );
      for (const [item, ok] of Object.entries(mapa(depois.b)))
        assert.equal(ok, consulta.fixos.includes(item), `b DEPOIS: ${item}`);
      assert.ok(
        antes.b.every((l) => l.ok),
        JSON.stringify(antes.b.filter((l) => !l.ok)),
      );
      for (const [item, ok] of Object.entries(mapa(antes.a)))
        assert.equal(ok, consulta.fixos.includes(item), `a ANTES: ${item}`);
      const casos = [
        [`GRANT EXECUTE ON FUNCTION ${sig} TO PUBLIC`, consulta.attr],
        [`GRANT EXECUTE ON FUNCTION ${sig} TO anon`, consulta.attr],
        [`REVOKE EXECUTE ON FUNCTION ${sig} FROM authenticated`, consulta.attr],
        [`REVOKE EXECUTE ON FUNCTION ${sig} FROM service_role`, consulta.attr],
        [`ALTER FUNCTION ${sig} SECURITY INVOKER`, consulta.attr],
        [
          decl(NOVA, `${NOVA.corpo}\n-- sabotagem\n`),
          `${fn}: corpo exato (md5)`,
        ],
        ...estragosDaConsulta,
      ];
      for (const [sabotar, itemQueCai] of casos)
        await T.emTransacao(
          async () => {
            await T.C.query(sabotar);
            const caiu = (await rodarConsulta(CONSULTA_A))
              .filter((l) => !l.ok)
              .map((l) => l.item);
            assert.ok(
              caiu.includes(itemQueCai),
              `${sabotar.slice(0, 60)}: caiu ${JSON.stringify(caiu)}`,
            );
          },
          { estado: "depois" },
        );
    },
  );

  T.main = async () => {
    T.C = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await T.C.connect();
    let ok = 0;
    const falhas = [];
    const lista = MUTADO
      ? T.PROVAS.filter((p) => p.nome.startsWith("DEPOIS:"))
      : T.PROVAS;
    try {
      for (const { nome, corpo } of lista) {
        try {
          await corpo();
          ok++;
          console.log(`  ok  ${nome}`);
        } catch (e) {
          falhas.push({ nome, erro: e });
          console.log(
            `  FALHOU  ${nome}\n      ${String(e.stack || e.message)
              .split("\n")
              .join("\n      ")}`,
          );
          await T.C.query("ROLLBACK").catch(() => {});
        }
      }
    } finally {
      await T.C.end().catch(() => {});
    }
    console.log(`\n${ok}/${lista.length} provas passaram.`);
    if (falhas.length)
      falhar("FALHOU", `${falhas.length} prova(s) reprovadas.`);
  };
  return T;
}

module.exports = { criar, funcaoDe, md5, sha256, emCRLF };
