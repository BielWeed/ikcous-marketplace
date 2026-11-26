// @ts-nocheck
/* eslint-disable security/detect-object-injection -- os indices vem de listas fechadas deste arquivo (nomes das consultas), nunca de entrada de rede. */
/* eslint-disable security/detect-unsafe-regex, security/detect-non-literal-regexp -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), então não há ReDoS possível; mesma razão dos outros testes migration_*. */
// A LOJA GUARDA O DIA DA PAUSA DO TESTE — leitura do TEXTO da 20261590000000 (sucessora da porta da 20261399998000).
// O COMPORTAMENTO (gestao velha de 10 chaves, gestao nova de 11, ausente apaga, a data torta recusada, a simulacao, o erro exato da porta velha,
// reaplicar, rollback, pre/pos-voo) e' provado no Postgres efemero por tests/banco/a-loja-guarda-o-dia-da-pausa-do-teste-viva.cjs; aqui ficam as
// ancoras que se leem do arquivo, sem banco:
//   - a migration e' ADITIVA e SEM transacao propria: UMA coluna nova (pausa_em date, anulavel, sem padrao) e a porta redefinida;
//   - o corpo novo da porta e' o da 20261399998000 com SO as mudancas da chave opcional (o resto e' byte a byte);
//   - as 10 chaves obrigatorias sao as mesmas; pausa_em fica fora delas e dentro da lista branca; a data passa pela MESMA regra;
//   - a porta continua autenticando ANTES de olhar p_dados e nunca escreve recursos nem observacao;
//   - o pre-voo aceita os dois corpos (o da 20261399998000 e o desta), o pos-voo so o desta.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const NOME = "20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql";
const ANTERIOR = "20261399998000_a_loja_recebe_o_plano_por_porta_unica.sql";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const migration = lerMig(NOME);
const anterior = lerMig(ANTERIOR);
const rollback = lerMig(`rollback-manual-${NOME}`);
const destrutivo = lerMig(`rollback-manual-destrutivo-${NOME}`);

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const contar = (texto: string, trecho: string) =>
  texto.split(trecho).length - 1;
const semComentario = (s: string) => s.replace(/--.*$/gm, "");

/** O corpo (prosrc) da funcao: o texto entre os dois $function$ do CREATE OR REPLACE dela. */
function corpoDe(sql: string, funcao: string): string {
  const marca = `CREATE OR REPLACE FUNCTION public.${funcao}(`;
  assertEquals(contar(sql, marca), 1, `uma definicao de ${funcao}`);
  const ini = sql.indexOf(marca);
  const abre = sql.indexOf("AS $function$", ini) + "AS $function$".length;
  return sql.slice(abre, sql.indexOf("$function$;", abre));
}
/** O cabecalho da funcao: do CREATE OR REPLACE ate o AS $function$ (assinatura e atributos). */
function cabecalhoDe(sql: string, funcao: string): string {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${funcao}(`);
  return sql.slice(ini, sql.indexOf("AS $function$", ini));
}
/** O bloco `DO $tag$ ... END $tag$;` da migration. */
function blocoDo(sql: string, tag: string): string {
  const i = sql.indexOf(`DO $${tag}$`);
  assert(i >= 0, `bloco ${tag} ausente`);
  const fim = sql.indexOf(`END $${tag}$;`, i);
  assert(fim > i, `fim do bloco ${tag} ausente`);
  return sql.slice(i, fim + `END $${tag}$;`.length);
}
/** A migration sem comentario, sem corpo de funcao e sem bloco DO: so os comandos de nivel superior. */
function soComandos(sql: string): string {
  return sql
    .replace(/\$function\$[\s\S]*?\$function\$/g, "$function$$function$")
    .replace(/DO \$(\w+)\$[\s\S]*?END \$\1\$;/g, "")
    .replace(/--.*$/gm, "")
    .replace(/'[^']*'/g, "''");
}

const CORPO = corpoDe(migration, "assinatura_da_loja_gravar");
const CORPO_ANTERIOR = corpoDe(anterior, "assinatura_da_loja_gravar");
const H_NOVO = md5(CORPO);
const H_ANTERIOR = "565f82cb9a65ed96e4702db9d97bf0d6";
const H_DEFINIR = "ee89c0e70e378fe0be0fc3c805567d56";
const H_LER = "edeff71c925244a7a450c817d0acd6ae";
const TREZE =
  "atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false";
const QUATORZE =
  "atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,pausa_em:date:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false";

/** As UNICAS mudancas do corpo da 20261399998000 para o desta migration, cada uma aplicada uma vez. */
const MUDANCAS: Array<[string, string]> = [
  [
    "  v_chaves CONSTANT text[] := ARRAY['plano', 'status', 'ciclo', 'valor_mensal', 'inicio_em', 'teste_ate', 'proxima_cobranca_em', 'suporte_whatsapp', 'gerenciar_url', 'atualizado_em'];\n",
    "  v_chaves CONSTANT text[] := ARRAY['plano', 'status', 'ciclo', 'valor_mensal', 'inicio_em', 'teste_ate', 'proxima_cobranca_em', 'suporte_whatsapp', 'gerenciar_url', 'atualizado_em'];\n  v_opcionais CONSTANT text[] := ARRAY['pausa_em'];\n",
  ],
  [
    "  -- c) Forma de p_dados: objeto JSON, so as 10 chaves da lista, todas presentes.\n",
    "  -- c) Forma de p_dados: objeto JSON, so as 10 chaves da lista (todas presentes) e a opcional pausa_em (ausente = NULL).\n",
  ],
  [
    "WHERE k <> ALL (v_chaves) ORDER BY k LIMIT 1;",
    "WHERE k <> ALL (v_chaves || v_opcionais) ORDER BY k LIMIT 1;",
  ],
  [
    "  FOREACH v_campo IN ARRAY ARRAY['inicio_em', 'teste_ate', 'proxima_cobranca_em'] LOOP\n    IF jsonb_typeof(p_dados -> v_campo) = 'null' THEN\n",
    "  -- pausa_em passa pela MESMA regra das outras datas; ausente vira NULL (as outras tres ja foram exigidas acima).\n  FOREACH v_campo IN ARRAY ARRAY['inicio_em', 'teste_ate', 'proxima_cobranca_em', 'pausa_em'] LOOP\n    IF (p_dados -> v_campo) IS NULL OR jsonb_typeof(p_dados -> v_campo) = 'null' THEN\n",
  ],
  [
    "      'proxima_cobranca_em', (v_datas ->> 'proxima_cobranca_em')::date,\n",
    "      'proxima_cobranca_em', (v_datas ->> 'proxima_cobranca_em')::date, 'pausa_em', (v_datas ->> 'pausa_em')::date,\n",
  ],
  [
    "'proxima_cobranca_em', v_atual.proxima_cobranca_em,\n",
    "'proxima_cobranca_em', v_atual.proxima_cobranca_em, 'pausa_em', v_atual.pausa_em,\n",
  ],
  [
    "  -- e) Grava: UM comando atomico; o WHERE do ON CONFLICT e' quem barra a gravacao mais velha (inclusive na corrida entre duas conexoes). recursos e observacao ficam fora.\n",
    "  -- e) Grava: UM comando atomico; o WHERE do ON CONFLICT e' quem barra a gravacao mais velha (inclusive na corrida entre duas conexoes). recursos e observacao ficam fora;\n  --    pausa_em ausente grava NULL (apaga o dia velho).\n",
  ],
  [
    "teste_ate, proxima_cobranca_em, suporte_whatsapp, gerenciar_url, atualizado_em)\n",
    "teste_ate, proxima_cobranca_em, pausa_em, suporte_whatsapp, gerenciar_url, atualizado_em)\n",
  ],
  [
    "(v_datas ->> 'proxima_cobranca_em')::date, v_whatsapp, v_url, v_instante)\n",
    "(v_datas ->> 'proxima_cobranca_em')::date, (v_datas ->> 'pausa_em')::date, v_whatsapp, v_url, v_instante)\n",
  ],
  [
    "    proxima_cobranca_em = EXCLUDED.proxima_cobranca_em,\n",
    "    proxima_cobranca_em = EXCLUDED.proxima_cobranca_em,\n    pausa_em = EXCLUDED.pausa_em,\n",
  ],
];

Deno.test("20261590: sem transacao propria, texto LF, lock_timeout de 5 s e NOTIFY por ultimo", () => {
  const t = detectarTransacaoExplicita(removerRuido(migration));
  assertEquals(t.achados, [], `controle de transacao: ${t.achados.join("/")}`);
  assert(!migration.includes("\r"));
  assertStringIncludes(migration, "SET LOCAL lock_timeout = '5s';");
  assertStringIncludes(migration, "SET LOCAL statement_timeout = '30s';");
  assertStringIncludes(
    migration.trimEnd().split("\n").pop() ?? "",
    "NOTIFY pgrst, 'reload schema';",
  );
});

Deno.test("20261590: ADITIVA - UMA coluna nova (pausa_em date, anulavel, sem padrao) e a porta redefinida; nada apagado, regravado ou criado alem disso", () => {
  const cod = soComandos(migration);
  const alters = cod.match(/ALTER\s+[^;]*;/gi) ?? [];
  assertEquals(alters.map(norm), [
    "ALTER TABLE public.assinatura_da_loja ADD COLUMN IF NOT EXISTS pausa_em date;",
  ]);
  for (const proibido of [
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\b/i,
    /\bINSERT\b/i,
    /\bNOT\s+NULL\b/i,
    /CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i,
    /CREATE\s+POLICY/i,
    /CREATE\s+(UNIQUE\s+)?INDEX/i,
    /CREATE\s+TABLE/i,
    /CREATE\s+EXTENSION/i,
  ]) {
    assert(
      !proibido.test(cod),
      `comando de nivel superior proibido: ${proibido}`,
    );
  }
  // o unico DEFAULT de nivel superior e' o do argumento p_simular (a coluna nasce sem padrao)
  assertEquals(
    (cod.match(/\bDEFAULT\b/gi) ?? []).length,
    1,
    "a coluna nasce sem padrao",
  );
  assertEquals(
    [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(
      (m) => m[1],
    ),
    ["assinatura_da_loja_gravar"],
    "so a porta e' redefinida (definir_chave e o leitor ficam como estao)",
  );
});

Deno.test("20261590: o corpo novo e' o da 20261399998000 com SO as mudancas da chave opcional (o resto byte a byte) e o cabecalho e' o mesmo", () => {
  let esperado = CORPO_ANTERIOR;
  for (const [de, para] of MUDANCAS) {
    assertEquals(contar(esperado, de), 1, `trecho a mudar: ${de.slice(0, 80)}`);
    esperado = esperado.replace(de, para);
  }
  assertEquals(CORPO, esperado);
  assertEquals(md5(CORPO_ANTERIOR), H_ANTERIOR, "o corpo anterior e' o vivo");
  assert(H_NOVO !== H_ANTERIOR);
  assertEquals(
    norm(cabecalhoDe(migration, "assinatura_da_loja_gravar")),
    norm(cabecalhoDe(anterior, "assinatura_da_loja_gravar")),
  );
});

Deno.test("20261590: as 10 obrigatorias sao as da 20261399998000; pausa_em fica FORA delas, DENTRO da lista branca, e passa pela mesma regra de data", () => {
  const lista = (corpo: string, nome: string) => {
    const m = new RegExp(
      `${nome} CONSTANT text\\[\\] := ARRAY\\[([^\\]]*)\\];`,
    ).exec(corpo);
    assert(m, `${nome} nao achada`);
    return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  };
  const obrigatorias = lista(CORPO, "v_chaves");
  assertEquals(obrigatorias, lista(CORPO_ANTERIOR, "v_chaves"));
  assertEquals(obrigatorias.length, 10);
  assert(!obrigatorias.includes("pausa_em"));
  assertEquals(lista(CORPO, "v_opcionais"), ["pausa_em"]);
  assertStringIncludes(
    CORPO,
    "SELECT k INTO v_campo FROM jsonb_object_keys(p_dados) AS k WHERE k <> ALL (v_chaves || v_opcionais) ORDER BY k LIMIT 1;",
  );
  assertStringIncludes(
    norm(CORPO),
    "FOREACH v_campo IN ARRAY v_chaves LOOP IF (p_dados -> v_campo) IS NULL THEN RAISE EXCEPTION 'campo_ausente'",
  );
  assertEquals(contar(CORPO, "v_opcionais"), 2);
  assertStringIncludes(
    CORPO,
    "FOREACH v_campo IN ARRAY ARRAY['inicio_em', 'teste_ate', 'proxima_cobranca_em', 'pausa_em'] LOOP",
  );
  assertStringIncludes(
    CORPO,
    "IF v_texto IS NULL OR v_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN",
  );
  // grava pausa_em: ausente vira NULL e o UPDATE reescreve os 11 campos (nunca COALESCE com o valor antigo)
  assertStringIncludes(CORPO, "    pausa_em = EXCLUDED.pausa_em,\n");
  assertEquals(
    (CORPO.match(/^\s+\w+ = EXCLUDED\.\w+,?$/gm) ?? []).length,
    11,
    "o UPDATE reescreve exatamente os 11 campos",
  );
  assert(!/COALESCE\s*\(\s*EXCLUDED/i.test(CORPO));
});

Deno.test("20261590: a porta continua autenticando ANTES de olhar p_dados e nunca escreve recursos nem observacao nem monta SQL dinamico", () => {
  const iNegado = CORPO.indexOf("'nao_autorizado'");
  const antes = semComentario(CORPO.slice(0, iNegado));
  assert(iNegado > 0);
  assert(!/p_dados/.test(antes), "p_dados so e' lido DEPOIS de autenticar");
  // antes da recusa, pausa_em so aparece na declaracao da lista (um nome, nao um dado)
  assert(
    !/pausa_em/.test(
      antes.replace("v_opcionais CONSTANT text[] := ARRAY['pausa_em'];", ""),
    ),
    "pausa_em so e' lida DEPOIS de autenticar",
  );
  const corpo = semComentario(CORPO);
  assert(!/\brecursos\b/.test(corpo), "recursos nao aparece no corpo");
  assert(!/\bobservacao\b/.test(corpo), "observacao nao aparece no corpo");
  assert(
    !/\bDELETE\b|\bTRUNCATE\b|\bDROP\b|\bEXECUTE\b|\bformat\s*\(/i.test(corpo),
    "sem delete/truncate/drop/SQL dinamico",
  );
  assertEquals(contar(corpo, "INSERT INTO"), 1, "uma unica escrita");
  for (const m of CORPO.matchAll(/RAISE EXCEPTION[^;]*;/g)) {
    assert(
      !/p_dados\s*->>?\s*'/.test(m[0]),
      `a excecao devolve valor do dado: ${m[0]}`,
    );
  }
});

Deno.test("20261590: ACL igual a da 20261399998000 - REVOKE de todos e GRANT so a anon e authenticated, nada a PUBLIC", () => {
  const n = norm(migration);
  const rev =
    "REVOKE ALL ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;";
  const gran =
    "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) TO anon, authenticated;";
  assertEquals(contar(n, rev), 1);
  assertEquals(contar(n, gran), 1);
  assert(n.indexOf(rev) < n.indexOf(gran));
  assertStringIncludes(norm(anterior), rev);
  assertStringIncludes(norm(anterior), gran);
  const cod = soComandos(migration);
  assertEquals((cod.match(/GRANT[^;]*;/g) ?? []).length, 1);
  assertEquals((cod.match(/REVOKE[^;]*;/g) ?? []).length, 1);
  assertEquals(contar(cod.replace(/\s+/g, " "), "SECURITY DEFINER"), 1);
});

Deno.test("20261590: pre-voo ANTES do ALTER aceita os DOIS corpos e as duas formas da tabela; pos-voo DEPOIS do GRANT confere so o desta", () => {
  const pre = blocoDo(migration, "preflight_20261590000000");
  const pos = blocoDo(migration, "conferencia_20261590000000");
  assert(
    migration.indexOf(pre) <
      migration.indexOf(
        "ALTER TABLE public.assinatura_da_loja ADD COLUMN IF NOT EXISTS pausa_em date;",
      ),
  );
  assert(
    migration.indexOf(pos) >
      migration.indexOf(
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar",
      ),
  );
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(pos, "B2_POSVOO_DIVERGENTE");
  assertEquals(contar(pre, `'${H_ANTERIOR}'`), 1);
  assertEquals(contar(pre, `'${H_NOVO}'`), 1);
  assertEquals(contar(pre, `'${H_DEFINIR}'`), 1);
  assertStringIncludes(pre, `'${TREZE}'`);
  assertStringIncludes(pre, `'${QUATORZE}'`);
  for (const premissa of ["pg_roles", "sobrecarga", "corpo desconhecido"])
    assertStringIncludes(pre, premissa);
  assertEquals(contar(pos, `'${H_NOVO}'`), 1);
  assertEquals(contar(pos, `'${H_ANTERIOR}'`), 0);
  assertEquals(contar(pos, `'${H_DEFINIR}'`), 1);
  assertEquals(contar(pos, `'${H_LER}'`), 1);
  assertStringIncludes(pos, `'${QUATORZE}'`);
  for (const marca of [
    "pg_attrdef",
    "has_function_privilege",
    "aclexplode",
    "proconfig",
    "prosecdef",
    "provolatile",
    "rolbypassrls",
    "'anon'",
    "'authenticated'",
    "'service_role'",
  ])
    assertStringIncludes(pos, marca);
  assertEquals(contar(migration, `'${H_NOVO}'`), 2, "o md5 novo: pre e pos");
  assert(
    contar(migration, "md5(replace(prosrc, E'\\r', ''))") >= 2,
    "pre-voo e pos-voo normalizam o CR",
  );
  assert(
    !/SELECT\s+public\.assinatura_da_loja_gravar\s*\(/i.test(pos),
    "o pos-voo nao chama a porta",
  );
  assert(
    !/\bINSERT\b|\bUPDATE\b|\bDELETE\b/.test(
      semComentario(pos).replace(/'[^']*'/g, "''"),
    ),
    "o pos-voo so le o catalogo",
  );
});

Deno.test("20261590: os tipos do app conhecem a coluna (Row anulavel; Insert e Update opcionais)", () => {
  const tipos = Deno.readTextFileSync(
    `${RAIZ}/src/types/database.types.ts`,
  ).replace(/\r/g, "");
  const i = tipos.indexOf("      assinatura_da_loja: {\n");
  assert(i >= 0);
  const bloco = tipos.slice(i, tipos.indexOf("        Relationships:", i));
  const parte = (nome: string) => {
    const a = bloco.indexOf(`        ${nome}: {\n`);
    assert(a >= 0, nome);
    return bloco.slice(a, bloco.indexOf("        };\n", a));
  };
  assertStringIncludes(parte("Row"), "          pausa_em: string | null;\n");
  assertStringIncludes(
    parte("Insert"),
    "          pausa_em?: string | null;\n",
  );
  assertStringIncludes(
    parte("Update"),
    "          pausa_em?: string | null;\n",
  );
});

Deno.test("20261590: o par passa a Fase 0 do db-prove-rollback e nenhum dos dois rollbacks abre transacao propria", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  for (const [rotulo, sql] of [
    ["rollback", rollback],
    ["destrutivo", destrutivo],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${rotulo}: ${t.achados.join("/")}`);
    assert(!sql.includes("\r"), `${rotulo}: LF`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
  }
});

Deno.test("20261590: o rollback COMUM devolve a porta da 20261399998000 BYTE A BYTE (texto, ACL e comentario) e MANTEM a coluna", () => {
  // o CREATE OR REPLACE inteiro (cabecalho + corpo) e' o da anterior, letra por letra
  const texto = (sql: string) => {
    const i = sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(",
    );
    const a = sql.indexOf("AS $function$", i);
    return sql.slice(i, sql.indexOf("$function$;", a) + "$function$;".length);
  };
  assertEquals(texto(rollback), texto(anterior));
  assertEquals(md5(corpoDe(rollback, "assinatura_da_loja_gravar")), H_ANTERIOR);
  for (const linha of [
    "REVOKE ALL ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;",
    "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) TO anon, authenticated;",
  ])
    assertEquals(contar(rollback, linha), 1, linha);
  const comentario = (sql: string) =>
    /COMMENT ON FUNCTION public\.assinatura_da_loja_gravar\(text, jsonb, boolean\) IS '[^']*';/.exec(
      sql,
    )?.[0];
  assertEquals(comentario(rollback), comentario(anterior));
  // so a porta: nada apagado (a coluna e os dias guardados ficam), nada escrito
  const cod = soComandos(rollback);
  assert(
    !/\bDROP\b|\bALTER\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bINSERT\b/i.test(
      cod,
    ),
  );
  assertEquals(
    [...rollback.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(
      (m) => m[1],
    ),
    ["assinatura_da_loja_gravar"],
  );
  const pre = blocoDo(rollback, "preflight_rollback_20261590000000");
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  assertEquals(contar(pre, `'${H_NOVO}'`), 1);
  assertEquals(contar(pre, `'${H_ANTERIOR}'`), 1);
  assert(
    rollback.indexOf(pre) < rollback.indexOf("CREATE OR REPLACE FUNCTION"),
  );
  const conf = blocoDo(rollback, "conferencia_rollback_20261590000000");
  assertEquals(contar(conf, `'${H_ANTERIOR}'`), 1);
  assertEquals(contar(conf, `'${H_NOVO}'`), 0);
  assertStringIncludes(rollback, "MANTEM");
  assertStringIncludes(
    rollback.trimEnd().split("\n").pop() ?? "",
    "NOTIFY pgrst, 'reload schema';",
  );
});

Deno.test("20261590: o rollback DESTRUTIVO so apaga a coluna, so com confirmacao, so depois do comum e so se nenhuma funcao ainda le pausa_em", () => {
  const cod = soComandos(destrutivo);
  const drops = [...cod.matchAll(/ALTER\s+TABLE[^;]*;|DROP[^;]*;/gi)].map((m) =>
    norm(m[0]),
  );
  assertEquals(drops, [
    "ALTER TABLE public.assinatura_da_loja DROP COLUMN IF EXISTS pausa_em;",
  ]);
  assert(!/CASCADE/i.test(semComentario(destrutivo)), "sem CASCADE");
  assert(!/CREATE|GRANT|REVOKE|DELETE|UPDATE|INSERT|TRUNCATE/i.test(cod));
  const pre = blocoDo(destrutivo, "destrutivo_20261590000000");
  assert(
    destrutivo.indexOf(pre) <
      destrutivo.indexOf("ALTER TABLE public.assinatura_da_loja DROP COLUMN"),
  );
  assertStringIncludes(
    pre,
    "current_setting('app.confirmo_apagar_pausa_em', true)",
  );
  assertStringIncludes(pre, "'APAGAR'");
  // a porta tem de ter voltado a da 20261399998000 (o comum antes)
  assertEquals(contar(pre, `'${H_ANTERIOR}'`), 1);
  assertStringIncludes(pre, "PAUSA_ROLLBACK_COMUM_PRIMEIRO");
  // nenhuma funcao (de qualquer lote) pode continuar lendo a coluna
  assertStringIncludes(pre, "prosrc");
  assertStringIncludes(pre, "pausa_em");
  const conf = blocoDo(destrutivo, "conferencia_destrutivo_20261590000000");
  assertStringIncludes(conf, `'${TREZE}'`);
  assertStringIncludes(destrutivo, "SO COM O DONO");
});

Deno.test("20261590: o db-apply confere a porta nova pelos marcadores da 20261399998000 e pelo da chave opcional; a 150c aceita os dois corpos", () => {
  const dbApply = Deno.readTextFileSync(`${RAIZ}/scripts/db-apply.cjs`).replace(
    /\r/g,
    "",
  );
  const i = dbApply.indexOf(`"${NOME}": [`);
  assert(i >= 0, "a entrada da 20261590000000 nao esta no db-apply");
  const entrada = dbApply.slice(i, dbApply.indexOf("\n  ],\n", i));
  assertStringIncludes(entrada, 'funcao: "assinatura_da_loja_gravar"');
  for (const marcador of [
    "WHERE k <> ALL (v_chaves || v_opcionais) ORDER BY k LIMIT 1;",
    "IF (p_dados -> v_campo) IS NULL OR jsonb_typeof(p_dados -> v_campo) = 'null' THEN",
    "pausa_em = EXCLUDED.pausa_em,",
    "WHERE a.atualizado_em <= EXCLUDED.atualizado_em;",
    "RAISE EXCEPTION 'nao_autorizado' USING ERRCODE = '42501';",
  ])
    assertStringIncludes(entrada, marcador);
  const c150 = Deno.readTextFileSync(
    `${RAIZ}/scripts/publicacao/consultas/150c-conferir-a-loja-recebe-o-plano-por-porta-unica-aplicado.sql`,
  ).replace(/\r/g, "");
  assertStringIncludes(c150, `h IN ('${H_ANTERIOR}', '${H_NOVO}')`);
});

Deno.test("195a/195b (rol fechado de 6 e 4), canais-de-backend, menu do conferir-banco, rpc-ci (2 caminhos + a prova) e CONSULTAS_DE_ROL_FECHADO registram a migration", async () => {
  const {
    contarStatements,
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO, lerCanais } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  const A = "195a-conferir-a-loja-guarda-o-dia-da-pausa-do-teste-aplicado";
  const B = "195b-antes-a-loja-guarda-o-dia-da-pausa-do-teste-ausente";
  assertEquals(ROL_FECHADO_POR_CONSULTA[A]?.length, 6);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B]?.length, 4);
  const menu = Deno.readTextFileSync(
    `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`,
  ).replace(/\r/g, "");
  const rpc = Deno.readTextFileSync(
    `${RAIZ}/.github/workflows/rpc-ci.yml`,
  ).replace(/\r/g, "");
  for (const nome of [A, B]) {
    const sql = Deno.readTextFileSync(
      `${RAIZ}/scripts/publicacao/consultas/${nome}.sql`,
    );
    assertEquals(contarStatements(sql), 1, `${nome}: UM statement`);
    const rol = ROL_FECHADO_POR_CONSULTA[nome];
    const rotulos = [...sql.matchAll(/SELECT '([^']+)', '(?:sim|nao)'/g)].map(
      (m) => m[1],
    );
    assertEquals(rotulos.sort(), [...rol].sort(), `${nome}: rotulos != rol`);
    const codigo = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/.test(
        codigo,
      ),
      `${nome}: so leitura`,
    );
    assert(
      !/\bFROM\s+(public\.)?assinatura_da_loja(_chave)?\b/i.test(codigo),
      `${nome}: nao le linha do cartao nem da chave`,
    );
    assert(
      CONSULTAS_DE_ROL_FECHADO.has(nome),
      `${nome} fora de CONSULTAS_DE_ROL_FECHADO`,
    );
    assertStringIncludes(menu, `          - ${nome}\n`);
    assertEquals(
      rpc.split(`"scripts/publicacao/consultas/${nome}.sql"`).length - 1,
      2,
      `${nome}: nas duas listas de caminhos do rpc-ci`,
    );
  }
  assertEquals(
    contar(
      rpc,
      "node tests/banco/rodar-isolado.cjs tests/banco/a-loja-guarda-o-dia-da-pausa-do-teste-viva.cjs",
    ),
    1,
  );
  const lote = lerCanais().provasDeObjetos.find(
    (p: { consulta: string }) => p.consulta === A,
  );
  assert(lote, "lote ausente em canais-de-backend.json");
  assertEquals(lote.versoes, ["20261590000000"]);
  assertEquals(lote.ausenciaConfirmadaPor, B);
  assertEquals(lote.backfillLedger, undefined);
  assertEquals(lote.nuncaAplicar, undefined);
  assertStringIncludes(lote._comentario, "aditiva");
  assertStringIncludes(lote._comentario, "exige a 20261399998000");
});
