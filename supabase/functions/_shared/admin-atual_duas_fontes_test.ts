// @ts-nocheck
// Caça por mutação (25/11/2026) em `admin-atual.ts`, a porta de admin das edges
// de dinheiro (estorno, cancelar pedido, chaves do Mercado Pago, etiqueta). A
// regra é "admin nas DUAS fontes: `profiles.role` E `app_metadata.role` do Auth.
// Contradição (rebaixado em uma só) NÃO é admin". Apagar a metade do Auth
// (`&& user.app_metadata?.role === "admin"`) NÃO derrubava nenhum dos testes de
// `admin-atual_*` nem os das edges (que injetam o próprio verificador): um admin
// rebaixado no Auth, com o JWT ainda válido e a linha de `profiles` ainda
// `admin`, continuaria mexendo em dinheiro.
//
// Também fica provado COM QUAL chave cada chamada sai: a sessão é validada com
// a chave PÚBLICA e o Bearer do usuário; `profiles` é lido com a chave de
// SERVIÇO e nunca leva o Bearer do usuário (senão a leitura passaria pelas
// regras de linha do próprio usuário, não pelas do serviço).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { adminAtualDaSessao } from "./admin-atual.ts";

const URL_SUPA = "https://supa-fake.local";
const UID = "11111111-1111-4111-8111-111111111111";

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Visto = { caminho: string; apikey: string | null; authorization: string | null };

/** O "mundo": o Auth devolve o usuário com os metadados dados; o banco, o papel do perfil. */
function mundo(usuario: Record<string, unknown>, perfil: unknown) {
  const vistos: Visto[] = [];
  const buscar: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const cabecalhos = input instanceof Request ? input.headers : new Headers(init?.headers);
    vistos.push({
      caminho: url.pathname,
      apikey: cabecalhos.get("apikey"),
      authorization: cabecalhos.get("authorization"),
    });
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        json({ id: UID, aud: "authenticated", role: "authenticated", ...usuario }),
      );
    }
    if (url.pathname === "/rest/v1/profiles") return Promise.resolve(json(perfil));
    throw new Error(`Rede fora do roteiro bloqueada: ${url.href}`);
  };
  return { buscar, vistos };
}

const opcoes = (buscar: typeof fetch) => ({
  url: URL_SUPA,
  chavePublica: "anon-de-teste",
  chaveDeServico: "service-role-de-teste",
  fetchImpl: buscar,
  rotulo: "[teste-admin]",
});

Deno.test("admin atual — CONTROLE: admin no perfil E no Auth passa e devolve o id", async () => {
  const { buscar } = mundo({ app_metadata: { role: "admin" } }, { role: "admin" });
  assertEquals(await adminAtualDaSessao("Bearer jwt-de-teste", opcoes(buscar)), UID);
});

Deno.test("admin atual — perfil admin mas rebaixado no AUTH (app_metadata de outro papel ou sem papel): NÃO é admin", async () => {
  for (
    const [rotulo, usuario] of [
      ["app_metadata customer", { app_metadata: { role: "customer" } }],
      ["app_metadata sem papel", { app_metadata: { provider: "email" } }],
      ["app_metadata vazio", { app_metadata: {} }],
      ["sem app_metadata", {}],
      ["papel com caixa diferente", { app_metadata: { role: "Admin" } }],
      // user_metadata o próprio usuário edita: nunca vale como papel.
      ["admin só em user_metadata", { app_metadata: {}, user_metadata: { role: "admin" } }],
    ] as const
  ) {
    const { buscar } = mundo(usuario, { role: "admin" });
    assertEquals(
      await adminAtualDaSessao("Bearer jwt-de-teste", opcoes(buscar)),
      null,
      rotulo,
    );
  }
});

Deno.test("admin atual — admin no Auth mas rebaixado no PERFIL (outro papel, nulo ou caixa diferente): NÃO é admin", async () => {
  for (const papel of ["customer", null, "Admin", "administrator", ""]) {
    const { buscar } = mundo({ app_metadata: { role: "admin" } }, { role: papel });
    assertEquals(
      await adminAtualDaSessao("Bearer jwt-de-teste", opcoes(buscar)),
      null,
      String(papel),
    );
  }
});

Deno.test("admin atual — a sessão é validada com a chave pública e o Bearer do usuário; o perfil é lido com a chave de serviço, sem o Bearer do usuário", async () => {
  const { buscar, vistos } = mundo({ app_metadata: { role: "admin" } }, { role: "admin" });
  assertEquals(await adminAtualDaSessao("Bearer jwt-de-teste", opcoes(buscar)), UID);
  const auth = vistos.find((v) => v.caminho === "/auth/v1/user");
  const perfil = vistos.find((v) => v.caminho === "/rest/v1/profiles");
  assertEquals(auth?.apikey, "anon-de-teste");
  assertEquals(auth?.authorization, "Bearer jwt-de-teste");
  assertEquals(perfil?.apikey, "service-role-de-teste");
  assertEquals(perfil?.authorization, "Bearer service-role-de-teste");
});
