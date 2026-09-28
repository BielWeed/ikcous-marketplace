// @ts-nocheck
// Peças puras do PIX do balcão — e a PARIDADE da cópia de
// `expiracaoRealinhavel` com a do checkout do site (as duas decidem o mesmo
// prazo de reserva; divergir é um PIX pagável com o estoque já devolvido).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  EMAIL_PAGADOR_GENERICO,
  emailDoPagador,
  expiracaoRealinhavel,
  situacaoDoPedido,
} from "./pix-do-balcao.ts";
import { expiracaoRealinhavel as doSite } from "../criar-pagamento/index.ts";

const AGORA = new Date("2026-09-28T12:00:00.000Z");
const mais = (min: number) => new Date(AGORA.getTime() + min * 60_000).toISOString();

Deno.test("expiracaoRealinhavel: paridade com criar-pagamento em todos os casos de borda", () => {
  const casos: Array<[string | null, string]> = [
    [null, "PT30M"],
    ["", "PT30M"],
    ["não é data", "PT30M"],
    [mais(-1), "PT30M"],
    [AGORA.toISOString(), "PT30M"],
    [mais(0.5), "PT30M"],
    [mais(30), "PT30M"],
    [mais(35), "PT30M"],
    [mais(35.01), "PT30M"],
    [mais(60 * 24), "PT30M"],
    [mais(30), "PT1H"],
    [mais(64), "PT1H"],
    [mais(66), "PT1H"],
    [mais(30), "30min"],
    ["2026-09-28T12:30:00.000-03:00", "PT30M"],
  ];
  for (const [bruto, prazo] of casos) {
    const nosso = expiracaoRealinhavel(bruto, AGORA, prazo)?.toISOString() ?? null;
    const site = doSite(bruto, AGORA, prazo)?.toISOString() ?? null;
    assertEquals(nosso, site, `divergiu para ${bruto} / ${prazo}`);
  }
  assertEquals(expiracaoRealinhavel(mais(30), AGORA, "PT30M")?.toISOString(), mais(30));
});

Deno.test("situacaoDoPedido: a verdade é o banco", () => {
  const base = { status: "pending", expires_at: mais(10) };
  assertEquals(situacaoDoPedido({ ...base, payment_status: "aguardando" }, AGORA), "aguardando");
  assertEquals(
    situacaoDoPedido({ ...base, payment_status: "aguardando", expires_at: mais(-1) }, AGORA),
    "expirado",
    "prazo vencido é expirado mesmo antes da varredura",
  );
  assertEquals(
    situacaoDoPedido({ ...base, payment_status: "aguardando", expires_at: null }, AGORA),
    "expirado",
  );
  assertEquals(
    situacaoDoPedido({ status: "delivered", expires_at: null, payment_status: "pago" }, AGORA),
    "pago",
  );
  assertEquals(
    situacaoDoPedido({ status: "cancelled", expires_at: null, payment_status: "pago_apos_expirar" }, AGORA),
    "pago_fora_do_prazo",
  );
  assertEquals(
    situacaoDoPedido({ status: "cancelled", expires_at: null, payment_status: "expirado" }, AGORA),
    "expirado",
  );
  assertEquals(
    situacaoDoPedido({ ...base, status: "cancelled", payment_status: "aguardando" }, AGORA),
    "cancelado",
    "cancelado pela loja com o pagamento ainda em aberto",
  );
});

Deno.test("emailDoPagador: pedido → conta do cliente → genérico (nunca o do lojista)", () => {
  assertEquals(emailDoPagador({ email: " cli@ex.com " }, "conta@ex.com"), "cli@ex.com");
  assertEquals(emailDoPagador({ email: "a@" }, "conta@ex.com"), "conta@ex.com");
  assertEquals(emailDoPagador(null, null), EMAIL_PAGADOR_GENERICO);
  assertEquals(emailDoPagador({}, "lixo"), EMAIL_PAGADOR_GENERICO);
});
