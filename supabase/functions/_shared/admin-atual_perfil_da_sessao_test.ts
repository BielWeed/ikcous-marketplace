import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const URL_SUPA = "https://supa-fake.local";
const PESSOA_A = "11111111-1111-4111-8111-111111111111";
const PESSOA_B = "22222222-2222-4222-8222-222222222222";
const REFUND_ID = "33333333-3333-4333-8333-333333333333";

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** O Auth é A; o banco tem B admin ANTES de A. Sem filtro, single dá 406. */
async function comPerfis(
  papelDeA: string,
  verificar: (cenario: {
    buscar: typeof fetch;
    filtros: string[][];
    externas: string[];
  }) => Promise<void>,
) {
  const perfis = [
    { id: PESSOA_B, role: "admin" },
    { id: PESSOA_A, role: papelDeA },
  ];
  const filtros: string[][] = [];
  const externas: string[] = [];
  const buscar: typeof fetch = (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === URL_SUPA && url.pathname === "/auth/v1/user") {
      return Promise.resolve(resposta({
        id: PESSOA_A,
        email: "pessoa-a@teste.local",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "email", role: "admin" },
      }));
    }
    if (url.origin === URL_SUPA && url.pathname === "/rest/v1/profiles") {
      const recebidos = [...url.searchParams].filter(([coluna]) =>
        coluna !== "select"
      );
      filtros.push(...recebidos);
      const selecionados = perfis.filter((perfil) =>
        recebidos.every(([coluna, filtro]) =>
          filtro.startsWith("eq.") &&
          new Map(Object.entries(perfil)).get(coluna) === filtro.slice(3)
        )
      );
      return Promise.resolve(
        selecionados.length === 1 ? resposta(selecionados[0]) : resposta(
          { code: "PGRST116", message: "Esperada uma única linha" },
          406,
        ),
      );
    }
    externas.push(url.href);
    throw new Error("Rede fora do roteiro bloqueada");
  };
  const ambiente = new Map([
    ["SUPABASE_URL", URL_SUPA],
    ["SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" })],
    [
      "SUPABASE_SECRET_KEYS",
      JSON.stringify({ default: "service-role-de-teste" }),
    ],
  ]);
  const anteriores = new Map(
    [...ambiente.keys()].map((chave) => [chave, Deno.env.get(chave)]),
  );
  const fetchAnterior = globalThis.fetch;
  const chaveStorage = "sb-supa-fake-auth-token";
  const storageAnterior = localStorage.getItem(chaveStorage);
  try {
    for (const [chave, valor] of ambiente) Deno.env.set(chave, valor);
    localStorage.setItem(
      chaveStorage,
      JSON.stringify({
        access_token: "jwt-de-teste",
        refresh_token: "refresh-de-teste",
        token_type: "bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: PESSOA_A, aud: "authenticated", role: "authenticated" },
      }),
    );
    globalThis.fetch = buscar;
    await verificar({ buscar, filtros, externas });
  } finally {
    globalThis.fetch = fetchAnterior;
    for (const [chave, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(chave);
      else Deno.env.set(chave, valor);
    }
    if (storageAnterior === null) localStorage.removeItem(chaveStorage);
    else localStorage.setItem(chaveStorage, storageAnterior);
  }
}

Deno.test("admin atual: B admin não autoriza a sessão A cujo perfil é customer", async () => {
  await comPerfis("customer", async ({ buscar, filtros, externas }) => {
    const { adminAtualDaSessao } = await import("./admin-atual.ts");
    const admin = await adminAtualDaSessao("Bearer jwt-de-teste", {
      url: URL_SUPA,
      chavePublica: "anon-de-teste",
      chaveDeServico: "service-role-de-teste",
      fetchImpl: buscar,
    });
    assertEquals(admin, null);
    assertEquals(filtros, [["id", `eq.${PESSOA_A}`]]);
    assertEquals(externas, []);
  });
});

Deno.test("admin atual: perfil admin da própria sessão A autoriza A, não B", async () => {
  await comPerfis("admin", async ({ buscar, filtros, externas }) => {
    const { adminAtualDaSessao } = await import("./admin-atual.ts");
    const admin = await adminAtualDaSessao("Bearer jwt-de-teste", {
      url: URL_SUPA,
      chavePublica: "anon-de-teste",
      chaveDeServico: "service-role-de-teste",
      fetchImpl: buscar,
    });
    assertEquals(admin, PESSOA_A);
    assertEquals(filtros, [["id", `eq.${PESSOA_A}`]]);
    assertEquals(externas, []);
  });
});

Deno.test("estornar: perfil admin de B não abre leitura, escrita, RPC nem executor para A", async () => {
  await comPerfis("customer", async ({ filtros, externas }) => {
    const { handler } = await import("../estornar-pagamento/index.ts");
    const acessos: string[] = [];
    let execucoes = 0;
    const supabase = {
      from(tabela: string) {
        acessos.push(`from:${tabela}`);
        throw new Error(
          "Sessão sem permissão não pode alcançar o banco de estornos",
        );
      },
      rpc(nome: string) {
        acessos.push(`rpc:${nome}`);
        throw new Error("Sessão sem permissão não pode gravar por RPC");
      },
    };
    const resultado = await handler(
      new Request("https://edge.test/estornar-pagamento", {
        method: "POST",
        headers: {
          Authorization: "Bearer jwt-de-teste",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refund_id: REFUND_ID }),
      }),
      {
        supabase,
        buscar: globalThis.fetch,
        executarEstorno: () => {
          execucoes++;
          throw new Error("Sessão sem permissão não pode executar estorno");
        },
      },
    );
    assertEquals(resultado.status, 401);
    assertEquals(acessos, []);
    assertEquals(execucoes, 0);
    assertEquals(externas, []);
    assertEquals(filtros, [["id", `eq.${PESSOA_A}`]]);
  });
});
