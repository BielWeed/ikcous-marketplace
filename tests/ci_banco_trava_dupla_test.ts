// @ts-nocheck
/**
 * A trava dupla que separa a frente CI-BANCO de um host de Supabase
 * gerenciado — scripts/ci/banco/util.cjs (lerDatabaseUrlEfemero) — e a trava
 * irmã do job rpc-ci — tests/banco/efemero.cjs (lerDatabaseUrlEfemera).
 *
 * util-87: nenhum arquivo em tests/ exercitava essa lógica (grep vazio antes
 * deste arquivo). Um refactor que invertesse a condição do `.find()` sobre
 * HOSTS_PROIBIDOS, ou trocasse a checagem de CI_BANCO_EFEMERO por um typo,
 * passaria batido até um `db-ci`/`rpc-ci` apontar de verdade para produção —
 * exatamente a classe de falha silenciosa que o AGENTS.md já registra
 * ("BEGIN/COMMIT numa migration gravou em produção").
 *
 * As duas funções chamam `process.exit` direto de dentro de `sair()`/
 * `falhar()`, sem separar decisão de saída do efeito (ao contrário de
 * scripts/db-prove-rollback.cjs, que exporta `codigoDeSaida` puro à parte).
 * Por isso cada caso troca `process.exit` por um stub que LANÇA em vez de
 * matar o worker do Deno — em Node real, o processo também nunca volta da
 * chamada, então lançar reproduz fielmente o "nunca retorna" sem derrubar o
 * test runner. As chaves de ambiente lidas pelas duas travas são guardadas e
 * restauradas por `Deno.env` a cada passo, mesmo padrão de
 * tests/link_do_whatsapp_test.ts (comEnvAsync), para não vazar estado entre
 * casos.
 *
 * Mora em tests/ e usa createRequire pelo mesmo motivo dos arquivos irmãos
 * (tests/ler_migration_test.ts, tests/db_apply_rollback_test.ts): os dois
 * módulos sob teste são CommonJS e a suíte roda em Deno.
 */
import { createRequire } from "node:module";
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { lerDatabaseUrlEfemero } = require("../scripts/ci/banco/util.cjs");
const { lerDatabaseUrlEfemera } = require("./banco/efemero.cjs");

const CHAVES_DE_AMBIENTE = ["DATABASE_URL", "CI_BANCO_EFEMERO"];

/** Zera as duas chaves, aplica só o que o caso precisa e restaura o valor
 * anterior no finally — nunca deixa vazamento de env entre casos (mesmo
 * padrão de tests/link_do_whatsapp_test.ts). */
function comEnv<T>(
  pares: Record<string, string | undefined>,
  executar: () => T,
): T {
  const anteriores: Array<[string, string | undefined]> =
    CHAVES_DE_AMBIENTE.map((chave) => [chave, Deno.env.get(chave)]);
  for (const chave of CHAVES_DE_AMBIENTE) Deno.env.delete(chave);
  for (const [chave, valor] of Object.entries(pares)) {
    if (valor !== undefined) Deno.env.set(chave, valor);
  }
  try {
    return executar();
  } finally {
    for (const [chave, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(chave);
      else Deno.env.set(chave, valor);
    }
  }
}

/** Troca process.exit por um stub que LANÇA (guardando o código de saída)
 * em vez de derrubar o worker do Deno, e sempre restaura o original. */
function comSaidaCapturada<T>(executar: () => T): {
  retornou: boolean;
  valor?: T;
  codigoSaida?: number;
} {
  const original = process.exit;
  let codigoSaida: number | undefined;
  // @ts-ignore -- stub de teste; a assinatura real de process.exit não importa aqui
  process.exit = (codigo?: number) => {
    codigoSaida = codigo;
    throw new Error(`process.exit(${codigo})`);
  };
  try {
    const valor = executar();
    return { retornou: true, valor };
  } catch {
    return { retornou: false, codigoSaida };
  } finally {
    process.exit = original;
  }
}

const URL_EFEMERA_OK = "postgres://postgres:postgres@localhost:5432/postgres";

// As URLs de exemplo não levam senha de propósito: a trava só olha o
// prefixo e o host, e uma string user:senha@host acionaria o secretlint do
// pre-commit e o job "Varredura de segredo" mesmo sendo fictícia.
Deno.test("lerDatabaseUrlEfemero — scripts/ci/banco/util.cjs (frente CI-BANCO)", async (t) => {
  await t.step("sem DATABASE_URL: recusa (RECUSADO = código 2)", () => {
    const resultado = comEnv({}, () =>
      comSaidaCapturada(() => lerDatabaseUrlEfemero()),
    );
    assertEquals(resultado.retornou, false);
    assertEquals(resultado.codigoSaida, 2);
  });

  await t.step(
    "DATABASE_URL presente mas CI_BANCO_EFEMERO ausente: recusa",
    () => {
      const resultado = comEnv({ DATABASE_URL: URL_EFEMERA_OK }, () =>
        comSaidaCapturada(() => lerDatabaseUrlEfemero()),
      );
      assertEquals(resultado.retornou, false);
      assertEquals(resultado.codigoSaida, 2);
    },
  );

  await t.step("CI_BANCO_EFEMERO='0' (não é '1'): recusa", () => {
    const resultado = comEnv(
      { DATABASE_URL: URL_EFEMERA_OK, CI_BANCO_EFEMERO: "0" },
      () => comSaidaCapturada(() => lerDatabaseUrlEfemero()),
    );
    assertEquals(resultado.retornou, false);
    assertEquals(resultado.codigoSaida, 2);
  });

  await t.step(
    "host de Supabase gerenciado .co recusa mesmo com a flag",
    () => {
      const resultado = comEnv(
        {
          DATABASE_URL:
            "postgres://postgres@db.abcdefghij.supabase.co:5432/postgres",
          CI_BANCO_EFEMERO: "1",
        },
        () => comSaidaCapturada(() => lerDatabaseUrlEfemero()),
      );
      assertEquals(resultado.retornou, false);
      assertEquals(resultado.codigoSaida, 2);
    },
  );

  await t.step(
    "host de Supabase gerenciado .com recusa mesmo com a flag",
    () => {
      const resultado = comEnv(
        {
          DATABASE_URL:
            "postgres://postgres@db.abcdefghij.supabase.com:5432/postgres",
          CI_BANCO_EFEMERO: "1",
        },
        () => comSaidaCapturada(() => lerDatabaseUrlEfemero()),
      );
      assertEquals(resultado.retornou, false);
      assertEquals(resultado.codigoSaida, 2);
    },
  );

  await t.step(
    "host de Supabase gerenciado .net recusa mesmo com a flag",
    () => {
      const resultado = comEnv(
        {
          DATABASE_URL:
            "postgres://postgres@db.abcdefghij.supabase.net:5432/postgres",
          CI_BANCO_EFEMERO: "1",
        },
        () => comSaidaCapturada(() => lerDatabaseUrlEfemero()),
      );
      assertEquals(resultado.retornou, false);
      assertEquals(resultado.codigoSaida, 2);
    },
  );

  await t.step("host de pooler gerenciado recusa mesmo com a flag", () => {
    const resultado = comEnv(
      {
        DATABASE_URL:
          "postgres://postgres@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
        CI_BANCO_EFEMERO: "1",
      },
      () => comSaidaCapturada(() => lerDatabaseUrlEfemero()),
    );
    assertEquals(resultado.retornou, false);
    assertEquals(resultado.codigoSaida, 2);
  });

  await t.step(
    "host gerenciado escondido no meio do nome (só o includes pega) recusa mesmo com a flag",
    () => {
      // Prende o terceiro ramo do predicado de HOSTS_PROIBIDOS
      // (host.includes): sem ele, um túnel/proxy com o host do Supabase no
      // meio do nome passaria pela trava.
      const resultado = comEnv(
        {
          DATABASE_URL:
            "postgres://postgres@db.projeto.supabase.co.tunel.exemplo.net:5432/postgres",
          CI_BANCO_EFEMERO: "1",
        },
        () => comSaidaCapturada(() => lerDatabaseUrlEfemero()),
      );
      assertEquals(resultado.retornou, false);
      assertEquals(resultado.codigoSaida, 2);
    },
  );

  await t.step(
    "DATABASE_URL malformada: recusa (não é URL de postgres válida)",
    () => {
      const resultado = comEnv(
        { DATABASE_URL: "isto-nao-e-uma-url", CI_BANCO_EFEMERO: "1" },
        () => comSaidaCapturada(() => lerDatabaseUrlEfemero()),
      );
      assertEquals(resultado.retornou, false);
      assertEquals(resultado.codigoSaida, 2);
    },
  );

  await t.step("host efêmero local com a flag: aceita e devolve a URL", () => {
    const resultado = comEnv(
      { DATABASE_URL: URL_EFEMERA_OK, CI_BANCO_EFEMERO: "1" },
      () => comSaidaCapturada(() => lerDatabaseUrlEfemero()),
    );
    assertEquals(resultado.retornou, true);
    assertEquals(resultado.valor, URL_EFEMERA_OK);
  });
});

Deno.test("lerDatabaseUrlEfemera — tests/banco/efemero.cjs (trava irmã do job rpc-ci)", async (t) => {
  await t.step("sem CI_BANCO_EFEMERO: recusa", () => {
    const resultado = comEnv({ DATABASE_URL: URL_EFEMERA_OK }, () =>
      comSaidaCapturada(() => lerDatabaseUrlEfemera()),
    );
    assertEquals(resultado.retornou, false);
    assertEquals(resultado.codigoSaida, 1);
  });

  await t.step(
    "host fora da whitelist (supabase.co) recusa mesmo com a flag",
    () => {
      const resultado = comEnv(
        {
          DATABASE_URL:
            "postgres://postgres@db.abcdefghij.supabase.co:5432/postgres",
          CI_BANCO_EFEMERO: "1",
        },
        () => comSaidaCapturada(() => lerDatabaseUrlEfemera()),
      );
      assertEquals(resultado.retornou, false);
      assertEquals(resultado.codigoSaida, 1);
    },
  );

  await t.step("host de pooler gerenciado recusa mesmo com a flag", () => {
    const resultado = comEnv(
      {
        DATABASE_URL:
          "postgres://postgres@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
        CI_BANCO_EFEMERO: "1",
      },
      () => comSaidaCapturada(() => lerDatabaseUrlEfemera()),
    );
    assertEquals(resultado.retornou, false);
    assertEquals(resultado.codigoSaida, 1);
  });

  await t.step("sem prefixo postgres:// recusa mesmo em host localhost", () => {
    const resultado = comEnv(
      { DATABASE_URL: "http://localhost:5432/postgres", CI_BANCO_EFEMERO: "1" },
      () => comSaidaCapturada(() => lerDatabaseUrlEfemera()),
    );
    assertEquals(resultado.retornou, false);
    assertEquals(resultado.codigoSaida, 1);
  });

  await t.step(
    "host efêmero local (127.0.0.1) com a flag: aceita e devolve a URL",
    () => {
      const urlLoopback =
        "postgres://postgres:postgres@127.0.0.1:5432/postgres";
      const resultado = comEnv(
        { DATABASE_URL: urlLoopback, CI_BANCO_EFEMERO: "1" },
        () => comSaidaCapturada(() => lerDatabaseUrlEfemera()),
      );
      assertEquals(resultado.retornou, true);
      assertEquals(resultado.valor, urlLoopback);
    },
  );

  await t.step(
    "host efêmero local (localhost) com a flag: aceita e devolve a URL",
    () => {
      const resultado = comEnv(
        { DATABASE_URL: URL_EFEMERA_OK, CI_BANCO_EFEMERO: "1" },
        () => comSaidaCapturada(() => lerDatabaseUrlEfemera()),
      );
      assertEquals(resultado.retornou, true);
      assertEquals(resultado.valor, URL_EFEMERA_OK);
    },
  );
});
