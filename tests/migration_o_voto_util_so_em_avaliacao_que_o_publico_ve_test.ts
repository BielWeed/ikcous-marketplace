// @ts-nocheck
// O VOTO UTIL SO VALE EM AVALIACAO QUE O PUBLICO VE — prova offline do par 20261223000000 + rollback
// (permissao; decisao do dono de 14/10/2026). O COMPORTAMENTO por papel e por status (anon 42501, publicada
// vota, pendente e inexistente com a mesma excecao e nada gravado, rollback com o mesmo md5, pre-voo,
// conferencia, concorrencia) e' provado em tests/banco/voto-util-so-em-avaliacao-publica-viva.cjs, o portao da
// release em tests/banco/voto-util-so-em-avaliacao-publica-portao-viva.cjs e a lista de portas em
// tests/banco/portas-do-visitante-so-as-permitidas-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o antigo (o da 20261050000000) MAIS a guarda (nada mais), o corpo do
// rollback tem de ser o antigo BYTE A BYTE, os atributos (SECURITY DEFINER, VOLATILE, search_path, retorno)
// nao podem mudar, nenhum GRANT/REVOKE pode entrar (a ACL e' da 20261221000000), a condicao de "avaliacao
// que o publico ve" tem de ser a MESMA da vitrine e da policy, o pre-voo vem antes da troca e a conferencia
// depois, e o front nao pode quebrar pior.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261223000000_o_voto_util_so_em_avaliacao_que_o_publico_ve.sql";
const ANTIGA = "20261050000000_o_voto_util_tem_memoria_no_servidor.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationAntiga = ler(ANTIGA);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_ANTIGO = "25931ffa61160aa410e265f29c23532d";
const corpoDe = (sql) => {
  const i = sql.indexOf("AS $function$") + "AS $function$".length;
  return sql.slice(i, sql.indexOf("$function$;", i));
};
const CORPO_ANTIGO = corpoDe(migrationAntiga);
const CORPO_NOVO = corpoDe(migration);
const H_NOVO = md5(CORPO_NOVO);
const BLOCO_ANTIGO =
  "    -- Avaliação inexistente: no-op silencioso, o MESMO contrato do corpo\n" +
  "    -- antigo (o UPDATE sem linha não fazia nada) — não deixa a FK violar\n" +
  "    -- onde antes não violava.\n" +
  "    IF NOT EXISTS (\n" +
  "        SELECT 1 FROM public.reviews WHERE id = v_review_id\n" +
  "    ) THEN\n" +
  "        RETURN;\n" +
  "    END IF;\n\n";
const GUARDA =
  "    -- Só avaliação que o PÚBLICO VÊ recebe voto: a mesma condição da vitrine\n" +
  "    -- (`vw_reviews_public`) e da policy `reviews_select_policy`, `status = 'publicada'`.\n" +
  "    -- Avaliação pendente e id que não existe levantam a MESMA exceção, com a mesma\n" +
  "    -- mensagem: quem chama não descobre se o id existe. Este bloco ocupa o lugar da\n" +
  '    -- antiga checagem "inexistente = não faz nada em silêncio" (20261050000000): a tela\n' +
  "    -- mostrava um +1 que nunca foi gravado; com o erro ela desfaz o +1 e diz a verdade.\n" +
  "    -- Como a guarda vem antes do INSERT, o id inexistente também nunca chega à FK.\n" +
  "    IF NOT EXISTS (\n" +
  "        SELECT 1 FROM public.reviews\n" +
  "         WHERE id = v_review_id AND status = 'publicada'\n" +
  "    ) THEN\n" +
  "        RAISE EXCEPTION 'Avaliação não encontrada.';\n" +
  "    END IF;\n\n";

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("o corpo antigo e' o da 20261050000000 (md5 conhecido) e o corpo novo e' ele com UM bloco TROCADO no mesmo lugar (a checagem de inexistente vira a guarda de status), md5 dos dois conhecido, e nada mais", () => {
  assert.equal(md5(CORPO_ANTIGO), H_ANTIGO);
  assert.equal(
    CORPO_ANTIGO.split(BLOCO_ANTIGO).length - 1,
    1,
    "o bloco antigo existe uma vez",
  );
  const esperado = CORPO_ANTIGO.replace(BLOCO_ANTIGO, GUARDA);
  assert.notEqual(esperado, CORPO_ANTIGO);
  assert.equal(
    CORPO_NOVO,
    esperado,
    "corpo novo = corpo antigo com o bloco trocado",
  );
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_ANTIGO);
  // trocar de volta devolve o corpo antigo, byte a byte
  assert.equal(CORPO_NOVO.replace(GUARDA, BLOCO_ANTIGO), CORPO_ANTIGO);
  // NAO ficou codigo morto empilhado: o RETURN silencioso de inexistente nao existe mais
  assert.ok(
    !CORPO_NOVO.includes(
      "SELECT 1 FROM public.reviews WHERE id = v_review_id\n",
    ),
  );
  assert.ok(!CORPO_NOVO.includes("Avaliação inexistente: no-op silencioso"));
  // a posicao: logo depois da checagem de login, antes do INSERT do voto
  const ordem = [
    "IF auth.uid() IS NULL THEN",
    "WHERE id = v_review_id AND status = 'publicada'",
    "INSERT INTO public.review_votes",
    "SET helpful = COALESCE(helpful, 0) + 1",
  ].map((t) => CORPO_NOVO.indexOf(t));
  assert.ok(
    ordem.every((i) => i >= 0),
    `ordem: ${ordem}`,
  );
  assert.deepEqual(
    [...ordem].sort((a, b) => a - b),
    ordem,
  );
  assert.ok(
    CORPO_NOVO.indexOf(GUARDA) ===
      CORPO_NOVO.indexOf(
        "    END IF;\n\n",
        CORPO_NOVO.indexOf("Acesso negado"),
      ) +
        "    END IF;\n\n".length,
    "a guarda vem LOGO depois da checagem de login",
  );
  // a unica comparacao de status e' a da guarda (1 no comentario, 1 no codigo)
  assert.equal(CORPO_NOVO.split("status = 'publicada'").length - 1, 2);
  assert.equal(CORPO_NOVO.split("AND status = 'publicada'").length - 1, 1);
  // fecha por padrao: nada de "<> 'pendente'"
  assert.doesNotMatch(CORPO_NOVO, /<>s*'pendente'|!=s*'pendente'/);
  // os marcadores de scripts/db-apply.cjs contam no corpo VIVO (pg_get_functiondef, comentarios incluidos)
  for (const [texto, vezes] of [
    ["RAISE EXCEPTION 'Avaliação não encontrada.'", 1],
    ["Avaliação não encontrada.", 1],
    [
      "ON CONFLICT ON CONSTRAINT review_votes_um_voto_por_usuario DO NOTHING",
      1,
    ],
    ["IF NOT FOUND THEN", 1],
    ["Acesso negado: usuário não autenticado.", 1],
  ])
    assert.equal(CORPO_NOVO.split(texto).length - 1, vezes, texto);
  // a guarda NAO e' PERFORM + IF NOT FOUND (esse e' o padrao do voto duplicado)
  assert.doesNotMatch(CORPO_NOVO, /\bPERFORM\b/);
  // a mesma familia de mensagem das irmas ("X nao encontrado.")
  assert.ok(
    ler("20260806000000_baseline_do_schema_vivo.sql").includes(
      "RAISE EXCEPTION 'Pedido não encontrado.';",
    ),
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261223000000 (sem ela a migration sai PULADA, codigo 2): a mensagem nova 1 vez, ON CONFLICT 1 vez, IF NOT FOUND THEN 1 vez e o acesso negado 1 vez", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}": [`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  ],", i));
  assert.ok(entrada.includes('funcao: "increment_helpful"'));
  for (const trecho of [
    "Avaliação não encontrada.",
    "ON CONFLICT ON CONSTRAINT review_votes_um_voto_por_usuario DO NOTHING",
    "IF NOT FOUND THEN",
    "Acesso negado: usuário não autenticado.",
  ])
    assert.ok(
      entrada.includes(`texto: "${trecho}"`) || entrada.includes(trecho),
      trecho,
    );
  // 4 marcadores, todos com a contagem exata 1
  assert.equal(entrada.split("vezes: 1").length - 1, 4);
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
});

Deno.test("o rollback recria o corpo ANTIGO byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback), CORPO_ANTIGO);
  assert.equal(md5(corpoDe(rollback)), H_ANTIGO);
  for (const [sql, hashes] of [
    [migration, [H_ANTIGO, H_NOVO]],
    [rollback, [H_ANTIGO, H_NOVO]],
  ])
    for (const h of hashes) assert.ok(sql.includes(`'${h}'`), h);
  // o corpo do rollback nao tem a guarda
  assert.ok(!corpoDe(rollback).includes("Avaliação não encontrada"));
  assert.ok(!corpoDe(rollback).includes("status = 'publicada'"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path=public); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.increment_helpful(review_id uuid)\n" +
    " RETURNS void\n" +
    " LANGUAGE plpgsql\n" +
    " SECURITY DEFINER\n" +
    " SET search_path TO 'public'\n" +
    "AS $function$";
  for (const sql of [migration, rollback]) {
    assert.equal(sql.split("\nCREATE OR REPLACE FUNCTION").length - 1, 1);
    assert.ok(sql.includes(cabecalho), "assinatura e atributos de sempre");
    // fora do corpo da funcao (que legitimamente faz INSERT/UPDATE) nada escreve
    const fora = limpo(sql.replace(corpoDe(sql), ""));
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(
      fora,
      /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
    assert.doesNotMatch(fora, /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER)\b/i);
    assert.doesNotMatch(fora, /\b(STABLE|IMMUTABLE|SECURITY INVOKER)\b/i);
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  // a assinatura original: a mesma da 20261050000000
  assert.ok(migrationAntiga.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos e a ACL de depois da 20261221, confere atributos, review_votes, reviews.status e o SELECT do dono; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261223$");
  const fimPre = migration.indexOf("END $preflight_20261223$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261223$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    "to_regprocedure('public.increment_helpful(uuid)')",
    "md5(replace(prosrc, E'\\r', ''))",
    `v_hash IS DISTINCT FROM '${H_ANTIGO}' AND v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "p.prosecdef",
    "p.provolatile = 'v'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = 'review_id uuid'",
    "pg_get_function_result(p.oid) = 'void'",
    "<> 1",
    "to_regclass('public.review_votes') IS NULL",
    "k.conname = 'review_votes_um_voto_por_usuario'",
    "k.conname = 'reviews_status_check'",
    "pg_get_constraintdef(k.oid) LIKE '%''publicada''%'",
    "a.attname = 'status'",
    "a.atttypid = 'text'::regtype",
    "a.attnotnull",
    "has_table_privilege((SELECT proowner FROM pg_proc WHERE oid = v_oid), to_regclass('public.reviews'), 'SELECT')",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico)",
    "aplique a 20261221000000 antes",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "p.prosecdef",
    "p.provolatile = 'v'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261223:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (corpo conhecido, atributos, PUBLIC fechado) e conferencia (corpo volta ao antigo); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261223$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261223$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${H_ANTIGO}'`));
  assert.ok(conf.includes("g.grantee = 0"), "PUBLIC continua fechado");
  assert.ok(rollback.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.doesNotMatch(
    limpo(rollback.replace(corpoDe(rollback), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("o aviso do rollback da 20261090500000 (GRANT TO PUBLIC) esta no cabecalho da migration E do rollback, e e' verdade; a ordem de desfazer e a regressao do autor estao declaradas", () => {
  const r1090 = ler(
    "rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
  );
  assert.ok(
    r1090.includes(
      "GRANT EXECUTE ON FUNCTION public.increment_helpful(uuid) TO PUBLIC;",
    ),
  );
  for (const sql of [migration, rollback])
    for (const trecho of [
      "rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
      "TO PUBLIC",
    ])
      assert.ok(sql.includes(trecho), trecho);
  assert.ok(migration.includes("ANTES do da 20261221"));
  assert.ok(rollback.includes("ANTES do rollback da 20261221000000"));
  for (const trecho of [
    "anon (visitante)",
    "authenticated, avaliação PUBLICADA",
    "authenticated, avaliação PENDENTE",
    "id que NÃO EXISTE",
    "ISTO TAMBÉM MUDA",
    "O AUTOR votando na PRÓPRIA avaliação",
    "Sem auth.uid()",
    "regressão de UX conhecida",
    "20261110000000",
    "20261111000000",
    'não existe um status "recusada"',
  ])
    assert.ok(migration.includes(trecho), trecho);
});

Deno.test("a condicao de 'avaliacao que o publico ve' e' a MESMA da vitrine e da policy de leitura, e o CHECK so aceita publicada e pendente", () => {
  const vitrine = ler(
    "20261110000000_o_visitante_le_avaliacoes_e_perguntas_pela_vitrine.sql",
  );
  const iView = vitrine.indexOf("CREATE VIEW public.vw_reviews_public");
  assert.ok(iView >= 0);
  assert.ok(
    vitrine
      .slice(iView, vitrine.indexOf("CREATE VIEW public.vw_questions_public"))
      .includes("WHERE r.status = 'publicada';"),
  );
  const policy = ler(
    "20261111000000_o_visitante_para_de_ler_o_autor_direto_da_tabela.sql",
  );
  const iPol = policy.indexOf("CREATE POLICY reviews_select_policy");
  assert.ok(iPol >= 0);
  assert.ok(
    policy
      .slice(iPol, policy.indexOf("DROP POLICY IF EXISTS questions_select"))
      .includes("status = 'publicada'"),
  );
  const moderacao = ler("20261031000000_a_moderacao_ativa_e_real.sql");
  assert.ok(moderacao.includes("CHECK (status IN ('publicada', 'pendente'))"));
  // nenhuma migration viva muda a vitrine ou a policy depois dessas duas
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  for (const n of todas) {
    if (n.startsWith("rollback-manual-")) continue;
    const c = limpo(ler(n)).toLowerCase();
    if (
      /create (?:or replace )?view public\.vw_reviews_public/.test(c) &&
      n !==
        "20261110000000_o_visitante_le_avaliacoes_e_perguntas_pela_vitrine.sql"
    )
      assert.fail(`${n} redefine vw_reviews_public`);
    if (
      c.includes("create policy reviews_select_policy") &&
      !/^(20261031000000|20261111000000|20260806000000)/.test(n)
    )
      assert.fail(`${n} redefine reviews_select_policy`);
  }
});

Deno.test("so a baseline e a 20261050000000 definiam increment_helpful antes (as arquivadas ficam de fora); depois, so este par", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const definem = [];
  for (const n of todas)
    if (
      /create (?:or replace )?function public\.increment_helpful\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      definem.push(n);
  assert.deepEqual(definem.sort(), [
    "20260806000000_baseline_do_schema_vivo.sql",
    ANTIGA,
    NOME,
    `rollback-manual-${ANTIGA}`,
    `rollback-manual-${NOME}`,
  ]);
});

function* walk(url) {
  for (const e of Deno.readDirSync(url)) {
    const filho = new URL(e.name + (e.isDirectory ? "/" : ""), url);
    if (e.isDirectory) yield* walk(filho);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name))
      yield filho.pathname.replace(/^\/([A-Za-z]:)/, "$1");
  }
}

Deno.test("o front: so markHelpful chama a RPC, barra o visitante antes e, se o banco recusar, avisa sem inventar voto (nao quebra a tela); o contador volta do servidor; nenhuma edge function a chama", () => {
  const src = Deno.readTextFileSync(
    new URL("src/hooks/useReviews.ts", DIR),
  ).replace(/\r\n/g, "\n");
  assert.equal(src.split("increment_helpful").length - 1, 1, "um chamador");
  const i = src.indexOf("const markHelpful");
  const trecho = src.slice(i, src.indexOf("[user],", i));
  assert.ok(trecho.includes("if (!user) {"));
  assert.ok(trecho.includes("if (error) throw error;"));
  // Sem incremento otimista: o contador confirmado vem do servidor.
  assert.ok(!trecho.includes("helpful: review.helpful + 1"));
  assert.ok(!trecho.includes("helpful: review.helpful - 1"));
  assert.ok(trecho.includes('.select("helpful")'));
  assert.ok(trecho.includes('toast.error("Erro ao marcar como útil.")'));
  for (const raiz of ["src/", "supabase/functions/"]) {
    for (const f of walk(new URL(raiz, DIR))) {
      if (
        f.endsWith("src/hooks/useReviews.ts") ||
        f.endsWith("database.types.ts")
      )
        continue;
      const t = Deno.readTextFileSync(f);
      assert.ok(!t.includes("increment_helpful"), f);
    }
  }
});

Deno.test("a lista L8 diz o que o banco ficou: increment_helpful 'logado' (so authenticated, volatil, SECURITY DEFINER), com o porque honesto; a ACL alvo da 20261221 nao muda", () => {
  const lista = JSON.parse(
    Deno.readTextFileSync(
      new URL("tests/banco/portas-do-visitante-permitidas.json", DIR),
    ),
  ).funcoes;
  const v = lista.find(
    (l) => l.funcao === "public.increment_helpful(review_id uuid)",
  );
  assert.deepEqual(v.executa, ["authenticated"]);
  assert.equal(v.tipo, "volatil");
  assert.equal(v.secdef, true);
  assert.equal(v.situacao, "logado");
  assert.match(v.porque, /publicada/);
  assert.match(v.porque, /20261223000000/);
  assert.match(v.porque, /20261221000000/);
  const script = Deno.readTextFileSync(
    new URL("scripts/db-prove-grants-convergem.cjs", DIR),
  )
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ");
  assert.ok(
    script.includes(
      '"increment_helpful(uuid)": { PUBLIC: false, anon: false, authenticated: true, },',
    ),
  );
});
