"use strict";

/**
 * Isolamento de get_my_complete_profile() no Postgres EFEMERO migrado.
 * Sem filtro na chamada: a propria RPC SECURITY DEFINER precisa escolher a conta.
 * Mutante (so no clone descartavel): retirar WHERE p.id = auth.uid() do corpo
 * obtido por pg_get_functiondef('public.get_my_complete_profile()'::regprocedure).
 * As duas provas abaixo devem reprovar por devolverem perfis alheios.
 *
 * CI_BANCO_EFEMERO=1 e DATABASE_URL local, como em rpc-ci.yml:
 * node tests/banco/rodar-isolado.cjs tests/banco/o-perfil-completo-so-devolve-a-propria-conta-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const A = "b100a100-0000-4000-8000-000000000001";
const B = "b100a100-0000-4000-8000-000000000002";
const PERFIS = [
  {
    id: A,
    full_name: "Pessoa Alfa Ficticia",
    whatsapp: "11900000001",
    role: "customer",
    avatar_url: "https://example.invalid/alfa.png",
    created_at: new Date("2026-01-02T03:04:05.000Z"),
    cover_url: "https://example.invalid/capa-alfa.png",
  },
  {
    id: B,
    full_name: "Pessoa Beta Ficticia",
    whatsapp: "21900000002",
    role: "customer",
    avatar_url: "https://example.invalid/beta.png",
    created_at: new Date("2026-02-03T04:05:06.000Z"),
    cover_url: "https://example.invalid/capa-beta.png",
  },
];

async function semear() {
  const c = P.conexao();
  for (const p of PERFIS) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
      [p.id, `${p.id}@perfil.example.invalid`],
    );
    await c.query(
      `INSERT INTO public.profiles
         (id, full_name, whatsapp, role, avatar_url, created_at, cover_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        p.id,
        p.full_name,
        p.whatsapp,
        p.role,
        p.avatar_url,
        p.created_at,
        p.cover_url,
      ],
    );
  }
}

for (const esperado of PERFIS) {
  prova(
    `perfil completo de ${esperado.full_name}: exatamente a propria linha, nenhum campo da outra conta`,
    () =>
      P.emTransacao(async () => {
        await semear();
        const sessao = await P.como(
          "authenticated",
          "SELECT current_user AS papel, auth.uid() AS uid",
          [],
          { uid: esperado.id },
        );
        assert.deepEqual(sessao, [
          { papel: "authenticated", uid: esperado.id },
        ]);
        const linhas = await P.como(
          "authenticated",
          "SELECT * FROM public.get_my_complete_profile()",
          [],
          { uid: esperado.id },
        );
        assert.deepEqual(
          linhas,
          [esperado],
          "a RPC deve devolver EXATAMENTE os sete campos da propria conta",
        );
      }),
  );
}

async function main() {
  await P.conectar();
  // auth.uid() do provisionar le app.rpc.user_id; o GRANT so permite conferir a identidade
  // como authenticated neste clone descartavel.
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("perfil completo restrito a propria conta");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));
