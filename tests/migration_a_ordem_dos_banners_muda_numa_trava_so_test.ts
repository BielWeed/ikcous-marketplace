// A ORDEM DOS BANNERS MUDA NUMA TRAVA SO: prova offline do par 20261651000000 + rollback.
// O COMPORTAMENTO (duas arrumacoes concorrentes sem posicao repetida, mover com o vizinho certo, nao-admin recusado,
// banner inexistente, reaplicar, rollback, pre-voo, fichas) e' provado em tests/banco/a-ordem-dos-banners-muda-numa-trava-so-viva.cjs,
// que so roda no Postgres efemero do CI. Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const nome = "20261651000000_a_ordem_dos_banners_muda_numa_trava_so.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const sql1381 = ler(
  "supabase/migrations/20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql",
);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const NORMALIZA = "public.normalize_banners_atomic(";
const MOVE = "public.move_banner_atomic(";
// O corpo da reorder_banners_atomic que esta no ar (20261381000000): o app velho em cache ainda a chama.
const H_REORDER = "8530188cb2fd69a7d3bf24add96eb339";

/** O corpo (entre os delimitadores de dolar) da UNICA definicao de `marca` no arquivo. */
function corpo(arquivo: string, marca: string): string {
  const cria = `CREATE OR REPLACE FUNCTION ${marca}`;
  assert.equal(arquivo.split(cria).length - 1, 1, `uma definicao so: ${marca}`);
  const i = arquivo.indexOf(cria);
  const m = /\bAS (\$\w*\$)/.exec(arquivo.slice(i));
  assert.ok(m, "sem delimitador");
  const a = i + m.index + m[0].length;
  return arquivo.slice(a, arquivo.indexOf(m[1], a));
}
/** O cabecalho (assinatura + atributos) da definicao, ate o AS. */
function cabeca(arquivo: string, marca: string): string {
  const i = arquivo.indexOf(`CREATE OR REPLACE FUNCTION ${marca}`);
  const fim = i + /\sAS \$/.exec(arquivo.slice(i))!.index;
  return arquivo.slice(i, fim).replace(/\s+/g, " ");
}
/** A ULTIMA definicao de reorder_banners_atomic num arquivo. */
function corpoDoReorder(arquivo: string): string {
  const i = arquivo.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.reorder_banners_atomic(",
  );
  const m = /\bAS (\$\w*\$)/.exec(arquivo.slice(i));
  assert.ok(m);
  const a = i + m.index + m[0].length;
  return arquivo.slice(a, arquivo.indexOf(m[1], a));
}

const hashes = () => {
  const par =
    /v_h_normaliza text := '([0-9a-f]{32})';\s+v_h_move text := '([0-9a-f]{32})';/.exec(
      sql,
    );
  assert.ok(par, "o pre-voo declara os md5 das duas funcoes novas");
  return { normaliza: par[1], move: par[2] };
};

Deno.test("3651: fase 0 do db-prove-rollback aceita o par (nada de BEGIN/COMMIT de nivel superior)", () => {
  const r = avaliarFase0({
    sqlMigration: sql,
    sqlRollback: rb,
    temRollback: true,
  });
  assert.equal(r.recusado, false, JSON.stringify(r));
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(rb)).achados, []);
});

Deno.test("3651: os md5 do pre-voo, da conferencia e do rollback sao os dos corpos do arquivo", () => {
  const h = hashes();
  assert.equal(md5(corpo(sql, NORMALIZA)), h.normaliza);
  assert.equal(md5(corpo(sql, MOVE)), h.move);
  // O rollback recusa redefinicao estranha com os MESMOS md5.
  assert.ok(rb.includes(`'${h.normaliza}'`) && rb.includes(`'${h.move}'`));
  // A reorder_banners_atomic do ar e' a da 1381, e nenhuma migration depois dela a redefine.
  assert.equal(md5(corpoDoReorder(sql1381)), H_REORDER);
  // As fichas 207a/207b conferem esse corpo no ar.
  for (const ficha of [
    "207a-conferir-a-ordem-dos-banners-numa-trava-so-aplicado",
    "207b-antes-a-ordem-dos-banners-numa-trava-so-base-vigente",
  ])
    assert.ok(
      ler(`scripts/publicacao/consultas/${ficha}.sql`).includes(
        `'${H_REORDER}'`,
      ),
      ficha,
    );
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const redefinem = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .filter((n) =>
      ler(`supabase/migrations/${n}`).includes(
        "CREATE OR REPLACE FUNCTION public.reorder_banners_atomic(",
      ),
    )
    .sort();
  assert.equal(
    redefinem.at(-1),
    "20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql",
  );
});

Deno.test("3651: as duas RPCs novas tem o padrao de seguranca da reorder_banners_atomic", () => {
  for (const marca of [NORMALIZA, MOVE]) {
    const c = cabeca(sql, marca);
    assert.match(
      c,
      /LANGUAGE plpgsql SECURITY DEFINER SET search_path = public$/,
      marca,
    );
    const b = corpo(sql, marca);
    // Admin de AGORA antes de tudo; a posicao antes da trava; a trava da pagina antes das linhas.
    const iAdmin = b.indexOf(
      "  IF NOT public.is_admin_atual() THEN\n    RAISE EXCEPTION 'Não autorizado';\n  END IF;",
    );
    const iPos = b.indexOf("RAISE EXCEPTION 'Posição inválida.';");
    const iTrava = b.indexOf(
      "PERFORM pg_advisory_xact_lock(hashtextextended('ikcous.banners.ordem:' || p_position, 0));",
    );
    const iLinhas = b.indexOf(
      'PERFORM 1 FROM public.banners WHERE "position" = p_position ORDER BY id FOR UPDATE;',
    );
    const iEscreve = b.indexOf("UPDATE public.banners");
    assert.ok(
      iAdmin > 0 &&
        iAdmin < iPos &&
        iPos < iTrava &&
        iTrava < iLinhas &&
        iLinhas < iEscreve,
      `ordem das guardas em ${marca}`,
    );
    assert.equal(b.split("pg_advisory_xact_lock").length - 1, 1);
    // Nada de SQL dinamico nem de tabela que nao seja banners.
    assert.ok(!/\bEXECUTE\b/.test(b));
    assert.ok(!/\b(INSERT|DELETE)\b/.test(b));
    // GRANT/REVOKE iguais aos da reorder_banners_atomic (20261120000000).
    const assinatura =
      marca === NORMALIZA
        ? "public.normalize_banners_atomic(text, uuid, boolean)"
        : "public.move_banner_atomic(text, uuid, text)";
    assert.ok(
      sql.includes(
        `REVOKE EXECUTE ON FUNCTION ${assinatura} FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION ${assinatura} TO authenticated, service_role;`,
      ),
      `ACL de ${assinatura}`,
    );
  }
});

Deno.test("3651: a arrumacao mantem a ordem da tela (nula = 0, recem-salvo no empate, id) e numera de 1 a n", () => {
  const b = corpo(sql, NORMALIZA);
  assert.ok(
    b.includes(
      '    ORDER BY COALESCE("order", 0) ASC,\n' +
        "             CASE WHEN id = p_prioritario THEN CASE WHEN p_prioritario_depois THEN 1 ELSE -1 END ELSE 0 END ASC,\n" +
        "             id ASC",
    ),
  );
  assert.ok(b.includes("v_next_order integer := 1;"));
  assert.ok(
    b.includes('IF v_banner."order" IS DISTINCT FROM v_next_order THEN'),
  );
  assert.match(
    cabeca(sql, NORMALIZA),
    /^CREATE OR REPLACE FUNCTION public\.normalize_banners_atomic\( p_position text, p_prioritario uuid DEFAULT NULL, p_prioritario_depois boolean DEFAULT false \) RETURNS integer /,
  );
});

Deno.test("3651: mover acha o vizinho DENTRO do banco, depois de arrumar, e recusa banner ausente com a frase do front", () => {
  const b = corpo(sql, MOVE);
  assert.match(
    cabeca(sql, MOVE),
    /^CREATE OR REPLACE FUNCTION public\.move_banner_atomic\( p_position text, p_banner_id uuid, p_direcao text \) RETURNS uuid /,
  );
  const iArruma = b.indexOf("FOR v_banner IN");
  const iAchado = b.indexOf(
    "  IF v_ordem IS NULL THEN\n    RAISE EXCEPTION 'Banner não encontrado.';\n  END IF;",
  );
  const iVizinho = b.indexOf(
    'AND "order" < v_ordem ORDER BY "order" DESC LIMIT 1;',
  );
  assert.ok(iArruma > 0 && iArruma < iAchado && iAchado < iVizinho);
  assert.ok(b.includes('AND "order" > v_ordem ORDER BY "order" ASC LIMIT 1;'));
  assert.ok(b.includes("RAISE EXCEPTION 'Direção inválida.';"));
  assert.ok(b.includes("p_direcao NOT IN ('cima', 'baixo')"));
  // Na ponta nao ha troca: devolve NULL; senao devolve o vizinho com quem trocou (o front confere com o da tela).
  assert.ok(
    b.includes("IF v_vizinho IS NULL THEN\n    RETURN NULL;\n  END IF;"),
  );
  assert.ok(b.trimEnd().endsWith("RETURN v_vizinho;\nEND;"));
  // A frase que o front ja trata (reorderBanners le "não encontrado").
  const front = ler("src/hooks/useBanners.ts");
  assert.ok(front.includes('mensagem.includes("não encontrado")'));
});

Deno.test("3651: pre-voo antes de criar, conferencia depois; nenhum DROP, UPDATE, DELETE, INSERT, ALTER nem TRUNCATE fora dos corpos", () => {
  const iPre = sql.indexOf("DO $preflight_20261651000000$");
  const iCria = sql.indexOf(`CREATE OR REPLACE FUNCTION ${NORMALIZA}`);
  const iConf = sql.indexOf("DO $conferencia_20261651000000$");
  assert.ok(iPre > 0 && iPre < iCria && iCria < iConf, "ordem");
  const semCorpo = removerRuido(sql);
  for (const proibido of [
    /\bDROP\b/i,
    /\bUPDATE\b/i,
    /\bDELETE\b/i,
    /\bINSERT\b/i,
    /\bTRUNCATE\b/i,
    /\bALTER\b/i,
  ])
    assert.ok(!proibido.test(semCorpo), `proibido: ${proibido}`);
  // So as duas funcoes novas nascem, e so elas ganham GRANT/REVOKE.
  assert.equal(semCorpo.split("CREATE OR REPLACE FUNCTION").length - 1, 2);
  assert.equal(semCorpo.split("GRANT EXECUTE ON FUNCTION").length - 1, 2);
  assert.equal(semCorpo.split("REVOKE EXECUTE ON FUNCTION").length - 1, 2);
  assert.ok(
    !sql.includes("CREATE OR REPLACE FUNCTION public.reorder_banners_atomic"),
  );
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(sql.includes("NOTIFY pgrst, 'reload schema';"));
  // A conferencia guarda a reorder_banners_atomic do ar inteira (fotografia do catalogo com o corpo).
  assert.ok(
    sql.includes("current_setting('ikcous.ordem_banners_1651_reorder')"),
  );
});

Deno.test("3651: o rollback so tira as duas funcoes novas (nada mais) e recusa corpo estranho", () => {
  const semCorpo = removerRuido(rb);
  const drops = semCorpo.match(/DROP[^;]*;/g) ?? [];
  assert.deepEqual(drops, [
    "DROP FUNCTION IF EXISTS public.move_banner_atomic(text, uuid, text);",
    "DROP FUNCTION IF EXISTS public.normalize_banners_atomic(text, uuid, boolean);",
  ]);
  for (const proibido of [
    /\bUPDATE\b/i,
    /\bDELETE\b/i,
    /\bINSERT\b/i,
    /\bCREATE\b/i,
    /\bALTER\b/i,
  ])
    assert.ok(!proibido.test(semCorpo), `proibido no rollback: ${proibido}`);
  const iPre = rb.indexOf("DO $preflight_rollback_20261651000000$");
  const iDrop = rb.indexOf("DROP FUNCTION IF EXISTS");
  const iConf = rb.indexOf("DO $conferencia_rollback_20261651000000$");
  assert.ok(iPre > 0 && iPre < iDrop && iDrop < iConf);
  assert.ok(
    rb.includes("current_setting('ikcous.ordem_banners_1651_rb_reorder')"),
  );
  assert.ok(rb.includes("NOTIFY pgrst, 'reload schema';"));
});

Deno.test("3651: a prova viva roda no job do dinheiro e tem linha no LEIA-ME; as portas novas sao so do logado", () => {
  const rpc = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    rpc.includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/a-ordem-dos-banners-muda-numa-trava-so-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-ordem-dos-banners-muda-numa-trava-so-viva.cjs",
    ),
  );
  const portas = JSON.parse(
    ler("tests/banco/portas-do-visitante-permitidas.json"),
  ).funcoes as {
    funcao: string;
    executa: string[];
    secdef: boolean;
    tipo: string;
  }[];
  for (const funcao of [
    "public.normalize_banners_atomic(p_position text, p_prioritario uuid, p_prioritario_depois boolean)",
    "public.move_banner_atomic(p_position text, p_banner_id uuid, p_direcao text)",
  ]) {
    const linha = portas.filter((p) => p.funcao === funcao);
    assert.equal(linha.length, 1, funcao);
    assert.deepEqual(linha[0].executa, ["authenticated"]);
    assert.equal(linha[0].secdef, true);
    assert.equal(linha[0].tipo, "volatil");
  }
});

Deno.test("3651: as RPCs usam is_admin_atual, entao as provas que desfazem a 97 as desfazem antes (fim de POSTERIORES_A_97)", () => {
  const {
    A_ORDEM_DOS_BANNERS,
  } = require("./banco/a-ordem-dos-banners-posterior.cjs");
  assert.equal(A_ORDEM_DOS_BANNERS.nome, nome);
  assert.match(
    A_ORDEM_DOS_BANNERS.noAr,
    /move_banner_atomic\(text,uuid,text\)/,
  );
  for (const corpo of [sql]) {
    assert.ok(/is_admin_atual\(\)/.test(corpo));
  }
  for (const arq of [
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/pagamentos-rpc-viva.cjs",
  ]) {
    const t = ler(arq);
    assert.ok(t.includes("  A_ORDEM_DOS_BANNERS,\n];"), arq);
    assert.ok(
      t.includes('require("./a-ordem-dos-banners-posterior.cjs")'),
      arq,
    );
  }
  assert.ok(ler("tests/banco/LEIA-ME.md").includes("A_ORDEM_DOS_BANNERS"));
});
