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

Deno.test("guard novo (achado R1, rodada 2): só barra com id REAL (NOT LIKE 'reservando:%'), nunca na fase de reserva", () => {
  assertStringIncludes(
    m,
    "IF v_d.me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE 'reservando:%' AND v_d.codigo_postagem IS NULL THEN",
  );
  // Sem promessa de prazo (achado R1: "aguarde instantes" prendia o cliente
  // por dias quando o vínculo nunca se resolvia sozinho — Sandbox do Melhor
  // Envio, edge que morreu, liberação que falhou). A frase manda falar com a
  // loja, que tem a RPC de liberar (teste abaixo).
  assertStringIncludes(
    m,
    "A loja está gerando o código de postagem desta devolução. Se precisar cancelar, fale com a loja.",
  );
  assert(
    !m.includes("aguarde alguns instantes e tente cancelar de novo"),
    "a frase da rodada 1 prometia prazo — não pode sobreviver",
  );
  assertStringIncludes(
    norm(
      m.slice(
        m.indexOf(
          "IF v_d.me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE",
        ),
        m.indexOf(
          "IF v_d.me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE",
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
    "v_d.me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE 'reservando:%'",
  );
  assert(posDono >= 0 && posStatus >= 0 && posEmVoo >= 0);
  assert(
    posDono < posStatus && posStatus < posEmVoo,
    "a ordem dos guards mudou: dono -> status -> compra em voo",
  );
});

Deno.test("evento ao lojista: código já emitido grava um evento PRÓPRIO (ator sistema) com texto NEUTRO (achado R2 — o cliente também pode ler)", () => {
  assertStringIncludes(m, "IF v_d.codigo_postagem IS NOT NULL THEN");
  assertStringIncludes(m, "p_id, 'cancelada', 'cancelada', 'sistema',");
  // Achado N3: COALESCE — sem ele, me_reverse_id NULL faria a nota inteira
  // virar NULL (concatenação `||` com NULL em Postgres).
  assertStringIncludes(
    m,
    "(envio reverso ' || COALESCE(v_d.me_reverse_id, 'sem id registrado') ||",
  );
  assertStringIncludes(m, "Melhor Envio");
  // Achado R2: nada de imperativo dirigido a alguém ("cancele você") — o
  // texto só CONSTATA o fato, porque o dono da devolução também pode lê-lo.
  assert(
    !m.includes("Cancele esse envio reverso no Melhor Envio."),
    "a frase imperativa da rodada 1 endereçava a loja — não pode sobreviver num texto que o cliente também lê",
  );
  assertStringIncludes(
    m,
    "Convém conferir se esse envio também precisa ser cancelado por lá.",
  );
  // O evento do CLIENTE (o que a 20261175000000 já gravava) continua
  // separado, sem o texto do Melhor Envio dentro da nota dele.
  assertStringIncludes(
    m,
    "PERFORM public.devolucao__registrar_evento(p_id, v_d.status, 'cancelada', 'cliente', NULL);",
  );
});

Deno.test("RPC nova (achado R1): admin_devolucao_liberar_vinculo_reverso — admin, trava a linha, recusa sem vínculo ou com código já emitido, texto neutro", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid)",
  );
  assert(ini >= 0, "admin_devolucao_liberar_vinculo_reverso não encontrada");
  const fim = m.indexOf("$$;", ini);
  const corpo = m.slice(ini, fim + 3);
  const cabecalho = m.slice(ini, m.indexOf("AS $$", ini));
  assertStringIncludes(cabecalho, "SECURITY DEFINER");
  assertStringIncludes(cabecalho, "SET search_path = public");
  assertStringIncludes(corpo, "IF NOT public.is_admin() THEN");
  assertStringIncludes(corpo, "FOR UPDATE;");
  assertStringIncludes(corpo, "IF v_d.me_reverse_id IS NULL THEN");
  assertStringIncludes(corpo, "IF v_d.codigo_postagem IS NOT NULL THEN");
  assertStringIncludes(
    corpo,
    "UPDATE public.devolucoes SET me_reverse_id = NULL WHERE id = p_id;",
  );
  assertStringIncludes(corpo, "p_id, v_d.status, v_d.status, 'sistema',");
  assertStringIncludes(
    corpo,
    "Convém conferir se esse envio precisa ser cancelado por lá.",
  );
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.admin_devolucao_liberar_vinculo_reverso(uuid) FROM PUBLIC, anon;",
  );
  assertStringIncludes(
    m,
    "GRANT EXECUTE ON FUNCTION public.admin_devolucao_liberar_vinculo_reverso(uuid) TO authenticated;",
  );
});

Deno.test("o rollback restaura o corpo de cancelar_devolucao da 20261175000000 BYTE A BYTE e derruba a RPC nova", () => {
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
  assertStringIncludes(
    r,
    "DROP FUNCTION IF EXISTS public.admin_devolucao_liberar_vinculo_reverso(uuid);",
  );
});
