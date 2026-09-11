// @ts-nocheck
// O PERFIL PÚBLICO LÊ AVALIAÇÕES E PERGUNTAS PELA VITRINE DO AUTOR — prova
// offline do par 20261130000000 + rollback (brief
// equipe/entregas/20260911-brief-perfil-publico-pela-vitrine-do-autor.md).
//
// O DEFEITO QUE ESTE TESTE FIXA: a migration 20261111000000 (já escrita,
// ainda NÃO aplicada) tira o `anon` das policies de SELECT de
// `reviews`/`questions`. Sem o par provado aqui, o visitante sem sessão que
// abre o perfil público de um autor passaria a ver "0 avaliações"/"0
// perguntas" mesmo quando existem publicadas — porque as views
// `vw_reviews_public`/`vw_questions_public` não têm `user_id` e não servem
// para filtrar por AUTOR. Cada asserção abaixo está amarrada ao motivo:
// sabotar qualquer uma reabre esse furo, ou volta a vazar `user_id` para
// quem não tem por que ver.
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
const NOME = "20261130000000_o_perfil_publico_le_pela_vitrine_do_autor.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const rollbackN = norm(rollback);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior", () => {
  // A prova em transação (db-prove-perfil-publico.cjs) e a aplicação real
  // (db-apply.cjs) dependem de UMA transação externa sem interrupção — um
  // BEGIN/COMMIT escondido aqui grava direto no banco e invalida o ROLLBACK
  // da prova (regra da casa, sem exceção).
  const transMigration = detectarTransacaoExplicita(removerRuido(migration));
  const transRollback = detectarTransacaoExplicita(removerRuido(rollback));
  assertEquals(
    transMigration.achados,
    [],
    `migration contém controle de transação: ${transMigration.achados.join("/")}`,
  );
  assertEquals(
    transRollback.achados,
    [],
    `rollback contém controle de transação: ${transRollback.achados.join("/")}`,
  );
});

/**
 * Extrai o bloco de UMA função (assinatura + corpo + REVOKE + GRANT), pela
 * âncora do próprio nome — nunca por posição de linha. Devolve o texto CRU
 * (sem normalizar espaço), para as regex abaixo poderem casar contra a
 * quebra de linha real da definição de RETURNS TABLE.
 */
function extrairBloco(sql, nomeFuncao) {
  const inicio = sql.indexOf(
    `CREATE OR REPLACE FUNCTION public.${nomeFuncao}(`,
  );
  const marcadorFim = `GRANT EXECUTE ON FUNCTION public.${nomeFuncao}(uuid) TO anon, authenticated, service_role;`;
  const fim = sql.indexOf(marcadorFim);
  if (inicio === -1 || fim === -1) return null;
  return sql.slice(inicio, fim + marcadorFim.length);
}

/** O bloco `RETURNS TABLE (...)` de uma função, isolado do resto do corpo —
 * é ESSE trecho que decide o que o chamador recebe de volta, e é nele
 * (nunca no `WHERE ... user_id = p_autor` do corpo) que uma coluna `user_id`
 * vazaria para quem chama a RPC. */
function blocoReturnsTable(bloco) {
  const m = bloco.match(/RETURNS TABLE \(([\s\S]*?)\)\s*\r?\n?LANGUAGE sql/i);
  return m ? m[1] : null;
}

/** A lista de colunas do `SELECT` principal do corpo (entre `AS $$ SELECT`
 * e o `FROM public.<tabela>` da linha de origem) — é aqui, nunca no
 * `RETURNS TABLE`, que se vê se `product_id` sai como `p.id AS product_id`
 * (ADENDO 11/09 item 2) ou como o uuid cru da linha de reviews/questions.
 * Busca só por índice de string (nunca `new RegExp` com variável — dispara
 * `security/detect-non-literal-regexp`; mesmo motivo documentado em
 * tests/db_apply_mapa_contra_sql_test.ts). */
function blocoSelectList(bloco, tabelaFrom) {
  const inicioAs = bloco.indexOf("AS $$");
  if (inicioAs === -1) return null;
  const inicioSelect = bloco.indexOf("SELECT", inicioAs);
  if (inicioSelect === -1) return null;
  const marcadorFrom = `FROM public.${tabelaFrom}`;
  const fimSelect = bloco.indexOf(marcadorFrom, inicioSelect);
  if (fimSelect === -1) return null;
  return bloco.slice(inicioSelect + "SELECT".length, fimSelect);
}

const blocoAvaliacoes = extrairBloco(migration, "perfil_publico_avaliacoes");
const blocoPerguntas = extrairBloco(migration, "perfil_publico_perguntas");

Deno.test("as duas funcoes existem, cada uma com assinatura (p_autor uuid)", () => {
  assert(
    blocoAvaliacoes !== null,
    "perfil_publico_avaliacoes não encontrada (assinatura, RETURNS TABLE, REVOKE e GRANT juntos)",
  );
  assert(
    blocoPerguntas !== null,
    "perfil_publico_perguntas não encontrada (assinatura, RETURNS TABLE, REVOKE e GRANT juntos)",
  );
});

for (const [nome, bloco, aliasProductId, tabelaFrom] of [
  ["perfil_publico_avaliacoes", blocoAvaliacoes, "r.product_id", "reviews"],
  ["perfil_publico_perguntas", blocoPerguntas, "q.product_id", "questions"],
]) {
  Deno.test(`${nome}: SECURITY DEFINER + STABLE + search_path fechado (senão anon nunca alcança)`, () => {
    // Sem SECURITY DEFINER a função herda a RLS de quem chama — depois da
    // 20261111, anon não tem NENHUMA policy em reviews/questions, e a RPC
    // devolveria sempre zero linhas para o próprio visitante que ela existe
    // para servir. Sem STABLE, o planner não pode dobrar duas chamadas
    // iguais na mesma consulta (não é um bug de segurança, mas é o contrato
    // do brief). Sem SET search_path = public, um schema hostil na frente
    // do search_path de quem CHAMA poderia sequestrar `reviews`/`produtos`.
    assert(bloco !== null, `bloco de ${nome} ausente`);
    const blocoN = norm(bloco);
    assertStringIncludes(blocoN, norm("LANGUAGE sql"));
    assertStringIncludes(blocoN, norm("STABLE"));
    assertStringIncludes(blocoN, norm("SECURITY DEFINER"));
    assertStringIncludes(blocoN, norm("SET search_path = public"));
  });

  Deno.test(`${nome}: REVOKE de PUBLIC e GRANT só a anon/authenticated/service_role`, () => {
    // Sem o REVOKE, a função nasce executável por PUBLIC (comportamento
    // padrão do Postgres para função nova) — qualquer papel futuro herdaria
    // acesso sem ninguém ter decidido isso. Sem o GRANT a anon, o visitante
    // sem sessão — a razão de esta função existir — não consegue chamá-la.
    assert(bloco !== null, `bloco de ${nome} ausente`);
    const blocoN = norm(bloco);
    assertStringIncludes(
      blocoN,
      norm(`REVOKE EXECUTE ON FUNCTION public.${nome}(uuid) FROM PUBLIC;`),
    );
    assertStringIncludes(
      blocoN,
      norm(
        `GRANT EXECUTE ON FUNCTION public.${nome}(uuid) TO anon, authenticated, service_role;`,
      ),
    );
  });

  Deno.test(`${nome}: o produto vem só se ativo E NÃO apagado (ativo=true AND deleted_at IS NULL amarrados no ON, nunca no WHERE)`, () => {
    // Sem "ativo = true" no ON do LEFT JOIN (e não no WHERE — um WHERE
    // transformaria o LEFT JOIN em INNER JOIN de fato, escondendo a
    // avaliação/pergunta inteira quando o produto foi desativado), produto
    // inativo ou apagado devolveria a linha ANTIGA em vez do placeholder que
    // o contrato promete. Ancorar no ON (em vez de procurar as duas
    // substrings soltas em qualquer lugar do bloco) é o que faz esta
    // asserção cair quando alguém move a condição para o WHERE: a substring
    // solta continuava presente nos dois lugares, e por isso não discriminava.
    // ADENDO 11/09 item 1: sem "deleted_at IS NULL" a SECURITY DEFINER
    // entrega ao visitante nome/foto de produto que o lojista apagou
    // (soft delete) — o que a vitrine anônima nega (vw_produtos_public
    // filtra ativo=true AND deleted_at IS NULL, baseline:4405).
    assert(bloco !== null, `bloco de ${nome} ausente`);
    const blocoN = norm(bloco);
    assertStringIncludes(
      blocoN,
      norm(
        `LEFT JOIN public.produtos p ON p.id = ${aliasProductId} AND p.ativo = true AND p.deleted_at IS NULL`,
      ),
    );
    const idxWhere = blocoN.indexOf(" WHERE ");
    assert(idxWhere !== -1, `WHERE não encontrado no bloco de ${nome}`);
    const trechoWhere = blocoN.slice(idxWhere);
    assert(
      !trechoWhere.includes("p.ativo") && !trechoWhere.includes("p.deleted_at"),
      `p.ativo/p.deleted_at aparecem depois do WHERE em ${nome} (o LEFT JOIN viraria INNER JOIN de fato): ${trechoWhere}`,
    );
  });

  Deno.test(`${nome}: RETURNS TABLE nao devolve user_id (nem o de quem perguntou/avaliou, nem o de quem respondeu)`, () => {
    // ESTE é o achado que a frente inteira existe para fechar: nenhuma das
    // duas RPCs pode devolver a coluna que identifica o autor — quem chama
    // já sabe o uuid (veio da navegação), a RPC nunca devolve o de mais
    // ninguém. Sabotar isto (acrescentar `user_id` ao RETURNS TABLE) reabre
    // o mesmo vazamento que a 20261111 fecha na tabela.
    assert(bloco !== null, `bloco de ${nome} ausente`);
    const colunas = blocoReturnsTable(bloco);
    assert(colunas !== null, `RETURNS TABLE de ${nome} não encontrado`);
    assert(
      !colunas.includes("user_id"),
      `RETURNS TABLE de ${nome} contém user_id: ${colunas}`,
    );
  });

  Deno.test(`${nome}: RETURNS TABLE so tem colunas uuid chamadas "id" e "product_id"`, () => {
    // ADENDO 11/09 item 4: o teste de ausência de "user_id" acima casa só
    // pela substring do nome. Um sabotador que renomeasse a coluna para
    // `autor uuid` (mesmo tipo, nome diferente) passaria por aquele teste
    // e continuaria devolvendo o uuid do autor para quem chama. Este teste
    // enumera TODAS as colunas do tipo uuid do RETURNS TABLE e exige que
    // sejam exatamente {id, product_id} — nenhuma terceira coluna uuid,
    // com QUALQUER nome, pode existir.
    assert(bloco !== null, `bloco de ${nome} ausente`);
    const colunas = blocoReturnsTable(bloco);
    assert(colunas !== null, `RETURNS TABLE de ${nome} não encontrado`);
    const nomesUuid = colunas
      .split(",")
      .map((l) => norm(l))
      .filter((l) => l.length > 0 && /\buuid\b/i.test(l))
      .map((l) => l.split(/\s+/)[0]);
    assertEquals(
      [...nomesUuid].sort(),
      ["id", "product_id"],
      `colunas uuid do RETURNS TABLE de ${nome} deveriam ser só id/product_id, achei: ${nomesUuid.join(", ") || "(nenhuma)"}`,
    );
  });

  Deno.test(`${nome}: SELECT devolve p.id AS product_id, nunca ${aliasProductId} cru`, () => {
    // ADENDO 11/09 item 2: o uuid de um produto negado ao anon (inativo ou
    // apagado) não pode sair no JSON. `${aliasProductId}` é o id bruto da
    // linha de reviews/questions — ele sempre existe, mesmo quando o
    // produto não é público. `p.id` vem do LEFT JOIN e é NULL exatamente
    // quando produto_nome também é NULL (produto não público), o que o
    // contrato promete.
    assert(bloco !== null, `bloco de ${nome} ausente`);
    const listaSelect = blocoSelectList(bloco, tabelaFrom);
    assert(listaSelect !== null, `lista de SELECT de ${nome} não encontrada`);
    const selectListN = norm(listaSelect);
    assertStringIncludes(
      selectListN,
      norm("p.id AS product_id"),
      `SELECT de ${nome} não devolve p.id AS product_id: ${selectListN}`,
    );
    assert(
      !selectListN.includes(`${aliasProductId},`) &&
        !selectListN.includes(`${aliasProductId} AS`),
      `SELECT de ${nome} ainda devolve ${aliasProductId} cru (uuid de produto não público vazaria): ${selectListN}`,
    );
  });
}

Deno.test("cabecalho NAO alega 'mesmo alcance que' (ADENDO item 8 — public_profiles é listável por anon, a RPC não herda esse alcance por analogia)", () => {
  // public_profiles_select_policy USING (true) deixa qualquer visitante
  // LISTAR pessoas — a RPC nova não "dá o mesmo alcance": ela fecha
  // user_id e produto não público, e é isso (não uma comparação com
  // public_profiles) que o cabeçalho tem de descrever.
  assert(
    !migration.includes("mesmo alcance que"),
    "cabeçalho da migration ainda contém a frase proibida 'mesmo alcance que' — ver ADENDO 11/09 item 8",
  );
});

Deno.test("perfil_publico_avaliacoes: só avaliação PUBLICADA do autor, mais recente primeiro", () => {
  // Sem o filtro de status, a pendente do autor (que só ele e o admin podem
  // ver hoje) vazaria para QUALQUER visitante sem sessão — regressão de
  // privacidade pior do que o defeito original.
  assert(blocoAvaliacoes !== null);
  const blocoN = norm(blocoAvaliacoes);
  assertStringIncludes(blocoN, norm("r.status = 'publicada'"));
  assertStringIncludes(blocoN, norm("r.user_id = p_autor"));
  assertStringIncludes(blocoN, norm("ORDER BY r.created_at DESC"));
});

Deno.test("perfil_publico_perguntas: agrega as respostas em ordem cronologica, '[]' quando nao ha nenhuma", () => {
  // Sem o COALESCE, uma pergunta sem resposta devolveria `answers: null` em
  // vez do array vazio que o front espera — e sem "ORDER BY ... ASC" dentro
  // do jsonb_agg, a ordem das respostas dependeria da ordem física de
  // armazenamento, não da hora em que cada uma foi dada.
  assert(blocoPerguntas !== null);
  const blocoN = norm(blocoPerguntas);
  assertStringIncludes(blocoN, norm("q.user_id = p_autor"));
  assertStringIncludes(blocoN, norm("ORDER BY q.created_at DESC"));
  assertStringIncludes(blocoN, norm("jsonb_agg"));
  assertStringIncludes(blocoN, norm("an.created_at ASC"));
  assertStringIncludes(blocoN, norm("COALESCE"));
  assertStringIncludes(blocoN, norm("'[]'"));
});

Deno.test("o rollback derruba as duas funcoes pela assinatura (uuid), nada mais", () => {
  // IF EXISTS: repetir o rollback não pode virar erro. A assinatura (uuid)
  // tem de casar EXATAMENTE com a criada — um DROP sem assinatura nenhuma
  // falharia se um dia existir outra sobrecarga do mesmo nome.
  assertStringIncludes(
    rollbackN,
    norm("DROP FUNCTION IF EXISTS public.perfil_publico_avaliacoes(uuid);"),
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP FUNCTION IF EXISTS public.perfil_publico_perguntas(uuid);"),
  );
});
