// @ts-nocheck
// Caça por mutação (25/11/2026) na edge credenciais-mercado-pago (dinheiro:
// a chave que cobra o cliente). Cada teste abaixo derruba um defeito plantado
// que passava por TODOS os testes antigos: carimbo de quem ligou o PIX
// apagado ou escrito por engano, o "desfazer" que devolveria um SEGREDO para a
// ficha pública, recados que mentem sobre o que desligou, retomar que não
// retoma. O dublê de banco é próprio deste arquivo (os antigos não o exportam);
// chaves e tokens são todos FALSOS e legíveis.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";

// ── Costura de rede da porta de admin (mesma estratégia dos testes antigos):
// o supabase-js captura o fetch no import, então o patch vale ANTES dele.
const fetchNativo = globalThis.fetch;
const ID_ADMIN = "admin-1111-2222";

const fetchAdminFalso = ((input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (dados: unknown) =>
        new Response(JSON.stringify(dados), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/auth/v1/user")) {
        return json({
            id: ID_ADMIN,
            email: "admin@teste.local",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: { provider: "email", role: "admin" },
        });
    }
    if (url.includes("/rest/v1/profiles")) return json({ id: ID_ADMIN, role: "admin" });
    return new Response(JSON.stringify({ message: "fora do roteiro" }), { status: 404 });
}) as any;

globalThis.fetch = fetchAdminFalso;
const { handler: handlerSemDono } = await import("./index.ts");
globalThis.fetch = fetchNativo;

const handler = (req: Request, deps: Record<string, unknown> = {}) =>
    handlerSemDono(req, { donoAtual: async () => null, ...deps });

const base64DeBytes = (passo: number, soma: number) =>
    btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * passo + soma) % 256)));
const CHAVE_CIFRA = base64DeBytes(7, 3);
const OUTRA_CHAVE_CIFRA = base64DeBytes(11, 5);

const PUBLIC_KEY = "APP_USR-11111111-1111-4111-8111-111111111111";
const OUTRA_PUBLIC_KEY = "APP_USR-99999999-9999-4999-8999-999999999999";
/** Access Token que, por azar do lojista, TEM o formato de uma Public Key (uuid). */
const TOKEN_COM_CARA_DE_PUBLIC_KEY = "APP_USR-22222222-2222-4222-8222-222222222222";
const TOKEN = "APP_USR-token-falso-de-teste-9999";
const TOKEN_2 = "APP_USR-token-falso-de-teste-trocado-8888";
const WEBHOOK = "segredo-falso-de-webhook-7777";

const CONTA_REAL = { id: 1, nickname: "Loja Teste", email: "dono@minhaloja.com.br", tags: ["normal"], site_id: "MLB" };
const CONTA_DE_TESTE = {
    id: 2,
    nickname: "TESTUSER1234567890",
    email: "test_user_1@testuser.com",
    tags: ["normal", "test_user"],
    site_id: "MLB",
};

function mp(status: number, corpo: unknown = {}) {
    return async () => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

async function comAmbiente<T>(extra: Record<string, string>, executar: () => Promise<T>): Promise<T> {
    const pares: Array<[string, string]> = [
        ["SUPABASE_URL", "https://supa-fake.local"],
        ["SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" })],
        ["SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" })],
        ["MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA],
        ["MP_SANDBOX_PAYER_EMAIL", ""],
        ...Object.entries(extra),
    ];
    const anteriores = pares.map(([chave]) => [chave, Deno.env.get(chave)] as const);
    for (const [chave, valor] of pares) Deno.env.set(chave, valor);
    try {
        return await executar();
    } finally {
        for (const [chave, anterior] of anteriores) {
            if (anterior === undefined) Deno.env.delete(chave);
            else Deno.env.set(chave, anterior);
        }
    }
}

/** Banco falso: app_settings (o registro) e store_config (a ficha que o cliente lê). */
function banco() {
    const estado = {
        valor: null as string | null,
        loja: { pagamento_online: false, mp_public_key: null as string | null },
        updatesLoja: [] as any[],
        upserts: [] as any[],
        falhaNoUpsert: false,
        falhaNaLoja: false,
        semFormaDePagamento: false,
    };
    const appSettings = {
        select() {
            return this;
        },
        eq() {
            return this;
        },
        maybeSingle() {
            return Promise.resolve({ data: estado.valor ? { value: estado.valor } : null, error: null });
        },
        upsert(linha: any) {
            if (estado.falhaNoUpsert) return Promise.resolve({ error: { message: "app_settings fora do ar" } });
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
            const recusa = estado.falhaNaLoja
                ? { message: "DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA" }
                : estado.semFormaDePagamento && linha.pagamento_online === false
                ? { message: "LOJA_SEM_FORMA_DE_PAGAMENTO" }
                : null;
            if (!recusa) Object.assign(estado.loja, linha);
            const resultado = { error: recusa, data: recusa ? null : [{ id: 1 }] };
            const fim = {
                select: () => Promise.resolve(resultado),
                then: (ok: any, falhou: any) => Promise.resolve(resultado).then(ok, falhou),
            };
            return { eq: () => fim };
        },
    };
    return {
        cliente: {
            from: (nome: string) => (nome === "store_config" ? storeConfig : appSettings),
            // Fila da reconciliação VAZIA: nenhum pedido aguardando pagamento,
            // então trocar de conta segue livre (a recusa com fila cheia mora em
            // index_troca_de_conta_com_pagamento_aberto_test.ts).
            rpc: (nome: string) => {
                assertEquals(nome, "pagamentos_a_reconciliar");
                return Promise.resolve({ data: [], error: null });
            },
        },
        estado,
        registro: () => JSON.parse(estado.valor!),
        editarRegistro: (mudar: (r: any) => void) => {
            const r = JSON.parse(estado.valor!);
            mudar(r);
            estado.valor = JSON.stringify(r);
        },
    };
}

async function chamar(b: ReturnType<typeof banco>, corpo: unknown, buscar?: any) {
    const resposta = await fetchComAdmin(() =>
        handler(
            new Request("http://local/credenciais-mercado-pago", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-de-teste" },
                body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
            }),
            { supabase: b.cliente, ...(buscar ? { buscar } : {}) },
        )
    );
    return { status: resposta.status, corpo: await resposta.json() };
}

async function fetchComAdmin<T>(executar: () => Promise<T>): Promise<T> {
    const anterior = globalThis.fetch;
    globalThis.fetch = fetchAdminFalso;
    try {
        return await executar();
    } finally {
        globalThis.fetch = anterior;
    }
}

/** Loja completa e LIGADA: as 3 chaves salvas, teste ok, ficha acesa, carimbo do primeiro admin. */
async function loja(b: ReturnType<typeof banco>, opcoes: { webhook?: boolean } = {}) {
    const r = await chamar(
        b,
        {
            acao: "salvar",
            public_key: PUBLIC_KEY,
            access_token: TOKEN,
            ...(opcoes.webhook === false ? {} : { webhook_secret: WEBHOOK }),
        },
        mp(200, CONTA_REAL),
    );
    assertEquals(r.status, 200);
    return r;
}

const CARIMBO_ANTIGO = { pix_ligado_em: "2026-01-01T00:00:00.000Z", pix_ligado_por: "admin-antigo" };

// ── Corpo e campos obrigatórios ─────────────────────────────────────────────

Deno.test("corpo que não é JSON: 400 e nada é lido nem gravado", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        const r = await chamar(b, "isto não é json {");
        assertEquals(r.status, 400);
        assertStringIncludes(r.corpo.erro, "JSON");
        assertEquals(b.estado.upserts.length, 0);
        assertEquals(b.estado.updatesLoja.length, 0);
    });
});

Deno.test("salvar sem a Public Key: 400 e nada é gravado", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        const r = await chamar(b, { acao: "salvar", public_key: "   ", access_token: TOKEN });
        assertEquals(r.status, 400);
        assertStringIncludes(r.corpo.erro, "Public Key");
        assertEquals(b.estado.upserts.length, 0);
        assertEquals(b.estado.updatesLoja.length, 0);
    });
});

// ── Recado certo para "o MP não respondeu" x "o MP recusou a chave" ─────────

Deno.test("salvar com o MP fora do ar (5xx): a dica é 'Testar conexão de novo'; com a chave recusada (401): 'confira o Access Token'", async () => {
    await comAmbiente({}, async () => {
        const fora = banco();
        const r500 = await chamar(fora, { acao: "salvar", public_key: PUBLIC_KEY, access_token: TOKEN }, mp(500));
        assertEquals(r500.status, 200);
        assertEquals(r500.corpo.testou, true);
        assertStringIncludes(r500.corpo.aviso, "Toque em Testar conexão para tentar de novo.");
        assertEquals(r500.corpo.aviso.includes("Confira o Access Token"), false);

        const recusada = banco();
        const r401 = await chamar(recusada, { acao: "salvar", public_key: PUBLIC_KEY, access_token: TOKEN }, mp(401));
        assertStringIncludes(r401.corpo.aviso, "Confira o Access Token e salve de novo.");
        assertEquals(r401.corpo.aviso.includes("Toque em Testar conexão"), false);
    });
});

Deno.test("salvar só a Public Key quando a chave salva ficou ilegível (cofre trocado): a dica é 'confira o Access Token', não 'tente de novo'", async () => {
    const b = banco();
    await comAmbiente({}, async () => {
        await loja(b);
    });
    // O cofre mudou de chave: o token salvo não decifra mais.
    await comAmbiente({ MP_CHAVES_ENCRYPTION_KEY: OUTRA_CHAVE_CIFRA }, async () => {
        const r = await chamar(b, { acao: "salvar", public_key: OUTRA_PUBLIC_KEY }, mp(200, CONTA_REAL));
        assertEquals(r.status, 200);
        assertEquals(r.corpo.testou, true);
        assertEquals(b.registro().ultimo_teste.conectado, false);
        assertStringIncludes(b.registro().ultimo_teste.mensagem, "Não consegui ler a chave salva");
        assertStringIncludes(r.corpo.aviso, "Confira o Access Token e salve de novo.");
        assertEquals(r.corpo.aviso.includes("Toque em Testar conexão"), false);
    });
});

// ── Carimbo de quem ligou o PIX (auditoria) ─────────────────────────────────

Deno.test("primeira vez que o PIX liga: o carimbo leva QUEM ligou e quando", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        await loja(b);
        assertEquals(b.estado.loja.pagamento_online, true);
        assertEquals(b.registro().pix_ligado_por, ID_ADMIN);
        assert(Date.parse(b.registro().pix_ligado_em) > Date.parse("2026-11-01T00:00:00.000Z"));
    });
});

Deno.test("testar com o PIX JÁ ligado e nada a mudar: o carimbo de quem ligou NÃO é reescrito e nenhum aviso de 'ligado' sai", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        await loja(b);
        b.editarRegistro((r) => Object.assign(r, CARIMBO_ANTIGO));
        const r = await chamar(b, { acao: "testar" }, mp(200, CONTA_REAL));
        assertEquals(r.status, 200);
        assertEquals(r.corpo.conectado, true);
        assertEquals(r.corpo.pix_ligado, true);
        assertEquals(b.registro().pix_ligado_por, "admin-antigo");
        assertEquals(b.registro().pix_ligado_em, CARIMBO_ANTIGO.pix_ligado_em);
        assertEquals(r.corpo.aviso, undefined);
    });
});

Deno.test("testar com o PIX ligado mas a ficha com OUTRA Public Key: corrige a chave da ficha SEM reescrever o carimbo e SEM dizer que desligou", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        await loja(b);
        b.editarRegistro((r) => Object.assign(r, CARIMBO_ANTIGO));
        b.estado.loja.mp_public_key = OUTRA_PUBLIC_KEY; // PIX segue aceso, mas com a chave de outra conta
        const r = await chamar(b, { acao: "testar" }, mp(200, CONTA_REAL));
        assertEquals(r.status, 200);
        assertEquals(b.estado.loja.mp_public_key, PUBLIC_KEY);
        assertEquals(b.estado.loja.pagamento_online, true);
        assertEquals(b.registro().pix_ligado_por, "admin-antigo", "não ligou AGORA: já estava ligado");
        assertEquals(r.corpo.aviso, undefined, "nada foi ligado nem desligado: nenhum recado");
    });
});

Deno.test("testar com a chave recusada e o PIX JÁ desligado: nada a desligar, então nenhum recado de 'Desliguei'", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        await loja(b);
        b.estado.loja.pagamento_online = false;
        b.estado.updatesLoja.length = 0;
        const r = await chamar(b, { acao: "testar" }, mp(401));
        assertEquals(r.status, 200);
        assertEquals(r.corpo.conectado, false);
        assertEquals(r.corpo.pix_ligado, false);
        assertEquals(b.estado.updatesLoja, [], "a ficha já estava como o alvo manda: nenhuma escrita");
        assertEquals(String(r.corpo.aviso ?? "").includes("Desliguei"), false);
    });
});

Deno.test("trocar o token e o teste falhar desliga o PIX, mas o carimbo de quem ligou continua o ORIGINAL (desligar não é ligar)", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        await loja(b);
        b.editarRegistro((r) => Object.assign(r, CARIMBO_ANTIGO));
        const r = await chamar(b, { acao: "salvar", public_key: PUBLIC_KEY, access_token: TOKEN_2 }, mp(401));
        assertEquals(r.status, 200);
        assertEquals(r.corpo.pix_desligado, true);
        assertEquals(b.estado.loja.pagamento_online, false);
        assertEquals(b.registro().pix_ligado_por, "admin-antigo");
        assertEquals(b.registro().pix_ligado_em, CARIMBO_ANTIGO.pix_ligado_em);
        assertStringIncludes(r.corpo.aviso, "Desliguei o pagamento pelo app: o teste de conexão com as chaves novas não passou.");
    });
});

// ── Recados que dizem o MOTIVO certo do desligamento ────────────────────────

Deno.test("trocar o token com o teste OK, mas faltando a chave de notificações: desliga e diz 'falta a Chave de notificações' (não 'pausado')", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        await loja(b, { webhook: false });
        b.estado.loja.pagamento_online = true; // aceso à mão: simula o PIX ligado antes
        const r = await chamar(b, { acao: "salvar", public_key: PUBLIC_KEY, access_token: TOKEN_2 }, mp(200, CONTA_REAL));
        assertEquals(r.status, 200);
        assertEquals(r.corpo.pix_desligado, true);
        assertEquals(b.estado.loja.pagamento_online, false);
        assertEquals(r.corpo.aviso, "Desliguei o pagamento pelo app: falta a Chave de notificações.");
    });
});

Deno.test("re-salvar as MESMAS chaves (nada mudou) numa loja que não liga: não anuncia 'pix_desligado' (nada foi desligado agora)", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        await loja(b, { webhook: false }); // falta a chave de notificações: a ficha nunca ligou
        const r = await chamar(b, { acao: "salvar", public_key: PUBLIC_KEY }, mp(200, CONTA_REAL));
        assertEquals(r.status, 200);
        assertEquals(r.corpo.testou, false);
        assertEquals("pix_desligado" in r.corpo, false);
        assertEquals(r.corpo.pix_ligado, false);
    });
});

Deno.test("ficha recusa desligar por falta de forma de pagamento na entrega, com o teste OK: o recado NÃO culpa o teste de conexão", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        await loja(b, { webhook: false });
        b.estado.loja.pagamento_online = true;
        b.estado.semFormaDePagamento = true;
        const r = await chamar(b, { acao: "salvar", public_key: PUBLIC_KEY, access_token: TOKEN_2 }, mp(200, CONTA_REAL));
        assertEquals(r.status, 409);
        assertEquals(
            r.corpo.erro,
            "Ligue ao menos uma forma de pagamento na entrega antes de trocar as chaves do Mercado Pago.",
        );
        assertEquals(b.estado.loja.pagamento_online, true, "a ficha recusou: segue como estava");
    });
});

// ── Aviso do ambiente só quando faz sentido ─────────────────────────────────

Deno.test("conta de TESTE sem modo de teste declarado: re-salvar sem mudar nada NÃO repete o aviso de chaves de teste", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        const primeira = await chamar(
            b,
            { acao: "salvar", public_key: PUBLIC_KEY, access_token: TOKEN, webhook_secret: WEBHOOK },
            mp(200, CONTA_DE_TESTE),
        );
        assertStringIncludes(primeira.corpo.aviso, "Essas chaves são de TESTE");
        const repetida = await chamar(b, { acao: "salvar", public_key: PUBLIC_KEY }, mp(200, CONTA_DE_TESTE));
        assertEquals(repetida.status, 200);
        assertEquals(repetida.corpo.testou, false);
        assertEquals(repetida.corpo.aviso, undefined);
    });
});

Deno.test("testar que LIGA o PIX numa conta de produção com modo de teste declarado: o aviso do modo de teste sai UMA vez só", async () => {
    await comAmbiente({ MP_SANDBOX_PAYER_EMAIL: "comprador@testuser.com" }, async () => {
        const b = banco();
        await loja(b);
        b.estado.loja.pagamento_online = false;
        const r = await chamar(b, { acao: "testar" }, mp(200, CONTA_REAL));
        assertEquals(r.status, 200);
        assertEquals(r.corpo.pix_ligado, true);
        const ocorrencias = String(r.corpo.aviso).split("Seu app está em modo de teste").length - 1;
        assertEquals(ocorrencias, 1, r.corpo.aviso);
    });
});

Deno.test("testar chave de TESTE com o PIX aceso e a ficha recusando o desligamento: cada recusa tem o seu recado", async () => {
    await comAmbiente({}, async () => {
        const semForma = banco();
        await loja(semForma);
        semForma.estado.loja.pagamento_online = true;
        semForma.estado.semFormaDePagamento = true;
        const a = await chamar(semForma, { acao: "testar" }, mp(200, CONTA_DE_TESTE));
        assertEquals(a.status, 200);
        assertEquals(a.corpo.pix_ligado, true, "não conseguiu desligar: continua aceso e o recado não finge o contrário");
        assertStringIncludes(a.corpo.aviso, "a loja ficaria sem nenhuma forma de pagamento");
        assertEquals(a.corpo.aviso.includes("na ficha da loja agora"), false);

        const outra = banco();
        await loja(outra);
        outra.estado.loja.pagamento_online = true;
        outra.estado.falhaNaLoja = true;
        const o = await chamar(outra, { acao: "testar" }, mp(200, CONTA_DE_TESTE));
        assertEquals(o.status, 200);
        assertStringIncludes(o.corpo.aviso, "na ficha da loja agora. Toque em Testar conexão para tentar de novo");
        assertEquals(o.corpo.aviso.includes("sem nenhuma forma de pagamento"), false);
    });
});

// ── Retomar (ligar_pix) tira a pausa em qualquer das três marcas ────────────

const MARCAS_DA_PAUSA: Array<[string, { pagamento_pausado: boolean; pausado_em: string | null; pausado_por: string | null }]> = [
    ["só o indicador de pausa", { pagamento_pausado: true, pausado_em: null, pausado_por: null }],
    ["só a data da pausa (indicador já falso)", { pagamento_pausado: false, pausado_em: "2026-11-01T10:00:00.000Z", pausado_por: null }],
    ["só quem pausou (indicador já falso)", { pagamento_pausado: false, pausado_em: null, pausado_por: "admin-antigo" }],
];
for (const [rotulo, marcas] of MARCAS_DA_PAUSA) {
    Deno.test(`retomar: pausa marcada por ${rotulo} sai, a ficha volta a ligar e o registro fica sem pausa`, async () => {
        await comAmbiente({}, async () => {
            const b = banco();
            await loja(b);
            b.estado.loja.pagamento_online = false; // a pausa desligou a ficha
            b.editarRegistro((r) => Object.assign(r, marcas));
            const r = await chamar(b, { acao: "ligar_pix" });
            assertEquals(r.status, 200);
            assertEquals(r.corpo.pix_ligado, true);
            assertEquals(r.corpo.pausado, false);
            assertEquals(b.estado.loja.pagamento_online, true);
            const salvo = b.registro();
            assertEquals(salvo.pagamento_pausado, false);
            assertEquals(salvo.pausado_em, null);
            assertEquals(salvo.pausado_por, null);
        });
    });
}

// ── O desfazer nunca devolve um SEGREDO para a ficha pública ────────────────

Deno.test("registro falha depois da ficha gravar e a ficha ANTERIOR tinha o Access Token novo no lugar da Public Key: o desfazer a retira (null), nunca a repõe", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        b.estado.loja.mp_public_key = TOKEN_COM_CARA_DE_PUBLIC_KEY; // sobra de cadastro antigo, com cara de Public Key
        b.estado.falhaNoUpsert = true; // o registro (app_settings) vai recusar gravar
        const r = await chamar(
            b,
            { acao: "salvar", public_key: PUBLIC_KEY, access_token: TOKEN_COM_CARA_DE_PUBLIC_KEY },
            mp(200, CONTA_REAL),
        );
        assertEquals(r.status, 500);
        assertStringIncludes(r.corpo.erro, "A chave pública anterior foi retirada da ficha");
        assertEquals(b.estado.loja.mp_public_key, null, "o segredo não pode ficar na ficha pública");
        assertEquals(b.estado.updatesLoja.at(-1), { mp_public_key: null });
    });
});

Deno.test("registro falha depois da ficha gravar e a ficha ANTERIOR tinha o token JÁ SALVO no lugar da Public Key: o desfazer a retira (null)", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        // Salva um token que tem cara de Public Key (válido nos dois formatos).
        const primeira = await chamar(
            b,
            { acao: "salvar", public_key: PUBLIC_KEY, access_token: TOKEN_COM_CARA_DE_PUBLIC_KEY },
            mp(200, CONTA_REAL),
        );
        assertEquals(primeira.status, 200);
        b.estado.loja.mp_public_key = TOKEN_COM_CARA_DE_PUBLIC_KEY; // a ficha ficou com o segredo
        b.estado.falhaNoUpsert = true;
        const r = await chamar(b, { acao: "salvar", public_key: OUTRA_PUBLIC_KEY }, mp(200, CONTA_REAL));
        assertEquals(r.status, 500);
        assertStringIncludes(r.corpo.erro, "A chave pública anterior foi retirada da ficha");
        assertEquals(b.estado.loja.mp_public_key, null);
    });
});

Deno.test("registro falha depois da ficha gravar e a Public Key anterior era LEGÍTIMA: o desfazer a repõe como estava", async () => {
    await comAmbiente({}, async () => {
        const b = banco();
        b.estado.loja.mp_public_key = OUTRA_PUBLIC_KEY;
        b.estado.falhaNoUpsert = true;
        const r = await chamar(b, { acao: "salvar", public_key: PUBLIC_KEY, access_token: TOKEN }, mp(200, CONTA_REAL));
        assertEquals(r.status, 500);
        assertStringIncludes(r.corpo.erro, "nada mudou");
        assertEquals(b.estado.loja.mp_public_key, OUTRA_PUBLIC_KEY);
    });
});
