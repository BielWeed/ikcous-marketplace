// @ts-nocheck
// CANCELAR_DEVOLUCAO BARRA A COMPRA EM VOO — prova offline do par
// 20261179000000 + rollback (achado A1 da revisão de risco pré-publicação de
// 26/09/2026 sobre a etiqueta reversa do Melhor Envio). A prova VIVA (RPC de
// verdade no Postgres efêmero) mora em tests/banco/devolucoes-viva.cjs; aqui
// fica o que se prova só lendo o texto.
//
// Cada asserção está amarrada a um risco: sem o guard novo, o cliente cancela
// enquanto a etiqueta reversa está sendo comprada e a loja paga por uma
// devolução que não existe mais; sem o evento extra, uma etiqueta já paga
// fica órfã sem ninguém saber; rollback infiel devolveria um corpo diferente
// do que a 20261175000000 (já aprovada) publicou.
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
const NOME = "20261179000000_cancelar_devolucao_barra_compra_em_voo.sql";
const NOME_BASE = "20261175000000_a_devolucao_nasce_no_pedido.sql";

const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const migrationBase = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/${NOME_BASE}`,
);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);
const r = norm(rollback);

/** O bloco `CREATE OR REPLACE FUNCTION public.cancelar_devolucao(...) ... $$;`
 * inteiro, de um texto de migration já normalizado por `norm`. */
function extrairCancelarDevolucao(sqlNormalizado: string): string {
  const ini = sqlNormalizado.indexOf(
    "CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)",
  );
  assert(ini >= 0, "cancelar_devolucao não encontrada no texto");
  const fim = sqlNormalizado.indexOf("$$;", ini);
  assert(fim >= 0, "fim do corpo ($$;) não encontrado");
  return sqlNormalizado.slice(ini, fim + 3);
}

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("cancelar_devolucao continua SECURITY DEFINER com search_path fixo, mesma assinatura da 20261175000000", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)",
  );
  assert(ini >= 0);
  const cabecalho = m.slice(ini, m.indexOf("AS $$", ini));
  assertStringIncludes(cabecalho, "SECURITY DEFINER");
  assertStringIncludes(cabecalho, "SET search_path = public");
});

Deno.test("guard novo: recusa cancelar com a compra em voo (me_reverse_id gravado, código ainda não)", () => {
  assertStringIncludes(
    m,
    "IF v_d.me_reverse_id IS NOT NULL AND v_d.codigo_postagem IS NULL THEN",
  );
  // A frase é para o CLIENTE entender (mesmo ERRCODE dos outros guards desta
  // função) — sem ela, o guard existiria mas devolveria um erro cru.
  assertStringIncludes(m, "aguarde alguns instantes e tente cancelar de novo");
  assertStringIncludes(
    norm(
      m.slice(
        m.indexOf(
          "IF v_d.me_reverse_id IS NOT NULL AND v_d.codigo_postagem IS NULL THEN",
        ),
        m.indexOf(
          "IF v_d.me_reverse_id IS NOT NULL AND v_d.codigo_postagem IS NULL THEN",
        ) + 400,
      ),
    ),
    "USING ERRCODE = '22023';",
  );
});

Deno.test("guard preservado: os dois guards originais (dono e status) continuam intactos, na mesma ordem", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)",
  );
  const corpo = m.slice(ini, m.indexOf("$$;", ini));
  const posDono = corpo.indexOf("v_d.user_id IS DISTINCT FROM auth.uid()");
  const posStatus = corpo.indexOf(
    "v_d.status NOT IN ('solicitada', 'aprovada')",
  );
  const posEmVoo = corpo.indexOf(
    "v_d.me_reverse_id IS NOT NULL AND v_d.codigo_postagem IS NULL",
  );
  assert(posDono >= 0 && posStatus >= 0 && posEmVoo >= 0);
  assert(
    posDono < posStatus && posStatus < posEmVoo,
    "a ordem dos guards mudou: dono -> status -> compra em voo",
  );
});

Deno.test("evento ao lojista: código já emitido grava um evento PRÓPRIO (ator sistema), citando Melhor Envio e o id do envio reverso", () => {
  assertStringIncludes(m, "IF v_d.codigo_postagem IS NOT NULL THEN");
  assertStringIncludes(m, "p_id, 'cancelada', 'cancelada', 'sistema',");
  assertStringIncludes(m, "(envio reverso ' || v_d.me_reverse_id ||");
  assertStringIncludes(m, "Cancele esse envio reverso no Melhor Envio.");
  // O evento do CLIENTE (o que a 20261175000000 já gravava) continua
  // separado, sem o texto do Melhor Envio dentro da nota dele — nunca vaza
  // para a tela do cliente por engano.
  assertStringIncludes(
    m,
    "PERFORM public.devolucao__registrar_evento(p_id, v_d.status, 'cancelada', 'cliente', NULL);",
  );
});

Deno.test("o rollback restaura o corpo de cancelar_devolucao da 20261175000000 BYTE A BYTE", () => {
  const original = extrairCancelarDevolucao(norm(migrationBase));
  const restaurado = extrairCancelarDevolucao(r);
  assertEquals(
    restaurado,
    original,
    "o rollback tem que devolver exatamente o corpo já aprovado em 20261175000000, não uma versão reescrita",
  );
  // Nem o guard novo nem o evento ao lojista sobrevivem ao rollback.
  assert(!restaurado.includes("codigo_postagem IS NULL"));
  assert(!restaurado.includes("'sistema',"));
});
