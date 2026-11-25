// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `credenciais-mp.ts` — o módulo que decide
 * COM QUAL conta o Mercado Pago cobra (a do lojista ou a da plataforma) e que
 * guarda o cofre das chaves. 12 mutantes sobreviviam; os que mudam o
 * comportamento viram os casos abaixo:
 *
 *   * a chave do cofre NÃO é extraível (`extractable: false`): se fosse, o
 *     JavaScript do próprio isolado poderia exportar a chave de cifra;
 *   * o papel da chave do client: `sb_secret_` é service_role; qualquer forma
 *     que NÃO dá para ler devolve `null` (e não `undefined`) — porque o
 *     resolvedor só segue em frente com `null`; `undefined` FECHARIA a cobrança
 *     de uma loja com dublê de chave desconhecida, e um valor não-texto jamais
 *     pode lançar;
 *   * JWT só vale com 3 partes (2 ou 4 partes com payload de service_role NÃO
 *     afirmam papel nenhum);
 *   * registro ausente é `null`, não `undefined`;
 *   * cofre ausente ainda devolve a chave PÚBLICA do lojista (não é segredo, e
 *     a tela precisa dela), e sem token no ambiente o erro é registrado.
 *
 * Fixtures inventadas; a chave do cofre é gerada na hora e nunca impressa.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  chaveDeCifra,
  lerRegistroMp,
  papelDaChaveDoClient,
  resolverCredenciaisMp,
} from "./credenciais-mp.ts";

function envCom(valores: Record<string, string>) {
  const mapa = new Map(Object.entries(valores));
  return { get: (chave: string) => mapa.get(chave) };
}

function cofreDeTeste(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

function base64Url(texto: string): string {
  return btoa(texto).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const jwtComPapel = (papel: string) =>
  `${base64Url('{"alg":"HS256"}')}.${base64Url(JSON.stringify({ role: papel }))}.assinatura-de-teste`;

async function silenciando<T>(f: () => Promise<T>): Promise<{ resultado: T; erros: string[] }> {
  const erros: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void erros.push(a.map(String).join(" "));
  try {
    return { resultado: await f(), erros };
  } finally {
    console.error = original;
  }
}

Deno.test("cofre: a chave de cifra NÃO é extraível (nem o código do isolado a exporta)", async () => {
  const chave = await chaveDeCifra(envCom({ MP_CHAVES_ENCRYPTION_KEY: cofreDeTeste() }));
  assertEquals(chave !== null, true);
  assertEquals(chave.extractable, false);
});

Deno.test("papel da chave do client: sb_secret_ é service_role, sb_publishable_ é publishable", () => {
  assertEquals(papelDaChaveDoClient({ supabaseKey: "sb_secret_abc123" }), "service_role");
  assertEquals(papelDaChaveDoClient({ supabaseKey: "sb_publishable_abc123" }), "publishable");
});

Deno.test("papel da chave do client: JWT legado devolve a claim role; ilegível devolve null (nunca undefined)", () => {
  assertEquals(papelDaChaveDoClient({ supabaseKey: jwtComPapel("service_role") }), "service_role");
  assertEquals(papelDaChaveDoClient({ supabaseKey: jwtComPapel("anon") }), "anon");
  const ilegivel = `${base64Url("{}")}.@@@não-é-base64@@@.x`;
  assertEquals(papelDaChaveDoClient({ supabaseKey: ilegivel }), null);
  assertEquals(papelDaChaveDoClient({ supabaseKey: `${base64Url("{}")}.${base64Url('{"sem":"papel"}')}.x` }), null);
});

Deno.test("papel da chave do client: chave curta, vazia, sem chave ou NÃO-texto devolve null e não lança", () => {
  for (const chave of ["chave-curta", "", undefined, null, 123, {}, ["a", "b", "c"]]) {
    assertEquals(papelDaChaveDoClient({ supabaseKey: chave }), null, JSON.stringify(chave));
  }
  assertEquals(papelDaChaveDoClient(null), null);
  assertEquals(papelDaChaveDoClient(undefined), null);
});

Deno.test("papel da chave do client: um JWT só vale com EXATAMENTE 3 partes (2 ou 4 partes com payload de service_role não afirmam papel)", () => {
  const payload = base64Url(JSON.stringify({ role: "service_role" }));
  assertEquals(papelDaChaveDoClient({ supabaseKey: `cabecalho.${payload}` }), null, "2 partes");
  assertEquals(papelDaChaveDoClient({ supabaseKey: `cabecalho.${payload}.assinatura.extra` }), null, "4 partes");
});

Deno.test("resolver: client com chave de formato DESCONHECIDO (dublê) segue para o ambiente, não fecha; chave de papel errado fecha", async () => {
  const semRegistro = {
    supabaseKey: "chave-de-formato-desconhecido",
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  const { resultado } = await silenciando(() =>
    resolverCredenciaisMp(semRegistro, envCom({ MP_ACCESS_TOKEN: "TOKEN-DE-TESTE" }))
  );
  assertEquals(resultado.origem, "ambiente");
  assertEquals(resultado.token, "TOKEN-DE-TESTE");

  const anon = { ...semRegistro, supabaseKey: jwtComPapel("anon") };
  const { resultado: fechado } = await silenciando(() =>
    resolverCredenciaisMp(anon, envCom({ MP_ACCESS_TOKEN: "TOKEN-DE-TESTE" }))
  );
  assertEquals(fechado.origem, "indisponivel");
  assertEquals(fechado.motivo, "client_sem_service_role");
});

Deno.test("lerRegistroMp: sem linha, ou linha sem valor, devolve null (não undefined)", async () => {
  const banco = (data: unknown) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) }),
  });
  assertEquals(await lerRegistroMp(banco(null)), null);
  assertEquals(await lerRegistroMp(banco({ value: null })), null);
  assertEquals(await lerRegistroMp(banco({ value: "" })), null);
});

Deno.test("resolver: lojista com registro mas SEM cofre no ambiente fecha com cofre_ausente e ainda devolve a chave PÚBLICA dele", async () => {
  const registro = { token_cifrado: "x", token_iv: "y", public_key: "APP_USR-chave-publica-de-teste" };
  const banco = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: JSON.stringify(registro) }, error: null }) }) }),
    }),
  };
  const { resultado } = await silenciando(() => resolverCredenciaisMp(banco, envCom({})));
  assertEquals(resultado.origem, "indisponivel");
  assertEquals(resultado.motivo, "cofre_ausente");
  assertEquals(resultado.token, null);
  assertEquals(resultado.publicKey, "APP_USR-chave-publica-de-teste");
});

Deno.test("resolver: sem registro e sem MP_ACCESS_TOKEN registra o erro uma vez; com o token, fica em silêncio", async () => {
  const banco = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  const sem = await silenciando(() => resolverCredenciaisMp(banco, envCom({})));
  assertEquals(sem.resultado.token, null);
  assertEquals(sem.resultado.motivo, "ambiente_sem_token");
  assertEquals(sem.erros.length, 1);
  assertEquals(sem.erros[0].includes("ambiente_sem_token"), true);

  const com = await silenciando(() => resolverCredenciaisMp(banco, envCom({ MP_ACCESS_TOKEN: "TOKEN-DE-TESTE" })));
  assertEquals(com.resultado.token, "TOKEN-DE-TESTE");
  assertEquals(com.erros, []);
});
