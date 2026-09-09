// @ts-nocheck
// Issue #499: contrato textual da migration e da chamada pelo painel.
// Não executa SQL nem prova concorrência: prende as guardas do pacote revisado.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const NOME = "20261120000000_reordenar_banners_numa_transacao_so.sql";

function lerCodigo(nome: string) {
  const caminho = new URL(`../supabase/migrations/${nome}`, import.meta.url);
  let texto = "";
  try {
    texto = Deno.readTextFileSync(caminho);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  assert(texto.length > 0, `SQL obrigatório ainda ausente: ${nome}`);
  return texto
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("--"))
    .join("\n");
}

Deno.test("reordenação cria uma RPC restrita ao administrador", () => {
  const sql = lerCodigo(NOME);
  assert(
    /CREATE OR REPLACE FUNCTION public\.reorder_banners_atomic\(\s*p_position text,\s*p_banner_id_1 uuid,\s*p_banner_id_2 uuid\s*\)/i.test(
      sql,
    ),
  );
  assert(
    /RETURNS void\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public/i.test(
      sql,
    ),
  );
  assert(
    /IF NOT public\.is_admin\(\) THEN\s+RAISE EXCEPTION 'Não autorizado';\s+END IF;/i.test(
      sql,
    ),
  );
  assert(sql.indexOf("IF NOT public.is_admin()") < sql.indexOf("FOR UPDATE"));
});

Deno.test("posição inválida falha antes de travar ou escrever banners", () => {
  const sql = lerCodigo(NOME);
  assert(
    /IF p_position NOT IN \('home_top',\s*'home_middle',\s*'home_bottom'\) THEN\s+RAISE EXCEPTION 'Posição inválida\.';/i.test(
      sql,
    ),
  );
  assert(sql.indexOf("Posição inválida.") < sql.indexOf("FOR UPDATE"));
});

Deno.test("duplicatas são normalizadas deterministicamente sob trava e sem regravar ordens iguais", () => {
  const sql = lerCodigo(NOME);
  assert(
    /PERFORM 1 FROM public\.banners WHERE "position" = p_position FOR UPDATE;/i.test(
      sql,
    ),
  );
  assert(
    /FOR v_banner IN\s+SELECT id FROM public\.banners\s+WHERE "position" = p_position\s+ORDER BY "order" ASC, id ASC\s+LOOP/i.test(
      sql,
    ),
  );
  assert(/v_next_order integer := 1;/i.test(sql));
  assert(
    /UPDATE public\.banners\s+SET "order" = v_next_order\s+WHERE id = v_banner\.id AND "order" IS DISTINCT FROM v_next_order;/i.test(
      sql,
    ),
  );
  assert(/v_next_order := v_next_order \+ 1;/i.test(sql));
  assert(sql.indexOf("FOR UPDATE") < sql.indexOf("FOR v_banner IN"));
});

Deno.test("banner ausente ou de outra posição aborta antes da troca, inclusive com lista vazia", () => {
  const sql = lerCodigo(NOME);
  assert(
    /SELECT "order" INTO v_order_1 FROM public\.banners\s+WHERE id = p_banner_id_1 AND "position" = p_position;/i.test(
      sql,
    ),
  );
  assert(
    /SELECT "order" INTO v_order_2 FROM public\.banners\s+WHERE id = p_banner_id_2 AND "position" = p_position;/i.test(
      sql,
    ),
  );
  assert(
    /IF v_order_1 IS NULL OR v_order_2 IS NULL THEN\s+RAISE EXCEPTION 'Banner não encontrado\.';\s+END IF;/i.test(
      sql,
    ),
  );
  assert(
    sql.indexOf("END LOOP;") < sql.indexOf('SELECT "order" INTO v_order_1'),
  );
  assert(
    sql.indexOf("Banner não encontrado.") <
      sql.indexOf('SET "order" = v_order_2'),
  );
  assert(
    /SET "order" = v_order_2\s+WHERE id = p_banner_id_1 AND "position" = p_position;/i.test(
      sql,
    ),
  );
  assert(
    /SET "order" = v_order_1\s+WHERE id = p_banner_id_2 AND "position" = p_position;/i.test(
      sql,
    ),
  );
  assert(
    !/EXCEPTION\s+WHEN/i.test(sql),
    "não pode engolir falha e confirmar normalização parcial",
  );
});

Deno.test("migration restringe EXECUTE sem alterar a RPC anterior", () => {
  const sql = lerCodigo(NOME);
  assert(
    /REVOKE EXECUTE ON FUNCTION public\.reorder_banners_atomic\(text, uuid, uuid\) FROM PUBLIC, anon;/i.test(
      sql,
    ),
  );
  assert(
    /GRANT EXECUTE ON FUNCTION public\.reorder_banners_atomic\(text, uuid, uuid\) TO authenticated, service_role;/i.test(
      sql,
    ),
  );
  assert(!/swap_banner_order/i.test(sql));
});

Deno.test("SQL preserva a transação externa do aplicador e da prova com rollback", () => {
  for (const nome of [NOME, `rollback-manual-${NOME}`]) {
    const sql = lerCodigo(nome);
    assert(
      !/^\s*(BEGIN|COMMIT)\s*;/im.test(sql),
      `${nome} encerra ou abre transação própria`,
    );
  }
});

Deno.test("rollback remove somente a nova assinatura e pode rodar novamente", () => {
  assertEquals(
    lerCodigo(`rollback-manual-${NOME}`).trim(),
    "DROP FUNCTION IF EXISTS public.reorder_banners_atomic(text, uuid, uuid);",
  );
});

Deno.test("reorderBanners usa a RPC atômica e não persiste normalização em chamadas separadas", () => {
  const hook = Deno.readTextFileSync(
    new URL("../src/hooks/useBanners.ts", import.meta.url),
  );
  const inicio = hook.indexOf("const reorderBanners =");
  const fim = hook.indexOf("const deleteBanner =", inicio);
  assert(
    inicio >= 0 && fim > inicio,
    "não encontrou o corpo de reorderBanners",
  );
  const corpo = hook.slice(inicio, fim);
  assert(corpo.includes('"reorder_banners_atomic"'));
  assert(!corpo.includes("swap_banner_order"));
  assert(!/\.update\(\s*\{\s*order:\s*b\.order\s*\}\s*\)/.test(corpo));
});
