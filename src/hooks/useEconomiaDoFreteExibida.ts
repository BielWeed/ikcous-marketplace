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

/**
 * Cache da cotação de EXIBIÇÃO — achado da revisão (Opus): um `useRef`
 * morre a cada desmontagem/remontagem do `CheckoutView` (troca de aba,
 * volta do carrinho, `key` do componente mudando por usuário). Sem
 * persistir ENTRE montagens, quem visita o checkout de novo com o MESMO
 * CEP e o MESMO carrinho recota a edge de novo — e toda cotação (mesmo a
 * de exibição) grava uma linha em `shipping_calculation_logs`
 * (calculate-shipping/index.ts:880-891), poluindo o "Histórico de
 * Cotações" da lojista com cotações que ninguém pediu.
 *
 * Por isso o cache mora no MÓDULO (sobrevive à desmontagem do componente,
 * dura enquanto a aba/worker do Vite estiver viva) — com validade curta
 * (`CACHE_TTL_MS`) porque preço de frete muda, e teto de entradas
 * (`CACHE_MAX_ENTRADAS`) para não crescer sem limite numa sessão longa
 * trocando de CEP/carrinho muitas vezes.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRADAS = 50;

interface EntradaDeCacheDeExibicao {
  valor: number;
  gravadoEm: number;
}

const cacheDeExibicaoPorModulo = new Map<string, EntradaDeCacheDeExibicao>();

function lerCacheDeExibicao(chave: string, agora: number): number | undefined {
  const entrada = cacheDeExibicaoPorModulo.get(chave);
  if (!entrada) return undefined;
  if (agora - entrada.gravadoEm > CACHE_TTL_MS) {
    cacheDeExibicaoPorModulo.delete(chave);
    return undefined;
  }
  return entrada.valor;
}

function gravarCacheDeExibicao(chave: string, valor: number, agora: number) {
  if (
    !cacheDeExibicaoPorModulo.has(chave) &&
    cacheDeExibicaoPorModulo.size >= CACHE_MAX_ENTRADAS
  ) {
    // `Map` preserva ordem de inserção — a primeira chave é a mais velha.
    const chaveMaisAntiga = cacheDeExibicaoPorModulo.keys().next().value;
    if (chaveMaisAntiga !== undefined) {
      cacheDeExibicaoPorModulo.delete(chaveMaisAntiga);
    }
  }
  cacheDeExibicaoPorModulo.set(chave, { valor, gravadoEm: agora });
}

/**
 * SÓ PARA TESTE. O cache de módulo sobrevive de propósito entre
 * montagens — mas não entre SUÍTES de teste, que não podem herdar a
 * cotação umas das outras. Sem exportar isto, um `vi.resetModules()` por
 * arquivo seria a única saída, e isso reimportaria (e re-executaria) o
 * módulo inteiro por teste, mais caro e mais frágil.
 */
export function _limparCacheDeEconomiaDoFreteParaTeste(): void {
  cacheDeExibicaoPorModulo.clear();
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
  // mecanismo do `reqRef` do ShippingCalculator). Este continua por
  // INSTÂNCIA do hook (não precisa sobreviver à desmontagem) — só o cache
  // de valores é que precisa, e esse mora no módulo (acima).
  const reqRef = useRef(0);

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
    const cacheado = lerCacheDeExibicao(chave, Date.now());
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
          gravarCacheDeExibicao(chave, valor, Date.now());
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
