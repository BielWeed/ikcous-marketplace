// Regressão: remover a guarda de comprimento permite cifrar uma assinatura
// incompleta e substituir credenciais que já funcionavam. Nenhuma rede real.
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const URL_SUPA_TESTE = "https://supa-fake.local";
const ID_ADMIN = "admin-chave-curta-fixture";
const PUBLIC_KEY_FALSA = "APP_USR-publica-fixture-teste";
const TOKEN_FALSO = "APP_USR-token-fixture-teste";
const CHAVE_CIFRA_TESTE = btoa(
    String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)),
);

function respostaJson(corpo: unknown): Response {
    return new Response(JSON.stringify(corpo), {
        headers: { "Content-Type": "application/json" },
    });
}

// Mesmo molde de index_test.ts: a porta de admin cria seus próprios clients.
// Só Auth e perfil são atendidos aqui; qualquer outra rede é erro de teste.
const fetchAdminFalso: typeof fetch = (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    assertEquals(url.origin, URL_SUPA_TESTE);
    if (url.pathname === "/auth/v1/user") {
        return Promise.resolve(respostaJson({
            id: ID_ADMIN,
            email: "admin@teste.local",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: { provider: "email", role: "admin" },
        }));
    }
    assertEquals(url.pathname, "/rest/v1/profiles");
    assertEquals(url.searchParams.get("id"), `eq.${ID_ADMIN}`);
    return Promise.resolve(respostaJson({ id: ID_ADMIN, role: "admin" }));
};

const fetchNativo = globalThis.fetch;
globalThis.fetch = fetchAdminFalso;
const { handler } = await (async () => {
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
    const anteriores = pares.map(
        ([nome]) => [nome, Deno.env.get(nome)] as const,
    );
    for (const [nome, valor] of pares) Deno.env.set(nome, valor);
    return () => {
        for (const [nome, anterior] of anteriores) {
            if (anterior === undefined) Deno.env.delete(nome);
            else Deno.env.set(nome, anterior);
        }
    };
}

type Ficha = { pagamento_online: boolean; mp_public_key: string | null };
type LinhaRegistro = { key: string; value: string; updated_at: string };

function supabaseFalso() {
    const estado = {
        valor: null as string | null,
        loja: { pagamento_online: false, mp_public_key: null } as Ficha,
        upserts: [] as LinhaRegistro[],
        updatesLoja: [] as Partial<Ficha>[],
    };
    const appSettings = {
        select(colunas: string) {
            assertEquals(colunas, "value");
            return this;
        },
        eq(coluna: string, valor: unknown) {
            assertEquals([coluna, valor], ["key", "pagamentos_mercado_pago"]);
            return this;
        },
        maybeSingle() {
            return Promise.resolve({
                data: estado.valor === null ? null : { value: estado.valor },
                error: null,
            });
        },
        upsert(linha: LinhaRegistro, opcoes: unknown) {
            assertEquals(linha.key, "pagamentos_mercado_pago");
            assertEquals(opcoes, { onConflict: "key" });
            estado.upserts.push(linha);
            estado.valor = linha.value;
            return Promise.resolve({ error: null });
        },
    };
    const storeConfig = {
        select(colunas: string) {
            assertEquals(colunas, "pagamento_online, mp_public_key");
            return this;
        },
        eq(coluna: string, valor: unknown) {
            assertEquals([coluna, valor], ["id", 1]);
            return this;
        },
        maybeSingle() {
            return Promise.resolve({ data: { ...estado.loja }, error: null });
        },
        update(linha: Partial<Ficha>) {
            estado.updatesLoja.push({ ...linha });
            return {
                eq(coluna: string, valor: unknown) {
                    assertEquals([coluna, valor], ["id", 1]);
                    return {
                        select(colunas: string) {
                            assertEquals(colunas, "id");
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
                if (nome === "app_settings") return appSettings;
                assertEquals(nome, "store_config");
                return storeConfig;
            },
        },
    };
}

async function lojaComCredenciaisAnteriores() {
    const { cliente, estado } = supabaseFalso();
    const chamadasMp: string[] = [];
    const buscar = (url: string, init?: RequestInit): Promise<Response> => {
        chamadasMp.push(url);
        assertEquals(url, "https://api.mercadopago.com/users/me");
        assertEquals(
            new Headers(init?.headers).get("Authorization"),
            `Bearer ${TOKEN_FALSO}`,
        );
        return Promise.resolve(respostaJson({
            id: 123456,
            nickname: "Loja Fixture",
            email: "loja@teste.local",
            tags: ["normal"],
            site_id: "MLB",
        }));
    };
    const chamar = (webhookSecret: string) =>
        handler(new Request("http://local/credenciais-mercado-pago", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer jwt-fixture",
            },
            body: JSON.stringify({
                acao: "salvar",
                public_key: PUBLIC_KEY_FALSA,
                access_token: TOKEN_FALSO,
                webhook_secret: webhookSecret,
            }),
        }), { supabase: cliente, buscar });

    // Semeia pelo handler real: cifra e ficha válidas, não ciphertext inventado.
    const anterior = await chamar("notificacoes-anteriores-fixture");
    assertEquals(anterior.status, 200);
    assertEquals((await anterior.json()).pix_ligado, true);
    assertEquals(chamadasMp.length, 1);
    assertEquals(estado.upserts.length, 1);
    assertEquals(estado.updatesLoja.length, 1);
    const registroAnterior = estado.valor;
    const fichaAnterior = { ...estado.loja };
    chamadasMp.length = 0;
    estado.upserts.length = 0;
    estado.updatesLoja.length = 0;
    return { chamar, estado, chamadasMp, registroAnterior, fichaAnterior };
}

Deno.test("salvar chave de notificações curta preserva as credenciais da loja", async (t) => {
    const desfazerEnv = prepararEnv();
    const fetchAnterior = globalThis.fetch;
    globalThis.fetch = fetchAdminFalso;
    try {
        for (const chaveCurta of ["abc", "1234567"]) {
            await t.step(`${chaveCurta.length} caracteres: 400 sem consultar MP nem gravar`, async () => {
                const {
                    chamar, estado, chamadasMp, registroAnterior, fichaAnterior,
                } = await lojaComCredenciaisAnteriores();

                const resposta = await chamar(chaveCurta);
                const corpo = await resposta.json();
                // Verifica todos os efeitos ANTES do status: remover a guarda
                // denuncia a consulta indevida, não só uma resposta diferente.
                assertEquals(chamadasMp, [], "chave curta não pode consultar o Mercado Pago");
                assertEquals(estado.upserts, [], "chave curta não pode gravar o registro");
                assertEquals(estado.updatesLoja, [], "chave curta não pode gravar a ficha");
                assertEquals(estado.valor, registroAnterior);
                assertEquals(estado.loja, fichaAnterior);
                assertEquals(resposta.status, 400);
                assertEquals(corpo, {
                    erro: "A chave de notificações parece curta demais. Confira se copiou inteira.",
                });
            });
        }

        await t.step("exatamente 8 caracteres passam da guarda e são salvos", async () => {
            const {
                chamar, estado, chamadasMp, registroAnterior, fichaAnterior,
            } = await lojaComCredenciaisAnteriores();

            const resposta = await chamar("12345678");
            const corpo = await resposta.json();
            assertEquals(resposta.status, 200);
            assertEquals(corpo.ultimo_teste.conectado, true);
            assertEquals(chamadasMp, ["https://api.mercadopago.com/users/me"]);
            assertEquals(estado.upserts.length, 1);
            assertEquals(estado.updatesLoja.length, 1);
            assertNotEquals(estado.valor, registroAnterior);
            assertEquals(estado.loja, fichaAnterior);
        });
    } finally {
        globalThis.fetch = fetchAnterior;
        desfazerEnv();
    }
});
