// @ts-nocheck
/**
 * Prova de forma (sem banco) de
 * 20261012000000_a_vitrine_sabe_que_o_produto_mudou.sql — a migration que
 * fecha o defeito medido em `realtimeSyncEngine.ts:884-921`: nenhuma
 * migration tocava `produtos.ultima_atualizacao` fora do INSERT, entao o
 * catchUp da vitrine nunca detectava mudanca de preco/estoque/foto.
 *
 * NENHUMA das sete verificacoes do CI olha SQL (ver CLAUDE.md), entao este
 * arquivo e' a UNICA rede contra: (A) a migration abrir uma transacao
 * escondida, (B) faltar um dos dois gatilhos, (C) o rollback esquecer de
 * derrubar algo que a migration criou, (D) o gatilho de reparenting
 * (mover a variante de produto) marcar so' UM dos dois produtos, e (E) a
 * entrada em `VERIFICACOES` (scripts/db-apply.cjs) ficar sem as duas
 * funcoes, o que faria `db-apply.cjs` aplicar sem verificar nada
 * (situacao "pulada").
 *
 * A deteccao de BEGIN/COMMIT REUSA `avaliarFase0` de
 * scripts/db-prove-rollback.cjs em vez de reescrever um regex novo — aquele
 * detector ja' passou por varias rodadas de mutacao contra comentario,
 * string, dollar-quote e CASE WHEN ... END (ver db_prove_rollback_test.ts).
 * Reescrever a mesma logica aqui duplicaria a chance de errar exatamente a
 * mesma classe de falso-positivo que aquele arquivo ja' fechou.
 */
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
const MIGRATION_PATH = `${DIR}../supabase/migrations/20261012000000_a_vitrine_sabe_que_o_produto_mudou.sql`;
const ROLLBACK_PATH = `${DIR}../rollback-manual-20261012000000_a_vitrine_sabe_que_o_produto_mudou.sql`;
const DB_APPLY_PATH = `${DIR}../scripts/db-apply.cjs`;

const sqlMigration = Deno.readTextFileSync(MIGRATION_PATH);
const sqlRollback = Deno.readTextFileSync(ROLLBACK_PATH);
const dbApplySource = Deno.readTextFileSync(DB_APPLY_PATH);

// ---------------------------------------------------------------------------
// Extratores — puros, usados tanto contra o arquivo real quanto contra
// versoes MUTADAS em memoria (nunca contra disco).
// ---------------------------------------------------------------------------

function extrairGatilhosCriados(sql) {
  const re =
    /CREATE TRIGGER (\w+)\s+(BEFORE|AFTER)\s+[\w\s|]+?\s+ON public\.(\w+)/g;
  const out = [];
  for (const m of sql.matchAll(re)) {
    out.push({ nome: m[1], tabela: m[3] });
  }
  return out;
}

function extrairFuncoesCriadas(sql) {
  const re = /CREATE OR REPLACE FUNCTION public\.(\w+)\(/g;
  return [...sql.matchAll(re)].map((m) => m[1]);
}

function extrairGatilhosDropados(sql) {
  const re = /DROP TRIGGER IF EXISTS (\w+) ON public\.(\w+)/g;
  const out = [];
  for (const m of sql.matchAll(re)) {
    out.push({ nome: m[1], tabela: m[2] });
  }
  return out;
}

function extrairFuncoesDropadas(sql) {
  const re = /DROP FUNCTION IF EXISTS public\.(\w+)\(/g;
  return [...sql.matchAll(re)].map((m) => m[1]);
}

/** true se os DOIS conjuntos (nome, tabela) sao iguais, ignorando ordem. */
function mesmosGatilhos(a, b) {
  const chave = (g) => `${g.nome}@${g.tabela}`;
  const sa = new Set(a.map(chave));
  const sb = new Set(b.map(chave));
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

function mesmasFuncoes(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

// ---------------------------------------------------------------------------
// A — sem BEGIN/COMMIT (nem na migration, nem no rollback-manual). Reusa o
// detector ja' mutado de db-prove-rollback.cjs.
// ---------------------------------------------------------------------------

Deno.test("A: avaliarFase0 nao recusa o par migration+rollback (sem BEGIN/COMMIT, CREATE OR REPLACE, dollar-quote bem formado)", () => {
  const r = avaliarFase0({ sqlMigration, sqlRollback, temRollback: true });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

// ---------------------------------------------------------------------------
// B — os dois gatilhos existem, apontando para a tabela certa e com o
// timing certo (BEFORE em produtos, AFTER em product_variants).
// ---------------------------------------------------------------------------

Deno.test("B: os dois gatilhos novos existem, na tabela certa", () => {
  const gatilhos = extrairGatilhosCriados(sqlMigration);
  assertEquals(gatilhos.length, 2, JSON.stringify(gatilhos));
  assert(
    gatilhos.some(
      (g) => g.nome === "set_ultima_atualizacao" && g.tabela === "produtos",
    ),
    "gatilho de produtos ausente ou na tabela errada",
  );
  assert(
    gatilhos.some(
      (g) =>
        g.nome === "sync_produto_ultima_atualizacao" &&
        g.tabela === "product_variants",
    ),
    "gatilho de product_variants ausente ou na tabela errada",
  );
});

Deno.test("B2: o gatilho de produtos e' BEFORE UPDATE (nao AFTER) — senao NEW.ultima_atualizacao nao seria gravado", () => {
  assertStringIncludes(sqlMigration, "BEFORE UPDATE ON public.produtos");
});

Deno.test("B3: o gatilho de product_variants cobre os TRES eventos (INSERT, UPDATE, DELETE)", () => {
  assertStringIncludes(
    sqlMigration,
    "AFTER INSERT OR UPDATE OR DELETE ON public.product_variants",
  );
});

// ---------------------------------------------------------------------------
// D — as duas funcoes novas existem.
// ---------------------------------------------------------------------------

Deno.test("D: as duas funcoes novas existem via CREATE OR REPLACE FUNCTION", () => {
  const funcoes = extrairFuncoesCriadas(sqlMigration);
  assertEquals(
    new Set(funcoes),
    new Set(["handle_produto_atualizado", "handle_variant_atualiza_produto"]),
  );
});

// ---------------------------------------------------------------------------
// C — simetria: tudo que a migration cria, o rollback derruba (e nada a
// mais, nem a menos).
// ---------------------------------------------------------------------------

Deno.test("C: o rollback derruba exatamente os gatilhos e funcoes que a migration cria", () => {
  const gatilhosCriados = extrairGatilhosCriados(sqlMigration);
  const gatilhosDropados = extrairGatilhosDropados(sqlRollback);
  assert(
    mesmosGatilhos(gatilhosCriados, gatilhosDropados),
    `criados: ${JSON.stringify(gatilhosCriados)} vs dropados: ${JSON.stringify(
      gatilhosDropados,
    )}`,
  );

  const funcoesCriadas = extrairFuncoesCriadas(sqlMigration);
  const funcoesDropadas = extrairFuncoesDropadas(sqlRollback);
  assert(
    mesmasFuncoes(funcoesCriadas, funcoesDropadas),
    `criadas: ${JSON.stringify(funcoesCriadas)} vs dropadas: ${JSON.stringify(
      funcoesDropadas,
    )}`,
  );
});

// ---------------------------------------------------------------------------
// F — o caso que doi, nao so' o caminho feliz: mover uma variante de um
// produto para outro (reparenting) tem que marcar os DOIS produtos, nao so'
// o novo dono. Sem isso o produto ANTIGO fica com uma oferta fantasma na
// vitrine (a variante que ele perdeu) sem nenhum sinal de que mudou.
// ---------------------------------------------------------------------------

Deno.test("F: o reparenting marca os DOIS produtos (OLD.product_id e NEW.product_id), nao so' um", () => {
  assertStringIncludes(
    sqlMigration,
    "OLD.product_id IS DISTINCT FROM NEW.product_id",
  );
  assertStringIncludes(sqlMigration, "WHERE id = OLD.product_id;");
  assertStringIncludes(sqlMigration, "WHERE id = NEW.product_id;");

  // O RAMO DO DELETE — a asercao que faltava, e o buraco era exatamente o
  // defeito-cabeca desta entrega.
  //
  // A revisao de contexto limpo provou no banco (transacao com ROLLBACK,
  // PostgreSQL 17.6) que num gatilho de linha para DELETE o `NEW.product_id`
  // avalia para NULL sem levantar erro, e o COALESCE cai para
  // `OLD.product_id`. Provou tambem o controle negativo: SEM o COALESCE, o
  // mesmo DELETE produz ZERO UPDATEs e NENHUM erro — falha silenciosa
  // perfeita.
  //
  // E provou que nenhum dos 20 testes daqui caia quando o COALESCE virava
  // `NEW.product_id`. Ou seja: alguem "simplifica" essa linha, os testes
  // passam, os sete comandos do CI passam (nenhum deles olha SQL), a
  // migration aplica sem erro — e a lojista apaga a variante "Azul", que
  // continua sendo oferecida na vitrine. O defeito original inteiro de volta,
  // entregue por um diff verde.
  //
  // A rede que existia (o marcador de VERIFICACOES do db-apply.cjs contem
  // este bloco) so' dispara quando alguem roda o script, DEPOIS do commit no
  // banco, e nunca no CI. Esta linha poe a guarda no unico lugar que o CI le.
  assertStringIncludes(
    sqlMigration,
    "COALESCE(NEW.product_id, OLD.product_id)",
  );
});

// ---------------------------------------------------------------------------
// G — o gatilho de produtos (BEFORE UPDATE, mesma linha) nao referencia
// product_variants: e' o que garante que a cadeia produtos -> product_variants
// -> produtos para em UMA volta, nunca vira loop.
// ---------------------------------------------------------------------------

function corpoDaFuncao(sql, nome) {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert(inicio >= 0, `funcao ${nome} nao encontrada`);
  const fimMarcador = "\n$$;";
  const fim = sql.indexOf(fimMarcador, inicio);
  assert(fim >= 0, `fim do corpo de ${nome} nao encontrado`);
  return sql.slice(inicio, fim + fimMarcador.length);
}

Deno.test("G: handle_produto_atualizado (BEFORE UPDATE na propria linha) nao referencia product_variants", () => {
  const corpo = corpoDaFuncao(sqlMigration, "handle_produto_atualizado");
  assert(
    !corpo.includes("product_variants"),
    "o gatilho de produtos passou a tocar product_variants — isso abriria " +
      "risco real de recursao com o gatilho de variantes",
  );
});

// ---------------------------------------------------------------------------
// H — a entrada em VERIFICACOES (scripts/db-apply.cjs) existe e cobre as
// DUAS funcoes com pelo menos um marcador cada. Sem isso o db-apply.cjs
// aplicaria a migration e sairia "pulada" (saida 2) — ninguem verificou.
// ---------------------------------------------------------------------------

/**
 * Extrai o bloco da entrada de VERIFICACOES para esta migration: do nome do
 * arquivo (como chave) ate o fechamento do mapa inteiro (`],\n};`), que so'
 * casa se esta for a ULTIMA entrada do mapa — verdade por construcao aqui,
 * e o que prova que a entrada esta DENTRO do objeto VERIFICACOES, nao numa
 * ocorrencia solta do nome do arquivo num comentario em outro lugar do
 * script (o nome de OUTRA migration ja aparece assim, em NOTA, na linha
 * anterior a esta entrada).
 */
function extrairEntradaVerificacoes(sourceDbApply, nomeArquivoMigration) {
  // `\r?\n`, nunca `\n` cru: db-apply.cjs vive em CRLF neste repositório
  // (core.autocrlf no Windows) — um `\n` literal nunca casaria o fim de
  // linha real, e a entrada pareceria "não encontrada" mesmo presente.
  const re = new RegExp(
    `"${nomeArquivoMigration.replace(
      /\./g,
      "\\.",
    )}":\\s*\\[([\\s\\S]*?)\\r?\\n\\s*\\],\\r?\\n\\};`,
  );
  const m = re.exec(sourceDbApply);
  return m ? m[1] : null;
}

Deno.test("H: VERIFICACOES tem entrada para esta migration cobrindo as duas funcoes", () => {
  const bloco = extrairEntradaVerificacoes(
    dbApplySource,
    "20261012000000_a_vitrine_sabe_que_o_produto_mudou.sql",
  );
  assert(
    bloco,
    "entrada de VERIFICACOES nao encontrada (ou nao e a ultima do mapa)",
  );
  assertStringIncludes(bloco, 'funcao: "handle_produto_atualizado"');
  assertStringIncludes(bloco, 'funcao: "handle_variant_atualiza_produto"');
  // Cada funcao precisa ter pelo menos um marcador nao-vazio em `esperado`
  // — "esperado: []" e' o "depois eu preencho" que db_apply_avaliar_
  // checagem_test.ts prova que vira PULADA em silencio.
  const semMarcador = /esperado:\s*\[\s*\]/.test(bloco);
  assert(
    !semMarcador,
    "alguma das funcoes tem esperado: [] (nunca verifica nada)",
  );
});

// ---------------------------------------------------------------------------
// MUTAÇÃO — cada bloco abaixo aplica UMA mutação em memória (nunca no
// disco) sobre o texto real e confirma que a asserção correspondente CAI.
// A tabela "o que mutei -> matou/sobreviveu" do relatório final é
// construída a partir destes testes.
// ---------------------------------------------------------------------------

/**
 * Aplica UMA sabotagem sobre o texto real e prova que ela PEGOU antes de
 * qualquer asserção descer: o padrão tem de casar EXATAMENTE uma vez, e o
 * texto tem de mudar.
 *
 * Existe porque o modo de falhar deste arquivo já aconteceu: os padrões de B,
 * C, F e C2 traziam `\n` cru, os dois arquivos SQL vivem em CRLF no disco
 * (`core.autocrlf=true` no gitconfig de SISTEMA, no Windows) e o `.replace`
 * virava no-op silencioso — quatro controles que não sabotavam nada, com a
 * cara de cobertura. Daí o `\r?\n` em todo padrão que atravessa fim de linha,
 * igual ao que `extrairEntradaVerificacoes` já fazia para db-apply.cjs.
 *
 * A contagem de ocorrências é a metade CIRÚRGICA da regra da casa: padrão que
 * casa duas vezes derruba mais do que a mutação diz derrubar, e aí a asserção
 * cair não prova que ela cobria o alvo.
 *
 * O padrão chega JÁ global (`/g`), em vez de ser reconstruído aqui com
 * `new RegExp`: `matchAll` exige a flag, e com a contagem travada em 1 um
 * `replace` global troca exatamente a mesma coisa que um não-global. Montar o
 * regex dinamicamente custaria um warning novo de `security/detect-non-literal-
 * regexp`, e a catraca de lint reprova warning novo igual a erro novo.
 */
function mutarUmaVez(texto, padrao, substituto, rotulo) {
  assert(
    padrao.global,
    `sabotagem "${rotulo}": o padrão precisa da flag /g para ser contado`,
  );
  // `matchAll` conta a partir de `lastIndex`, e `replace` global o ZERA antes
  // de rodar. Um padrão que chegasse com `lastIndex` sujo contaria 1 e
  // trocaria 2 — sabotagem dupla carimbada como cirúrgica, exatamente o que
  // este helper existe para impedir. Zerar aqui tira a premissa implícita de
  // que todo chamador passa um regex virgem.
  padrao.lastIndex = 0;
  const ocorrencias = [...texto.matchAll(padrao)].length;
  assertEquals(
    ocorrencias,
    1,
    `sabotagem "${rotulo}": casou ${ocorrencias} vez(es), esperado 1 — controle que não sabota não prova nada`,
  );
  const mutado = texto.replace(padrao, substituto);
  assert(
    mutado !== texto,
    `sabotagem "${rotulo}": o replace não alterou o texto`,
  );
  return mutado;
}

Deno.test("MUTACAO A: inserir BEGIN;/COMMIT; na migration faz avaliarFase0 recusar", () => {
  const mutado = `${sqlMigration.replace(
    "CREATE OR REPLACE FUNCTION public.handle_produto_atualizado()",
    "BEGIN;\nCREATE OR REPLACE FUNCTION public.handle_produto_atualizado()",
  )}\nCOMMIT;\n`;
  const r = avaliarFase0({ sqlMigration: mutado, temRollback: true });
  assert(r.recusado, "a asserção A não pegou um BEGIN/COMMIT inserido");
});

Deno.test("MUTACAO B: apagar o gatilho de product_variants faz a asserção B falhar", () => {
  const mutado = mutarUmaVez(
    sqlMigration,
    /CREATE TRIGGER sync_produto_ultima_atualizacao[\s\S]*?;\r?\n/g,
    "",
    "apagar CREATE TRIGGER sync_produto_ultima_atualizacao",
  );
  const gatilhos = extrairGatilhosCriados(mutado);
  assertEquals(
    gatilhos.some((g) => g.nome === "sync_produto_ultima_atualizacao"),
    false,
    "a mutação não removeu o gatilho — o extrator não teria como reprovar",
  );
  // Cirúrgica: derrubou UM gatilho, não os dois. Sem isto, um padrão guloso
  // que apagasse a migration inteira passaria por sabotagem válida.
  assert(
    gatilhos.some((g) => g.nome === "set_ultima_atualizacao"),
    "a mutação levou junto o gatilho de produtos — não é cirúrgica",
  );
});

Deno.test("MUTACAO D: renomear a função na linha CREATE OR REPLACE faz a asserção D falhar", () => {
  // Mira a linha CREATE especificamente — o nome também aparece no
  // cabeçalho de comentário da migration, e um `.replace` sem `/g` só troca
  // a PRIMEIRA ocorrência (que seria a do comentário, não a do CREATE).
  const mutado = sqlMigration.replace(
    "CREATE OR REPLACE FUNCTION public.handle_variant_atualiza_produto()",
    "CREATE OR REPLACE FUNCTION public.handle_variant_sincroniza_produto_ERRADO()",
  );
  const funcoes = extrairFuncoesCriadas(mutado);
  assert(
    !funcoes.includes("handle_variant_atualiza_produto"),
    "a mutação não afetou o nome extraído",
  );
});

Deno.test("MUTACAO C: apagar UM DROP do rollback quebra a simetria", () => {
  const rollbackMutado = mutarUmaVez(
    sqlRollback,
    /DROP TRIGGER IF EXISTS sync_produto_ultima_atualizacao ON public\.product_variants;\r?\n/g,
    "",
    "apagar DROP TRIGGER sync_produto_ultima_atualizacao do rollback",
  );
  const gatilhosCriados = extrairGatilhosCriados(sqlMigration);
  const gatilhosDropados = extrairGatilhosDropados(rollbackMutado);
  // Cirúrgica: sobrou EXATAMENTE o outro DROP TRIGGER. Se a mutação tivesse
  // levado os dois, a simetria quebraria do mesmo jeito — e o controle
  // passaria pelo motivo errado, sem cobrir o caso "esqueceu UM".
  assertEquals(
    gatilhosDropados.map((g) => g.nome),
    ["set_ultima_atualizacao"],
    "a mutação não deixou exatamente o outro DROP TRIGGER de pé",
  );
  assert(
    !mesmosGatilhos(gatilhosCriados, gatilhosDropados),
    "apagar um DROP do rollback deveria quebrar a simetria e não quebrou",
  );
});

Deno.test("MUTACAO F: apagar o ramo de reparenting faz a asserção F falhar", () => {
  const mutado = mutarUmaVez(
    sqlMigration,
    /IF TG_OP = 'UPDATE' AND OLD\.product_id IS DISTINCT FROM NEW\.product_id THEN[\s\S]*?ELSE\r?\n/g,
    "",
    "apagar o ramo de reparenting (IF ... THEN ... ELSE)",
  );
  // Cirúrgica: só o ramo do IF caiu — o UPDATE do caso comum (o do ELSE) e a
  // função que os contém continuam de pé.
  assertStringIncludes(
    mutado,
    "WHERE id = COALESCE(NEW.product_id, OLD.product_id);",
  );
  assertStringIncludes(
    mutado,
    "CREATE OR REPLACE FUNCTION public.handle_variant_atualiza_produto()",
  );
  assert(
    !mutado.includes("OLD.product_id IS DISTINCT FROM NEW.product_id"),
    "a mutação não removeu a guarda de reparenting",
  );
  assert(
    !/WHERE id = OLD\.product_id;/.test(mutado),
    "a mutação deveria ter removido a linha que marca o produto ANTIGO",
  );
});

Deno.test("MUTACAO G: inserir uma referência a product_variants no gatilho de produtos faz a asserção G falhar", () => {
  const mutado = sqlMigration.replace(
    "NEW.ultima_atualizacao = now();",
    "NEW.ultima_atualizacao = now(); -- SELECT 1 FROM public.product_variants;",
  );
  const corpo = corpoDaFuncao(mutado, "handle_produto_atualizado");
  assert(
    corpo.includes("product_variants"),
    "a mutação não injetou a referência dentro do corpo extraído",
  );
});

Deno.test("MUTACAO H: apagar a entrada de VERIFICACOES faz a asserção H falhar", () => {
  const mutado = dbApplySource.replace(
    /"20261012000000_a_vitrine_sabe_que_o_produto_mudou\.sql":\s*\[[\s\S]*?\r?\n\s*\],\r?\n\};/,
    "};",
  );
  const bloco = extrairEntradaVerificacoes(
    mutado,
    "20261012000000_a_vitrine_sabe_que_o_produto_mudou.sql",
  );
  assertEquals(bloco, null, "a mutação não removeu a entrada de VERIFICACOES");
});

Deno.test("MUTACAO H2: esvaziar o `esperado` de uma função (marcador E comentários) faz a guarda semMarcador acusar", () => {
  // Apagar só a linha do marcador não basta: a entrada real tem comentários
  // dentro do array, e eles sobrevivem entre `[` e `]` — o regex da guarda
  // exige os DOIS colados, de propósito (comentário sem marcador nenhum é
  // exatamente o "esperado: []" disfarçado que N1/db_apply_avaliar_
  // checagem_test.ts cobre do lado do script). Por isso a mutação apaga o
  // bloco `esperado: [...]` inteiro de handle_produto_atualizado.
  const mutado = dbApplySource.replace(
    /(funcao: "handle_produto_atualizado",\r?\n\s*esperado: )\[[\s\S]*?\r?\n\s*\],/,
    "$1[],",
  );
  const bloco = extrairEntradaVerificacoes(
    mutado,
    "20261012000000_a_vitrine_sabe_que_o_produto_mudou.sql",
  );
  assert(bloco, "a mutação não deveria ter removido a entrada inteira");
  const semMarcador = /esperado:\s*\[\s*\]/.test(bloco);
  assert(
    semMarcador,
    "esvaziar o esperado de handle_produto_atualizado deveria ter deixado " +
      "`esperado: []` visível no bloco extraído",
  );
});

Deno.test("MUTACAO B2: trocar BEFORE por AFTER no gatilho de produtos derruba a asserção B2", () => {
  const mutado = sqlMigration.replace(
    "BEFORE UPDATE ON public.produtos",
    "AFTER UPDATE ON public.produtos",
  );
  assert(
    !mutado.includes("BEFORE UPDATE ON public.produtos"),
    "a mutação não afetou a string exata que B2 procura",
  );
});

Deno.test("MUTACAO B3: remover 'OR DELETE' do gatilho de variantes derruba a asserção B3", () => {
  const mutado = sqlMigration.replace(
    "AFTER INSERT OR UPDATE OR DELETE ON public.product_variants",
    "AFTER INSERT OR UPDATE ON public.product_variants",
  );
  assert(
    !mutado.includes(
      "AFTER INSERT OR UPDATE OR DELETE ON public.product_variants",
    ),
    "a mutação não afetou a string exata que B3 procura",
  );
});

Deno.test("MUTACAO C2: apagar o DROP FUNCTION do rollback (lado das funções, não dos gatilhos) quebra a simetria", () => {
  const rollbackMutado = mutarUmaVez(
    sqlRollback,
    /DROP FUNCTION IF EXISTS public\.handle_variant_atualiza_produto\(\);\r?\n/g,
    "",
    "apagar DROP FUNCTION handle_variant_atualiza_produto do rollback",
  );
  const funcoesCriadas = extrairFuncoesCriadas(sqlMigration);
  const funcoesDropadas = extrairFuncoesDropadas(rollbackMutado);
  // Cirúrgica: a outra DROP FUNCTION sobreviveu — a simetria quebra por
  // FALTAR uma, não por ter sumido o bloco inteiro.
  assertEquals(
    funcoesDropadas,
    ["handle_produto_atualizado"],
    "a mutação não deixou exatamente a outra DROP FUNCTION de pé",
  );
  assert(
    !mesmasFuncoes(funcoesCriadas, funcoesDropadas),
    "apagar um DROP FUNCTION do rollback deveria quebrar a simetria de funções e não quebrou",
  );
});
