"use strict";

/**
 * Prova viva de update_my_profile_secure no clone migrado de rodar-isolado.cjs.
 * NULL preserva o WhatsApp; vazio limpa e texto novo substitui.
 * MUTANTE_R104E=perfil-whatsapp-sem-coalesce tira somente o COALESCE do telefone
 * na definicao viva do clone. Nenhum SQL de producao muda.
 */
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const UID = "b104e000-0000-4000-8000-0000000000a1";
const TELEFONE = "11999990001";
const NOME = "José 🦊";

async function montar() {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'perfil-r104e@example.invalid', '{}'::jsonb)",
    [UID],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, whatsapp, role) VALUES ($1::uuid, 'Nome anterior', $2, 'customer')",
    [UID, TELEFONE],
  );
  if (process.env.MUTANTE_R104E === "perfil-whatsapp-sem-coalesce") {
    // A baseline 20260806000000 e a ultima definicao; as migrations seguintes
    // mudam grants e CHECKs, nao o corpo. Ler o catalogo preserva o corpo vivo.
    const { rows } = await c.query(
      "SELECT pg_get_functiondef('public.update_my_profile_secure(text,text,text,text)'::regprocedure) AS def",
    );
    const original = rows[0].def;
    const guarda = "whatsapp = COALESCE(p_whatsapp, whatsapp)";
    assert.equal(
      original.split(guarda).length - 1,
      1,
      "a mutacao deve encontrar exatamente uma guarda do WhatsApp",
    );
    const mutante = original.replace(guarda, "whatsapp = p_whatsapp");
    assert.notEqual(mutante, original, "o mutante nao foi aplicado");
    await c.query(mutante);
  }
}

const lerPerfil = async () =>
  (
    await P.conexao().query(
      "SELECT full_name, whatsapp FROM public.profiles WHERE id = $1::uuid",
      [UID],
    )
  ).rows[0];

async function alterar(whatsapp) {
  const r = await P.tentar(
    "authenticated",
    "SELECT public.update_my_profile_secure(p_full_name => $1::text, p_whatsapp => $2::text, p_avatar_url => NULL::text, p_cover_url => NULL::text)",
    [NOME, whatsapp],
    { uid: UID },
  );
  assert.ok(r.linhas, `a RPC deve aceitar a alteracao: ${r.erro}`);
}

prova(
  "mudar so o nome com WhatsApp NULL preserva o telefone persistido",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(await lerPerfil(), {
        full_name: "Nome anterior",
        whatsapp: TELEFONE,
      });
      await alterar(null);
      const perfil = await lerPerfil();
      assert.equal(perfil.full_name, NOME, "o nome deve ter sido trocado");
      assert.equal(
        perfil.whatsapp,
        TELEFONE,
        "WhatsApp NULL deve preservar o telefone persistido",
      );
    }, montar);
  },
);

prova("WhatsApp vazio limpa o telefone persistido", async () => {
  await P.emTransacao(async () => {
    await alterar("");
    assert.deepEqual(await lerPerfil(), { full_name: NOME, whatsapp: "" });
  }, montar);
});

prova("WhatsApp novo substitui o telefone persistido", async () => {
  await P.emTransacao(async () => {
    await alterar("21999990002");
    assert.deepEqual(await lerPerfil(), {
      full_name: NOME,
      whatsapp: "21999990002",
    });
  }, montar);
});

(async () => {
  await P.conectar();
  try {
    await P.executar("perfil-alterar-so-o-nome-nao-apaga-o-whatsapp");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
