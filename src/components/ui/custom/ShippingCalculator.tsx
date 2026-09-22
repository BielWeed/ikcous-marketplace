import { useCartState } from "@/contexts/CartContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { opcaoFrescaOuMaisBarata } from "@/lib/auto-selecao-de-frete";
import {
  codigoDoErroDeEdgeFunction,
  mensagemAmigavelErroEdgeFunction,
} from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import type { CartItem, ShippingOption } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  MapPin,
  RefreshCw,
  Sparkles,
  Truck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Janela de debounce para recotar após mudança no carrinho (produto,
 * variante ou quantidade). 700ms é o meio da faixa 600–800ms: curto o
 * bastante para não parecer travado quando a cliente para de clicar, longo o
 * bastante para absorver uma rajada de cliques em "+"/"-" numa chamada só.
 */
const SHIPPING_RECALC_DEBOUNCE_MS = 700;

/**
 * Validade do cache de frete NO NAVEGADOR.
 *
 * 2 h é exatamente o prazo que a edge function usa para considerar uma cotação
 * recente (`twoHoursAgo` em `supabase/functions/calculate-shipping/index.ts`,
 * no CACHE LOOKUP). Acima disso ela recalcularia de qualquer jeito — servir do
 * navegador seria fabricar um frescor que o servidor não daria.
 *
 * 🔴 Este prazo NÃO é o mesmo assunto que a janela de 24 h do `WHERE` da RPC
 * que valida o pedido, e um não implica o outro: **encurtar o prazo do BANCO
 * causa RECUSA** na cara de quem já clicou em finalizar; **encurtar este aqui
 * causa RECÁLCULO**. Botões parecidos, consequências opostas.
 */
const SHIPPING_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * As duas frases que `calculateShipping` lança ANTES de chegar ao SDK de
 * Edge Function (ver `catch` logo abaixo) — escritas pelo PRÓPRIO componente,
 * já em português. `mensagemAmigavelErroEdgeFunction` (src/lib/mensagens-erro.ts)
 * as reconhece por comparação de TEXTO EXATO via `mensagensSeguras` e as
 * deixa passar direto, em vez de as trocar pelo genérico.
 *
 * Constantes, não dois literais soltos: até 22/08/2026 esta frase existia
 * duas vezes no arquivo (aqui e na lista de `mensagensSeguras`), sem nada
 * amarrando as duas — editar uma sem lembrar da outra fazia quem está
 * OFFLINE ler "Não foi possível calcular o frete agora. Tente novamente em
 * instantes." em vez do aviso de conexão, o conselho errado para quem não
 * tem internet nenhuma. Usar a MESMA constante nos dois lugares torna essa
 * divergência impossível de compilar, em vez de só impossível de passar num
 * teste que alguém pode esquecer de rodar.
 */
const MENSAGEM_SEM_CONEXAO_FRETE = "Sem conexão com a internet.";
const MENSAGEM_FALHA_AO_COTAR = "Falha ao cotar frete.";
// Sem campo de CEP na tela, o conselho é conferir o CEP DO ENDEREÇO — a
// frase antiga ("Confira o número") apontava para um campo que não existe.
const MENSAGEM_CEP_NAO_ENCONTRADO =
  "CEP não encontrado. Confira o CEP do endereço de entrega.";

interface EnvelopeDeCacheDeFrete {
  /** Assinatura do carrinho que gerou esta cotação (mesmo formato de `cartSignature`). */
  assinatura: string;
  /** `Date.now()` de quando a cotação foi gravada. */
  gravadoEm: number;
  opcoes: ShippingOption[];
}

/**
 * Decide se uma entrada do cache local pode virar preço na tela.
 *
 * A chave (`ikcous_shipping_cache_<CEP>`) diz só o CEP. Quem responde "de qual
 * carrinho isto veio?" e "quando foi cotado?" é o próprio conteúdo — por isso a
 * validação mora aqui e não na chave: manter UMA entrada por CEP preserva os
 * dois consumidores que já dependem do formato exato da chave (o `removeItem`
 * da invalidação por mudança de carrinho, logo abaixo, e a varredura por
 * prefixo do logout em `AuthContext.tsx`) e impede o `localStorage` de crescer
 * uma entrada nova a cada combinação de carrinho — estouro de cota ali cai no
 * `catch` de `calculateShipping` e apagaria uma cotação boa da tela.
 *
 * Devolve `null` — ou seja, "não tem cache" — para tudo que não for uma
 * cotação do carrinho de agora, gravada dentro da validade. A lista crua (o
 * formato anterior a 22/08/2026, que ainda está no navegador das clientes) cai
 * na checagem de `assinatura`: uma lista não tem esse campo, e não há como
 * saber de qual carrinho ela veio. Não há guarda separada para ela de
 * propósito — foi medido que uma guarda de formato não decidia caso nenhum que
 * a checagem de assinatura já não decidisse.
 */
export function cotacaoCacheadaQueAindaServe(
  bruto: unknown,
  assinaturaAtual: string,
  agora: number,
): ShippingOption[] | null {
  if (!bruto || typeof bruto !== "object") return null;

  const envelope = bruto as Partial<EnvelopeDeCacheDeFrete>;

  if (
    typeof envelope.assinatura !== "string" ||
    envelope.assinatura !== assinaturaAtual
  ) {
    return null;
  }

  if (
    typeof envelope.gravadoEm !== "number" ||
    !Number.isFinite(envelope.gravadoEm)
  ) {
    return null;
  }

  // Idade negativa = relógio andou para trás (ou data adulterada). Recusar é o
  // lado seguro: o preço do frete entra no total do pedido.
  const idade = agora - envelope.gravadoEm;
  if (idade < 0 || idade > SHIPPING_CACHE_TTL_MS) return null;

  if (!Array.isArray(envelope.opcoes) || envelope.opcoes.length === 0) {
    return null;
  }

  return envelope.opcoes as ShippingOption[];
}

/**
 * Em que pé está o frete do destino corrente. O pai que FECHA pedido
 * (checkout) usa isto para travar o Finalizar enquanto a cotação ainda não
 * é do destino/carrinho de agora:
 *   - `sem-destino`: não há endereço (ou CEP completo) para cotar;
 *   - `ocioso`: há destino, mas o carrinho está vazio;
 *   - `cotando`: cotação em voo OU recotação agendada (carrinho mudou) — o
 *     preço na tela, se houver, é de outra rodada;
 *   - `pronto`: há opções do destino e do carrinho correntes;
 *   - `vazio`: a cotação voltou sem opção nenhuma;
 *   - `erro`: a cotação falhou (há "Tentar de novo").
 */
export type StatusDaCotacao =
  | "sem-destino"
  | "ocioso"
  | "cotando"
  | "pronto"
  | "vazio"
  | "erro";

export interface DestinoExibido {
  /** Apelido do endereço cadastrado ("Casa", "Trabalho"). */
  apelido?: string | null;
  /** Uma linha: rua, número, bairro, cidade/UF, CEP. */
  resumo?: string | null;
}

interface ShippingCalculatorProps {
  cart: CartItem[];
  selectedOption: ShippingOption | null;
  onSelectOption: (option: ShippingOption | null) => void;
  onCepValidated?: (cep: string) => void;
  /**
   * CEP do destino efetivo de entrega (endereço escolhido ou principal; para
   * o convidado, o CEP completo do formulário). É a ÚNICA fonte do destino:
   * não existe mais campo de CEP aqui. Chegou ou trocou ⇒ a cotação anterior
   * cai na hora e a nova sai sozinha; sumiu ⇒ nada de preço na tela.
   */
  cepDestino?: string | null;
  /**
   * CEP para o qual a opção `selectedOption` foi cotada (`shippingCep` do
   * CartContext). Remontar a calculadora no MESMO destino não derruba a
   * escolha da cliente — a recotação devolve o objeto fresco do mesmo
   * serviço. Escolha de OUTRO destino cai.
   */
  cepDaSelecao?: string | null;
  /** O que mostrar como destino ("Entrega para Casa" + resumo). */
  destino?: DestinoExibido | null;
  /** Botão/ação ao lado do destino (trocar ou cadastrar endereço). */
  acaoDoEndereco?: React.ReactNode;
  /** Texto quando não há destino para cotar. */
  mensagemSemDestino?: string;
  onStatusChange?: (status: StatusDaCotacao) => void;
  /**
   * Veredito de frete grátis. Quem já o tem em mãos (o checkout, via
   * `useCart`) passa aqui; sem a prop, vem do `useCartState` — a MESMA fonte
   * única (memo `freteGratis` do CartContext) nos dois casos.
   */
  freteGratis?: boolean;
}

type PropsComFreteGratis = Omit<ShippingCalculatorProps, "freteGratis"> & {
  freteGratis: boolean;
};

export function ShippingCalculator(props: ShippingCalculatorProps) {
  if (props.freteGratis !== undefined) {
    return <CalculadoraDeFrete {...props} freteGratis={props.freteGratis} />;
  }
  return <CalculadoraComFreteDoContexto {...props} />;
}

function CalculadoraComFreteDoContexto(props: ShippingCalculatorProps) {
  // FRETE V2 (onda D-1, 03/09): a regra de grátis tem FONTE ÚNICA — o memo
  // `freteGratis` do CartContext (preset do lojista). Ver
  // tests/front/shipping-calculator-frete-gratis-fonte-unica.test.tsx.
  const { freteGratis } = useCartState();
  return <CalculadoraDeFrete {...props} freteGratis={freteGratis} />;
}

function soDigitosDoCep(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

function CalculadoraDeFrete({
  cart,
  selectedOption,
  onSelectOption,
  onCepValidated,
  cepDestino,
  cepDaSelecao,
  destino,
  acaoDoEndereco,
  mensagemSemDestino = "Cadastre um endereço de entrega para ver o frete e o prazo.",
  onStatusChange,
  freteGratis: isFree,
}: PropsComFreteGratis) {
  const isOffline = useOnlineStatus();
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  // HONESTIDADE (onda D-1): guarda se a ÚLTIMA cotação concluída voltou sem
  // opção nenhuma (edge devolve `options: []` — loja sem transportadora
  // conectada, frente C). É o que permite mostrar o estado "A calcular" em
  // vez de silêncio.
  const [cotouSemOpcoes, setCotouSemOpcoes] = useState(false);

  // Lacre de sequência: cada `calculateShipping` tira um número; só quem tem
  // o número MAIS RECENTE pode escrever o resultado na tela. Sem isso, duas
  // cotações em voo ao mesmo tempo (ex.: carrinho vai para 2un e, antes da
  // resposta chegar, vai para 3un de novo — ou o endereço troca de cidade)
  // correm risco de a mais VELHA responder por último e sobrescrever a mais
  // nova. Ver tests/front/shipping-calculator-nao-sobrescreve-com-cotacao-antiga.test.tsx.
  const reqRef = useRef(0);

  // CEP (só dígitos) que as cotações desta calculadora estão servindo. Ref, e
  // não estado: o timer da recotação por carrinho e o "Tentar de novo" leem o
  // destino de AGORA — um closure antigo cotaria o endereço anterior.
  const cepAdotadoRef = useRef<string | null>(null);
  // Assinatura do carrinho da cotação que está na tela: opções de outro
  // carrinho nunca contam como "pronto".
  const assinaturaCotadaRef = useRef<string | null>(null);

  // Timer do debounce de recotação por mudança de carrinho. Guardado em ref
  // para que `calculateShipping` possa CANCELAR um debounce ainda pendente
  // assim que uma cotação de verdade começa. Ver
  // tests/front/shipping-calculator-cotacao-manual-cancela-debounce-pendente.test.tsx.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A seleção VIVA: a prop muda a cada clique numa opção, mas o
  // `calculateShipping` em execução fecha sobre a seleção do render em que
  // a COTAÇÃO saiu. Com cotação em voo, um clique novo era REVERTIDO pela
  // resposta. Este ref espelha a prop POR RENDER e é a ENTRADA de
  // `opcaoFrescaOuMaisBarata` — mesma modalidade na lista nova ⇒ objeto NOVO
  // (preço fresco); modalidade sumida ⇒ a mais barata; seleção nula ⇒ a mais
  // barata.
  const selecaoVivaRef = useRef(selectedOption);
  selecaoVivaRef.current = selectedOption;

  // Tira a tela da cotação anterior: resposta em voo vira obsoleta (lacre),
  // debounce pendente morre e nada do destino antigo continua clicável.
  // Resposta obsoleta não roda o `finally` (guarda do lacre), então o
  // `loading` é limpo AQUI.
  const invalidarCotacao = () => {
    reqRef.current += 1;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setLoading(false);
    setError(null);
    setOptions([]);
    setCotouSemOpcoes(false);
  };

  const calculateShipping = async (cepAlvo: string, skipHaptic = true) => {
    const cleanCep = soDigitosDoCep(cepAlvo);
    if (cleanCep.length !== 8) return;
    const cepFormatado = `${cleanCep.slice(0, 5)}-${cleanCep.slice(5, 8)}`;

    // Esta chamada já cobre o carrinho e o destino correntes — qualquer
    // debounce ainda não disparado passa a ser redundante na melhor hipótese
    // e ERRADO na pior. Nenhum timer sobrevive a uma cotação de verdade.
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
      // 1. Cache local primeiro. Este acerto não só mostra o preço: ele já
      // SELECIONA a opção logo abaixo, e é ela que vai para o pedido. Por
      // isso a entrada precisa ser do carrinho de agora e estar dentro da
      // validade — ver `cotacaoCacheadaQueAindaServe`. A chave é o CEP (o
      // destino) e o envelope carrega a assinatura do carrinho (os itens).
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const opcoesEmCache = cotacaoCacheadaQueAindaServe(
            JSON.parse(cached),
            cartSignature,
            Date.now(),
          );
          if (opcoesEmCache) {
            // Sem lacre aqui de propósito: até este ponto só rodou código
            // síncrono — nenhum `await` passou, então `meuId` ainda é
            // garantidamente o valor mais recente de `reqRef.current`.
            setOptions(opcoesEmCache);
            setCotouSemOpcoes(false);
            assinaturaCotadaRef.current = cartSignature;
            const selecionadaAtualizada = opcaoFrescaOuMaisBarata(
              selecaoVivaRef.current,
              opcoesEmCache,
            );
            if (selecionadaAtualizada) {
              onSelectOption(selecionadaAtualizada);
            }
            onCepValidated?.(cepFormatado);
            setLoading(false);
            localStorage.setItem("ikcous_last_shipping_cep", cepFormatado);
            return;
          }
        } catch (e) {
          console.error("Error parsing cached shipping options:", e);
        }
      }

      // 2. Fallback to Edge Function request
      if (isOffline) {
        throw new Error(MENSAGEM_SEM_CONEXAO_FRETE);
      }

      const { data, error: funcError } = await supabase.functions.invoke(
        "calculate-shipping",
        {
          body: { cep: cleanCep, cart: cart },
        },
      );

      if (funcError) {
        // Relançado sem embrulho: `mensagemAmigavelErroEdgeFunction`, logo
        // abaixo no `catch`, decide pelo `.name` do próprio erro do SDK —
        // embrulhar aqui perderia esse `.name`.
        throw funcError;
      }
      if (!data || !data.options) {
        throw new Error(MENSAGEM_FALHA_AO_COTAR);
      }

      const calculatedOptions: ShippingOption[] = data.options;
      if (meuId !== reqRef.current) return;
      setOptions(calculatedOptions);
      assinaturaCotadaRef.current = cartSignature;
      setCotouSemOpcoes(calculatedOptions.length === 0);
      // Resposta vazia não preserva a escolha anterior: ela é preço de
      // outra cotação.
      if (calculatedOptions.length === 0 && selecaoVivaRef.current) {
        onSelectOption(null);
      }

      // Save to cache — junto com de QUAL carrinho esta cotação é e QUANDO ela
      // foi feita. Sem esses dois campos a leitura acima não tem como recusar
      // uma lista de outro carrinho ou de outro dia.
      const envelope: EnvelopeDeCacheDeFrete = {
        assinatura: cartSignature,
        gravadoEm: Date.now(),
        opcoes: calculatedOptions,
      };
      localStorage.setItem(cacheKey, JSON.stringify(envelope));
      localStorage.setItem("ikcous_last_shipping_cep", cepFormatado);

      // Auto-select: MENOR PREÇO, não o primeiro da lista (laudo 31/08,
      // menor E). Mesmo id na resposta nova = mesma escolha de serviço, com
      // o objeto FRESCO; id sumido = a mais barata. A entrada é a seleção
      // VIVA — o clique dado com a cotação em voo não é desfeito.
      if (calculatedOptions.length > 0) {
        const selecionadaAtualizada = opcaoFrescaOuMaisBarata(
          selecaoVivaRef.current,
          calculatedOptions,
        );
        if (selecionadaAtualizada) {
          onSelectOption(selecionadaAtualizada);
        }
      }
      onCepValidated?.(cepFormatado);
    } catch (err: any) {
      if (meuId !== reqRef.current) return;
      const codigo = await codigoDoErroDeEdgeFunction(err);
      if (meuId !== reqRef.current) return;
      console.error("Error calculating shipping:", err);
      setError(
        codigo === "cep_invalido"
          ? MENSAGEM_CEP_NAO_ENCONTRADO
          : mensagemAmigavelErroEdgeFunction(err, {
              mensagensSeguras: [
                MENSAGEM_SEM_CONEXAO_FRETE,
                MENSAGEM_FALHA_AO_COTAR,
              ],
              mensagemGenerica:
                "Não foi possível calcular o frete agora. Tente novamente em instantes.",
            }),
      );

      // COTAÇÃO QUE FALHA NÃO VIRA PREÇO INVENTADO: nenhuma opção própria é
      // montada nem selecionada. O erro aparece com "Tentar de novo" e o
      // frete fica "a calcular". Trava em
      // tests/front/shipping-calculator-sem-preco-inventado.test.tsx.
      setOptions([]);
      setCotouSemOpcoes(false);
      onSelectOption(null);
    } finally {
      // Uma resposta obsoleta não pode apagar o `loading` de uma requisição
      // mais nova que ainda está em voo.
      if (meuId === reqRef.current) {
        setLoading(false);
      }
    }
  };

  // Assinatura estável do carrinho: muda quando produto, variante OU
  // QUANTIDADE mudam. Mesma forma de `getCartHash` em
  // supabase/functions/calculate-shipping/index.ts: itens ordenados por
  // `productId+variantId`, cada um `${productId}:${variantId}:${quantity}`,
  // juntos por vírgula.
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

  // Assinatura já atendida. A montagem NÃO conta como mudança de carrinho:
  // quem cota na montagem é a adoção do destino (efeito abaixo), que pode
  // servir do cache — apagar o cache aqui na montagem obrigava toda volta ao
  // carrinho a bater na transportadora de novo.
  const assinaturaVistaRef = useRef(cartSignature);

  // Reage a QUALQUER mudança do carrinho (produto, variante ou quantidade),
  // com debounce: uma rajada de cliques em "+"/"-" vira UMA cotação. Enquanto
  // o timer espera, o status é "cotando" — o preço na tela é do carrinho
  // anterior e o checkout não fecha com ele.
  useEffect(() => {
    if (assinaturaVistaRef.current === cartSignature) return;
    assinaturaVistaRef.current = cartSignature;
    const alvo = cepAdotadoRef.current;
    if (!alvo || cart.length === 0) return;

    // Invalida CEDO (síncrono), não dentro do timer: o cache é indexado pelo
    // CEP e uma cotação que começasse na janela do debounce não pode achar o
    // preço da quantidade anterior.
    localStorage.removeItem(`ikcous_shipping_cache_${alvo}`);
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      const cepDeAgora = cepAdotadoRef.current;
      if (cepDeAgora) calculateShipping(cepDeAgora, true);
    }, SHIPPING_RECALC_DEBOUNCE_MS);
    debounceTimerRef.current = timer;

    return () => {
      clearTimeout(timer);
      if (debounceTimerRef.current === timer) debounceTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature]);

  // Resposta atrasada não sobrevive ao desmonte: sem o lacre, a cotação em
  // voo gravava `ikcous_last_shipping_cep` e o cache DEPOIS que o destino
  // já era outro. Zerar o destino adotado faz a remontagem (inclusive a do
  // StrictMode) adotar e cotar de novo, em vez de ficar presa no lacre.
  useEffect(() => {
    return () => {
      reqRef.current += 1;
      cepAdotadoRef.current = null;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  // A FONTE DO DESTINO É O ENDEREÇO DE ENTREGA. Destino chegou ou trocou: a
  // cotação anterior cai NA HORA (opções, erro, resposta em voo) e a nova
  // sai sozinha. A escolha da cliente só sobrevive se foi cotada para ESTE
  // mesmo CEP (`cepDaSelecao`) — voltar ao carrinho não desfaz a modalidade;
  // trocar de endereço, sim (a mais barata do destino novo vence). Destino
  // sumiu: nada de preço de endereço que não existe mais.
  useEffect(() => {
    const limpo = soDigitosDoCep(cepDestino);
    const anterior = cepAdotadoRef.current;

    if (limpo.length !== 8) {
      if (anterior === null) return;
      cepAdotadoRef.current = null;
      invalidarCotacao();
      if (selecaoVivaRef.current) {
        selecaoVivaRef.current = null;
        onSelectOption(null);
      }
      return;
    }

    if (anterior === limpo) return;
    cepAdotadoRef.current = limpo;
    invalidarCotacao();

    const selecao = selecaoVivaRef.current;
    const selecaoValeAqui = !!selecao && soDigitosDoCep(cepDaSelecao) === limpo;
    if (selecao && !selecaoValeAqui) {
      // O ref também cai: uma resposta do cache (síncrona, ainda neste
      // tick) não pode "preservar" a modalidade de outro destino.
      selecaoVivaRef.current = null;
      onSelectOption(null);
    }
    if (cart.length === 0) return;
    calculateShipping(limpo, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cepDestino]);

  const tentarDeNovo = () => {
    const alvo = cepAdotadoRef.current;
    if (alvo) calculateShipping(alvo, false);
  };

  const destinoValido = soDigitosDoCep(cepDestino).length === 8;
  // Derivado EM RENDER: no primeiro pintar depois de o destino aparecer,
  // antes de o efeito de adoção rodar, o status já é "cotando" — nunca
  // "pronto" com opções que não são deste destino.
  const status: StatusDaCotacao = !destinoValido
    ? "sem-destino"
    : cart.length === 0
      ? "ocioso"
      : cepAdotadoRef.current !== soDigitosDoCep(cepDestino) || loading
        ? "cotando"
        : error
          ? "erro"
          : options.length > 0 && assinaturaCotadaRef.current === cartSignature
            ? "pronto"
            : cotouSemOpcoes
              ? "vazio"
              : "cotando";

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const cepExibido = destinoValido
    ? `${soDigitosDoCep(cepDestino).slice(0, 5)}-${soDigitosDoCep(cepDestino).slice(5, 8)}`
    : null;
  const apelido = destino?.apelido?.trim();
  const titulo = apelido ? `Entrega para ${apelido}` : "Entrega";
  const resumo =
    destino?.resumo?.trim() || (cepExibido ? `CEP ${cepExibido}` : null);

  return (
    <section
      aria-label="Entrega e frete"
      className="w-full space-y-3 rounded-3xl border border-zinc-100 bg-zinc-50/50 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-zinc-500" />
          <div className="min-w-0">
            <span className="block text-[11px] font-black uppercase tracking-wider text-zinc-700">
              {titulo}
            </span>
            {destinoValido && resumo && (
              <span className="mt-0.5 block text-[11px] font-medium leading-snug text-zinc-500">
                {resumo}
              </span>
            )}
          </div>
        </div>
        {acaoDoEndereco && <div className="shrink-0">{acaoDoEndereco}</div>}
      </div>

      {!destinoValido && (
        <div className="flex items-start gap-1.5 rounded-2xl border border-zinc-100 bg-white p-2.5 text-[11px] font-medium text-zinc-600">
          <Truck className="mt-0.5 size-3.5 shrink-0 text-zinc-400" />
          <span>{mensagemSemDestino}</span>
        </div>
      )}

      {destinoValido && loading && (
        // Laudo de acessibilidade 05/09: estado de espera anunciado sem
        // roubar o foco.
        <div
          role="status"
          className="flex items-center gap-2 text-[11px] font-semibold text-zinc-500"
        >
          <span className="size-3 animate-spin rounded-full border-2 border-zinc-200 border-t-primary" />
          Calculando frete e prazo...
        </div>
      )}

      {/* Com a calculadora montada também no carrinho grátis (CartView-495),
          o alerta de erro de cotação não pode aparecer sozinho: a cotação
          continua (ela dá o shipping_option_id de reserva), só o aviso cala. */}
      {destinoValido && !isFree && error && (
        <div className="flex items-start justify-between gap-2 rounded-2xl border border-amber-100 bg-amber-50 p-2.5 text-[11px] font-medium text-amber-800">
          {/* Laudo de acessibilidade 05/09, M1: `role="alert"` fala na hora
              — só a frase; o botão fica fora do que é anunciado. */}
          <div role="alert" className="flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={tentarDeNovo}
            disabled={loading}
            className="flex shrink-0 select-none items-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-800 shadow-sm disabled:opacity-40"
          >
            <RefreshCw className="size-3" />
            Tentar de novo
          </button>
        </div>
      )}

      {/* Lista de opções. SEM animação de saída de propósito: trocar de
          endereço invalida a cotação na hora, e uma saída animada deixava as
          opções do destino ANTERIOR na tela — e clicáveis — durante o fade. */}
      {destinoValido && options.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          {options.map((option) => {
            const isSelected = selectedOption?.id === option.id;
            const priceToDisplay = isFree ? 0 : option.price;

            return (
              <button
                key={option.id}
                type="button"
                // Laudo de acessibilidade 05/09, A1 (ALTA): a escolha é
                // anunciada por `aria-pressed`.
                aria-pressed={isSelected}
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

      {/* Exibição honesta (onda D-1): sem opção de entrega E sem grátis da
          loja, o estado é "A calcular" — nunca silêncio nem preço inventado. */}
      {destinoValido &&
        !isFree &&
        cotouSemOpcoes &&
        !loading &&
        !error &&
        options.length === 0 && (
          <div className="flex items-start gap-1.5 rounded-2xl border border-zinc-100 bg-white p-2.5 text-[11px] font-medium text-zinc-500">
            <Truck className="mt-0.5 size-3.5 shrink-0 text-zinc-400" />
            <span>
              A calcular: nenhuma opção de entrega para este endereço — combine
              a entrega com a loja.
            </span>
          </div>
        )}
    </section>
  );
}
