// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `credenciais-mercado-pago/index.ts` — as
 * chaves do Mercado Pago da loja (dinheiro). Depois de `index_test.ts`, ainda
 * sobreviviam defeitos de UMA linha:
 *
 *   * `classificarAmbienteDaConta`: o prefixo `TEST-` vale só no INÍCIO do
 *     token (um token de produção que contém `TEST-` no meio é produção); o
 *     apelido `TESTUSER<dígitos>` precisa casar por inteiro (`TESTUSER` sem
 *     dígito, com letra antes ou depois NÃO é conta de teste e a conta com
 *     tags normais continua sendo de produção);
 *   * `salvar`: a chave colada com espaço ou quebra de linha (o clipboard faz
 *     isso) é aparada antes de comparar com o token, validar o formato,
 *     cifrar e gravar na ficha pública; a chave de notificações com espaços é
 *     medida SEM os espaços (7 caracteres + espaços continuam curtos demais);
 *   * `faltasParaReceber`: a chave pública com espaço nas pontas não conta
 *     como falta (a mesma regra do `salvar`).
 *
 * Sem rede, sem banco, sem segredo: tudo com valores inventados.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const URL_SUPA_TESTE = "https://supa-fake.local";
const ID_ADMIN = "admin-limites-fixture";
const PUBLIC_KEY_FALSA = "APP_USR-11111111-1111-4111-8111-111111111111";
const TOKEN_FALSO = "APP_USR-token-fixture-teste";
const CHAVE_CIFRA_TESTE = btoa(
    String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)),
);

function respostaJson(corpo: unknown): Response {
    return new Response(JSON.stringify(corpo), {
        headers: { "Content-Type": "application/json" },
    });
}

// Mesmo molde de `index_chave_de_notificacoes_curta_test.ts`: a porta de admin
// cria seus próprios clients; só Auth e perfil são atendidos aqui.
const fetchAdminFalso: typeof fetch = (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    assertEquals(url.origin, URL_SUPA_TESTE);
    if (url.pathname === "/auth/v1/user") {
        return Promise.resolve(respostaJson({
            id: ID_ADMIN,
            email: "admin@fixture.invalid",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: { provider: "email", role: "admin" },
        }));
    }
    assertEquals(url.pathname, "/rest/v1/profiles");
    return Promise.resolve(respostaJson({ id: ID_ADMIN, role: "admin" }));
};

const fetchNativo = globalThis.fetch;
globalThis.fetch = fetchAdminFalso;
const { handler, classificarAmbienteDaConta, faltasParaReceber } = await (async () => {
    try {
        return await import("./index.ts");
    } finally {
        globalThis.fetch = fetchNativo;
    }
})();

function prepararEnv(): () => void {
    const pares: Array<[string, string]> = [
        ["SUPABASE_URL", URL_SUPA_TESTE],
        ["SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-fixture" })],
        ["SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-fixture" })],
        ["MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE],
        ["MP_SANDBOX_PAYER_EMAIL", ""],
    ];
    const anteriores = pares.map(([nome]) => [nome, Deno.env.get(nome)] as const);
    for (const [nome, valor] of pares) Deno.env.set(nome, valor);
    return () => {
        for (const [nome, anterior] of anteriores) {
            if (anterior === undefined) Deno.env.delete(nome);
            else Deno.env.set(nome, anterior);
        }
    };
}

function supabaseFalso() {
    const estado = {
        valor: null as string | null,
        loja: { pagamento_online: false, mp_public_key: null } as Record<string, unknown>,
        upserts: [] as unknown[],
        updatesLoja: [] as unknown[],
    };
    const appSettings = {
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
            return Promise.resolve({
                data: estado.valor === null ? null : { value: estado.valor },
                error: null,
            });
        },
        upsert(linha: { value: string }) {
            estado.upserts.push(linha);
            estado.valor = linha.value;
            return Promise.resolve({ error: null });
        },
    };
    const storeConfig = {
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
            return Promise.resolve({ data: { ...estado.loja }, error: null });
        },
        update(linha: Record<string, unknown>) {
            estado.updatesLoja.push({ ...linha });
            return {
                eq() {
                    return {
                        select() {
                            Object.assign(estado.loja, linha);
                            return Promise.resolve({ data: [{ id: 1 }], error: null });
                        },
                    };
                },
            };
        },
    };
    return {
        estado,
        cliente: {
            from(nome: string) {
                return nome === "app_settings" ? appSettings : storeConfig;
            },
        },
    };
}

function salvarCom(corpo: Record<string, unknown>) {
    const { cliente, estado } = supabaseFalso();
    const chamadasMp: Array<{ url: string; autorizacao: string | null }> = [];
    const buscar = (url: string, init?: RequestInit): Promise<Response> => {
        chamadasMp.push({ url, autorizacao: new Headers(init?.headers).get("Authorization") });
        return Promise.resolve(respostaJson({
            id: 123456,
            nickname: "Loja Fixture",
            email: "loja@fixture.invalid",
            tags: ["normal"],
            site_id: "MLB",
        }));
    };
    const chamar = () =>
        handler(
            new Request("http://local/credenciais-mercado-pago", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-fixture" },
                body: JSON.stringify({ acao: "salvar", ...corpo }),
            }),
            { supabase: cliente, buscar, donoAtual: async () => ID_ADMIN },
        );
    return { chamar, estado, chamadasMp };
}

async function comAmbiente(fn: () => Promise<void>) {
    const desfazerEnv = prepararEnv();
    const fetchAnterior = globalThis.fetch;
    globalThis.fetch = fetchAdminFalso;
    try {
        await fn();
    } finally {
        globalThis.fetch = fetchAnterior;
        desfazerEnv();
    }
}

// ── ambiente da conta ─────────────────────────────────────────────────

Deno.test("classificarAmbienteDaConta - TEST- só vale no INÍCIO do token; no meio é produção", () => {
    const real = { tags: ["normal"], nickname: "Loja Real", email: "dono@fixture.invalid" };
    assertEquals(classificarAmbienteDaConta(real, "APP_USR-123-TEST-456"), "producao");
    assertEquals(classificarAmbienteDaConta(real, "xTEST-123"), "producao");
    assertEquals(classificarAmbienteDaConta(real, "TEST-123"), "teste");
    // sem tags e sem marca, o token com TEST- no meio continua sem sinal positivo
    assertEquals(classificarAmbienteDaConta({ nickname: "Loja Real" }, "APP_USR-123-TEST-456"), null);
})

Deno.test("classificarAmbienteDaConta - apelido TESTUSER<dígitos> casa por inteiro: sem dígito, com letra antes ou depois não é conta de teste", () => {
    const APP = "APP_USR-token-falso-de-teste-9999";
    // tags normais + apelido que NÃO é de teste = produção
    for (const apelido of ["testuser", "TESTUSER", "xTESTUSER123", "TESTUSER123x", "meu TESTUSER123", "TESTUSER 123"]) {
        assertEquals(
            classificarAmbienteDaConta({ tags: ["normal"], nickname: apelido, email: "a@fixture.invalid" }, APP),
            "producao",
            apelido,
        );
    }
    // com apelido de teste e tags normais: não prova produção (nem teste) = null
    for (const apelido of ["TESTUSER1", "testuser99", "TESTUSER123456"]) {
        assertEquals(
            classificarAmbienteDaConta({ tags: ["normal"], nickname: apelido, email: "a@fixture.invalid" }, APP),
            null,
            apelido,
        );
    }
})

// ── faltasParaReceber ──────────────────────────────────────────────────

Deno.test("faltasParaReceber - chave pública com espaço ou quebra de linha nas pontas NÃO é falta; chave com texto no meio é", () => {
    const base = {
        token_cifrado: "c",
        token_iv: "i",
        webhook_cifrado: "w",
        webhook_iv: "v",
        ultimo_teste: { quando: "x", conectado: true, mensagem: "ok", ambiente: null, conta: null },
    };
    assertEquals(faltasParaReceber({ ...base, public_key: PUBLIC_KEY_FALSA }), []);
    assertEquals(faltasParaReceber({ ...base, public_key: `  ${PUBLIC_KEY_FALSA}\n` }), []);
    assertEquals(faltasParaReceber({ ...base, public_key: `${PUBLIC_KEY_FALSA} x` }), ["public_key"]);
    assertEquals(faltasParaReceber({ ...base, public_key: `APP_USR-1111 1111-1111-4111-8111-111111111111` }), ["public_key"]);
})

Deno.test("faltasParaReceber - `conectado` só conta quando é o booleano true (texto 'true' e número 1 são falta)", () => {
    const base = {
        public_key: PUBLIC_KEY_FALSA,
        token_cifrado: "c",
        token_iv: "i",
        webhook_cifrado: "w",
        webhook_iv: "v",
    };
    for (const conectado of ["true", 1, "sim", null, undefined, 0, false]) {
        assertEquals(
            faltasParaReceber({ ...base, ultimo_teste: { conectado, ambiente: null } }),
            ["teste"],
            String(conectado),
        );
    }
    assertEquals(faltasParaReceber({ ...base, ultimo_teste: { conectado: true, ambiente: null } }), []);
})

// ── salvar com chave colada com espaço ───────────────────────────────────────

Deno.test("salvar - chave pública, token e chave de notificações coladas com espaço e quebra de linha são aparados antes de testar, cifrar e gravar na ficha", async () => {
    await comAmbiente(async () => {
        const { chamar, estado, chamadasMp } = salvarCom({
            public_key: `  ${PUBLIC_KEY_FALSA}\n`,
            access_token: `\t${TOKEN_FALSO}  `,
            webhook_secret: "  chave-de-notificacoes-fixture \n",
        });
        const resposta = await chamar();
        const corpo = await resposta.json();
        assertEquals(resposta.status, 200);
        assertEquals(corpo.public_key, PUBLIC_KEY_FALSA);
        // o Mercado Pago recebeu o token SEM os espaços
        assertEquals(chamadasMp, [{ url: "https://api.mercadopago.com/users/me", autorizacao: `Bearer ${TOKEN_FALSO}` }]);
        // a chave pública que dorme no banco e a da ficha pública estão aparadas
        assertEquals(JSON.parse(estado.valor!).public_key, PUBLIC_KEY_FALSA);
        assertEquals(estado.loja.mp_public_key, PUBLIC_KEY_FALSA);
        assertEquals(estado.loja.pagamento_online, true);
    });
});

Deno.test("salvar - chave pública igual ao token (um dos dois com espaço colado) é recusada sem consultar o Mercado Pago nem gravar", async () => {
    await comAmbiente(async () => {
        for (const corpo of [
            { public_key: `${TOKEN_FALSO}  `, access_token: TOKEN_FALSO },
            { public_key: TOKEN_FALSO, access_token: `\n${TOKEN_FALSO}` },
        ]) {
            const { chamar, estado, chamadasMp } = salvarCom(corpo);
            const resposta = await chamar();
            assertEquals(resposta.status, 400);
            assertEquals((await resposta.json()).erro, "A chave pública não pode ser o token secreto. Confira os campos.");
            assertEquals(chamadasMp, []);
            assertEquals(estado.upserts, []);
            assertEquals(estado.updatesLoja, []);
        }
    });
});

Deno.test("salvar - chave de notificações é medida SEM os espaços: 7 caracteres com espaço em volta continua curta demais", async () => {
    await comAmbiente(async () => {
        const { chamar, estado, chamadasMp } = salvarCom({
            public_key: PUBLIC_KEY_FALSA,
            access_token: TOKEN_FALSO,
            webhook_secret: "   abcdefg   ",
        });
        const resposta = await chamar();
        assertEquals(resposta.status, 400);
        assertEquals((await resposta.json()).erro, "A chave de notificações parece curta demais. Confira se copiou inteira.");
        assertEquals(chamadasMp, []);
        assertEquals(estado.upserts, []);
    });
});

Deno.test("salvar - chave pública só de espaços é 'cole a chave'; token com texto antes do APP_USR- é recusado", async () => {
    await comAmbiente(async () => {
        const vazia = salvarCom({ public_key: "   \n ", access_token: TOKEN_FALSO });
        const r1 = await vazia.chamar();
        assertEquals(r1.status, 400);
        assertEquals((await r1.json()).erro, "Cole a Public Key do Mercado Pago.");
        assertEquals(vazia.estado.upserts, []);

        const tokenRuim = salvarCom({ public_key: PUBLIC_KEY_FALSA, access_token: `chave: ${TOKEN_FALSO}` });
        const r2 = await tokenRuim.chamar();
        assertEquals(r2.status, 400);
        assertEquals(tokenRuim.chamadasMp, []);
        assertEquals(tokenRuim.estado.upserts, []);
    });
});
