"use strict";
/* eslint-disable security/detect-object-injection --
 * `chave` vem das constantes deste arquivo ("anon", "publico", ...), nunca de entrada externa; so PG efemero. */
const assert = require("node:assert/strict");
/**
 * Estragos-padrao para as provas VIVAS (conferencia-de-banco-comum.cjs) das consultas de conferencia que olham UMA funcao:
 * o corpo (md5) e os atributos/ACL (linguagem, SECURITY DEFINER, volatilidade, STRICT, search_path, sobrecarga, EXECUTE).
 * Devolve a lista `[rotulo, sql, itensQueViramNao]` que `sabotar()` consome; quem chama diz, para cada familia de estrago,
 * QUAIS itens do rol a consulta reprova (a mesma consulta pode juntar tudo num item so, ou nem olhar uma das familias).
 *
 * Familia sem item (`[]`) NAO e' omitida: o estrago e' plantado e a prova EXIGE que a consulta fique POSITIVA, ou seja, registra
 * como achado que ela nao o ve (o rotulo ganha o prefixo "ACHADO"). Assim a lacuna fica escrita e travada: se a consulta
 * passar a ve-lo um dia, a prova acusa e alguem decide se o achado foi fechado.
 *
 * Nao toca producao: so devolve SQL de sabotagem para o Postgres efemero.
 */

/**
 * @param {object} cfg
 * @param {string} cfg.fn assinatura completa, ex.: "public.fin_dre(date,date)"
 * @param {string} cfg.nome nome da funcao sem esquema (para sobrecarga)
 * @param {"v"|"s"} cfg.volatilidade a que a consulta ESPERA ('v' VOLATILE, 's' STABLE)
 * @param {(c: any) => Promise<void>} cfg.trocarCorpo `trocarCorpo` da bancada ja ligado a `fn`
 * @param {string[]} cfg.corpo itens que reprovam quando so o texto do corpo muda
 * @param {string[]} cfg.estrutura itens do atributo (SECURITY DEFINER, volatilidade, STRICT, search_path, sobrecarga)
 * @param {string[]} cfg.drop itens que reprovam quando a funcao some
 * @param {string[]|null} cfg.anon itens que reprovam quando anon ganha EXECUTE (direto ou por membro de papel); null: anon
 *   pode executar por regra (ex.: o visitante valida cupom) e os estragos de anon nao se aplicam
 * @param {string[]} cfg.publico itens que reprovam quando PUBLIC ganha EXECUTE
 * @param {string[]|null} cfg.authSem itens que reprovam quando authenticated PERDE o EXECUTE (null: a consulta exige que
 *   authenticated NAO tenha, entao o estrago e' o contrario e vai em `authCom`)
 * @param {string[]|null} cfg.authCom itens que reprovam quando authenticated GANHA o EXECUTE (null: ela exige que tenha)
 * @param {string[]|null} cfg.servicoCom itens que reprovam quando service_role GANHA o EXECUTE (null: a consulta nao proibe)
 * @param {string[]} cfg.dono itens que reprovam quando o dono da funcao muda
 * @param {string} cfg.prefixoPapel prefixo do papel auxiliar criado no savepoint
 * @param {string[]} [cfg.permitidos] chaves ("dono", "publico", ...) cuja lista vazia e' a regra, nao uma lacuna
 */
// Consultas que MEDEM o efeito real de um estrago de ACL/dono (sem isto, "a consulta nao viu" poderia ser "o estrago nao fez nada").
const EF = {
  anon: [
    "SELECT has_function_privilege('anon', to_regprocedure($1::text), 'EXECUTE') AS v",
    true,
  ],
  publico: [
    `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.oid = to_regprocedure($1::text) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS v`,
    true,
  ],
  authSem: [
    "SELECT has_function_privilege('authenticated', to_regprocedure($1::text), 'EXECUTE') AS v",
    false,
  ],
  authCom: [
    "SELECT has_function_privilege('authenticated', to_regprocedure($1::text), 'EXECUTE') AS v",
    true,
  ],
  servico: [
    "SELECT has_function_privilege('service_role', to_regprocedure($1::text), 'EXECUTE') AS v",
    true,
  ],
};

function estragosDeFuncao(cfg) {
  const {
    fn,
    nome,
    volatilidade,
    trocarCorpo,
    corpo,
    estrutura,
    drop,
    anon,
    publico,
    authSem,
    authCom,
    servicoCom,
    dono,
    prefixoPapel,
    permitidos = [],
  } = cfg;
  const outra = volatilidade === "v" ? "STABLE" : "VOLATILE";
  // `permitidos`: chaves ("dono", "publico", ...) cuja ausencia de item e' a REGRA da consulta, nao uma lacuna dela.
  const rot = (texto, itens, chave) => {
    if (itens.length) return texto;
    return permitidos.includes(chave)
      ? `${texto} (a regra permite)`
      : `ACHADO ${texto}`;
  };
  const lista = [
    [
      `corpo de ${nome} com outro texto (so o md5 muda)`,
      (c) => trocarCorpo(c, fn),
      corpo,
    ],
    [
      `${nome} repetida (sobrecarga)`,
      `CREATE FUNCTION public.${nome}(integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$`,
      estrutura,
    ],
    [
      `${nome} SECURITY INVOKER`,
      `ALTER FUNCTION ${fn} SECURITY INVOKER`,
      estrutura,
    ],
    [`${nome} ${outra}`, `ALTER FUNCTION ${fn} ${outra}`, estrutura],
    [`${nome} IMMUTABLE`, `ALTER FUNCTION ${fn} IMMUTABLE`, estrutura],
    [`${nome} STRICT`, `ALTER FUNCTION ${fn} STRICT`, estrutura],
    [
      `${nome} com search_path = public, extensions`,
      `ALTER FUNCTION ${fn} SET search_path = public, extensions`,
      estrutura,
    ],
    [
      `${nome} com search_path = public, pg_temp`,
      `ALTER FUNCTION ${fn} SET search_path = public, pg_temp`,
      estrutura,
    ],
    [
      `${nome} sem search_path fixo`,
      `ALTER FUNCTION ${fn} RESET search_path`,
      estrutura,
    ],
    [
      `${nome} ganha uma configuracao a mais (statement_timeout)`,
      `ALTER FUNCTION ${fn} SET statement_timeout = '5s'`,
      estrutura,
    ],
    [`${nome} apagada`, `DROP FUNCTION ${fn}`, drop],
    ...(anon === null
      ? []
      : [
          [
            `anon ganha EXECUTE em ${nome}`,
            `GRANT EXECUTE ON FUNCTION ${fn} TO anon`,
            anon,
            "anon",
          ],
        ]),
    [
      `PUBLIC ganha EXECUTE em ${nome}`,
      `GRANT EXECUTE ON FUNCTION ${fn} TO PUBLIC`,
      publico,
      "publico",
    ],
    [
      `${nome} muda de dono (SECURITY DEFINER passa a rodar com outro papel)`,
      [
        `CREATE ROLE ${prefixoPapel}_outro_dono NOLOGIN`,
        `ALTER FUNCTION ${fn} OWNER TO ${prefixoPapel}_outro_dono`,
      ],
      dono,
      "dono",
    ],
  ];
  if (authSem !== null) {
    lista.push([
      `authenticated perde EXECUTE em ${nome}`,
      `REVOKE EXECUTE ON FUNCTION ${fn} FROM authenticated`,
      authSem,
      "authSem",
    ]);
    if (anon !== null) {
      lista.push([
        `anon herda o authenticated (membro do papel) e alcanca ${nome}`,
        "GRANT authenticated TO anon",
        anon,
        "anon",
      ]);
    }
  }
  if (authCom !== null) {
    lista.push([
      `authenticated ganha EXECUTE em ${nome}`,
      `GRANT EXECUTE ON FUNCTION ${fn} TO authenticated`,
      authCom,
      "authCom",
    ]);
    lista.push([
      `authenticated herda o service_role (membro do papel) e alcanca ${nome}`,
      [
        `GRANT EXECUTE ON FUNCTION ${fn} TO service_role`,
        "GRANT service_role TO authenticated",
      ],
      authCom,
      "authCom",
    ]);
  }
  if (servicoCom !== null) {
    lista.push([
      `service_role ganha EXECUTE em ${nome}`,
      `GRANT EXECUTE ON FUNCTION ${fn} TO service_role`,
      servicoCom,
      "servico",
    ]);
  }
  return lista.map(([texto, sql, itens, chave]) => {
    const passos = Array.isArray(sql) ? [...sql] : [sql];
    if (chave === "dono") {
      passos.push(async (c) => {
        const r = await c.query(
          "SELECT proowner::regrole::text AS v FROM pg_proc WHERE oid = to_regprocedure($1::text)",
          [fn],
        );
        assert.equal(r.rows[0].v, `${prefixoPapel}_outro_dono`, texto);
      });
    } else if (EF[chave]) {
      const [consulta, esperado] = EF[chave];
      passos.push(async (c) => {
        const r = await c.query(consulta, [fn]);
        assert.equal(r.rows[0].v, esperado, `efeito real: ${texto}`);
      });
    }
    return [rot(texto, itens, chave), passos, itens];
  });
}

module.exports = { estragosDeFuncao };
