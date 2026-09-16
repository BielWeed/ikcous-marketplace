// Testes do módulo compartilhado de credenciais do Mercado Pago —
// tarefa mp-1 (15/09/2026). Nenhuma rede, nenhum banco: o client do
// Supabase e o ambiente entram DUBLADOS (o `env` é parâmetro justamente
// para o teste poder tirar o cofre do lugar sem mexer no Deno.env do
// processo, que é global e vaza entre passos).
//
// As chaves daqui são FALSAS de mentira, legíveis de propósito — nunca a
// chave real de ninguém (mesma regra do credenciais-mercado-pago/index_test).
//
// Afirmativas nomeadas:
//   R1  registro decifrável -> origem "lojista" com o token E o segredo de
//       webhook do LOJISTA (nunca os do ambiente, que aqui estão setados)
//   R2  sem registro + env -> origem "ambiente" com MP_ACCESS_TOKEN e
//       MP_WEBHOOK_SECRET (a loja que ainda roda pelo env segue rodando)
//   R3  sem registro e sem env -> origem "ambiente" com token null e motivo
//   R4  registro + cofre ausente -> FALHA FECHADA: origem "indisponivel",
//       token null, e NÃO cai no token do ambiente (cobrar na conta errada
//       é pior que não cobrar)
//   R5  registro corrompido (ciphertext lixo) -> "indisponivel"; e nada do
//       segredo aparece no que foi para o console
//   R6  registro cifrado com OUTRA chave (cofre trocado) -> "indisponivel"
//   R7  valor ilegível em app_settings -> "indisponivel" (na dúvida sobre
//       existir chave do lojista, NÃO se usa o token do ambiente)
//   R8  falha na LEITURA do app_settings -> "indisponivel" pelo mesmo motivo
//   R9  registro sem token_cifrado (nunca chegou a configurar) -> "ambiente"
//   R10 registro do lojista SEM segredo de webhook -> origem "lojista" com
//       segredoWebhook null MESMO com MP_WEBHOOK_SECRET no ambiente (a
//       reserva do segredo é decisão de quem valida o HMAC, não daqui)
//   R11 as primitivas movidas continuam de pé: cifrar/decifrar fecham o
//       ciclo e chaveDeCifra devolve null para cofre ausente/curto/inválido
//   R12 lerRegistroMp traduz erro do banco em storage_leitura (o recado que
//       a edge credenciais-mercado-pago já mapeia para o lojista)
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
    chaveDeCifra,
    cifrar,
    decifrar,
    lerRegistroMp,
    type Registro,
    resolverCredenciaisMp,
} from "./credenciais-mp.ts";

// Chave de cifra dos testes: 32 bytes determinísticos em base64 — chave de
// MENTIRA, só para o AES rodar de verdade dentro do teste. MESMA receita do
// credenciais-mercado-pago/index_test.ts (quem escreve o registro lá é quem
// lê aqui).
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

/**
 * Ambiente dublê com a MESMA forma que o módulo usa (`get`). Map em vez de
 * `pares[chave]`: acesso indexado por variável acorda a catraca de segurança
 * do eslint (mesmo motivo do Uint8Array.from lá no módulo).
 */
export function envFalso(
    pares: Record<string, string>,
): { get(chave: string): string | undefined } {
    const mapa = new Map(Object.entries(pares));
    return { get: (chave: string) => mapa.get(chave) };
}

/** Ambiente da plataforma "completo" — o que existe hoje em produção. */
function envDaPlataforma(): { get(chave: string): string | undefined } {
    return envFalso({
        MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE,
        MP_ACCESS_TOKEN: TOKEN_AMBIENTE_FALSO,
        MP_WEBHOOK_SECRET: WEBHOOK_AMBIENTE_FALSO,
    });
}

/**
 * Fixture do registro cifrado do lojista — exportada de propósito: as
 * functions de pagamento (mp-2) precisam do MESMO registro para provar que o
 * Bearer que sai daqui é o token do lojista.
 */
export async function registroMpDeTeste(
    opcoes: {
        token?: string;
        webhookSecret?: string | null;
        publicKey?: string;
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
        atualizado_em: new Date().toISOString(),
    };
}

/**
 * Client do Supabase dublê para app_settings — só o que lerRegistroMp usa
 * (select/eq/maybeSingle). Aceita registro, texto cru (para o caso do valor
 * ilegível) ou erro de leitura.
 */
export function supabaseComRegistro(
    registro: Registro | string | null,
    erro: { message: string } | null = null,
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
    return { from: () => tabela };
}

/** Anota o que foi para o console — nenhum segredo pode passar por aqui. */
async function comConsoleAnotado(
    executar: () => Promise<void>,
): Promise<string> {
    const erroOriginal = console.error;
    const logOriginal = console.log;
    let anotado = "";
    const anotar = (...partes: unknown[]) => {
        anotado += partes.map((parte) => String(parte)).join(" ") + "\n";
    };
    console.error = anotar;
    console.log = anotar;
    try {
        await executar();
    } finally {
        console.error = erroOriginal;
        console.log = logOriginal;
    }
    return anotado;
}

Deno.test("credenciais-mp (módulo compartilhado)", async (t) => {
    await t.step("R1 — registro decifrável -> origem lojista", async () => {
        const registro = await registroMpDeTeste();
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(registro),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "lojista");
        assertEquals(credenciais.token, TOKEN_LOJISTA_FALSO);
        assertEquals(credenciais.segredoWebhook, WEBHOOK_LOJISTA_FALSO);
        assertEquals(credenciais.publicKey, PUBLIC_KEY_LOJISTA_FALSA);
    });

    await t.step("R2 — sem registro + env -> origem ambiente", async () => {
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(null),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "ambiente");
        assertEquals(credenciais.token, TOKEN_AMBIENTE_FALSO);
        assertEquals(credenciais.segredoWebhook, WEBHOOK_AMBIENTE_FALSO);
        assertEquals(credenciais.publicKey, null);
    });

    await t.step("R3 — sem registro e sem env -> ambiente sem token", async () => {
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(null),
            envFalso({}),
        );
        assertEquals(credenciais.origem, "ambiente");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.segredoWebhook, null);
        assertEquals(typeof credenciais.motivo, "string");
    });

    await t.step("R4 — registro + cofre ausente -> falha FECHADA", async () => {
        const registro = await registroMpDeTeste();
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(registro),
            envFalso({
                MP_ACCESS_TOKEN: TOKEN_AMBIENTE_FALSO,
                MP_WEBHOOK_SECRET: WEBHOOK_AMBIENTE_FALSO,
            }),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.segredoWebhook, null);
        assertEquals(credenciais.motivo, "cofre_ausente");
    });

    await t.step("R5 — registro corrompido -> indisponivel e sem vazar", async () => {
        const registro = await registroMpDeTeste();
        const corrompido: Registro = {
            ...registro,
            token_cifrado: "isto-nao-e-base64-de-verdade!!!",
        };
        let credenciais: Awaited<ReturnType<typeof resolverCredenciaisMp>> | null =
            null;
        const console_ = await comConsoleAnotado(async () => {
            credenciais = await resolverCredenciaisMp(
                supabaseComRegistro(corrompido),
                envDaPlataforma(),
            );
        });
        assertEquals(credenciais!.origem, "indisponivel");
        assertEquals(credenciais!.token, null);
        assertEquals(credenciais!.motivo, "token_ilegivel");
        // Log só com origem/motivo: nem o token do lojista nem o da
        // plataforma nem o ciphertext podem aparecer.
        assertEquals(console_.includes(TOKEN_LOJISTA_FALSO), false);
        assertEquals(console_.includes(TOKEN_AMBIENTE_FALSO), false);
        assertEquals(console_.includes(registro.token_cifrado), false);
    });

    await t.step("R6 — cofre trocado (outra chave) -> indisponivel", async () => {
        const registro = await registroMpDeTeste({
            chaveCifra: CHAVE_CIFRA_TESTE_OUTRA,
        });
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(registro),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.motivo, "token_ilegivel");
    });

    await t.step("R7 — valor ilegível em app_settings -> indisponivel", async () => {
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro("{isto não é json}"),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.motivo, "registro_ilegivel");
    });

    await t.step("R8 — leitura do app_settings falhou -> indisponivel", async () => {
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(null, { message: "conexão caiu" }),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "indisponivel");
        assertEquals(credenciais.token, null);
        assertEquals(credenciais.motivo, "registro_ilegivel");
    });

    await t.step("R9 — registro sem token_cifrado -> ambiente", async () => {
        const registro = await registroMpDeTeste();
        const semToken: Registro = {
            ...registro,
            token_cifrado: "",
            token_iv: "",
            mascara_token: "",
        };
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(semToken),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "ambiente");
        assertEquals(credenciais.token, TOKEN_AMBIENTE_FALSO);
    });

    await t.step("R10 — lojista sem segredo de webhook -> null, sem reserva", async () => {
        const registro = await registroMpDeTeste({ webhookSecret: null });
        const credenciais = await resolverCredenciaisMp(
            supabaseComRegistro(registro),
            envDaPlataforma(),
        );
        assertEquals(credenciais.origem, "lojista");
        assertEquals(credenciais.token, TOKEN_LOJISTA_FALSO);
        assertEquals(credenciais.segredoWebhook, null);
    });

    await t.step("R11 — primitivas movidas seguem de pé", async () => {
        const chave = await chaveDeCifra(
            envFalso({ MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE }),
        );
        assertEquals(chave === null, false);
        const { cifrado, iv } = await cifrar(TOKEN_LOJISTA_FALSO, chave!);
        assertEquals(cifrado.includes(TOKEN_LOJISTA_FALSO), false);
        assertEquals(await decifrar(cifrado, iv, chave!), TOKEN_LOJISTA_FALSO);
        // Cofre ausente, curto demais e não-base64 caem todos em null.
        assertEquals(await chaveDeCifra(envFalso({})), null);
        assertEquals(
            await chaveDeCifra(
                envFalso({ MP_CHAVES_ENCRYPTION_KEY: btoa("curta demais") }),
            ),
            null,
        );
        assertEquals(
            await chaveDeCifra(
                envFalso({ MP_CHAVES_ENCRYPTION_KEY: "não#é#base64" }),
            ),
            null,
        );
    });

    await t.step("R12 — erro de leitura vira storage_leitura", async () => {
        let mensagem = "";
        try {
            await lerRegistroMp(
                supabaseComRegistro(null, { message: "conexão caiu" }),
            );
        } catch (err) {
            mensagem = err instanceof Error ? err.message : String(err);
        }
        assertEquals(mensagem.startsWith("storage_leitura:"), true);
    });
});
