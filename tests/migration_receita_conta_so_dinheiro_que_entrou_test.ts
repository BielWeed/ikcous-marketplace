// @ts-nocheck
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261021000000_receita_conta_so_dinheiro_que_entrou.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../rollback-manual-${NOME}`;
const DB_APPLY_PATH = `${DIR}../scripts/db-apply.cjs`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);
const dbApply = Deno.readTextFileSync(DB_APPLY_PATH);

// Assinatura conferida no codigo real (scripts/db-prove-rollback.cjs:308):
// objeto nomeado na entrada, `{ recusado, motivos }` na saida. Ela ja cobre
// `CREATE FUNCTION` sem `OR REPLACE` nos dois arquivos — nao duplicar.
Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("a migration redefine as TRES funcoes", () => {
  for (const fn of [
    "get_admin_analytics_v2",
    "get_admin_customers_paged",
    "get_segmented_push_targets",
  ]) {
    assertStringIncludes(migration, `CREATE OR REPLACE FUNCTION public.${fn}`);
  }
});

Deno.test("nenhum ponto de dinheiro aceita mais payment_status IS NULL", () => {
  const restos = migration.match(/payment_status\s+IS\s+NULL/gi) || [];
  assertEquals(
    restos.length,
    0,
    `sobrou ${restos.length} ocorrencia(s) de IS NULL`,
  );
});

// 🔴 Revisao de 27/08/2026 (achado 2): existe um 13o ponto, alem dos 12
// substituidos a partir de IS NULL — o contador `paid_on_cancelled` nunca
// teve IS NULL (era so' 'pago'/'pago_apos_expirar'), e sem ele um pedido
// recebido na entrega e depois cancelado sumia do aviso que avisa o lojista
// que precisa devolver o dinheiro ao cliente. As duas contagens (o total
// geral, e o 13o ponto especifico) sao asserções SEPARADAS, com mensagens
// distintas, para que uma falha diga qual das duas caiu.
Deno.test("a regra nova cita os TRES status que contam como dinheiro -- 13 ocorrencias no total", () => {
  const regra =
    /payment_status\s+IN\s*\(\s*'pago',\s*'pago_apos_expirar',\s*'recebido_na_entrega'\s*\)/gi;
  const achadas = migration.match(regra) || [];
  assertEquals(
    achadas.length,
    13,
    `esperava 13 ocorrencias na migration (os 12 pontos originais de IS NULL, mais o 13o de paid_on_cancelled), achei ${achadas.length}`,
  );
});

Deno.test("o 13o ponto: paid_on_cancelled passa a contar recebido_na_entrega tambem", () => {
  assertStringIncludes(
    migration,
    "payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled'",
    "o alarme de dinheiro em pedido cancelado (paid_on_cancelled) ficou cego " +
      "para 'recebido_na_entrega' -- o lojista deixaria de ver que precisa " +
      "devolver esse dinheiro ao cliente",
  );
});

Deno.test("orders_count e last_order_date NAO foram tocados", () => {
  assertStringIncludes(
    migration,
    "orders_count e last_order_date continuam contando qualquer",
  );
});

Deno.test("o rollback restaura as tres funcoes", () => {
  for (const fn of [
    "get_admin_analytics_v2",
    "get_admin_customers_paged",
    "get_segmented_push_targets",
  ]) {
    assertStringIncludes(rollback, `CREATE OR REPLACE FUNCTION public.${fn}`);
  }
  const n = (rollback.match(/payment_status\s+IS\s+NULL/gi) || []).length;
  assertEquals(
    n,
    12,
    `o rollback tem de restaurar EXATAMENTE as 12 ocorrencias originais de IS NULL (o 13o ponto -- paid_on_cancelled -- nunca teve IS NULL, e o rollback nao muda); achei ${n}`,
  );
});

// A janela desta busca se delimita pelos colchetes da propria entrada, nunca
// por um numero fixo de caracteres. A versao anterior fatiava 900 caracteres a
// partir do nome do arquivo, e um comentario acrescentado dentro da entrada
// empurrou `get_segmented_push_targets` para fora da janela -- o teste ficou
// vermelho por causa de prosa, sem que nada da verificacao tivesse mudado.
// Instrumento com limite fixo mede o limite, nao o objeto.
function entradaDoVerificacoes(texto: string, nomeDoArquivo: string): string {
  const i = texto.indexOf(`"${nomeDoArquivo}"`);
  if (i < 0) return "";
  const abre = texto.indexOf("[", i);
  if (abre < 0) return "";
  // `.at(k)` em vez de `texto[k]`: a regra `security/detect-object-injection`
  // marca indexacao por variavel, e warning novo reprova a catraca igual a erro.
  let profundidade = 0;
  for (let k = abre; k < texto.length; k++) {
    const c = texto.at(k);
    if (c === "[") profundidade++;
    else if (c === "]") {
      profundidade--;
      if (profundidade === 0) return texto.slice(i, k + 1);
    }
  }
  return "";
}

Deno.test("a entrada em VERIFICACOES existe e nomeia as tres funcoes", () => {
  assertStringIncludes(dbApply, `"${NOME}"`);
  const entrada = entradaDoVerificacoes(dbApply, NOME);
  assertEquals(
    entrada === "",
    false,
    "nao consegui delimitar a entrada de VERIFICACOES pelos colchetes",
  );
  for (const fn of [
    "get_admin_analytics_v2",
    "get_admin_customers_paged",
    "get_segmented_push_targets",
  ]) {
    assertStringIncludes(entrada, fn);
  }
});

// O marcador do 13o ponto (`paid_on_cancelled`) precisa existir por si. Sem ele,
// `avaliarChecagem` -- que usa `includes()` -- casaria com qualquer um dos 13
// pontos e diria "verificada" mesmo se o do alarme nao tivesse sido trocado.
// Presenca nao e' contagem, e este e' o unico ponto que nao veio de `IS NULL`.
Deno.test("VERIFICACOES tem marcador PROPRIO para o 13o ponto", () => {
  const entrada = entradaDoVerificacoes(dbApply, NOME);
  const marcador =
    "payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled'";
  assertStringIncludes(entrada, marcador);
  // Controle negativo: o marcador tem de discriminar. Se ele casasse tambem no
  // rollback, nao estaria provando nada sobre a migration.
  assertEquals(
    rollback.includes(marcador),
    false,
    "o marcador do 13o ponto casa no rollback -- ele nao discrimina",
  );
  assertStringIncludes(migration, marcador);
});

// 🔴 Revisao de 27/08/2026 (achado 1): `pg_get_functiondef` nao emite ';' --
// os corpos vivos terminam em `$function$\n`. Copiar "caractere a caractere"
// derrubou o terminador junto: os tres `CREATE OR REPLACE FUNCTION` de cada
// arquivo emendavam direto no proximo, e o Postgres via a string inteira
// como UM statement so', recusando com "syntax error at or near CREATE".
// Medido: 6 tags `$function$`, 0 seguidas de ';', contra 77 de 77 no resto
// das migrations do repositorio.
Deno.test("$function$; aparece exatamente 3 vezes na migration (as 3 tags de fechamento)", () => {
  const n = (migration.match(/\$function\$;/g) || []).length;
  assertEquals(
    n,
    3,
    `a migration tem de terminar as 3 funcoes com ';' depois de '$function$'; achei ${n}`,
  );
});

Deno.test("$function$; aparece exatamente 3 vezes no rollback (as 3 tags de fechamento)", () => {
  const n = (rollback.match(/\$function\$;/g) || []).length;
  assertEquals(
    n,
    3,
    `o rollback tem de terminar as 3 funcoes com ';' depois de '$function$'; achei ${n}`,
  );
});

// Pega a sabotagem de converter os arquivos para CRLF. O LF hoje so' tem
// conferencia manual (python, fora desta bateria) -- essa conferencia
// ninguem repete sozinha. `\r` aqui e' um literal de string no arquivo TS,
// nao passa por shell nenhum: nao ha' armadilha de escape de barra invertida
// (essa armadilha e' do Bash tool com `grep`, nao de codigo TypeScript lido
// pelo Deno).
Deno.test("nenhum dos dois arquivos contem CR -- nao estao em CRLF", () => {
  assertEquals(
    migration.includes("\r"),
    false,
    "a migration tem CR: nao esta em LF puro",
  );
  assertEquals(
    rollback.includes("\r"),
    false,
    "o rollback tem CR: nao esta em LF puro",
  );
});

// Extrai o corpo de UMA funcao: de `CREATE OR REPLACE FUNCTION public.<fn>`
// ate o FIM da segunda ocorrencia de `$function$` (a tag de abertura, logo
// apos `AS`, e a de fechamento). Mesmo algoritmo usado para medir os sha256
// abaixo -- conferido em Python contra os dois arquivos em 27/08/2026.
const DOLLAR = "$function$";

function extrairCorpo(sql: string, fn: string): string {
  const marcador = `CREATE OR REPLACE FUNCTION public.${fn}`;
  const i = sql.indexOf(marcador);
  assert(i > -1, `nao achei "${marcador}"`);
  const abre = sql.indexOf(DOLLAR, i);
  assert(abre > -1, `nao achei a tag de abertura ${DOLLAR} de ${fn}`);
  const fecha = sql.indexOf(DOLLAR, abre + DOLLAR.length);
  assert(fecha > -1, `nao achei a tag de fechamento ${DOLLAR} de ${fn}`);
  return sql.slice(i, fecha + DOLLAR.length);
}

// Tudo que vem ANTES do primeiro `CREATE OR REPLACE FUNCTION` e' cabecalho
// (comentario de contexto) -- e os dois arquivos tem cabecalhos DIFERENTES
// de proposito (um explica a migration, o outro o rollback). A comparacao
// de fidelidade abaixo e' so' sobre as tres funcoes, nunca sobre o texto
// inteiro do arquivo.
//
// 🔴 O marcador inclui `public.`, nao so' `CREATE OR REPLACE FUNCTION`: os
// dois cabecalhos citam a frase em PROSA (para explicar o defeito do
// terminador), e sem o `public.` o indexOf achava essa mencao em comentario
// em vez da primeira funcao de verdade -- medido: a asserção de fidelidade
// abaixo comparava o cabecalho inteiro contra o corpo da funcao e falhava
// por um motivo que nao tinha nada a ver com o defeito real.
function corpoSemCabecalho(sql: string): string {
  const i = sql.indexOf("CREATE OR REPLACE FUNCTION public.");
  assert(i > -1, "nao achei CREATE OR REPLACE FUNCTION public.");
  return sql.slice(i);
}

function cabecalho(sql: string): string {
  const i = sql.indexOf("CREATE OR REPLACE FUNCTION public.");
  assert(i > -1, "nao achei CREATE OR REPLACE FUNCTION public.");
  return sql.slice(0, i);
}

// 🔴 Achado da 2a revisao (27/08/2026). A comparacao byte a byte acima comeca
// no primeiro `CREATE OR REPLACE FUNCTION public.` -- de proposito, porque os
// dois arquivos tem cabecalhos DIFERENTES e comparar o texto inteiro faria o
// teste falhar sempre, por um motivo alheio ao defeito.
//
// Mas o que a exclusao abriu e' terra de ninguem: o revisor plantou
// `DROP TABLE public.marketplace_orders;` no cabecalho da migration e os 16
// testes passaram VERDES. Apagar o cabecalho inteiro tambem passava.
//
// Esta assercao fecha exatamente esse buraco sem tocar na comparacao: antes do
// primeiro CREATE so' pode haver linha vazia ou comentario. Ela preserva a
// liberdade de escrever prosa diferente nos dois arquivos, que e' justamente o
// motivo pelo qual o cabecalho foi excluido da comparacao.
Deno.test("o cabecalho dos dois arquivos e' so' comentario -- nenhum SQL executavel", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    const linhas = cabecalho(sql).split("\n");
    const executaveis: string[] = [];
    for (const linha of linhas) {
      const limpa = linha.trim();
      if (limpa === "" || limpa.startsWith("--")) continue;
      executaveis.push(limpa);
    }
    assertEquals(
      executaveis.length,
      0,
      `o cabecalho do ${nome} tem ${executaveis.length} linha(s) fora de comentario, ` +
        `e nada as compara com nada: ${JSON.stringify(executaveis.slice(0, 3))}`,
    );
  }
});

// A derivacao dos 13 pontos, aplicada ao ROLLBACK (que e' -- por asserção,
// ancorada pelo sha256 abaixo -- o corpo vivo). Os 12 pontos originais sao
// SUBSTITUICAO de `IS NULL OR ... IN (...)` pelo IN(...) com o terceiro
// status; o 13o (paid_on_cancelled, achado 2 da revisao de 27/08/2026) e'
// uma ADICAO ao IN(...) que ja existia, porque esse ponto nunca teve
// IS NULL. As tres chamadas de replaceAll/replace sao literais (nao regex),
// entao nao ha' ambiguidade de escape.
function aplicarSubstituicoes(textoRollback: string): string {
  let out = textoRollback;
  out = out.replaceAll(
    "o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar')",
    "o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')",
  );
  out = out.replaceAll(
    "payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar')",
    "payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')",
  );
  out = out.replace(
    "payment_status IN ('pago', 'pago_apos_expirar') AND status = 'cancelled'",
    "payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled'",
  );
  return out;
}

// 🔴 A ASSERCAO QUE FALTAVA (Step 3 da Task 2b). Antes dela, SECURITY
// DEFINER, SET search_path e a assinatura sobreviviam por CUIDADO do
// executor, nao por portao nenhum -- e uma proxima edicao nao sobreviveria.
// Esta comparacao e' byte a byte, texto inteiro (nao contagem de
// ocorrencias): a migration TEM DE SER o rollback com as substituicoes
// aplicadas. Uma falha imprime a primeira posicao em que os dois textos
// divergem, com contexto dos dois lados -- hash sozinho nao diz nada a quem
// for consertar.
Deno.test("a migration e' o corpo do rollback com as substituicoes aplicadas, byte a byte", () => {
  const derivado = aplicarSubstituicoes(corpoSemCabecalho(rollback));
  const real = corpoSemCabecalho(migration);
  if (derivado === real) return;

  // `.at(i)` em vez de `derivado[i]`/`real[i]`: indexacao de string por
  // variavel dispara security/detect-object-injection, e a catraca de lint
  // nao abre excecao para isso (convencao ja usada em
  // tests/ci_varredura_de_segredo_test.ts).
  let i = 0;
  const len = Math.min(derivado.length, real.length);
  while (i < len && derivado.at(i) === real.at(i)) i++;
  const CTX = 60;
  const esperado = derivado.slice(Math.max(0, i - CTX), i + CTX);
  const achado = real.slice(Math.max(0, i - CTX), i + CTX);
  assert(
    false,
    `a migration diverge do rollback+substituicoes na posicao ${i} ` +
      `(tamanhos: derivado do rollback=${derivado.length}, migration=${real.length}).\n` +
      `esperado (rollback com as 13 substituicoes aplicadas): ${JSON.stringify(esperado)}\n` +
      `achado de verdade na migration:                        ${JSON.stringify(achado)}`,
  );
});

async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Ancora INDEPENDENTE contra o corpo VIVO do banco (extraido via
// `pg_get_functiondef` em 27/08/2026 pela sessao principal, salvo em
// `.superpowers/sdd/2026-08-27-recebimento-na-entrega/corpos-vivos/`, e
// medido nesta tarefa com `hashlib.sha256` em Python sobre o rollback ja
// corrigido -- o `;` do Step 1 fica FORA da tag `$function$`, entao nao
// entra no corpo hasheado e nao muda o hash).
//
// Ela existe porque a asserção de fidelidade acima só prova
// `migration == rollback + substituições`: se os DOIS arquivos fossem
// sabotados da MESMA forma (os dois perdendo `SECURITY DEFINER`, por
// exemplo), aquela asserção continuaria verde. O hash não depende do outro
// arquivo.
//
// 🔴 NAO le `.superpowers/` -- `.gitignore:142` ignora essa pasta inteira e
// `git ls-files` nela volta vazio; um teste que a lesse passaria aqui e
// quebraria no CI. Por isso os hashes vao EMBUTIDOS, e nao recalculados a
// partir do arquivo de origem.
// `Map`, nao objeto literal: `objeto[fn]` com `fn` variavel dispara
// security/detect-object-injection, e `Map.get()` nao (nao e' indexacao).
const SHA256_CORPO_VIVO = new Map<string, string>([
  [
    "get_admin_analytics_v2",
    "15fcbb2981c89af83676f9e840b4e0f38477a21fa5cc19887d00c672ba5738ef",
  ],
  [
    "get_admin_customers_paged",
    "addfa092f1c927c2f0097880687a9dfd4a28ea736ad4b04f1597f2736f13e5d7",
  ],
  [
    "get_segmented_push_targets",
    "b0693191e6a33b55347afa3db5161ba85d1be2e90c6ec734f41eaf715929d1ad",
  ],
]);

for (const [fn, shaEsperado] of SHA256_CORPO_VIVO) {
  Deno.test(`o rollback de ${fn} bate com o sha256 do corpo vivo (27/08/2026)`, async () => {
    const corpo = extrairCorpo(rollback, fn);
    const hash = await sha256Hex(corpo);
    assertEquals(
      hash,
      shaEsperado,
      `sha256 do corpo de ${fn} no rollback nao bate com o corpo vivo extraido em 27/08/2026 -- o rollback pode ter sido corrompido/reescrito`,
    );
  });
}
