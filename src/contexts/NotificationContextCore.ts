import type { NotificationContextType } from "@/types";
import { createContext, useContext } from "react";

export const NotificationContext = createContext<
  NotificationContextType | undefined
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
