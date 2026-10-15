import { useCart } from "@/hooks/useCart";
import { relerOCarrinhoComTeto } from "@/lib/reler-o-carrinho-com-teto";
import { useCallback, useEffect, useRef } from "react";

/**
 * "Atualizar o carrinho", de verdade (14/10/2026).
 *
 * Devolve uma função que, antes de levar a cliente a algum lugar (o carrinho),
 * refaz a leitura de preço e estoque dos itens no catálogo e espera — com teto,
 * para nunca prender a cliente numa rede ruim — e só então chama `ir`.
 *
 * Se a cliente já saiu da tela enquanto a leitura corria, `ir` NÃO é chamado:
 * ela não é arrastada de volta ao carrinho. A leitura termina do mesmo jeito e
 * corrige o carrinho.
 */
export function useIrAoCarrinhoRelido(): (ir: () => void) => void {
  const { renovarCarrinhoPeloCatalogo } = useCart();

  const renovarRef = useRef(renovarCarrinhoPeloCatalogo);
  const montadoRef = useRef(true);
  useEffect(() => {
    renovarRef.current = renovarCarrinhoPeloCatalogo;
  }, [renovarCarrinhoPeloCatalogo]);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  return useCallback((ir: () => void) => {
    void relerOCarrinhoComTeto(() => renovarRef.current()).then(() => {
      if (montadoRef.current) ir();
    });
  }, []);
}
