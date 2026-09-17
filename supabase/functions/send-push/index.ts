// @ts-nocheck
/**
 * send-push — dispara Web Push para as inscrições do marketplace.
 *
 * Exige que QUEM CHAMA seja admin: valida o Bearer token e confere
 * `profiles.role = 'admin'`. É o canal do painel ("avisar meus clientes"), não
 * um canal que o site do cliente possa acionar — um pedido de convidado nunca
 * consegue chamar esta função. Quando o disparo precisa nascer do checkout, o
 * caminho é a `notify-new-order` (PEDIDO-020, #89), que não pede admin e valida
 * o pedido do lado do servidor.
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
 * O que aquela reescrita trouxe:
 *   1. Usa a API que a biblioteca de fato tem: ApplicationServer + subscribe +
 *      pushTextMessage.
 *   2. Carrega as chaves VAPID de verdade, aceitando os dois formatos possíveis.
 *   3. Responde com contagem VERDADEIRA: enviados, falharam e o motivo agrupado.
 *   4. Só apaga inscrição em 404/410 lendo `PushMessageError.response.status`.
 *
 * ONDE ESSE MIOLO MORA AGORA (PEDIDO-020, #89)
 *
 * As funções acima saíram deste arquivo para `../_shared/webpush.ts`, porque a
 * `notify-new-order` precisa das mesmas. Elas são REEXPORTADAS logo abaixo, e
 * por isso o `index_test.ts` continua importando tudo de `./index.ts` sem uma
 * linha alterada. Se você veio pelo teste, o código está em `_shared`.
 *
 * A PUSH-030 (#38) FOI RESPONDIDA em 05/08/2026: `VAPID_PUBLIC_KEY` e
 * `VAPID_PRIVATE_KEY` existem no ambiente desde 09/03/2026, em base64url cru, e
 * a pública bate com a `VITE_VAPID_PUBLIC_KEY` do front. O canal é real.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import {
  base64UrlParaBytes,
  bytesParaBase64Url,
  carregarChavesVapid,
  classificarFalha,
  corsHeaders,
  endpointResumido,
  enviarParaInscritos,
  jwkDoParVapidCru,
  readKey,
  resumir,
} from "../_shared/webpush.ts";

// Reexport para o `index_test.ts`, que importa tudo de `./index.ts` desde a
// PUSH-010. Manter esta lista é a condição de a extração para `_shared` não
// ter custado nenhum teste.
export {
  base64UrlParaBytes,
  bytesParaBase64Url,
  carregarChavesVapid,
  classificarFalha,
  endpointResumido,
  enviarParaInscritos,
  jwkDoParVapidCru,
  resumir,
};

// ---------------------------------------------------------------------------
// Paginação e orçamento de tempo (index-133)
//
// O broadcast ("avisar todo mundo") fazia `select('*')` em `push_subscriptions`
// sem `.limit()` e mandava os lotes de `enviarParaInscritos` em série dentro do
// mesmo handler HTTP, sem teto de tempo. Com a base de inscritos pequena isso
// nunca doeu; no dia que a loja crescer pra alguns milhares, a soma dos lotes
// pode ultrapassar o tempo de execução da edge function — a function é
// cortada NO MEIO, sem responder nada, e quem disparou a campanha não fica
// sabendo quantos dispositivos ficaram sem tentativa (só o que já tivesse
// sido processado entraria num resumo que nunca chega a sair).
//
// A correção fica em duas peças pequenas e testáveis sem banco nem rede:
// `paginarTudo` troca o `select('*')` por leitura em páginas, e
// `enviarComOrcamentoDeTempo` para de abrir lote novo quando o relógio passa
// do orçamento, devolvendo `naoTentados` em vez de escondê-los.
// ---------------------------------------------------------------------------

const TAMANHO_DA_PAGINA_DE_LEITURA = 200;
const TAMANHO_DO_LOTE_DE_ENVIO = 20;
const ORCAMENTO_DE_TEMPO_MS = 50_000;

/**
 * Chama `buscarPagina(offset, tamanho)` até ela devolver uma página vazia ou
 * menor que `tamanho` (fim dos dados), acumulando tudo num array só.
 *
 * `buscarPagina` é injetada de propósito: a única coisa específica do
 * Supabase é o `.range()` montado no handler — aqui dá pra provar que a
 * volta completa das páginas acontece sem precisar de banco nenhum.
 */
export async function paginarTudo(
  buscarPagina: (offset: number, tamanho: number) => Promise<any[]>,
  tamanhoDaPagina: number = TAMANHO_DA_PAGINA_DE_LEITURA,
): Promise<any[]> {
  const tudo: any[] = [];
  let offset = 0;
  for (;;) {
    const pagina = await buscarPagina(offset, tamanhoDaPagina);
    if (!pagina || pagina.length === 0) break;
    tudo.push(...pagina);
    if (pagina.length < tamanhoDaPagina) break;
    offset += tamanhoDaPagina;
  }
  return tudo;
}

/**
 * Manda `inscricoes` em fatias de `tamanhoDoLote` (cada fatia é UM
 * `Promise.all` dentro de `enviarParaInscritos` — concorrência limitada ao
 * tamanho da fatia), mas para de abrir fatia nova assim que
 * `agora() - inicio` passar de `orcamentoMs`.
 *
 * Isso é o que falta pra um broadcast grande nunca estourar o teto de
 * execução da function sem avisar: a checagem acontece ANTES de cada fatia,
 * nunca no meio de uma já em voo, e o que não deu tempo de tentar volta
 * contado em `naoTentados` — nunca escondido dentro de um `enviados` que não
 * é verdade (a PUSH-010 já existe por causa de contagem que mentia).
 *
 * `agora` é injetado para o teste controlar o relógio sem `setTimeout` real.
 */
export async function enviarComOrcamentoDeTempo({
  servidor,
  inscricoes,
  mensagem,
  aoDetectarMorta,
  rotulo = "push",
  tamanhoDoLote = TAMANHO_DO_LOTE_DE_ENVIO,
  orcamentoMs = ORCAMENTO_DE_TEMPO_MS,
  agora = () => Date.now(),
}: any): Promise<{ itens: any[]; naoTentados: number }> {
  const inicio = agora();
  const itens: any[] = [];
  let i = 0;
  for (; i < inscricoes.length; i += tamanhoDoLote) {
    if (agora() - inicio >= orcamentoMs) break;
    const lote = inscricoes.slice(i, i + tamanhoDoLote);
    const itensDoLote = await enviarParaInscritos({
      servidor,
      inscricoes: lote,
      mensagem,
      aoDetectarMorta,
      rotulo,
      tamanhoDoLote: lote.length,
    });
    itens.push(...itensDoLote);
  }
  return { itens, naoTentados: Math.max(inscricoes.length - i, 0) };
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
        // Paginado (index-133): era `select('*')` sem `.limit()`, carregando
        // a base de inscritos inteira de uma vez. `.order("id")` fixa uma
        // ordem estável entre páginas — sem ela o `.range()` pode repetir ou
        // pular linha se a tabela mudar entre duas chamadas.
        inscricoes = await paginarTudo(async (offset, tamanho) => {
          let query = supabaseClient
            .from("push_subscriptions")
            .select("*")
            .order("id", { ascending: true })
            .range(offset, offset + tamanho - 1);
          if (targetUserId) query = query.eq("user_id", targetUserId);
          const { data: linhas, error: subError } = await query;
          if (subError) throw subError;
          return linhas || [];
        }, TAMANHO_DA_PAGINA_DE_LEITURA);
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
            naoTentados: 0,
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

      // Orçamento de tempo (index-133): sem teto, a soma dos lotes de uma
      // campanha grande pode ultrapassar o limite de execução da function e
      // ela é cortada no meio — sem responder nada e sem dizer quanto ficou
      // sem tentativa. Com o orçamento o handler sempre responde a tempo, e
      // o que não deu pra tentar entra no resumo como `naoTentados` em vez
      // de desaparecer.
      const { itens, naoTentados } = await enviarComOrcamentoDeTempo({
        servidor,
        inscricoes,
        mensagem,
        rotulo: "send-push",
        tamanhoDoLote: TAMANHO_DO_LOTE_DE_ENVIO,
        orcamentoMs: ORCAMENTO_DE_TEMPO_MS,
        aoDetectarMorta: (endpoint: string) =>
          supabaseClient
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", endpoint),
      });

      const resumo = resumir(itens);
      console.log(
        `send-push: ${resumo.enviados} entregues, ${resumo.falharam} falharam, ${resumo.removidas} inscrições removidas, ${naoTentados} não tentadas (orçamento de tempo)`,
      );

      // HTTP 200 mesmo com falha parcial, e de propósito: o `functions.invoke`
      // do supabase-js transforma qualquer status fora de 2xx em `error` e
      // esconde o corpo dentro de error.context. Quem precisa dos números é o
      // admin — então os números vêm no corpo, e quem decide o que mostrar é a
      // tela. `ok` é falso quando ninguém recebeu.
      return new Response(
        JSON.stringify({ ok: resumo.enviados > 0, ...resumo, naoTentados }),
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
