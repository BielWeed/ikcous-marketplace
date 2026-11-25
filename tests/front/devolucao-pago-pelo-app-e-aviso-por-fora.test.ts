// Dinheiro da devolução. Duas frases/decisões da ficha sem teste próprio:
//  - `pagoPeloApp`: só o pedido pago ONLINE e com pagamento confirmado
//    ("pago" ou "pago_apos_expirar") promete reembolso pelo Mercado Pago; o
//    resto vai por fora. Errar para o lado do "sim" promete estorno que o
//    servidor não faz.
//  - `textoDoUsePorFora`: o aviso do "devolva por fora". No caso em que o
//    dinheiro JÁ saiu pelo painel do Mercado Pago, o texto NÃO pode mandar
//    pagar de novo (pagamento em dobro); detalhe ausente/desconhecido cai no
//    aviso conservador, sem ordem de pagar.
import { pagoPeloApp } from "@/components/admin/devolucoes/AcoesDaDevolucao";
import { textoDoUsePorFora } from "@/components/admin/devolucoes/ReembolsoDaDevolucao";
import type { DevolucaoDetalhe } from "@/types/devolucao";
import { describe, expect, it, vi } from "vitest";

// As duas telas importam o cliente do banco só por causa de outras funções;
// as funções testadas aqui são puras e nunca o tocam.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const detalhe = (
  pedido: {
    payment_method: string | null;
    payment_status: string | null;
  } | null,
) => ({ pedido }) as unknown as DevolucaoDetalhe;

describe("pagoPeloApp", () => {
  it.each(["pago", "pago_apos_expirar"])(
    "online com pagamento %s: sim",
    (payment_status) => {
      expect(
        pagoPeloApp(detalhe({ payment_method: "online", payment_status })),
      ).toBe(true);
    },
  );

  it.each([
    "aguardando",
    "recusado",
    "expirado",
    "estornado",
    "recebido_na_entrega",
    "",
  ])("online com pagamento %s: não", (payment_status) => {
    expect(
      pagoPeloApp(detalhe({ payment_method: "online", payment_status })),
    ).toBe(false);
  });

  it.each(["cash", "pix", "card", "", "ONLINE"])(
    "forma %s com pagamento 'pago': não (só online passa pelo Mercado Pago)",
    (payment_method) => {
      expect(
        pagoPeloApp(detalhe({ payment_method, payment_status: "pago" })),
      ).toBe(false);
    },
  );

  it("campos nulos: não", () => {
    expect(
      pagoPeloApp(detalhe({ payment_method: null, payment_status: null })),
    ).toBe(false);
    expect(
      pagoPeloApp(detalhe({ payment_method: "online", payment_status: null })),
    ).toBe(false);
    expect(
      pagoPeloApp(detalhe({ payment_method: null, payment_status: "pago" })),
    ).toBe(false);
  });

  it("sem o pedido na ficha (linha antiga): não, e sem quebrar", () => {
    expect(pagoPeloApp(detalhe(null))).toBe(false);
    expect(pagoPeloApp({} as DevolucaoDetalhe)).toBe(false);
  });
});

describe("textoDoUsePorFora", () => {
  const PENDENTE =
    "Confirme que o valor continua pendente antes de devolver por fora.";
  const CONSERVADOR =
    "O Mercado Pago não refez o reembolso. Confira o valor no Mercado Pago antes de devolver por fora.";

  it("dinheiro já devolvido pelo painel do MP: manda NÃO repetir o valor", () => {
    const texto = textoDoUsePorFora("devolvido_pelo_painel_do_mp");
    expect(texto).toContain("Não repita esse valor");
    expect(texto).not.toContain("devolver por fora");
  });

  it("sem prova de que o dinheiro não saiu: manda conferir ANTES de devolver", () => {
    expect(textoDoUsePorFora("sem_prova_de_que_nao_saiu")).toBe(
      "Não foi possível confirmar se o dinheiro saiu. Confira no Mercado Pago antes de devolver por fora.",
    );
  });

  it.each([
    ["pedido_nao_entregue", "O pedido ainda não foi entregue."],
    ["sem_pagamento_pelo_app", "O pagamento não foi feito pelo app."],
    [
      "fora_do_prazo_ou_da_forma",
      "O reembolso está fora do prazo ou da forma aceita pelo Mercado Pago.",
    ],
  ])(
    "%s: diz o motivo e pede para confirmar que o valor segue pendente",
    (chave, inicio) => {
      expect(textoDoUsePorFora(chave)).toBe(`${inicio} ${PENDENTE}`);
    },
  );

  it.each([undefined, null, "", "motivo_que_nao_existe", 42, {}, [], true])(
    "detalhe ausente ou desconhecido (%j) cai no aviso conservador, sem ordem de pagar",
    (detalheDoServidor) => {
      expect(textoDoUsePorFora(detalheDoServidor)).toBe(CONSERVADOR);
    },
  );

  it("o nome da chave tem de bater exatamente (maiúscula e espaço contam)", () => {
    expect(textoDoUsePorFora("Devolvido_pelo_painel_do_mp")).toBe(CONSERVADOR);
    expect(textoDoUsePorFora(" devolvido_pelo_painel_do_mp")).toBe(CONSERVADOR);
  });

  it("nenhum texto manda 'pagar'/'devolver' sem antes confirmar ou conferir", () => {
    for (const chave of [
      "devolvido_pelo_painel_do_mp",
      "sem_prova_de_que_nao_saiu",
      "pedido_nao_entregue",
      "sem_pagamento_pelo_app",
      "fora_do_prazo_ou_da_forma",
      "qualquer",
    ]) {
      const t = textoDoUsePorFora(chave);
      if (t.includes("devolver por fora")) {
        expect(t).toMatch(/Confirme|Confira|confira/);
      }
    }
  });
});
