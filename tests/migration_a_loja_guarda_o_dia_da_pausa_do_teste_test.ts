// @ts-nocheck
/* eslint-disable security/detect-object-injection -- os indices vem de listas fechadas deste arquivo, nunca de entrada de rede. */
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
