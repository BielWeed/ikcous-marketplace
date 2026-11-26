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
const CHAVE_CIFRA_TESTE = btoa(
    String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 5 + 9) % 256)),
);

const CONTAS = new Map<string, { id: number; nickname: string }>([
    [TOKEN_PF, { id: 111111, nickname: "LOJAPF" }],
    [TOKEN_PF_RENOVADO, { id: 111111, nickname: "LOJAPF" }],
    [TOKEN_PJ, { id: 222222, nickname: "LOJAPJ" }],
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
    const buscar = (url: string, init?: RequestInit): Promise<Response> => {
        assertEquals(url, "https://api.mercadopago.com/users/me");
        const token = String(new Headers(init?.headers).get("Authorization")).replace(/^Bearer /, "");
        tokensConsultados.push(token);
        const conta = CONTAS.get(token);
        if (!conta) return Promise.resolve(respostaJson({ message: "invalid_token" }, 401));
        return Promise.resolve(respostaJson({ ...conta, tags: ["normal"], site_id: "MLB" }));
    };
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
        estado,
        tokensConsultados,
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

const RECUSA_CONTA_DIFERENTE =
    "Há 2 pedido(s) aguardando pagamento na conta atual do Mercado Pago, e as chaves novas são de outra conta. Se trocar agora, esses pagamentos não seriam mais conferidos pelo app. Espere eles terminarem (em geral leva até 1 hora) ou cancele os pedidos, e troque depois. Nada foi salvo.";
const RECUSA_CONTA_INCERTA =
    "Há 2 pedido(s) aguardando pagamento na conta atual do Mercado Pago, e não consegui confirmar se as chaves novas são da mesma conta. Se trocar agora, esses pagamentos podem não ser mais conferidos pelo app. Espere eles terminarem (em geral leva até 1 hora) ou cancele os pedidos, e troque depois. Nada foi salvo.";

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
    } finally {
        globalThis.fetch = fetchAnterior;
        desfazerEnv();
    }
});
