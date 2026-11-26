// @ts-nocheck
// A LOJA MUDA DE ESTADO SÓ PELA PORTA — prova offline do trio 20261470000000 + rollback comum + rollback destrutivo, das consultas
// 183a/183b e do registro delas no portão (plano L8, Lote 4, 26/11/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: depois da 20261460 o estado de vida de uma loja mudava por qualquer UPDATE direto — sem proteger a
// IKCOUS e a Savy, sem conferir a release e sem rastro. Agora:
//   - a porta public.frota_mudar_estado é a ÚNICA que muda estado/estado_desde/estado_sha (SECURITY INVOKER, só o dono executa);
//   - o gatilho de frota_lojas recusa o resto e prende em ativa os refs de scripts/frota/politica.json lojasQueNuncaDormem;
//   - cada mudança deixa uma linha em public.frota_estado_historico (fechada a todo papel da API);
//   - o rollback comum preserva o histórico e o destrutivo exige confirmação e o comum antes.
// A decisão real (papéis, recusas, corrida, pré-voo, mutantes) fica com tests/banco/a-loja-muda-de-estado-so-pela-porta-viva.cjs.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { createHash } = require("node:crypto");
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const {
  contarStatements,
  ROL_FECHADO_POR_CONSULTA,
} = require("../scripts/publicacao/conferir-banco.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const NOME = "20261470000000_a_loja_muda_de_estado_so_pela_porta.sql";
const LER = (n) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${n}`).replace(/\r/g, "");
const migration = LER(NOME);
const rollback = LER(`rollback-manual-${NOME}`);
const destrutivo = LER(`rollback-manual-destrutivo-${NOME}`);
const estadoDeVida = LER("20261460000000_a_loja_tem_estado_de_vida.sql");
const A183 = "183a-conferir-a-loja-muda-de-estado-so-pela-porta-aplicado";
const B183 = "183b-antes-a-loja-muda-de-estado-so-pela-porta-ausente";
const CONSULTA = (n) =>
  Deno.readTextFileSync(
    `${RAIZ}/scripts/publicacao/consultas/${n}.sql`,
  ).replace(/\r/g, "");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const bruto = (s) => norm(s.replace(/--.*$/gm, ""));
const codigo = (s) => norm(removerRuido(s));
const md5 = (s) => createHash("md5").update(s).digest("hex");
function corpo(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  assert(i >= 0, `${nome} nao encontrada`);
  const abre = sql.indexOf("AS $$", i) + "AS $$".length;
  return sql.slice(abre, sql.indexOf("$$;", abre));
}
function bloco(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  assert(i >= 0, `${nome} nao encontrada`);
  const fim = sql.indexOf("$$;", sql.indexOf("AS $$", i)) + "$$;".length;
  return sql.slice(i, fim);
}
const PORTA = "public.frota_mudar_estado";
const GATILHO = "public.frota_lojas_estado_so_pela_porta";
const MD5_PORTA = md5(corpo(migration, PORTA));
const MD5_GATILHO = md5(corpo(migration, GATILHO));
const ASSINATURA =
  "public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)";

Deno.test("avaliarFase0 nao recusa o par migration + rollback comum", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum dos tres arquivos abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback comum", rollback],
    ["rollback destrutivo", destrutivo],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${nome} contem controle de transacao`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
  }
});

Deno.test("o pre-voo e' o primeiro comando depois dos SET LOCAL, recusa com B1_BASELINE_DIVERGENT, conhece os md5 da 20261460 e os desta; o pos-voo confere os desta", () => {
  const iPre = migration.indexOf("DO $preflight_20261470000000$");
  const iPos = migration.indexOf("DO $posvoo_20261470000000$");
  assert(iPre > 0 && iPos > iPre, "pre-voo e pos-voo presentes, nessa ordem");
  const antes = codigo(migration.slice(0, iPre))
    .replace(/SET LOCAL [^;]+;/g, "")
    .trim();
  assertEquals(antes, "", "nada alem de SET LOCAL antes do pre-voo");
  const pre = migration.slice(
    iPre,
    migration.indexOf("$preflight_20261470000000$;", iPre),
  );
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  // A 20261460 aplicada: os md5 da v1 e da v2 que ELA deixa (calculados do arquivo dela).
  assertStringIncludes(
    pre,
    `'${md5(corpo(estadoDeVida, "public.resolver_loja"))}'`,
  );
  assertStringIncludes(
    pre,
    `'${md5(corpo(estadoDeVida, "public.resolver_loja_com_estado"))}'`,
  );
  for (const h of [MD5_PORTA, MD5_GATILHO]) {
    assertStringIncludes(pre, `'${h}'`);
    assertStringIncludes(migration.slice(iPos), `'${h}'`);
    // A ficha do cabecalho diz o md5 certo.
    assertStringIncludes(migration.slice(0, iPre), `esperado: ${h}.`);
  }
  // O pre-voo le linha so para recusar IKCOUS/Savy fora de ativa e loja fora do ar sem a release de referencia.
  assertStringIncludes(
    pre,
    "fl.estado <> 'ativa' AND (fl.estado_sha IS NULL OR fl.estado_sha !~ '^[0-9a-f]{40}$')",
  );
  assertStringIncludes(migration, "NOTIFY pgrst, 'reload schema';");
});

Deno.test("os refs que nunca saem de ativa no gatilho e no pre-voo sao EXATAMENTE os de politica.json lojasQueNuncaDormem", async () => {
  const politica = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/politica.json`),
  );
  const refs = politica.lojasQueNuncaDormem.map((l) => l.ref).sort();
  assertEquals(refs.length, 2);
  const lista = `IN (${refs.map((r) => `'${r}'`).join(", ")})`;
  assertStringIncludes(corpo(migration, GATILHO), `NEW.project_ref ${lista}`);
  assertStringIncludes(
    migration.slice(0, migration.indexOf("$preflight_20261470000000$;")),
    `fl.project_ref ${lista}`,
  );
  // E nenhum outro ref de 20 letras aparece no codigo (fora dos comentarios).
  const achados = [...bruto(migration).matchAll(/'([a-z]{20})'/g)].map(
    (m) => m[1],
  );
  assertEquals([...new Set(achados)].sort(), refs);
});

Deno.test("a porta: SECURITY INVOKER, VOLATILE, search_path vazio, FOR UPDATE, liga e desliga a variavel em volta do UPDATE, troca so as tres colunas e grava o rastro", () => {
  const b = bloco(migration, PORTA);
  const cabecalho = norm(b.slice(0, b.indexOf("AS $$")));
  assertEquals(
    cabecalho,
    norm(`CREATE OR REPLACE FUNCTION public.frota_mudar_estado( p_id text, p_ref text, p_de text, p_para text, p_sha text, p_base text,
      p_motivo text, p_confirmacao text, p_valido_ate timestamptz )
      RETURNS TABLE ( id text, nome text, dominio_publico text, estado text, estado_desde timestamptz, estado_sha text )
      LANGUAGE plpgsql SECURITY INVOKER VOLATILE SET search_path = ''`),
  );
  const c = corpo(migration, PORTA);
  assertStringIncludes(
    norm(c),
    "WHERE fl.id = p_id AND fl.project_ref = p_ref FOR UPDATE;",
  );
  const liga = c.indexOf(
    "set_config('ikcous.frota_estado_pela_porta', 'sim', true)",
  );
  const update = c.indexOf("UPDATE public.frota_lojas fl");
  const desliga = c.indexOf(
    "set_config('ikcous.frota_estado_pela_porta', '', true)",
  );
  const rastro = c.indexOf("INSERT INTO public.frota_estado_historico");
  assert(
    liga > 0 && liga < update && update < desliga && desliga < rastro,
    "liga -> UPDATE -> desliga -> rastro",
  );
  // estado_sha = a release em que a loja SAIU do ar: entre dois estados fora do ar (adormecida <-> encerrada) ele fica; so muda ao
  // sair de ativa ou voltar a ela. O historico guarda sempre o sha do momento (p_sha).
  assertStringIncludes(
    norm(c),
    "SET estado = p_para, estado_desde = now(), estado_sha = CASE WHEN v_atual <> 'ativa' AND p_para <> 'ativa' THEN fl.estado_sha ELSE p_sha END",
  );
  assertStringIncludes(
    norm(c),
    "VALUES (p_id, p_ref, p_de, p_para, p_sha, p_motivo);",
  );
  assertEquals(c.split("UPDATE public.").length - 1, 1, "um UPDATE so");
  // As conferencias vem ANTES da trava da linha, e as que dependem do estado atual, depois dela e antes do UPDATE.
  for (const marca of [
    "FROTA_ESTADO_INSTRUCAO_VENCIDA",
    "FROTA_ESTADO_VALIDADE_LONGA",
    "FROTA_ESTADO_DESCONHECIDO",
    "FROTA_ESTADO_SEM_MUDANCA",
    "FROTA_ESTADO_SHA_INVALIDO",
    "FROTA_ESTADO_MOTIVO",
    "FROTA_ESTADO_ENCERRAR_SEM_CONFIRMACAO",
  ])
    assert(
      c.indexOf(marca) > 0 && c.indexOf(marca) < c.indexOf("FOR UPDATE"),
      marca,
    );
  for (const marca of [
    "FROTA_ESTADO_LOJA_NAO_ENCONTRADA",
    "FROTA_ESTADO_DIVERGENTE",
    "FROTA_ESTADO_REABRIR_SEM_CONFIRMACAO",
    "FROTA_ESTADO_BASE_DIVERGENTE",
  ])
    assert(
      c.indexOf(marca) > c.indexOf("FOR UPDATE") && c.indexOf(marca) < liga,
      marca,
    );
  assertStringIncludes(c, "'ENCERRAR ' || p_id");
  assertStringIncludes(c, "'REABRIR ' || p_id");
  assertStringIncludes(c, "interval '1 hour'");
});

Deno.test("o gatilho: BEFORE INSERT OR UPDATE OF estado, estado_desde, estado_sha, project_ref, por linha; trava das refs ANTES da variavel; troca so pela porta", () => {
  assertStringIncludes(
    bruto(migration),
    "CREATE OR REPLACE TRIGGER frota_lojas_estado_so_pela_porta BEFORE INSERT OR UPDATE OF estado, estado_desde, estado_sha, project_ref ON public.frota_lojas FOR EACH ROW EXECUTE FUNCTION public.frota_lojas_estado_so_pela_porta();",
  );
  const b = bloco(migration, GATILHO);
  assertEquals(
    norm(b.slice(0, b.indexOf("AS $$"))),
    "CREATE OR REPLACE FUNCTION public.frota_lojas_estado_so_pela_porta() RETURNS trigger LANGUAGE plpgsql SET search_path = ''",
  );
  const c = corpo(migration, GATILHO);
  assert(
    c.indexOf("FROTA_ESTADO_LOJA_QUE_NUNCA_DORME") <
      c.indexOf("current_setting('ikcous.frota_estado_pela_porta', true)"),
    "a trava das refs vale mesmo com a variavel ligada",
  );
  for (const col of ["estado", "estado_desde", "estado_sha"])
    assertStringIncludes(c, `NEW.${col} IS DISTINCT FROM OLD.${col}`);
  assert(
    !/publishable_key|supabase_url/.test(c),
    "o gatilho nao olha a chave nem a URL (rotacao continua livre)",
  );
});

Deno.test("o historico nasce fechado: RLS ligada, REVOKE de PUBLIC/anon/authenticated/service_role na tabela, na sequencia e nas funcoes; nenhum GRANT; nenhuma linha escrita fora da porta", () => {
  const m = bruto(migration);
  for (const revoke of [
    "REVOKE ALL ON TABLE public.frota_estado_historico FROM PUBLIC, anon, authenticated, service_role;",
    "REVOKE ALL ON SEQUENCE public.frota_estado_historico_id_seq FROM PUBLIC, anon, authenticated, service_role;",
    `REVOKE ALL ON FUNCTION ${ASSINATURA} FROM PUBLIC, anon, authenticated, service_role;`,
    "REVOKE ALL ON FUNCTION public.frota_lojas_estado_so_pela_porta() FROM PUBLIC, anon, authenticated, service_role;",
    "ALTER TABLE public.frota_estado_historico ENABLE ROW LEVEL SECURITY;",
  ])
    assertStringIncludes(m, revoke);
  const c = codigo(migration);
  assert(!/\bGRANT\b/.test(c), "nenhum GRANT");
  assert(!/\bCREATE\s+POLICY\b/i.test(c), "nenhuma politica");
  assert(
    !/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP\s+|ALTER\s+TABLE\s+public\.frota_lojas)\b/i.test(
      c,
    ),
    "a migration escreve, apaga ou altera frota_lojas fora da porta",
  );
  assert(!/CASCADE/i.test(c), "sem CASCADE");
  assertStringIncludes(m, "quem text NOT NULL DEFAULT session_user");
  assertStringIncludes(
    m,
    "CONSTRAINT frota_estado_historico_sha_check CHECK (sha ~ '^[0-9a-f]{40}$')",
  );
});

Deno.test("rollback comum: tira gatilho, funcao do gatilho e porta, PRESERVA o historico; recusa sucessora pelo md5", () => {
  const r = bruto(rollback);
  for (const drop of [
    "DROP TRIGGER IF EXISTS frota_lojas_estado_so_pela_porta ON public.frota_lojas;",
    "DROP FUNCTION IF EXISTS public.frota_lojas_estado_so_pela_porta();",
    `DROP FUNCTION IF EXISTS ${ASSINATURA};`,
  ])
    assertStringIncludes(r, drop);
  const c = codigo(rollback);
  assert(
    !/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|UPDATE\s+public\.|INSERT\s+INTO|CASCADE|GRANT|REVOKE)\b/i.test(
      c,
    ),
    "o rollback comum apaga dado ou mexe em ACL",
  );
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(rollback, `'${MD5_PORTA}'`);
  assertStringIncludes(rollback, `'${MD5_GATILHO}'`);
  assert(
    rollback.indexOf("$preflight_rollback_20261470000000$") <
      rollback.indexOf("DROP TRIGGER"),
    "pre-voo antes do DROP",
  );
});

Deno.test("rollback destrutivo: exige a confirmacao escrita E o rollback comum antes, e so entao apaga o historico (sem CASCADE)", () => {
  const d = bruto(destrutivo);
  assertStringIncludes(d, "app.confirmo_apagar_historico_do_estado_da_loja");
  const iDrop = destrutivo.indexOf(
    "DROP TABLE IF EXISTS public.frota_estado_historico;",
  );
  assert(iDrop > 0);
  assert(destrutivo.indexOf("HISTORICO_DO_ESTADO_SO_COM_O_DONO") < iDrop);
  assert(
    destrutivo.indexOf("HISTORICO_DO_ESTADO_ROLLBACK_COMUM_PRIMEIRO") < iDrop,
  );
  assert(!/CASCADE/i.test(codigo(destrutivo)));
  assertEquals(
    (codigo(destrutivo).match(/\bDROP\b/g) ?? []).length,
    1,
    "o destrutivo so apaga a tabela do historico",
  );
  assertStringIncludes(destrutivo, `to_regprocedure('${ASSINATURA}')`);
});

Deno.test("183a/183b: rol fechado (9 e 5 linhas) igual aos rotulos do SQL, UM statement, so catalogo (nenhuma linha da caderneta nem do historico), md5 da migration", () => {
  // eslint-disable-next-line security/detect-object-injection -- A183 e B183 são constantes literais deste teste.
  const rolA = ROL_FECHADO_POR_CONSULTA[A183];
  // eslint-disable-next-line security/detect-object-injection -- A183 e B183 são constantes literais deste teste.
  const rolB = ROL_FECHADO_POR_CONSULTA[B183];
  assertEquals(rolA?.length, 9);
  assertEquals(rolB?.length, 5);
  for (const [nome, rol] of [
    [A183, rolA],
    [B183, rolB],
  ]) {
    const sql = CONSULTA(nome);
    assertEquals(new Set(rol).size, rol.length, `${nome}: rotulo repetido`);
    assertEquals(contarStatements(sql), 1, `${nome}: UM statement`);
    const rotulos = [...sql.matchAll(/SELECT '([^']+)', '(?:sim|nao)'/g)].map(
      (m) => m[1],
    );
    assertEquals(
      rotulos.sort(),
      [...rol].sort(),
      `${nome}: rotulos do SQL != rol`,
    );
    const cod = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/.test(
        cod,
      ),
      `${nome}: so leitura`,
    );
    assert(
      !/\bFROM\s+(public\.)?(frota_lojas|frota_segredo|frota_estado_historico)\b/i.test(
        cod,
      ),
      `${nome}: nao le linha`,
    );
    assert(
      !/\b(frota_mudar_estado|resolver_loja(_com_estado)?)\s*\(/.test(cod),
      `${nome}: nao chama porta`,
    );
    const hashes = [...sql.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]);
    assert(hashes.length > 0, `${nome}: sem md5`);
    for (const h of hashes)
      assert(
        migration.includes(`'${h}'`),
        `${nome}: md5 ${h} nao esta na migration`,
      );
  }
  assertStringIncludes(CONSULTA(A183), `'${MD5_PORTA}'`);
  assertStringIncludes(CONSULTA(A183), `'${MD5_GATILHO}'`);
});

Deno.test("lote de UMA migration em provasDeObjetos (183a depois, 183b antes), menu do conferir-banco-da-loja, os dois caminhos do rpc-ci, portao de rol fechado e a prova viva no rpc-ci", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lotes = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261470000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].versoes, ["20261470000000"]);
  assertEquals(lotes[0].consulta, A183);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B183);
  assert(
    !("backfillLedger" in lotes[0]) &&
      !("nuncaAplicar" in lotes[0]) &&
      !("soNosRefs" in lotes[0]),
  );
  assertStringIncludes(lotes[0]._comentario, "IKCOUS_FROTA_URL");
  // Anexado no fim quando entrou: logo depois do lote da 20261460 (os lotes posteriores, como o da 20261480, vêm depois dele).
  const i183 = canais.provasDeObjetos.findIndex((l) => l.consulta === A183);
  assertEquals(
    canais.provasDeObjetos[i183 - 1]?.consulta,
    "182a-conferir-o-estado-de-vida-da-loja-aplicado",
    "anexado logo depois do lote da 20261460",
  );
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  const menu = await Deno.readTextFile(
    `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`,
  );
  const rpc = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  for (const nome of [A183, B183]) {
    assert(
      CONSULTAS_DE_ROL_FECHADO.has(nome),
      `${nome} fora de CONSULTAS_DE_ROL_FECHADO`,
    );
    assertStringIncludes(menu.replace(/\r/g, ""), `          - ${nome}\n`);
    assertEquals(
      rpc.split(`"scripts/publicacao/consultas/${nome}.sql"`).length - 1,
      2,
      `${nome}: nos dois caminhos do rpc-ci`,
    );
  }
  assertStringIncludes(
    rpc,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/a-loja-muda-de-estado-so-pela-porta-viva.cjs",
  );
});

Deno.test("rollback destrutivo: com caderneta semeada RECUSA (CADERNETA_SEMEADA) depois das travas dele e antes do DROP; so apaga com ikcous.apagar_caderneta = 'sim'", () => {
  // Plano caderneta-fora-do-dekxab (26/11/2026), T4: o banco da IKCOUS passa a guardar a caderneta de PRODUÇÃO; o destrutivo
  // rodado lá apagaria o histórico de estado da frota. A confirmação APAGAR deste arquivo não basta: é preciso a da caderneta.
  const iDono = destrutivo.indexOf("HISTORICO_DO_ESTADO_SO_COM_O_DONO");
  const iComum = destrutivo.indexOf(
    "HISTORICO_DO_ESTADO_ROLLBACK_COMUM_PRIMEIRO",
  );
  const ini = destrutivo.indexOf("DO $caderneta_semeada$");
  const fim = destrutivo.indexOf("END $caderneta_semeada$;");
  const iDrop = destrutivo.indexOf(
    "DROP TABLE IF EXISTS public.frota_estado_historico;",
  );
  assert(ini >= 0 && fim > ini, "bloco da caderneta semeada presente");
  assert(
    iDono < ini && iComum < ini,
    "as travas do arquivo vem antes (a mensagem delas nao muda)",
  );
  assert(fim < iDrop, "a trava vem antes do DROP");
  const bloco = destrutivo.slice(ini, fim);
  assertStringIncludes(
    bloco,
    "IF COALESCE(current_setting('ikcous.apagar_caderneta', true), '') = 'sim' THEN",
  );
  assertStringIncludes(bloco, "RAISE EXCEPTION 'CADERNETA_SEMEADA:");
  assertStringIncludes(
    destrutivo,
    "SET LOCAL ikcous.apagar_caderneta = 'sim';",
  );
});
