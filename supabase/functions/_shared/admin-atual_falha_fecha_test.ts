// @ts-nocheck
// A porta de admin das edges de dinheiro e de credencial (`adminAtualDaSessao`:
// estornar-pagamento, cancelar pedido, credenciais-mercado-pago, credenciais-
// email...) FALHA FECHADA: o que o código promete é que qualquer falha — sessão
// recusada, Auth fora, banco de perfis fora, perfil sem linha, EXCEÇÃO dentro da
// conferência — devolve `null` ("não é admin"), nunca um id.
//
// Teste de MUTAÇÃO (24/11/2026): trocar o `return null` do `catch` por um id
// (falha ABRE a porta) não derrubava nenhum dos 183 testes das quatro edges
// que a usam, porque todos injetam respostas bem formadas. Aqui a conferência é
// quebrada de cada jeito que o mundo real quebra, com um CONTROLE (admin de
// verdade passa) para provar que o dublê da rede funciona.
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

const usuarioAdmin = () =>
  json({
    id: UID,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { role: "admin" },
  });
const perfilAdmin = () => json({ role: "admin" });

/** O "mundo": responde ao Auth e ao banco de perfis, e anota cada chamada. */
function mundo(respostas: {
  auth?: () => Response;
  perfil?: () => Response;
}) {
  const chamadas: string[] = [];
  const buscar: typeof fetch = (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    chamadas.push(url.pathname);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve((respostas.auth ?? usuarioAdmin)());
    }
    if (url.pathname === "/rest/v1/profiles") {
      return Promise.resolve((respostas.perfil ?? perfilAdmin)());
    }
    throw new Error(`Rede fora do roteiro bloqueada: ${url.href}`);
  };
  return { buscar, chamadas };
}

function opcoes(buscar: typeof fetch, extra: Record<string, unknown> = {}) {
  return {
    url: URL_SUPA,
    chavePublica: "anon-de-teste",
    chaveDeServico: "service-role-de-teste",
    fetchImpl: buscar,
    rotulo: "[teste-admin]",
    ...extra,
  };
}

/** Roda `corpo` com o `console.error` capturado (o catch loga a falha). */
async function capturandoErros<T>(corpo: () => Promise<T>) {
  const linhas: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => linhas.push(args.map(String).join(" "));
  try {
    return { resultado: await corpo(), linhas };
  } finally {
    console.error = original;
  }
}

Deno.test("admin atual — CONTROLE: admin nas duas fontes passa e devolve o id (o dublê da rede funciona)", async () => {
  const { buscar, chamadas } = mundo({});
  const id = await adminAtualDaSessao("Bearer jwt-de-teste", opcoes(buscar));
  assertEquals(id, UID);
  assertEquals(chamadas.includes("/auth/v1/user"), true);
  assertEquals(chamadas.includes("/rest/v1/profiles"), true);
});

Deno.test("admin atual — Auth fora do ar (500) ou sessão recusada (401): não é admin, e o banco de perfis nem é consultado", async () => {
  for (
    const [rotulo, resposta] of [
      ["Auth 500", () => json({ message: "erro interno" }, 500)],
      ["sessão vencida 401", () => json({ message: "invalid JWT" }, 401)],
      ["resposta sem usuário", () => json({}, 200)],
    ] as const
  ) {
    const { buscar, chamadas } = mundo({ auth: resposta });
    const id = await adminAtualDaSessao("Bearer jwt-de-teste", opcoes(buscar));
    assertEquals(id, null, rotulo);
    assertEquals(chamadas.includes("/rest/v1/profiles"), false, rotulo);
  }
});

Deno.test("admin atual — o Auth diz admin mas o banco de perfis falha ou não tem a linha: não é admin (banco fora nunca vira 'pode')", async () => {
  for (
    const [rotulo, resposta] of [
      ["banco 500", () => json({ message: "db fora" }, 500)],
      [
        "perfil sem linha (single dá 406)",
        () => json({ code: "PGRST116", message: "0 rows" }, 406),
      ],
      ["permissão negada 42501", () => json({ code: "42501", message: "negado" }, 403)],
    ] as const
  ) {
    const { buscar } = mundo({ perfil: resposta });
    const id = await adminAtualDaSessao("Bearer jwt-de-teste", opcoes(buscar));
    assertEquals(id, null, rotulo);
  }
});

Deno.test("admin atual — EXCEÇÃO dentro da conferência (URL do projeto ausente quebra o cliente): devolve null, nunca um id, e o log não leva a chave", async () => {
  const { buscar } = mundo({});
  const { resultado, linhas } = await capturandoErros(() =>
    adminAtualDaSessao("Bearer jwt-de-teste", opcoes(buscar, { url: "" }))
  );
  assertEquals(resultado, null);
  // O log diz de onde veio, e nenhuma das duas chaves aparece nele.
  assertEquals(linhas.some((l) => l.startsWith("[teste-admin] Falha no check de admin")), true);
  for (const linha of linhas) {
    assertEquals(linha.includes("service-role-de-teste"), false);
    assertEquals(linha.includes("anon-de-teste"), false);
  }
});

Deno.test("admin atual — sem Authorization nem sai da máquina: null, e nenhuma chamada ao Auth nem ao banco", async () => {
  for (const vazio of [null, ""] as const) {
    const { buscar, chamadas } = mundo({});
    const id = await adminAtualDaSessao(vazio, opcoes(buscar));
    assertEquals(id, null, String(vazio));
    assertEquals(chamadas, [], String(vazio));
  }
});
