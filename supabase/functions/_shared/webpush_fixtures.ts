// @ts-nocheck
/**
 * Peças de teste para provar o que sai NO FIO de um push: um par VAPID de
 * verdade, uma inscrição de navegador de verdade (p256dh e auth válidos) e um
 * "push service" local que guarda os cabeçalhos que recebeu.
 *
 * Mesmo molde dos auxiliares de `send-push/index_test.ts`, em arquivo próprio
 * para os testes dos avisos ao lojista (`aviso-ao-lojista_test.ts`,
 * `criar-pagamento/alerta-orfao_test.ts`) não repetirem ~70 linhas de cripto.
 * Não termina em `_test.ts`, então o runner não o trata como suíte.
 */
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import { bytesParaBase64Url } from "./webpush.ts";

/** Par VAPID novo, nos dois formatos que as variáveis de ambiente aceitam. */
export async function parVapidDeTeste() {
  const par = await webpush.generateVapidKeys({ extractable: true });
  const publicaCrua = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const jwkPrivada = await crypto.subtle.exportKey("jwk", par.privateKey);
  return { publica: bytesParaBase64Url(publicaCrua), privada: jwkPrivada.d };
}

/** Inscrição de navegador válida (p256dh de verdade, auth de 16 bytes). */
export async function inscricaoDeTeste(endpoint: string) {
  const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);
  const bruta = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { endpoint, p256dh: bytesParaBase64Url(bruta), auth: bytesParaBase64Url(auth) };
}

/**
 * Push service falso: responde o status que o teste mandar para cada caminho e
 * guarda o que chegou. `Map` e não indexação de objeto: `obj[variavel]` dispara
 * security/detect-object-injection e sobe a catraca de lint.
 */
export function pushServiceFalso(statusPorCaminho: Record<string, number>) {
  const status = new Map(Object.entries(statusPorCaminho));
  const recebidas: { caminho: string; headers: Headers }[] = [];
  const servidor = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const caminho = new URL(req.url).pathname;
    await req.arrayBuffer();
    recebidas.push({ caminho, headers: req.headers });
    return new Response(null, { status: status.get(caminho) ?? 201 });
  });
  return {
    recebidas,
    base: `http://localhost:${servidor.addr.port}`,
    encerrar: () => servidor.shutdown(),
  };
}
