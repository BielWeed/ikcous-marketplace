// Follow-up do item 11 do laudo (29/08), apontado pela revisão do PR #343:
// o PIX caiu (`payment_status = 'pago'`) e o cliente não era avisado — a
// trigger irmã dispara em `status`, e o confirmar_pagamento muda só
// `payment_status`.
//
// O conserto é a migration 20261027000000: trigger gêmea
// tr_pagamento_avisa_o_cliente (AFTER UPDATE OF payment_status) com duas
// frases desenhadas — 'pago' e o caso especial 'pago_apos_expirar'
// (dinheiro entrou depois de cancelar/expirar; a loja já foi avisada pelo
// badge de atenção). 'expirado', 'estornado' e o resto ficam silenciosos
// POR DESENHO: frase nova é decisão de produto, não efeito colateral.
//
// CI não tem banco: a âncora é o ARQUIVO de migration em disco (mesmo
// padrão de pedido-avisa-o-cliente-gatilho-e-frases.test.ts).
import { describe, expect, it } from "vitest";

const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ARQUIVO = Object.entries(MIGRATIONS).find(([caminho]) =>
  caminho.includes("20261027000000_o_pagamento_avisa_o_cliente"),
);

const sql = ARQUIVO?.[1] ?? "";

const inicioFuncao = sql.indexOf(
  "CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_pagamento",
);
const corpoFuncao = inicioFuncao >= 0 ? sql.slice(inicioFuncao) : "";

describe("a trigger de pagamento existe e avisa por verdade", () => {
  it("a migration está no globo", () => {
    expect(ARQUIVO).toBeDefined();
    expect(sql.length).toBeGreaterThan(1000);
  });

  it("a trigger é AFTER UPDATE OF payment_status, por linha, na tabela do pedido", () => {
    expect(sql).toContain(
      "AFTER UPDATE OF payment_status ON public.marketplace_orders",
    );
    expect(sql).toContain("FOR EACH ROW");
  });

  it("as 2 frases desenhadas existem, cada uma 1x no corpo da função", () => {
    expect(corpoFuncao.split("Pagamento confirmado").length - 1).toBe(1);
    expect(
      corpoFuncao.split("tinha sido cancelado ou expirado").length - 1,
    ).toBe(1);
  });

  it("as frases usam o tipo 'pagamento' (aceito pelo CHECK da tabela)", () => {
    expect(
      corpoFuncao.split("'pagamento', 'Pagamento confirmado'").length - 1,
    ).toBe(1);
  });

  it("cada frase nasce amarrada ao pedido (order_id) e ao dono (NEW.user_id)", () => {
    expect(
      corpoFuncao.split("INSERT INTO public.notificacoes").length - 1,
    ).toBe(2);
    expect(
      corpoFuncao.split("jsonb_build_object('order_id', NEW.id)").length - 1,
    ).toBe(2);
    expect(corpoFuncao.split("VALUES (NEW.user_id,").length - 1).toBe(2);
  });

  it("convidado (user_id nulo) não recebe aviso", () => {
    expect(corpoFuncao).toContain("IF NEW.user_id IS NULL THEN");
  });

  it("update que NÃO muda o pagamento não acende o sino", () => {
    expect(corpoFuncao).toContain(
      "IF OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status THEN",
    );
  });

  it("sino é best-effort: falha fica logada e nunca reverte a escrita", () => {
    expect(corpoFuncao.split("EXCEPTION WHEN OTHERS THEN").length - 1).toBe(1);
    expect(corpoFuncao.split("RAISE WARNING").length - 1).toBe(1);
    expect(corpoFuncao).toContain("RETURN NEW;");
  });

  it("'expirado' e 'estornado' ficam silenciosos por desenho (sem frase inventada)", () => {
    expect(corpoFuncao.split("WHEN 'expirado'").length - 1).toBe(0);
    expect(corpoFuncao.split("WHEN 'estornado'").length - 1).toBe(0);
  });
});
