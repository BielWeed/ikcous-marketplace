// @ts-nocheck
/**
 * send-push — dispara Web Push para as inscrições do marketplace.
 *
 * POR QUE ESTE ARQUIVO FOI REESCRITO (PUSH-010, #80)
 *
 * A versão anterior chamava `webpush.sendNotification(...)`. Essa função NÃO
 * EXISTE em `jsr:@negrel/webpush@0.3.0`. Os exports da biblioteca são
 * ApplicationServer, PushMessageError, PushSubscriber, Urgency,
 * exportVapidKeys, generateVapidKeys e importVapidKeys — conferido com
 * `deno eval "const m = await import('jsr:@negrel/webpush@0.3.0')"` e coberto
 * pelo primeiro teste de `index_test.ts`.
 *
 * Ou seja: toda chamada estourava `TypeError: webpush.sendNotification is not a
 * function`. O `Promise.allSettled` engolia, e a resposta era
 * `{ success: true, total }` com HTTP 200. O admin via toast verde
 * "Notificação enviada para N dispositivos" e o histórico gravava N — com N
 * entregas reais igual a zero, sempre.
 *
 * O que muda aqui:
 *   1. Usa a API que a biblioteca de fato tem: ApplicationServer + subscribe +
 *      pushTextMessage.
 *   2. Carrega as chaves VAPID de verdade. A biblioteca quer CryptoKeyPair; o
 *      ambiente guarda base64url (formato do `web-push generate-vapid-keys`,
 *      que é o mesmo que o front lê em VITE_VAPID_PUBLIC_KEY). A conversão está
 *      em `carregarChavesVapid` e é testada contra chave gerada na hora.
 *   3. Responde com contagem VERDADEIRA: enviados, falharam e o motivo agrupado.
 *   4. Só apaga inscrição em 404/410 lendo `PushMessageError.response.status`.
 *      O código antigo lia `err.statusCode`, campo que esta biblioteca nunca
 *      preenche — a limpeza de endpoint expirado também nunca rodou.
 *
 * O QUE ESTE ARQUIVO NÃO PODE PROVAR
 * Se as chaves VAPID existem no ambiente da função em produção, e em que
 * formato. Isso é a PUSH-030 e depende do Gabriel. O que dá para garantir daqui
 * é o comportamento quando faltam ou estão erradas: a função responde 400 com o
 * motivo, em vez de fingir entrega.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * O projeto está migrando das chaves legadas (anon/service_role, formato JWT) para
 * as novas (publishable/secret). Durante a migração as duas coexistem: lê a nova e
 * cai pra legada. Assim esta função funciona antes E depois de as legadas serem
 * desligadas no painel — o que evita janela de indisponibilidade.
 *
 * Quando as legadas forem removidas de vez, o fallback pode sair.
 */
function readKey(newVar: string, legacyVar: string): string {
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
 * Aceita os dois formatos que podem estar no ambiente hoje, porque ninguém
 * confirmou qual está lá (PUSH-030, #-): JWK serializado (saída de
 * `exportVapidKeys`) ou base64url cru (saída do `web-push`). Formato misto é
 * recusado com o nome da variável, em vez de falhar depois com erro de curva.
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
      `Chave VAPID ausente no ambiente da função: ${faltando.join(" e ")}. Sem ela nenhum push sai, e é isto que a PUSH-030 precisa confirmar.`,
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
            "send-push: falhou ao remover inscrição morta",
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

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const emTeste =
  Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");

if (!emTeste) {
  serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
      );

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        console.error("send-push: Missing Authorization header");
        throw new Error("Missing Authorization header");
      }

      const token = authHeader.replace(/^Bearer\s+/i, "");
      const {
        data: { user },
        error: userError,
      } = await supabaseClient.auth.getUser(token);

      if (userError || !user) {
        console.error("send-push: Auth verification failed", userError);
        throw new Error("Not authenticated");
      }

      const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profileError || profile?.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }

      const payload = await req.json();
      const { title, body, url, targetUserId, tokens, data } = payload;

      let inscricoes: any[] = [];
      if (tokens && Array.isArray(tokens)) {
        inscricoes = tokens.map((t: any) => ({
          endpoint: t.endpoint,
          p256dh: t.keys?.p256dh || t.p256dh,
          auth: t.keys?.auth || t.auth,
        }));
      } else {
        const query = supabaseClient.from("push_subscriptions").select("*");
        if (targetUserId) query.eq("user_id", targetUserId);
        const { data: linhas, error: subError } = await query;
        if (subError) throw subError;
        inscricoes = linhas || [];
      }

      console.log(
        `send-push: ${title} (alvo: ${targetUserId || "todos"}, inscrições: ${inscricoes.length})`,
      );

      if (inscricoes.length === 0) {
        return new Response(
          JSON.stringify({
            ok: true,
            total: 0,
            enviados: 0,
            falharam: 0,
            removidas: 0,
            falhas: [],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Falha aqui é falha da REQUISIÇÃO inteira, não de um dispositivo: sem
      // chave não há o que tentar. Por isso sobe para o catch e vira 400.
      const vapidKeys = await carregarChavesVapid(
        Deno.env.get("VAPID_PUBLIC_KEY"),
        Deno.env.get("VAPID_PRIVATE_KEY"),
      );

      const servidor = await webpush.ApplicationServer.new({
        // O push service usa este contato para avisar de problema com a
        // aplicação. `mailto:admin@example.org` era o valor fixo do código
        // antigo; virou configurável, com o mesmo default para não mudar
        // comportamento sem medir.
        contactInformation:
          Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.org",
        vapidKeys,
      });

      const mensagem = JSON.stringify({
        title,
        body,
        url: url || "/",
        data: data || null,
      });

      const itens = await enviarParaInscritos({
        servidor,
        inscricoes,
        mensagem,
        aoDetectarMorta: (endpoint: string) =>
          supabaseClient
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", endpoint),
      });

      const resumo = resumir(itens);
      console.log(
        `send-push: ${resumo.enviados} entregues, ${resumo.falharam} falharam, ${resumo.removidas} inscrições removidas`,
      );

      // HTTP 200 mesmo com falha parcial, e de propósito: o `functions.invoke`
      // do supabase-js transforma qualquer status fora de 2xx em `error` e
      // esconde o corpo dentro de error.context. Quem precisa dos números é o
      // admin — então os números vêm no corpo, e quem decide o que mostrar é a
      // tela. `ok` é falso quando ninguém recebeu.
      return new Response(
        JSON.stringify({ ok: resumo.enviados > 0, ...resumo }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (error: any) {
      console.error("send-push: erro na requisição", error);
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  });
}
