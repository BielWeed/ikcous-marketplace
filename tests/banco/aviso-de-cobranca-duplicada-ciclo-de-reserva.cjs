"use strict";

// PG17 efemero migrado em ordem alfabetica, clone de rodar-isolado.cjs.
// Cada banco representa uma loja; a tabela so tem chave, nao loja_id.
// RPCs reais como service_role. Fixtures e mutantes somem por ROLLBACK.
// MUTANTE_AVISO=liberar|confirmar sabota so o banco, nunca a migration.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const CHAVE = "cartao_divergente:pedido-fixture:order-fixture";
const OUTRA = "cartao_divergente:pedido-fixture:outra-order-fixture";
const RESERVAR = "SELECT public.reservar_aviso_ao_lojista($1) AS r";
const CONFIRMAR = "SELECT public.confirmar_aviso_ao_lojista($1) AS r";
const LIBERAR = "SELECT public.liberar_aviso_ao_lojista($1) AS r";
const chamar = async (sql, chave = CHAVE) =>
  (await P.como("service_role", sql, [chave]))[0].r;
const linhas = async () =>
  (
    await P.conexao().query(
      "SELECT chave, enviado FROM public.avisos_ao_lojista WHERE chave = ANY($1::text[]) ORDER BY chave",
      [[CHAVE, OUTRA]],
    )
  ).rows;

async function mutar(nome, assinatura, trecho, substituto) {
  if (process.env.MUTANTE_AVISO !== nome) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      assinatura,
    ])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer exatamente uma vez`,
  );
  const alterado = original.replace(trecho, substituto);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        assinatura,
      ])
    ).rows[0].d.replace(/\r/g, ""),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

prova("a primeira reserva avisa; a segunda espera sem criar outro aviso", () =>
  P.emTransacao(async () => {
    assert.equal(await chamar(RESERVAR), "reservado");
    assert.equal(await chamar(RESERVAR), "em_envio");
    assert.deepEqual(await linhas(), [{ chave: CHAVE, enviado: false }]);
  }),
);

prova("falha libera a vaga; repetir liberar e seguro", () =>
  P.emTransacao(async () => {
    await mutar(
      "liberar",
      "public.liberar_aviso_ao_lojista(text)",
      "AND enviado = false;",
      "AND enviado = false AND false;",
    );
    assert.equal(await chamar(RESERVAR), "reservado");
    // A proxima reserva e o oraculo: nao basta a RPC dizer que liberou.
    await chamar(LIBERAR);
    assert.equal(
      await chamar(RESERVAR),
      "reservado",
      "apos falha de envio, liberar precisa devolver a vaga",
    );
    assert.equal(await chamar(LIBERAR), true);
    assert.equal(await chamar(LIBERAR), false);
    assert.equal(await chamar(LIBERAR), false);
    assert.deepEqual(await linhas(), []);
    assert.equal(await chamar(CONFIRMAR), false);
    assert.equal(await chamar(CONFIRMAR), false);
    assert.equal(await chamar(RESERVAR), "reservado");
  }),
);

prova("confirmar fecha a chave; repetir confirmar ou liberar nao reabre", () =>
  P.emTransacao(async () => {
    await mutar(
      "confirmar",
      "public.confirmar_aviso_ao_lojista(text)",
      "SET enviado = true",
      "SET enviado = false",
    );
    assert.equal(await chamar(RESERVAR), "reservado");
    assert.equal(await chamar(CONFIRMAR), true);
    assert.equal(
      await chamar(RESERVAR),
      "enviado",
      "confirmar precisa impedir outro envio da mesma chave",
    );
    assert.equal(await chamar(CONFIRMAR), true);
    assert.equal(await chamar(CONFIRMAR), true);
    assert.equal(await chamar(LIBERAR), false);
    assert.equal(await chamar(LIBERAR), false);
    // Nem o vencimento da reserva pode reabrir um aviso ja entregue.
    await P.conexao().query(
      "UPDATE public.avisos_ao_lojista SET reservado_em = now() - interval '3 minutes' WHERE chave = $1",
      [CHAVE],
    );
    assert.equal(await chamar(RESERVAR), "enviado");
    assert.deepEqual(await linhas(), [{ chave: CHAVE, enviado: true }]);
  }),
);

prova("orders do mesmo pedido tem reservas independentes", () =>
  P.emTransacao(async () => {
    assert.equal(await chamar(RESERVAR), "reservado");
    assert.equal(await chamar(RESERVAR, OUTRA), "reservado");
    assert.equal(await chamar(CONFIRMAR), true);
    assert.equal(await chamar(RESERVAR, OUTRA), "em_envio");
    assert.equal(await chamar(LIBERAR, OUTRA), true);
    assert.equal(await chamar(RESERVAR, OUTRA), "reservado");
    assert.equal(await chamar(RESERVAR), "enviado");
    assert.deepEqual(await linhas(), [
      { chave: CHAVE, enviado: true },
      { chave: OUTRA, enviado: false },
    ]);
  }),
);

prova("reserva nao enviada so renova depois de dois minutos", () =>
  P.emTransacao(async () => {
    assert.equal(await chamar(RESERVAR), "reservado");
    await P.conexao().query(
      "UPDATE public.avisos_ao_lojista SET reservado_em = now() - interval '2 minutes' WHERE chave = $1",
      [CHAVE],
    );
    assert.equal(await chamar(RESERVAR), "em_envio");
    await P.conexao().query(
      "UPDATE public.avisos_ao_lojista SET reservado_em = reservado_em - interval '1 millisecond' WHERE chave = $1",
      [CHAVE],
    );
    assert.equal(await chamar(RESERVAR), "reservado");
    assert.equal(await chamar(RESERVAR), "em_envio");
    assert.equal(
      (
        await P.conexao().query(
          "SELECT reservado_em = now() AS renovou FROM public.avisos_ao_lojista WHERE chave = $1",
          [CHAVE],
        )
      ).rows[0].renovou,
      true,
    );
  }),
);

for (const papel of ["anon", "authenticated"]) {
  prova(`${papel} nao executa nenhuma das tres RPCs nem altera a reserva`, () =>
    P.emTransacao(async () => {
      assert.equal(await chamar(RESERVAR), "reservado");
      for (const sql of [RESERVAR, CONFIRMAR, LIBERAR]) {
        const r = await P.tentar(papel, sql, [CHAVE]);
        assert.equal(r.codigo, "42501", r.erro || "a RPC nao recusou");
        assert.match(r.erro, /permission denied for function/);
      }
      assert.equal(await chamar(RESERVAR), "em_envio");
      assert.deepEqual(await linhas(), [{ chave: CHAVE, enviado: false }]);
    }),
  );
}

async function main() {
  assert.ok(
    [undefined, "liberar", "confirmar"].includes(process.env.MUTANTE_AVISO),
    "MUTANTE_AVISO desconhecido",
  );
  await P.conectar();
  try {
    await P.executar("aviso de cobranca duplicada: ciclo de reserva");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
