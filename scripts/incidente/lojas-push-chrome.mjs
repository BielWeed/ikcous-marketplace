// Temporário (28/09/2026): o "Quero receber!" das lojas novas dá a mensagem
// de "navegador" (a inscrição falha no aparelho, antes do banco). Aqui um
// Chrome de verdade abre cada loja, lê a chave VAPID que a PÁGINA entrega (a
// ficha no HTML) e faz o mesmo `pushManager.subscribe` do app — com uma
// chave-controle gerada na hora para calibrar. Nada vai para o banco; cada
// inscrição é desfeita no fim.
import crypto from "node:crypto";
import { createRequire } from "node:module";

const req = createRequire("/tmp/pw/");
const { chromium } = req("playwright");

const controle = (() => {
  const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const j = publicKey.export({ format: "jwk" });
  return Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("base64url");
})();

const navegador = await chromium.launch({ channel: "chrome", headless: false });
for (const host of ["almeidastore.vercel.app", "brandmeliz.vercel.app", "spacelojadoskit.vercel.app"]) {
  const contexto = await navegador.newContext();
  await contexto.grantPermissions(["notifications"], { origin: `https://${host}` });
  const pagina = await contexto.newPage();
  await pagina.goto(`https://${host}/`, { waitUntil: "domcontentloaded" });
  const resultado = await pagina.evaluate(async (chaveControle) => {
    const ficha = JSON.parse(document.getElementById("ikcous-loja")?.textContent ?? "null");
    const chave = ficha?.configuracao?.vapidPublicKey ?? null;
    const paraBytes = (k) => {
      const b64 = (k + "=".repeat((4 - (k.length % 4)) % 4)).replaceAll("-", "+").replaceAll("_", "/");
      const bruto = atob(b64);
      return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
    };
    const tentar = async (k) => {
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, rej) => setTimeout(() => rej(new Error("serviceWorker.ready não resolveu em 30s")), 30000)),
        ]);
        const antiga = await reg.pushManager.getSubscription();
        if (antiga) await antiga.unsubscribe();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: paraBytes(k) });
        const host = new URL(sub.endpoint).host;
        await sub.unsubscribe();
        return `OK (push service ${host})`;
      } catch (e) {
        return `FALHOU: ${e?.name ?? "?"}: ${e?.message ?? e}`;
      }
    };
    return {
      temFicha: Boolean(ficha),
      chaveNaPagina: chave ? `${chave.slice(0, 12)}… (${paraBytes(chave).length} bytes, 1º byte ${paraBytes(chave)[0]})` : "AUSENTE",
      suporte: { sw: "serviceWorker" in navigator, push: "PushManager" in window, notif: typeof Notification },
      permissao: Notification.permission,
      comChaveDaLoja: chave ? await tentar(chave) : "sem chave",
      comChaveControle: await tentar(chaveControle),
    };
  }, controle);
  console.log(`${host}: ${JSON.stringify(resultado)}`);
  await contexto.close();
}
await navegador.close();
