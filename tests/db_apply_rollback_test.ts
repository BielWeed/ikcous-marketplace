// @ts-nocheck
/**
 * O cabeçalho do arquivo de rollback — scripts/db-apply.cjs
 *
 * Cobre o que a aplicação da Fase 1 do CHECKOUT-010 expôs em 06/08/2026: o
 * cabeçalho afirmava, incondicionalmente, "para desfazer, rode este arquivo
 * inteiro no SQL Editor", e dois arquivos saíram sem uma única instrução —
 * um deles referente a uma migration que já tinha cancelado 13 pedidos e
 * creditado 33 unidades de estoque.
 *
 * O que estes testes protegem não é o formato do texto, é a honestidade dele:
 * um rollback inerte tem de se anunciar como inerte, porque quem o abre está
 * num incidente, com backup de até 24 h e sem PITR neste projeto.
 *
 * Mora em tests/ pelo mesmo motivo do truth_gate_test.ts, e usa createRequire
 * porque db-apply.cjs é CommonJS.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { funcoesAlteradas, montarRollback } = require("../scripts/db-apply.cjs");

const DEF_EXEMPLO =
  "CREATE OR REPLACE FUNCTION public.f()\n RETURNS void\nAS $function$ BEGIN END $function$";

/** A migration real que gerou o rollback de duas linhas, ambas comentário. */
const BACKFILL_SEM_FUNCAO = `
  UPDATE public.pedidos SET status = 'cancelado'
   WHERE status = 'aguardando_pagamento' AND created_at < now() - interval '7 days';
  UPDATE public.produtos p SET estoque = p.estoque + i.quantity FROM itens i
   WHERE i.pedido_id = ANY(SELECT id FROM public.pedidos WHERE status = 'cancelado');
`;

/** A outra: só DDL, nenhuma função. */
const DDL_SEM_FUNCAO = `
  ALTER TABLE public.pedidos ADD COLUMN reserva_expira_em timestamptz;
  ALTER TABLE public.pedidos ADD COLUMN reservado_em timestamptz;
  ALTER TABLE public.pedidos ADD CONSTRAINT reserva_coerente
    CHECK (reserva_expira_em IS NULL OR reservado_em IS NOT NULL);
  CREATE INDEX idx_pedidos_reserva ON public.pedidos (reserva_expira_em);
`;

// --------------------------------------------------------------------------
// O alcance real do gerador — a premissa de que todo o resto depende
// --------------------------------------------------------------------------

Deno.test("funcoesAlteradas só enxerga CREATE OR REPLACE FUNCTION", async (t) => {
  await t.step("acha a função redefinida", () => {
    assertEquals(
      funcoesAlteradas("CREATE OR REPLACE FUNCTION public.minha_fn() ..."),
      ["minha_fn"],
    );
  });

  // Estes dois não são bugs a consertar aqui: são o motivo de o cabeçalho
  // precisar avisar. Se um dia o gerador passar a cobrir DDL, é este teste
  // que tem de mudar primeiro, de propósito.
  await t.step("não enxerga DDL", () => {
    assertEquals(funcoesAlteradas(DDL_SEM_FUNCAO), []);
  });

  await t.step("não enxerga DML", () => {
    assertEquals(funcoesAlteradas(BACKFILL_SEM_FUNCAO), []);
  });
});

// --------------------------------------------------------------------------
// Rollback inerte
// --------------------------------------------------------------------------

Deno.test("rollback sem instrução se anuncia como inerte", async (t) => {
  const vazios = [
    ["nenhuma função tocada (backfill/DDL puro)", []],
    [
      "função tocada mas inexistente no banco",
      [{ funcao: "reservar_estoque", defs: [] }],
    ],
  ];

  for (const [nome, restauracoes] of vazios) {
    await t.step(nome, () => {
      const { conteudo, instrucoes } = montarRollback(["m.sql"], restauracoes);
      assertEquals(instrucoes, 0);
      assertStringIncludes(conteudo, "NÃO CONTÉM NENHUM COMANDO EXECUTÁVEL");
      assertStringIncludes(conteudo, "NÃO DESFAZ NADA");
      assertStringIncludes(conteudo, "MANUAL");
    });
  }

  await t.step("não sobra nenhuma instrução executável no arquivo", () => {
    const { conteudo } = montarRollback(
      ["m.sql"],
      [{ funcao: "reservar_estoque", defs: [] }],
    );
    const executaveis = conteudo
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.trimStart().startsWith("--"));
    assertEquals(executaveis, [], `sobrou: ${executaveis.join(" | ")}`);
  });

  await t.step("não manda rodar o arquivo para desfazer", () => {
    // A frase que mentia. Se ela voltar para um arquivo inerte, o bug voltou.
    const { conteudo } = montarRollback(["m.sql"], []);
    assert(
      !/rode este arquivo inteiro/i.test(conteudo),
      "o cabeçalho voltou a mandar rodar um arquivo que não faz nada",
    );
  });
});

// --------------------------------------------------------------------------
// Rollback com conteúdo
// --------------------------------------------------------------------------

Deno.test("rollback com definição restaura e delimita o escopo", async (t) => {
  const comDef = () =>
    montarRollback(["m.sql"], [{ funcao: "f", defs: [DEF_EXEMPLO] }]);

  await t.step("conta a definição e a grava com ponto e vírgula", () => {
    const { conteudo, instrucoes } = comDef();
    assertEquals(instrucoes, 1);
    assertStringIncludes(conteudo, `${DEF_EXEMPLO};`);
  });

  await t.step("não usa o aviso de arquivo inerte", () => {
    assert(!comDef().conteudo.includes("NÃO CONTÉM NENHUM COMANDO"));
  });

  await t.step("ainda avisa que só restaura função", () => {
    // Restaurar a função e calar sobre o ADD COLUMN da mesma migration é a
    // mesma mentira em dose menor.
    const { conteudo } = comDef();
    assertStringIncludes(conteudo, "APENAS");
    assertStringIncludes(conteudo, "não\n-- desfaz a migration inteira");
  });

  await t.step("migration mista conta só o que dá para restaurar", () => {
    const { conteudo, instrucoes } = montarRollback(
      ["m.sql"],
      [
        { funcao: "f", defs: [DEF_EXEMPLO] },
        { funcao: "nova", defs: [] },
      ],
    );
    assertEquals(instrucoes, 1);
    assertStringIncludes(conteudo, "-- nova: não existe hoje no banco");
  });

  await t.step("função sobrecarregada conta cada definição", () => {
    const { instrucoes } = montarRollback(
      ["m.sql"],
      [{ funcao: "f", defs: [DEF_EXEMPLO, `${DEF_EXEMPLO} -- (int)`] }],
    );
    assertEquals(instrucoes, 2);
  });

  // Achado da revisão de contexto limpo: `assertStringIncludes(conteudo,
  // `${DEF_EXEMPLO};`)` acima casa mesmo se a linha estiver comentada com
  // `-- `, porque `String.includes` não olha início de linha. Este passo
  // fecha esse buraco: exige uma linha de fato executável (não vazia, não
  // começando com `--`) sempre que `instrucoes > 0`.
  await t.step(
    "existe ao menos uma linha executável quando há instrução",
    () => {
      const { conteudo, instrucoes } = comDef();
      assert(instrucoes > 0);
      const executaveis = conteudo
        .split("\n")
        .filter((l) => l.trim() !== "" && !l.trimStart().startsWith("--"));
      assert(
        executaveis.length > 0,
        "nenhuma linha executável encontrada, mas instrucoes > 0",
      );
    },
  );
});

// --------------------------------------------------------------------------
// Buraco achado na revisão: `instrucoes === 0` também acontece quando a
// migration CRIA função nova (não existe hoje no banco), e isso não é o
// mesmo caso de "não redefine função". A prova real está em
// 20260807000000_reserva_com_expiracao.sql: `expirar_pedidos_vencidos` e
// `create_marketplace_order_v24` são funções novas — quem lê "esta migration
// não redefine função" nesse cabeçalho desfaz o DDL à mão e deixa a função
// nova (a varredura que cancela pedido em massa) viva no banco.
// --------------------------------------------------------------------------

Deno.test("rollback de função nova nomeia a criação e não mente sobre redefinição", async (t) => {
  const { conteudo, instrucoes } = montarRollback(
    ["20260807000000_reserva_com_expiracao.sql"],
    [{ funcao: "expirar_pedidos_vencidos", defs: [] }],
  );

  await t.step("continua inerte — nada a restaurar", () => {
    assertEquals(instrucoes, 0);
    assertStringIncludes(conteudo, "NÃO CONTÉM NENHUM COMANDO EXECUTÁVEL");
  });

  await t.step("não afirma que a migration não redefine função", () => {
    // A mentira que o achado provou: a migration REDEFINE função (é assim
    // que funcoesAlteradas() a viu), só que a função ainda não existia.
    assert(
      !/não redefine função/i.test(conteudo),
      "o cabeçalho ainda nega que a migration mexe em função",
    );
  });

  await t.step("nomeia a função criada NO CABEÇALHO", () => {
    // Ancorado na frase do cabeçalho, não no nome solto: o corpo já trazia
    // `-- expirar_pedidos_vencidos: não existe hoje no banco (será criada).`
    // desde antes deste PR, então procurar só o nome passava mesmo contra o
    // código com o bug. Achado da segunda revisão, provado por mutação.
    assertStringIncludes(
      conteudo,
      "não há definição anterior para restaurar: expirar_pedidos_vencidos",
    );
  });

  await t.step(
    "aponta DROP FUNCTION como o jeito de desfazer, sem gerar o comando",
    () => {
      // Informar é permitido; gerar o DROP executável não — o PR recusou isso
      // de propósito, então a linha tem de ficar como comentário.
      assertStringIncludes(conteudo, "DROP FUNCTION");
      assert(
        !/^\s*DROP FUNCTION/m.test(conteudo),
        "gerou um DROP FUNCTION executável, e isso não é o contrato deste arquivo",
      );
    },
  );
});

Deno.test("rollback misto avisa que restaurar não remove a função nova", async (t) => {
  const { conteudo, instrucoes } = montarRollback(
    ["20260807000000_reserva_com_expiracao.sql"],
    [
      { funcao: "devolver_estoque", defs: [DEF_EXEMPLO] },
      { funcao: "create_marketplace_order_v24", defs: [] },
    ],
  );

  await t.step("restaura a que existia", () => {
    assertEquals(instrucoes, 1);
    assertStringIncludes(conteudo, `${DEF_EXEMPLO};`);
  });

  await t.step("nomeia a função nova NO CABEÇALHO", () => {
    // Mesmo motivo do teste acima: o nome solto já aparece no corpo desde
    // antes do PR. O que este passo protege é o aviso do cabeçalho.
    assertStringIncludes(
      conteudo,
      "-- create_marketplace_order_v24. Restaurar as funções acima",
    );
  });

  await t.step(
    "diz explicitamente que restaurar não remove a função nova",
    () => {
      assert(
        /restaurar.{0,80}não remove/is.test(conteudo),
        "o cabeçalho não avisa que restaurar não é o bastante para remover a função nova",
      );
      assertStringIncludes(conteudo, "DROP FUNCTION");
    },
  );
});

Deno.test("o cabeçalho nomeia as migrations cobertas", () => {
  const { conteudo } = montarRollback(["a.sql", "b.sql"], []);
  assertStringIncludes(conteudo, "antes de aplicar: a.sql, b.sql");
});
