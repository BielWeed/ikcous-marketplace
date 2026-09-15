// @ts-nocheck
// Testes da edge credenciais-mercado-pago — peça 20 (14/09/2026). Padrão da
// casa (estornar-pagamento/calculate-shipping): handler exportado com costura
// de deps, NENHUMA rede real — a chamada ao MP é DUBLÊ aqui (a Restrição
// Global veda chamada real ao MP em teste; as chaves dos testes são FALSAS de
// mentira, legíveis — nunca uma chave real de ninguém).
//
// Afirmativas nomeadas:
//   C1  sem JWT -> 401
//   C2  JWT de cliente comum -> 401 (e NADA foi gravado)
//   C3  acao desconhecida -> 400
//   C4  salvar (primeira vez) -> 200; o que dorme em app_settings NÃO contém
//       o token em claro (cifrou); a resposta traz só MÁSCARA, nunca o token
//   C5  salvar sem env de cifra (MP_CHAVES_ENCRYPTION_KEY) -> 503 falha
//       FECHADA, nada gravado em claro
//   C6  testar com fluxo feliz -> o fetch do MP recebeu Bearer com o token
//       DECIFRADO (igual ao original); resposta { conectado: true, ambiente
//       "producao" } e último teste gravado; resposta NÃO contém o token
//   C7  testar com 401 do MP -> conectado false com recado amigável, e o
//       token NÃO aparece em nenhuma parte da resposta
//   C8  ler -> máscaras presentes, token/ciphertext ausentes da resposta
//   C9  salvar de novo SEM token (só Public Key) -> mantém o token antigo:
//       o teste seguinte ainda conecta com o MESMO token decifrado
//   C10 testar sem token salvo -> 409 com recado
//   C11 salvar com Access Token malformado -> 400, nada gravado
//   C12 trocar o token derruba o ultimo_teste antigo (ele falava da chave
//       anterior — recado velho com cara de novo é pior que nenhum)
//   C13 peça 27: testar SEM dublê injetado (o caminho que produção corre,
//       fetch global patcheado) CONECTA — reproduz o defeito em que o default
//       de `buscar` era o fetchComTempo cru (assinatura (fetchFn, url, init)),
//       chamado como (url, init): a URL virava "função" e todo testar caía no
//       catch de rede, mesmo com chave boa e internet boa
//   C14 rede caiu DE VERDADE no caminho de produção (fetch global rejeita) ->
//       recado de internet honesto, distinto do recado de chave recusada (C7),
//       e a falha fica gravada no ultimo_teste
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

// ── Costura de REDE para a porta de admin (verifyIsAdmin monta os PRÓPRIOS
// clients do supabase-js — a costura deps não os cobre). Mesma estratégia do
// estornar-pagamento: patch de globalThis.fetch ANTES do import dinâmico (o
// supabase-js captura a referência de fetch no carregamento) e reinstala o
// patch SÓ durante cada chamada de handler que passa pela porta.
const fetchNativo = globalThis.fetch;

const URL_SUPA_TESTE = "https://supa-fake.local";
const ID_ADMIN = "admin-1111-2222";
const ID_CLIENTE = "cliente-3333-4444";

// Chave de cifra dos testes: 32 bytes determinísticos em base64 — chave de
// MENTIRA, só para o AES rodar de verdade dentro do teste.
const CHAVE_CIFRA_TESTE = btoa(
    String.fromCharCode(
        ...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256),
    ),
);

// Chaves FALSAS de mentira (legíveis de propósito — nada de chave real).
const PUBLIC_KEY_FALSA = "APP_USR-publica-falsa-de-teste";
const TOKEN_FALSO = "APP_USR-token-falso-de-teste-9999";
const TOKEN_FALSO_2 = "APP_USR-token-falso-de-teste-trocado-8888";
const WEBHOOK_FALSO = "segredo-falso-de-webhook-7777";

function respostaAdminFalsa(): Response {
    return new Response(
        JSON.stringify({
            id: ID_ADMIN,
            email: "admin@teste.local",
            aud: "authenticated",
            role: "authenticated",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
    );
}

const fetchAdminFalso = ((input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/v1/user")) return respostaAdminFalsa();
    if (url.includes("/rest/v1/profiles")) {
        return new Response(
            JSON.stringify({ id: ID_ADMIN, role: "admin" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }
    return new Response(JSON.stringify({ message: "fora do roteiro" }), {
        status: 404,
    });
}) as any;

const fetchClienteFalso = ((input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/v1/user")) {
        return new Response(
            JSON.stringify({
                id: ID_CLIENTE,
                email: "cliente@teste.local",
                aud: "authenticated",
                role: "authenticated",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }
    if (url.includes("/rest/v1/profiles")) {
        return new Response(
            JSON.stringify({ id: ID_CLIENTE, role: "customer" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }
    return new Response(JSON.stringify({ message: "fora do roteiro" }), {
        status: 404,
    });
}) as any;

globalThis.fetch = fetchAdminFalso;
const { handler } = await import("./index.ts");
globalThis.fetch = fetchNativo;

async function comFetch(
    fetchFalso: any,
    executar: () => Promise<any>,
): Promise<any> {
    const anterior = globalThis.fetch;
    globalThis.fetch = fetchFalso;
    try {
        return await executar();
    } finally {
        globalThis.fetch = anterior;
    }
}

/** Env que a porta de admin precisa ANTES de qualquer client. */
function prepararEnv(extra: Record<string, string> = {}): () => void {
    const pares: Array<[string, string]> = [
        ["SUPABASE_URL", URL_SUPA_TESTE],
        ["SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" })],
        ["SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" })],
        ["MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE],
        ...Object.entries(extra),
    ];
    // Pares (nome, valor antigo) de uma vez — sem acesso indexado
    // (`anteriores[i]`), que a catraca de segurança do eslint acusa.
    const anteriores = pares.map(
        ([chave]) => [chave, Deno.env.get(chave)] as const,
    );
    for (const [chave, valor] of pares) Deno.env.set(chave, valor);
    return () => {
        for (const [chave, anterior] of anteriores) {
            if (anterior === undefined) Deno.env.delete(chave);
            else Deno.env.set(chave, anterior);
        }
    };
}

/** Dublê do client de app_settings: guarda o valor e expira o que gravou. */
function supabaseFalso() {
    const estado = { valor: null as string | null, upserts: [] as any[] };
    const tabela = {
        select() {
            return this;
        },
        eq() {
            return this;
        },
        maybeSingle() {
            return Promise.resolve({
                data: estado.valor ? { value: estado.valor } : null,
                error: null,
            });
        },
        upsert(linha: any) {
            estado.upserts.push(linha);
            estado.valor = linha.value;
            return Promise.resolve({ error: null });
        },
    };
    return { cliente: { from: () => tabela }, estado };
}

function requisicao(corpo: unknown): Request {
    return new Request("http://local/credenciais-mercado-pago", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer jwt-de-teste",
        },
        body: JSON.stringify(corpo),
    });
}

/** Chamada do MP DUBLÊ que anota o header que recebeu. */
function buscarMpFalso(status: number, corpo: unknown) {
    const anotacoes: Array<{ url: string; bearer: string }> = [];
    const buscar = (async (url: any, init?: RequestInit) => {
        anotacoes.push({
            url: String(url),
            bearer: new Headers(init?.headers).get("Authorization") ?? "",
        });
        return new Response(JSON.stringify(corpo), {
            status,
            headers: { "Content-Type": "application/json" },
        });
    }) as any;
    return { buscar, anotacoes };
}

Deno.test("credenciais-mercado-pago", async (t) => {
    await t.step("C1 — sem JWT -> 401", async () => {
        const desfazerEnv = prepararEnv();
        try {
            const req = new Request("http://local/x", {
                method: "POST",
                body: JSON.stringify({ acao: "ler" }),
            });
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(req)
            );
            assertEquals(resposta.status, 401);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C2 — JWT de cliente comum -> 401 e nada gravado", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            const resposta = await comFetch(fetchClienteFalso, () =>
                handler(requisicao({ acao: "salvar", public_key: PUBLIC_KEY_FALSA, access_token: TOKEN_FALSO }), { supabase: cliente })
            );
            assertEquals(resposta.status, 401);
            assertEquals(estado.upserts.length, 0);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C3 — acao desconhecida -> 400", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente } = supabaseFalso();
        try {
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "apagar-tudo" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 400);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C4 — salvar cifra o token e só devolve máscara", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                        webhook_secret: WEBHOOK_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.configurado, true);
            assertEquals(corpo.mascara_token, `••••${TOKEN_FALSO.slice(-4)}`);
            assertEquals(corpo.public_key, PUBLIC_KEY_FALSA);
            // Nada do segredo em claro nem na resposta...
            const textoResposta = JSON.stringify(corpo);
            assertEquals(textoResposta.includes(TOKEN_FALSO), false);
            // ...nem no que dorme no banco (cifrou).
            assertEquals(estado.valor!.includes(TOKEN_FALSO), false);
            assertEquals(estado.valor!.includes(WEBHOOK_FALSO), false);
            assertEquals(JSON.parse(estado.valor!).public_key, PUBLIC_KEY_FALSA);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C5 — sem env de cifra -> 503 fechado, nada gravado", async () => {
        const desfazerEnv = prepararEnv({ MP_CHAVES_ENCRYPTION_KEY: "" });
        const { cliente, estado } = supabaseFalso();
        try {
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            assertEquals(resposta.status, 503);
            assertEquals(estado.upserts.length, 0);
            const corpo = await resposta.json();
            assertEquals(corpo.erro.includes("cofre"), true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C6 — testar fala com o MP com o token DECIFRADO", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            // salva primeiro
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            const { buscar, anotacoes } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
                site_id: "MLB",
            });
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.conectado, true);
            assertEquals(corpo.ambiente, "producao");
            assertEquals(corpo.conta, "Loja Teste");
            // O Bearer que o MP recebeu é o token ORIGINAL (decifrou certo)…
            assertEquals(anotacoes.length, 1);
            assertEquals(anotacoes[0].bearer, `Bearer ${TOKEN_FALSO}`);
            assertEquals(anotacoes[0].url, "https://api.mercadopago.com/users/me");
            // …e a resposta NUNCA carrega o token.
            assertEquals(JSON.stringify(corpo).includes(TOKEN_FALSO), false);
            // O último teste ficou gravado.
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.ultimo_teste.conectado, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C7 — MP recusa (401) -> recado amigável sem vazar nada", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente } = supabaseFalso();
        try {
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            const { buscar } = buscarMpFalso(401, { message: "invalid token" });
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.conectado, false);
            assertEquals(corpo.mensagem.includes("recusou"), true);
            assertEquals(JSON.stringify(corpo).includes(TOKEN_FALSO), false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C8 — ler devolve máscaras, nunca o segredo", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente } = supabaseFalso();
        try {
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                        webhook_secret: WEBHOOK_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ler" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.mascara_token.startsWith("••••"), true);
            assertEquals(corpo.mascara_webhook.startsWith("••••"), true);
            const texto = JSON.stringify(corpo);
            assertEquals(texto.includes(TOKEN_FALSO), false);
            assertEquals(texto.includes(WEBHOOK_FALSO), false);
            assertEquals(texto.includes("cifrado"), false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C9 — salvar sem token mantém o antigo (segue decifrando)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente } = supabaseFalso();
        try {
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            const respostaSalvar = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({ acao: "salvar", public_key: "APP_USR-publica-falsa-de-teste-v2" }),
                    { supabase: cliente },
                )
            );
            assertEquals(respostaSalvar.status, 200);
            const { buscar, anotacoes } = buscarMpFalso(200, { live_mode: false, nickname: "Loja Sandbox" });
            const respostaTeste = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            const corpo = await respostaTeste.json();
            assertEquals(corpo.conectado, true);
            assertEquals(corpo.ambiente, "teste");
            assertEquals(anotacoes[0].bearer, `Bearer ${TOKEN_FALSO}`);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C10 — testar sem token salvo -> 409", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente } = supabaseFalso();
        try {
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 409);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C11 — Access Token malformado -> 400 e nada gravado", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: "chave-cola-pela-metade",
                    }),
                    { supabase: cliente },
                )
            );
            assertEquals(resposta.status, 400);
            assertEquals(estado.upserts.length, 0);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C12 — trocar o token derruba o último teste antigo", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            const { buscar } = buscarMpFalso(200, { live_mode: true, nickname: "Velha" });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            assertEquals(JSON.parse(estado.valor!).ultimo_teste.conta, "Velha");
            // Troca o token: o "Velha" não fala mais desta chave.
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO_2,
                    }),
                    { supabase: cliente },
                )
            );
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.ultimo_teste, null);
            assertEquals(salvo.mascara_token, `••••${TOKEN_FALSO_2.slice(-4)}`);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C13 — testar SEM dublê injetado (caminho de produção) conecta", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        // Fetch global patcheado (a mesma costura que os testes usam para a
        // porta de admin): rotas do Supabase caem no dublê de admin, a rota do
        // MP é anotada e respondida — NENHUMA rede real. É o caminho que a
        // produção corre quando ninguém injeta `buscar` em deps.
        const chamadasMp: string[] = [];
        const fetchProducao = ((input: any, init?: any) => {
            const url = String(input instanceof Request ? input.url : input);
            if (url.includes("api.mercadopago.com")) {
                chamadasMp.push(url);
                return Promise.resolve(
                    new Response(
                        JSON.stringify({ live_mode: true, nickname: "Loja Real" }),
                        { status: 200, headers: { "Content-Type": "application/json" } },
                    ),
                );
            }
            return fetchAdminFalso(input, init);
        }) as any;
        try {
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            // SEM `buscar` nas deps: o default da function é quem fala.
            const resposta = await comFetch(fetchProducao, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.conectado, true);
            assertEquals(corpo.conta, "Loja Real");
            assertEquals(chamadasMp.length, 1);
            assertEquals(chamadasMp[0], "https://api.mercadopago.com/users/me");
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.ultimo_teste.conectado, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C14 — rede caiu de verdade (produção) -> recado de internet honesto", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        // O fetch global REJEITA para o MP (internet fora de verdade) e as
        // rotas do Supabase seguem no dublê de admin. Distinto do C7 (o MP
        // RESPONDEU recusando a chave): aqui nem chegou a haver resposta.
        const fetchSemRede = ((input: any, init?: any) => {
            const url = String(input instanceof Request ? input.url : input);
            if (url.includes("api.mercadopago.com")) {
                return Promise.reject(new TypeError("falha de rede simulada"));
            }
            return fetchAdminFalso(input, init);
        }) as any;
        try {
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            const resposta = await comFetch(fetchSemRede, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.conectado, false);
            assertEquals(corpo.mensagem.includes("internet"), true);
            // A falha fica gravada como falha — e nada do token aparece.
            assertEquals(JSON.stringify(corpo).includes(TOKEN_FALSO), false);
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.ultimo_teste.conectado, false);
        } finally {
            desfazerEnv();
        }
    });
});
