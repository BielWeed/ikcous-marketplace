import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Cada tela já anuncia o resultado com sua própria frase. O contexto deve
// continuar anunciando erros, mas não um segundo sucesso genérico.
// A prova social está escondida na tela: prende-se também o contrato na fonte.
describe("painel confirma a gravação uma vez só", () => {
  it.each([
    {
      tela: "Cupons",
      fonte: readFileSync("src/views/admin/AdminCouponsView.tsx", "utf8"),
      chamada:
        /updateConfig\(\s*\{ enableCoupons: checked \},\s*\{ silentSuccess: true \},?\s*\)/,
    },
    {
      tela: "Avaliações",
      fonte: readFileSync("src/views/admin/AdminReviewsView.tsx", "utf8"),
      chamada:
        /updateConfig\(\s*\{ enableReviews: checked \},\s*\{ silentSuccess: true \},?\s*\)/,
    },
    {
      tela: "Avisos",
      fonte: readFileSync("src/views/admin/AdminPushView.tsx", "utf8"),
      chamada:
        /updateConfig\(\s*\{ realTimeSalesAlerts: checked \},\s*\{ silentSuccess: true \},?\s*\)/,
    },
    {
      tela: "Frete",
      fonte: readFileSync("src/views/admin/AdminShippingView.tsx", "utf8"),
      chamada: /updateConfig\(regrasParaGravar,\s*\{ silentSuccess: true \}\)/,
    },
  ])("$tela cala só o sucesso genérico", ({ fonte, chamada }) => {
    expect(chamada.test(fonte)).toBe(true);
  });
});
