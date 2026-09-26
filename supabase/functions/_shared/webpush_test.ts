// @ts-nocheck
/**
 * Testes de `comTempoLimite` (Achado N2, 3ª revisão de risco, 26/09/2026).
 *
 * Não existia suíte para este arquivo antes desta correção — `comTempoLimite`
 * só era exercitada indiretamente, por dentro dos testes de
 * `criar-pagamento`/`webhook-mercadopago` que injetam `alertarAdminCartaoOrfao`/
 * `enviarPush` como stubs rápidos. Nenhum desses testes prova as DUAS metades
 * do Achado N2: o `setTimeout` sendo limpo (a suíte fica verde de qualquer
 * jeito, porque os sanitizers do Deno só acusam recurso vazado se ele
 * sobreviver ao FIM do teste) e o `EdgeRuntime.waitUntil` sendo chamado
 * quando o ambiente o expõe.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { comTempoLimite } from "./webpush.ts";

Deno.test("comTempoLimite: promessa rápida vence a corrida e devolve o valor, sem vazar o setTimeout (sanitizeResources padrão do Deno.test)", async () => {
  const resultado = await comTempoLimite(Promise.resolve("ok"), 50);
  assertEquals(resultado, "ok");
  // Sem `clearTimeout` no `finally`, o temporizador agendado para 50ms
  // continuaria vivo até estourar sozinho — inofensivo para ESTE teste (o
  // sanitizer só reprova recurso que sobrevive ao teste), mas confirma que a
  // correção não regrediu o caminho feliz.
});

Deno.test("comTempoLimite: promessa lenta perde a corrida contra o teto -> devolve undefined, nunca lança", async () => {
  const nuncaAssenta = new Promise<string>(() => {});
  const resultado = await comTempoLimite(nuncaAssenta, 10);
  assertEquals(resultado, undefined);
});

Deno.test("comTempoLimite: com EdgeRuntime.waitUntil disponível (feature-detectado), registra a promessa para sobreviver à resposta", async () => {
  const registradas: Promise<unknown>[] = [];
  (globalThis as Record<string, unknown>).EdgeRuntime = {
    waitUntil: (p: Promise<unknown>) => {
      registradas.push(p);
    },
  };
  try {
    const resultado = await comTempoLimite(Promise.resolve("push-enviado"), 10);
    assertEquals(resultado, "push-enviado");
    assertEquals(registradas.length, 1, "a promessa foi registrada no waitUntil do Edge Runtime");
  } finally {
    delete (globalThis as Record<string, unknown>).EdgeRuntime;
  }
});

Deno.test("comTempoLimite: sem EdgeRuntime no ambiente (o caso do `deno test`), não lança e comporta-se como antes", async () => {
  assertEquals((globalThis as Record<string, unknown>).EdgeRuntime, undefined);
  const resultado = await comTempoLimite(Promise.resolve(42), 10);
  assertEquals(resultado, 42);
});
