// @ts-nocheck
// O CPF MORA NA CONTA — 20261173000000 (23/09/2026). Prova o CONTRATO da
// migration que ensina `get_my_cpf`/`set_my_cpf`: SECURITY DEFINER com
// search_path fixo, sempre a PRÓPRIA linha via auth.uid() (nunca função
// anônima nem por user_id), grant só para authenticated, ERRCODE
// customizado nas duas famílias de recusa (para o front nunca precisar do
// texto da mensagem), e nenhum DROP/ALTER de objeto que já existia antes
// desta migration.
//
// DUAS FERRAMENTAS, dois papéis — não misturar:
//   - `removerRuido` (de db-prove-rollback.cjs) tira comentário E o CORPO
//     inteiro de todo bloco `$tag$...$tag$` (troca por um espaço) — é
//     assim que ela evita que um `BEGIN`/`DROP` DENTRO de uma função PL/pgSQL
//     conte como comando de nível superior. Usada aqui só para as duas
//     provas que são sobre o NÍVEL SUPERIOR do arquivo (contagem de
//     `CREATE OR REPLACE FUNCTION`, ausência de `DROP`/`ALTER` fora de
//     função) — o cabeçalho comentado deste arquivo CITA essas palavras em
//     prosa, e sem `removerRuido` a prosa contaria como código.
//   - Para inspecionar o MIOLO das funções (SECURITY DEFINER, auth.uid(),
//     ERRCODE, a mensagem do RAISE) a busca é no texto BRUTO da migration,
//     via a ASSINATURA EXATA (`CREATE OR REPLACE FUNCTION
//     public.get_my_cpf()` / `...set_my_cpf(p_cpf text)`), que não aparece
//     assim, literalmente, em nenhum comentário — `removerRuido` apagaria
//     o próprio corpo que estas provas precisam ler.
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
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261173000000_o_cpf_mora_na_conta.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const codigoSemFuncoes = removerRuido(migration);
const codigoRollbackSemFuncoes = removerRuido(rollback);

const norm = (s) => s.replace(/\s+/g, " ").trim();

/** Statement completo (do CREATE ao `$function$;`), extraído do texto
 * BRUTO pela assinatura EXATA — nunca aparece assim em comentário. */
function statement(sqlBruto, assinaturaExata) {
  const ini = sqlBruto.indexOf(assinaturaExata);
  assert(ini >= 0, `${assinaturaExata} não encontrada no texto bruto`);
  const fim = sqlBruto.indexOf("$function$;", ini) + "$function$;".length;
  assert(fim > ini, `fechamento $function$; não encontrado após a assinatura`);
  return sqlBruto.slice(ini, fim);
}

const ASSINATURA_GET = "CREATE OR REPLACE FUNCTION public.get_my_cpf()";
const ASSINATURA_SET =
  "CREATE OR REPLACE FUNCTION public.set_my_cpf(p_cpf text)";

Deno.test("avaliarFase0 não recusa o par migration+rollback (sem BEGIN/COMMIT escondido, CREATE OR REPLACE nos dois)", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nível superior do arquivo tem EXATAMENTE dois statements CREATE OR REPLACE FUNCTION (comentário e corpo das funções não contam)", () => {
  assertEquals(
    codigoSemFuncoes.split("CREATE OR REPLACE FUNCTION").length - 1,
    2,
    "cabeçalho comentado vazou para a contagem, ou a migration ganhou/perdeu uma função",
  );
});

Deno.test("as assinaturas exatas aparecem UMA vez cada no texto bruto (garante que a extração por indexOf é inequívoca)", () => {
  assertEquals(migration.split(ASSINATURA_GET).length - 1, 1);
  assertEquals(migration.split(ASSINATURA_SET).length - 1, 1);
});

Deno.test("as duas funções são SECURITY DEFINER com search_path fixo em public", () => {
  for (const assinatura of [ASSINATURA_GET, ASSINATURA_SET]) {
    const bloco = statement(migration, assinatura);
    assertStringIncludes(bloco, "SECURITY DEFINER");
    assertStringIncludes(bloco, "SET search_path = public");
  }
});

Deno.test("get_my_cpf lê SEMPRE a própria linha (auth.uid()) — sem parâmetro de usuário-alvo", () => {
  const bloco = statement(migration, ASSINATURA_GET);
  assertStringIncludes(bloco, "RETURNS text");
  assertStringIncludes(bloco, "auth.uid()");
  assertStringIncludes(bloco, "WHERE id = auth.uid()");
});

Deno.test("set_my_cpf grava SEMPRE a própria linha, via v_user_id := auth.uid() — sem parâmetro de usuário-alvo", () => {
  const bloco = statement(migration, ASSINATURA_SET);
  assertStringIncludes(bloco, "v_user_id uuid := auth.uid()");
  assertStringIncludes(bloco, "WHERE id = v_user_id");
  // A ÚNICA assinatura é (p_cpf text) — nunca (p_user_id uuid, p_cpf text)
  // nem qualquer variante "por user_id" (proibido pelo dono).
  assertEquals(
    migration.split("CREATE OR REPLACE FUNCTION public.set_my_cpf").length - 1,
    1,
  );
});

Deno.test("set_my_cpf: recusa 'sem sessão' carrega ERRCODE CPF02, e as quatro recusas de CPF inválido carregam CPF01 — nunca o valor recebido na mensagem", () => {
  const bloco = statement(migration, ASSINATURA_SET);

  assertStringIncludes(
    norm(bloco),
    norm(
      "RAISE EXCEPTION 'Sem sessão: entre na conta para gravar o CPF.' USING ERRCODE = 'CPF02';",
    ),
  );

  const ocorrenciasCpf01 = (bloco.match(/USING ERRCODE = 'CPF01'/g) ?? [])
    .length;
  assertEquals(
    ocorrenciasCpf01,
    4,
    "esperava 4 recusas de CPF inválido (11 dígitos, sequência repetida, 1º e 2º dígito verificador) com CPF01",
  );

  // Nenhuma mensagem de erro concatena variável nem usa formatação
  // (`|| v_algo` ou `%s`/`%I`) — todas as mensagens são texto FIXO.
  for (const trecho of bloco.match(/RAISE EXCEPTION '[^;]*;/g) ?? []) {
    assertEquals(
      /\|\|\s*v_|%[sI]/.test(trecho),
      false,
      `RAISE parece interpolar variável: ${trecho}`,
    );
  }
});

Deno.test("set_my_cpf: os DOIS UPDATE de profiles (limpar e gravar) são seguidos de IF NOT FOUND com ERRCODE CPF03 — sem linha, nunca sucesso silencioso", () => {
  // Pedido do dono (23/09/2026): sem esta guarda, um UPDATE que não acha a
  // linha do perfil devolvia sucesso, o cliente removia o pendente do
  // cadastro e o CPF se perdia.
  // Comentários de linha saem antes: eles também citam "UPDATE".
  const bloco = norm(
    statement(migration, ASSINATURA_SET).replace(/--[^\n]*/g, ""),
  );
  const updates = bloco.split("UPDATE public.profiles").slice(1);
  assertEquals(
    updates.length,
    2,
    "esperava exatamente dois UPDATE de profiles",
  );
  for (const depois of updates) {
    const guarda = depois.indexOf("IF NOT FOUND THEN");
    const proximoUpdate = depois.indexOf("UPDATE ");
    assert(guarda >= 0, "UPDATE de profiles sem IF NOT FOUND depois");
    assert(
      proximoUpdate < 0 || guarda < proximoUpdate,
      "a guarda IF NOT FOUND precisa vir antes de qualquer outro UPDATE",
    );
    assertStringIncludes(
      depois.slice(guarda, guarda + 200),
      "USING ERRCODE = 'CPF03'",
    );
  }
});

Deno.test("REVOKE ALL de PUBLIC/anon e GRANT EXECUTE só para authenticated, nas duas funções", () => {
  const migrationN = norm(migration);
  assertStringIncludes(
    migrationN,
    norm("REVOKE ALL ON FUNCTION public.get_my_cpf() FROM PUBLIC, anon;"),
  );
  assertStringIncludes(
    migrationN,
    norm("GRANT EXECUTE ON FUNCTION public.get_my_cpf() TO authenticated;"),
  );
  assertStringIncludes(
    migrationN,
    norm("REVOKE ALL ON FUNCTION public.set_my_cpf(text) FROM PUBLIC, anon;"),
  );
  assertStringIncludes(
    migrationN,
    norm("GRANT EXECUTE ON FUNCTION public.set_my_cpf(text) TO authenticated;"),
  );
});

Deno.test("sem DROP nem ALTER de objeto no NÍVEL SUPERIOR — a migration só CRIA as duas funções (CREATE OR REPLACE) e ajusta privilégio delas", () => {
  assertEquals(/\bDROP\s+/i.test(codigoSemFuncoes), false, "código tem DROP");
  assertEquals(/\bALTER\s+TABLE/i.test(codigoSemFuncoes), false);
  assertEquals(/\bALTER\s+FUNCTION/i.test(codigoSemFuncoes), false);
});

Deno.test("rollback: DROP FUNCTION IF EXISTS das duas, na ordem inversa da criação, sem tocar profiles.cpf", () => {
  const posSet = codigoRollbackSemFuncoes.indexOf(
    "DROP FUNCTION IF EXISTS public.set_my_cpf(text)",
  );
  const posGet = codigoRollbackSemFuncoes.indexOf(
    "DROP FUNCTION IF EXISTS public.get_my_cpf()",
  );
  assert(posSet >= 0 && posGet >= 0);
  assert(posSet < posGet, "rollback não derruba na ordem inversa da criação");
  assertEquals(/\bprofiles\b/i.test(codigoRollbackSemFuncoes), false);
  assertEquals(/\bBEGIN\b|\bCOMMIT\b/.test(codigoRollbackSemFuncoes), false);
});
