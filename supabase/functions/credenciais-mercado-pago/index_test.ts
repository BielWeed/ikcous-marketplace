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
//   C30 (25/09/2026): `GET /users/me` do MP responde 200 SEM `live_mode` (é
//       o real: o endpoint não devolve esse campo) -> `ambiente` fica null e
//       a mensagem NÃO afirma "de teste" nem "de produção"
//   C31 formas de pagamento por loja (25/09/2026, B2): desligar_pix numa loja
//       SEM nenhuma forma "na entrega" -> a trigger do invariante recusa
//       (LOJA_SEM_FORMA_DE_PAGAMENTO) e a edge devolve 409 com recado
//       amigável, NUNCA o 500 genérico; o PIX continua aceso
//   C33–C38 (30/09/2026): ligar_pix sem a chave de assinatura do webhook da
//       PRÓPRIA loja -> 409 e nenhuma escrita; com a chave liga como antes;
//       salvar a chave depois do 409 destrava sem retestar; desligar_pix segue
//       livre; a MP_WEBHOOK_SECRET global não conta; registro legado/pela
//       metade (sem os campos ou sem o iv) também recusa
//   C32 formas de pagamento por loja (25/09/2026, B2): salvar com credencial
//       NOVA (desliga o PIX no mesmo update, mp-8) numa loja SEM nenhuma
//       forma "na entrega" -> mesma recusa, 409 com recado ESPECÍFICO de
//       troca de chave (mp-8 não relaxa: a credencial nova NÃO é gravada)
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
const { handler, faltasParaReceber } = await import("./index.ts");
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
    opcoes: {
        falhaNaLoja?: boolean;
        lojaSemLinha?: boolean;
        /**
         * C31/C32 (formas de pagamento por loja, 25/09/2026): simula a
         * trigger `store_config_exige_forma_de_pagamento`
         * (migration 20261174000000) recusando o UPDATE — mesma forma de
         * `falhaNaLoja`, mensagem diferente. As duas nunca coexistem: cada
         * teste liga uma ou outra.
         */
        falhaSemFormaDePagamento?: boolean;
    } = {},
) {
    const estado = {
        valor: null as string | null,
        falhaNoUpsert: false,
        falhaNaLojaAgora: false,
        lojaSemLinhaAgora: false,
        // Quantos upserts em app_settings ainda passam (Infinity = todos):
        // permite encenar "a 1ª gravação do registro passa e a 2ª estoura"
        // (o carimbo de auditoria depois da ficha).
        upsertsPermitidos: Infinity as number,
        // Ordem em que as duas tabelas foram tocadas ("ficha" | "registro"),
        // para provar ficha ANTES do registro (mp-10).
        ordem: [] as string[],
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
            if (
                estado.falhaNoUpsert ||
                estado.upserts.length >= estado.upsertsPermitidos
            ) {
                return Promise.resolve({
                    error: { message: "app_settings fora do ar" },
                });
            }
            estado.ordem.push("registro");
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
            estado.ordem.push("ficha");
            // A trigger real só recusa quando a linha FINAL fica sem forma
            // nenhuma — ou seja, ao DESLIGAR `pagamento_online`. Ligar, ou só
            // publicar a Public Key, nunca esbarra nela.
            const recusa = (opcoes.falhaNaLoja || estado.falhaNaLojaAgora)
                ? { message: "DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA" }
                : opcoes.falhaSemFormaDePagamento &&
                        linha.pagamento_online === false
                ? { message: "LOJA_SEM_FORMA_DE_PAGAMENTO" }
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

    await t.step("C12 — trocar o token substitui o último teste antigo pelo teste do token NOVO (feito na hora, no salvar)", async () => {
        // 30/09/2026 (liberação automática): antes, trocar o token só ZERAVA
        // o `ultimo_teste` (null) e deixava o lojista testar à mão. Agora o
        // salvar testa o token novo NA HORA — o "Velha" não fala mais desta
        // chave e é trocado pelo resultado do teste dela, nunca fica velho.
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
            // Troca o token: o teste do token novo roda dentro do salvar.
            const nova = buscarMpFalso(200, { live_mode: true, nickname: "Nova" });
            await comFetch(fetchAdminFalso, () =>
                handler(
                    requisicao({
                        acao: "salvar",
                        public_key: PUBLIC_KEY_FALSA,
                        access_token: TOKEN_FALSO_2,
                    }),
                    { supabase: cliente, buscar: nova.buscar },
                )
            );
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.ultimo_teste.conta, "Nova");
            assertEquals(nova.anotacoes.length, 1);
            assertEquals(nova.anotacoes[0].bearer, `Bearer ${TOKEN_FALSO_2}`);
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
            // O recado honesto diz QUEM falhou (este servidor, não o navegador
            // do lojista), carrega o nome do erro e aponta para os registros.
            assertEquals(
                corpo.mensagem.includes("o servidor não conseguiu chamar a API do Mercado Pago"),
                true,
            );
            assertEquals(corpo.mensagem.includes("TypeError"), true);
            assertEquals(corpo.mensagem.includes("Confira a internet"), false);
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

    // ══════════════════════════════════════════════════════════════════════
    // LIBERAÇÃO AUTOMÁTICA (30/09/2026). Do C17 ao C38 abaixo, cada teste que
    // antes ligava o PIX à mão (`ligar_pix` depois de `testar`) foi reescrito
    // para o comportamento novo: as três chaves + teste de conexão que passou
    // LIGAM sozinhos, `ligar_pix` virou "retomar" e `desligar_pix` virou
    // "pausar". Os L1–L20 são os casos NOVOS (limite, dado que já existia,
    // recusa do invariante, falha no meio da gravação).
    // ══════════════════════════════════════════════════════════════════════
    const RECADO_SEM_CHAVE_DE_ASSINATURA =
        "Cole a Chave de notificações (assinatura secreta do webhook do Mercado Pago) e salve para voltar a receber pelo app — sem ela o cliente escolhe PIX e o pagamento é recusado no fim da compra.";
    const OK_PRODUCAO = { live_mode: true, nickname: "Loja Teste" };
    const TRES_CHAVES = {
        acao: "salvar",
        public_key: PUBLIC_KEY_FALSA,
        access_token: TOKEN_FALSO,
        webhook_secret: WEBHOOK_FALSO,
    };

    /** Uma chamada ao handler, com a porta de admin e (opcional) o MP dublê. */
    function chamar(cliente: any, corpo: unknown, buscar?: any) {
        return comFetch(fetchAdminFalso, () =>
            handler(requisicao(corpo), {
                supabase: cliente,
                ...(buscar ? { buscar } : {}),
            })
        );
    }

    /** MP dublê que estoura como a rede de verdade (nem chega a haver resposta). */
    function buscarMpRede() {
        const anotacoes: Array<{ url: string; bearer: string }> = [];
        const buscar = (async (url: any, init?: RequestInit) => {
            anotacoes.push({
                url: String(url),
                bearer: new Headers(init?.headers).get("Authorization") ?? "",
            });
            throw new TypeError("falha de rede simulada");
        }) as any;
        return { buscar, anotacoes };
    }

    /** As três chaves + teste que passa: a loja liga SOZINHA. */
    async function lojaLigada(cliente: any, corpoExtra: Record<string, unknown> = {}) {
        const mp = buscarMpFalso(200, OK_PRODUCAO);
        const r = await chamar(cliente, { ...TRES_CHAVES, ...corpoExtra }, mp.buscar);
        assertEquals(r.status, 200);
        return mp;
    }

    /** Salva credenciais e testa (conectado), SEM a chave de notificações. */
    async function prepararLojaTestada(
        cliente: any,
        segredoDeWebhook?: string,
    ): Promise<void> {
        await comFetch(fetchAdminFalso, () =>
            handler(
                requisicao({
                    acao: "salvar",
                    public_key: PUBLIC_KEY_FALSA,
                    access_token: TOKEN_FALSO,
                    ...(segredoDeWebhook
                        ? { webhook_secret: segredoDeWebhook }
                        : {}),
                }),
                { supabase: cliente },
            )
        );
        const { buscar } = buscarMpFalso(200, OK_PRODUCAO);
        await comFetch(fetchAdminFalso, () =>
            handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
        );
    }

    await t.step("C17 — ligar_pix (retomar) com o teste falhado -> 409 e ficha desligada, sem escrita", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            // As 3 chaves salvas, mas o teste do salvar foi recusado: só
            // falta o teste.
            const mp = buscarMpFalso(401, { message: "invalid token" });
            await chamar(cliente, TRES_CHAVES, mp.buscar);
            const upsertsAntes = estado.upserts.length;
            estado.updatesLoja.length = 0;

            const resposta = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(resposta.status, 409);
            const corpo = await resposta.json();
            assertEquals(
                corpo.erro.includes("Teste a conexão com sucesso para voltar a receber pelo app"),
                true,
            );
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.updatesLoja.length, 0);
            assertEquals(estado.upserts.length, upsertsAntes);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C18 — salvar as três chaves com teste que passa LIGA sozinho: ficha antes do registro, carimbo de quem ligou", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            const mp = buscarMpFalso(200, OK_PRODUCAO);
            const resposta = await chamar(cliente, TRES_CHAVES, mp.buscar);
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, true);
            assertEquals(corpo.faltando, []);
            assertEquals(corpo.pausado, false);
            // Chave de produção: nada de aviso de dinheiro de mentira.
            assertEquals(corpo.aviso, undefined);
            assertEquals(corpo.ultimo_teste.conectado, true);
            // O teste rodou UMA vez, com o token NOVO em claro.
            assertEquals(mp.anotacoes.length, 1);
            assertEquals(mp.anotacoes[0].bearer, `Bearer ${TOKEN_FALSO}`);
            // Ficha: um update só, com as DUAS colunas juntas (nunca aceso sem
            // chave) — e a ficha vem ANTES do registro (ordem mp-10).
            assertEquals(estado.updatesLoja.length, 1);
            assertEquals(estado.updatesLoja[0].pagamento_online, true);
            assertEquals(estado.updatesLoja[0].mp_public_key, PUBLIC_KEY_FALSA);
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(estado.ordem, ["ficha", "registro"]);
            // Auditoria: quem ligou e quando, no registro.
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.pix_ligado_por, ID_ADMIN);
            assertEquals(typeof salvo.pix_ligado_em, "string");
            assertEquals(salvo.ultimo_teste.conectado, true);
            // O segredo nunca aparece na resposta.
            assertEquals(JSON.stringify(corpo).includes(TOKEN_FALSO), false);
            // E o carimbo sobrevive a um novo salvar (auditoria não some).
            await chamar(cliente, { acao: "salvar", public_key: PUBLIC_KEY_FALSA });
            assertEquals(JSON.parse(estado.valor!).pix_ligado_por, ID_ADMIN);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C19 — chave de TESTE liga, mas com aviso de que não entra dinheiro de verdade", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            const mp = buscarMpFalso(200, { live_mode: false, nickname: "Loja Sandbox" });
            const resposta = await chamar(cliente, TRES_CHAVES, mp.buscar);
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, true);
            assertEquals(corpo.aviso.includes("TESTE"), true);
            assertEquals(estado.loja.pagamento_online, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C20 — desligar_pix (pausar) desliga e registra a pausa; ler conta a verdade da ficha", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            const corpoLigado = await (await chamar(cliente, { acao: "ler" })).json();
            assertEquals(corpoLigado.pix_ligado, true);
            assertEquals(corpoLigado.public_key_na_loja, true);
            assertEquals(corpoLigado.pausado, false);
            assertEquals(corpoLigado.faltando, []);

            const respostaPausar = await chamar(cliente, { acao: "desligar_pix" });
            assertEquals(respostaPausar.status, 200);
            const corpoPausar = await respostaPausar.json();
            assertEquals(corpoPausar.pix_ligado, false);
            assertEquals(corpoPausar.pausado, true);
            assertEquals(estado.loja.pagamento_online, false);
            // A pausa fica no registro, com quem pausou e quando.
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.pagamento_pausado, true);
            assertEquals(salvo.pausado_por, ID_ADMIN);
            assertEquals(typeof salvo.pausado_em, "string");
            // Pausar NÃO apaga o carimbo de quem ligou (auditoria).
            assertEquals(salvo.pix_ligado_por, ID_ADMIN);
            // Ficha ANTES do registro também ao pausar.
            assertEquals(estado.ordem.slice(-2), ["ficha", "registro"]);

            const lidoPausado = await (await chamar(cliente, { acao: "ler" })).json();
            assertEquals(lidoPausado.pausado, true);
            assertEquals(lidoPausado.pix_ligado, false);

            // Ficha com OUTRA Public Key (semeada por fora): `ler` acusa a
            // divergência em vez de dizer que está tudo certo.
            estado.loja.mp_public_key = "APP_USR-publica-de-outra-loja";
            const corpoDivergente = await (await chamar(cliente, { acao: "ler" })).json();
            assertEquals(corpoDivergente.pix_ligado, false);
            assertEquals(corpoDivergente.public_key_na_loja, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C31 — pausar numa loja sem forma na entrega -> 409 amigável, PIX continua aceso e a pausa NÃO fica gravada", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso({
            falhaSemFormaDePagamento: true,
        });
        try {
            // A loja já vendia só pelo app (PIX aceso, nenhuma forma na
            // entrega) — é EXATAMENTE o estado que a trigger protege.
            await lojaLigada(cliente);
            const registroAntes = estado.valor;
            const resposta = await chamar(cliente, { acao: "desligar_pix" });
            assertEquals(resposta.status, 409);
            const corpo = await resposta.json();
            assertEquals(
                corpo.erro,
                "Ligue ao menos uma forma de pagamento na entrega antes de desligar o PIX pelo app.",
            );
            // Nunca o recado genérico "tente de novo" — a lojista precisa
            // saber O QUE fazer (tentar de novo dá o MESMO erro).
            assertEquals(corpo.erro.includes("tente de novo"), false);
            // A recusa da trigger impede a mutação: o PIX continua aceso e
            // o registro NÃO ganhou pausa nenhuma (senão a tela diria
            // "Pausado" com o PIX vendendo, e o próximo teste o religaria).
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(estado.valor, registroAntes);
            assertEquals(JSON.parse(estado.valor!).pagamento_pausado ?? false, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C32 — salvar credencial nova que FALHA no teste, numa loja sem forma na entrega -> 409 com recado de troca de chave; mp-8 não relaxa", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso({
            falhaSemFormaDePagamento: true,
        });
        try {
            await lojaLigada(cliente);
            const registroAntes = estado.valor;
            const publicaAntes = estado.loja.mp_public_key;
            // O token novo NÃO passa no teste: o alvo passa a ser desligado,
            // e desligar esbarra no invariante.
            const mp = buscarMpFalso(401, { message: "invalid token" });
            const resposta = await chamar(
                cliente,
                { ...TRES_CHAVES, access_token: TOKEN_FALSO_2, public_key: "APP_USR-publica-falsa-nova-conta" },
                mp.buscar,
            );
            assertEquals(resposta.status, 409);
            const corpo = await resposta.json();
            // O teste da chave nova FALHOU (recusada): o recado diz isso e
            // manda conferir o Access Token ANTES de mandar ligar forma na
            // entrega — a lojista pode só ter colado a chave errada.
            assertEquals(
                corpo.erro.startsWith(
                    "O teste de conexão com as chaves novas não passou: confira o Access Token.",
                ),
                true,
            );
            assertEquals(
                corpo.erro.endsWith(
                    "Ligue ao menos uma forma de pagamento na entrega antes de trocar as chaves do Mercado Pago.",
                ),
                true,
            );
            // mp-8 não relaxa: a credencial NOVA não fica gravada em lugar
            // nenhum (nem app_settings, nem a Public Key na ficha).
            assertEquals(estado.valor, registroAntes);
            assertEquals(estado.loja.mp_public_key, publicaAntes);
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(JSON.stringify(corpo).includes(TOKEN_FALSO_2), false);
        } finally {
            desfazerEnv();
        }
    });

    // ── C33–C38 (30/09/2026): o PIX só acende com a CHAVE DE ASSINATURA DO
    // WEBHOOK da própria loja salva. criar-pagamento já recusa PIX sem ela
    // (409 pixSemChaveDeAssinatura); acender o interruptor sem a chave é o
    // cliente escolher PIX e tomar erro no fim da compra.

    await t.step("C33 — retomar sem a chave de assinatura salva -> 409 com recado e NENHUMA escrita", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await prepararLojaTestada(cliente);
            const upsertsAntes = estado.upserts.length;
            estado.updatesLoja.length = 0;

            const resposta = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(resposta.status, 409);
            const corpo = await resposta.json();
            assertEquals(corpo.erro, RECADO_SEM_CHAVE_DE_ASSINATURA);
            // A recusa vem ANTES de qualquer escrita: nem a ficha (o
            // interruptor), nem o registro (a pausa / o carimbo).
            assertEquals(estado.updatesLoja.length, 0);
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.upserts.length, upsertsAntes);
            assertEquals(
                JSON.parse(estado.valor!).pix_ligado_por ?? null,
                null,
            );
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C34 — as três chaves + teste que passa ligam sozinhas (no testar); retomar depois é idempotente", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await prepararLojaTestada(cliente, WEBHOOK_FALSO);
            // Ninguém chamou ligar_pix: o `testar` já ligou.
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(JSON.parse(estado.valor!).pix_ligado_por, ID_ADMIN);
            const upsertsAntes = estado.upserts.length;
            estado.updatesLoja.length = 0;

            const resposta = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, true);
            assertEquals(corpo.pausado, false);
            // Já estava ligado e em sincronia com a ficha: nada a escrever
            // na ficha, e o carimbo de quem ligou não é regravado.
            assertEquals(estado.updatesLoja.length, 0);
            assertEquals(JSON.parse(estado.valor!).pix_ligado_por, ID_ADMIN);
            assertEquals(estado.upserts.length, upsertsAntes);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C35 — o caminho do recado funciona: salvar a chave de notificações (com o teste que passa) liga sozinho, sem botão", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await prepararLojaTestada(cliente);
            const recusada = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(recusada.status, 409);
            assertEquals(estado.loja.pagamento_online, false);

            // Chave de notificações NOVA = credencial nova = teste na hora.
            const mp = buscarMpFalso(200, OK_PRODUCAO);
            const salvou = await chamar(
                cliente,
                {
                    acao: "salvar",
                    public_key: PUBLIC_KEY_FALSA,
                    webhook_secret: WEBHOOK_FALSO,
                },
                mp.buscar,
            );
            assertEquals(salvou.status, 200);
            assertEquals((await salvou.json()).pix_ligado, true);
            assertEquals(estado.loja.pagamento_online, true);
            // O teste do salvar usou o token JÁ SALVO (decifrado): o lojista
            // não colou o token de novo.
            assertEquals(mp.anotacoes.length, 1);
            assertEquals(mp.anotacoes[0].bearer, `Bearer ${TOKEN_FALSO}`);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C36 — pausar continua permitido SEM a chave de assinatura (loja ligada antes desta regra)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await prepararLojaTestada(cliente);
            // PIX já aceso por fora (loja que ligou antes desta regra).
            estado.loja.pagamento_online = true;
            const resposta = await chamar(cliente, { acao: "desligar_pix" });
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, false);
            assertEquals(corpo.pausado, true);
            assertEquals(estado.loja.pagamento_online, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C37 — a chave GLOBAL do ambiente (MP_WEBHOOK_SECRET) não conta: só a da loja", async () => {
        const desfazerEnv = prepararEnv({
            MP_WEBHOOK_SECRET: "segredo-global-da-plataforma-1234",
        });
        const { cliente, estado } = supabaseFalso();
        try {
            await prepararLojaTestada(cliente);
            // Nem sozinho (no testar), nem por retomar.
            assertEquals(estado.loja.pagamento_online, false);
            const resposta = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(resposta.status, 409);
            assertEquals((await resposta.json()).erro, RECADO_SEM_CHAVE_DE_ASSINATURA);
            assertEquals(estado.loja.pagamento_online, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C38 — registro que já existia: sem os campos do webhook, ou só o cifrado sem o iv -> 409", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await prepararLojaTestada(cliente, WEBHOOK_FALSO);
            // A loja ligou sozinha; simulamos a ficha desligada para provar a
            // recusa do retomar (nada de acender com registro pela metade).
            estado.loja.pagamento_online = false;
            estado.updatesLoja.length = 0;

            // (a) Registro gravado ANTES de existir a chave de webhook: os
            // campos nem existem no JSON (não são null, são ausentes).
            const completo = JSON.parse(estado.valor!);
            const legado = { ...completo };
            delete legado.webhook_cifrado;
            delete legado.webhook_iv;
            delete legado.mascara_webhook;
            estado.valor = JSON.stringify(legado);
            const semCampos = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(semCampos.status, 409);

            // (b) Registro pela metade: cifrado sem o iv não decifra nada —
            // mesma noção de "tem chave" que o criar-pagamento usa.
            estado.valor = JSON.stringify({ ...completo, webhook_iv: null });
            const semIv = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(semIv.status, 409);
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.updatesLoja.length, 0);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C21 — retomar publica a Public Key no MESMO update que acende o PIX", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            await chamar(cliente, { acao: "desligar_pix" });
            // A ficha ficou SEM a Public Key (restauração de backup, escrita
            // manual no banco): acender o PIX assim é beco sem saída no fim da
            // compra — o Payment Brick não sobe sem a chave.
            estado.loja.mp_public_key = null;
            estado.updatesLoja.length = 0;

            const resposta = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, true);
            assertEquals(corpo.pausado, false);
            assertEquals(corpo.public_key_na_loja, true);
            // As DUAS colunas no MESMO update — nunca aceso sem chave.
            assertEquals(estado.updatesLoja.length, 1);
            assertEquals(estado.updatesLoja[0].pagamento_online, true);
            assertEquals(estado.updatesLoja[0].mp_public_key, PUBLIC_KEY_FALSA);
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(estado.loja.mp_public_key, PUBLIC_KEY_FALSA);
            // A pausa saiu do registro.
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.pagamento_pausado, false);
            assertEquals(salvo.pausado_em ?? null, null);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C22 — retomar sem Public Key válida no registro -> 409 e nada escrito", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await prepararLojaTestada(cliente);
            // Registro antigo (gravado antes desta regra) sem Public Key: o
            // teste conecta, mas não há o que publicar na ficha.
            const registroSemChave = JSON.parse(estado.valor!);
            registroSemChave.public_key = "";
            estado.valor = JSON.stringify(registroSemChave);
            estado.updatesLoja.length = 0;

            const resposta = await chamar(cliente, { acao: "ligar_pix" });
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

    await t.step("C23 — salvar credencial nova que FALHA no teste desliga o PIX aceso (mesmo update); re-salvar igual não desliga", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            estado.updatesLoja.length = 0;

            // Token NOVO que o MP recusa: a credencial que o PIX aceso usava
            // não existe mais, e a nova não passou — ficar aceso é toda
            // tentativa de PIX morrendo no cliente.
            const recusado = buscarMpFalso(401, { message: "invalid token" });
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_FALSA, access_token: TOKEN_FALSO_2 },
                recusado.buscar,
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_desligado, true);
            assertEquals(corpo.aviso.includes("Desliguei"), true);
            assertEquals(corpo.pix_ligado, false);
            assertEquals(corpo.faltando, ["teste"]);
            assertEquals(corpo.ultimo_teste.conectado, false);
            // Desligou no MESMO update que publicou a chave.
            assertEquals(estado.updatesLoja.length, 1);
            assertEquals(estado.updatesLoja[0].pagamento_online, false);
            assertEquals(estado.updatesLoja[0].mp_public_key, PUBLIC_KEY_FALSA);
            assertEquals(estado.loja.pagamento_online, false);
            // O token novo ficou gravado (cifrado) com o teste que falhou.
            assertEquals(
                JSON.parse(estado.valor!).mascara_token,
                `••••${TOKEN_FALSO_2.slice(-4)}`,
            );

            // De volta ao ar com o token que passa (salvar de novo, é troca)…
            await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_FALSA, access_token: TOKEN_FALSO },
                buscarMpFalso(200, OK_PRODUCAO).buscar,
            );
            assertEquals(estado.loja.pagamento_online, true);
            estado.updatesLoja.length = 0;

            // ...e re-salvar SEM trocar credencial (a tela manda o token vazio)
            // não pode derrubar o PIX de quem está vendendo.
            const reSalvar = await chamar(cliente, {
                acao: "salvar",
                public_key: PUBLIC_KEY_FALSA,
            });
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

    await t.step("C24b — retomar com a ficha sem a linha id = 1 também é falha explícita e honesta", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            await chamar(cliente, { acao: "desligar_pix" });
            // A linha id = 1 some ENTRE a pausa e o retomar (ex.: restauração
            // de backup) — o mesmo estado que C24 encena.
            estado.lojaSemLinhaAgora = true;
            const carimboAntes = JSON.parse(estado.valor!).pix_ligado_em;

            const respostaLigar = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(respostaLigar.status, 500);
            const corpoLigar = await respostaLigar.json();
            assertEquals(corpoLigar.pix_ligado, undefined);
            assertEquals(corpoLigar.erro.includes("não existe"), true);
            assertEquals(corpoLigar.erro.includes("suporte"), true);
            assertEquals(corpoLigar.erro.includes("Tente de novo"), false);
            // Nada acendeu — e o registro não carimbou um "ligou" que não ligou.
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(JSON.parse(estado.valor!).pix_ligado_em, carimboAntes);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C25 — carimbo de auditoria falhou com o PIX já aceso (retomar) -> 200 com aviso, nunca 'falhou'", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            await chamar(cliente, { acao: "desligar_pix" });
            // Retomar grava 2 vezes: (1) tira a pausa, (2) carimba quem
            // ligou. Só a 2ª (o carimbo) estoura, DEPOIS de a ficha acender.
            estado.upsertsPermitidos = estado.upserts.length + 1;

            const resposta = await chamar(cliente, { acao: "ligar_pix" });
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

    await t.step("C26 — trocar SÓ a Public Key (sem mexer no Access Token) é troca de credencial: testa na hora e, se falhar, desliga o PIX aceso", async () => {
        // Prende a mutação `trocouPublicKey = false`: com ela, este cenário
        // (token vazio no corpo — nenhuma troca de TOKEN) não testaria nada e
        // a loja ficaria vendendo com o Payment Brick de OUTRA conta sem uma
        // palavra ao lojista.
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            estado.updatesLoja.length = 0;

            const PUBLIC_KEY_TROCADA = "APP_USR-publica-falsa-de-outra-conta";
            const mp = buscarMpFalso(401, { message: "invalid token" });
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_TROCADA },
                mp.buscar,
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            // O teste rodou, com o token JÁ SALVO (decifrado).
            assertEquals(mp.anotacoes.length, 1);
            assertEquals(mp.anotacoes[0].bearer, `Bearer ${TOKEN_FALSO}`);
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
            await lojaLigada(cliente);
            assertEquals(estado.loja.pagamento_online, true);
            const registroAntesDaFalha = estado.valor;

            // A partir de agora, todo UPDATE na ficha é recusado (trigger
            // dominio_publico_so_muda_pela_frota caído, por exemplo).
            estado.falhaNaLojaAgora = true;

            const PUBLIC_KEY_NOVA = "APP_USR-publica-falsa-de-outra-conta";
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_NOVA, access_token: TOKEN_FALSO_2 },
                buscarMpFalso(200, OK_PRODUCAO).buscar,
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

    await t.step("C28 — os dois avisos (chave de TESTE + carimbo falhou) saem com pontuação entre eles (testar)", async () => {
        // Chave de SANDBOX (gera o primeiro aviso, que termina em "de
        // verdade" sem ponto) + app_settings fora do ar NA 2ª gravação (gera
        // o segundo, depois de a ficha já ter acendido): os DOIS avisos saem
        // juntos.
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            // As 3 chaves salvas com teste que FALHOU (401): ficha apagada.
            await chamar(cliente, TRES_CHAVES, buscarMpFalso(401, { message: "x" }).buscar);
            assertEquals(estado.loja.pagamento_online, false);
            // `testar` grava 2 vezes ao ligar: o resultado do teste e o
            // carimbo. Só o carimbo (a 2ª) estoura.
            estado.upsertsPermitidos = estado.upserts.length + 1;

            const { buscar } = buscarMpFalso(200, { live_mode: false, nickname: "Loja Sandbox" });
            const resposta = await chamar(cliente, { acao: "testar" }, buscar);
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, true);
            // A frase da chave de TESTE termina em "de verdade" (sem ponto
            // no código-fonte) — sem a normalização, o `join(" ")` colava a
            // frase seguinte direto nela.
            assertEquals(
                corpo.aviso.includes("de verdade. O PIX está ligado"),
                true,
            );
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C29 — gravarRegistro falha DEPOIS de a ficha já ter desligado o PIX: a ficha volta ao que era e o recado diz que nada mudou (R2)", async () => {
        // Ordem ficha-primeiro (C27): a ficha já apagou `pagamento_online`
        // quando o `app_settings` (o registro cifrado) estoura. O registro
        // antigo (a credencial que vendia) continua de pé; então a ficha é
        // DEVOLVIDA ao que era — antes (30/09) ela ficava desligada com um
        // recado "desliguei por segurança", e a loja parava de vender por
        // causa de uma escrita que nem valeu.
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            assertEquals(estado.loja.pagamento_online, true);
            const registroAntesDaFalha = estado.valor;

            // A partir de agora, todo upsert em app_settings estoura — no
            // MEIO do próximo `salvar`, depois de a ficha já ter escrito.
            estado.falhaNoUpsert = true;

            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: "APP_USR-publica-falsa-de-outra-conta", access_token: TOKEN_FALSO_2 },
                buscarMpFalso(401, { message: "invalid token" }).buscar,
            );
            assertEquals(resposta.status, 500);
            const corpo = await resposta.json();
            assertEquals(corpo.erro.includes("Não salvei as chaves"), true);
            assertEquals(corpo.erro.includes("nada mudou"), true);
            // A ficha voltou: ligada e com a Public Key ANTIGA.
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(estado.loja.mp_public_key, PUBLIC_KEY_FALSA);
            // O registro (a credencial) NÃO trocou: gravarRegistro recusou.
            assertEquals(estado.valor, registroAntesDaFalha);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("R2 — Public Key nova, ficha já ligada, teste OK e o registro estoura: a ficha NÃO fica com a chave nova e o registro velho", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            const registroAntes = estado.valor;
            estado.falhaNoUpsert = true;
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: "APP_USR-publica-falsa-de-outra-conta" },
                buscarMpFalso(200, OK_PRODUCAO).buscar,
            );
            assertEquals(resposta.status, 500);
            const corpo = await resposta.json();
            assertEquals(corpo.erro.includes("nada mudou"), true);
            // O PIX segue ligado (o teste passou, não houve mudança de
            // pagamento) e a Public Key da ficha é a de antes.
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(estado.loja.mp_public_key, PUBLIC_KEY_FALSA);
            assertEquals(estado.valor, registroAntes);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("R2b — a reversão da ficha também falha: 500 pede o suporte e não promete que nada mudou", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            estado.falhaNoUpsert = true;
            // A ficha aceita o 1º update (publicar a chave nova) e recusa o
            // 2º (a reversão).
            const original = cliente.from;
            let updates = 0;
            cliente.from = (nome: string) => {
                const tabela = original(nome);
                if (nome !== "store_config") return tabela;
                return {
                    ...tabela,
                    update: (linha: any) => {
                        updates++;
                        if (updates >= 2) {
                            const recusa = { error: { message: "banco fora" }, data: null };
                            return {
                                eq: () => ({
                                    select: () => Promise.resolve(recusa),
                                    then: (ok: any) => Promise.resolve(recusa).then(ok),
                                }),
                            };
                        }
                        return tabela.update(linha);
                    },
                };
            };
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: "APP_USR-publica-falsa-de-outra-conta" },
                buscarMpFalso(200, OK_PRODUCAO).buscar,
            );
            assertEquals(resposta.status, 500);
            const corpo = await resposta.json();
            assertEquals(corpo.erro.includes("suporte"), true);
            assertEquals(corpo.erro.includes("nada mudou"), false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("R1a — pausa gravada ENTRE a leitura e a escrita do testar: o testar herda a pausa fresca e NÃO religa", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            // Enquanto o MP responde ao teste, o lojista aperta Pausar
            // (ficha apagada + pausa no registro).
            const buscar = (async () => {
                estado.loja.pagamento_online = false;
                const r = JSON.parse(estado.valor!);
                r.pagamento_pausado = true;
                r.pausado_em = "2026-09-30T12:00:00.000Z";
                r.pausado_por = ID_ADMIN;
                estado.valor = JSON.stringify(r);
                return new Response(JSON.stringify(OK_PRODUCAO), { status: 200 });
            }) as any;
            estado.updatesLoja.length = 0;
            const resposta = await chamar(cliente, { acao: "testar" }, buscar);
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pausado, true);
            assertEquals(corpo.pix_ligado, false);
            // A pausa sobreviveu à gravação do resultado do teste...
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.pagamento_pausado, true);
            assertEquals(salvo.pausado_por, ID_ADMIN);
            assertEquals(salvo.ultimo_teste.conectado, true);
            // ...e a ficha continua apagada (nenhum update ligou).
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.updatesLoja.some((u: any) => u.pagamento_online === true), false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("R1b — pausa gravada durante o teste do SALVAR: o salvar herda a pausa fresca e não liga", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            const buscar = (async () => {
                estado.loja.pagamento_online = false;
                const r = JSON.parse(estado.valor!);
                r.pagamento_pausado = true;
                r.pausado_em = "2026-09-30T12:00:00.000Z";
                r.pausado_por = ID_ADMIN;
                estado.valor = JSON.stringify(r);
                return new Response(JSON.stringify(OK_PRODUCAO), { status: 200 });
            }) as any;
            estado.updatesLoja.length = 0;
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_FALSA, access_token: TOKEN_FALSO_2 },
                buscar,
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pausado, true);
            assertEquals(corpo.pix_ligado, false);
            assertEquals(JSON.parse(estado.valor!).pagamento_pausado, true);
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.updatesLoja.some((u: any) => u.pagamento_online === true), false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("Ra — a rede do teste caiu e a loja só vende pelo app: o 409 diz que tentar de novo pode resolver", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso({ falhaSemFormaDePagamento: true });
        try {
            await lojaLigada(cliente);
            const resposta = await chamar(
                cliente,
                { ...TRES_CHAVES, access_token: TOKEN_FALSO_2 },
                buscarMpRede().buscar,
            );
            assertEquals(resposta.status, 409);
            const corpo = await resposta.json();
            assertEquals(corpo.erro.includes("tentar de novo pode resolver"), true);
            assertEquals(corpo.erro.includes("Ligue ao menos uma forma de pagamento na entrega"), true);
            assertEquals(estado.loja.pagamento_online, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("Rb — `testou` na resposta do salvar diz se o MP foi chamado (re-salvar igual: false)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente } = supabaseFalso();
        try {
            const primeira = await (await chamar(cliente, TRES_CHAVES, buscarMpFalso(200, OK_PRODUCAO).buscar)).json();
            assertEquals(primeira.testou, true);
            const reSalvar = await (await chamar(cliente, { acao: "salvar", public_key: PUBLIC_KEY_FALSA })).json();
            assertEquals(reSalvar.testou, false);
        } finally {
            desfazerEnv();
        }
    });

    // ══════════════════════════════════════════════════════════════════════
    // CASOS NOVOS DA LIBERAÇÃO AUTOMÁTICA
    // ══════════════════════════════════════════════════════════════════════

    await t.step("L1 — sem a chave de notificações NÃO liga, mesmo com o teste que passou (a ficha só recebe a Public Key)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            const mp = buscarMpFalso(200, OK_PRODUCAO);
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_FALSA, access_token: TOKEN_FALSO },
                mp.buscar,
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, false);
            assertEquals(corpo.faltando, ["chave_notificacoes"]);
            assertEquals(corpo.ultimo_teste.conectado, true);
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.updatesLoja.length, 1);
            assertEquals(Object.keys(estado.updatesLoja[0]), ["mp_public_key"]);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L2 — teste recusado (401) NÃO liga: o resultado fica gravado e o aviso diz o que fazer", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            const mp = buscarMpFalso(401, { message: "invalid token" });
            const resposta = await chamar(cliente, TRES_CHAVES, mp.buscar);
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, false);
            assertEquals(corpo.faltando, ["teste"]);
            assertEquals(corpo.ultimo_teste.conectado, false);
            assertEquals(corpo.ultimo_teste.mensagem.includes("recusou"), true);
            assertEquals(corpo.aviso.includes("não ligou"), true);
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(JSON.parse(estado.valor!).ultimo_teste.conectado, false);
            assertEquals(JSON.stringify(corpo).includes(TOKEN_FALSO), false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L3 — erro de REDE no teste do salvar: conectado=false, não liga, sem 500, e a resposta manda tocar em Testar", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            const mp = buscarMpRede();
            const resposta = await chamar(cliente, TRES_CHAVES, mp.buscar);
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, false);
            assertEquals(corpo.ultimo_teste.conectado, false);
            assertEquals(corpo.aviso.includes("Testar conexão"), true);
            assertEquals(estado.loja.pagamento_online, false);
            // As chaves FORAM salvas (só o teste é que não deu para fazer).
            assertEquals(JSON.parse(estado.valor!).mascara_token, `••••${TOKEN_FALSO.slice(-4)}`);
            // E o `testar` manual depois, com a rede de volta, liga.
            const depois = await chamar(cliente, { acao: "testar" }, buscarMpFalso(200, OK_PRODUCAO).buscar);
            assertEquals((await depois.json()).pix_ligado, true);
            assertEquals(estado.loja.pagamento_online, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L4 — trocar para um token que PASSA no teste mantém o PIX aceso (sem mexer em pagamento_online)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            estado.updatesLoja.length = 0;
            const mp = buscarMpFalso(200, OK_PRODUCAO);
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_FALSA, access_token: TOKEN_FALSO_2 },
                mp.buscar,
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, true);
            assertEquals(corpo.pix_desligado, undefined);
            assertEquals(mp.anotacoes[0].bearer, `Bearer ${TOKEN_FALSO_2}`);
            // Estava ligado e continua: a ficha só recebeu a Public Key.
            assertEquals(Object.keys(estado.updatesLoja[0]), ["mp_public_key"]);
            assertEquals(JSON.parse(estado.valor!).pix_ligado_por, ID_ADMIN);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L5 — a PAUSA vence salvar e testar: nenhum dos dois religa; só retomar", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            await chamar(cliente, { acao: "desligar_pix" });
            assertEquals(estado.loja.pagamento_online, false);
            estado.updatesLoja.length = 0;

            // Salvar credencial nova com teste que PASSA: a pausa segura.
            const salvou = await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_FALSA, access_token: TOKEN_FALSO_2 },
                buscarMpFalso(200, OK_PRODUCAO).buscar,
            );
            const corpoSalvar = await salvou.json();
            assertEquals(corpoSalvar.pix_ligado, false);
            assertEquals(corpoSalvar.pausado, true);
            assertEquals(corpoSalvar.faltando, []);
            assertEquals(estado.loja.pagamento_online, false);
            // A pausa atravessa o salvar (o registro é regravado por inteiro).
            assertEquals(JSON.parse(estado.valor!).pagamento_pausado, true);

            // Testar com sucesso: também não religa.
            const testou = await chamar(cliente, { acao: "testar" }, buscarMpFalso(200, OK_PRODUCAO).buscar);
            const corpoTestar = await testou.json();
            assertEquals(corpoTestar.conectado, true);
            assertEquals(corpoTestar.pix_ligado, false);
            assertEquals(corpoTestar.pausado, true);
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.updatesLoja.some((u: any) => u.pagamento_online === true), false);
            assertEquals(JSON.parse(estado.valor!).pagamento_pausado, true);

            // Só "retomar" (ligar_pix) religa e limpa a pausa.
            const retomou = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(retomou.status, 200);
            assertEquals((await retomou.json()).pix_ligado, true);
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(JSON.parse(estado.valor!).pagamento_pausado, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L6 — retomar com falta -> 409 com o recado do que falta e NENHUMA escrita (nem a pausa sai)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            await chamar(cliente, { acao: "desligar_pix" });
            // Registro pela metade: o token cifrado sumiu (ex.: restauração).
            const registro = JSON.parse(estado.valor!);
            registro.token_cifrado = "";
            estado.valor = JSON.stringify(registro);
            const registroAntes = estado.valor;
            estado.updatesLoja.length = 0;
            const upsertsAntes = estado.upserts.length;

            const resposta = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(resposta.status, 409);
            assertEquals((await resposta.json()).erro.includes("Access Token"), true);
            assertEquals(estado.updatesLoja.length, 0);
            assertEquals(estado.upserts.length, upsertsAntes);
            // A pausa continua de pé (nada foi gravado).
            assertEquals(estado.valor, registroAntes);
            assertEquals(JSON.parse(estado.valor!).pagamento_pausado, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L7 — `ler` NUNCA escreve, nem quando o registro e a ficha discordam (sem registro, legado, ligado sem chave)", async () => {
        const desfazerEnv = prepararEnv();
        try {
            // (a) nenhum registro ainda: tudo falta, nada é escrito.
            {
                const { cliente, estado } = supabaseFalso();
                const corpo = await (await chamar(cliente, { acao: "ler" })).json();
                assertEquals(corpo.configurado, false);
                assertEquals(corpo.faltando, ["public_key", "access_token", "chave_notificacoes", "teste"]);
                assertEquals(corpo.pausado, false);
                assertEquals(estado.upserts.length, 0);
                assertEquals(estado.updatesLoja.length, 0);
            }
            // (b) ficha LIGADA por fora e registro sem a chave de
            // notificações: `ler` conta a falta, mas NÃO desliga sozinho.
            {
                const { cliente, estado } = supabaseFalso();
                await prepararLojaTestada(cliente);
                estado.loja.pagamento_online = true;
                estado.updatesLoja.length = 0;
                const upsertsAntes = estado.upserts.length;
                const corpo = await (await chamar(cliente, { acao: "ler" })).json();
                assertEquals(corpo.pix_ligado, true);
                assertEquals(corpo.faltando, ["chave_notificacoes"]);
                assertEquals(estado.loja.pagamento_online, true);
                assertEquals(estado.updatesLoja.length, 0);
                assertEquals(estado.upserts.length, upsertsAntes);
            }
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L8 — re-salvar IDÊNTICO não chama o MP nem mexe no estado (só republica a Public Key)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            const testeAntes = JSON.parse(estado.valor!).ultimo_teste;
            estado.updatesLoja.length = 0;

            const espia = buscarMpFalso(200, OK_PRODUCAO);
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_FALSA },
                espia.buscar,
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(espia.anotacoes.length, 0);
            assertEquals(corpo.pix_ligado, true);
            assertEquals(corpo.aviso, undefined);
            assertEquals(Object.keys(estado.updatesLoja[0]), ["mp_public_key"]);
            assertEquals(JSON.parse(estado.valor!).ultimo_teste, testeAntes);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L8b — re-salvar IDÊNTICO não corrige a ficha nem para um lado nem para o outro (loja que já existia com o estado antigo só muda quando algo MUDA)", async () => {
        const desfazerEnv = prepararEnv();
        try {
            // (a) tudo pronto, mas a ficha está desligada (desligada à mão no
            // modelo antigo): re-salvar igual NÃO liga.
            {
                const { cliente, estado } = supabaseFalso();
                await lojaLigada(cliente);
                estado.loja.pagamento_online = false;
                estado.updatesLoja.length = 0;
                const corpo = await (
                    await chamar(cliente, { acao: "salvar", public_key: PUBLIC_KEY_FALSA })
                ).json();
                assertEquals(corpo.pix_ligado, false);
                assertEquals(estado.loja.pagamento_online, false);
                assertEquals(Object.keys(estado.updatesLoja[0]), ["mp_public_key"]);
            }
            // (b) ficha ligada por fora com o registro sem a chave de
            // notificações: re-salvar igual NÃO desliga.
            {
                const { cliente, estado } = supabaseFalso();
                await prepararLojaTestada(cliente);
                estado.loja.pagamento_online = true;
                estado.updatesLoja.length = 0;
                const corpo = await (
                    await chamar(cliente, { acao: "salvar", public_key: PUBLIC_KEY_FALSA })
                ).json();
                assertEquals(corpo.pix_ligado, true);
                assertEquals(corpo.faltando, ["chave_notificacoes"]);
                assertEquals(estado.loja.pagamento_online, true);
                assertEquals(Object.keys(estado.updatesLoja[0]), ["mp_public_key"]);
            }
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L9 — faltasParaReceber: ordem fixa e uma falta por causa", () => {
        const teste = { quando: "x", conectado: true, mensagem: "ok", ambiente: null, conta: null };
        const completo = {
            public_key: PUBLIC_KEY_FALSA,
            token_cifrado: "c",
            token_iv: "i",
            mascara_token: "••••1",
            webhook_cifrado: "w",
            webhook_iv: "v",
            mascara_webhook: "••••2",
            ultimo_teste: teste,
            atualizado_em: "x",
        };
        assertEquals(faltasParaReceber(completo), []);
        assertEquals(faltasParaReceber(null), ["public_key", "access_token", "chave_notificacoes", "teste"]);
        assertEquals(faltasParaReceber(undefined).length, 4);
        assertEquals(faltasParaReceber({ ...completo, public_key: "" }), ["public_key"]);
        assertEquals(faltasParaReceber({ ...completo, public_key: "chave-sem-prefixo" }), ["public_key"]);
        assertEquals(faltasParaReceber({ ...completo, token_cifrado: "" }), ["access_token"]);
        assertEquals(faltasParaReceber({ ...completo, token_iv: "" }), ["access_token"]);
        assertEquals(faltasParaReceber({ ...completo, webhook_cifrado: null }), ["chave_notificacoes"]);
        assertEquals(faltasParaReceber({ ...completo, webhook_iv: null }), ["chave_notificacoes"]);
        assertEquals(faltasParaReceber({ ...completo, ultimo_teste: null }), ["teste"]);
        assertEquals(faltasParaReceber({ ...completo, ultimo_teste: { ...teste, conectado: false } }), ["teste"]);
        // Várias faltas saem na ORDEM fixa.
        assertEquals(
            faltasParaReceber({ ...completo, webhook_cifrado: null, public_key: "", ultimo_teste: null }),
            ["public_key", "chave_notificacoes", "teste"],
        );
        // A pausa NÃO é falta: registro pausado e completo não tem faltas.
        assertEquals(faltasParaReceber({ ...completo, pagamento_pausado: true }), []);
    });

    await t.step("L10 — testar que FALHA e o invariante recusa desligar: 200, o teste fica gravado, a ficha fica como estava e há aviso claro (sem 500)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso({
            falhaSemFormaDePagamento: true,
        });
        try {
            await lojaLigada(cliente);
            const resposta = await chamar(
                cliente,
                { acao: "testar" },
                buscarMpFalso(401, { message: "invalid token" }).buscar,
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.conectado, false);
            assertEquals(corpo.pix_ligado, true);
            assertEquals(corpo.aviso.includes("forma de pagamento na entrega"), true);
            assertEquals(estado.loja.pagamento_online, true);
            assertEquals(JSON.parse(estado.valor!).ultimo_teste.conectado, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L11 — testar reconcilia: liga quando tudo passa, e só escreve na ficha quando o estado MUDA", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await chamar(cliente, TRES_CHAVES, buscarMpFalso(401, { message: "x" }).buscar);
            assertEquals(estado.loja.pagamento_online, false);
            estado.updatesLoja.length = 0;

            const primeira = await chamar(cliente, { acao: "testar" }, buscarMpFalso(200, OK_PRODUCAO).buscar);
            const corpo = await primeira.json();
            assertEquals(corpo.conectado, true);
            assertEquals(corpo.pix_ligado, true);
            // O painel de Ajustes infere "chave OK" a partir daqui: a resposta
            // diz o que a ficha REALMENTE carrega.
            assertEquals(corpo.public_key_na_loja, true);
            assertEquals(corpo.faltando, []);
            assertEquals(estado.updatesLoja.length, 1);
            assertEquals(estado.updatesLoja[0].pagamento_online, true);
            assertEquals(estado.updatesLoja[0].mp_public_key, PUBLIC_KEY_FALSA);
            assertEquals(JSON.parse(estado.valor!).pix_ligado_por, ID_ADMIN);

            // Segundo teste que passa: já está em sincronia, nada a escrever.
            await chamar(cliente, { acao: "testar" }, buscarMpFalso(200, OK_PRODUCAO).buscar);
            assertEquals(estado.updatesLoja.length, 1);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L12 — testar que FALHA desliga o PIX aceso e conta isso", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            const resposta = await chamar(
                cliente,
                { acao: "testar" },
                buscarMpFalso(401, { message: "invalid token" }).buscar,
            );
            const corpo = await resposta.json();
            assertEquals(corpo.conectado, false);
            assertEquals(corpo.pix_ligado, false);
            assertEquals(corpo.faltando, ["teste"]);
            assertEquals(corpo.aviso.includes("Desliguei"), true);
            assertEquals(estado.loja.pagamento_online, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L13 — ficha LIGADA com a Public Key errada/ausente é corrigida no reconcilia (não vira 'em sincronia' falso)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            estado.loja.mp_public_key = null;
            estado.updatesLoja.length = 0;
            const corpo = await (
                await chamar(cliente, { acao: "testar" }, buscarMpFalso(200, OK_PRODUCAO).buscar)
            ).json();
            assertEquals(corpo.pix_ligado, true);
            assertEquals(estado.updatesLoja.length, 1);
            assertEquals(estado.updatesLoja[0].pagamento_online, true);
            assertEquals(estado.updatesLoja[0].mp_public_key, PUBLIC_KEY_FALSA);
            assertEquals(estado.loja.mp_public_key, PUBLIC_KEY_FALSA);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L14 — primeira vez: a ficha liga e o registro estoura -> reverte a ficha (nunca aceso sem registro por trás) e responde 500", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            estado.falhaNoUpsert = true;
            const resposta = await chamar(cliente, TRES_CHAVES, buscarMpFalso(200, OK_PRODUCAO).buscar);
            assertEquals(resposta.status, 500);
            const corpo = await resposta.json();
            assertEquals(corpo.erro.includes("Não salvei as chaves"), true);
            // Sem registro gravado, a ficha NÃO pode ficar aceso (o
            // criar-pagamento cairia nas chaves da plataforma).
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.valor, null);
            assertEquals(estado.updatesLoja[estado.updatesLoja.length - 1], { mp_public_key: null, pagamento_online: false });
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L15 — token salvo ilegível + só a chave de notificações nova: o teste falha SEM 500, e o recado diz para colar de novo", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            const registro = JSON.parse(estado.valor!);
            registro.token_cifrado = "lixo-que-nao-decifra";
            estado.valor = JSON.stringify(registro);
            const espia = buscarMpFalso(200, OK_PRODUCAO);
            const resposta = await chamar(
                cliente,
                { acao: "salvar", public_key: PUBLIC_KEY_FALSA, webhook_secret: "outro-segredo-de-webhook-1234" },
                espia.buscar,
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(espia.anotacoes.length, 0);
            assertEquals(corpo.ultimo_teste.conectado, false);
            assertEquals(corpo.ultimo_teste.mensagem.includes("Não consegui ler a chave salva"), true);
            assertEquals(corpo.pix_ligado, false);
            assertEquals(estado.loja.pagamento_online, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L16 — dado que JÁ EXISTIA (registro sem os campos de pausa, ficha desligada, tudo completo): `ler` conta e não escreve; o próximo testar liga", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            // Volta ao formato de ANTES: sem nenhum campo de pausa, e a
            // ficha desligada (a loja tinha desligado no modelo manual).
            const registro = JSON.parse(estado.valor!);
            delete registro.pagamento_pausado;
            delete registro.pausado_em;
            delete registro.pausado_por;
            estado.valor = JSON.stringify(registro);
            estado.loja.pagamento_online = false;
            estado.updatesLoja.length = 0;
            const registroAntes = estado.valor;

            const lido = await (await chamar(cliente, { acao: "ler" })).json();
            assertEquals(lido.pausado, false);
            assertEquals(lido.faltando, []);
            assertEquals(lido.pix_ligado, false);
            assertEquals(estado.updatesLoja.length, 0);
            assertEquals(estado.valor, registroAntes);

            // Sem pausa registrada, a reconciliação do testar o liga.
            const testou = await (
                await chamar(cliente, { acao: "testar" }, buscarMpFalso(200, OK_PRODUCAO).buscar)
            ).json();
            assertEquals(testou.pix_ligado, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L17 — pausar sem nenhum registro: só apaga a ficha (não inventa registro pela metade)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            // Loja que vendia pelas chaves da PLATAFORMA (sem registro).
            estado.loja.pagamento_online = true;
            const resposta = await chamar(cliente, { acao: "desligar_pix" });
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.pix_ligado, false);
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.upserts.length, 0);
            assertEquals(estado.valor, null);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L18 — pausar: a ficha apaga mas o registro estoura -> 500 honesto (a pausa não ficou registrada)", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            estado.falhaNoUpsert = true;
            const resposta = await chamar(cliente, { acao: "desligar_pix" });
            assertEquals(resposta.status, 500);
            const corpo = await resposta.json();
            assertEquals(corpo.erro.includes("pausa"), true);
            // A ficha apagou (o lado seguro), e a tela vai contar isso.
            assertEquals(estado.loja.pagamento_online, false);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L19 — retomar: o registro (tirar a pausa) estoura ANTES da ficha -> 500 e a ficha NÃO acende", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await lojaLigada(cliente);
            await chamar(cliente, { acao: "desligar_pix" });
            estado.falhaNoUpsert = true;
            estado.updatesLoja.length = 0;
            const resposta = await chamar(cliente, { acao: "ligar_pix" });
            assertEquals(resposta.status, 500);
            assertEquals(estado.loja.pagamento_online, false);
            assertEquals(estado.updatesLoja.length, 0);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("L20 — testar com a ficha recusando LIGAR (linha sumiu): 200 com aviso do suporte, o teste fica gravado", async () => {
        const desfazerEnv = prepararEnv();
        const { cliente, estado } = supabaseFalso();
        try {
            await chamar(cliente, TRES_CHAVES, buscarMpFalso(401, { message: "x" }).buscar);
            estado.lojaSemLinhaAgora = true;
            const resposta = await chamar(cliente, { acao: "testar" }, buscarMpFalso(200, OK_PRODUCAO).buscar);
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.conectado, true);
            assertEquals(corpo.pix_ligado, false);
            assertEquals(corpo.aviso.includes("suporte"), true);
            assertEquals(JSON.parse(estado.valor!).ultimo_teste.conectado, true);
        } finally {
            desfazerEnv();
        }
    });

    await t.step("C30 — MP responde 200 sem live_mode (endpoint real de /users/me): sem afirmar ambiente", async () => {
        // Medido em 25/09/2026: `GET /users/me` do Mercado Pago NÃO devolve
        // `live_mode` (o struct oficial do SDK Go do MP só tem id, nickname,
        // first_name, last_name, country_id, email, site_id). Com credencial
        // de PRODUÇÃO a tela mostrava "Conectado! Conta X no ambiente de
        // teste." — `ambiente` cai em null e a mensagem não pode afirmar
        // nenhum dos dois ambientes.
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
                id: 123456,
                nickname: "Loja Real",
                site_id: "MLB",
            });
            const resposta = await comFetch(fetchAdminFalso, () =>
                handler(requisicao({ acao: "testar" }), { supabase: cliente, buscar })
            );
            assertEquals(resposta.status, 200);
            const corpo = await resposta.json();
            assertEquals(corpo.conectado, true);
            assertEquals(corpo.ambiente, null);
            assertEquals(corpo.mensagem.includes("de teste"), false);
            assertEquals(corpo.mensagem.includes("de produção"), false);
            assertEquals(corpo.mensagem.includes("Loja Real"), true);
            const salvo = JSON.parse(estado.valor!);
            assertEquals(salvo.ultimo_teste.ambiente, null);
        } finally {
            desfazerEnv();
        }
    });
});
