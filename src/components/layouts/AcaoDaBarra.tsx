import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

/** Única forma de colocar ações fixas junto à navegação do painel.
 * No celular usa a prateleira da pílula; no desktop fica inline e sticky.
 * Telas mantidas em memória devem passar `ativa` para não vazar ações.
 */
export function useBarraAcoplada() {
  const [destino, receberPrateleira] = useState<HTMLDivElement | null>(null);
  const [larga, setLarga] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );
  const [altura, setAltura] = useState(0);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const atualizar = () => setLarga(media.matches);
    atualizar();
    media.addEventListener("change", atualizar);
    return () => media.removeEventListener("change", atualizar);
  }, []);

  useLayoutEffect(() => {
    if (!destino || larga) {
      setAltura(0);
      return;
    }
    const medir = () => setAltura(destino.getBoundingClientRect().height);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(medir);
    observador.observe(destino);
    return () => observador.disconnect();
  }, [destino, larga]);

  return useMemo(
    () => ({ destino, receberPrateleira, larga, altura }),
    [destino, larga, altura],
  );
}

export const ContextoDaBarra = createContext<ReturnType<
  typeof useBarraAcoplada
> | null>(null);

export function AcaoDaBarra({
  children,
  ativa = true,
  "aria-label": rotulo = "Ações da tela",
}: Readonly<{ children: ReactNode; ativa?: boolean; "aria-label"?: string }>) {
  const barra = useContext(ContextoDaBarra);
  if (!ativa) return null;
  const acoes = (
    <div
      role="group"
      aria-label={rotulo}
      className={`admin-acoes-da-barra${!barra || barra.larga ? " admin-acao-inline" : ""}`}
    >
      {children}
    </div>
  );
  if (!barra || barra.larga) return acoes;
  // Teclado aberto: a pílula inteira some, sem recriar uma faixa solta.
  return barra.destino ? createPortal(acoes, barra.destino) : null;
}
