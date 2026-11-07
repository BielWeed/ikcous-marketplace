import type { NotificationContextType } from "@/types";
import { createContext, useContext } from "react";

// O estado de ERRO do fetch mora aqui, não no tipo compartilhado de
// src/types (arquivo de outra frente, intocável neste conserto): sem ele,
// falha de consulta e caixa vazia de verdade renderizam o mesmo
// "Tudo em ordem" — zero que quer dizer "não consegui medir".
export type ValorDoContextoDeNotificacoes = NotificationContextType & {
  erro: string | null;
  /** Visitante: sem conta (e a conta não está carregando). Opcional. */
  semConta?: boolean;
  /**
   * A última consulta dos avisos próprios voltou cheia (50): pode haver avisos
   * mais antigos que a lista não mostra. Opcional: quem monta o contexto à mão
   * (testes) não precisa conhecê-lo.
   */
  listaCortada?: boolean;
  /**
   * Marca como lidos, num UPDATE só, os avisos próprios ainda não lidos de UM
   * pedido (`dados.order_id`). Chamada pela tela do pedido ao abrir. Opcional:
   * quem monta o contexto à mão (testes) não precisa conhecê-la.
   */
  markOrderAsRead?: (orderId: string) => Promise<void>;
};

export const NotificationContext = createContext<
  ValorDoContextoDeNotificacoes | undefined
>(undefined);

export const useNotificationCenter = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error(
      "useNotificationCenter must be used within a NotificationProvider",
    );
  }
  return context;
};
