// ============================================================================
// Edge function credenciais-mercado-pago — peça 20 (14/09/2026).
//
// O LOJISTA CADASTRA AS CHAVES DELE do Mercado Pago na tela de Ajustes
// (grupo "Pagamentos", seção "Mercado Pago") sem depender de ninguém de
// fora. O Pix de hoje (criar-pagamento + webhook + reconciliar) continua
// intocado com o MP_ACCESS_TOKEN do ambiente da plataforma; esta function
// só GUARDA, ESCONDE e TESTA as chaves que o lojista colar. Plugar essas
// chaves no checkout é FRENTE FUTURA — não acontece aqui.
//
// DINHEIRO/CREDENCIAL — as proteções desta function:
//   * Admin-only duas vezes: verify_jwt = true no portão (config.toml) E a
//     porta interna aqui — JWT do lojista validado com anon key e papel
//     subido por profiles com service role (MESMA cópia do verifyIsAdmin
//     do estornar-pagamento/calculate-shipping).
//   * O SEGREDO NUNCA VOLTA para o navegador: desta function só sai
//     MÁSCARA ("••••1234") e o resultado do teste. Na ida, entra cifrado.
//   * CIFRAÇÃO NO SERVIDOR: AES-256-GCM (WebCrypto) com chave de 32 bytes
//     da env MP_CHAVES_ENCRYPTION_KEY (base64). A chave de cifra NUNCA
//     mora no banco: o banco (app_settings, RLS só-admin — anônimo não lê
//     nada) guarda ciphertext + iv. Sem a env, salvar e testar falham
//     FECHADOS com recado claro — nada é gravado em claro "para não
//     perder".
//   * NADA DE CHAVE EM LOG: nenhum log recebe token/chave; erros do MP
//     viram recados amigáveis, sem ecoar segredo.
//   * O TESTE DE CONEXÃO roda AQUI DENTRO (GET /users/me do MP, com o
//     fetchComTempo da casa, injetável para teste): a chave real nunca
//     chega ao navegador. O live_mode do MP vira "produção"/"teste" no
//     recado — o prefixo do token NÃO discrimina ambiente (medido na doc
//     do MP; tokens de produção e teste hoje nascem APP_USR-).
//   * app_settings é chave/valor (texto JSON) — NENHUMA migration nesta
//     peça. Public Key NÃO é segredo (é a credencial de frente do MP), e
//     por isso fica em claro no registro.
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BASE_URL_PADRAO, fetchComTempo } from "../_shared/mercadopago.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

/** Linha única do lojista em app_settings (app único, banco por cliente). */
const CHAVE_SETTINGS = "pagamentos_mercado_pago";

/**
 * Formato RELAXADO das credenciais MP: prefixo APP_USR- (produção e teste
 * hoje) ou TEST- (teste legado) + cauda longa. Formato não prova validade —
 * só pega erro de colar pela metade; a validade é do teste de conexão.
 */
const FORMATO_CREDENCIAL = /^(APP_USR|TEST)-[A-Za-z0-9_-]{10,}$/;

export type UltimoTeste = {
    quando: string;
    conectado: boolean;
    mensagem: string;
    ambiente: "producao" | "teste" | null;
    conta: string | null;
};

/** O que dorme em app_settings — segredos só em ciphertext + iv. */
export type Registro = {
    public_key: string;
    token_cifrado: string;
    token_iv: string;
    mascara_token: string;
    webhook_cifrado: string | null;
    webhook_iv: string | null;
    mascara_webhook: string | null;
    ultimo_teste: UltimoTeste | null;
    atualizado_em: string;
};

/** O que sai para a tela — JAMAIS ciphertext nem segredo. */
export type RespostaLer = {
    configurado: boolean;
    public_key: string | null;
    mascara_token: string | null;
    mascara_webhook: string | null;
    ultimo_teste: UltimoTeste | null;
    atualizado_em: string | null;
};

const json = (corpo: unknown, status: number): Response =>
    new Response(JSON.stringify(corpo), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

/**
 * O projeto está migrando das chaves legadas para as novas
 * (publishable/secret). MESMA cópia do estornar-pagamento: lê a nova e
 * cai para a legada.
 */
function readKey(newVar: string, legacyVar: string): string {
    try {
        const parsed = JSON.parse(Deno.env.get(newVar) ?? "{}");
        if (parsed?.default) return parsed.default;
    } catch {
        // variável ausente ou JSON inválido — segue para o fallback
    }
    return Deno.env.get(legacyVar) ?? "";
}

/**
 * Verifica se quem chamou é admin. MESMA cópia do padrão
 * estornar-pagamento/melhor-envio-etiqueta: valida o JWT com a anon key e
 * sobe o papel de `profiles` com service role.
 */
async function verifyIsAdmin(
    authHeader: string | null,
    supabaseUrl: string,
    serviceRoleKey: string,
): Promise<boolean> {
    if (!authHeader) return false;
    try {
        const anonKey = readKey(
            "SUPABASE_PUBLISHABLE_KEYS",
            "SUPABASE_ANON_KEY",
        );
        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const {
            data: { user },
            error: userError,
        } = await userClient.auth.getUser();
        if (userError || !user) return false;
        const systemClient = createClient(supabaseUrl, serviceRoleKey);
        const { data: profile, error: profileError } = await systemClient
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single();
        if (profileError || !profile) return false;
        return profile.role === "admin";
    } catch (err) {
        console.error("[credenciais-mp] Falha no check de admin:", err);
        return false;
    }
}

// ── Cifração (AES-256-GCM do WebCrypto — Deno traz crypto.subtle) ────────

function base64ParaBytes(base64: string): Uint8Array {
    const binaria = atob(base64);
    const bytes = new Uint8Array(binaria.length);
    for (let i = 0; i < binaria.length; i++) bytes[i] = binaria.charCodeAt(i);
    return bytes;
}

function bytesParaBase64(bytes: Uint8Array): string {
    let binaria = "";
    for (const byte of bytes) binaria += String.fromCharCode(byte);
    return btoa(binaria);
}

/** Chave da env; ausente/malformada devolve null — a function falha FECHADA. */
async function chaveDeCifra(): Promise<CryptoKey | null> {
    const segredo = Deno.env.get("MP_CHAVES_ENCRYPTION_KEY")?.trim() ?? "";
    if (!segredo) return null;
    let bytes: Uint8Array;
    try {
        bytes = base64ParaBytes(segredo);
    } catch {
        return null;
    }
    if (bytes.length !== 32) return null;
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);
}

async function cifrar(
    texto: string,
    chave: CryptoKey,
): Promise<{ cifrado: string; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        chave,
        new TextEncoder().encode(texto),
    );
    return {
        cifrado: bytesParaBase64(new Uint8Array(buffer)),
        iv: bytesParaBase64(iv),
    };
}

async function decifrar(
    cifrado: string,
    iv: string,
    chave: CryptoKey,
): Promise<string> {
    const buffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ParaBytes(iv) },
        chave,
        base64ParaBytes(cifrado),
    );
    return new TextDecoder().decode(buffer);
}

/** Só o rabo da chave — o suficiente para o lojista reconhecer qual colou. */
function mascaraDe(segredo: string): string {
    return `••••${segredo.slice(-4)}`;
}

// ── app_settings (via supabase client injetável) ─────────────────────────

async function lerRegistro(supabase: any): Promise<Registro | null> {
    const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", CHAVE_SETTINGS)
        .maybeSingle();
    if (error) throw new Error(`storage_leitura: ${error.message}`);
    if (!data?.value) return null;
    return JSON.parse(data.value) as Registro;
}

async function gravarRegistro(supabase: any, registro: Registro): Promise<void> {
    const { error } = await supabase
        .from("app_settings")
        .upsert(
            {
                key: CHAVE_SETTINGS,
                value: JSON.stringify(registro),
                updated_at: new Date().toISOString(),
            },
            { onConflict: "key" },
        );
    if (error) throw new Error(`storage_escrita: ${error.message}`);
}

function respostaLer(registro: Registro | null): RespostaLer {
    if (!registro) {
        return {
            configurado: false,
            public_key: null,
            mascara_token: null,
            mascara_webhook: null,
            ultimo_teste: null,
            atualizado_em: null,
        };
    }
    return {
        configurado: Boolean(registro.token_cifrado),
        public_key: registro.public_key,
        mascara_token: registro.mascara_token,
        mascara_webhook: registro.mascara_webhook,
        ultimo_teste: registro.ultimo_teste,
        atualizado_em: registro.atualizado_em,
    };
}

/**
 * Costura de teste (padrão da casa): client do Supabase e chamada ao MP
 * injetáveis. Em produção nada muda.
 */
export type CredenciaisDeps = {
    supabase?: any;
    buscar?: (url: string, init?: RequestInit) => Promise<Response>;
};

export async function handler(
    req: Request,
    deps: CredenciaisDeps = {},
): Promise<Response> {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return json({ erro: "Use POST com { acao: ler | salvar | testar }." }, 405);
    }

    let body: {
        acao?: unknown;
        public_key?: unknown;
        access_token?: unknown;
        webhook_secret?: unknown;
    };
    try {
        body = await req.json();
    } catch {
        return json({ erro: "Corpo inválido: esperado JSON." }, 400);
    }

    // Porta de admin ANTES de qualquer leitura/escrita — dinheiro.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = readKey(
        "SUPABASE_SECRET_KEYS",
        "SUPABASE_SERVICE_ROLE_KEY",
    );
    const isAdmin = await verifyIsAdmin(
        req.headers.get("Authorization"),
        supabaseUrl,
        serviceRoleKey,
    );
    if (!isAdmin) {
        return json(
            { erro: "Não autorizado: só o dono da loja mexe nas chaves de pagamento." },
            401,
        );
    }

    const supabase = deps.supabase ?? createClient(supabaseUrl, serviceRoleKey);
    const buscar = deps.buscar ?? fetchComTempo;

    try {
        // ── ler: o que a tela mostra — só máscaras e último teste ──────────
        if (body.acao === "ler") {
            const registro = await lerRegistro(supabase);
            return json(respostaLer(registro), 200);
        }

        // ── salvar: valida, cifra e grava; segredo vazio = mantém o salvo ──
        if (body.acao === "salvar") {
            const publicKey = String(body.public_key ?? "").trim();
            const accessToken = String(body.access_token ?? "").trim();
            const webhookSecret = String(body.webhook_secret ?? "").trim();

            if (!publicKey) {
                return json({ erro: "Cole a Public Key do Mercado Pago." }, 400);
            }
            if (!FORMATO_CREDENCIAL.test(publicKey)) {
                return json(
                    { erro: "A Public Key do Mercado Pago começa com APP_USR- ou TEST-. Confira se copiou a chave inteira." },
                    400,
                );
            }
            if (accessToken && !FORMATO_CREDENCIAL.test(accessToken)) {
                return json(
                    { erro: "O Access Token começa com APP_USR- ou TEST-. Confira se copiou a chave inteira." },
                    400,
                );
            }
            if (webhookSecret && webhookSecret.length < 8) {
                return json(
                    { erro: "A chave de notificações parece curta demais. Confira se copiou inteira." },
                    400,
                );
            }

            const registroAntigo = await lerRegistro(supabase);
            if (!accessToken && !registroAntigo?.token_cifrado) {
                return json(
                    { erro: "Cole também o Access Token — é a chave que processa os pagamentos." },
                    400,
                );
            }

            const chave = await chaveDeCifra();
            if (!chave) {
                return json(
                    { erro: "O cofre de chaves desta loja ainda não está configurado. Fale com o suporte." },
                    503,
                );
            }

            // Troca de chave derruba o teste antigo: ele fala da chave
            // anterior, não desta — recado velho com cara de novo é pior
            // que recado nenhum.
            const trocouToken = Boolean(accessToken);
            const agora = new Date().toISOString();

            const novoToken = accessToken
                ? await cifrar(accessToken, chave)
                : null;
            const novoWebhook = webhookSecret
                ? await cifrar(webhookSecret, chave)
                : null;

            const registro: Registro = {
                public_key: publicKey,
                token_cifrado: novoToken?.cifrado ??
                    registroAntigo?.token_cifrado ?? "",
                token_iv: novoToken?.iv ?? registroAntigo?.token_iv ?? "",
                mascara_token: accessToken
                    ? mascaraDe(accessToken)
                    : registroAntigo?.mascara_token ?? "",
                webhook_cifrado: novoWebhook?.cifrado ??
                    registroAntigo?.webhook_cifrado ?? null,
                webhook_iv: novoWebhook?.iv ??
                    registroAntigo?.webhook_iv ?? null,
                mascara_webhook: webhookSecret
                    ? mascaraDe(webhookSecret)
                    : registroAntigo?.mascara_webhook ?? null,
                ultimo_teste: trocouToken
                    ? null
                    : registroAntigo?.ultimo_teste ?? null,
                atualizado_em: agora,
            };
            await gravarRegistro(supabase, registro);
            return json(respostaLer(registro), 200);
        }

        // ── testar: fala com o MP DAQUI, com a chave decifrada no servidor ──
        if (body.acao === "testar") {
            const registro = await lerRegistro(supabase);
            if (!registro?.token_cifrado) {
                return json(
                    { erro: "Salve o Access Token antes de testar a conexão." },
                    409,
                );
            }
            const chave = await chaveDeCifra();
            if (!chave) {
                return json(
                    { erro: "O cofre de chaves desta loja ainda não está configurado. Fale com o suporte." },
                    503,
                );
            }
            let token: string;
            try {
                token = await decifrar(
                    registro.token_cifrado,
                    registro.token_iv,
                    chave,
                );
            } catch {
                return json(
                    { erro: "Não consegui ler a chave salva. Cole e salve as chaves de novo." },
                    500,
                );
            }

            let conectado = false;
            let mensagem: string;
            let ambiente: "producao" | "teste" | null = null;
            let conta: string | null = null;
            try {
                const resposta = await buscar(`${BASE_URL_PADRAO}/users/me`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (resposta.status === 200) {
                    const dados = await resposta.json().catch(() => ({}));
                    conectado = true;
                    ambiente = dados.live_mode === true
                        ? "producao"
                        : dados.live_mode === false
                        ? "teste"
                        : null;
                    conta = typeof dados.nickname === "string"
                        ? dados.nickname
                        : null;
                    mensagem = conta
                        ? `Conectado! Conta "${conta}" no ambiente ${ambiente === "producao" ? "de produção" : "de teste"}.`
                        : "Conectado ao Mercado Pago!";
                } else if (
                    resposta.status === 401 || resposta.status === 403
                ) {
                    mensagem =
                        "O Mercado Pago recusou a chave: o Access Token está errado, expirou ou veio incompleto. Cole a chave de novo e salve.";
                } else {
                    mensagem =
                        "O Mercado Pago não respondeu como esperado agora. Tente de novo em instantes.";
                }
            } catch {
                mensagem =
                    "Não consegui falar com o Mercado Pago agora. Confira a internet e tente de novo.";
            }

            const ultimoTeste: UltimoTeste = {
                quando: new Date().toISOString(),
                conectado,
                mensagem,
                ambiente,
                conta,
            };
            await gravarRegistro(supabase, {
                ...registro,
                ultimo_teste: ultimoTeste,
                atualizado_em: ultimoTeste.quando,
            });
            return json(
                { conectado, mensagem, ambiente, conta, quando: ultimoTeste.quando },
                200,
            );
        }

        return json(
            { erro: "Ação desconhecida: use ler, salvar ou testar." },
            400,
        );
    } catch (err) {
        // Nada do corpo da requisição entra aqui — só a falha estrutural.
        console.error(
            "[credenciais-mp] Falha interna:",
            err instanceof Error ? err.message : err,
        );
        const mensagem = String(
            err instanceof Error ? err.message : "",
        ).startsWith("storage_")
            ? "Não consegui gravar as chaves agora. Tente de novo em instantes."
            : "Algo saiu do previsto aqui dentro. Tente de novo em instantes.";
        return json({ erro: mensagem }, 500);
    }
}

// `(req) => handler(req)`, e não `serve(handler)` direto: o `serve` do std
// passa um segundo argumento (ConnInfo) que cairia em `deps`. Em teste não
// sobe servidor (mesmo padrão do estornar-pagamento).
const isTesting = Deno.mainModule.endsWith("_test.ts") ||
    Deno.mainModule.endsWith("_test.js") ||
    Deno.mainModule.includes("index_test");
if (!isTesting) serve((req: Request) => handler(req));
