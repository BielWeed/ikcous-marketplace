// ============================================================================
// Credenciais do Mercado Pago — de onde vem o token que cobra o cliente.
//
// POR QUE ESTE ARQUIVO EXISTE (tarefa mp-1, 15/09/2026)
//
// A tela Ajustes > Pagamentos > Mercado Pago (edge credenciais-mercado-pago)
// já guardava a chave do LOJISTA cifrada em app_settings, mas quem cobrava
// de verdade (criar-pagamento, webhook-mercadopago, reconciliar-pagamentos,
// estornar-pagamento) seguia lendo o MP_ACCESS_TOKEN da PLATAFORMA. Chave
// cadastrada que não cobra nada é pior que campo nenhum: o lojista acha que
// o dinheiro cai na conta dele. O dono decidiu que a chave do lojista passa
// a valer — e isso exige UM lugar só que responda "qual token, de quem, e
// se dá para usar". Duas cópias dessa decisão é o defeito #53 (a mesma
// regra escrita em vários lugares) com dinheiro em cima.
//
// A REGRA É FECHADA, e o motivo é de dinheiro:
//   * Tem registro do lojista com token cifrado? Decifra e usa o DELE.
//   * Não conseguiu decifrar (cofre fora do ar, chave trocada, ciphertext
//     corrompido)? Origem "indisponivel" — NUNCA o token do ambiente.
//     Cair no token da plataforma aqui é cobrar o cliente na conta ERRADA,
//     e dinheiro na conta errada é pior que venda não fechada: o cliente
//     pagou, o lojista não recebeu, e desfazer isso é operação manual.
//   * Nem sequer existe registro? Origem "ambiente" com MP_ACCESS_TOKEN /
//     MP_WEBHOOK_SECRET — é o comportamento de hoje, para a loja que ainda
//     roda pelas chaves da plataforma.
//   * Não deu para saber se existe registro (banco recusou a leitura, valor
//     ilegível)? Também FECHA. Na dúvida sobre existir chave do lojista,
//     usar a do ambiente é justamente o risco de cobrar na conta errada.
//
// NADA DE SEGREDO EM LOG: daqui só saem `origem` e `motivo` (palavras
// fixas, sem token, sem ciphertext, sem segredo de webhook).
//
// RESERVA DO SEGREDO DE WEBHOOK: quando o lojista cadastrou o token mas NÃO
// cadastrou o segredo de notificação, `segredoWebhook` volta null com
// origem "lojista" — este módulo não inventa reserva. Quem valida o HMAC
// (webhook-mercadopago) decide se cai no MP_WEBHOOK_SECRET do ambiente;
// só o TOKEN é que não tem reserva nenhuma, pela regra acima.
//
// O `env` entra por parâmetro (mesma costura do `fetch` no resto da casa):
// teste tira o cofre do lugar sem mexer no Deno.env do processo, que é
// global e vazaria entre casos.
// ============================================================================

/** O mínimo que este módulo usa do ambiente — `Deno.env` já serve. */
export type AmbienteLeitura = { get(chave: string): string | undefined };

/** Linha única do lojista em app_settings (app único, banco por cliente). */
export const CHAVE_SETTINGS = "pagamentos_mercado_pago";

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

/** De quem é a chave que vai cobrar — e, quando não dá, por quê. */
export type OrigemCredenciais = "lojista" | "ambiente" | "indisponivel";

export type CredenciaisMp = {
    origem: OrigemCredenciais;
    token: string | null;
    segredoWebhook: string | null;
    publicKey: string | null;
    /** Palavra fixa para log/telemetria — jamais carrega segredo. */
    motivo?: string;
};

// ── Cifração (AES-256-GCM do WebCrypto — Deno traz crypto.subtle) ────────
// Estas quatro primitivas nasceram dentro de credenciais-mercado-pago e
// vieram para cá INTEIRAS (mesmo corpo, mesmo comportamento): quem grava o
// segredo e quem o lê na hora de cobrar têm de usar exatamente a mesma
// cifra, e o `env` injetável é a única diferença.

function base64ParaBytes(base64: string): Uint8Array {
    // Uint8Array.from em vez de índice variável (`bytes[i] =`) — mesmo
    // resultado, sem acordar a catraca de segurança do eslint.
    return Uint8Array.from(atob(base64), (caractere) => caractere.charCodeAt(0));
}

function bytesParaBase64(bytes: Uint8Array): string {
    let binaria = "";
    for (const byte of bytes) binaria += String.fromCharCode(byte);
    return btoa(binaria);
}

/** Chave da env; ausente/malformada devolve null — quem chama falha FECHADO. */
export async function chaveDeCifra(
    env: AmbienteLeitura = Deno.env,
): Promise<CryptoKey | null> {
    const segredo = env.get("MP_CHAVES_ENCRYPTION_KEY")?.trim() ?? "";
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

export async function cifrar(
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

export async function decifrar(
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

// ── app_settings (via supabase client injetável) ─────────────────────────

/**
 * Lê o registro do lojista. Precisa de client com SERVICE ROLE: a linha de
 * app_settings é só-admin por RLS, e quem chama daqui é edge function.
 *
 * Erro de banco vira `storage_leitura:` — o prefixo que a edge
 * credenciais-mercado-pago já traduz em recado para o lojista.
 */
export async function lerRegistroMp(supabase: any): Promise<Registro | null> {
    const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", CHAVE_SETTINGS)
        .maybeSingle();
    if (error) throw new Error(`storage_leitura: ${error.message}`);
    if (!data?.value) return null;
    return JSON.parse(data.value) as Registro;
}

/**
 * Responde, para quem vai falar com o Mercado Pago, QUAL credencial usar.
 * Ver o cabeçalho deste arquivo para o porquê de cada ramo — em especial o
 * de nunca cair no ambiente quando o lojista já cadastrou chave.
 */
export async function resolverCredenciaisMp(
    supabase: any,
    env: AmbienteLeitura = Deno.env,
): Promise<CredenciaisMp> {
    let registro: Registro | null;
    try {
        registro = await lerRegistroMp(supabase);
    } catch {
        // Banco recusou a leitura ou o valor não é JSON: não dá para afirmar
        // que NÃO existe chave do lojista, então fecha (nunca o ambiente).
        return fechado("registro_ilegivel");
    }

    // Registro sem token cifrado é registro pela metade (a própria edge o
    // reporta como `configurado: false`): ninguém cadastrou chave ainda, o
    // ambiente segue valendo.
    if (!registro?.token_cifrado) {
        return doAmbiente(env);
    }

    const chave = await chaveDeCifra(env);
    if (!chave) {
        // O cofre é obrigatório quando existe chave do lojista: sem ele a
        // loja fica sem cobrar, e é esse o lado seguro de errar.
        return fechado("cofre_ausente", registro.public_key);
    }

    let token: string;
    try {
        token = await decifrar(registro.token_cifrado, registro.token_iv, chave);
    } catch {
        return fechado("token_ilegivel", registro.public_key);
    }

    // O segredo do webhook é opcional e NÃO derruba o token: o lojista pode
    // ter cadastrado só a chave de cobrança. Segredo ilegível também não
    // derruba a cobrança — quem confere assinatura é que decide o que fazer
    // com a falta dele.
    let segredoWebhook: string | null = null;
    if (registro.webhook_cifrado && registro.webhook_iv) {
        try {
            segredoWebhook = await decifrar(
                registro.webhook_cifrado,
                registro.webhook_iv,
                chave,
            );
        } catch {
            console.error(
                "[credenciais-mp] segredo de webhook do lojista ilegível (motivo: webhook_ilegivel)",
            );
            segredoWebhook = null;
        }
    }

    return {
        origem: "lojista",
        token,
        segredoWebhook,
        publicKey: registro.public_key || null,
    };
}

/** Sem registro: o comportamento de sempre, com as chaves da plataforma. */
function doAmbiente(env: AmbienteLeitura): CredenciaisMp {
    const token = env.get("MP_ACCESS_TOKEN")?.trim() || null;
    const segredoWebhook = env.get("MP_WEBHOOK_SECRET")?.trim() || null;
    if (!token) {
        console.error(
            "[credenciais-mp] sem chave do lojista e sem MP_ACCESS_TOKEN no ambiente (origem: ambiente, motivo: ambiente_sem_token)",
        );
    }
    return {
        origem: "ambiente",
        token,
        segredoWebhook,
        // O ambiente não guarda Public Key: ela só existe no registro do
        // lojista (e em store_config, que não é assunto deste módulo).
        publicKey: null,
        ...(token ? {} : { motivo: "ambiente_sem_token" }),
    };
}

/** Falha fechada: log só com origem/motivo, jamais com segredo. */
function fechado(motivo: string, publicKey: string | null = null): CredenciaisMp {
    console.error(
        `[credenciais-mp] credenciais do lojista indisponíveis (origem: indisponivel, motivo: ${motivo})`,
    );
    return {
        origem: "indisponivel",
        token: null,
        segredoWebhook: null,
        publicKey: publicKey || null,
        motivo,
    };
}
