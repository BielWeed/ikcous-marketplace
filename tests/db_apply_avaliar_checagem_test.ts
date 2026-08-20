// @ts-nocheck
/**
 * A checagem por FUNÇÃO — scripts/db-apply.cjs
 *
 * Terceira rodada em cima do defeito de 20/08/2026 (a primeira foi o
 * cabeçalho de rollback em db_apply_rollback_test.ts, a segunda foi o
 * `resumirVerificacao`/`classificarChecagem` em
 * db_apply_resumo_verificacao_test.ts). As duas rodadas anteriores moveram a
 * fronteira sem fechá-la: extraíram uma função pura e testaram ela, mas o
 * laço de `main()` que MONTA a entrada dessa função pura continuou sem
 * nenhum teste — e é justamente ali que o incidente de 20/08 mora: era
 * `main()`, não `classificarChecagem`, quem decidia `temRegistro: false`
 * para uma migration sem entrada em VERIFICACOES.
 *
 * `avaliarChecagem(def, checagem)` fecha essa fronteira: ela recebe o dado
 * CRU vindo do banco (`def`, a definição da função, ou `undefined` quando a
 * função não existe) e o objeto de checagem cru (`checagem`, ou `undefined`
 * quando a migration não tem entrada nenhuma em VERIFICACOES) — os dois
 * mesmos formatos que `main()` tem em mãos antes de decidir qualquer coisa.
 * Ela decide `situacao` chamando `classificarChecagem` e devolve as linhas
 * já formatadas para impressão, para que `main()` só precise imprimir e
 * empilhar.
 *
 * Cada teste abaixo passa os dados no MESMO formato que main() passaria —
 * nunca um booleano digitado à mão — porque foi exatamente um booleano
 * digitado à mão, sem teste em cima da derivação, que deixou o incidente de
 * 20/08 passar pela suíte anterior.
 *
 * Mora em tests/ pelo mesmo motivo dos outros dois arquivos irmãos, e usa
 * createRequire porque db-apply.cjs é CommonJS.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarChecagem, montarTarefasDeVerificacao } = require(
  "../scripts/db-apply.cjs",
);

const FUNCAO = "minha_funcao";

// --------------------------------------------------------------------------
// O caso literal de 20/08/2026: a migration não tem entrada NENHUMA em
// VERIFICACOES. `checagem` chega como `undefined` — o mesmo valor que
// `montarTarefasDeVerificacao` produz quando `VERIFICACOES[base]` não existe.
// --------------------------------------------------------------------------

Deno.test("sem entrada em VERIFICACOES (checagem undefined) → pulada, motivo de entrada ausente", () => {
  const resultado = avaliarChecagem(undefined, undefined);
  assertEquals(resultado.situacao, "pulada");
  assertEquals(resultado.motivo, "nenhuma verificação registrada");
  assertEquals(resultado.linhas, []);
  assertEquals(resultado.funcao, undefined);
  assertEquals(resultado.funcaoAusente, false);
});

// --------------------------------------------------------------------------
// A2: a função não existe no schema. O `def` vem `undefined` do banco, mas a
// migration TEM entrada em VERIFICACOES — o rótulo tem de explicar a causa
// (função ausente), não sugerir corpo divergente.
// --------------------------------------------------------------------------

Deno.test("def === undefined (função não existe no schema): linha A2 aparece e o resultado não é verificada", () => {
  const checagem = { funcao: FUNCAO, esperado: ["marcador qualquer"] };
  const resultado = avaliarChecagem(undefined, checagem);
  assertNotEquals(resultado.situacao, "verificada");
  assertEquals(resultado.funcaoAusente, true);
  assert(
    resultado.linhas.some((l) => l.includes("não existe no schema")),
    `esperava a linha A2 entre: ${JSON.stringify(resultado.linhas)}`,
  );
});

// --------------------------------------------------------------------------
// `esperado` vazio ou só com marcadores em branco: pulada, nunca verificada.
// N1 cobre a variante com string vazia/só-espaço — `"".includes("")` é
// sempre `true`, então sem a guarda um marcador vazio "casava" sem comparar
// nada.
// --------------------------------------------------------------------------

Deno.test("esperado: [] → pulada, motivo de nenhum marcador conferido", () => {
  const checagem = { funcao: FUNCAO, esperado: [] };
  const resultado = avaliarChecagem("CREATE OR REPLACE FUNCTION public.f()", checagem);
  assertEquals(resultado.situacao, "pulada");
  assertEquals(resultado.motivo, "a entrada registrada não confere nenhum marcador");
});

Deno.test("N1: esperado: [''] (string vazia) → pulada, não verificada", () => {
  const checagem = { funcao: FUNCAO, esperado: [""] };
  const resultado = avaliarChecagem("qualquer corpo de função", checagem);
  assertEquals(resultado.situacao, "pulada");
  assertEquals(resultado.motivo, "a entrada registrada não confere nenhum marcador");
});

Deno.test("N1: esperado: ['   '] (só espaço) → pulada, não verificada", () => {
  const checagem = { funcao: FUNCAO, esperado: ["   "] };
  const resultado = avaliarChecagem("qualquer corpo de função", checagem);
  assertEquals(resultado.situacao, "pulada");
  assertEquals(resultado.motivo, "a entrada registrada não confere nenhum marcador");
});

Deno.test("N1: marcador vazio misturado com marcador real — o vazio não conta, o real ainda é avaliado", () => {
  const checagem = { funcao: FUNCAO, esperado: ["", "presente"] };
  const resultado = avaliarChecagem("corpo com a palavra presente dentro", checagem);
  assertEquals(resultado.situacao, "verificada");
  // Só uma linha impressa — a do marcador "presente"; o vazio não gera linha
  // nenhuma, senão o terminal mostraria "ok" para algo que não foi comparado.
  assertEquals(resultado.linhas.length, 1);
});

// --------------------------------------------------------------------------
// Marcador presente / ausente — o caminho central.
// --------------------------------------------------------------------------

Deno.test("marcador presente na definição → ok, verificada", () => {
  const checagem = { funcao: FUNCAO, esperado: ["ELSE valor"] };
  const resultado = avaliarChecagem("BEGIN IF x THEN y ELSE valor END IF; END", checagem);
  assertEquals(resultado.situacao, "verificada");
  assert(resultado.linhas[0].includes("ok"));
});

Deno.test("marcador ausente na definição → falhou", () => {
  const checagem = { funcao: FUNCAO, esperado: ["texto que não existe no corpo"] };
  const resultado = avaliarChecagem("BEGIN RETURN 1; END", checagem);
  assertEquals(resultado.situacao, "falhou");
  assert(resultado.linhas[0].includes("AUSENTE"));
});

Deno.test("um marcador presente e outro ausente → falhou (não basta um passar)", () => {
  const checagem = {
    funcao: FUNCAO,
    esperado: ["está aqui", "não está aqui"],
  };
  const resultado = avaliarChecagem("o texto está aqui dentro do corpo", checagem);
  assertEquals(resultado.situacao, "falhou");
});

// --------------------------------------------------------------------------
// A normalização de quebra de linha. O repo não tem .gitattributes e o
// core.autocrlf converte as migrations para CRLF no working tree — um
// marcador que cruza uma quebra de linha (como o de devolver_estoque, real
// em VERIFICACOES) não pode gritar AUSENTE contra um corpo em CRLF.
// --------------------------------------------------------------------------

Deno.test("marcador que cruza quebra de linha casa mesmo com o def em CRLF", () => {
  const marcadorLF = "ELSE\n            UPDATE public.produtos";
  const defCRLF =
    "CREATE OR REPLACE FUNCTION public.devolver_estoque()\r\n" +
    "AS $$\r\nBEGIN\r\n  IF v_item.variant_id IS NOT NULL THEN\r\n" +
    "            UPDATE public.variantes SET estoque = estoque + 1;\r\n" +
    "        ELSE\r\n            UPDATE public.produtos SET estoque = estoque + 1;\r\n" +
    "        END IF;\r\nEND;\r\n$$;";
  const checagem = { funcao: "devolver_estoque", esperado: [marcadorLF] };
  const resultado = avaliarChecagem(defCRLF, checagem);
  assertEquals(resultado.situacao, "verificada");
});

Deno.test("marcador em CRLF contra def em LF também casa (normalização dos dois lados)", () => {
  const marcadorCRLF = "ELSE\r\n            UPDATE public.produtos";
  const defLF =
    "CREATE OR REPLACE FUNCTION public.devolver_estoque()\n" +
    "AS $$\nBEGIN\n        ELSE\n            UPDATE public.produtos SET estoque = estoque + 1;\n" +
    "        END IF;\nEND;\n$$;";
  const checagem = { funcao: "devolver_estoque", esperado: [marcadorCRLF] };
  const resultado = avaliarChecagem(defLF, checagem);
  assertEquals(resultado.situacao, "verificada");
});

// --------------------------------------------------------------------------
// M2 — a mutação que reproduz o incidente literal: trocar os literais do
// ramo `checagem === undefined` para `temRegistro: true, algumMarcadorAvaliado:
// true` faz este teste (o primeiro da lista acima) sair "verificada" em vez
// de "pulada". Este teste extra deixa a intenção explícita: mesmo com
// `def` preenchido (função existe, corpo qualquer), ausência de `checagem`
// nunca pode virar sucesso.
// --------------------------------------------------------------------------

Deno.test("M2: checagem undefined nunca verifica, mesmo com def presente e não-vazio", () => {
  const resultado = avaliarChecagem(
    "CREATE OR REPLACE FUNCTION public.qualquer() AS $$ BEGIN END $$;",
    undefined,
  );
  assertEquals(resultado.situacao, "pulada");
});

// --------------------------------------------------------------------------
// montarTarefasDeVerificacao — a outra metade da fronteira: é ela quem
// decide se um arquivo produz `checagem: undefined` (sem entrada) ou uma
// lista de checagens (uma ou várias funções). Não tinha teste nenhum antes
// desta rodada.
// --------------------------------------------------------------------------

Deno.test("montarTarefasDeVerificacao: arquivo sem entrada em VERIFICACOES → uma tarefa com checagem undefined", () => {
  const tarefas = montarTarefasDeVerificacao(["x.sql"], {});
  assertEquals(tarefas.length, 1);
  assertEquals(tarefas[0].checagem, undefined);
  assertStringIncludes(tarefas[0].linhasAntes[0], "sem verificação registrada");
});

Deno.test("montarTarefasDeVerificacao: arquivo com entrada única (objeto) → uma tarefa com essa checagem", () => {
  const registro = { funcao: "f", esperado: ["m"] };
  const tarefas = montarTarefasDeVerificacao(["y.sql"], { "y.sql": registro });
  assertEquals(tarefas.length, 1);
  assertEquals(tarefas[0].checagem, registro);
  assertEquals(tarefas[0].linhasAntes, []);
});

Deno.test("montarTarefasDeVerificacao: arquivo com entrada em lista (várias funções) → uma tarefa por função", () => {
  const registro = [
    { funcao: "f1", esperado: ["a"] },
    { funcao: "f2", esperado: ["b"] },
  ];
  const tarefas = montarTarefasDeVerificacao(["z.sql"], { "z.sql": registro });
  assertEquals(tarefas.length, 2);
  assertEquals(tarefas[0].checagem.funcao, "f1");
  assertEquals(tarefas[1].checagem.funcao, "f2");
});
// --------------------------------------------------------------------------
// Entrada MALFORMADA no mapa. Achados A e B da terceira revisao: nenhuma
// destas formas existe no VERIFICACOES de hoje, e todas sao o jeito mais
// natural de alguem encostar no mapa ("depois eu preencho").
//
// A regra: entrada malformada e DESCONHECIDO — nunca sucesso, nunca crash,
// e nunca o arquivo sumir do veredito.
// --------------------------------------------------------------------------

Deno.test("entrada [] nao faz o arquivo sumir do veredito — vira tarefa pulada", () => {
  // Antes: [] nao era undefined e Array.isArray([]) e true, entao o laco
  // interno nao empurrava tarefa nenhuma. O arquivo era aplicado, comitado,
  // nunca conferido, e NAO APARECIA em lugar nenhum da saida — com o script
  // imprimindo "Tudo aplicado e verificado" contando so os outros.
  const tarefas = montarTarefasDeVerificacao(["alter.sql"], { "alter.sql": [] });
  assertEquals(tarefas.length, 1);
  assertEquals(tarefas[0].checagem, undefined);
  assertEquals(avaliarChecagem(undefined, tarefas[0].checagem).situacao, "pulada");
});

Deno.test("entrada [] no meio de arquivos validos nao desaparece do veredito", () => {
  // O caso que morde de verdade: misturado, a guarda de lista vazia de
  // resumirVerificacao nao pega, porque a lista NAO fica vazia.
  const tarefas = montarTarefasDeVerificacao(
    ["alter.sql", "func.sql"],
    { "alter.sql": [], "func.sql": { funcao: "f", esperado: ["M"] } },
  );
  assertEquals(tarefas.length, 2);
  assertEquals(tarefas.map((t) => t.base), ["alter.sql", "func.sql"]);
});

Deno.test("entradas falsy (null, string vazia, 0, false) viram pulada, nunca TypeError", () => {
  // Regressao introduzida ao trocar `!registro` por `registro === undefined`:
  // null passava a chegar em avaliarChecagem e estourar TypeError DEPOIS do
  // COMMIT do passo 2, num script cuja razao de existir e contar direito o
  // que aconteceu com o banco.
  for (const ruim of [null, "", 0, false]) {
    const qual = `entrada ${JSON.stringify(ruim)}`;
    const tarefas = montarTarefasDeVerificacao(["x.sql"], { "x.sql": ruim });
    assertEquals(tarefas.length, 1, qual);
    assertEquals(tarefas[0].checagem, undefined, qual);
    const r = avaliarChecagem(undefined, tarefas[0].checagem);
    assertEquals(r.situacao, "pulada", qual);
  }
});

Deno.test("o nome do arquivo casa no mapa mesmo vindo com pasta na frente", () => {
  // main() aceita caminho (faz path.join(MIGRATIONS_DIR, path.basename(nome))
  // duas vezes), entao a busca no mapa tem de usar a base. Sem isso, rodar
  // com "supabase/migrations/y.sql" faria TUDO virar "sem verificacao".
  const registro = { funcao: "f", esperado: ["m"] };
  const tarefas = montarTarefasDeVerificacao(
    ["supabase/migrations/y.sql"],
    { "y.sql": registro },
  );
  assertEquals(tarefas.length, 1);
  assertEquals(tarefas[0].base, "y.sql");
  assertEquals(tarefas[0].checagem, registro);
});

Deno.test("avaliarChecagem devolve a funcao conferida, para o veredito poder nomea-la", () => {
  // Sem isto, uma migration com 5 checagens imprime o mesmo nome de arquivo
  // 5 vezes na linha de AUSENTE, sem dizer QUAL funcao quebrou — perda de
  // diagnostico justamente depois do COMMIT.
  const r = avaliarChecagem("corpo com MARCADOR aqui", {
    funcao: "minha_f",
    esperado: ["MARCADOR"],
  });
  assertEquals(r.situacao, "verificada");
  assertEquals(r.funcao, "minha_f");
});

// --------------------------------------------------------------------------
// Achado da revisão: a guarda cobria o RECIPIENTE (undefined, null, lista
// vazia) e deixava o CONTEÚDO passar. `{ funcao: "f" }` sem `esperado` —
// literalmente o "depois eu preencho" que o cabeçalho acima invoca — chegava
// em avaliarChecagem e estourava `checagem.esperado is not iterable`.
//
// Por que isso é pior do que parece: o crash sai pelo `main().catch` com
// código 1, que é O MESMO código do passo 2, onde ele significa "Nada foi
// comitado desta migration". O operador lê "não comitou" e tudo comitou.
// --------------------------------------------------------------------------

Deno.test("checagem sem `esperado` vira pulada, não TypeError", () => {
  const tarefas = montarTarefasDeVerificacao(["x.sql"], {
    "x.sql": { funcao: "f" },
  });
  assertEquals(tarefas.length, 1);
  assertEquals(tarefas[0].checagem, undefined);
  assertEquals(avaliarChecagem(undefined, tarefas[0].checagem).situacao, "pulada");
  assertStringIncludes(tarefas[0].linhasAntes.join(" "), "malformada");
});

Deno.test("checagem malformada NO MEIO de uma lista não derruba as irmãs boas", () => {
  // A primeira confere normalmente; a segunda estourava e levava a rodada
  // inteira junto, sem veredito nenhum.
  const tarefas = montarTarefasDeVerificacao(["y.sql"], {
    "y.sql": [
      { funcao: "f1", esperado: ["A"] },
      { funcao: "f2" },
    ],
  });
  assertEquals(tarefas.length, 2);
  assertEquals(tarefas[0].checagem.funcao, "f1");
  assertEquals(tarefas[1].checagem, undefined);
  assertEquals(avaliarChecagem("corpo com A", tarefas[0].checagem).situacao, "verificada");
  assertEquals(avaliarChecagem(undefined, tarefas[1].checagem).situacao, "pulada");
});

Deno.test("todas as formas malformadas viram pulada — nenhuma estoura", () => {
  // Cada uma destas produzia um TypeError diferente, DEPOIS do COMMIT.
  const ruins = [
    ["objeto sem esperado", { funcao: "f" }],
    ["esperado que não é lista", { funcao: "f", esperado: "MARCADOR" }],
    ["objeto sem funcao", { esperado: ["M"] }],
    ["funcao que não é string", { funcao: 42, esperado: ["M"] }],
    ["lista com null dentro", [null]],
    ["lista com número dentro", [42]],
    ["booleano no lugar do registro", true],
    ["número no lugar do registro", 42],
  ];
  for (const [nome, registro] of ruins) {
    const tarefas = montarTarefasDeVerificacao(["z.sql"], { "z.sql": registro });
    assertEquals(tarefas.length, 1, nome);
    assertEquals(tarefas[0].checagem, undefined, nome);
    const r = avaliarChecagem(undefined, tarefas[0].checagem);
    assertEquals(r.situacao, "pulada", nome);
  }
});

Deno.test("`esperado: [1, 2]` (lista de não-strings) vira pulada, não estoura no .replace", () => {
  // Array.isArray passa, mas marcadorBruto.replace(...) não existe em número.
  const tarefas = montarTarefasDeVerificacao(["w.sql"], {
    "w.sql": { funcao: "f", esperado: [1, 2] },
  });
  assertEquals(tarefas[0].checagem, undefined);
  assertEquals(avaliarChecagem(undefined, tarefas[0].checagem).situacao, "pulada");
});
