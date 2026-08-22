import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import type { CartItem, ShippingOption } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Search, Sparkles, Truck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Janela de debounce para recotar após mudança no carrinho (produto,
 * variante ou quantidade). 700ms é o meio da faixa 600–800ms: curto o
 * bastante para não parecer travado quando a cliente para de clicar, longo o
 * bastante para absorver uma rajada de cliques em "+"/"-" numa chamada só.
 */
const SHIPPING_RECALC_DEBOUNCE_MS = 700;

interface ShippingCalculatorProps {
  cart: CartItem[];
  subtotal: number;
  freeShippingMin: number;
  selectedOption: ShippingOption | null;
  onSelectOption: (option: ShippingOption | null) => void;
  onCepValidated?: (cep: string) => void;
}

export function ShippingCalculator({
  cart,
  subtotal,
  freeShippingMin,
  selectedOption,
  onSelectOption,
  onCepValidated,
}: ShippingCalculatorProps) {
  const isOffline = useOnlineStatus();
  const { user } = useAuth();
  const [cep, setCep] = useState(() => {
    return localStorage.getItem("ikcous_last_shipping_cep") || "";
  });
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Lacre de sequência: cada `calculateShipping` tira um número; só quem tem
  // o número MAIS RECENTE pode escrever o resultado na tela. Sem isso, duas
  // cotações em voo ao mesmo tempo (ex.: carrinho vai para 2un e, antes da
  // resposta chegar, vai para 3un de novo) correm risco de a mais VELHA
  // responder por último e sobrescrever a mais nova — e o preço errado fica
  // preso na tela até a próxima mudança de carrinho. Ver
  // tests/front/shipping-calculator-nao-sobrescreve-com-cotacao-antiga.test.tsx.
  const reqRef = useRef(0);

  // Timer do debounce de recotação por mudança de carrinho (efeito abaixo,
  // `SHIPPING_RECALC_DEBOUNCE_MS`). Guardado em ref para que
  // `calculateShipping` possa CANCELAR um debounce ainda pendente assim que
  // uma cotação de verdade começa — manual (form) ou automática (o próprio
  // timer). Sem isso, o lacre de sequência acima não protege contra um caso
  // específico: o timer pode ser, ao disparar, a chamada MAIS RECENTE por
  // número — e ainda assim carregar, na closure, um `cep` que a cliente já
  // substituiu enquanto o timer esperava. Ver
  // tests/front/shipping-calculator-cotacao-manual-cancela-debounce-pendente.test.tsx.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-format CEP: 99999-999
  const handleCepChange = (val: string) => {
    const clean = val.replace(/\D/g, "");
    if (clean.length <= 5) {
      setCep(clean);
    } else {
      setCep(`${clean.slice(0, 5)}-${clean.slice(5, 8)}`);
    }
  };

  const calculateShipping = async (e?: React.FormEvent, skipHaptic = false) => {
    if (e) e.preventDefault();

    const cleanCep = cep.replace(/\D/g, "");
    if (cleanCep.length !== 8) {
      setError("CEP deve conter 8 dígitos.");
      return;
    }

    // Esta chamada já cobre o carrinho e o CEP correntes — qualquer debounce
    // ainda não disparado passa a ser redundante na melhor hipótese e ERRADO
    // na pior (se o CEP mudou desde que o timer foi agendado). Cancelar aqui
    // fecha a janela: nenhum timer sobrevive a uma cotação de verdade.
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!skipHaptic) {
      haptic.light();
    }
    setLoading(true);
    setError(null);

    // Meu número nesta rodada. Comparado contra `reqRef.current` em todo
    // ponto que escreve resultado — se outra chamada mais nova já tirou
    // número, esta aqui é obsoleta e não escreve nada, nem `loading`.
    const meuId = ++reqRef.current;

    const cacheKey = `ikcous_shipping_cache_${cleanCep}`;

    try {
      // 1. Check local cache first if offline or as speedup
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Sem lacre aqui de propósito: até este ponto só rodou
            // `localStorage.getItem`/`JSON.parse`, ambos síncronos — nenhum
            // `await` passou, então `meuId` ainda é garantidamente o valor
            // mais recente de `reqRef.current`. A guarda existia mas nunca
            // podia disparar; ela só escondia o fato de que este ramo não
            // precisa de proteção.
            setOptions(parsed);

            // Auto-select first/cheapest option if none selected
            const hasMatch = parsed.some(
              (opt) => opt.id === selectedOption?.id,
            );
            if (!hasMatch) {
              onSelectOption(parsed[0]);
            }
            onCepValidated?.(cep);
            setLoading(false);
            localStorage.setItem("ikcous_last_shipping_cep", cep);
            return;
          }
        } catch (e) {
          console.error("Error parsing cached shipping options:", e);
        }
      }

      // 2. Fallback to Edge Function request
      if (isOffline) {
        throw new Error("Sem conexão com a internet.");
      }

      const { data, error: funcError } = await supabase.functions.invoke(
        "calculate-shipping",
        {
          body: { cep: cleanCep, cart: cart },
        },
      );

      if (funcError || !data || !data.options) {
        throw new Error(funcError?.message || "Falha ao cotar frete.");
      }

      const calculatedOptions: ShippingOption[] = data.options;
      if (meuId !== reqRef.current) return;
      setOptions(calculatedOptions);

      // Save to cache
      localStorage.setItem(cacheKey, JSON.stringify(calculatedOptions));
      localStorage.setItem("ikcous_last_shipping_cep", cep);

      // Auto-select cheapest option if not selected
      if (calculatedOptions.length > 0) {
        const hasMatch = calculatedOptions.some(
          (opt) => opt.id === selectedOption?.id,
        );
        if (!hasMatch) {
          onSelectOption(calculatedOptions[0]);
        }
      }
      onCepValidated?.(cep);
    } catch (err: any) {
      if (meuId !== reqRef.current) return;
      console.error("Error calculating shipping:", err);
      setError(err.message || "Erro ao calcular frete.");

      // COTAÇÃO QUE FALHA NÃO VIRA PREÇO INVENTADO.
      //
      // Até 18/08/2026 este ponto montava uma opção própria de R$ 15 e a
      // auto-selecionava. Dois estragos: R$ 15 valia para o Brasil inteiro (e a
      // diferença saía do bolso da lojista), e — pior — a opção selecionada
      // SOBRESCREVE a taxa que ela configurou: o `shippingFee` do CartContext
      // só cai para `config.shippingFee` enquanto NÃO há opção escolhida.
      //
      // Sem opção nenhuma aqui, o erro aparece na tela e o frete volta a ser o
      // número que a própria loja definiu no painel. A trava está em
      // tests/front/shipping-calculator-sem-preco-inventado.test.tsx.
      setOptions([]);
      onSelectOption(null);
    } finally {
      // Uma resposta obsoleta não pode apagar o `loading` de uma requisição
      // mais nova que ainda está em voo — senão o spinner sumiria enquanto a
      // cotação que importa continua esperando a transportadora.
      if (meuId === reqRef.current) {
        setLoading(false);
      }
    }
  };

  // Assinatura estável do carrinho: muda quando produto, variante OU
  // QUANTIDADE mudam — não só quando um item entra ou sai. Mesma forma de
  // `getCartHash` em supabase/functions/calculate-shipping/index.ts:
  // itens ordenados por `productId+variantId`, cada um
  // `${productId}:${variantId}:${quantity}`, juntos por vírgula.
  //
  // Até 21/08/2026 o efeito abaixo dependia só de `cart.length`, então subir
  // a quantidade de um item que já estava no carrinho (1 → 10 unidades) não
  // recotava: a tela continuava mostrando o frete de 1 unidade e o pedido
  // fechava com esse valor, com a diferença saindo do bolso da lojista.
  const cartSignature = useMemo(() => {
    if (cart.length === 0) return "";
    const sorted = [...cart].sort((a, b) => {
      const idA = (a.product?.id || "") + (a.variantId || "");
      const idB = (b.product?.id || "") + (b.variantId || "");
      return idA.localeCompare(idB);
    });
    return sorted
      .map(
        (item) =>
          `${item.product?.id}:${item.variantId || ""}:${item.quantity || 1}`,
      )
      .join(",");
  }, [cart]);

  // Reage a QUALQUER mudança que afete o frete (produto, variante ou
  // quantidade), com debounce: o componente não tinha nenhum, e o cache DO
  // SERVIDOR (`shipping_quotes_cache`, indexado pelo hash do carrinho) —
  // então cada clique em "+"/"-" trocava a quantidade, virava cache miss lá
  // e batia a transportadora de novo. Uma rajada de 1 → 10 cliques virava 10
  // cotações reais. `clearTimeout` no cleanup cancela a cotação pendente se
  // o carrinho mudar de novo antes dela disparar (ou o componente
  // desmontar).
  //
  // Deps só `[cartSignature]`, de propósito — igual ao código anterior a
  // esta correção. `cep` NÃO entra: submeter um CEP novo já cota na hora,
  // via `calculateShipping` chamado direto pelo `<form>` (linha abaixo). Se
  // `cep` também fosse dependência, cada CEP digitado agendaria uma SEGUNDA
  // cotação (esta, com debounce) por cima da imediata — foi o que a suíte
  // "controle negativo" pegou na primeira versão desta correção.
  //
  // A closure QUE FICA obsoleta: o efeito só dispara de novo quando o
  // CARRINHO muda, e nesse instante ele fecha sobre o `cep` do render
  // corrente — nunca sobre o `cep` da montagem. Mas os `SHIPPING_RECALC_
  // DEBOUNCE_MS` (700ms) entre o agendamento e o disparo do timer são uma
  // janela de verdade: se a cliente TROCAR o CEP manualmente dentro dela, o
  // timer dispara com o `cep` de QUANDO FOI AGENDADO, não o atual — e essa
  // chamada, por ter sido a última a tirar número no lacre de sequência
  // acima, VENCE. É por isso que `calculateShipping` cancela qualquer
  // debounce pendente assim que uma cotação de verdade começa
  // (`debounceTimerRef`, no topo do componente): nenhum closure velho chega
  // a rodar.
  useEffect(() => {
    const cleanCep = cep.replace(/\D/g, "");
    if (cleanCep.length !== 8 || cart.length === 0) return;

    // Invalida CEDO (síncrono, assim que o carrinho muda), não dentro do
    // timer. O cache que esta linha apaga é o `ikcous_shipping_cache_<CEP>`
    // (ver `cacheKey` em `calculateShipping`), indexado só pelo CEP — uma
    // quantidade nova é HIT nele, não miss, porque ele não sabe o que tem no
    // carrinho. Até 21/08/2026 o `removeItem` ficava dentro do `setTimeout`:
    // se a cliente clicasse "Calcular" manualmente durante a janela de
    // debounce (até 700ms depois de mudar o carrinho), o cache antigo ainda
    // estava lá e devolvia o preço da quantidade anterior. Invalidar aqui
    // fecha essa janela; só a CHAMADA à transportadora continua adiada.
    localStorage.removeItem(`ikcous_shipping_cache_${cleanCep}`);

    const timer = setTimeout(() => {
      calculateShipping(undefined, true);
    }, SHIPPING_RECALC_DEBOUNCE_MS);
    debounceTimerRef.current = timer;

    return () => {
      clearTimeout(timer);
      debounceTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature]);

  // Regra de frete grátis. Espelha `shippingFee` em CartContext.tsx:740-757 e a RPC
  // `create_marketplace_order_v23`, que só zera o frete quando `v_user_id IS NOT NULL`.
  // Sem a checagem de `user`, o convidado via todas as opções a R$ 0,00 aqui e era
  // cobrado o valor cheio no fechamento do pedido. Unificar as cópias desta regra é a FRETE-020.
  const hasFreeShippingItem = cart.some((item) => item.product?.freeShipping);
  const reachedFreeShippingGoal =
    freeShippingMin > 0 && subtotal >= freeShippingMin && Boolean(user);
  const isFree = hasFreeShippingItem || reachedFreeShippingGoal;

  return (
    <div className="w-full space-y-4 rounded-3xl border border-zinc-100 bg-zinc-50/50 p-4">
      <div className="flex items-center gap-2">
        <Truck className="size-4 text-zinc-500" />
        <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
          Calcular Frete & Prazo
        </span>
      </div>

      <form onSubmit={calculateShipping} className="flex gap-2">
        <div className="relative flex-1">
          <input
            id="shipping-calculator-cep"
            name="cep"
            type="tel"
            value={cep}
            onChange={(e) => handleCepChange(e.target.value)}
            placeholder="00000-000"
            maxLength={9}
            className="w-full rounded-2xl border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-xs font-semibold text-zinc-800 transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
        </div>
        <button
          type="submit"
          disabled={loading || cep.replace(/\D/g, "").length !== 8}
          className="shrink-0 select-none rounded-2xl bg-primary px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
        >
          {loading ? "Cotando..." : "Calcular"}
        </button>
      </form>

      {error && (
        <div className="flex items-start gap-1.5 rounded-2xl border border-amber-100 bg-amber-50 p-2.5 text-[9.5px] font-medium text-amber-800">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Shipping Options list */}
      <AnimatePresence mode="popLayout">
        {options.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="space-y-2"
          >
            {options.map((option) => {
              const isSelected = selectedOption?.id === option.id;
              const priceToDisplay = isFree ? 0 : option.price;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    haptic.light();
                    onSelectOption(option);
                  }}
                  className={`flex w-full select-none items-center justify-between rounded-2xl border p-3 text-left transition-all duration-200 ${
                    isSelected
                      ? "border-primary bg-primary text-white shadow-md shadow-black/10"
                      : "border-zinc-100 bg-white text-zinc-800 hover:border-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex size-7 items-center justify-center rounded-lg border transition-colors ${
                        isSelected
                          ? "border-white/20 bg-white/20 text-white"
                          : "border-zinc-100 bg-zinc-50 text-zinc-500"
                      }`}
                    >
                      {isSelected ? (
                        <Check className="size-4" />
                      ) : (
                        <Truck className="size-4" />
                      )}
                    </div>
                    <div>
                      <span className="block text-[11px] font-bold leading-snug">
                        {option.name}
                      </span>
                      <span
                        className={`mt-0.5 block text-[9px] leading-none ${
                          isSelected ? "text-zinc-300" : "text-zinc-400"
                        }`}
                      >
                        Entrega em até {option.deliveryDays}{" "}
                        {option.deliveryDays > 1 ? "dias úteis" : "dia útil"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col justify-center text-right">
                    {isFree ? (
                      <div className="flex items-center gap-1">
                        <Sparkles className="size-3 fill-emerald-500/20 text-emerald-500" />
                        <span className="text-xs font-black uppercase tracking-wider text-emerald-500">
                          GRÁTIS
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs font-black tracking-tight">
                        {formatCurrency(priceToDisplay)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
