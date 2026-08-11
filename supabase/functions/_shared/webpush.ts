// @ts-nocheck
/**
 * Web Push compartilhado entre as edge functions.
 *
 * POR QUE ESTE ARQUIVO EXISTE (PEDIDO-020, #89)
 *
 * Todo o miolo aqui nasceu dentro da `send-push/index.ts`, na reescrita da
 * PUSH-010 (#80). Quando a `notify-new-order` passou a precisar do mesmo
 * carregamento de VAPID, do mesmo envio em lote e da mesma classificação de
 * falha, havia duas saídas:
 *
 *   1. Importar de `../send-push/index.ts`. Não dá: aquele módulo chama
 *      `serve()` no topo (guardado só contra o runner de teste), então importar
 *      levantaria um segundo servidor HTTP dentro da outra função.
 *   2. Copiar as ~150 linhas. É como este repositório chegou a ter a regra de
 *      frete grátis escrita em SETE lugares (FRETE-020, #53) — e cripto
 *      duplicada é a pior versão desse problema, porque as duas cópias divergem
 *      em silêncio e a que estiver errada só falha em produção.
 *
 * Então o código saiu de lá e veio para cá. A `send-push` reexporta o que os
 * testes dela já importavam, e por isso `index_test.ts` continua valendo sem
 * uma linha alterada — era essa a condição para mexer num arquivo que funciona.
 */
import * as webpush from "jsr:@negrel/webpush@0.3.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * O projeto está migrando das chaves legadas (anon/service_role, formato JWT) para
 * as novas (publishable/secret). Durante a migração as duas coexistem: lê a nova e
 * cai pra legada. Assim a função funciona antes E depois de as legadas serem
 * desligadas no painel — o que evita janela de indisponibilidade (INFRA-260, #126).
 */
export function readKey(newVar: string, legacyVar: string): string {
  try {
    const parsed = JSON.parse(Deno.env.get(newVar) ?? "{}");
    if (parsed?.default) return parsed.default;
  } catch {
    // variável ausente ou JSON inválido — segue pro fallback
  }
  return Deno.env.get(legacyVar) ?? "";
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

export function base64UrlParaBytes(texto: string): Uint8Array {
  const limpo = texto.trim().replace(/-/g, "+").replace(/_/g, "/");
  const comPadding = limpo + "=".repeat((4 - (limpo.length % 4)) % 4);
  // `Uint8Array.from` com mapeador em vez de `bytes[i] = ...`: indexar com
  // variável dispara security/detect-object-injection, e a catraca de lint
  // conta warning novo como dívida nova.
  return Uint8Array.from(atob(comPadding), (c) => c.charCodeAt(0));
}

export function bytesParaBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Chaves VAPID
// ---------------------------------------------------------------------------

/**
 * Converte o par VAPID em base64url cru para o JWK que `importVapidKeys` quer.
 *
 * A chave pública é o ponto P-256 sem compressão: 65 bytes, o primeiro 0x04,
 * depois X e Y de 32 bytes cada. A privada é o escalar `d`, 32 bytes. É o
 * formato que o `web-push generate-vapid-keys` cospe e o mesmo que o front usa
 * em `usePushNotifications.ts` como applicationServerKey — se os dois lados não
 * casarem, o navegador aceita a inscrição e o push service devolve 403.
 *
 * Medido em 05/08/2026 (PUSH-030, #38): o ambiente de produção está no formato
 * base64url cru, 87 caracteres, e a pública bate com a `VITE_VAPID_PUBLIC_KEY`
 * do front — conferido por digest, sem expor valor.
 */
export function jwkDoParVapidCru(
  publicaBase64Url: string,
  privadaBase64Url: string,
) {
  const publica = base64UrlParaBytes(publicaBase64Url);
  if (publica.length !== 65 || publica[0] !== 0x04) {
    throw new Error(
      `VAPID_PUBLIC_KEY não é um ponto P-256 sem compressão: esperava 65 bytes começando em 0x04, veio ${publica.length} byte(s) começando em 0x${(publica[0] ?? 0).toString(16)}.`,
    );
  }
  const privada = base64UrlParaBytes(privadaBase64Url);
  if (privada.length !== 32) {
    throw new Error(
      `VAPID_PRIVATE_KEY não é um escalar P-256: esperava 32 bytes, veio ${privada.length}.`,
    );
  }
  const x = bytesParaBase64Url(publica.slice(1, 33));
  const y = bytesParaBase64Url(publica.slice(33, 65));
  return {
    publicKey: { kty: "EC", crv: "P-256", x, y },
    privateKey: { kty: "EC", crv: "P-256", x, y, d: bytesParaBase64Url(privada) },
  };
}

const pareceJson = (texto: string) => texto.trim().startsWith("{");

/**
 * Aceita os dois formatos possíveis: JWK serializado (saída de `exportVapidKeys`)
 * ou base64url cru (saída do `web-push`). Formato misto é recusado com o nome da
 * variável, em vez de falhar depois com erro de curva.
 */
export async function carregarChavesVapid(
  publicaTexto: string | undefined,
  privadaTexto: string | undefined,
): Promise<CryptoKeyPair> {
  const faltando = [
    publicaTexto ? null : "VAPID_PUBLIC_KEY",
    privadaTexto ? null : "VAPID_PRIVATE_KEY",
  ].filter(Boolean);
  if (faltando.length > 0) {
    throw new Error(
      `Chave VAPID ausente no ambiente da função: ${faltando.join(" e ")}. Sem ela nenhum push sai.`,
    );
  }

  const publicaEhJson = pareceJson(publicaTexto);
  const privadaEhJson = pareceJson(privadaTexto);
  if (publicaEhJson !== privadaEhJson) {
    throw new Error(
      `VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY estão em formatos diferentes (${publicaEhJson ? "JWK" : "base64url"} e ${privadaEhJson ? "JWK" : "base64url"}). As duas precisam ser do mesmo par.`,
    );
  }

  const exportadas = publicaEhJson
    ? { publicKey: JSON.parse(publicaTexto), privateKey: JSON.parse(privadaTexto) }
    : jwkDoParVapidCru(publicaTexto, privadaTexto);

  return await webpush.importVapidKeys(exportadas, { extractable: false });
}

// ---------------------------------------------------------------------------
// Resultado de envio
// ---------------------------------------------------------------------------

/**
 * O endpoint de push é uma URL com token de dispositivo. Ele volta para a tela
 * do admin e para o log, então sai daqui encurtado: origem + os 8 últimos
 * caracteres, o suficiente para diferenciar dois aparelhos sem publicar o token.
 */
export function endpointResumido(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const token = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return `${url.origin}/…${token.slice(-8)}`;
  } catch {
    return "(endpoint inválido)";
  }
}

/**
 * Traduz o erro do envio em motivo legível, código HTTP e "essa inscrição
 * morreu?".
 *
 * O `instanceof` sozinho não basta: se a biblioteca for carregada duas vezes
 * (versões diferentes no cache do Deno), o instanceof falha e a inscrição
 * expirada deixaria de ser removida. Por isso o segundo caminho, por formato.
 */
export function classificarFalha(erro: unknown) {
  const resposta =
    erro instanceof webpush.PushMessageError
      ? erro.response
      : (erro as { response?: Response })?.response;

  if (resposta && typeof resposta.status === "number") {
    const status = resposta.status;
    const texto = resposta.statusText ? ` ${resposta.statusText}` : "";
    return {
      status,
      motivo: `push service respondeu ${status}${texto}`,
      inscricaoMorta: status === 404 || status === 410,
    };
  }

  return {
    status: null,
    motivo: erro instanceof Error ? erro.message : String(erro),
    inscricaoMorta: false,
  };
}

/**
 * Agrupa as falhas por motivo. Uma lista de 200 linhas repetindo
 * "push service respondeu 401" não ajuda ninguém; "401 em 200 dispositivos"
 * ajuda, e cabe no toast.
 */
export function resumir(itens: any[]) {
  const grupos = new Map<string, any>();
  for (const item of itens) {
    if (item.ok) continue;
    const chave = `${item.status ?? "-"}|${item.motivo}`;
    const grupo = grupos.get(chave) ?? {
      motivo: item.motivo,
      status: item.status ?? null,
      quantidade: 0,
      exemplo: endpointResumido(item.endpoint),
    };
    grupo.quantidade += 1;
    grupos.set(chave, grupo);
  }

  const falhas = [...grupos.values()].sort(
    (a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo),
  );

  return {
    total: itens.length,
    enviados: itens.filter((i) => i.ok).length,
    falharam: itens.filter((i) => !i.ok).length,
    removidas: itens.filter((i) => i.removida).length,
    falhas,
  };
}

/**
 * Envia em lotes de 100 e devolve UM item por inscrição, na ordem de entrada.
 *
 * `aoDetectarMorta` é injetado para o teste conseguir observar a remoção sem
 * banco. Em produção é o DELETE em push_subscriptions.
 */
export async function enviarParaInscritos({
  servidor,
  inscricoes,
  mensagem,
  aoDetectarMorta,
  tamanhoDoLote = 100,
  rotulo = "push",
}: any) {
  const itens: any[] = [];

  for (let i = 0; i < inscricoes.length; i += tamanhoDoLote) {
    const lote = inscricoes.slice(i, i + tamanhoDoLote);

    // Cada tarefa devolve o PAR (inscrição, erro) em vez de rejeitar. Fica
    // equivalente ao Promise.allSettled sem precisar reparear por índice
    // depois — e casar `resultados[j]` com `lote[j]` é justamente onde um
    // envio começa a ser contado no dispositivo errado.
    const respostas = await Promise.all(
      lote.map(async (sub: any) => {
        try {
          await servidor
            .subscribe({
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            })
            .pushTextMessage(mensagem, {});
          return { sub, erro: null };
        } catch (erro) {
          return { sub, erro };
        }
      }),
    );

    // A remoção da inscrição morta acontece aqui fora, em série: são DELETEs no
    // banco, e disparar 100 de uma vez no meio do envio não ajuda ninguém.
    for (const { sub, erro } of respostas) {
      if (!erro) {
        itens.push({ endpoint: sub.endpoint, ok: true });
        continue;
      }

      const { motivo, status, inscricaoMorta } = classificarFalha(erro);
      let removida = false;
      if (inscricaoMorta && aoDetectarMorta) {
        try {
          await aoDetectarMorta(sub.endpoint);
          removida = true;
        } catch (erroDaRemocao) {
          console.error(
            `${rotulo}: falhou ao remover inscrição morta`,
            endpointResumido(sub.endpoint),
            erroDaRemocao,
          );
        }
      }
      itens.push({
        endpoint: sub.endpoint,
        ok: false,
        motivo,
        status,
        removida,
      });
    }
  }

  return itens;
}
