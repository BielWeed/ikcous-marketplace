import { aguardarComPrazo } from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

// O PIX ESTÁ PRONTO PARA COBRAR NESTA LOJA? (P1 do PR #711)
//
// O defeito: a loja podia oferecer "Pagar agora com PIX" sem ter cadastrada a
// chave de assinatura do webhook; aí a edge `criar-pagamento` recusa com 409
// `pixSemChaveDeAssinatura` e o cliente travava DEPOIS de o pedido nascer,
// antes do QR. `pagamentoOnlineLigado()` (ficha da loja) é compartilhado com o
// cartão e não sabe disso — quem sabe é a edge, que lê o segredo.
//
// Contrato com a edge: `POST criar-pagamento` com `{ acao: "metodos" }` →
// `200 { pix: boolean }`. Esta sonda é ORIENTAÇÃO DE TELA, nunca a trava: a
// trava de verdade continua sendo a recusa da edge. Por isso a leitura é
// FAIL-OPEN, ao contrário de `useConfigDoCartao` (que é fail-closed): só um
// `false` explícito esconde o PIX; erro, rede, 4xx/5xx, corpo diferente ou uma
// edge antiga que não conhece a ação são DESCONHECIDO (`null`) e o checkout
// segue como sempre foi — oferece o PIX e deixa a edge recusar se for o caso.

/**
 * Interpreta o corpo da resposta da edge. `true` = oferecer, `false` = esconder
 * o PIX, `null` = desconhecido (qualquer outra coisa, inclusive `pix` como
 * string "false", número, ausente, ou o corpo nem ser objeto).
 */
export function interpretarRespostaDoPix(corpo: unknown): boolean | null {
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
    return null;
  }
  const pix = (corpo as { pix?: unknown }).pix;
  return typeof pix === "boolean" ? pix : null;
}

/**
 * Quanto a tela espera a sonda antes de tratá-la como desconhecida. Existe
 * porque a auto-seleção de "online" (transportadora, fallback) ESPERA a
 * sonda: sem teto, uma rede presa seguraria o checkout na espera.
 */
export const PRAZO_DA_SONDA_MS = 4_000;

/**
 * Faz a consulta e devolve a resposta interpretada. Nunca lança: qualquer
 * falha — inclusive `supabase.functions` inexistente ou estourar o prazo — é
 * `null`.
 */
export async function buscarPixDisponivel(): Promise<boolean | null> {
  try {
    const { data, error } = await aguardarComPrazo(
      Promise.resolve(
        supabase.functions.invoke("criar-pagamento", {
          body: { acao: "metodos" },
        }),
      ),
      PRAZO_DA_SONDA_MS,
      () => new Error("A sonda do PIX ficou sem resposta."),
    );
    if (error) return null;
    return interpretarRespostaDoPix(data);
  } catch {
    return null;
  }
}

// SEM cache entre aberturas do checkout (a PWA pode ficar dias aberta): a
// loja cadastra a chave de assinatura depois, e um `false` guardado seguraria
// o PIX escondido até alguém recarregar. Cada abertura do checkout (montagem)
// consulta UMA vez; `false`/`true`/desconhecido só valem para aquela abertura.
// O que fica em módulo é só a consulta EM VOO — montagens simultâneas (ou o
// efeito duplo do StrictMode) dividem a mesma ida à edge — e ela se apaga ao
// terminar, qualquer que seja o desfecho.
let emVoo: Promise<boolean | null> | null = null;

/** A consulta, dividindo a que já estiver no ar. Nunca lança. */
export function lerPixDisponivel(): Promise<boolean | null> {
  if (emVoo) return emVoo;
  const promessa = buscarPixDisponivel().finally(() => {
    if (emVoo === promessa) emVoo = null;
  });
  emVoo = promessa;
  return promessa;
}

/** Descarta a consulta em voo — entre testes. */
export function esquecerPixDisponivel(): void {
  emVoo = null;
}

export interface SondaDoPix {
  /**
   * `false` = a edge disse que o PIX NÃO está pronto (esconder a opção);
   * `true` = está; `null` = desconhecido (carregando, inativa, erro, edge
   * antiga) — oferecer, como sempre foi.
   */
  pix: boolean | null;
  /**
   * A consulta está no ar (ativa e ainda sem resposta nem falha). Quem ESCOLHE
   * "online" sozinho (transportadora, fallback) espera isto virar `false`
   * para não selecionar o PIX e tirá-lo do cliente um instante depois; a
   * espera é limitada por `PRAZO_DA_SONDA_MS`.
   */
  consultando: boolean;
}

/**
 * A sonda do PIX para o checkout (ver `SondaDoPix`).
 *
 * Consulta quando o checkout ABRE (montagem) — uma vez por abertura, nunca a
 * cada render. `ativo` = pagamento pelo app ligado na loja E cliente logada (o
 * pagamento online exige conta — P6 — e a edge exige JWT): sem isso não vai à
 * rede e o resultado é "desconhecido, não consultando".
 */
export function usePixDisponivel(ativo: boolean): SondaDoPix {
  // `undefined` = ainda sem resposta; `null` = respondeu "desconhecido".
  const [resposta, setResposta] = useState<boolean | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    lerPixDisponivel().then((lida) => {
      if (vivo) setResposta(lida);
    });
    return () => {
      vivo = false;
    };
  }, [ativo]);

  if (!ativo) return { pix: null, consultando: false };
  return { pix: resposta ?? null, consultando: resposta === undefined };
}
