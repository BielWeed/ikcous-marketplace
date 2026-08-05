// @ts-nocheck
/**
 * notify-new-order — avisa o LOJISTA que entrou pedido novo (PEDIDO-020, #89).
 *
 * POR QUE ELA EXISTE, SE JÁ HÁ UMA send-push
 *
 * A `send-push` exige que quem chama seja admin: ela valida o Bearer token e
 * confere `profiles.role = 'admin'`. Um pedido nasce do navegador do CLIENTE —
 * muitas vezes um convidado sem sessão nenhuma. Ou seja, o checkout nunca
 * conseguiria acionar a `send-push`, por desenho dela. Daí uma função separada,
 * publicada com `--no-verify-jwt`, que não pede admin e em troca não aceita
 * texto de fora: tudo que vai na notificação é lido do banco aqui dentro.
 *
 * POR QUE O DISPARO VEM DO FRONT, E NÃO DE UM TRIGGER
 *
 * Decisão do Gabriel em 05/08/2026. O caminho confiável seria trigger em
 * `marketplace_orders` → webhook → função: dispara sempre, independente do
 * navegador. Mas trigger exige migration em produção, e o ROADMAP proíbe
 * qualquer avanço de banco antes da BANCO-040 (#40, política de backup/PITR),
 * que segue sem resposta — com 42 migrations locais nunca aplicadas e 28
 * versões no ledger sem arquivo. Somado a isso, trigger em
 * `marketplace_orders` entra no caminho do checkout, onde erro derruba venda.
 *
 * O preço desta escolha, dito na cara: **se o cliente fechar a aba no instante
 * seguinte ao pedido, o aviso não sai.** Quando a BANCO-040 for respondida, o
 * trigger passa a ser possível e esta função vira o alvo dele sem reescrita —
 * o corpo do webhook do Supabase traz `record.id`, que é o mesmo `orderId` que
 * ela já aceita.
 *
 * O QUE PROTEGE UMA FUNÇÃO SEM verify_jwt
 *
 * 1. O corpo só aceita `orderId`. Nome, valor e número do pedido são lidos do
 *    banco — ninguém injeta texto na notificação do lojista.
 * 2. O pedido precisa ser RECENTE (JANELA_MINUTOS). Sem isso, alguém de posse
 *    de um id antigo poderia repetir o aviso à vontade. Com isso, o pior caso é
 *    duplicar o aviso de um pedido que de fato acabou de entrar.
 * 3. O id precisa ter forma de UUID. Corta varredura antes de tocar o banco.
 *
 * O QUE ELA NÃO FAZ
 *
 * Não grava em `notificacoes` — isso é a PEDIDO-110 (#107). Não manda e-mail —
 * PEDIDO-070 (#106). Aqui é só o push para o dispositivo do lojista.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import {
  carregarChavesVapid,
  corsHeaders,
  enviarParaInscritos,
  readKey,
  resumir,
} from "../_shared/webpush.ts";

/**
 * Quanto tempo depois de criado um pedido ainda vale avisar.
 *
 * 15 minutos é folgado para o caso real (o front chama em segundos) e curto o
 * bastante para que um id vazado não vire canal de spam para o lojista.
 */
export const JANELA_MINUTOS = 15;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pareceUuid = (valor: unknown): boolean =>
  typeof valor === "string" && UUID.test(valor);

/**
 * O número que o lojista vê. Mesma convenção que o resto do projeto usa para
 * falar de pedido com humano: os 6 últimos caracteres, em maiúscula.
 */
export const numeroDoPedido = (id: string): string =>
  `#${String(id).slice(-6).toUpperCase()}`;

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * R$ 1.234,50 — o lojista lê valor em pt-BR, não em ponto decimal.
 *
 * Via `Intl` e não com a regex clássica de separador de milhar
 * (`/\B(?=(\d{3})+(?!\d))/`): aquela tem quantificador aninhado e o eslint a
 * marca como `security/detect-unsafe-regex`, o que subiria a catraca. `Intl`
 * resolve melhor e sem regex.
 *
 * O `replace` que sobrou troca o espaço não separável que o `Intl` põe entre o
 * símbolo e o número por um espaço comum — sem isso o texto parece igual na
 * tela mas não casa em comparação de string, e o teste passa a mentir.
 */
export function formatarBRL(valor: unknown): string {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero)) return "R$ 0,00";
  // \u00a0 escapado, e não o caractere literal: NBSP cru no fonte dispara
  // `no-irregular-whitespace`, que é ERRO de eslint e o teto de erro é zero.
  return BRL.format(numero).replace(/\u00a0/g, " ");
}

/**
 * Monta o texto do aviso. Os três dados do critério 2 da issue — número do
 * pedido, valor e nome do cliente — em uma linha, porque notificação de sistema
 * corta cedo e o que importa tem que caber antes do corte.
 */
export function montarAviso(pedido: any) {
  const valor = pedido.total ?? pedido.total_amount;
  const cliente = (pedido.customer_name || "").trim() || "cliente sem nome";
  return {
    title: "Pedido novo",
    body: `${numeroDoPedido(pedido.id)} · ${formatarBRL(valor)} · ${cliente}`,
    url: "/admin-orders",
  };
}

/**
 * `created_at` cai dentro da janela?
 *
 * `agora` é injetável para o teste não depender do relógio da máquina.
 */
export function dentroDaJanela(
  criadoEm: string,
  agora: number = Date.now(),
): boolean {
  const t = Date.parse(criadoEm);
  if (Number.isNaN(t)) return false;
  const idadeMin = (agora - t) / 60000;
  // Tolera 1 minuto de relógio adiantado entre o Postgres e o runtime da função.
  return idadeMin <= JANELA_MINUTOS && idadeMin >= -1;
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
      const { orderId } = await req.json().catch(() => ({}));

      if (!pareceUuid(orderId)) {
        return json({ ok: false, erro: "orderId ausente ou fora do formato UUID" }, 400);
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
      );

      const { data: pedido, error: erroPedido } = await supabase
        .from("marketplace_orders")
        .select("id, customer_name, total, total_amount, created_at")
        .eq("id", orderId)
        .maybeSingle();

      if (erroPedido) throw erroPedido;
      if (!pedido) {
        // 200 e não 404: para o front isto é "não há o que avisar", não um erro
        // que mereça retentativa.
        return json({ ok: false, ignorado: "pedido não encontrado" });
      }

      if (!dentroDaJanela(pedido.created_at)) {
        console.warn(
          `notify-new-order: ${numeroDoPedido(pedido.id)} fora da janela de ${JANELA_MINUTOS} min (criado em ${pedido.created_at})`,
        );
        return json({ ok: false, ignorado: "pedido fora da janela" });
      }

      // Só quem é admin recebe. `role` mora em profiles; medido em 05/08/2026:
      // 3 admins, e as 3 inscrições com user_id preenchido são todas deles.
      const { data: admins, error: erroAdmins } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "admin");
      if (erroAdmins) throw erroAdmins;

      const ids = (admins ?? []).map((a: any) => a.id);
      if (ids.length === 0) {
        return json({ ok: false, ignorado: "nenhum admin cadastrado" });
      }

      const { data: inscricoes, error: erroInscricoes } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .in("user_id", ids);
      if (erroInscricoes) throw erroInscricoes;

      if (!inscricoes || inscricoes.length === 0) {
        // Caso real e silencioso: o canal funciona e ninguém é avisado porque o
        // lojista nunca aceitou a permissão de notificação no aparelho dele.
        // Dizer isso em voz alta, em vez de responder sucesso com total 0.
        console.warn(
          "notify-new-order: nenhum admin tem inscrição de push. O aviso não tem para onde ir.",
        );
        return json({
          ok: false,
          ignorado: "nenhum admin inscrito para push",
          total: 0,
          enviados: 0,
        });
      }

      const vapidKeys = await carregarChavesVapid(
        Deno.env.get("VAPID_PUBLIC_KEY"),
        Deno.env.get("VAPID_PRIVATE_KEY"),
      );

      const servidor = await webpush.ApplicationServer.new({
        contactInformation:
          Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.org",
        vapidKeys,
      });

      const itens = await enviarParaInscritos({
        servidor,
        inscricoes,
        mensagem: JSON.stringify(montarAviso(pedido)),
        rotulo: "notify-new-order",
        aoDetectarMorta: (endpoint: string) =>
          supabase.from("push_subscriptions").delete().eq("endpoint", endpoint),
      });

      const resumo = resumir(itens);
      console.log(
        `notify-new-order: ${numeroDoPedido(pedido.id)} → ${resumo.enviados} entregues, ${resumo.falharam} falharam`,
      );

      // Contagem verdadeira, pela mesma razão da PUSH-010 (#80): responder
      // sucesso sem entrega é como o projeto passou meses achando que o push
      // funcionava.
      return json({ ok: resumo.enviados > 0, ...resumo });
    } catch (error: any) {
      console.error("notify-new-order: erro na requisição", error);
      return json({ ok: false, erro: error.message }, 400);
    }
  });
}
