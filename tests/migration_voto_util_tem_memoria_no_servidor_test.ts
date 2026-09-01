// @ts-nocheck
// O VOTO ÚTIL TEM MEMÓRIA NO SERVIDOR — prova offline do par
// 20261050000000 + rollback (laudo ofensiva+mobile do molde 3108, achado N2).
//
// O DEFEITO QUE ESTE TESTE FIXA: `increment_helpful` somava
// `helpful = helpful + 1` sem registrar quem votou — qualquer cliente logado
// inflava qualquer avaliação pela API (medido em 31/08: 4 → 6 com duas
// chamadas do mesmo usuário). A cura tem TRÊS peças que só funcionam JUNTAS:
// a UNIQUE (review_id, user_id) da tabela, o INSERT com ON CONFLICT DO
// NOTHING e o no-op do IF NOT FOUND. Sabotar qualquer uma delas (tirar a
// tabela, trocar DO NOTHING por DO UPDATE, apagar o IF NOT FOUND) reabre o
// furo com a bateria verde — por isso cada uma é asserção em bloco amarrado.
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
const NOME = "20261050000000_o_voto_util_tem_memoria_no_servidor.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

Deno.test("a tabela de votos nasce com a deduplicacao na constraint", () => {
  // Sem a UNIQUE, a tabela é só registro sem trava: o INSERT entra duas
  // vezes, o contador anda duas. O par (review_id, user_id) É a regra.
  assertStringIncludes(
    migrationN,
    norm("CREATE TABLE IF NOT EXISTS public.review_votes"),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "CONSTRAINT review_votes_um_voto_por_usuario UNIQUE (review_id, user_id)",
    ),
  );
  // FKs: voto morre com a avaliação e com o usuário — sem órfão nem lixo.
  assertStringIncludes(
    migrationN,
    norm("REFERENCES public.reviews (id) ON DELETE CASCADE"),
  );
  assertStringIncludes(
    migrationN,
    norm("REFERENCES auth.users (id) ON DELETE CASCADE"),
  );
});

Deno.test("a tabela de votos fica fechada para acesso direto", () => {
  // RLS ligada: SELECT só dos próprios votos, INSERT só amarrado a si mesmo.
  // Sem isso, a tabela nova nasceria legível por quem já tem grant, e a
  // política de privacidade da casa é fechar por padrão.
  assertStringIncludes(
    migrationN,
    norm("ALTER TABLE public.review_votes ENABLE ROW LEVEL SECURITY"),
  );
  assertStringIncludes(
    migrationN,
    norm("WITH CHECK (user_id = (SELECT auth.uid()))"),
  );
});

Deno.test("a RPC soma o contador SO quando o voto é novo", () => {
  // 🔴 BLOCO AMARRADO: o INSERT com ON CONFLICT DO NOTHING e o no-op do
  // IF NOT FOUND são a deduplicação executável. Medido no sabota: manter a
  // tabela e trocar DO NOTHING por nada faz o INSERT virar erro na 2ª chamada
  // (pedido quebra); manter o INSERT e tirar o IF NOT FOUND faz o contador
  // andar 2x. As três linhas, juntas, são o conserto — cada uma sozinha não é.
  assertStringIncludes(
    migrationN,
    norm("INSERT INTO public.review_votes (review_id, user_id)"),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "ON CONFLICT ON CONSTRAINT review_votes_um_voto_por_usuario DO NOTHING",
    ),
  );
  assertStringIncludes(migrationN, norm("IF NOT FOUND THEN"));
  // O contador continua existindo e continua COALESCE — voto novo soma 1.
  assertStringIncludes(
    migrationN,
    norm("SET helpful = COALESCE(helpful, 0) + 1"),
  );
});

Deno.test("a guarda de login sobrevive na RPC nova", () => {
  // O corpo antigo exigia login e o novo mantém: sem a guarda, voto anônimo
  // entra na tabela com user_id NULL (ou estoura a NOT NULL, virando 500).
  assertStringIncludes(
    migrationN,
    norm("RAISE EXCEPTION 'Acesso negado: usuário não autenticado.'"),
  );
});

Deno.test("avaliacao inexistente continua sendo no-op silencioso", () => {
  // Contrato do corpo antigo: UPDATE sem linha não fazia nada. A nova guarda
  // de EXISTS preserva isso — sem ela, a FK da review_votes transforma um
  // no-op de antes em erro novo para o chamador legítimo.
  assertStringIncludes(
    migrationN,
    norm("SELECT 1 FROM public.reviews WHERE id = v_review_id"),
  );
});

Deno.test("o rollback devolve o corpo fabricavel e derruba a tabela", () => {
  // O rollback é a volta HONESTA para o estado anterior — incluindo o defeito
  // (sem ON CONFLICT nenhum no corpo restaurado) e sem tabela de votos.
  assertStringIncludes(
    rollbackN,
    norm("SET helpful = COALESCE(helpful, 0) + 1"),
  );
  assert(
    !rollbackN.includes("ON CONFLICT"),
    "rollback não pode carregar a deduplicação — ele restaura o estado anterior",
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP TABLE IF EXISTS public.review_votes"),
  );
});
