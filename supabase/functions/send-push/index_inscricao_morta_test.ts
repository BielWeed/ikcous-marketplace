import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import { bytesParaBase64Url, handler } from "./index.ts";

/** Chaves efêmeras de um navegador fictício; nenhuma credencial real. */
async function inscricaoDeTeste(id: string, endpoint: string) {
  const par = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  );
  return {
    id,
    user_id: `cliente-${id}`,
    endpoint,
    p256dh: bytesParaBase64Url(
      new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey)),
    ),
    auth: bytesParaBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

for (const statusMorta of [404, 410]) {
  Deno.test(`handler: push ${statusMorta} remove só a inscrição morta e preserva o outro dispositivo`, async () => {
    const parVapid = await webpush.generateVapidKeys({ extractable: true });
    const vapid = await webpush.exportVapidKeys(parVapid);
    const recebidas: string[] = [];
    const servidor = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
      await req.arrayBuffer();
      const caminho = new URL(req.url).pathname;
      recebidas.push(caminho);
      return new Response(null, {
        status: caminho === "/p/morta" ? statusMorta : 201,
      });
    });
    const base = `http://localhost:${servidor.addr.port}`;
    const fetchAnterior = globalThis.fetch;
    const anteriores = [
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEYS",
      "SUPABASE_SECRET_KEYS",
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
    ].map((chave) => [chave, Deno.env.get(chave)] as const);

    try {
      const morta = await inscricaoDeTeste("morta", `${base}/p/morta`);
      const viva = await inscricaoDeTeste("viva", `${base}/p/viva`);
      let inscricoes = [morta, viva];
      const apagadas: string[] = [];

      Deno.env.set("SUPABASE_URL", "https://supa-fake.local");
      Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" }));
      Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" }));
      Deno.env.set("VAPID_PUBLIC_KEY", JSON.stringify(vapid.publicKey));
      Deno.env.set("VAPID_PRIVATE_KEY", JSON.stringify(vapid.privateKey));

      // Mantém Supabase JS, handler e Web Push reais. Só Auth e banco são
      // substituídos no fio; o push chega ao servidor HTTP local acima.
      globalThis.fetch = async (entrada, opcoes) => {
        const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
        if (url.origin === base) return await fetchAnterior(entrada, opcoes);
        if (url.origin !== "https://supa-fake.local") {
          throw new Error("Requisição fora do roteiro do teste");
        }
        const json = (dados: unknown) =>
          new Response(JSON.stringify(dados), {
            headers: { "Content-Type": "application/json" },
          });
        if (url.pathname === "/auth/v1/user") {
          return json({
            id: "admin-de-teste",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: { provider: "email", role: "admin" },
          });
        }
        if (url.pathname === "/rest/v1/profiles") {
          return json({ id: "admin-de-teste", role: "admin" });
        }
        if (url.pathname === "/rest/v1/push_subscriptions") {
          const metodo = opcoes?.method ?? (entrada instanceof Request ? entrada.method : "GET");
          if (metodo === "GET") return json(inscricoes);
          if (metodo === "DELETE") {
            // Sem eq no pedido HTTP, service role apaga TODAS as linhas.
            // Com eq, aplica o valor recebido: não basta contar chamadas.
            const filtro = url.searchParams.get("endpoint");
            inscricoes = inscricoes.filter((inscricao) => {
              const apagar = filtro === null || filtro === `eq.${inscricao.endpoint}`;
              if (apagar) apagadas.push(inscricao.id);
              return !apagar;
            });
            return new Response(null, { status: 204 });
          }
        }
        throw new Error("Operação fora do roteiro do banco");
      };

      const resposta = await handler(
        new Request("http://local/send-push", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer jwt-de-teste",
          },
          body: JSON.stringify({ title: "Aviso de teste", body: "Texto fictício" }),
        }),
      );
      assertEquals(resposta.status, 200);
      const corpo = await resposta.json();
      assertEquals(
        {
          ok: corpo.ok,
          total: corpo.total,
          enviados: corpo.enviados,
          falharam: corpo.falharam,
          removidas: corpo.removidas,
          naoTentados: corpo.naoTentados,
        },
        { ok: true, total: 2, enviados: 1, falharam: 1, removidas: 1, naoTentados: 0 },
      );
      assertEquals(corpo.falhas[0].status, statusMorta);
      assertEquals(recebidas.sort(), ["/p/morta", "/p/viva"]);
      assertEquals(
        inscricoes,
        [viva],
        "o DELETE da inscrição morta não pode apagar o dispositivo vivo",
      );
      assertEquals(apagadas, ["morta"]);
    } finally {
      globalThis.fetch = fetchAnterior;
      for (const [chave, valor] of anteriores) {
        if (valor === undefined) Deno.env.delete(chave);
        else Deno.env.set(chave, valor);
      }
      await servidor.shutdown();
    }
  });
}
