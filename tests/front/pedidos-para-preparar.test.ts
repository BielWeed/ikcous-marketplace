import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  FILTRO_POSTGREST_PARA_PREPARAR,
  PAGAMENTOS_QUE_NAO_PREPARAM,
  STATUS_PARA_PREPARAR,
  estaAguardandoPagamento,
  estaParaPreparar,
} from "@/lib/pedidos-para-preparar";

// ── "Para preparar" é UMA regra só, a mesma do Início ──
//
// Onda F do painel simples (F1): o selo da aba Pedidos e o sino contavam
// `status IN (pending,new,processing)` SEM olhar o pagamento — um PIX que
// ainda espera a CLIENTE pagar aparecia como "Pedido de X esperando você",
// enquanto o "Pedidos para preparar" do Início (`painel_inicio`) já tirava
// esses. Agora o front copia a regra do banco numa lib só, e este teste
// prende as duas pontas: o comportamento numa amostra e a igualdade das
// listas com o SQL que o Início roda.

const MIGRATION_DO_INICIO =
  "20261199000000_portas_do_painel_exigem_admin_atual.sql";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório, montado de import.meta.url
const sqlDoInicio = readFileSync(
  new URL(
    "../../supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
    import.meta.url,
  ),
  "utf8",
);

/** Os valores entre aspas simples de uma lista SQL `('a', 'b')`. */
function valoresDaLista(lista: string): string[] {
  return [...lista.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
}

/** O trecho de `pedidos_para_preparar` dentro de `painel_inicio`. */
function trechoDoParaPreparar(sql: string): string {
  const inicio = sql.indexOf("'pedidos_para_preparar'");
  const fim = sql.indexOf("'devolucoes_abertas'", inicio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fim).toBeGreaterThan(inicio);
  return sql.slice(inicio, fim);
}

describe("estaParaPreparar — a regra de painel_inicio", () => {
  const amostra = [
    { id: "a", status: "pending", paymentStatus: null, prepara: true },
    { id: "b", status: "new", paymentStatus: "pago", prepara: true },
    {
      id: "c",
      status: "processing",
      paymentStatus: "recebido_na_entrega",
      prepara: true,
    },
    {
      id: "d",
      status: "pending",
      paymentStatus: "pago_apos_expirar",
      prepara: true,
    },
    // COALESCE(payment_status, '') — vazio não é "não paga": prepara.
    { id: "e", status: "processing", paymentStatus: "", prepara: true },
    // PIX gerado e ainda não pago: espera a CLIENTE, não o lojista.
    { id: "f", status: "pending", paymentStatus: "aguardando", prepara: false },
    { id: "g", status: "new", paymentStatus: "recusado", prepara: false },
    // Já saiu da loja: não é mais "para preparar".
    { id: "h", status: "shipping", paymentStatus: "pago", prepara: false },
  ] as const;

  it("numa amostra de 8 pedidos, 5 estão para preparar", () => {
    const paraPreparar = amostra.filter((p) => estaParaPreparar(p));
    expect(paraPreparar.map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    for (const pedido of amostra) {
      expect(estaParaPreparar(pedido)).toBe(pedido.prepara);
    }
  });

  it("nenhum pagamento da lista negra prepara, em nenhum status aberto", () => {
    for (const status of STATUS_PARA_PREPARAR) {
      for (const paymentStatus of PAGAMENTOS_QUE_NAO_PREPARAM) {
        expect(estaParaPreparar({ status, paymentStatus })).toBe(false);
      }
    }
  });

  it("status fora da lista nunca prepara, pago ou não", () => {
    for (const status of ["shipping", "delivered", "cancelled", "returned"]) {
      expect(estaParaPreparar({ status, paymentStatus: null })).toBe(false);
      expect(estaParaPreparar({ status, paymentStatus: "pago" })).toBe(false);
    }
  });
});

describe("estaAguardandoPagamento — o PIX/cartão que espera a cliente", () => {
  it("só status aberto com payment_status 'aguardando'", () => {
    expect(
      estaAguardandoPagamento({
        status: "pending",
        paymentStatus: "aguardando",
      }),
    ).toBe(true);
    expect(
      estaAguardandoPagamento({ status: "new", paymentStatus: "aguardando" }),
    ).toBe(true);
    expect(
      estaAguardandoPagamento({ status: "pending", paymentStatus: "pago" }),
    ).toBe(false);
    expect(
      estaAguardandoPagamento({ status: "pending", paymentStatus: "expirado" }),
    ).toBe(false);
    expect(
      estaAguardandoPagamento({ status: "pending", paymentStatus: null }),
    ).toBe(false);
    expect(
      estaAguardandoPagamento({
        status: "cancelled",
        paymentStatus: "aguardando",
      }),
    ).toBe(false);
  });
});

describe("FILTRO_POSTGREST_PARA_PREPARAR — o mesmo predicado no PostgREST", () => {
  it("é o `.or` que reproduz COALESCE(payment_status,'') NOT IN (...)", () => {
    expect(FILTRO_POSTGREST_PARA_PREPARAR).toBe(
      "payment_status.is.null,payment_status.not.in.(aguardando,expirado,recusado,estornado)",
    );
  });

  it("é montado das constantes, não escrito à mão", () => {
    for (const pagamento of PAGAMENTOS_QUE_NAO_PREPARAM) {
      expect(FILTRO_POSTGREST_PARA_PREPARAR).toContain(pagamento);
    }
    expect(FILTRO_POSTGREST_PARA_PREPARAR).toContain(
      `not.in.(${PAGAMENTOS_QUE_NAO_PREPARAM.join(",")})`,
    );
  });
});

describe("guarda contra deriva: as listas são as do SQL do Início", () => {
  const trecho = trechoDoParaPreparar(sqlDoInicio);

  it("STATUS_PARA_PREPARAR é a lista do `o.status IN (...)`", () => {
    const lista = /o\.status\s+IN\s*\(([^)]*)\)/i.exec(trecho)?.[1];
    expect(lista).toBeDefined();
    expect([...valoresDaLista(lista ?? "")].sort()).toEqual(
      [...STATUS_PARA_PREPARAR].sort(),
    );
  });

  it("PAGAMENTOS_QUE_NAO_PREPARAM é a lista do `NOT IN (...)`, com COALESCE para ''", () => {
    expect(trecho).toMatch(/COALESCE\(\s*o\.payment_status\s*,\s*''\s*\)/i);
    const lista = /NOT\s+IN\s*\(([^)]*)\)/i.exec(trecho)?.[1];
    expect(lista).toBeDefined();
    expect([...valoresDaLista(lista ?? "")].sort()).toEqual(
      [...PAGAMENTOS_QUE_NAO_PREPARAM].sort(),
    );
  });

  it("nenhuma migration mais nova redefine `pedidos_para_preparar`", () => {
    // Se uma migration posterior reescrever `painel_inicio`, este espelho
    // passa a vigiar o arquivo errado: falha aqui e aponta qual ler.
    const versaoDoInicio = MIGRATION_DO_INICIO.slice(0, 14);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- pasta fixa de migrations do repositório, montada de import.meta.url
    const maisNovas = readdirSync(
      new URL("../../supabase/migrations/", import.meta.url),
    )
      .filter((nome) => /^\d{14}_.*\.sql$/.test(nome))
      .filter((nome) => nome.slice(0, 14) > versaoDoInicio)
      .filter((nome) =>
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- arquivo listado da pasta fixa de migrations do repositório
        readFileSync(
          new URL(`../../supabase/migrations/${nome}`, import.meta.url),
          "utf8",
        ).includes("pedidos_para_preparar"),
      );
    expect(maisNovas).toEqual([]);
  });
});
