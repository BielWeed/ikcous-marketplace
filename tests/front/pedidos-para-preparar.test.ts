import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  FILTRO_POSTGREST_PARA_PREPARAR,
  PAGAMENTOS_A_CONFERIR_EM_ABERTO,
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

// A definição VIVA de `painel_inicio`: a 20261212000000 (onda I) copia o corpo
// inteiro da 20261199000000 e troca só o `estoque_baixo` — o trecho do
// `pedidos_para_preparar` é o mesmo, byte a byte.
const MIGRATION_DO_INICIO =
  "20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql";

// O caminho sai da constante (nunca um segundo literal): as duas não divergem.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório, montado de import.meta.url e da constante acima
const sqlDoInicio = readFileSync(
  new URL(`../../supabase/migrations/${MIGRATION_DO_INICIO}`, import.meta.url),
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

describe("PAGAMENTOS_A_CONFERIR_EM_ABERTO — o aviso do topo de Pedidos", () => {
  // Revisão da onda F (S3): pedido ABERTO com pagamento recusado ou
  // estornado sai de "Para preparar" (regra do Início, que não muda) e de
  // todo contador. O topo de Pedidos avisa deles, só leitura.
  it("é exatamente recusado e estornado", () => {
    expect([...PAGAMENTOS_A_CONFERIR_EM_ABERTO]).toEqual([
      "recusado",
      "estornado",
    ]);
  });

  it("é parte da lista que não prepara — o aviso nunca conta um pedido que já está em 'Para preparar'", () => {
    for (const pagamento of PAGAMENTOS_A_CONFERIR_EM_ABERTO) {
      expect(PAGAMENTOS_QUE_NAO_PREPARAM).toContain(pagamento);
      for (const status of STATUS_PARA_PREPARAR) {
        expect(estaParaPreparar({ status, paymentStatus: pagamento })).toBe(
          false,
        );
      }
    }
  });

  it("não inclui quem espera a cliente nem quem expirou (esses têm cartão/filtro próprio)", () => {
    const lista: readonly string[] = PAGAMENTOS_A_CONFERIR_EM_ABERTO;
    expect(lista).not.toContain("aguardando");
    expect(lista).not.toContain("expirado");
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

  it("nenhuma migration mais nova redefine `painel_inicio` nem `pedidos_para_preparar`", () => {
    // Se uma migration posterior reescrever `painel_inicio` (inteira, como a
    // 20261212000000 fez com a 20261199000000), este espelho passa a vigiar o
    // arquivo errado: falha aqui e aponta qual ler.
    const versaoDoInicio = MIGRATION_DO_INICIO.slice(0, 14);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- pasta fixa de migrations do repositório, montada de import.meta.url
    const maisNovas = readdirSync(
      new URL("../../supabase/migrations/", import.meta.url),
    )
      .filter((nome) => /^\d{14}_.*\.sql$/.test(nome))
      .filter((nome) => nome.slice(0, 14) > versaoDoInicio)
      .filter((nome) => {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- arquivo listado da pasta fixa de migrations do repositório
        const sql = readFileSync(
          new URL(`../../supabase/migrations/${nome}`, import.meta.url),
          "utf8",
        );
        return (
          sql.includes("pedidos_para_preparar") ||
          /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.painel_inicio\(/i.test(
            sql,
          )
        );
      });
    expect(maisNovas).toEqual([]);
  });

  it("o arquivo lido é o que define `painel_inicio` (e não só o cita)", () => {
    expect(sqlDoInicio).toMatch(
      /\nCREATE OR REPLACE FUNCTION public\.painel_inicio\(\)/,
    );
  });

  it("o texto lido é EXATAMENTE o da migration mais nova que define `painel_inicio`, e é a da constante", () => {
    // A constante e o arquivo lido não podem divergir: o caminho é montado da
    // constante, e aqui o conteúdo é comparado com o da definição mais nova
    // achada por varredura (não pela constante).
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- pasta fixa de migrations do repositório, montada de import.meta.url
    const definem = readdirSync(
      new URL("../../supabase/migrations/", import.meta.url),
    )
      .filter((nome) => /^\d{14}_.*\.sql$/.test(nome))
      .filter((nome) =>
        /\nCREATE OR REPLACE FUNCTION public\.painel_inicio\(/.test(
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- arquivo listado da pasta fixa de migrations do repositório
          readFileSync(
            new URL(`../../supabase/migrations/${nome}`, import.meta.url),
            "utf8",
          ),
        ),
      )
      .sort();
    const maisNova = definem.at(-1) ?? "";
    expect(maisNova).toBe(MIGRATION_DO_INICIO);
    expect(sqlDoInicio).toBe(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- arquivo listado da pasta fixa de migrations do repositório
      readFileSync(
        new URL(`../../supabase/migrations/${maisNova}`, import.meta.url),
        "utf8",
      ),
    );
  });
});
