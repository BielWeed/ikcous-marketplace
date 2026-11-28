// @ts-nocheck
/* eslint-disable security/detect-object-injection -- o indice e' o nome fixo desta migration, nunca entrada de rede. */
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), entao nao ha ReDoS possivel; mesma razao dos outros testes migration_*. */
// A PECA DA VARIACAO DESLIGADA ESPERA A LOJISTA — leitura do TEXTO da 20261653000000 e do rollback dela.
// O COMPORTAMENTO (o defeito com os corpos da 20261642000000, a peca da variacao desligada no cantinho ou no pai, o controle com a variacao
// ligada, nenhum credito em dobro, os mutantes, reaplicar, pre-voo, rollback e as consultas 209a/209b) e' provado no Postgres efemero
// por tests/banco/a-peca-da-variacao-desligada-viva.cjs; aqui ficam as ancoras que se leem do arquivo, sem banco:
//   - a migration e' ADITIVA, SEM transacao propria e SEM escrita em dado;
//   - os dois corpos novos sao os vigentes (os da 20261642000000) com SO o bloco marcado, byte a byte;
//   - os md5 do pre-voo, do pos-voo, do rollback, das consultas e do modulo posterior sao os dos corpos que os arquivos carregam;
//   - o rollback devolve os blocos da 20261642000000 BYTE A BYTE, passa a Fase 0 e nao apaga nada;
//   - a migration esta ligada na release (canais, consultas, conferir-banco, rpc-ci, db-apply) e as provas da 20261642000000 a desfazem antes.
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
const NOME = "20261653000000_a_peca_da_variacao_desligada_espera_a_lojista.sql";
const NOME_642 =
  "20261642000000_a_peca_que_volta_sem_tamanho_espera_a_lojista.sql";
const A209 =
  "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado";
const B209 =
  "209b-antes-a-peca-da-variacao-desligada-espera-a-lojista-base-vigente";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const lerTexto = (rel: string) =>
  Deno.readTextFileSync(`${RAIZ}/${rel}`).replace(/\r/g, "");
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const m642 = lerMig(NOME_642);
const semComentario = (s: string) => s.replace(/--.*$/gm, "");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const bloco = (sql: string, inicio: string, fim: string) => {
  const i = sql.indexOf(inicio);
  assert(i >= 0, `bloco ausente: ${inicio}`);
  assertEquals(sql.indexOf(inicio, i + 1), -1, `bloco repetido: ${inicio}`);
  return sql.slice(i, sql.indexOf(fim, i) + fim.length);
};
const corpo = (b: string, tag: string) => {
  const a = b.indexOf(`AS ${tag}`) + `AS ${tag}`.length;
  return b.slice(a, b.indexOf(tag, a));
};
const DEV = [
  "CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)",
  "\n$devolver$;",
];
const CONCL = [
  "CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(",
  "\n$$;",
];
const dev642 = bloco(m642, DEV[0], DEV[1]);
const concl642 = bloco(m642, CONCL[0], CONCL[1]);
const devNovo = bloco(migration, DEV[0], DEV[1]);
const conclNovo = bloco(migration, CONCL[0], CONCL[1]);

const H_DEV_642 = "80b1a90baf10d1b4c59484772e4864c4";
const H_CONCL_642 = "1a548896acb8248f1b1771d765c92fcb";
const H_DEV = md5(corpo(devNovo, "$devolver$"));
const H_CONCL = md5(corpo(conclNovo, "$$"));
const blocoDo = (sql: string, marca: string) => {
  const i = sql.indexOf(`DO $${marca}$`);
  assert(i >= 0, `bloco ${marca} ausente`);
  return sql.slice(i, sql.indexOf(`END $${marca}$;`, i));
};
const ramo = (b: string, recuo: string) => {
  const ini = b.indexOf(
    `${recuo}-- >>> a peca da variacao desligada (20261653000000)\n`,
  );
  const marcaFim = `${recuo}-- <<< a peca da variacao desligada (20261653000000)\n`;
  const fim = b.indexOf(marcaFim) + marcaFim.length;
  assert(ini > 0 && fim > ini, "o bloco marcado nao foi achado");
  assertEquals(b.split(marcaFim).length, 2, "o bloco marcado aparece 1x");
  return { ini, fim, texto: b.slice(ini, fim) };
};

Deno.test("20261653: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s, e passa a Fase 0", () => {
  for (const [rotulo, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${rotulo}: ${t.achados.join("/")}`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
    assert(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"), rotulo);
  }
  for (const arq of [NOME, `rollback-manual-${NOME}`])
    assert(
      !Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).includes(
        "\r",
      ),
      `${arq}: LF`,
    );
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("20261653: os corpos de partida ainda sao os vigentes (os da 20261642000000) e esta e' a ultima que redefine os dois", () => {
  assertEquals(md5(corpo(dev642, "$devolver$")), H_DEV_642);
  assertEquals(md5(corpo(concl642, "$$")), H_CONCL_642);
  const fontes = (re: RegExp) =>
    [...Deno.readDirSync(`${RAIZ}/supabase/migrations`)]
      .map((e) => e.name)
      .filter((n) => /^\d{14}_.*\.sql$/.test(n))
      .sort()
      .filter((n) => re.test(semComentario(lerMig(n))));
  for (const re of [
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.devolver_estoque\s*\(/i,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_devolucao_concluir\s*\(/i,
  ]) {
    const f = fontes(re);
    assertEquals(f.at(-1), NOME, `${re}: outra redefine depois desta`);
    assertEquals(f.at(-2), NOME_642, `${re}: a antecessora e' a 642`);
  }
});

Deno.test("20261653: devolver_estoque novo = o da 20261642000000 com SO o bloco marcado, antes do IF do credito, byte a byte", () => {
  const { ini, fim, texto } = ramo(devNovo, "        ");
  assertEquals(devNovo.slice(0, ini) + devNovo.slice(fim), dev642);
  // o bloco fica DEPOIS do "credito = 0 pula" e logo ANTES do IF/ELSIF/ELSE da 642 (que decide o destino)
  assert(devNovo.indexOf("IF v_credito = 0 THEN") < ini);
  assert(
    devNovo.indexOf(
      "        -- IF/ELSE, não dois IF: a v23 debita XOR (variante OU produto, nunca os\n",
    ) === fim,
  );
  assertStringIncludes(
    texto,
    "        IF v_item.variant_id IS NOT NULL\n           AND NOT EXISTS (SELECT 1 FROM public.product_variants v\n                            WHERE v.id = v_item.variant_id AND v.active = true) THEN",
  );
  assertStringIncludes(
    texto,
    "            v_item.product_id := COALESCE(v_item.product_id,\n                                          (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_item.variant_id));\n            v_item.variant_id := NULL;\n        END IF;",
  );
  // o bloco NAO escreve em lugar nenhum: so troca o item para o caminho da peca sem tamanho
  const sc = semComentario(texto);
  for (const proibido of [/\bUPDATE\b/i, /\bINSERT\b/i, /\bDELETE\b/i])
    assert(!proibido.test(sc), `bloco: ${proibido}`);
  // o destino continua sendo o da 642: variacao ligada OU cantinho OU pai, sem quarto caminho
  assertEquals(
    devNovo.split("INSERT INTO public.pecas_sem_tamanho").length - 1,
    1,
  );
  assertEquals(devNovo.split("UPDATE public.product_variants").length - 1, 1);
  assertEquals(devNovo.split("UPDATE public.produtos").length - 1, 1);
});

Deno.test("20261653: admin_devolucao_concluir novo = o da 20261642000000 com SO o bloco marcado, dentro do reestoque, byte a byte", () => {
  const { ini, fim, texto } = ramo(conclNovo, "      ");
  assertEquals(conclNovo.slice(0, ini) + conclNovo.slice(fim), concl642);
  const ancora = "    IF v_reestocar AND v_di.reestocado_em IS NULL THEN\n";
  assertEquals(conclNovo.indexOf(ancora) + ancora.length, ini);
  assertEquals(
    conclNovo.indexOf("      IF v_di.variant_id IS NOT NULL THEN\n"),
    fim,
  );
  assertStringIncludes(
    texto,
    "      IF v_di.variant_id IS NOT NULL\n         AND NOT EXISTS (SELECT 1 FROM public.product_variants v\n                          WHERE v.id = v_di.variant_id AND v.active = true) THEN",
  );
  assertStringIncludes(
    texto,
    "        v_di.product_id := COALESCE(v_di.product_id,\n                                    (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_di.variant_id));\n        v_di.variant_id := NULL;\n      END IF;",
  );
  const sc = semComentario(texto);
  for (const proibido of [/\bUPDATE\b/i, /\bINSERT\b/i, /\bDELETE\b/i])
    assert(!proibido.test(sc), `bloco: ${proibido}`);
  // o carimbo do item e a conta 'sem_tamanho' seguem DEPOIS do bloco, iguais aos da 642
  assert(
    conclNovo.indexOf(
      "UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = v_di.id;",
    ) > fim,
  );
  assertStringIncludes(
    conclNovo,
    "'reestocados', v_reestocados - v_sem_tamanho, 'sem_tamanho', v_sem_tamanho",
  );
});

Deno.test("20261653: ADITIVA - fora dos dois corpos, nada de DDL, escrita em dado, GRANT ou REVOKE", () => {
  let fora = migration.replace(devNovo, "").replace(conclNovo, "");
  fora = semComentario(fora);
  for (const proibido of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bCREATE\s+(TABLE|INDEX|TRIGGER|POLICY|OR\s+REPLACE\s+TRIGGER)\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bCOMMENT\s+ON\b/i,
  ])
    assert(!proibido.test(fora), `fora dos corpos: ${proibido}`);
  assertEquals(
    [
      ...semComentario(migration).matchAll(
        /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-z_.]+)/gi,
      ),
    ].map((m) => m[2]),
    ["public.devolver_estoque", "public.admin_devolucao_concluir"],
  );
});

Deno.test("20261653: os md5 do pre-voo, do pos-voo, do rollback, das consultas e do posterior sao os dos corpos que os arquivos carregam", () => {
  const pre = blocoDo(migration, "preflight_20261653000000");
  const pos = blocoDo(migration, "posvoo_20261653000000");
  const rbPre = blocoDo(rollback, "preflight_rollback_20261653000000");
  const rbPos = blocoDo(rollback, "posvoo_rollback_20261653000000");
  assertStringIncludes(pre, `v_hash NOT IN ('${H_DEV_642}', '${H_DEV}')`);
  // a forma (assinatura, anterior, desta) que a 8e do ci_conferir_banco_test exige de cada sucessora
  assertStringIncludes(
    pre,
    `('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '${H_CONCL_642}', '${H_CONCL}')`,
  );
  // o destino da peca que espera tem de existir: a tabela e as RPCs da 642, com os corpos dela
  assertStringIncludes(
    pre,
    "IS DISTINCT FROM 'd6a9047fe26305d0c1446c284033245d'",
  );
  assertStringIncludes(
    pre,
    "IS DISTINCT FROM 'cac3d04d9be77c7d4004003bb70561c5'",
  );
  assertStringIncludes(pre, "to_regclass('public.pecas_sem_tamanho')");
  for (const h of [H_DEV, H_CONCL])
    assertStringIncludes(pos, `IS DISTINCT FROM '${h}'`);
  assert(
    !pos.includes(H_DEV_642) && !pos.includes(H_CONCL_642),
    "o pos-voo aceita so os corpos desta",
  );
  assertStringIncludes(rbPre, `v_hash NOT IN ('${H_DEV}', '${H_DEV_642}')`);
  assertStringIncludes(
    rbPre,
    `('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '${H_CONCL_642}', '${H_CONCL}')`,
  );
  assertStringIncludes(rbPos, `IS DISTINCT FROM '${H_DEV_642}'`);
  assertStringIncludes(rbPos, `IS DISTINCT FROM '${H_CONCL_642}'`);
  assert(!rbPos.includes(H_DEV) && !rbPos.includes(H_CONCL));
  // o pre-voo vem ANTES de qualquer escrita; o pos-voo DEPOIS de tudo
  assert(
    migration.indexOf("DO $preflight_20261653000000$") <
      migration.indexOf(DEV[0]),
  );
  assert(
    migration.indexOf("DO $posvoo_20261653000000$") >
      migration.indexOf(CONCL[0]),
  );
  // a ancora da prova viva e das consultas
  const posterior = lerTexto(
    "tests/banco/a-peca-da-variacao-desligada-posterior.cjs",
  );
  assertStringIncludes(posterior, `HASH_DEVOLVER_DESTA = "${H_DEV}"`);
  assertStringIncludes(posterior, `HASH_CONCLUIR_DESTA = "${H_CONCL}"`);
  const a = lerTexto(`scripts/publicacao/consultas/${A209}.sql`);
  const b = lerTexto(`scripts/publicacao/consultas/${B209}.sql`);
  for (const h of [H_DEV, H_CONCL]) assertStringIncludes(a, `'${h}'`);
  assert(!semComentario(a).includes(H_DEV_642), "a 209a nao aceita a 642");
  assertStringIncludes(b, `IN ('${H_DEV_642}', '${H_DEV}')`);
  assertStringIncludes(b, `IN ('${H_CONCL_642}', '${H_CONCL}')`);
  // as fichas das antecessoras aceitam o corpo desta como SUCESSORA (senao reprovam em toda loja depois do apply)
  for (const [ficha, h] of [
    ["202a-conferir-a-peca-que-volta-sem-tamanho-aplicado", H_DEV],
    ["202a-conferir-a-peca-que-volta-sem-tamanho-aplicado", H_CONCL],
    ["96a-conferir-o-estoque-que-volta-tranca-na-mesma-ordem-aplicado", H_DEV],
    [
      "110a-conferir-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-aplicado",
      H_CONCL,
    ],
    ["43a-conferir-reembolso-em-duvida-aplicado", H_CONCL],
    ["67a-conferir-reembolso-manual-reserva-aplicado", H_CONCL],
    ["8e-conferir-92-a-202-aplicado", H_CONCL],
  ])
    assertStringIncludes(
      semComentario(lerTexto(`scripts/publicacao/consultas/${ficha}.sql`)),
      `'${h}'`,
      ficha,
    );
});

Deno.test("20261653: o rollback devolve os blocos da 20261642000000 BYTE A BYTE e nao apaga nada", () => {
  assertEquals(
    rollback.split(dev642).length,
    2,
    "o bloco de devolver_estoque da 642 nao esta letra por letra",
  );
  assertEquals(
    rollback.split(concl642).length,
    2,
    "o bloco de admin_devolucao_concluir da 642 nao esta letra por letra",
  );
  const fora = semComentario(
    rollback.replace(dev642, "").replace(concl642, ""),
  );
  for (const proibido of [
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\s+public\./i,
    /\bINSERT\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bALTER\b/i,
  ])
    assert(!proibido.test(fora), `rollback: ${proibido}`);
});

Deno.test("20261653: ligada na release - canais, consultas, conferir-banco, rpc-ci, db-apply e as provas da 642 a desfazem antes", () => {
  const canais = JSON.parse(lerTexto("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261653000000"),
  );
  assertEquals(lote.length, 1);
  assertEquals(lote[0].consulta, A209);
  assertEquals(lote[0].ausenciaConfirmadaPor, B209);
  assertEquals(lote[0].versoes, ["20261653000000"]);
  for (const chave of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert(!(chave in lote[0]), `lote da 209a: ${chave} nao se aplica`);
  const ordem = canais.provasDeObjetos.map((p) => p.consulta);
  assert(
    ordem.indexOf("202a-conferir-a-peca-que-volta-sem-tamanho-aplicado") <
      ordem.indexOf(A209),
    "o lote da 209a vem depois do da 202a",
  );
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const consulta of [A209, B209]) {
    const rol = ROL_FECHADO_POR_CONSULTA[consulta];
    assert(rol, `sem rol: ${consulta}`);
    const sql = lerTexto(`scripts/publicacao/consultas/${consulta}.sql`);
    for (const item of rol)
      assertStringIncludes(sql, `'${item}'`, `${consulta}: ${item}`);
  }
  const rpc = lerTexto(".github/workflows/rpc-ci.yml");
  assertStringIncludes(
    rpc,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/a-peca-da-variacao-desligada-viva.cjs",
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert(entrada, "sem entrada no db-apply: a migration sairia PULADA");
  const corpos = {
    devolver_estoque: corpo(devNovo, "$devolver$"),
    admin_devolucao_concluir: corpo(conclNovo, "$$"),
  };
  const corpos642 = {
    devolver_estoque: corpo(dev642, "$devolver$"),
    admin_devolucao_concluir: corpo(concl642, "$$"),
  };
  assertEquals(
    entrada.map((c) => c.funcao),
    Object.keys(corpos),
  );
  for (const checagem of entrada) {
    const { funcao, esperado } = checagem;
    assertEquals(
      avaliarChecagem(corpos[funcao], checagem).situacao,
      "verificada",
      funcao,
    );
    // Sem o bloco desta (o corpo da 642) a verificacao reprova; e cada marcador, se some, tambem.
    assertEquals(
      avaliarChecagem(corpos642[funcao], checagem).situacao,
      "falhou",
      `${funcao}: o corpo da 642 passaria`,
    );
    for (const { texto } of esperado)
      assertEquals(
        avaliarChecagem(corpos[funcao].replace(texto, "XX"), checagem).situacao,
        "falhou",
        `${funcao}: o marcador "${texto.slice(0, 40)}" nao pega a regressao`,
      );
  }
  // As provas que medem a 20261642000000 desfazem esta antes (o pre-voo do rollback da 642 recusa o corpo desta).
  assertStringIncludes(
    lerTexto("tests/banco/a-peca-que-volta-sem-tamanho-posterior.cjs"),
    'require("./a-peca-da-variacao-desligada-posterior.cjs").desfazerVariacaoDesligadaNaTransacao(',
  );
  assertStringIncludes(
    lerTexto("tests/banco/a-peca-que-volta-sem-tamanho-viva.cjs"),
    'require("./a-peca-da-variacao-desligada-posterior.cjs").desfazerVariacaoDesligadaNaTransacao(',
  );
});
