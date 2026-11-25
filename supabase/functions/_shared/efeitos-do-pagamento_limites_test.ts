// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) em `efeitos-do-pagamento.ts`: o
 * aviso que o lojista recebe quando um pagamento é confirmado. O que sobrevivia às
 * suítes `efeitos-do-pagamento_*_test.ts` e ao resto:
 *
 *   * o valor no texto do aviso: número ou texto numérico mostram o valor em reais;
 *     texto em branco (`"  "`, que o JS converte em zero), vazio, não numérico, nulo e
 *     ausente NÃO mostram valor — nunca "R$ 0,00" inventado;
 *
 * (A janela de 24 h do reenvio do comprovante também foi mutada: todos os defeitos
 * dela já morriam nas suítes existentes ou eram equivalentes — não ganhou teste novo.)
 *
 * Valores escritos à mão; fixtures inventadas.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { avisoAoLojista } from "./efeitos-do-pagamento.ts";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

// ─── o valor no aviso ────────────────────────────────────────────────────────

Deno.test("avisoAoLojista: valor numérico ou em texto numérico aparece em reais, nos dois avisos", () => {
  for (const resultado of ["pago", "pago_apos_expirar"]) {
    for (const valor of [12.5, "12.50", "12.5"]) {
      const aviso = avisoAoLojista(PEDIDO, resultado, valor);
      assert(/R\$\s12,50/.test(aviso.body), `${resultado} ${valor}: ${aviso.body}`);
    }
  }
});

Deno.test("avisoAoLojista: valor em branco, vazio, ilegível, nulo ou ausente NÃO mostra valor (nunca R$ 0,00 inventado)", () => {
  for (const resultado of ["pago", "pago_apos_expirar"]) {
    for (const valor of ["", "   ", "abc", null, undefined, NaN, Infinity, {}, true]) {
      const aviso = avisoAoLojista(PEDIDO, resultado, valor);
      assertEquals(aviso.body.includes("R$"), false, `${resultado} ${String(valor)}: ${aviso.body}`);
    }
  }
});

Deno.test("avisoAoLojista: valor zero (número) é um valor legível — mostra R$ 0,00", () => {
  assert(/R\$\s0,00/.test(avisoAoLojista(PEDIDO, "pago", 0).body));
});
