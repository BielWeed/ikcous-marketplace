import { assinarMudancasDeCategoria } from "@/lib/avisos-de-categoria";
import type { MudancaDeCategoria } from "@/lib/gestao-de-categorias";
import { useEffect, useRef } from "react";

/**
 * Chama `aoMudar` toda vez que a lojista renomeia, esconde ou apaga uma
 * categoria (em qualquer tela). A função pode mudar a cada render: a assinatura
 * é uma só e sempre chama a mais recente.
 */
export function useAoMudarCategoria(
  aoMudar: (mudanca: MudancaDeCategoria) => void,
): void {
  const ultima = useRef(aoMudar);
  useEffect(() => {
    ultima.current = aoMudar;
  });
  useEffect(
    () => assinarMudancasDeCategoria((mudanca) => ultima.current(mudanca)),
    [],
  );
}
