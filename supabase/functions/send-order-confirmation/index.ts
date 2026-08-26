// @ts-nocheck
/**
 * send-order-confirmation — manda ao CLIENTE o comprovante do pedido dele
 * (PEDIDO-070, #106).
 *
 * QUEM CHAMA
 *   O navegador, logo depois de o pedido nascer, sem esperar a resposta. O
 *   corpo so' carrega `orderId`: nome, itens, valores e endereco sao lidos aqui
 *   do banco com service role. Ninguem de fora injeta texto no e-mail de
 *   ninguem — mesma regra da notify-new-order.
 *
 * ESTE ARQUIVO É SÓ O INVÓLUCRO HTTP (redesenho, 25/08/2026)
 *   O miolo (reserva, leitura, montagem do e-mail, envio, liberação em
 *   falha) mora em `_shared/comprovante.ts` — `webhook-mercadopago` importa
 *   e chama ESSA função direto, sem passar por aqui. Ver o cabeçalho
 *   daquele arquivo para o porquê (três correções na mesma porta HTTP, a
 *   última entalando uma chave legada, foram o sinal de que a porta era o
 *   problema, não o contrato dela). Este arquivo só faz o que é
 *   inerentemente HTTP: ler o corpo da requisição, validar a forma do
 *   `orderId` recebido de fora, e traduzir o desfecho em `Response`.
 *
 * A TRAVA CONTRA E-MAIL REPETIDO MORA NO BANCO
 *   `reivindicar_email_de_confirmacao` faz um UPDATE condicional atomico e
 *   devolve true so' para a PRIMEIRA chamada. Navegador repete — dois toques,
 *   recarregar, StrictMode montando duas vezes — e cada invocacao desta funcao
 *   e um processo novo, sem memoria da anterior; contador em memoria aqui nao
 *   seguraria nada. E o custo de repetir nao e cosmetico: a conta de Gmail da
 *   loja entrega ~100 mensagens por dia, e um laco esgota a cota e derruba
 *   tambem o codigo de verificacao de todo mundo pelo resto do dia.
 *
 * POR QUE NAO HA JANELA DE TEMPO, AO CONTRARIO DA notify-new-order
 *   La a janela de 15 min existe porque o push pode ser disparado infinitas
 *   vezes para o mesmo pedido. Aqui a reserva ja limita a UMA mensagem por
 *   pedido, para sempre — que e uma trava estritamente mais forte. Somar uma
 *   janela so' criaria um caso em que o cliente legitimo fica sem comprovante
 *   porque a rede dele demorou.
 *
 * O QUE ESTE E-MAIL NAO DIZ
 *   Nada que o sistema nao cumpra. Sem prazo de entrega, sem "envio expresso",
 *   sem promessa de troca — a release 1.4.0 inteira existiu para tirar essas
 *   frases da tela, e reintroduzi-las por e-mail seria o mesmo defeito com
 *   outro veiculo. Campo que falta simplesmente nao aparece, em vez de virar
 *   palpite: e a mesma regra do PR #231, que tirou do codigo a cidade cravada.
 *
 * IDENTIDADE DA LOJA VEM DO BANCO
 *   Nome e cidade saem de `store_config`. Este repositorio e o molde que se
 *   clona: o que for cravado aqui viaja para toda loja que existir.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarComprovantePedido } from "../_shared/comprovante.ts";

export {
  assuntoDoEmail,
  emailDoCliente,
  htmlDoPedido,
  linhasDosItens,
  mascarar,
} from "../_shared/comprovante.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pareceUuid = (valor: unknown): boolean =>
  typeof valor === "string" && UUID.test(valor);

export function montarResposta(desfecho): Response {
  const status = desfecho.ok
    ? 200
    : desfecho.motivo === "envio_falhou" || desfecho.motivo === "sem_remetente"
      ? 502
      : desfecho.motivo === "pedido_invalido"
        ? 400
        : 200;
  return new Response(JSON.stringify(desfecho), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const emTeste =
  Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");

if (!emTeste) {
  serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const corpo = await req.json().catch(() => null);
    const orderId = corpo?.orderId;
    if (!pareceUuid(orderId)) {
      return montarResposta({ ok: false, motivo: "pedido_invalido" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const desfecho = await enviarComprovantePedido({ supabase, orderId });
    return montarResposta(desfecho);
  });
}
