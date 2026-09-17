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
//   C15 mp-3: salvar PUBLICA a Public Key na ficha da loja
//       (store_config.mp_public_key, id = 1) — sem isso o checkout do cliente
//       nunca mostra o PIX, por mais que a tela diga "salvo"
//   C16 mp-3: ficha da loja recusou o UPDATE -> erro EXPLÍCITO na resposta
//       (nunca "salvo" calado com a loja sem a chave)
//   C17 mp-3: ligar_pix sem teste conectado -> 409 e a ficha NÃO liga
//   C18 mp-3: ligar_pix depois de teste conectado -> ficha liga e o registro
//       guarda pix_ligado_em/pix_ligado_por (uid de QUEM ligou)
//   C19 mp-3: ligar_pix com chave de TESTE -> liga, mas com aviso de que não
//       entra dinheiro de verdade
//   C20 mp-3: desligar_pix sempre desliga; e `ler` conta a verdade da ficha
//       (pix_ligado / public_key_na_loja)
//   C21 mp-8: ligar_pix publica a Public Key no MESMO update que acende o
//       PIX — acender com a ficha sem chave é beco sem saída no checkout
//   C22 mp-8: ligar_pix com registro SEM Public Key válida -> 409 pedindo
//       para salvar a chave primeiro, e a ficha NÃO liga
//   C23 mp-8: salvar com credencial NOVA desliga o PIX aceso no mesmo update
//       (com aviso); re-salvar sem trocar credencial NÃO desliga
//   C24/C24b mp-8+mp-10: UPDATE da ficha que não achou a linha id = 1 (zero
//       linhas, sem error) é FALHA explícita: 500 no salvar (e NADA se salva
//       — nem ficha, nem registro) e 500 no ligar_pix sem acender; a partir
//       da mp-10 o recado certo é "fale com o suporte", nunca "tente de novo"
//   C25 mp-8: carimbo de auditoria falhou DEPOIS de acender -> 200 com
//       pix_ligado true e aviso; a auditoria nunca diz "falhou" com o PIX aceso
//   C26 mp-10: trocar SÓ a Public Key (Access Token vazio, sem mexer no
//       token) com o PIX aceso TAMBÉM desliga o PIX — prende a mutação
//       `trocouPublicKey = false`, que a suíte deixava passar até aqui
//   C27 mp-10: `salvar` grava a FICHA antes do REGISTRO — uma ficha que
//       recusa no meio de uma troca de credencial não pode deixar a
//       credencial NOVA gravada com o PIX ainda aceso na chave ANTIGA
//   C28 mp-10: dois avisos de `ligar_pix` juntos saem com pontuação entre
//       eles (a mensagem de chave de TESTE não terminava em ponto)
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

/**
 * Dublê do client: app_settings (guarda o valor e expira o que gravou) E
 * store_config (a ficha da loja que o checkout do cliente lê — id = 1).
 * `falhaNaLoja` simula o UPDATE recusado pela ficha (na vida real, o trigger
 * dominio_publico_so_muda_pela_frota recusando quem não é service_role);
 * `lojaSemLinha` simula o UPDATE que não acha a linha id = 1 (sem error e sem
 * linha afetada — recusa silenciosa); `estado.falhaNoUpsert` liga em pleno
 * roteiro a falha do app_settings, para provar o carimbo de auditoria caindo
 * DEPOIS de a ficha já ter acendido o PIX; `estado.falhaNaLojaAgora` é a
 * MESMA recusa de `falhaNaLoja`, mas ligável NO MEIO do roteiro (C27), para
 * provar que uma ficha que só passa a recusar DEPOIS de já haver credencial
 * antiga funcionando não deixa a credencial NOVA gravada; `estado.lojaSemLinhaAgora`
 * é o mesmo, para `lojaSemLinha` (C24b: a linha id = 1 some SÓ a partir de um
 * ponto do roteiro, não desde o primeiro `salvar`).
 */
function supabaseFalso(
    opcoes: { falhaNaLoja?: boolean; lojaSemLinha?: boolean } = {},
) {
    const estado = {
        valor: null as string | null,
        falhaNoUpsert: false,
        falhaNaLojaAgora: false,
        lojaSemLinhaAgora: false,
        upserts: [] as any[],
        loja: {
            pagamento_online: false as boolean,
            mp_public_key: null as string | null,
        },
        updatesLoja: [] as any[],
    };
    const appSettings = {
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
            if (estado.falhaNoUpsert) {
                return Promise.resolve({
                    error: { message: "app_settings fora do ar" },
                });
            }
            estado.upserts.push(linha);
            estado.valor = linha.value;
            return Promise.resolve({ error: null });
        },
    };
    const storeConfig = {
        select() {
            return this;
        },
        eq() {
            return this;
        },
        maybeSingle() {
            return Promise.resolve({ data: { ...estado.loja }, error: null });
        },
        update(linha: any) {
            estado.updatesLoja.push(linha);
            const recusa = (opcoes.falhaNaLoja || estado.falhaNaLojaAgora)
                ? { message: "DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA" }
                : null;
            const zeroLinha = opcoes.lojaSemLinha || estado.lojaSemLinhaAgora;
            if (!recusa && !zeroLinha) Object.assign(estado.loja, linha);
            // O PostgREST devolve as linhas afetadas só quando pedem `select`;
            // sem linha afetada, `data` volta VAZIO e `error` nulo — é essa
            // recusa silenciosa que `lojaSemLinha`/`lojaSemLinhaAgora` encena.
            const resultado = {
                error: recusa,
                data: recusa ? null : zeroLinha ? [] : [{ id: 1 }],
            };
            // `.update(...).eq('id', 1).select('id')` — e o `.eq()` continua
            // aguardável sozinho (cadeia curta dos testes C1–C20).
            const fimDaCadeia = {
                select: () => Promise.resolve(resultado),
                then: (ok: any, falhou: any) =>
                    Promise.resolve(resultado).then(ok, falhou),
            };
            return { eq: () => fimDaCadeia };
        },
    };
    return {
        cliente: {
            from: (nome: string) =>
                nome === "store_config" ? storeConfig : appSettings,
        },
        estado,
    };
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

    await t.step("C15 — salvar publica a Public Key na ficha da loja", async () => {
        const desfazerEnv = prepararEnv();
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
            assertEquals(resposta.status, 200);
            // A ficha que o checkout do cliente lê recebeu a MESMA Public Key.
            assertEquals(estado.loja.mp_public_key, PUBLIC_KEY_FALSA);
            assertEquals(estado.updatesLoja.length, 1);
            assertEquals(estado.updatesLoja[0].mp_public_key, PUBLIC_KEY_FALSA);
            // Publicar a chave NÃO liga o PIX sozinho (isso é ligar_pix).
            assertEquals(estado.loja.pagamento_online, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C16 — ficha recusou o UPDATE -> erro explícito, nunca calado", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso({ falhaNaLoja: true });
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
            assertEquals(resposta.status, 500);
            const corpo = await resposta.json();
            assertEquals(corpo.erro.includes("ficha da loja"), true);
            // O segredo continua sem aparecer nem nesse caminho de erro.
            assertEquals(JSON.stringify(corpo).includes(TOKEN_FALSO), false);
            assertEquals(estado.loja.mp_public_key, null);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C17 — ligar_pix sem teste conectado -> 409 e ficha desligada", async () => {
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
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 409);
            const corpo = await resposta.json();
            assertEquals(
                corpo.erro.includes("Teste a conexão com sucesso antes de ligar"),
                true,
            );
            assertEquals(estado.loja.pagamento_online, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C18 — ligar_pix com teste conectado liga e carimba quem ligou", async () => {
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, true);
            // Chave de produção: nada de aviso de dinheiro de mentira.
            assertEquals(corpo.aviso, undefined);
            assertEquals(estado.loja.pagamento_online, true);
            // Auditoria: quem ligou e quando, no registro.
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.pix_ligado_por, ID_ADMIN);
            assertEquals(typeof salvo.pix_ligado_em, "string");
            // E o carimbo sobrevive a um novo salvar (auditoria não some).
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({ acao: "salvar", public_key: PUBLIC_KEY_FALSA }),
                    { supabase: cliente },
                )
            );
            assertEquals(JSON.parse(estado.valor!).pix_ligado_por, ID_ADMIN);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C19 — ligar_pix com chave de TESTE liga com aviso", async () => {
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: false,
                nickname: "Loja Sandbox",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, true);
            assertEquals(corpo.aviso.includes("TESTE"), true);
            assertEquals(estado.loja.pagamento_online, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C20 — desligar_pix desliga e ler conta a verdade da ficha", async () => {
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
            const { buscar } = buscarMpFalso(200, { live_mode: true, nickname: "Loja Teste" });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            const respostaLigada = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ler" }), { supabase: cliente })
            );
            const corpoLigado = await respostaLigada.json();
            assertEquals(corpoLigado.pix_ligado, true);
            assertEquals(corpoLigado.public_key_na_loja, true);

            const respostaDesligar = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "desligar_pix" }), { supabase: cliente })
            );
            assertEquals(respostaDesligar.status, 200);
            assertEquals((await respostaDesligar.json()).pix_ligado, false);
            assertEquals(estado.loja.pagamento_online, false);

            // Ficha com OUTRA Public Key (semeada por fora): `ler` acusa a
            // divergência em vez de dizer que está tudo certo.
            estado.loja.mp_public_key = "APP_USR-publica-de-outra-loja";
            const respostaDivergente = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ler" }), { supabase: cliente })
            );
            const corpoDivergente = await respostaDivergente.json();
            assertEquals(corpoDivergente.pix_ligado, false);
            assertEquals(corpoDivergente.public_key_na_loja, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C21 — ligar_pix publica a Public Key no MESMO update que acende o PIX", async () => {
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            // A ficha ficou SEM a Public Key (restauração de backup, escrita
            // manual no banco): acender o PIX assim é beco sem saída no fim da
            // compra — o Payment Brick não sobe sem a chave.
            estado.loja.mp_public_key = null;
            estado.updatesLoja.length = 0;

            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 200);
            assertEquals((await resposta.json()).pix_ligado, true);
            // As DUAS colunas no MESMO update — nunca aceso sem chave.
            assertEquals(estado.updatesLoja.length, 1);
            assertEquals(estado.updatesLoja[0].pagamento_online, true);
            assertEquals(estado.updatesLoja[0].mp_public_key, PUBLIC_KEY_FALSA);
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(estado.loja.mp_public_key, PUBLIC_KEY_FALSA);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C22 — ligar_pix sem Public Key válida no registro -> 409 e ficha apagada", async () => {
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            // Registro antigo (gravado antes desta regra) sem Public Key: o
            // teste conecta, mas não há o que publicar na ficha.
            const registroSemChave = JSON.parse(estado.valor!);
            registroSemChave.public_key = "";
            estado.valor = JSON.stringify(registroSemChave);
            estado.updatesLoja.length = 0;

            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 409);
            const corpo = await resposta.json();
            assertEquals(corpo.erro.includes("Public Key"), true);
            // Recusou ANTES de escrever: ficha intocada e PIX apagado.
            assertEquals(estado.updatesLoja.length, 0);
            assertEquals(estado.loja.pagamento_online, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C23 — salvar credencial nova desliga o PIX aceso; re-salvar igual não desliga", async () => {
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(estado.loja.pagamento_online, true);
            estado.updatesLoja.length = 0;

            // Token NOVO: a credencial que o PIX aceso usava não existe mais —
            // ficar aceso é toda tentativa de PIX morrendo no cliente.
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO_2,
                    }),
                    { supabase: cliente },
                )
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_desligado, true);
            assertEquals(corpo.aviso.includes("Desliguei o PIX"), true);
            assertEquals(corpo.pix_ligado, false);
            // Desligou no MESMO update que publicou a chave.
            assertEquals(estado.updatesLoja.length, 1);
            assertEquals(estado.updatesLoja[0].pagamento_online, false);
            assertEquals(estado.updatesLoja[0].mp_public_key, PUBLIC_KEY_FALSA);
            assertEquals(estado.loja.pagamento_online, false);

            // De volta ao ar com a credencial nova testada...
            const segundoMp = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), {
                    supabase: cliente,
                    buscar: segundoMp.buscar,
                })
            );
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(estado.loja.pagamento_online, true);
            estado.updatesLoja.length = 0;

            // ...e re-salvar SEM trocar credencial (a tela manda o token vazio)
            // não pode derrubar o PIX de quem está vendendo.
            const reSalvar = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({ acao: "salvar", public_key: PUBLIC_KEY_FALSA }),
                    { supabase: cliente },
                )
            );
            assertEquals(reSalvar.status, 200);
            const corpoReSalvar = await reSalvar.json();
            assertEquals(corpoReSalvar.pix_desligado, undefined);
            assertEquals(corpoReSalvar.pix_ligado, true);
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(estado.updatesLoja[0].pagamento_online, undefined);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C24 — ficha sem a linha id = 1: salvar falha, o recado é o certo e NADA fica pela metade", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso({ lojaSemLinha: true });
        try {
            const respostaSalvar = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO,
                    }),
                    { supabase: cliente },
                )
            );
            // UPDATE sem error e sem linha afetada NÃO é "publicado".
            assertEquals(respostaSalvar.status, 500);
            const corpoSalvar = await respostaSalvar.json();
            // mp-10: a causa certa ("não existe") e o conselho certo
            // ("suporte") — nunca "tente de novo", que aqui é promessa vazia
            // (nenhum retry cria a linha id = 1 sozinho).
            assertEquals(corpoSalvar.erro.includes("não existe"), true);
            assertEquals(corpoSalvar.erro.includes("suporte"), true);
            assertEquals(corpoSalvar.erro.includes("Tente de novo"), false);
            assertEquals(estado.loja.mp_public_key, null);
            // mp-10: FICHA primeiro — como ela recusou, o REGISTRO (a
            // credencial cifrada) nem chegou a ser gravado em app_settings.
            // A versão anterior gravava o registro ANTES da ficha, e um
            // 500 aqui saía com a credencial nova já em vigor.
            assertEquals(estado.upserts.length, 0);
            assertEquals(estado.valor, null);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C24b — ligar_pix com a ficha sem a linha id = 1 também é falha explícita e honesta", async () => {
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            // A linha id = 1 some ENTRE o teste e o ligar (ex.: restauração
            // de backup) — o mesmo estado que C24 encena, só que a partir
            // daqui, com credencial já salva e testada por trás.
            estado.lojaSemLinhaAgora = true;

            const respostaLigar = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(respostaLigar.status, 500);
            const corpoLigar = await respostaLigar.json();
            assertEquals(corpoLigar.pix_ligado, undefined);
            assertEquals(corpoLigar.erro.includes("não existe"), true);
            assertEquals(corpoLigar.erro.includes("suporte"), true);
            assertEquals(corpoLigar.erro.includes("Tente de novo"), false);
            // Nada acendeu — e o registro não carimbou um "ligou" que não ligou.
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(JSON.parse(estado.valor!).pix_ligado_por ?? null, null);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C25 — carimbo de auditoria falhou com o PIX já aceso -> 200 com aviso, nunca 'falhou'", async () => {
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            // O app_settings cai DEPOIS de a ficha já ter acendido o PIX.
            estado.falhaNoUpsert = true;

            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            // A verdade do estado é a ficha: dizer "não consegui" com o PIX
            // aceso faz o lojista tentar de novo achando que está desligado.
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, true);
            assertEquals(corpo.erro, undefined);
            assertEquals(corpo.aviso.includes("quem ligou"), true);
            assertEquals(estado.loja.pagamento_online, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C26 — trocar SÓ a Public Key (sem mexer no Access Token) com o PIX aceso também desliga o PIX", async () => {
        // Prende a mutação `trocouPublicKey = false`: com ela, este cenário
        // (token vazio no corpo — nenhuma troca de TOKEN) não desligaria o
        // PIX, e a loja ficaria vendendo com o Payment Brick de OUTRA conta
        // sem uma palavra ao lojista.
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(estado.loja.pagamento_online, true);
            estado.updatesLoja.length = 0;

            // SÓ a Public Key muda; nenhum access_token no corpo (a tela
            // manda vazio quando o lojista não reeditou o Access Token).
            const PUBLIC_KEY_TROCADA = "APP_USR-publica-falsa-de-outra-conta";
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({ acao: "salvar", public_key: PUBLIC_KEY_TROCADA }),
                    { supabase: cliente },
                )
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_desligado, true);
            assertEquals(corpo.pix_ligado, false);
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.loja.mp_public_key, PUBLIC_KEY_TROCADA);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C27 — salvar grava a FICHA antes do REGISTRO: uma ficha que passa a recusar não troca a credencial de quem já vende", async () => {
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(estado.loja.pagamento_online, true);
            const registroAntesDaFalha = estado.valor;

            // A partir de agora, todo UPDATE na ficha é recusado (trigger
            // dominio_publico_so_muda_pela_frota caído, por exemplo).
            estado.falhaNaLojaAgora = true;

            const PUBLIC_KEY_NOVA = "APP_USR-publica-falsa-de-outra-conta";
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_NOVA,
                        access_token: TOKEN_FALSO_2,
                    }),
                    { supabase: cliente },
                )
            );
            assertEquals(resposta.status, 500);
            // A credencial ANTIGA — a que está vendendo de verdade — não foi
            // tocada: com a ordem trocada (registro ANTES da ficha), este
            // `estado.valor` já estaria com o token/mascara NOVOS mesmo a
            // ficha tendo recusado.
            assertEquals(estado.valor, registroAntesDaFalha);
            assertEquals(
                JSON.parse(estado.valor!).mascara_token,
                `••••${TOKEN_FALSO.slice(-4)}`,
            );
            // A ficha também não mudou: PIX segue aceso com a chave antiga.
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(estado.loja.mp_public_key, PUBLIC_KEY_FALSA);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C28 — dois avisos de ligar_pix juntos saem com pontuação entre eles", async () => {
        // Chave de SANDBOX (gera o primeiro aviso, que termina em "de
        // verdade" sem ponto) + app_settings fora do ar (gera o segundo,
        // depois de a ficha já ter acendido): os DOIS avisos saem juntos.
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: false,
                nickname: "Loja Sandbox",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            estado.falhaNoUpsert = true;

            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            // A frase da chave de TESTE termina em "de verdade" (sem ponto
            // no código-fonte) — sem a normalização, o `join(" ")` colava a
            // frase seguinte direto nela: "...de verdade O PIX está ligado"
            // sem separação de leitura nenhuma. Com o ponto, as DUAS frases
            // ficam legíveis e discretas uma da outra.
            assertEquals(
                corpo.aviso.includes("de verdade. O PIX está ligado"),
                true,
            );
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C29 — gravarRegistro falha DEPOIS de a ficha já ter desligado o PIX: o recado soma as duas metades", async () => {
        // Ordem ficha-primeiro (C27): a ficha já apagou `pagamento_online`
        // quando o `app_settings` (o registro cifrado) estoura. O catch
        // geral do handler diria só "não consegui gravar as chaves agora",
        // que é verdade sobre o registro e SILÊNCIO sobre o PIX que acabou
        // de ser desligado — o lojista só descobriria recarregando a tela.
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
            const { buscar } = buscarMpFalso(200, {
                live_mode: true,
                nickname: "Loja Teste",
            });
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "ligar_pix" }), { supabase: cliente })
            );
            assertEquals(estado.loja.pagamento_online, true);
            const registroAntesDaFalha = estado.valor;

            // A partir de agora, todo upsert em app_settings estoura — no
            // MEIO do próximo `salvar`, depois de a ficha já ter escrito.
            estado.falhaNoUpsert = true;

            const PUBLIC_KEY_NOVA = "APP_USR-publica-falsa-de-outra-conta";
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_NOVA,
                        access_token: TOKEN_FALSO_2,
                    }),
                    { supabase: cliente },
                )
            );
            assertEquals(resposta.status, 500);
            const corpo = await resposta.json();
            // O recado soma as DUAS metades: nem promete "salvei" (o
            // registro não gravou), nem cala sobre o PIX (que a ficha já
            // desligou por segurança).
            assertEquals(corpo.erro.includes("Não salvei as chaves"), true);
            assertEquals(corpo.erro.includes("desliguei o PIX"), true);
            // A ficha REALMENTE desligou — não é só o texto do erro.
            assertEquals(estado.loja.pagamento_online, false);
            // O registro (a credencial) NÃO trocou: gravarRegistro recusou.
            assertEquals(estado.valor, registroAntesDaFalha);
        } finally {
            desfazerEnv();
        }
    });
});
