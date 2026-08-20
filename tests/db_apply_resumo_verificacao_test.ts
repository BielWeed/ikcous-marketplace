// @ts-nocheck
/**
 * O resumo final da verificação pós-aplicação — scripts/db-apply.cjs
 *
 * Cobre o que o defeito de 20/08/2026 expôs: aplicar duas migrations sem
 * entrada em VERIFICACOES imprimia "sem verificação registrada, pulando"
 * para as duas e, três linhas abaixo, "Tudo aplicado e verificado" assim
 * mesmo. A causa era um booleano de dois valores (`tudoOk`) tentando
 * representar três estados — "verifiquei e passou", "verifiquei e falhou" e
 * "não verifiquei nada" caíam todos em `true` quando nada dava AUSENTE.
 *
 * Esta é a SEGUNDA vez que este script mente na mensagem final (a primeira
 * foi o cabeçalho de rollback coberto por db_apply_rollback_test.ts). Por
 * isso a correção é estrutural: `resumirVerificacao` tem três saídas
 * (VERIFICADO, PULADA, FALHOU) com precedência fixa, e PULADA nunca pode
 * soar como sucesso.
 *
 * Mora em tests/ pelo mesmo motivo do db_apply_rollback_test.ts, e usa
 * createRequire porque db-apply.cjs é CommonJS.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { resumirVerificacao, classificarChecagem } = require("../scripts/db-apply.cjs");

const CAMINHO_ROLLBACK = "rollback-20260823000000_ltv.sql";

Deno.test("todas verificadas: estado VERIFICADO, código 0", () => {
  const resultados = [
    { base: "a.sql", situacao: "verificada" },
    { base: "b.sql", situacao: "verificada" },
  ];
  const { estado, mensagem, codigoSaida } = resumirVerificacao(
    resultados,
    CAMINHO_ROLLBACK,
  );
  assertEquals(estado, "VERIFICADO");
  assertEquals(codigoSaida, 0);
  assertStringIncludes(mensagem, "Tudo aplicado e verificado");
});

// --------------------------------------------------------------------------
// O caso reproduzido: as duas migrations reais de 20/08/2026, as duas sem
// entrada em VERIFICACOES.
// --------------------------------------------------------------------------

Deno.test("todas puladas por falta de entrada: PULADA, código 2, sem frase de sucesso", () => {
  const NOME_1 = "20260823000000_ltv_do_cliente_conta_so_dinheiro_reconhecido.sql";
  const NOME_2 =
    "20260824000000_cliente_frequente_conta_so_dinheiro_reconhecido.sql";
  const resultados = [
    {
      base: NOME_1,
      situacao: "pulada",
      motivo: "nenhuma verificação registrada",
    },
    {
      base: NOME_2,
      situacao: "pulada",
      motivo: "nenhuma verificação registrada",
    },
  ];
  const { estado, mensagem, codigoSaida } = resumirVerificacao(
    resultados,
    CAMINHO_ROLLBACK,
  );
  assertEquals(estado, "PULADA");
  assertEquals(codigoSaida, 2);
  // A afirmação que enganou em 20/08/2026 não pode voltar a aparecer.
  assert(
    !/aplicado e verificado/i.test(mensagem),
    `mensagem PULADA soa como sucesso: ${mensagem}`,
  );
  assertStringIncludes(mensagem, NOME_1);
  assertStringIncludes(mensagem, NOME_2);
});

Deno.test("entrada registrada com `esperado` vazio conta como pulada, não verificada", () => {
  // A variante do mesmo defeito que ninguém tinha visto ainda: se
  // `checagem.esperado` for [], o laço de comparação não roda nenhuma vez,
  // então `tudoOk` continuava `true` sem NENHUM marcador de fato conferido.
  //
  // Diferente da versão anterior deste teste (que rotulava `situacao` à
  // mão, repetindo a asserção dos testes acima): aqui a situação vem de
  // classificarChecagem(), a MESMA função que o laço de main() chama depois
  // de rodar os marcadores — é o caminho real sendo exercitado, não uma
  // reafirmação com rótulo manual.
  const { situacao, motivo } = classificarChecagem({
    temRegistro: true,
    algumMarcadorAvaliado: false,
    algumMarcadorAusente: false,
  });
  const resultados = [
    { base: "m.sql", funcao: "alguma_funcao", situacao, motivo },
  ];
  const { estado, mensagem, codigoSaida } = resumirVerificacao(
    resultados,
    CAMINHO_ROLLBACK,
  );
  assertEquals(estado, "PULADA");
  assertEquals(codigoSaida, 2);
  assert(!/aplicado e verificado/i.test(mensagem));
});

Deno.test("misto verificada + pulada: o veredito é PULADA, nunca VERIFICADO", () => {
  const resultados = [
    { base: "a.sql", situacao: "verificada" },
    {
      base: "b.sql",
      situacao: "pulada",
      motivo: "nenhuma verificação registrada",
    },
  ];
  const { estado, mensagem, codigoSaida } = resumirVerificacao(
    resultados,
    CAMINHO_ROLLBACK,
  );
  assertEquals(estado, "PULADA");
  assertEquals(codigoSaida, 2);
  assert(
    !/aplicado e verificado/i.test(mensagem),
    `misto com pulada não pode soar como sucesso: ${mensagem}`,
  );
});

Deno.test("precedência: falhou + pulada juntos vira FALHOU, código 1", () => {
  const resultados = [
    { base: "a.sql", situacao: "falhou" },
    {
      base: "b.sql",
      situacao: "pulada",
      motivo: "nenhuma verificação registrada",
    },
  ];
  const { estado, codigoSaida } = resumirVerificacao(resultados, CAMINHO_ROLLBACK);
  assertEquals(estado, "FALHOU");
  assertEquals(codigoSaida, 1);
});

Deno.test("lista vazia (caso degenerado): PULADA, código 2 — desconhecido nunca é sucesso", () => {
  const { estado, codigoSaida, mensagem } = resumirVerificacao(
    [],
    CAMINHO_ROLLBACK,
  );
  assertEquals(estado, "PULADA");
  assertEquals(codigoSaida, 2);
  assert(!/aplicado e verificado/i.test(mensagem));
});

Deno.test("PULADA e FALHOU citam o COMMIT já feito e o caminho do rollback", async (t) => {
  await t.step("PULADA", () => {
    const { mensagem } = resumirVerificacao(
      [{ base: "a.sql", situacao: "pulada", motivo: "sem verificação" }],
      CAMINHO_ROLLBACK,
    );
    assertStringIncludes(mensagem, "COMMIT");
    assertStringIncludes(mensagem, CAMINHO_ROLLBACK);
  });

  await t.step("FALHOU", () => {
    const { mensagem } = resumirVerificacao(
      [{ base: "a.sql", situacao: "falhou" }],
      CAMINHO_ROLLBACK,
    );
    assertStringIncludes(mensagem, "COMMIT");
    assertStringIncludes(mensagem, CAMINHO_ROLLBACK);
  });
});

// --------------------------------------------------------------------------
// R1: resumirVerificacao não pode ter VERIFICADO como caminho padrão. Antes
// desta correção, um `situacao` fora do vocabulário conhecido ("pulado" em
// vez de "pulada", ausente, ou qualquer valor inventado) não casava nenhum
// dos três `filter` e caía direto no `return` final — o mesmo defeito de
// 20/08/2026, agora dentro da função escrita para fechá-lo.
// --------------------------------------------------------------------------

Deno.test("situação desconhecida (typo 'pulado') nunca vira VERIFICADO — cai em PULADA com motivo próprio", () => {
  const resultados = [{ base: "a.sql", situacao: "pulado" }]; // typo de "pulada"
  const { estado, mensagem, codigoSaida } = resumirVerificacao(
    resultados,
    CAMINHO_ROLLBACK,
  );
  assertEquals(estado, "PULADA");
  assertEquals(codigoSaida, 2);
  assert(
    !/aplicado e verificado/i.test(mensagem),
    `situação desconhecida não pode soar como sucesso: ${mensagem}`,
  );
  assertStringIncludes(mensagem, "situação desconhecida");
  assertStringIncludes(mensagem, "pulado");
});

Deno.test("situação ausente (undefined) nunca vira VERIFICADO", () => {
  const resultados = [{ base: "a.sql" }];
  const { estado, codigoSaida, mensagem } = resumirVerificacao(
    resultados,
    CAMINHO_ROLLBACK,
  );
  assertEquals(estado, "PULADA");
  assertEquals(codigoSaida, 2);
  assert(!/aplicado e verificado/i.test(mensagem));
});

// --------------------------------------------------------------------------
// R2: o resultado agora é por CHECAGEM (uma função dentro de uma migration),
// não por arquivo — o campo `funcao` tem de sobreviver até a mensagem, senão
// a identificação de qual checagem ficou sem conferir se perde.
// --------------------------------------------------------------------------

Deno.test("resultado com `funcao` aparece na mensagem para distinguir checagens do mesmo arquivo", () => {
  const resultados = [
    { base: "x.sql", funcao: "func_a", situacao: "falhou" },
    { base: "x.sql", funcao: "func_b", situacao: "verificada" },
  ];
  const { mensagem } = resumirVerificacao(resultados, CAMINHO_ROLLBACK);
  assertStringIncludes(mensagem, "func_a");
});

// --------------------------------------------------------------------------
// R3: a mensagem de FALHOU não pode descartar as PULADAS da mesma rodada.
// Reproduz o cenário real: `db-apply A.sql B.sql`, A.sql falha um marcador e
// B.sql não tem entrada em VERIFICACOES — sem isto, B.sql "some" do veredito
// e um `db-apply B.sql` isolado depois de corrigir A.sql sairia "Tudo
// aplicado e verificado", código 0, sem jamais ter sido conferido.
// --------------------------------------------------------------------------

Deno.test("FALHOU também lista as migrations puladas na mesma rodada, não as descarta", () => {
  const resultados = [
    { base: "A.sql", funcao: "alguma_funcao", situacao: "falhou" },
    {
      base: "B.sql",
      situacao: "pulada",
      motivo: "nenhuma verificação registrada",
    },
  ];
  const { estado, mensagem, codigoSaida } = resumirVerificacao(
    resultados,
    CAMINHO_ROLLBACK,
  );
  assertEquals(estado, "FALHOU");
  assertEquals(codigoSaida, 1);
  assertStringIncludes(mensagem, "A.sql");
  assertStringIncludes(mensagem, "B.sql");
});

// --------------------------------------------------------------------------
// R4: classificarChecagem() é a decisão que o laço de main() usa para
// classificar CADA checagem depois de rodar os marcadores. Extraída para dar
// teste direto ao laço que decide — antes desta task, só resumirVerificacao()
// tinha teste, e o laço que DECIDE a `situacao` (metade do defeito de 20/08)
// não tinha nenhum: trocar a classificação do ramo "sem entrada em
// VERIFICACOES" de "pulada" para "verificada" deixava os 26 testes antigos
// verdes.
// --------------------------------------------------------------------------

Deno.test("classificarChecagem: sem registro em VERIFICACOES → pulada (o caso literal de 20/08)", () => {
  const { situacao, motivo } = classificarChecagem({
    temRegistro: false,
    algumMarcadorAvaliado: false,
    algumMarcadorAusente: false,
  });
  assertEquals(situacao, "pulada");
  assertEquals(motivo, "nenhuma verificação registrada");
});

Deno.test("classificarChecagem: registro sem nenhum marcador avaliado → pulada", () => {
  const { situacao, motivo } = classificarChecagem({
    temRegistro: true,
    algumMarcadorAvaliado: false,
    algumMarcadorAusente: false,
  });
  assertEquals(situacao, "pulada");
  assertEquals(motivo, "a entrada registrada não confere nenhum marcador");
});

Deno.test("classificarChecagem: marcadores avaliados, algum ausente → falhou", () => {
  const { situacao } = classificarChecagem({
    temRegistro: true,
    algumMarcadorAvaliado: true,
    algumMarcadorAusente: true,
  });
  assertEquals(situacao, "falhou");
});

Deno.test("classificarChecagem: marcadores avaliados, todos presentes → verificada", () => {
  const { situacao } = classificarChecagem({
    temRegistro: true,
    algumMarcadorAvaliado: true,
    algumMarcadorAusente: false,
  });
  assertEquals(situacao, "verificada");
});

Deno.test("os três códigos de saída são distintos entre si", () => {
  // É este teste que impede alguém colapsar PULADA (2) de volta em
  // VERIFICADO (0) ou em FALHOU (1) — o defeito original em outras palavras.
  const { codigoSaida: verificado } = resumirVerificacao(
    [{ base: "a.sql", situacao: "verificada" }],
    CAMINHO_ROLLBACK,
  );
  const { codigoSaida: pulada } = resumirVerificacao(
    [{ base: "a.sql", situacao: "pulada", motivo: "x" }],
    CAMINHO_ROLLBACK,
  );
  const { codigoSaida: falhou } = resumirVerificacao(
    [{ base: "a.sql", situacao: "falhou" }],
    CAMINHO_ROLLBACK,
  );
  assertEquals(verificado, 0);
  assertEquals(pulada, 2);
  assertEquals(falhou, 1);
  assertNotEquals(verificado, pulada);
  assertNotEquals(verificado, falhou);
  assertNotEquals(pulada, falhou);
});
