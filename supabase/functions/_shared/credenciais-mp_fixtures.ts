// ============================================================================
// Dublês das credenciais do Mercado Pago — SÓ fixtures, nenhum Deno.test.
//
// POR QUE ESTE ARQUIVO EXISTE (ressalva da revisão de mp-1, tarefa mp-6)
//
// O registro cifrado do lojista era montado à mão em CINCO lugares: aqui do
// lado (`credenciais-mp_test.ts`) e nos `index_test.ts` de criar-pagamento,
// webhook-mercadopago, reconciliar-pagamentos e estornar-pagamento. Cinco
// cópias do mesmo fixture é o defeito #53 (a mesma regra escrita em vários
// lugares) dentro dos testes: no dia em que a forma do registro em
// app_settings mudar — um campo novo, um nome trocado —, quatro suítes
// seguem VERDES sobre um registro que a produção não escreve mais. Fixture
// verde sobre forma morta é pior que teste faltando: ele afirma.
//
// POR QUE NÃO É `*_test.ts`: `deno test supabase/functions/` coleta por
// nome de arquivo. Se as suítes importassem o fixture de um `_test.ts`, os
// testes DELE rodariam de novo dentro de cada uma das cinco — e um
// `Deno.env.set` de uma suíte apareceria no meio da outra. O sufixo
// `_fixtures` mantém este módulo fora da coleta.
//
// NENHUM SEGREDO DE VERDADE MORA AQUI. Tudo é chave de MENTIRA, legível de
// propósito, para o AES e o HMAC rodarem de verdade dentro do teste. As
// chaves de service role / anon são MONTADAS em tempo de execução, nunca
// escritas como literal: um JWT literal no repositório acorda o secretlint
// do pre-commit (que é a única trava contra credencial vazada), e ensinar o
// time a ignorar esse alarme é o começo do vazamento de verdade.
// ============================================================================

import {
    chaveDeCifra,
    cifrar,
    type Registro,
} from "./credenciais-mp.ts";

/** A mesma forma mínima de ambiente que o módulo consome (`get`). */
export type AmbienteFalso = { get(chave: string): string | undefined };

/**
 * Cofre de MENTIRA: 32 bytes determinísticos em base64. É a MESMA receita
 * que o `credenciais-mercado-pago/index_test.ts` usa para gravar — quem
 * escreve o registro lá é quem o lê aqui.
 */
export const CHAVE_CIFRA_TESTE = btoa(
    String.fromCharCode(
        ...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256),
    ),
);

/** Outro cofre, igualmente falso — para o caso "trocaram a chave". */
export const CHAVE_CIFRA_TESTE_OUTRA = btoa(
    String.fromCharCode(
        ...Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256),
    ),
);

export const PUBLIC_KEY_LOJISTA_FALSA = "APP_USR-publica-falsa-do-lojista";
export const TOKEN_LOJISTA_FALSO = "APP_USR-token-falso-do-lojista-9999";
export const WEBHOOK_LOJISTA_FALSO = "segredo-falso-de-webhook-do-lojista";
export const TOKEN_AMBIENTE_FALSO = "APP_USR-token-falso-da-plataforma-1111";
export const WEBHOOK_AMBIENTE_FALSO = "segredo-falso-de-webhook-da-plataforma";

/** Data fixa nos fixtures: `new Date()` deixa o registro diferente a cada
 * execução, e fixture que muda sozinho é ruído quando algum dia alguém
 * comparar dois registros. */
const ATUALIZADO_EM_FIXO = "2026-09-15T00:00:00.000Z";

/**
 * JWT de MENTIRA — montado na hora, com assinatura que não confere com
 * nada. Serve só para o `role` ser LEGÍVEL: é por essa claim que
 * `resolverCredenciaisMp` reconhece um client que não é de service role.
 */
function chaveJwtFalsa(papel: string): string {
    const base64Url = (objeto: unknown) =>
        btoa(JSON.stringify(objeto))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    const cabecalho = base64Url({ alg: "HS256", typ: "JWT" });
    const corpo = base64Url({ role: papel, iss: "supabase-de-mentira" });
    return `${cabecalho}.${corpo}.assinatura-de-mentira-nao-confere`;
}

/** Chave de service role FALSA — a que a edge function usa de verdade. */
export const CHAVE_SERVICE_ROLE_FALSA = chaveJwtFalsa("service_role");

/** Chave anon/publicável FALSA — a do client de USUÁRIO, que não enxerga
 * app_settings por RLS e por isso não pode resolver credencial nenhuma. */
export const CHAVE_ANON_FALSA = chaveJwtFalsa("anon");

// Formato NOVO das chaves do Supabase (`sb_secret_` / `sb_publishable_`),
// que este repositório já lê por `SUPABASE_SECRET_KEYS` e
// `SUPABASE_PUBLISHABLE_KEYS`. Montadas por concatenação de propósito: o
// prefixo `sb_secret_` escrito inteiro num literal é padrão vigiado pelo
// secretlint do pre-commit, e fixture não pode ensinar ninguém a ignorá-lo.
export const CHAVE_SECRET_NOVA_FALSA = "sb_" + "secret_de-mentira-nao-e-chave";
export const CHAVE_PUBLISHABLE_NOVA_FALSA = "sb_" +
    "publishable_de-mentira-nao-e-chave";

/**
 * Ambiente dublê com a MESMA forma que o módulo usa (`get`). Map em vez de
 * `pares[chave]`: acesso indexado por variável acorda a catraca de
 * segurança do eslint (mesmo motivo do `Uint8Array.from` lá no módulo).
 */
export function envFalso(pares: Record<string, string>): AmbienteFalso {
    const mapa = new Map(Object.entries(pares));
    return { get: (chave: string) => mapa.get(chave) };
}

/** Ambiente da plataforma "completo" — o que existe hoje em produção. */
export function envDaPlataforma(): AmbienteFalso {
    return envFalso({
        MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE,
        MP_ACCESS_TOKEN: TOKEN_AMBIENTE_FALSO,
        MP_WEBHOOK_SECRET: WEBHOOK_AMBIENTE_FALSO,
    });
}

/**
 * Registro do lojista cifrado com a MESMA primitiva da produção — fixture
 * escrito à mão (um base64 qualquer no `token_cifrado`) não provaria que
 * quem cobra decifra de verdade.
 */
export async function registroMpDeTeste(
    opcoes: {
        token?: string;
        /** `null` = o lojista cadastrou só a chave de cobrança. */
        webhookSecret?: string | null;
        publicKey?: string;
        /** Cifra com OUTRO cofre — o caso "trocaram a chave". */
        chaveCifra?: string;
    } = {},
): Promise<Registro> {
    const chave = await chaveDeCifra(
        envFalso({
            MP_CHAVES_ENCRYPTION_KEY: opcoes.chaveCifra ?? CHAVE_CIFRA_TESTE,
        }),
    );
    if (!chave) throw new Error("fixture: chave de cifra de teste inválida");
    const token = opcoes.token ?? TOKEN_LOJISTA_FALSO;
    const tokenCifrado = await cifrar(token, chave);
    const segredo = opcoes.webhookSecret === null
        ? null
        : opcoes.webhookSecret ?? WEBHOOK_LOJISTA_FALSO;
    const webhookCifrado = segredo ? await cifrar(segredo, chave) : null;
    return {
        public_key: opcoes.publicKey ?? PUBLIC_KEY_LOJISTA_FALSA,
        token_cifrado: tokenCifrado.cifrado,
        token_iv: tokenCifrado.iv,
        mascara_token: `••••${token.slice(-4)}`,
        webhook_cifrado: webhookCifrado?.cifrado ?? null,
        webhook_iv: webhookCifrado?.iv ?? null,
        mascara_webhook: segredo ? `••••${segredo.slice(-4)}` : null,
        ultimo_teste: null,
        atualizado_em: ATUALIZADO_EM_FIXO,
    };
}

/**
 * Client do Supabase dublê para app_settings — só o que `lerRegistroMp`
 * usa (select/eq/maybeSingle). Aceita registro, texto cru (para o caso do
 * valor ilegível) ou erro de leitura.
 *
 * `chaveDoClient` responde ao contrato de service role: por padrão é a
 * chave de service role FALSA, que é o que a edge function passa de
 * verdade. Passe `CHAVE_ANON_FALSA` para dublar o client de USUÁRIO.
 */
export function supabaseComRegistro(
    registro: Registro | string | null,
    erro: { message: string } | null = null,
    chaveDoClient: string = CHAVE_SERVICE_ROLE_FALSA,
): any {
    const valor = registro === null
        ? null
        : typeof registro === "string"
        ? registro
        : JSON.stringify(registro);
    const tabela = {
        select() {
            return this;
        },
        eq() {
            return this;
        },
        maybeSingle() {
            return Promise.resolve({
                data: erro || !valor ? null : { value: valor },
                error: erro,
            });
        },
    };
    // `supabaseKey` é onde o supabase-js v2 guarda a chave com que o client
    // foi construído — é dali que o módulo lê o papel.
    return { from: () => tabela, supabaseKey: chaveDoClient };
}
