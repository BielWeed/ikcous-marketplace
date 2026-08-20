// @ts-nocheck
/**
 * O veredito final do `scripts/db-apply.cjs`.
 *
 * O DEFEITO QUE ESTES TESTES FECHAM (varredura de 20/08/2026, achado 1):
 * o script imprimia, para uma migration sem entrada no mapa `VERIFICACOES`,
 * a linha "sem verificação registrada, pulando" — e três linhas depois
 * "Tudo aplicado e verificado.", saindo com 0. O acumulador `tudoOk` nascia
 * `true` e só era derrubado por marcador AUSENTE; "não conferi nada" nunca o
 * derrubava.
 *
 * O tamanho do buraco, medido na mesma data: 118 arquivos em
 * supabase/migrations/ e 14 chaves em VERIFICACOES. 104 migrations (88%)
 * caíam no ramo "pulando" e recebiam "Tudo aplicado e verificado" assim mesmo
 * — DEPOIS do COMMIT, num script cujo trabalho é escrever no banco.
 *
 * A regra que estes testes fixam: sucesso exige prova positiva. O `else` de
 * uma classificação é a DÚVIDA, nunca o sucesso. Três desfechos distintos:
 *
 *   codigo 0 — verificado de verdade (ao menos um marcador conferido, nenhum
 *              ausente, nenhuma migration pulada)
 *   codigo 1 — a verificação REPROVOU (marcador esperado não apareceu)
 *   codigo 2 — APLICADO SEM VERIFICAR (alguma migration pulada, ou nenhuma
 *              conferência rodou). Nem sucesso, nem reprovação: dúvida.
 *
 * Mora em tests/ e usa createRequire pelo mesmo motivo do
 * db_apply_rollback_test.ts: o db-apply.cjs é CommonJS.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { resumirVerificacao, verificarMarcadores } = require(
  "../scripts/db-apply.cjs",
);

const ROLLBACK = "rollback-20260822000000_exemplo.sql";

// --------------------------------------------------------------------------
// O veredito — a função que decide o que a última linha afirma
// --------------------------------------------------------------------------

Deno.test("resumirVerificacao: só diz 'verificado' quando verificou mesmo", async (t) => {
  await t.step("tudo conferido e nada ausente -> codigo 0", () => {
    const r = resumirVerificacao({
      conferidos: 3,
      ausentes: 0,
      puladas: [],
      caminhoRollback: ROLLBACK,
    });
    assertEquals(r.codigo, 0);
    assertStringIncludes(r.mensagem, "Tudo aplicado e verificado");
  });

  await t.step(
    "UMA migration pulada -> NAO pode dizer 'Tudo aplicado e verificado'",
    () => {
      const r = resumirVerificacao({
        conferidos: 3,
        ausentes: 0,
        puladas: ["20260822000000_status_do_pedido_nunca_nulo.sql"],
        caminhoRollback: ROLLBACK,
      });
      // O coração do defeito: este caso saía 0 com a frase de sucesso.
      assertNotEquals(r.codigo, 0);
      assertEquals(r.codigo, 2);
      assert(
        !r.mensagem.includes("Tudo aplicado e verificado"),
        `a mensagem ainda afirma sucesso:\n${r.mensagem}`,
      );
      // Quem lê tem de saber QUAL migration ficou sem prova.
      assertStringIncludes(
        r.mensagem,
        "20260822000000_status_do_pedido_nunca_nulo.sql",
      );
    },
  );

  await t.step(
    "o caso real do laudo: aplicar SÓ a migration sem entrada no mapa",
    () => {
      const r = resumirVerificacao({
        conferidos: 0,
        ausentes: 0,
        puladas: ["20260822000000_status_do_pedido_nunca_nulo.sql"],
        caminhoRollback: ROLLBACK,
      });
      assertEquals(r.codigo, 2);
      assert(
        !r.mensagem.includes("Tudo aplicado e verificado"),
        `a mensagem ainda afirma sucesso:\n${r.mensagem}`,
      );
    },
  );

  await t.step("marcador ausente -> codigo 1, e o texto antigo sobrevive", () => {
    const r = resumirVerificacao({
      conferidos: 2,
      ausentes: 1,
      puladas: [],
      caminhoRollback: ROLLBACK,
    });
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.mensagem, "não apareceu");
    // O aviso de que o COMMIT já aconteceu é o que orienta quem está num
    // incidente. Não pode sumir na refatoração.
    assertStringIncludes(r.mensagem, "COMMIT");
    assertStringIncludes(r.mensagem, ROLLBACK);
  });

  await t.step(
    "ausente E pulada ao mesmo tempo -> reprova (1), citando as duas coisas",
    () => {
      const r = resumirVerificacao({
        conferidos: 1,
        ausentes: 1,
        puladas: ["20260822000000_status_do_pedido_nunca_nulo.sql"],
        caminhoRollback: ROLLBACK,
      });
      assertEquals(r.codigo, 1);
      assertStringIncludes(r.mensagem, "não apareceu");
      assertStringIncludes(
        r.mensagem,
        "20260822000000_status_do_pedido_nunca_nulo.sql",
      );
    },
  );

  await t.step(
    "nenhuma conferência rodou e nada foi pulado -> dúvida, nunca sucesso",
    () => {
      // Caminho degenerado (lista de migrations vazia). O `else` aqui é o
      // lugar clássico onde o desconhecido vira sucesso.
      const r = resumirVerificacao({
        conferidos: 0,
        ausentes: 0,
        puladas: [],
        caminhoRollback: ROLLBACK,
      });
      assertEquals(r.codigo, 2);
      assert(
        !r.mensagem.includes("Tudo aplicado e verificado"),
        `a mensagem ainda afirma sucesso:\n${r.mensagem}`,
      );
    },
  );
});

// --------------------------------------------------------------------------
// Quem ALIMENTA o veredito — sem isto, mutar o loop não derruba nada
// --------------------------------------------------------------------------

/** Cliente pg falso: devolve a definição que o teste mandar, por função. */
function clienteFake(defsPorFuncao: Record<string, string>) {
  return {
    // deno-lint-ignore no-explicit-any
    query(_sql: string, params: any[]) {
      const def = defsPorFuncao[params[0]];
      return Promise.resolve({ rows: def === undefined ? [] : [{ def }] });
    },
  };
}

Deno.test("verificarMarcadores conta pulada, conferido e ausente", async (t) => {
  const VERIFICACOES = {
    "20260808000000_confirmar_pagamento.sql": {
      funcao: "confirmar_pagamento",
      esperado: ["IF NOT public.is_admin() THEN", "payment_status"],
    },
  };

  await t.step("migration FORA do mapa entra em `puladas`", async () => {
    const r = await verificarMarcadores(
      clienteFake({}),
      ["20260822000000_status_do_pedido_nunca_nulo.sql"],
      VERIFICACOES,
    );
    assertEquals(r.puladas, ["20260822000000_status_do_pedido_nunca_nulo.sql"]);
    assertEquals(r.conferidos, 0);
    assertEquals(r.ausentes, 0);
  });

  await t.step("marcadores presentes contam como conferidos", async () => {
    const r = await verificarMarcadores(
      clienteFake({
        confirmar_pagamento:
          "CREATE FUNCTION ...\nIF NOT public.is_admin() THEN\n payment_status = 'pago'",
      }),
      ["20260808000000_confirmar_pagamento.sql"],
      VERIFICACOES,
    );
    assertEquals(r.conferidos, 2);
    assertEquals(r.ausentes, 0);
    assertEquals(r.puladas, []);
  });

  await t.step("marcador que sumiu do corpo conta como ausente", async () => {
    const r = await verificarMarcadores(
      clienteFake({
        // A guarda de admin sumiu — exatamente o que o mapa existe para pegar.
        confirmar_pagamento: "CREATE FUNCTION ...\n payment_status = 'pago'",
      }),
      ["20260808000000_confirmar_pagamento.sql"],
      VERIFICACOES,
    );
    assertEquals(r.ausentes, 1);
    assertEquals(r.conferidos, 1);
  });

  await t.step("função que nem existe no banco conta como ausente", async () => {
    const r = await verificarMarcadores(
      clienteFake({}),
      ["20260808000000_confirmar_pagamento.sql"],
      VERIFICACOES,
    );
    assertEquals(r.ausentes, 2);
    assertEquals(r.conferidos, 0);
  });

  await t.step(
    "CRLF no marcador não vira AUSENTE falso (regressão já conhecida)",
    async () => {
      const comCrLf = {
        "x.sql": { funcao: "f", esperado: ["ELSE\r\n  UPDATE x"] },
      };
      const r = await verificarMarcadores(
        clienteFake({ f: "BEGIN\nELSE\n  UPDATE x\nEND" }),
        ["x.sql"],
        comCrLf,
      );
      assertEquals(r.ausentes, 0);
      assertEquals(r.conferidos, 1);
    },
  );

  await t.step("uma migration pulada e outra conferida somam separado", async () => {
    const r = await verificarMarcadores(
      clienteFake({
        confirmar_pagamento:
          "IF NOT public.is_admin() THEN\n payment_status = 'pago'",
      }),
      [
        "20260808000000_confirmar_pagamento.sql",
        "20260822000000_status_do_pedido_nunca_nulo.sql",
      ],
      VERIFICACOES,
    );
    assertEquals(r.conferidos, 2);
    assertEquals(r.ausentes, 0);
    assertEquals(r.puladas, ["20260822000000_status_do_pedido_nunca_nulo.sql"]);

    // E o veredito montado a partir dessas contagens NÃO pode dizer sucesso.
    const v = resumirVerificacao({ ...r, caminhoRollback: ROLLBACK });
    assertEquals(v.codigo, 2);
  });
});
