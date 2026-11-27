// @ts-nocheck
/**
 * A régua de "etiqueta já cancelada no Melhor Envio", lida do histórico de
 * envio (27/11/2026). Na dúvida a etiqueta NÃO conta como cancelada: o aviso
 * de "cancele a etiqueta" fica (lado seguro do dinheiro).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { etiquetasCanceladasNoHistorico, statusDaEtiquetaCancelada } from "./etiqueta-cancelada-no-historico.ts";

const evento = (labelId: unknown, status: unknown, extra = {}) => ({
  event_type: "rastreio_consultado",
  payload: { label_id: labelId, status_etiqueta: status },
  ...extra,
});

Deno.test("statusDaEtiquetaCancelada: as duas grafias, sem caixa nem espaço; o resto não", () => {
  for (const s of ["canceled", "cancelled", " CANCELED ", "Cancelled"]) assertEquals(statusDaEtiquetaCancelada(s), true, s);
  for (const s of ["posted", "released", "", "cancel", null, undefined, 1, {}]) {
    assertEquals(statusDaEtiquetaCancelada(s), false, String(s));
  }
});

Deno.test("etiquetasCanceladasNoHistorico: junta os ids vistos cancelados, sem repetir", () => {
  assertEquals(
    [...etiquetasCanceladasNoHistorico([
      evento("a", "canceled"),
      evento("a", "cancelled"),
      evento("b", "posted"),
      evento("c", "Cancelled"),
    ])].sort(),
    ["a", "c"],
  );
});

Deno.test("etiquetasCanceladasNoHistorico: lixo e evento de outro tipo não cancelam nada", () => {
  for (const entrada of [null, undefined, "x", {}, 3]) {
    assertEquals(etiquetasCanceladasNoHistorico(entrada).size, 0, String(entrada));
  }
  assertEquals(
    etiquetasCanceladasNoHistorico([
      null,
      "texto",
      { event_type: "rastreio_consultado" },
      { event_type: "rastreio_consultado", payload: null },
      { event_type: "rastreio_consultado", payload: "canceled" },
      evento(123, "canceled"),
      evento("", "canceled"),
      evento("   ", "canceled"),
      evento("a", "canceled", { event_type: "erro" }),
      evento("a", "canceled", { event_type: "etiqueta_gerada" }),
    ]).size,
    0,
  );
});
