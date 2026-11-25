// @ts-nocheck
// Caça por mutação (24/11/2026) em `admin-atual.ts` (a porta de admin das edges
// de dinheiro e de credencial). Sobrevivia a guarda `erroPerfil || !perfil`: um
// perfil que o banco responde SEM erro e SEM linha (corpo `null`) tem de fechar
// a porta em silêncio ("não é admin"), pela guarda — e não cair numa exceção
// por acidente (`perfil.role` de `null`), que também devolve `null`, mas pelo
// caminho de FALHA, com um erro registrado no log como se a conferência tivesse
// quebrado. A diferença é o que o operador lê no log: perfil ausente não é
// incidente.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { adminAtualDaSessao } from "./admin-atual.ts";

const URL_SUPA = "https://supa-fake.local";
const UID = "11111111-1111-4111-8111-111111111111";

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

function mundo(perfil: () => Response) {
  const buscar: typeof fetch = (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        json({ id: UID, aud: "authenticated", role: "authenticated", app_metadata: { role: "admin" } }),
      );
    }
    if (url.pathname === "/rest/v1/profiles") return Promise.resolve(perfil());
    throw new Error(`Rede fora do roteiro bloqueada: ${url.href}`);
  };
  return buscar;
}

async function chamar(perfil: () => Response) {
  const linhas: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void linhas.push(a.map(String).join(" "));
  try {
    const resultado = await adminAtualDaSessao("Bearer jwt-de-teste", {
      url: URL_SUPA,
      chavePublica: "anon-de-teste",
      chaveDeServico: "service-role-de-teste",
      fetchImpl: mundo(perfil),
      rotulo: "[teste-admin]",
    });
    return { resultado, linhas };
  } finally {
    console.error = original;
  }
}

Deno.test("admin atual: controle — perfil admin + app_metadata admin devolve o id, sem nada no log", async () => {
  const r = await chamar(() => json({ role: "admin" }));
  assertEquals(r.resultado, UID);
  assertEquals(r.linhas, []);
});

Deno.test("admin atual: perfil SEM linha e SEM erro (corpo null) fecha a porta pela guarda — null, e nada de 'Falha no check' no log", async () => {
  const r = await chamar(() => json(null));
  assertEquals(r.resultado, null);
  assertEquals(r.linhas, []);
});

Deno.test("admin atual: perfil que não é admin fecha a porta, sem erro no log", async () => {
  for (const perfil of [{ role: "customer" }, { role: null }, {}]) {
    const r = await chamar(() => json(perfil));
    assertEquals(r.resultado, null, JSON.stringify(perfil));
    assertEquals(r.linhas, [], JSON.stringify(perfil));
  }
});
