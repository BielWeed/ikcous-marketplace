// @ts-nocheck
/* eslint-disable security/detect-object-injection -- o indice e' o nome fixo desta migration, nunca entrada de rede. */
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), entao nao ha ReDoS possivel; mesma razao dos outros testes migration_*. */
// O LUCRO DO RANKING SO DESCONTA O REEMBOLSO QUE SAIU, E O FRETE DE IDA SO QUANDO FOI DEVOLVIDO — leitura do TEXTO da 20261662000000 e
// do rollback dela. O COMPORTAMENTO (o reembolso pendente, falho, recusado, concluido e manual; o
// defeito com o corpo da 1659, o reembolso sem o frete, com o frete, com parte do frete, o frete gravado 0, o vale e a troca, o Financeiro
// como oraculo, os mutantes, reaplicar, pre-voo, rollback e as consultas 218a/218b) e' provado no Postgres efemero por
// tests/banco/o-frete-de-ida-so-sai-do-lucro-viva.cjs; aqui ficam as ancoras que se leem do arquivo, sem banco:
//   - a migration e' ADITIVA, SEM transacao propria e SEM escrita em dado;
//   - o corpo novo e' o da 1659 com SO a formula do frete (e o comentario dela) trocada nas DUAS copias, byte a byte;
//   - os md5 do pre-voo, do pos-voo, do rollback, das consultas e do modulo posterior sao os do corpo que os arquivos carregam;
//   - o rollback devolve o corpo da 1659 BYTE A BYTE, passa a Fase 0 e nao apaga nada;
//   - a migration esta ligada na release (canais, consultas, conferir-banco, rpc-ci, db-apply) e as provas da 1659 a desfazem.
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
const NOME =
  "20261662000000_o_frete_de_ida_so_sai_do_lucro_quando_foi_devolvido.sql";
const NOME_1659 =
  "20261659000000_a_peca_de_produto_excluido_fica_fora_e_o_vale_nao_e_dinheiro.sql";
const A218 =
  "218a-conferir-o-frete-de-ida-so-sai-do-lucro-quando-foi-devolvido-aplicado";
const B218 =
  "218b-antes-o-frete-de-ida-so-sai-do-lucro-quando-foi-devolvido-base-vigente";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const lerTexto = (rel: string) =>
  Deno.readTextFileSync(`${RAIZ}/${rel}`).replace(/\r/g, "");
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const m1659 = lerMig(NOME_1659);
const semComentario = (s: string) => s.replace(/--.*$/gm, "");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const bloco = (sql: string, inicio: string, fim: string) => {
  const i = sql.indexOf(inicio);
  assert(i >= 0, `bloco ausente: ${inicio}`);
  assertEquals(sql.indexOf(inicio, i + 1), -1, `bloco repetido: ${inicio}`);
  return sql.slice(i, sql.indexOf(fim, i) + fim.length);
};
const corpo = (b: string) => {
  const a = b.indexOf("AS $$") + "AS $$".length;
  return b.slice(a, b.indexOf("$$", a));
};
const ANA = [
  "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)",
  "\n$$;",
];
const anaAnt = bloco(m1659, ANA[0], ANA[1]);
const anaNovo = bloco(migration, ANA[0], ANA[1]);
const H_1659 = "1624212a7096b6f49a80370b30191a15";
const H_DESTA = md5(corpo(anaNovo));
const ASSIN = "public.get_admin_analytics_v2(integer)";

// As trocas no corpo da 1659, cada [antes, depois] DUAS vezes (ranking e grafico do dia): o reembolso que nao saiu vale 0, o frete de ida
// so ate o que o reembolso pagou alem das pecas, e o residual so desconta as linhas 'sistema' da devolucao manual (com os comentarios).
const TROCAS: [string, string][] = [
  // 1. o comentario do pm
  [
    "            -- pm = o dinheiro devolvido: reembolso = valor_reembolso menos o frete de ida (devolucao de reembolso SEM valor gravado = o das pecas que voltaram, como era antes);\n",
    "            -- pm = o dinheiro devolvido: reembolso = valor_reembolso menos a parte dele que foi o frete de ida (devolucao de reembolso SEM valor gravado = o das pecas que voltaram, como era antes);\n" +
      "            -- o frete de ida sai so ate o que o reembolso pagou ALEM das pecas da devolucao, nunca acima do frete gravado (20261662000000): o reembolso\n" +
      "            -- sem o frete (a peca 'Nao veio', a lojista que corrigiu o valor) nao desconta frete nenhum; o que passa das pecas e do frete segue como excesso.\n" +
      "            -- So conta o reembolso que SAIU (20261662000000), como o Financeiro: a linha ligada (refund_id) 'concluido' ou a devolucao manual (a loja\n" +
      "            -- devolveu fora do app); pendente, em processamento, falhou ou recusado = 0 (as pecas seguem na quantidade devolvida e no custo que volta).\n",
  ],
  // 2. o reembolso que nao saiu = 0; o frete so ate o que o reembolso pagou alem das pecas
  [
    "                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL\n" +
      "                                              THEN GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))\n",
    "                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL\n" +
      "                                                   AND NOT (dv.reembolso_manual\n" +
      "                                                            OR EXISTS (SELECT 1 FROM public.order_refunds rq WHERE rq.id = dv.refund_id AND rq.status = 'concluido'))\n" +
      "                                              THEN 0\n" +
      "                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL\n" +
      "                                              THEN GREATEST(0, dv.valor_reembolso - LEAST(COALESCE(dv.valor_frete_ida, 0), GREATEST(dv.valor_reembolso - x.vv - x.va, 0)))\n",
  ],
  // 3. o comentario do residual (o dinheiro do painel do Mercado Pago)
  [
    "                       -- Devolvido pelo painel do Mercado Pago: a linha ligada a devolucao falhou/foi recusada (ou a lojista marcou\n" +
      "                       -- \"ja devolvi por fora\", que solta o refund_id) e o webhook gravou OUTRA linha 'sistema' concluida depois da\n" +
      "                       -- conclusao (o mesmo criterio de reemitir_reembolso_da_devolucao). valor_estornado ja soma essa linha, mas o dinheiro\n" +
      "                       -- saiu POR uma devolucao: sai do lucro pelas pecas devolvidas, nao de novo como cortesia. Limitado ao que o painel\n" +
      "                       -- de fato devolveu (soma das linhas 'sistema'); sem essa linha, nada se desconta (ligada 'solicitado' continua cortesia).\n",
    '                       -- Devolvido pelo painel do Mercado Pago: a lojista marcou "ja devolvi por fora" (que solta o refund_id) e o webhook\n' +
      "                       -- gravou OUTRA linha 'sistema' concluida depois da conclusao (o mesmo criterio de reemitir_reembolso_da_devolucao).\n" +
      "                       -- valor_estornado ja soma essa linha, mas o dinheiro saiu POR uma devolucao manual (que conta no devs): sai do lucro\n" +
      "                       -- pelas pecas devolvidas, nao de novo como cortesia. Limitado ao que o painel de fato devolveu (soma das linhas 'sistema').\n" +
      "                       -- A devolucao cuja linha ligada falhou ou foi recusada NAO entra mais aqui (20261662000000): o reembolso dela nao saiu e\n" +
      "                       -- ela nao tira dinheiro no devs, entao o que o painel devolveu por ela fica no residual (o Financeiro conta a linha 'sistema').\n",
  ],
  // 4. o residual so desconta a devolucao manual (a ligada que falhou/foi recusada vale 0 no devs)
  [
    "                                 LEFT JOIN public.order_refunds rlp ON rlp.id = dvp.refund_id\n" +
      "                                WHERE dvp.order_id = so.id\n" +
      "                                  AND dvp.status = 'concluida'\n" +
      "                                  AND dvp.resolucao_final = 'reembolso'\n" +
      "                                  AND dvp.valor_reembolso > 0\n" +
      "                                  AND ((dvp.refund_id IS NULL AND dvp.reembolso_manual)\n" +
      "                                       OR rlp.status IN ('falhou', 'recusado'))) g\n",
    "                                WHERE dvp.order_id = so.id\n" +
      "                                  AND dvp.status = 'concluida'\n" +
      "                                  AND dvp.resolucao_final = 'reembolso'\n" +
      "                                  AND dvp.valor_reembolso > 0\n" +
      "                                  AND dvp.refund_id IS NULL AND dvp.reembolso_manual) g\n",
  ],
];

const blocoDo = (sql: string, marca: string) => {
  const i = sql.indexOf(`DO $${marca}$`);
  assert(i >= 0, `bloco ${marca} ausente`);
  return sql.slice(i, sql.indexOf(`END $${marca}$;`, i));
};

Deno.test("20261662: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s, e passa a Fase 0", () => {
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

Deno.test("20261662: o corpo de partida ainda e' o da 1659 e esta e' a ultima que redefine get_admin_analytics_v2", () => {
  assertEquals(md5(corpo(anaAnt)), H_1659);
  const fontes = [...Deno.readDirSync(`${RAIZ}/supabase/migrations`)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) =>
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_admin_analytics_v2\s*\(/i.test(
        semComentario(lerMig(n)),
      ),
    );
  assertEquals(fontes.at(-1), NOME, "outra redefine o analytics depois desta");
  assertEquals(fontes.at(-2), NOME_1659, "a antecessora e' a 1659");
});

Deno.test("20261662: get_admin_analytics_v2 novo = o da 1659 com SO as trocas do reembolso que saiu, do frete e do residual, nas DUAS copias, byte a byte", () => {
  let volta = anaNovo;
  for (const [antes, depois] of TROCAS) {
    assertEquals(
      anaAnt.split(antes).length,
      3,
      `a 1659 tem duas copias: ${antes.slice(0, 60)}`,
    );
    assertEquals(
      anaNovo.split(depois).length,
      3,
      `as duas copias mudam: ${depois.slice(0, 60)}`,
    );
    volta = volta.split(depois).join(antes);
  }
  assertEquals(
    volta,
    anaAnt,
    "fora das trocas, o corpo e o da 1659 byte a byte",
  );
  for (const velho of [
    "THEN GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))",
    "OR rlp.status IN ('falhou', 'recusado')",
    "LEFT JOIN public.order_refunds rlp",
  ])
    assert(!anaNovo.includes(velho), `nenhuma copia ficou velha: ${velho}`);
  // O vale (1659) e o "sem valor gravado" continuam como estavam, nas duas copias.
  for (const intacto of [
    "CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'vale' THEN 0\n",
    "ELSE x.vv END AS pm) m\n",
  ])
    assertEquals(anaNovo.split(intacto).length, 3, intacto);
  // O ramo "nao saiu = 0" vem ANTES do ramo do reembolso (CASE: o primeiro que casa vence), nas duas copias.
  const naoSaiu =
    "                                              THEN 0\n                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL\n                                              THEN GREATEST(0, dv.valor_reembolso - LEAST(";
  assertEquals(anaNovo.split(naoSaiu).length, 3);
});

Deno.test("20261662: a formula, caso a caso (a mesma conta do Financeiro: o frete so sai quando o reembolso o pagou)", () => {
  // Espelho em JS da conta do pm (centavos inteiros), contra os casos da prova viva.
  const pm = (reembolso: number, frete: number, vv: number, va: number) =>
    Math.max(0, reembolso - Math.min(frete, Math.max(reembolso - vv - va, 0)));
  // reembolso SEM o frete (a peca 'Nao veio'): nada de frete sai, o dinheiro devolvido e' o reembolso inteiro
  assertEquals(pm(10000, 2500, 10000, 5000), 10000);
  // reembolso SEM o frete com tudo de volta (a lojista corrigiu o valor): idem
  assertEquals(pm(10000, 2500, 10000, 0), 10000);
  // reembolso COM o frete: o frete sai UMA vez, o resto e' das pecas
  assertEquals(pm(12500, 2500, 10000, 0), 10000);
  // parte do frete: so o que passou das pecas
  assertEquals(pm(11000, 2500, 10000, 0), 10000);
  // frete gravado 0 e reembolso acima das pecas: nenhum frete sai (o excesso segue para o rateio, como na 1659)
  assertEquals(pm(12500, 0, 10000, 0), 12500);
  // reembolso acima das pecas E do frete: o frete sai inteiro e o resto e' excesso
  assertEquals(pm(13000, 2500, 10000, 0), 10500);
  // 'Nao veio' com reembolso dela inteira e sem frete: as pecas antes do frete
  assertEquals(pm(15000, 2500, 10000, 5000), 15000);
  // reembolso 0 (nunca abaixo de zero)
  assertEquals(pm(0, 2500, 10000, 0), 0);
  // So o reembolso que SAIU conta (o Financeiro: a linha 'concluido' e' realizada; 'solicitado'/'em_processamento' sao previstos, fora do
  // fin_dre; 'falhou'/'recusado' nao aparecem; a devolucao manual sai como 'devolucao'). Espelho do ramo "nao saiu = 0".
  const saiu = (linha: string | null, manual: boolean) =>
    manual || linha === "concluido";
  const pmComSituacao = (linha: string | null, manual: boolean) =>
    saiu(linha, manual) ? pm(3000, 0, 10000, 0) : 0;
  assertEquals(pmComSituacao("concluido", false), 3000);
  assertEquals(pmComSituacao(null, true), 3000);
  for (const pendente of [
    "solicitado",
    "em_processamento",
    "falhou",
    "recusado",
  ])
    assertEquals(pmComSituacao(pendente, false), 0, pendente);
  // o SQL usa exatamente esse criterio
  assertStringIncludes(
    anaNovo,
    "AND NOT (dv.reembolso_manual\n                                                            OR EXISTS (SELECT 1 FROM public.order_refunds rq WHERE rq.id = dv.refund_id AND rq.status = 'concluido'))\n",
  );
});

Deno.test("20261662: ADITIVA - fora do corpo, nada de DDL, escrita em dado, GRANT, REVOKE ou funcao nova", () => {
  const fora = semComentario(migration.replace(anaNovo, ""));
  for (const proibido of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bCREATE\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bCOMMENT\s+ON\b/i,
  ])
    assert(!proibido.test(fora), `fora do corpo: ${proibido}`);
  assertEquals(
    [
      ...semComentario(migration).matchAll(
        /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-z_0-9.]+)/gi,
      ),
    ].map((m) => m[2]),
    ["public.get_admin_analytics_v2"],
  );
});

Deno.test("20261662: os md5 do pre-voo, do pos-voo, do rollback, das consultas e do posterior sao os do corpo que os arquivos carregam", () => {
  const pre = blocoDo(migration, "preflight_20261662000000");
  const pos = blocoDo(migration, "posvoo_20261662000000");
  const rbPre = blocoDo(rollback, "preflight_rollback_20261662000000");
  const rbPos = blocoDo(rollback, "posvoo_rollback_20261662000000");
  // a forma (assinatura, anterior, desta) que a 8e e o sucessoras-da-99 exigem de cada sucessora
  assertStringIncludes(pre, `('${ASSIN}', '${H_1659}', '${H_DESTA}')`);
  assertStringIncludes(rbPre, `('${ASSIN}', '${H_1659}', '${H_DESTA}')`);
  assertStringIncludes(pos, `'${H_DESTA}'`);
  assertStringIncludes(rbPos, `'${H_1659}'`);
  assert(!pos.includes(H_1659), "o pos-voo aceita so o corpo desta");
  assert(!rbPos.includes(H_DESTA), "o pos-voo do rollback so aceita a 1659");
  // as colunas que a conta le (o frete e a linha ligada do reembolso)
  for (const col of [
    "('devolucoes', 'refund_id')",
    "('devolucoes', 'reembolso_manual')",
    "('order_refunds', 'id')",
    "('order_refunds', 'status')",
    "('devolucoes', 'valor_frete_ida')",
    "('devolucoes', 'valor_reembolso')",
    "('devolucao_itens', 'quantidade')",
    "('devolucao_itens', 'valor_unitario')",
    "('devolucao_itens', 'condicao')",
  ])
    assertStringIncludes(pre, col);
  // o pre-voo vem ANTES de qualquer escrita; o pos-voo DEPOIS
  assert(
    migration.indexOf("DO $preflight_20261662000000$") <
      migration.indexOf(ANA[0]),
  );
  assert(
    migration.indexOf("DO $posvoo_20261662000000$") > migration.indexOf(ANA[0]),
  );
  const posterior = lerTexto(
    "tests/banco/o-frete-de-ida-so-sai-do-lucro-posterior.cjs",
  );
  assertStringIncludes(posterior, `HASH_ANALYTICS_DESTA = "${H_DESTA}"`);
  assertStringIncludes(posterior, `HASH_ANALYTICS_1659 = "${H_1659}"`);
  const a = semComentario(lerTexto(`scripts/publicacao/consultas/${A218}.sql`));
  const b = semComentario(lerTexto(`scripts/publicacao/consultas/${B218}.sql`));
  assertStringIncludes(a, `'${H_DESTA}'`);
  assert(!a.includes(H_1659), "a 218a nao aceita o corpo da 1659");
  assertStringIncludes(b, `'${H_1659}'`);
  assertStringIncludes(b, `'${H_DESTA}'`);
  // as fichas das antecessoras aceitam o corpo desta como SUCESSORA (senao reprovam em toda loja depois do apply)
  for (const ficha of [
    "8e-conferir-92-a-202-aplicado",
    "35a-conferir-lucro-so-com-custo-aplicado",
    "45a-conferir-custo-do-dia-aplicado",
    "48a-conferir-lucro-com-desconto-aplicado",
    "53a-conferir-faturamento-potencial-aplicado",
    "54a-conferir-lucro-do-estoque-aplicado",
    "135a-conferir-o-ranking-de-lucro-desconta-a-devolucao-aplicado",
    "146a-conferir-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-aplicado",
    "147a-conferir-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-aplicado",
    "215a-conferir-a-peca-de-produto-excluido-fica-fora-e-o-vale-nao-e-dinheiro-aplicado",
  ])
    assertStringIncludes(
      semComentario(lerTexto(`scripts/publicacao/consultas/${ficha}.sql`)),
      `'${H_DESTA}'`,
      ficha,
    );
  // A 8e liga o corpo desta a versao dela.
  assertStringIncludes(
    lerTexto("scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql"),
    `('get_admin_analytics_v2', '${H_DESTA}', '20261662000000')`,
  );
  // A 215a mostra o vivo desta como o esperado da 1659 (a 218a e' quem diz qual).
  assertStringIncludes(
    semComentario(
      lerTexto(
        "scripts/publicacao/consultas/215a-conferir-a-peca-de-produto-excluido-fica-fora-e-o-vale-nao-e-dinheiro-aplicado.sql",
      ),
    ),
    `CASE WHEN h = '${H_DESTA}' THEN '${H_1659}' ELSE h END`,
  );
  // A 17a (o estoque do painel) confere o analytics por sha256 (LF e CRLF) e aceita o corpo desta logo depois do da 1659.
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const anaC = corpo(anaNovo);
  const ana1659C = corpo(anaAnt);
  assertStringIncludes(
    lerTexto(
      "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
    ),
    `'${sha(ana1659C.replace(/\n/g, "\r\n"))}',\n                                            '${sha(anaC)}',\n                                            '${sha(anaC.replace(/\n/g, "\r\n"))}'`,
  );
});

Deno.test("20261662: o rollback devolve o corpo da 1659 BYTE A BYTE e nao apaga nem escreve nada", () => {
  assertEquals(
    rollback.split(anaAnt).length,
    2,
    "get_admin_analytics_v2 da 1659: nao esta letra por letra",
  );
  const fora = semComentario(rollback.replace(anaAnt, ""));
  for (const proibido of [
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\s+public\./i,
    /\bINSERT\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bALTER\b/i,
    /\bCREATE\b/i,
  ])
    assert(!proibido.test(fora), `rollback: ${proibido}`);
});

Deno.test("20261662: ligada na release - canais, consultas, conferir-banco, rpc-ci, db-apply, sucessoras e as provas da 1659 a desfazem antes", () => {
  const canais = JSON.parse(lerTexto("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261662000000"),
  );
  assertEquals(lote.length, 1);
  assertEquals(lote[0].consulta, A218);
  assertEquals(lote[0].ausenciaConfirmadaPor, B218);
  assertEquals(lote[0].versoes, ["20261662000000"]);
  for (const chave of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert(!(chave in lote[0]), `lote da 218a: ${chave} nao se aplica`);
  const ordem = canais.provasDeObjetos.map((p) => p.consulta);
  assert(
    ordem.indexOf(
      "215a-conferir-a-peca-de-produto-excluido-fica-fora-e-o-vale-nao-e-dinheiro-aplicado",
    ) < ordem.indexOf(A218),
    "o lote da 218a vem depois do da 215a",
  );
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const consulta of [A218, B218]) {
    const rol = ROL_FECHADO_POR_CONSULTA[consulta];
    assert(rol, `sem rol: ${consulta}`);
    assertEquals(rol.length, 6, `${consulta}: rol de 6`);
    const sql = lerTexto(`scripts/publicacao/consultas/${consulta}.sql`);
    for (const item of rol)
      assertStringIncludes(sql, `'${item}'`, `${consulta}: ${item}`);
  }
  const {
    CONSULTAS_DE_ROL_FECHADO,
  } = require("../scripts/frota/publicar-release.mjs");
  void CONSULTAS_DE_ROL_FECHADO;
  const publicar = lerTexto("scripts/frota/publicar-release.mjs");
  assertStringIncludes(publicar, `"${A218}",`);
  assertStringIncludes(publicar, `"${B218}",`);
  const menu = lerTexto(".github/workflows/conferir-banco-da-loja.yml");
  assertStringIncludes(menu, `- ${A218}\n`);
  assertStringIncludes(menu, `- ${B218}\n`);
  const rpc = lerTexto(".github/workflows/rpc-ci.yml");
  assertEquals(
    rpc.split(`"scripts/publicacao/consultas/${A218}.sql"`).length,
    3,
    "a 218a nos dois gatilhos do rpc-ci",
  );
  assertStringIncludes(
    rpc,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/o-frete-de-ida-so-sai-do-lucro-viva.cjs",
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert(entrada, "sem entrada no db-apply: a migration sairia PULADA");
  const checagens = Array.isArray(entrada) ? entrada : [entrada];
  assertEquals(
    checagens.map((c) => c.funcao),
    ["get_admin_analytics_v2"],
  );
  for (const checagem of checagens) {
    assertEquals(
      avaliarChecagem(corpo(anaNovo), checagem).situacao,
      "verificada",
    );
    assertEquals(
      avaliarChecagem(corpo(anaAnt), checagem).situacao,
      "falhou",
      "o corpo da 1659 passaria",
    );
    for (const { texto } of checagem.esperado)
      assertEquals(
        avaliarChecagem(corpo(anaNovo).replace(texto, "XX"), checagem).situacao,
        "falhou",
        `o marcador "${texto.slice(0, 40)}" nao pega a regressao`,
      );
  }
  // As provas que medem a 1659 (e, por ela, a 3995) desfazem esta antes (o rollback da 1659 recusa o corpo desta).
  const chamada = 'require("./o-frete-de-ida-so-sai-do-lucro-posterior.cjs")';
  for (const arq of [
    "tests/banco/a-peca-de-produto-excluido-posterior.cjs",
    "tests/banco/a-peca-de-produto-excluido-viva.cjs",
  ])
    assertStringIncludes(lerTexto(arq), chamada, arq);
  // A cadeia das 42 da 20261199 (o analytics e' uma delas) conhece esta: (vigente, desta) do pre-voo, depois da 1660 (ordem de nome).
  const { SUCESSORAS_DA_99 } = require("./banco/sucessoras-da-99.cjs");
  assertEquals(
    SUCESSORAS_DA_99.filter((s) => s.nome === NOME).map((s) => [
      s.assinatura,
      s.hashVigente,
      s.hashDesta,
    ]),
    [[ASSIN, H_1659, H_DESTA]],
    "sucessoras-da-99: falta esta, ou o par nao e' o do pre-voo",
  );
  const nomes = SUCESSORAS_DA_99.map((s) => s.nome);
  assert(
    nomes.indexOf(
      "20261660000000_o_caixa_de_ontem_aberto_nao_some_do_saldo.sql",
    ) < nomes.indexOf(NOME),
    "em ordem de nome de arquivo",
  );
  const leia = lerTexto("tests/banco/LEIA-ME.md");
  assertStringIncludes(leia, "o-frete-de-ida-so-sai-do-lucro-viva.cjs");
});
