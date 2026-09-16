// ============================================================================
// Edge function credenciais-mercado-pago — peça 20 (14/09/2026).
//
// O LOJISTA CADASTRA AS CHAVES DELE do Mercado Pago na tela de Ajustes
// (grupo "Pagamentos", seção "Mercado Pago") sem depender de ninguém de
// fora: esta function GUARDA, ESCONDE e TESTA as chaves que ele colar.
//
// A FICHA DA LOJA (tarefa mp-3, 15/09/2026) — por que esta function mexe em
// store_config: o checkout do cliente só mostra PIX quando a ficha pública
// da loja (lida de v_store_config pelo porteiro, ver
// src/config/configuracaoDaLoja.ts) traz `pagamento_online = true` E
// `mp_public_key` preenchida. Chave cadastrada aqui sem essas duas colunas é
// tela dizendo "salvo" e cliente sem forma de pagar. Essas colunas só aceitam
// escrita com o claim service_role (trigger
// dominio_publico_so_muda_pela_frota, migrations 20261140000000 e
// 20261150000000) — e esta function é exatamente quem tem esse claim e já
// está trancada por admin. Por isso:
//   * `salvar` PUBLICA a Public Key na ficha (store_config.mp_public_key);
//     se a ficha recusar, o lojista OUVE isso — nunca "salvo" calado.
//   * `ligar_pix` / `desligar_pix` acendem e apagam `pagamento_online`, e
//     ligar exige teste de conexão bem-sucedido (ver a ação, abaixo).
//
// O PIX SÓ ACENDE COM A LOJA INTEIRA (tarefa mp-8, 16/09/2026):
//   * `ligar_pix` publica a Public Key no MESMO update que acende — e recusa
//     com 409 se o registro não tiver Public Key em formato válido.
//   * `salvar` com credencial NOVA (token ou Public Key) desliga o PIX no
//     mesmo update e conta isso na resposta (`pix_desligado` + `aviso`);
//     re-salvar sem trocar credencial não derruba quem está vendendo.
//   * O carimbo de auditoria do liga (pix_ligado_em/pix_ligado_por) tem
//     try/catch próprio: falhou, sai 200 com `aviso` — a verdade é a ficha,
//     e "falhou" com o PIX aceso faz o lojista ligar duas vezes.
//   * Escrita na ficha sem linha afetada é RECUSA, não sucesso (o UPDATE pede
//     `select('id')`): ficha ausente vira 500 honesto, nunca "salvo" calado.
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
import {
    chaveDeCifra,
    cifrar,
    CHAVE_SETTINGS,
    decifrar,
    lerRegistroMp,
    type Registro,
    type UltimoTeste,
} from "../_shared/credenciais-mp.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

/**
 * Formato RELAXADO das credenciais MP: prefixo APP_USR- (produção e teste
 * hoje) ou TEST- (teste legado) + cauda longa. Formato não prova validade —
 * só pega erro de colar pela metade; a validade é do teste de conexão.
 */
const FORMATO_CREDENCIAL = /^(APP_USR|TEST)-[A-Za-z0-9_-]{10,}$/;

// O formato do registro e o de UltimoTeste moram no módulo compartilhado
// (quem cobra precisa do MESMO formato que esta tela grava); seguem saindo
// por aqui para quem já importava desta function.
export type { Registro, UltimoTeste };

/**
 * O registro de app_settings mais o carimbo de auditoria do liga/desliga do
 * PIX. Fica AQUI, e não no módulo compartilhado, porque só esta tela liga e
 * desliga o PIX — quem cobra (criar-pagamento, webhook) não olha o carimbo.
 */
type RegistroComPix = Registro & {
    pix_ligado_em?: string | null;
    pix_ligado_por?: string | null;
};

/** O que sai para a tela — JAMAIS ciphertext nem segredo. */
export type RespostaLer = {
    configurado: boolean;
    public_key: string | null;
    mascara_token: string | null;
    mascara_webhook: string | null;
    ultimo_teste: UltimoTeste | null;
    atualizado_em: string | null;
    /** `store_config.pagamento_online` — o PIX está aceso para o cliente? */
    pix_ligado: boolean;
    /** A ficha da loja já carrega ESTA Public Key (e não outra, nem nenhuma). */
    public_key_na_loja: boolean;
};

/** A parte da ficha pública da loja que esta tela precisa enxergar. */
type FichaDaLoja = {
    pagamento_online: boolean;
    mp_public_key: string | null;
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
 * Verifica se quem chamou é admin e devolve o UID dele (null = não é
 * admin). MESMA cópia do padrão estornar-pagamento/melhor-envio-etiqueta —
 * valida o JWT com a anon key e sobe o papel de `profiles` com service role;
 * a única diferença é devolver o uid em vez de um booleano, porque ligar o
 * PIX é ato de dinheiro e fica carimbado com QUEM ligou (`pix_ligado_por`).
 */
async function uidDoAdmin(
    authHeader: string | null,
    supabaseUrl: string,
    serviceRoleKey: string,
): Promise<string | null> {
    if (!authHeader) return null;
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
        if (userError || !user) return null;
        const systemClient = createClient(supabaseUrl, serviceRoleKey);
        const { data: profile, error: profileError } = await systemClient
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single();
        if (profileError || !profile) return null;
        return profile.role === "admin" ? user.id : null;
    } catch (err) {
        console.error("[credenciais-mp] Falha no check de admin:", err);
        return null;
    }
}

// As primitivas de cifra (chaveDeCifra/cifrar/decifrar, AES-256-GCM do
// WebCrypto) saíram daqui para ../_shared/credenciais-mp.ts na tarefa mp-1:
// quem GRAVA o segredo (esta tela) e quem o LÊ na hora de cobrar
// (criar-pagamento, webhook, reconciliar, estornar) têm de usar exatamente a
// mesma cifra — duas cópias divergem calado e o dinheiro para de entrar.

/** Só o rabo da chave — o suficiente para o lojista reconhecer qual colou. */
function mascaraDe(segredo: string): string {
    return `••••${segredo.slice(-4)}`;
}

// ── app_settings (via supabase client injetável) ─────────────────────────

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

// ── store_config: a ficha que o checkout do cliente lê (linha única id = 1) ─

/** Lê a ficha da loja. Erro de banco vira `storage_` — o catch traduz. */
async function lerFichaDaLoja(supabase: any): Promise<FichaDaLoja> {
    const { data, error } = await supabase
        .from("store_config")
        .select("pagamento_online, mp_public_key")
        .eq("id", 1)
        .maybeSingle();
    if (error) throw new Error(`storage_leitura_loja: ${error.message}`);
    return {
        pagamento_online: data?.pagamento_online === true,
        mp_public_key: data?.mp_public_key ?? null,
    };
}

/**
 * Escreve na ficha da loja. Devolve a mensagem da recusa (ou null quando deu
 * certo) em vez de estourar: quem chama precisa dizer ao lojista O QUE ficou
 * pela metade — "salvei as chaves mas não publiquei" é recado diferente de
 * "não salvei nada", e o genérico do catch confundiria os dois.
 *
 * O `.select("id")` não é enfeite (mp-8): sem ele, UPDATE que não achou a
 * linha id = 1 volta SEM error e com zero linha afetada — ficha inexistente
 * (banco novo) ou RLS/trigger recusando calado passariam por "publicado", e a
 * tela diria "salvo" com o cliente sem PIX. Zero linha é recusa.
 */
async function escreverNaFichaDaLoja(
    supabase: any,
    campos: Partial<FichaDaLoja>,
): Promise<string | null> {
    const { data, error } = await supabase
        .from("store_config")
        .update(campos)
        .eq("id", 1)
        .select("id");
    if (error) return String(error.message ?? "recusado");
    if (!Array.isArray(data) || data.length === 0) {
        return "a ficha da loja não foi encontrada ou recusou a gravação";
    }
    return null;
}

function respostaLer(
    registro: Registro | null,
    ficha: FichaDaLoja,
): RespostaLer {
    // A Public Key da ficha só "confere" quando existe dos DOIS lados e é a
    // mesma: ficha vazia, ou ficha com a chave de outra loja, é exatamente o
    // caso em que o cliente não vê PIX — a tela precisa poder contar isso.
    const public_key_na_loja = Boolean(registro?.public_key) &&
        ficha.mp_public_key === registro?.public_key;
    if (!registro) {
        return {
            configurado: false,
            public_key: null,
            mascara_token: null,
            mascara_webhook: null,
            ultimo_teste: null,
            atualizado_em: null,
            pix_ligado: ficha.pagamento_online,
            public_key_na_loja,
        };
    }
    return {
        configurado: Boolean(registro.token_cifrado),
        public_key: registro.public_key,
        mascara_token: registro.mascara_token,
        mascara_webhook: registro.mascara_webhook,
        ultimo_teste: registro.ultimo_teste,
        atualizado_em: registro.atualizado_em,
        pix_ligado: ficha.pagamento_online,
        public_key_na_loja,
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
        return json(
            { erro: "Use POST com { acao: ler | salvar | testar | ligar_pix | desligar_pix }." },
            405,
        );
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
    const uidAdmin = await uidDoAdmin(
        req.headers.get("Authorization"),
        supabaseUrl,
        serviceRoleKey,
    );
    if (!uidAdmin) {
        return json(
            { erro: "Não autorizado: só o dono da loja mexe nas chaves de pagamento." },
            401,
        );
    }

    const supabase = deps.supabase ?? createClient(supabaseUrl, serviceRoleKey);
    // fetchComTempo (shared/mercadopago.ts) tem assinatura (fetchFn, url,
    // init, tempoMs) — o PRIMEIRO parâmetro é o próprio fetch. Usá-lo cru aqui
    // (peça 27) fazia a URL string ocupar o lugar do fetch e todo `testar`
    // morria em TypeError dentro dele, caindo no catch de rede — o lojista
    // via "sem internet" SEMPRE, mesmo com chave boa e internet boa. A seta
    // adapta a assinatura: quem chega aqui é (url, init), como o dublê dos
    // testes e o resto da casa usam.
    const buscar = deps.buscar ??
        ((url: string, init?: RequestInit) => fetchComTempo(fetch, url, init));

    try {
        // ── ler: o que a tela mostra — só máscaras e último teste ──────────
        if (body.acao === "ler") {
            const registro = await lerRegistroMp(supabase);
            const ficha = await lerFichaDaLoja(supabase);
            return json(respostaLer(registro, ficha), 200);
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

            const registroAntigo = await lerRegistroMp(
                supabase,
            ) as RegistroComPix | null;
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
            // A Public Key também conta como troca de credencial (mp-8):
            // chave de outra conta publicada na ficha é Payment Brick de uma
            // conta cobrando pela outra. Sem registro anterior, é troca.
            const trocouPublicKey = registroAntigo?.public_key !== publicKey;
            const agora = new Date().toISOString();

            const novoToken = accessToken
                ? await cifrar(accessToken, chave)
                : null;
            const novoWebhook = webhookSecret
                ? await cifrar(webhookSecret, chave)
                : null;

            // RegistroComPix (e não Registro): o carimbo do liga/desliga do
            // PIX viaja junto com o que é gravado em app_settings.
            const registro: RegistroComPix = {
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
                // O carimbo de quem ligou o PIX ATRAVESSA o salvar: auditoria
                // que some porque o lojista reeditou a chave não é auditoria.
                pix_ligado_em: registroAntigo?.pix_ligado_em ?? null,
                pix_ligado_por: registroAntigo?.pix_ligado_por ?? null,
                atualizado_em: agora,
            };
            await gravarRegistro(supabase, registro);

            // Credencial nova com o PIX aceso é vitrine cobrando por uma chave
            // que ninguém testou (mp-8): o token pode estar errado e TODA
            // tentativa de PIX morre no fim da compra, com a tela dizendo
            // "nunca testado" e o interruptor ligado. Desligamos no MESMO
            // update que publica a chave — dois updates deixariam uma janela
            // com a chave nova e o PIX ainda aceso. Re-salvar sem trocar
            // credencial (a tela manda o token vazio) não derruba ninguém.
            const fichaAntes = await lerFichaDaLoja(supabase);
            const desligarPix = (trocouToken || trocouPublicKey) &&
                fichaAntes.pagamento_online;

            // A Public Key não é segredo: é a credencial de FRENTE, e o
            // checkout do cliente lê a da ficha da loja, não a daqui. Sem
            // publicar, a tela diz "salvo" e o cliente segue sem PIX.
            const recusa = await escreverNaFichaDaLoja(supabase, {
                mp_public_key: publicKey,
                ...(desligarPix ? { pagamento_online: false } : {}),
            });
            if (recusa) {
                console.error(
                    "[credenciais-mp] ficha da loja recusou a Public Key:",
                    recusa,
                );
                return json(
                    { erro: "Guardei as chaves, mas não consegui publicar a Public Key na ficha da loja — o cliente ainda não verá o PIX. Tente salvar de novo." },
                    500,
                );
            }
            const ficha = await lerFichaDaLoja(supabase);
            // Só ACRESCENTA campos (a tela de Ajustes já consome o resto):
            // desligar o PIX calado seria o lojista descobrindo pelo cliente.
            return json(
                {
                    ...respostaLer(registro, ficha),
                    ...(desligarPix
                        ? {
                            pix_desligado: true,
                            aviso: "Desliguei o PIX no app: teste a conexão com a credencial nova e ligue de novo.",
                        }
                        : {}),
                },
                200,
            );
        }

        // ── testar: fala com o MP DAQUI, com a chave decifrada no servidor ──
        if (body.acao === "testar") {
            const registro = await lerRegistroMp(supabase);
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

        // ── ligar_pix: acende o PIX no checkout do cliente ────────────────
        // Só liga depois de um teste de conexão BEM-SUCEDIDO: ligar com chave
        // que o Mercado Pago recusa é vitrine aberta que não cobra ninguém —
        // o cliente chega no fim da compra e trava.
        if (body.acao === "ligar_pix") {
            const registro = await lerRegistroMp(
                supabase,
            ) as RegistroComPix | null;
            if (!registro?.ultimo_teste?.conectado) {
                return json(
                    { erro: "Teste a conexão com sucesso antes de ligar o PIX." },
                    409,
                );
            }
            // O Payment Brick do checkout não sobe sem a Public Key: acender o
            // PIX sem ela é o cliente chegando no fim da compra e vendo
            // "Pagamento indisponível". Mesma validação de formato do salvar.
            const publicKeyDoRegistro = String(registro.public_key ?? "").trim();
            if (!FORMATO_CREDENCIAL.test(publicKeyDoRegistro)) {
                return json(
                    { erro: "Salve a Public Key do Mercado Pago antes de ligar o PIX — sem ela o cliente vê o PIX e trava no fim da compra." },
                    409,
                );
            }

            // As DUAS colunas no MESMO update: a ficha nunca fica meio ligada
            // (aceso sem chave é justamente o beco sem saída do checkout).
            const recusa = await escreverNaFichaDaLoja(supabase, {
                pagamento_online: true,
                mp_public_key: publicKeyDoRegistro,
            });
            if (recusa) {
                console.error(
                    "[credenciais-mp] ficha da loja recusou ligar o PIX:",
                    recusa,
                );
                return json(
                    { erro: "Não consegui ligar o PIX na ficha da loja agora. Tente de novo em instantes." },
                    500,
                );
            }

            // Carimbo depois da ficha: o que vale para o cliente é a ficha, e
            // carimbar antes deixaria auditoria de um "ligou" que não ligou.
            const agora = new Date().toISOString();
            // Chave de sandbox conecta igualzinho à de produção — quem não
            // for avisado vai achar que vendeu.
            const avisos: string[] = [];
            if (registro.ultimo_teste.ambiente === "teste") {
                avisos.push(
                    "Chave de TESTE: o PIX não vai receber dinheiro de verdade",
                );
            }
            // Try/catch PRÓPRIO do carimbo (mp-8): a verdade do estado é a
            // ficha, e ela JÁ acendeu. Deixar a falha da auditoria cair no
            // catch geral devolvia 500 "não consegui gravar" com o PIX aceso —
            // o lojista tentava de novo achando que estava desligado.
            try {
                await gravarRegistro(supabase, {
                    ...registro,
                    pix_ligado_em: agora,
                    pix_ligado_por: uidAdmin,
                    atualizado_em: agora,
                } as Registro);
            } catch (err) {
                console.error(
                    "[credenciais-mp] PIX ligado, mas o carimbo de auditoria falhou:",
                    err instanceof Error ? err.message : err,
                );
                avisos.push(
                    "O PIX está ligado, mas não consegui registrar quem ligou; tente salvar de novo mais tarde.",
                );
            }
            return json(
                {
                    pix_ligado: true,
                    quando: agora,
                    ...(avisos.length ? { aviso: avisos.join(" ") } : {}),
                },
                200,
            );
        }

        // ── desligar_pix: sempre permitido ────────────────────────────────
        // Desligar é o lado seguro (o cliente volta a ver só os meios de
        // pagamento manuais), então não depende de teste nem de chave salva.
        if (body.acao === "desligar_pix") {
            const recusa = await escreverNaFichaDaLoja(supabase, {
                pagamento_online: false,
            });
            if (recusa) {
                console.error(
                    "[credenciais-mp] ficha da loja recusou desligar o PIX:",
                    recusa,
                );
                return json(
                    { erro: "Não consegui desligar o PIX na ficha da loja agora. Tente de novo em instantes." },
                    500,
                );
            }
            return json({ pix_ligado: false }, 200);
        }

        return json(
            {
                erro:
                    "Ação desconhecida: use ler, salvar, testar, ligar_pix ou desligar_pix.",
            },
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
