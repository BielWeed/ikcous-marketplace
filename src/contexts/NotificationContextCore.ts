import type { NotificationContextType } from "@/types";
import { createContext, useContext } from "react";

// O estado de ERRO do fetch mora aqui, não no tipo compartilhado de
// src/types (arquivo de outra frente, intocável neste conserto): sem ele,
// falha de consulta e caixa vazia de verdade renderizam o mesmo
// "Tudo em ordem" — zero que quer dizer "não consegui medir".
export type ValorDoContextoDeNotificacoes = NotificationContextType & {
  erro: string | null;
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
