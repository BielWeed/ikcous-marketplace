import type { ReactNode } from "react";
import { CONTAINER_DO_COMPUTADOR } from "./medidas";

/** Dentro da área que rola: a barra de rolagem continua na borda da tela. */
export function PaginaDoComputador({
  children,
  containerProprio = false,
}: {
  children: ReactNode;
  containerProprio?: boolean;
}) {
  if (containerProprio) return children;
  return (
    <div
      className={`contents [&>*]:shrink-0 ${CONTAINER_DO_COMPUTADOR} lg:block`}
    >
      {children}
    </div>
  );
}
