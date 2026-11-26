// Troca de CONTA do Mercado Pago com pagamento ainda em aberto (26/11/2026).
//
// O defeito: a lojista troca as chaves para uma conta DIFERENTE (pessoa física
// -> empresa) enquanto um pedido espera o PIX (ou o 3DS do cartão) cobrado na
// conta ANTIGA. Depois da troca o webhook só aceita a assinatura da chave nova
// (o aviso da conta antiga leva 401 para sempre) e a reconciliação consulta com
// o token novo (não acha a cobrança): o pedido expira, o estoque volta à venda,
// o dinheiro cai na conta antiga e o aviso de pagamento atrasado (P1) nunca sai.
//
// A regra: com pedido na fila da reconciliação (`pagamentos_a_reconciliar`, o
// MESMO critério de quem ela consulta), `salvar` recusa um Access Token de
// OUTRA conta (409, nada gravado). Mesma conta, fila vazia ou primeira
// configuração seguem como antes. Conta que não se consegue identificar com
// fila cheia também recusa (falha nunca libera). Nenhuma rede real.
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const URL_SUPA_TESTE = "https://supa-fake.local";
const ID_ADMIN = "admin-troca-de-conta-fixture";
const PUBLIC_KEY_FALSA = "APP_USR-11111111-1111-4111-8111-111111111111";
const WEBHOOK_FALSO = "notificacoes-fixture-troca-de-conta";
// Tokens FALSOS de mentira; cada um "pertence" a uma conta do dublê abaixo.
const TOKEN_PF = "APP_USR-token-fixture-pessoa-fisica";
const TOKEN_PF_RENOVADO = "APP_USR-token-fixture-pessoa-fisica-renovado";
const TOKEN_PJ = "APP_USR-token-fixture-empresa";
const TOKEN_RECUSADO = "APP_USR-token-fixture-recusado";
const TOKEN_PF_TESTE = "TEST-token-fixture-pessoa-fisica-sandbox";
const CHAVE_CIFRA_TESTE = btoa(
    String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 5 + 9) % 256)),
);

const CONTAS = new Map<string, { id: number; nickname: string }>([
    [TOKEN_PF, { id: 111111, nickname: "LOJAPF" }],
    [TOKEN_PF_RENOVADO, { id: 111111, nickname: "LOJAPF" }],
    [TOKEN_PJ, { id: 222222, nickname: "LOJAPJ" }],
    // Credencial de TESTE (prefixo TEST-) da MESMA conta: mesmo id, outro ambiente.
    [TOKEN_PF_TESTE, { id: 111111, nickname: "LOJAPF" }],
]);

function respostaJson(corpo: unknown, status = 200): Response {
    return new Response(JSON.stringify(corpo), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

// Mesmo molde de index_test.ts: a porta de admin cria seus próprios clients.
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
    const anteriores = pares.map(([nome]) => [nome, Deno.env.get(nome)] as const);
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
type Fila = { data: Array<{ order_id: string; gateway_payment_id: string }> | null; error: unknown };

function supabaseFalso() {
    const estado = {
        valor: null as string | null,
        loja: { pagamento_online: false, mp_public_key: null } as Ficha,
        upserts: [] as LinhaRegistro[],
        updatesLoja: [] as Partial<Ficha>[],
        fila: { data: [], error: null } as Fila,
        consultasDaFila: 0,
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
            rpc(nome: string, argumentos?: unknown) {
                // A fila é a MESMA que a reconciliação consulta, sem argumento.
                assertEquals(nome, "pagamentos_a_reconciliar");
                assertEquals(argumentos, undefined);
                estado.consultasDaFila++;
                return Promise.resolve(estado.fila);
            },
        },
    };
}

const PEDIDOS_AGUARDANDO = [
    { order_id: "pedido-fixture-1", gateway_payment_id: "ORD01FIXTUREAAAA" },
    { order_id: "pedido-fixture-2", gateway_payment_id: "ORD01FIXTUREBBBB" },
];

/** Uma loja já vendendo com a conta de pessoa física (semeada pelo handler real). */
async function lojaVendendoNaContaPf() {
    const { cliente, estado } = supabaseFalso();
    const tokensConsultados: string[] = [];
    // Tokens que o MP passa a RECUSAR (revogados/expirados -> 401) e tokens
    // cuja consulta cai na REDE (sem resposta) — mudam no meio de cada caso.
    const revogados = new Set<string>();
    const semRede = new Set<string>();
    const buscar = (url: string, init?: RequestInit): Promise<Response> => {
        assertEquals(url, "https://api.mercadopago.com/users/me");
        const token = String(new Headers(init?.headers).get("Authorization")).replace(/^Bearer /, "");
        tokensConsultados.push(token);
        if (semRede.has(token)) return Promise.reject(new TypeError("fixture: rede caiu"));
        const conta = revogados.has(token) ? undefined : CONTAS.get(token);
        if (!conta) return Promise.resolve(respostaJson({ message: "invalid_token" }, 401));
        return Promise.resolve(respostaJson({ ...conta, tags: ["normal"], site_id: "MLB" }));
    };
    const testar = () =>
        handler(new Request("http://local/credenciais-mercado-pago", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-fixture" },
            body: JSON.stringify({ acao: "testar" }),
        }), { supabase: cliente, buscar, donoAtual: async () => ID_ADMIN });
    const salvar = (accessToken: string) =>
        handler(new Request("http://local/credenciais-mercado-pago", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-fixture" },
            body: JSON.stringify({
                acao: "salvar",
                public_key: PUBLIC_KEY_FALSA,
                access_token: accessToken,
                webhook_secret: WEBHOOK_FALSO,
            }),
        }), { supabase: cliente, buscar, donoAtual: async () => ID_ADMIN });

    // Primeira configuração: mesmo com pedido na fila (ex.: cobrado pelas chaves
    // da plataforma), não há conta anterior da loja a proteger — e a fila nem é
    // consultada.
    estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };
    const primeira = await salvar(TOKEN_PF);
    assertEquals(primeira.status, 200);
    assertEquals((await primeira.json()).pix_ligado, true);
    assertEquals(estado.consultasDaFila, 0, "primeira configuração não consulta a fila");
    estado.fila = { data: [], error: null };
    estado.consultasDaFila = 0;
    tokensConsultados.length = 0;
    estado.upserts.length = 0;
    estado.updatesLoja.length = 0;
    return {
        salvar,
        testar,
        estado,
        tokensConsultados,
        revogados,
        semRede,
        registroAnterior: estado.valor,
        fichaAnterior: { ...estado.loja },
    };
}

/** Apaga o id da conta do registro: o que existe gravado antes desta correção. */
function comoRegistroLegado(estado: { valor: string | null }) {
    const registro = JSON.parse(String(estado.valor));
    delete registro.ultimo_teste.conta_id;
    estado.valor = JSON.stringify(registro);
}

function nadaGravado(
    estado: ReturnType<typeof supabaseFalso>["estado"],
    registroAnterior: string | null,
    fichaAnterior: Ficha,
) {
    assertEquals(estado.upserts, [], "a recusa não pode gravar o registro");
    assertEquals(estado.updatesLoja, [], "a recusa não pode gravar a ficha");
    assertEquals(estado.valor, registroAnterior);
    assertEquals(estado.loja, fichaAnterior);
}

/** Estraga o token cifrado do registro: o cofre não consegue mais decifrá-lo. */
function comTokenIlegivel(estado: { valor: string | null }) {
    const registro = JSON.parse(String(estado.valor));
    registro.token_cifrado = btoa("lixo-que-nao-decifra-fixture");
    estado.valor = JSON.stringify(registro);
}

// Sem "cancele": a fila inclui de propósito o pedido aguardando E cancelado
// (o PIX dele ainda pode ser pago), então cancelar não destrava a troca.
const ESPERE =
    "Espere esses pagamentos terminarem e troque depois: o PIX sai da conferência quando vence e é conferido (cerca de 1 hora), e um cartão em análise pode levar alguns dias. Nada foi salvo.";
const RECUSA_CONTA_DIFERENTE =
    `Há 2 pedido(s) aguardando pagamento na conta atual do Mercado Pago, e as chaves novas são de outra conta. Se trocar agora, esses pagamentos não seriam mais conferidos pelo app. ${ESPERE}`;
const RECUSA_CONTA_INCERTA =
    `Há 2 pedido(s) aguardando pagamento na conta atual do Mercado Pago, e não consegui confirmar se as chaves novas são da mesma conta. Se trocar agora, esses pagamentos podem não ser mais conferidos pelo app. ${ESPERE}`;
const RECUSA_AMBIENTE_DIFERENTE =
    `Há 2 pedido(s) aguardando pagamento na conta atual do Mercado Pago, e as chaves novas são de outro ambiente (teste e produção não se misturam). Se trocar agora, esses pagamentos não seriam mais conferidos pelo app. ${ESPERE}`;

Deno.test("troca de conta do Mercado Pago com pagamento em aberto", async (t) => {
    const desfazerEnv = prepararEnv();
    const fetchAnterior = globalThis.fetch;
    globalThis.fetch = fetchAdminFalso;
    try {
        await t.step("conta DIFERENTE + pedido aguardando -> 409 e nada gravado", async () => {
            const { salvar, estado, registroAnterior, fichaAnterior } = await lojaVendendoNaContaPf();
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PJ);
            const corpo = await resposta.json();
            nadaGravado(estado, registroAnterior, fichaAnterior);
            assertEquals(estado.consultasDaFila, 1);
            assertEquals(resposta.status, 409);
            assertEquals(corpo, { erro: RECUSA_CONTA_DIFERENTE });
        });

        await t.step("conta DIFERENTE + nenhum pedido aguardando -> troca", async () => {
            const { salvar, estado } = await lojaVendendoNaContaPf();

            const resposta = await salvar(TOKEN_PJ);
            const corpo = await resposta.json();
            assertEquals(resposta.status, 200);
            assertEquals(estado.consultasDaFila, 1);
            assertEquals(estado.upserts.length, 1);
            assertEquals(corpo.ultimo_teste.conta, "LOJAPJ");
            assertEquals(JSON.parse(String(estado.valor)).ultimo_teste.conta_id, "222222");
        });

        await t.step("MESMA conta (token renovado) + pedido aguardando -> troca, sem consultar a fila", async () => {
            const { salvar, estado, tokensConsultados } = await lojaVendendoNaContaPf();
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PF_RENOVADO);
            assertEquals(resposta.status, 200);
            assertEquals(estado.upserts.length, 1);
            // O id da conta antiga veio do registro: só o token NOVO foi ao MP.
            assertEquals(tokensConsultados, [TOKEN_PF_RENOVADO]);
            assertEquals(estado.consultasDaFila, 0);
        });

        await t.step("re-salvar o MESMO token + pedido aguardando -> segue como antes", async () => {
            const { salvar, estado } = await lojaVendendoNaContaPf();
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PF);
            assertEquals(resposta.status, 200);
            assertEquals(estado.consultasDaFila, 0);
        });

        await t.step("registro LEGADO (sem id da conta) + mesma conta -> pergunta ao MP pelo token antigo e troca", async () => {
            const { salvar, estado, tokensConsultados } = await lojaVendendoNaContaPf();
            comoRegistroLegado(estado);
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PF_RENOVADO);
            assertEquals(resposta.status, 200);
            assertEquals(tokensConsultados, [TOKEN_PF_RENOVADO, TOKEN_PF]);
            assertEquals(JSON.parse(String(estado.valor)).ultimo_teste.conta_id, "111111");
        });

        await t.step("registro LEGADO + conta diferente + pedido aguardando -> 409", async () => {
            const { salvar, estado } = await lojaVendendoNaContaPf();
            comoRegistroLegado(estado);
            const registroLegado = estado.valor;
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PJ);
            const corpo = await resposta.json();
            nadaGravado(estado, registroLegado, { pagamento_online: true, mp_public_key: PUBLIC_KEY_FALSA });
            assertEquals(resposta.status, 409);
            assertEquals(corpo, { erro: RECUSA_CONTA_DIFERENTE });
        });

        await t.step("chave nova RECUSADA pelo MP + pedido aguardando -> 409 (conta incerta), nada gravado", async () => {
            const { salvar, estado, registroAnterior, fichaAnterior } = await lojaVendendoNaContaPf();
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_RECUSADO);
            const corpo = await resposta.json();
            nadaGravado(estado, registroAnterior, fichaAnterior);
            assertEquals(resposta.status, 409);
            assertEquals(corpo, { erro: RECUSA_CONTA_INCERTA });
        });

        await t.step("fila da reconciliação ilegível -> 503 e nada gravado (falha nunca libera)", async () => {
            const { salvar, estado, registroAnterior, fichaAnterior } = await lojaVendendoNaContaPf();
            estado.fila = { data: null, error: { message: "fixture: banco fora" } };

            const resposta = await salvar(TOKEN_PJ);
            const corpo = await resposta.json();
            nadaGravado(estado, registroAnterior, fichaAnterior);
            assertEquals(resposta.status, 503);
            assert(String(corpo.erro).includes("nada foi alterado"));
        });

        // ── Revisão Opus de 26/11/2026 ────────────────────────────────────

        await t.step("a recusa NUNCA manda cancelar (pedido cancelado continua na fila)", async () => {
            const { salvar, estado } = await lojaVendendoNaContaPf();
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const corpo = await (await salvar(TOKEN_PJ)).json();
            assert(!/cancel/i.test(String(corpo.erro)), `recado manda cancelar: ${corpo.erro}`);
        });

        // Token antigo MORTO (o MP o recusa com 401): ninguém mais concilia com
        // ele — nem a reconciliação, que usa o mesmo token —, então a fila não
        // esvazia sozinha por 24 h (PIX) a 14 dias (cartão). Recusar só prenderia
        // a loja; a chave nova é a única que volta a conciliar alguma coisa.
        await t.step("registro antigo + token antigo 401 + MESMA conta + fila -> troca", async () => {
            const { salvar, estado, revogados } = await lojaVendendoNaContaPf();
            comoRegistroLegado(estado);
            revogados.add(TOKEN_PF);
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PF_RENOVADO);
            assertEquals(resposta.status, 200);
            assertEquals(estado.upserts.length, 1);
        });

        await t.step("registro antigo + token antigo 401 + conta DIFERENTE + fila -> troca", async () => {
            const { salvar, estado, revogados } = await lojaVendendoNaContaPf();
            comoRegistroLegado(estado);
            revogados.add(TOKEN_PF);
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PJ);
            assertEquals(resposta.status, 200);
            assertEquals(estado.upserts.length, 1);
            assertEquals(JSON.parse(String(estado.valor)).ultimo_teste.conta_id, "222222");
        });

        await t.step("id gravado DIFERENTE + token antigo 401 + fila -> troca (o token antigo é que está morto)", async () => {
            const { salvar, estado, revogados } = await lojaVendendoNaContaPf();
            revogados.add(TOKEN_PF);
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PJ);
            assertEquals(resposta.status, 200);
        });

        await t.step("token antigo SEM RESPOSTA (rede) + conta diferente + fila -> 409, nada gravado", async () => {
            const { salvar, estado, semRede } = await lojaVendendoNaContaPf();
            comoRegistroLegado(estado);
            const registroLegado = estado.valor;
            semRede.add(TOKEN_PF);
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PJ);
            const corpo = await resposta.json();
            nadaGravado(estado, registroLegado, { pagamento_online: true, mp_public_key: PUBLIC_KEY_FALSA });
            assertEquals(resposta.status, 409);
            assertEquals(corpo, { erro: RECUSA_CONTA_INCERTA });
        });

        await t.step("token salvo que o cofre não decifra + fila -> troca (mesma regra do 401)", async () => {
            const { salvar, estado } = await lojaVendendoNaContaPf();
            comTokenIlegivel(estado);
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PJ);
            assertEquals(resposta.status, 200);
            assertEquals(estado.upserts.length, 1);
        });

        await t.step("testar que FALHA preserva o id da conta já gravado", async () => {
            const { testar, estado, revogados } = await lojaVendendoNaContaPf();
            revogados.add(TOKEN_PF);

            const resposta = await testar();
            assertEquals(resposta.status, 200);
            const teste = JSON.parse(String(estado.valor)).ultimo_teste;
            assertEquals(teste.conectado, false);
            assertEquals(teste.conta_id, "111111");
        });

        await t.step("salvar com token NOVO que falha NÃO herda o id da conta antiga", async () => {
            const { salvar, estado } = await lojaVendendoNaContaPf();

            const resposta = await salvar(TOKEN_RECUSADO);
            assertEquals(resposta.status, 200);
            const teste = JSON.parse(String(estado.valor)).ultimo_teste;
            assertEquals(teste.conectado, false);
            assertEquals(teste.conta_id, null);
        });

        await t.step("MESMO id em OUTRO ambiente (chave TEST-) + fila -> 409, nada gravado", async () => {
            const { salvar, estado, registroAnterior, fichaAnterior } = await lojaVendendoNaContaPf();
            estado.fila = { data: PEDIDOS_AGUARDANDO, error: null };

            const resposta = await salvar(TOKEN_PF_TESTE);
            const corpo = await resposta.json();
            nadaGravado(estado, registroAnterior, fichaAnterior);
            assertEquals(resposta.status, 409);
            assertEquals(corpo, { erro: RECUSA_AMBIENTE_DIFERENTE });
        });

        await t.step("MESMO id em OUTRO ambiente + fila VAZIA -> troca", async () => {
            const { salvar, estado } = await lojaVendendoNaContaPf();

            const resposta = await salvar(TOKEN_PF_TESTE);
            assertEquals(resposta.status, 200);
            assertEquals(estado.consultasDaFila, 1);
        });
    } finally {
        globalThis.fetch = fetchAnterior;
        desfazerEnv();
    }
});
