// @ts-nocheck
/**
 * A CONTAGEM EXATA do marcador — scripts/db-apply.cjs
 *
 * O QUE ESTE ARQUIVO PROTEGE: até 20/08/2026 a conferência pós-COMMIT era
 * `def.includes(marcador)` — bastava o texto existir em QUALQUER ponto do
 * corpo da função. Se o trecho que interessa fosse apagado no CREATE OR
 * REPLACE e o MESMO texto sobrevivesse noutro ponto, a ferramenta imprimia
 * "ok" e o veredito final saía VERIFICADO. Medido contra o banco de
 * desenvolvimento em 20/08/2026: 9 marcadores do mapa VERIFICACOES casavam
 * mais de uma vez, em 12 pontos — entre eles o predicado que decide o que
 * conta como receita no analítico e a checagem de estoque do checkout, com
 * 3 cópias cada: apagar 2 das 3 continuava imprimindo "ok".
 *
 * E esta conferência roda DEPOIS do COMMIT do passo 2, num projeto sem PITR,
 * com quem lê o terminal decidindo ali se confia. Um "ok" que não prova nada
 * é pior que conferência nenhuma, porque ele convence.
 *
 * A regra que entra no lugar: um marcador vale uma CONTAGEM, e desvio nos
 * DOIS sentidos reprova. Achar de MENOS quer dizer que parte do trecho sumiu
 * no REPLACE; achar de MAIS quer dizer que a função mudou de um jeito que
 * ninguém previu — as duas coisas pedem olho humano antes de confiar.
 *
 * Mora em tests/ e usa createRequire pelo mesmo motivo dos três arquivos
 * irmãos (db_apply_rollback_test.ts, db_apply_resumo_verificacao_test.ts e
 * db_apply_avaliar_checagem_test.ts): db-apply.cjs é CommonJS e a suíte roda
 * em Deno.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  conferirMarcador,
  avaliarChecagem,
  classificarChecagem,
  checagemBemFormada,
  montarTarefasDeVerificacao,
  ROTULO_DA_SITUACAO,
} = require("../scripts/db-apply.cjs");

/** Duas varreduras na mesma função — o caso real de expirar_pedidos_vencidos. */
const CORPO_DUAS = `CREATE OR REPLACE FUNCTION public.expirar()
 RETURNS void AS $function$
BEGIN
  SELECT * FROM public.marketplace_orders FOR UPDATE SKIP LOCKED;
  SELECT * FROM public.marketplace_order_items FOR UPDATE SKIP LOCKED;
END $function$`;

const CORPO_UMA = `CREATE OR REPLACE FUNCTION public.expirar()
 RETURNS void AS $function$
BEGIN
  SELECT * FROM public.marketplace_orders FOR UPDATE SKIP LOCKED;
END $function$`;

const CORPO_TRES = `${CORPO_DUAS}
-- SELECT * FROM outra FOR UPDATE SKIP LOCKED;`;

const MARCADOR = "FOR UPDATE SKIP LOCKED";
const FUNCAO = "minha_funcao";

// --------------------------------------------------------------------------
// conferirMarcador — o coração da mudança.
// --------------------------------------------------------------------------

Deno.test("string continua valendo, e quer dizer EXATAMENTE 1 ocorrência", () => {
  const uma = conferirMarcador(CORPO_UMA, MARCADOR);
  assertEquals(uma.esperado, 1);
  assertEquals(uma.achou, 1);
  assertEquals(uma.situacao, "ok");
  assert(uma.ok);

  // A outra metade da contagem exata: duas ocorrências reprovam uma string,
  // porque string declara 1. É isto que faz o mapa DECLARAR a realidade em
  // vez de tolerar qualquer coisa.
  const duas = conferirMarcador(CORPO_DUAS, MARCADOR);
  assertEquals(duas.achou, 2);
  assertEquals(duas.situacao, "a_mais");
  assert(!duas.ok, "string legada aprovou 2 ocorrências como se fosse 1");
});

Deno.test("achou MENOS que o declarado reprova — é o furo inteiro", () => {
  // A premissa que torna este teste o furo de 20/08: o texto CONTINUA
  // existindo no corpo, então `includes` diria "ok". Só que uma das duas
  // varreduras sumiu no REPLACE.
  assert(
    CORPO_UMA.includes(MARCADOR),
    "premissa do teste: o texto ainda existe no corpo",
  );
  const r = conferirMarcador(CORPO_UMA, { texto: MARCADOR, vezes: 2 });
  assertEquals(r.achou, 1);
  assertEquals(r.esperado, 2);
  assertEquals(r.situacao, "sumiu");
  assert(!r.ok, "achou 1 onde esperava 2 e ainda assim aprovou");
});

Deno.test("achou MAIS que o declarado reprova — a função mudou sem ninguém prever", () => {
  assert(CORPO_TRES.includes(MARCADOR));
  const r = conferirMarcador(CORPO_TRES, { texto: MARCADOR, vezes: 2 });
  assertEquals(r.achou, 3);
  assertEquals(r.situacao, "a_mais");
  assert(!r.ok, "achou 3 onde esperava 2 e ainda assim aprovou");
});

Deno.test("marcador ausente: achou 0, situação própria", () => {
  const r = conferirMarcador(CORPO_UMA, { texto: "NAO ESTA AQUI", vezes: 1 });
  assertEquals(r.achou, 0);
  assertEquals(r.situacao, "ausente");
  assert(!r.ok);
});

Deno.test("`vezes` omitido no objeto vale 1, igual à string", () => {
  assert(conferirMarcador(CORPO_UMA, { texto: MARCADOR }).ok);
  assert(!conferirMarcador(CORPO_DUAS, { texto: MARCADOR }).ok);
});

Deno.test("def undefined (função não existe no schema) conta 0, nunca aprova", () => {
  const r = conferirMarcador(undefined, MARCADOR);
  assertEquals(r.achou, 0);
  assertEquals(r.situacao, "ausente");
  assert(!r.ok);
});

Deno.test("a contagem é de ocorrências NÃO sobrepostas", () => {
  // Sem fixar isto, `aa` em `aaaa` poderia contar 3 (sobrepostas) e um
  // marcador com texto repetitivo passaria a reprovar migration correta.
  assertEquals(conferirMarcador("aaaa", { texto: "aa", vezes: 2 }).achou, 2);
});

// --------------------------------------------------------------------------
// A normalização CRLF que o arquivo já explicava tem de continuar de pé, e
// não pode mexer na CONTAGEM. O repo não tem .gitattributes e o core.autocrlf
// converte as migrations para CRLF no working tree.
// --------------------------------------------------------------------------

const CORPO_CRLF =
  "BEGIN\r\n            IF v_item.variant_id IS NOT NULL THEN\r\n          ELSE\r\n            UPDATE public.produtos\r\nEND";
const MARCADOR_MULTILINHA = "ELSE\n            UPDATE public.produtos";

Deno.test("CRLF é normalizado dos dois lados antes de CONTAR", () => {
  assertEquals(conferirMarcador(CORPO_CRLF, MARCADOR_MULTILINHA).achou, 1);
  assertEquals(
    conferirMarcador(
      CORPO_CRLF.replace(/\r\n/g, "\n"),
      MARCADOR_MULTILINHA.replace(/\n/g, "\r\n"),
    ).achou,
    1,
  );
  // E o fim de linha não pode inflar nem encolher o número.
  assertEquals(
    conferirMarcador(`${CORPO_CRLF}\r\n${CORPO_CRLF}`, {
      texto: MARCADOR_MULTILINHA,
      vezes: 2,
    }).achou,
    2,
  );
});

// --------------------------------------------------------------------------
// A ARMADILHA: `checagemBemFormada` exigia `esperado.every(m => typeof m ===
// "string")`. Marcador em objeto seria classificado como entrada malformada,
// viraria "pulada", e o mapa inteiro deixaria de ser conferido EM SILÊNCIO —
// o pior desfecho possível, porque "pulada" não grita tanto quanto "falhou".
// --------------------------------------------------------------------------

Deno.test("marcador em objeto NÃO é entrada malformada", () => {
  const checagem = {
    funcao: FUNCAO,
    esperado: [{ texto: MARCADOR, vezes: 2 }],
  };
  assert(
    checagemBemFormada(checagem),
    "marcador com contagem foi tratado como lixo — o mapa pararia de ser conferido em silêncio",
  );

  const tarefas = montarTarefasDeVerificacao(["x.sql"], { "x.sql": checagem });
  assertEquals(tarefas.length, 1);
  assertEquals(tarefas[0].checagem, checagem);
  assertEquals(tarefas[0].linhasAntes, []);
  assertEquals(
    avaliarChecagem(CORPO_DUAS, tarefas[0].checagem).situacao,
    "verificada",
  );
});

Deno.test("as duas formas convivem na mesma lista de marcadores", () => {
  const checagem = {
    funcao: FUNCAO,
    esperado: ["BEGIN", { texto: MARCADOR, vezes: 2 }],
  };
  assert(checagemBemFormada(checagem));
  assertEquals(avaliarChecagem(CORPO_DUAS, checagem).situacao, "verificada");
});

Deno.test("contagem sem sentido no mapa continua sendo entrada malformada", () => {
  // Um `vezes` que não é inteiro a partir de 1 é erro de digitação no mapa, e
  // um marcador que não prova nada é pior que marcador nenhum — ele imprime
  // "ok". Vira "pulada" (nunca sucesso, nunca crash depois do COMMIT), e o
  // teste do mapa contra os .sql pega isso offline, antes de qualquer banco.
  const ruins = [
    ["vezes 0", { texto: MARCADOR, vezes: 0 }],
    ["vezes negativo", { texto: MARCADOR, vezes: -1 }],
    ["vezes fracionário", { texto: MARCADOR, vezes: 1.5 }],
    ["vezes em string", { texto: MARCADOR, vezes: "2" }],
    ["objeto sem texto", { vezes: 2 }],
    ["texto que não é string", { texto: 42 }],
    ["null no lugar do marcador", null],
    ["número no lugar do marcador", 42],
    ["lista aninhada", [MARCADOR]],
  ];
  for (const [nome, marcador] of ruins) {
    const checagem = { funcao: FUNCAO, esperado: [marcador] };
    assertEquals(checagemBemFormada(checagem), false, nome);
    const tarefas = montarTarefasDeVerificacao(["z.sql"], {
      "z.sql": checagem,
    });
    assertEquals(tarefas[0].checagem, undefined, nome);
    assertEquals(
      avaliarChecagem(undefined, tarefas[0].checagem).situacao,
      "pulada",
      nome,
    );
    assertStringIncludes(tarefas[0].linhasAntes.join(" "), "malformada");
  }
});

Deno.test("N1 vale para as duas formas: texto vazio ou só espaço não é marcador avaliado", () => {
  // `"".includes("")` era sempre true; com contagem, `contar(corpo, "")` seria
  // infinito ou absurdo. Nos dois casos a resposta certa é a mesma de sempre:
  // não conta como avaliado, e a checagem sai "pulada" em vez de "verificada".
  for (const vazio of ["", "   ", { texto: "" }, { texto: "  ", vezes: 2 }]) {
    const r = avaliarChecagem(CORPO_DUAS, {
      funcao: FUNCAO,
      esperado: [vazio],
    });
    assertEquals(r.situacao, "pulada", JSON.stringify(vazio));
    assertEquals(r.motivo, "a entrada registrada não confere nenhum marcador");
    assertEquals(r.linhas, [], JSON.stringify(vazio));
  }
});

// --------------------------------------------------------------------------
// avaliarChecagem e classificarChecagem — como a contagem errada entra no
// veredito. "Achou 3 onde esperava 2" NÃO é ausência: o sinal é próprio
// (`algumMarcadorDivergente`), e `algumMarcadorAusente` continua querendo
// dizer o que sempre quis (achou ZERO), para não mudar a semântica dos
// testes que já existiam.
// --------------------------------------------------------------------------

Deno.test("contagem divergente derruba a checagem inteira, mesmo sem nenhuma ausência", () => {
  const r = avaliarChecagem(CORPO_DUAS, {
    funcao: FUNCAO,
    esperado: [{ texto: MARCADOR, vezes: 3 }],
  });
  assertEquals(r.situacao, "falhou");
});

Deno.test("a linha impressa diz quantas achou e quantas o mapa declara", () => {
  // Quem lê o terminal é leigo e está decidindo DEPOIS do COMMIT: "AUSENTE"
  // sozinho não distingue "sumiu tudo" de "sobrou uma cópia".
  const r = avaliarChecagem(CORPO_UMA, {
    funcao: FUNCAO,
    esperado: [{ texto: MARCADOR, vezes: 2 }],
  });
  assertEquals(r.linhas.length, 1);
  assertStringIncludes(r.linhas[0], "SUMIU");
  assertStringIncludes(r.linhas[0], "1");
  assertStringIncludes(r.linhas[0], "2");
});

Deno.test("marcador com contagem certa imprime ok, como antes", () => {
  const r = avaliarChecagem(CORPO_DUAS, {
    funcao: FUNCAO,
    esperado: [{ texto: MARCADOR, vezes: 2 }],
  });
  assertEquals(r.situacao, "verificada");
  assertStringIncludes(r.linhas[0], "ok");
});

Deno.test("classificarChecagem: divergência de contagem → falhou", () => {
  const { situacao } = classificarChecagem({
    temRegistro: true,
    algumMarcadorAvaliado: true,
    algumMarcadorAusente: false,
    algumMarcadorDivergente: true,
  });
  assertEquals(situacao, "falhou");
});

Deno.test("classificarChecagem: sem o campo novo, o comportamento antigo é idêntico", () => {
  // Os testes de db_apply_resumo_verificacao_test.ts chamam sem este campo.
  assertEquals(
    classificarChecagem({
      temRegistro: true,
      algumMarcadorAvaliado: true,
      algumMarcadorAusente: false,
    }).situacao,
    "verificada",
  );
});

Deno.test("toda situação possível tem rótulo para o terminal", () => {
  // Sem isto, uma situação nova imprimiria "undefined" na coluna que o Gabriel
  // lê para decidir se confia.
  for (const situacao of ["ok", "ausente", "sumiu", "a_mais"]) {
    assertEquals(
      typeof ROTULO_DA_SITUACAO.get(situacao),
      "string",
      `situação sem rótulo: ${situacao}`,
    );
  }
});
