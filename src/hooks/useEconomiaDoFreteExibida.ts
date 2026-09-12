import { opcaoMaisBarata } from "@/lib/auto-selecao-de-frete";
import { modoDeEconomiaDoFrete } from "@/lib/economia-do-frete";
import { soDigitos } from "@/lib/reconciliacao-de-cep";
import { supabase } from "@/lib/supabase";
import type { CartItem, ShippingOption } from "@/types";
// COTAÇÃO DE EXIBIÇÃO da economia do frete (peça 1, checkout, 12/09/2026).
//
// 🔴 ISTO É SÓ EXIBIÇÃO. Nada aqui escreve no pedido: nunca chama
// `setSelectedShippingOption`/`setShippingCep` (o hook nem recebe esses
// setters), nunca entra no payload — quem decide o frete de VERDADE
// continua sendo o `ShippingCalculator` do carrinho, e a RPC do servidor
// que confere tudo de novo. A decisão de QUANDO cotar (linha 6 da tabela
// aprovada pelo crítico de desenho) mora em `modoDeEconomiaDoFrete`
// (src/lib/economia-do-frete.ts); este hook só cuida do EFEITO —
// debounce, cache por CEP e descarte de resposta fora de ordem — mesmo
// padrão de `ShippingCalculator.tsx` (reqRef comparado no fechamento de
// cada chamada), reduzido ao necessário para um número de exibição.
import { useEffect, useMemo, useRef, useState } from "react";

/** Espera de digitação antes de cotar — o CEP só chega aqui já com 8
 * dígitos (a decisão pura barra o incompleto), mas o valor ainda troca
 * rápido quando a pessoa apaga e redigita o fim do CEP. Mesma ideia do
 * `SHIPPING_RECALC_DEBOUNCE_MS` do ShippingCalculator, encurtada porque
 * aqui não há teclado de CEP em si — só o efeito colateral da digitação em
 * outro campo (o carrinho já filtra "completo"). */
const DEBOUNCE_MS = 500;

/** Assinatura do carrinho, MESMA IDEIA de `cartSignature`
 * (ShippingCalculator.tsx) e `assinaturaDoCarrinho` (CartContext.tsx) — uma
 * terceira cópia pequena e de propósito único (decidir só "este é o mesmo
 * carrinho de antes?" para a exibição), não a regra de dinheiro: errar
 * aqui no máximo perde uma entrada de cache e recota, nunca cobra errado. */
function assinaturaDoCarrinhoParaExibicao(cart: readonly CartItem[]): string {
  if (cart.length === 0) return "";
  return [...cart]
    .map(
      (item) =>
        `${item.product?.id ?? ""}:${item.variantId ?? ""}:${item.quantity ?? 1}`,
    )
    .sort()
    .join(",");
}

export function useEconomiaDoFreteExibida(params: {
  freteGratis: boolean;
  cepDeEntrega: string | null;
  temUsuario: boolean;
  originCep?: string;
  localCepRange?: string;
  localDeliveryFee?: number;
  freeShippingMin: number;
  cart: readonly CartItem[];
  isOffline: boolean;
}): number {
  const {
    freteGratis,
    cepDeEntrega,
    temUsuario,
    originCep,
    localCepRange,
    localDeliveryFee,
    freeShippingMin,
    cart,
    isOffline,
  } = params;

  const modo = modoDeEconomiaDoFrete({
    freteGratis,
    cepDeEntrega,
    temUsuario,
    originCep,
    localCepRange,
    localDeliveryFee,
    freeShippingMin,
  });

  const cepLimpo = cepDeEntrega ? soDigitos(cepDeEntrega) : "";
  const cartSignature = useMemo(
    () => assinaturaDoCarrinhoParaExibicao(cart),
    [cart],
  );

  const [economiaCotada, setEconomiaCotada] = useState(0);
  // Número da rodada em voo — comparado no fechamento de cada resposta;
  // resposta cujo número não é mais o mais recente é descartada (mesmo
  // mecanismo do `reqRef` do ShippingCalculator).
  const reqRef = useRef(0);
  const cacheRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (modo.tipo !== "cotar" || isOffline || cart.length === 0) {
      setEconomiaCotada(0);
      return;
    }

    // Carrinho ou CEP mudou desde a última cotação: o número antigo NÃO
    // vale mais até a nova resposta chegar — nunca mostrar economia de um
    // carrinho que já não é este (mesma exigência de
    // `cotacaoValeParaDestino`, aplicada aqui à exibição).
    setEconomiaCotada(0);

    const chave = `${cepLimpo}:${cartSignature}`;
    const cacheado = cacheRef.current.get(chave);
    if (cacheado !== undefined) {
      setEconomiaCotada(cacheado);
      return;
    }

    const meuId = ++reqRef.current;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke(
            "calculate-shipping",
            { body: { cep: cepLimpo, cart } },
          );
          if (meuId !== reqRef.current) return;
          if (error || !data?.options) {
            setEconomiaCotada(0);
            return;
          }
          const opcoes = data.options as ShippingOption[];
          const maisBarata = opcaoMaisBarata(opcoes);
          const valor = maisBarata ? maisBarata.price : 0;
          cacheRef.current.set(chave, valor);
          if (meuId !== reqRef.current) return;
          setEconomiaCotada(valor);
        } catch {
          if (meuId !== reqRef.current) return;
          setEconomiaCotada(0);
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `cart` entra só como corpo da requisição (fechamento) — quem decide
    // re-rodar é a assinatura estável (`cartSignature`), igual ao
    // ShippingCalculator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo.tipo, cepLimpo, cartSignature, isOffline]);

  if (modo.tipo === "zero") return 0;
  if (modo.tipo === "local") return modo.valor;
  return economiaCotada;
}
