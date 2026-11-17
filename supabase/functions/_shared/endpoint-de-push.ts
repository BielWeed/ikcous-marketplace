// @ts-nocheck
/**
 * Trava do endereço do aparelho antes do envio de push (SSRF cego).
 *
 * O `endpoint` de uma inscrição vem do NAVEGADOR de quem se inscreveu, e a
 * policy de `push_subscriptions` só confere que a linha é do próprio usuário:
 * qualquer conta (contas são gratuitas) grava o endereço que quiser. A
 * biblioteca `@negrel/webpush` faz `fetch(endpoint)` direto, então sem esta
 * trava a edge function dispara um POST para `http://127.0.0.1:porta/x`, host
 * de rede interna ou metadata de nuvem — cego (a resposta não volta), mas
 * alcança o destino.
 *
 * NÃO é lista fechada de hosts, de propósito: os push services reais variam
 * (FCM, Mozilla, Apple, Windows, e os que surgirem) e uma lista derrubaria
 * cliente legítimo. A regra recusa o que NUNCA é um push service público:
 *
 *   - URL inválida, ou esquema diferente de `https:`;
 *   - usuário/senha na URL (inclusive o truque `https://bom@interno/`);
 *   - porta diferente da padrão (443);
 *   - host que é IP literal (v4 ou v6), `localhost`, termina em `.local`,
 *     `.internal`, `.localhost` ou `.lan`, ou é rótulo único sem ponto.
 *
 * Quem decide é o MESMO analisador de URL que o `fetch` usa (`new URL`), então
 * as formas disfarçadas de IP (`2130706433`, `0x7f.0.0.1`, `127.1`) já chegam
 * aqui normalizadas para o dotted-quad e caem na regra de IP literal.
 *
 * O QUE ESTA TRAVA NÃO COBRE (limite conhecido, não promessa; medido no Deno
 * 2.9.2): (1) o `fetch` da `@negrel/webpush` não passa `redirect`, então SEGUE
 * redirecionamento: um host público do atacante que responde 307 para um
 * endereço interno faz o POST chegar lá; (2) nome público que resolve para IP
 * interno (`*.nip.io`, DNS rebinding) é aceito. O impacto segue limitado a um
 * POST cego com corpo cifrado, e já existia antes da trava. Fechar de verdade
 * exige controlar o fetch (`redirect: "manual"` e conferir o IP após resolver o
 * DNS): tarefa separada.
 */

const SUFIXOS_DE_REDE_INTERNA = [".local", ".internal", ".localhost", ".lan"];

// A brecha dos testes: os testes ponta a ponta da `send-push` sobem um push
// service em `http://localhost:porta`. Só o `localhost` (qualquer porta, http ou
// https) é liberado, e só enquanto a brecha estiver ligada. Começa desligada.
let aceitaLocalhostNosTestes = false;

/**
 * Liga a brecha de teste e devolve a função que a desliga. Recusa ligar dentro
 * do Edge Runtime (produção): lá o global `EdgeRuntime` existe, no `deno test`
 * não (mesma detecção que `comTempoLimite` já usa em `webpush.ts`).
 */
export function aceitarPushServiceLocalSoNosTestes(): () => void {
  if ((globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== undefined) {
    throw new Error(
      "aceitarPushServiceLocalSoNosTestes: só nos testes. Dentro do Edge Runtime o endereço de push não tem brecha.",
    );
  }
  const anterior = aceitaLocalhostNosTestes;
  aceitaLocalhostNosTestes = true;
  return () => {
    aceitaLocalhostNosTestes = anterior;
  };
}

/**
 * `true` quando o endereço pode receber um push. Função pura: não faz rede,
 * não lança, e qualquer coisa que não seja `string` é recusada (um array com
 * uma URL dentro viraria URL válida no `String(...)` implícito do `new URL`).
 */
export function endpointDePushPermitido(endpoint: unknown): boolean {
  if (typeof endpoint !== "string") return false;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.username !== "" || url.password !== "") return false;

  if (
    aceitaLocalhostNosTestes &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.hostname === "localhost"
  ) {
    return true;
  }

  if (url.protocol !== "https:") return false;
  // `new URL` devolve porta vazia quando é a padrão do esquema (443 aqui).
  if (url.port !== "") return false;

  // Ponto final do FQDN (`localhost.`, `servico.local.`) é o mesmo host.
  const host = url.hostname.replace(/\.$/, "");
  if (host === "") return false;
  // IPv6 literal chega entre colchetes.
  if (host.startsWith("[")) return false;
  // IPv4 literal: o analisador de URL já normalizou as formas disfarçadas para
  // dotted-quad, e todo IPv4 termina em rótulo numérico (nome DNS real nunca
  // termina: o TLD tem letras).
  if (/^\d+$/.test(host.slice(host.lastIndexOf(".") + 1))) return false;
  if (host === "localhost") return false;
  if (SUFIXOS_DE_REDE_INTERNA.some((sufixo) => host.endsWith(sufixo))) return false;
  // Rótulo único (`intranet`, `servidor`) resolve por busca de rede interna.
  if (!host.includes(".")) return false;

  return true;
}
