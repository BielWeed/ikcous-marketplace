import {
  PRAZO_DAS_ACOES_DO_PEDIDO_MS,
  PRAZO_DO_REENVIO_DO_COMPROVANTE_MS,
  aguardarComPrazo,
} from "@/lib/prazo-da-requisicao";
import { supabase as supabasePadrao } from "@/lib/supabase";

/**
 * A VISITANTE DEIXA O E-MAIL DEPOIS DA COMPRA (lote 579, decisão do sócio de
 * 28/11/2026).
 *
 * Quem compra sem conta não informa e-mail na compra (o formulário não pede, e
 * a gravação do pedido e a cobrança não mudam). Na tela "Pedido recebido!" ela
 * é convidada, uma vez, a deixar o e-mail. Duas portas, nesta ordem:
 *
 *  1. `informar_email_da_visitante` (RPC, migration 20261656000000) grava o
 *     e-mail no pedido — só pedido de visitante, sem e-mail, criado há menos de
 *     15 minutos. Recebe o id COMPLETO do pedido, que só existe no navegador de
 *     quem comprou.
 *  2. `send-order-confirmation` com `comoVisitante: true` manda o comprovante.
 *     O corpo leva só o id: o destinatário é lido do banco, nunca daqui. O teto
 *     diário de e-mails da loja vale mesmo com o pedido pago; se ele barrar, a
 *     edge responde `teto_diario` e a tela diz isso.
 *
 * O e-mail gravado é o que faz o "Rastrear sem Conta" achar o pedido — por isso
 * o desfecho separa "não guardou" (a pessoa pode tentar de novo) de "guardou,
 * mas o comprovante não saiu" (o campo some: o e-mail já está no pedido).
 */

// O MESMO formato que a RPC confere (a migration 20261656000000 tem o mesmo
// texto; tests/migration_a_visitante_deixa_o_email_depois_da_compra_test.ts
// compara os dois). Sem espaço, vírgula nem quebra de linha: o endereço vai
// para o cabeçalho "Para" do comprovante.
const FORMATO_DO_EMAIL =
  // eslint-disable-next-line security/detect-unsafe-regex -- o tamanho é conferido ANTES (MAXIMO_DO_EMAIL), e o ponto separa os rótulos do domínio: não há como uma mesma letra caber em dois pedaços.
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const MAXIMO_DO_EMAIL = 254;

export function emailDaVisitanteValido(valor: string): boolean {
  const email = valor.trim();
  return email.length <= MAXIMO_DO_EMAIL && FORMATO_DO_EMAIL.test(email);
}

export type DesfechoDoComprovanteDaVisitante =
  /** O e-mail ficou no pedido e o comprovante saiu (ou já tinha saído). */
  | { readonly etapa: "enviado"; readonly email: string }
  /** O e-mail ficou no pedido, mas o comprovante não saiu (ou não se sabe). */
  | {
      readonly etapa: "guardado_sem_envio";
      readonly email: string;
      readonly motivo: "teto_diario" | "envio_falhou" | "sem_resposta";
    }
  /** O e-mail NÃO ficou no pedido. */
  | {
      readonly etapa: "nao_guardado";
      readonly motivo:
        | "email_invalido"
        | "fora_do_prazo"
        | "nao_aceita"
        | "falha";
    };

const SEM_RESPOSTA = "sem_resposta_da_rede";
const semResposta = () => new Error(SEM_RESPOSTA);

/**
 * O `motivo` que a edge devolveu. `functions.invoke` transforma status >= 400
 * em erro e esconde o corpo — é lá que mora o motivo (mesmo resgate de
 * `desfechoDoReenvio`, em useOrders.ts).
 */
async function motivoDaEdge(data: unknown, error: unknown): Promise<string> {
  if (!error) {
    const corpo = data as { ok?: boolean; motivo?: string } | null;
    if (corpo?.ok === true) return "ok";
    return corpo?.motivo ?? "envio_falhou";
  }
  const contexto = (
    error as { context?: { json?: () => Promise<unknown> } } | null
  )?.context;
  if (typeof contexto?.json === "function") {
    try {
      const corpo = (await contexto.json()) as { motivo?: string } | null;
      if (corpo?.motivo) return corpo.motivo;
    } catch {
      // corpo não-JSON (proxy, HTML de erro): desfecho genérico.
    }
  }
  return "envio_falhou";
}

type ClienteDoSupabase = {
  rpc: (
    nome: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  functions: {
    invoke: (
      nome: string,
      opcoes: { body: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
};

export async function pedirComprovanteDaVisitante(
  orderId: string,
  emailDigitado: string,
  deps: {
    supabase?: ClienteDoSupabase;
    prazoDaGravacaoMs?: number;
    prazoDoEnvioMs?: number;
  } = {},
): Promise<DesfechoDoComprovanteDaVisitante> {
  const email = emailDigitado.trim();
  if (!emailDaVisitanteValido(email)) {
    return { etapa: "nao_guardado", motivo: "email_invalido" };
  }
  const cliente =
    deps.supabase ?? (supabasePadrao as unknown as ClienteDoSupabase);

  // 1. Grava o e-mail. Sem resposta = não se sabe se gravou: a pessoa pode
  // tentar de novo (repetir o MESMO e-mail é seguro, a RPC responde ok).
  let gravado: { ok?: boolean; motivo?: string } | null;
  try {
    const { data, error } = await aguardarComPrazo(
      Promise.resolve(
        cliente.rpc("informar_email_da_visitante", {
          p_order_id: orderId,
          p_email: email,
        }),
      ),
      deps.prazoDaGravacaoMs ?? PRAZO_DAS_ACOES_DO_PEDIDO_MS,
      semResposta,
    );
    if (error) return { etapa: "nao_guardado", motivo: "falha" };
    gravado = data as { ok?: boolean; motivo?: string } | null;
  } catch {
    return { etapa: "nao_guardado", motivo: "falha" };
  }
  if (gravado?.ok !== true) {
    const motivo = gravado?.motivo;
    return {
      etapa: "nao_guardado",
      motivo:
        motivo === "email_invalido" ||
        motivo === "fora_do_prazo" ||
        motivo === "nao_aceita"
          ? motivo
          : "falha",
    };
  }

  // 2. O comprovante. O e-mail JÁ está no pedido: daqui em diante, nenhum
  // desfecho volta a pedir o e-mail.
  let motivo: string;
  try {
    motivo = await aguardarComPrazo(
      (async () => {
        const { data, error } = await cliente.functions.invoke(
          "send-order-confirmation",
          { body: { orderId, comoVisitante: true } },
        );
        return await motivoDaEdge(data, error);
      })(),
      deps.prazoDoEnvioMs ?? PRAZO_DO_REENVIO_DO_COMPROVANTE_MS,
      semResposta,
    );
  } catch (erro) {
    motivo =
      erro instanceof Error && erro.message === SEM_RESPOSTA
        ? "sem_resposta"
        : "envio_falhou";
  }
  // `ja_enviado`: outra chamada (dois toques) já mandou este comprovante.
  if (motivo === "ok" || motivo === "ja_enviado") {
    return { etapa: "enviado", email };
  }
  return {
    etapa: "guardado_sem_envio",
    email,
    motivo:
      motivo === "teto_diario" || motivo === "sem_resposta"
        ? motivo
        : "envio_falhou",
  };
}
