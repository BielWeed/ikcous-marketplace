import { useCartState } from "@/contexts/CartContext";
import { useContextoDoFreteDaLoja } from "@/contexts/ContextoDoFreteDaLoja";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  type OrigemDaEscolhaDoFrete,
  resolverEscolhaDoFrete,
} from "@/lib/auto-selecao-de-frete";
import { destaquesDoFrete } from "@/lib/destaques-do-frete";
import { ehRetiradaNaLoja } from "@/lib/guarda-de-frete";
import {
  codigoDoErroDeEdgeFunction,
  mensagemAmigavelErroEdgeFunction,
} from "@/lib/mensagens-erro";
import { buscarRevisaoConfigFrete } from "@/lib/revisao-do-frete";
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
  Store,
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

/**
 * CACHE V2 (release 1.5.3 — retirada na loja). O PWA atualiza por "prompt":
 * a 1.5.2 segue aberta ao lado da 1.5.3, no MESMO localStorage. A 1.5.2 lê
 * `ikcous_shipping_cache_<CEP>` e auto-seleciona a opção mais barata — se a
 * 1.5.3 gravasse ali uma lista com a retirada (R$ 0), a 1.5.2 escolheria a
 * retirada sem chamar a edge. Por isso a 1.5.3 lê e grava SÓ nesta chave
 * (que a 1.5.2 nunca lê) e nunca toca a antiga. O prefixo é o mesmo de
 * sempre: o logout (`AuthContext.tsx`) limpa as duas pela varredura por
 * `ikcous_shipping_cache_`.
 */
export function chaveDoCacheDeFrete(cepSoDigitos: string): string {
  return `ikcous_shipping_cache_v2_${cepSoDigitos}`;
}

interface EnvelopeDeCacheDeFrete {
  /**
   * `contextoDaLojaParaFrete` (src/contexts/ContextoDoFreteDaLoja.ts) da loja
   * quando a cotação saiu.
   */
  contexto: string;
  /** Assinatura do carrinho que gerou esta cotação (mesmo formato de `cartSignature`). */
  assinatura: string;
  /** `Date.now()` de quando a cotação foi gravada. */
  gravadoEm: number;
  opcoes: ShippingOption[];
  /**
   * R1-2 (release 1.5.7): a revisão da configuração de frete sob a qual
   * ESTA cotação foi feita — vem de `data.revisaoConfig` na resposta da
   * edge. `null`/ausente (edge sem o campo, ou envelope de antes desta
   * release) trava a leitura em `cotacaoAindaBateComARevisao`: sem saber a
   * revisão de então, não dá para provar que ainda é a de agora.
   */
  revisaoConfig?: string | null;
}

/**
 * Decide se uma entrada do cache local pode virar preço na tela.
 *
 * A chave (`chaveDoCacheDeFrete`) diz só o CEP. Quem responde "de qual
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
  contextoAtual: string,
): ShippingOption[] | null {
  if (!bruto || typeof bruto !== "object") return null;

  const envelope = bruto as Partial<EnvelopeDeCacheDeFrete>;

  // Envelope sem contexto (formato anterior à 1.5.3) ou de outra config da
  // loja: não se sabe se a lista ainda é a que a edge daria agora — recota.
  if (
    typeof envelope.contexto !== "string" ||
    envelope.contexto !== contextoAtual
  ) {
    return null;
  }

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
 * A ÚLTIMA guarda antes de servir um acerto de cache (R1-2): mesmo com
 * contexto, assinatura e validade batendo, a lojista pode ter mudado a
 * configuração do frete (ligado/desligado provedor, trocado serviço,
 * mudado seguro) DEPOIS que esta cotação foi gravada — e o preço mudaria.
 * `revisaoAtual` vem de `buscarRevisaoConfigFrete()`, chamada fresca a cada
 * tentativa de servir cache; `revisaoDoCache` vem do envelope.
 *
 * Fail closed: só serve quando as DUAS são texto não vazio e IGUAIS. Se a
 * revisão atual não carregou (rede fora do ar, edge sem o campo ainda) ou o
 * envelope é de antes desta guarda existir, a resposta é `false` — recotar
 * custa uma chamada a mais; servir errado custa cobrar frete que a lojista
 * já mudou.
 */
export function cotacaoAindaBateComARevisao(
  revisaoDoCache: unknown,
  revisaoAtual: string | null,
): boolean {
  return (
    typeof revisaoAtual === "string" &&
    revisaoAtual.length > 0 &&
    typeof revisaoDoCache === "string" &&
    revisaoDoCache === revisaoAtual
  );
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
  /**
   * `selectedOption` foi um TOQUE da cliente (`true`) ou a regra da casa
   * que escolheu sozinha (`false`)? Vive no CartContext ao lado da opção —
   * sobrevive à remontagem (carrinho → checkout → volta). Só a escolha da
   * cliente é preservada numa cotação nova; a automática é refeita contra
   * a lista de agora (a mais barata). Sem a prop, vale só o que foi tocado
   * NESTA montagem.
   */
  selecaoEscolhidaPelaCliente?: boolean;
  /** `origem` diz quem escolheu — o pai guarda junto com a opção. */
  onSelectOption: (
    option: ShippingOption | null,
    origem?: OrigemDaEscolhaDoFrete,
  ) => void;
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
  /**
   * R1-2/R2-8: incrementar este número força uma recotação de REDE do
   * destino atual, ignorando o cache do navegador — o checkout usa isto
   * quando descobre, antes de criar o pedido, que a configuração de frete
   * mudou desde que a opção escolhida foi cotada. `undefined` (padrão) ou
   * valor repetido não fazem nada.
   */
  forcarNovaCotacaoEm?: number;
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
  selecaoEscolhidaPelaCliente,
  onSelectOption,
  onCepValidated,
  cepDestino,
  cepDaSelecao,
  destino,
  acaoDoEndereco,
  mensagemSemDestino = "Cadastre um endereço de entrega para ver o frete e o prazo.",
  onStatusChange,
  freteGratis: isFree,
  forcarNovaCotacaoEm,
}: PropsComFreteGratis) {
  const isOffline = useOnlineStatus();
  // Contexto da loja da cotação (cache v2). Fora do StoreProvider (peça
  // montada sozinha) vale o contexto "sem config" — estável, o cache segue
  // servindo.
  const contextoDaLoja = useContextoDoFreteDaLoja();
  const contextoDaLojaRef = useRef(contextoDaLoja);
  contextoDaLojaRef.current = contextoDaLoja;
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  // HONESTIDADE (onda D-1): guarda se a ÚLTIMA cotação concluída voltou sem
  // opção nenhuma (edge devolve `options: []` — loja sem transportadora
  // conectada, frente C). É o que permite mostrar o estado "A calcular" em
  // vez de silêncio.
  const [cotouSemOpcoes, setCotouSemOpcoes] = useState(false);
  // DESTAQUES (release 1.5.7): a lista nasce recolhida — só os destaques (e
  // a retirada/local, que seguem à parte) aparecem; "+ Ver outras opções"
  // revela o resto. Recolher de novo NÃO esconde a escolha atual (mais
  // abaixo, na hora de montar a lista): contrato §6, "recolher não troca a
  // escolha".
  const [outrasExpandidas, setOutrasExpandidas] = useState(false);

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
  // `resolverEscolhaDoFrete` — mesma modalidade na lista nova ⇒ objeto NOVO
  // (preço fresco); modalidade sumida ⇒ a mais barata; seleção nula ⇒ a mais
  // barata.
  const selecaoVivaRef = useRef(selectedOption);
  selecaoVivaRef.current = selectedOption;

  // QUEM ESCOLHEU a seleção viva (captura do dono, 23/09/2026). Com a prop
  // (CartContext), ela é a fonte — espelhada por render como a seleção. Sem
  // a prop, a memória é o id tocado NESTA montagem. Os dois refs são
  // gravados também no clique, síncronos: uma resposta que pousa antes do
  // re-render do pai já enxerga a escolha da cliente.
  const idTocadoNestaMontagemRef = useRef<string | null>(null);
  const escolhaDaClienteViaPropRef = useRef(selecaoEscolhidaPelaCliente);
  escolhaDaClienteViaPropRef.current = selecaoEscolhidaPelaCliente;
  const selecaoVivaEhDaCliente = (): boolean => {
    const viva = selecaoVivaRef.current;
    if (!viva) return false;
    return (
      escolhaDaClienteViaPropRef.current ??
      idTocadoNestaMontagemRef.current === viva.id
    );
  };

  // Aplica a escolha resolvida contra uma lista NOVA: a da cliente, se ela
  // ainda está na lista (objeto fresco); senão a mais barata, como escolha
  // automática. Lista sem nada auto-selecionável (só a retirada) derruba a
  // escolha anterior, que é preço de OUTRA cotação.
  const aplicarEscolhaContra = (lista: ShippingOption[]) => {
    const { opcao, origem } = resolverEscolhaDoFrete(
      selecaoVivaRef.current,
      lista,
      selecaoVivaEhDaCliente(),
    );
    if (origem === "automatica") idTocadoNestaMontagemRef.current = null;
    if (opcao) {
      onSelectOption(opcao, origem);
    } else if (selecaoVivaRef.current) {
      onSelectOption(null);
    }
  };

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
    setOutrasExpandidas(false);
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

    const cacheKey = chaveDoCacheDeFrete(cleanCep);
    // O contexto de QUANDO esta cotação saiu: é ele que vai no envelope. Se
    // o contexto mudar no meio, o efeito de contexto dispara outra cotação,
    // o lacre (`reqRef`) aposenta esta, e ela não grava nada.
    const contextoDaCotacao = contextoDaLojaRef.current;

    try {
      // 1. Cache local primeiro. Este acerto não só mostra o preço: ele já
      // SELECIONA a opção logo abaixo, e é ela que vai para o pedido. Por
      // isso a entrada precisa ser do carrinho de agora e estar dentro da
      // validade — ver `cotacaoCacheadaQueAindaServe`. A chave é o CEP (o
      // destino) e o envelope carrega a assinatura do carrinho (os itens).
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const envelopeCru = JSON.parse(cached) as unknown;
          const opcoesEmCache = cotacaoCacheadaQueAindaServe(
            envelopeCru,
            cartSignature,
            Date.now(),
            contextoDaCotacao,
          );
          if (opcoesEmCache) {
            // R1-2: contexto, assinatura e validade batem, mas isso não
            // basta mais — a lojista pode ter mudado a configuração do
            // frete DEPOIS que esta cotação foi gravada (até 2h atrás).
            // Confirma a revisão antes de confiar no preço. Sem rede
            // (offline), a confirmação não tem como acontecer: cai direto
            // para a cotação de rede abaixo, que vai mostrar o aviso de
            // conexão — em vez de arriscar um preço que a lojista já mudou.
            const revisaoDoCache = (
              envelopeCru as Partial<EnvelopeDeCacheDeFrete>
            ).revisaoConfig;
            const revisaoAtual = isOffline
              ? null
              : await buscarRevisaoConfigFrete();
            // Lacre: uma chamada mais nova pode ter começado durante o
            // `await` acima.
            if (meuId !== reqRef.current) return;
            if (cotacaoAindaBateComARevisao(revisaoDoCache, revisaoAtual)) {
              setOptions(opcoesEmCache);
              setCotouSemOpcoes(false);
              assinaturaCotadaRef.current = cartSignature;
              aplicarEscolhaContra(opcoesEmCache);
              onCepValidated?.(cepFormatado);
              setLoading(false);
              localStorage.setItem("ikcous_last_shipping_cep", cepFormatado);
              return;
            }
            // Revisão não confere (ou não deu para confirmar): o cache NÃO
            // serve — segue para a cotação de rede abaixo, como se este
            // acerto de cache nunca tivesse existido.
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
          // `aceitaRetirada`: o sinal de que ESTE app entende a retirada na
          // loja (nunca a auto-seleciona). Sem ele, a edge não a oferece — é
          // o que protege o app 1.5.2 ainda no ar.
          // `contratoCliente: 3` (release 1.5.7): o sinal de que este app
          // entende vários provedores ao mesmo tempo e prazo 0 canônico
          // ("no mesmo dia") — CONTRATO-1.5.7.md §2 e EMENDA R1-4.
          body: {
            cep: cleanCep,
            cart: cart,
            aceitaRetirada: true,
            contratoCliente: 3,
          },
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
        contexto: contextoDaCotacao,
        assinatura: cartSignature,
        gravadoEm: Date.now(),
        opcoes: calculatedOptions,
        // R1-2: a resposta traz a revisão sob a qual ELA foi calculada —
        // sem isto, a próxima leitura deste envelope nunca teria como
        // confirmar que a configuração continua a mesma.
        revisaoConfig:
          typeof data.revisaoConfig === "string" ? data.revisaoConfig : null,
      };
      localStorage.setItem(cacheKey, JSON.stringify(envelope));
      localStorage.setItem("ikcous_last_shipping_cep", cepFormatado);

      // Auto-select: MENOR PREÇO, não o primeiro da lista (laudo 31/08,
      // menor E). Escolha da CLIENTE com o mesmo id na resposta nova = a
      // mesma escolha, com o objeto FRESCO; escolha automática ou id sumido
      // = a mais barata DESTA lista. A entrada é a seleção VIVA — o clique
      // dado com a cotação em voo não é desfeito. RETIRADA NA LOJA (1.5.3):
      // lista só com a retirada derruba a escolha anterior (nunca é o app
      // quem escolhe a retirada).
      if (calculatedOptions.length > 0) {
        aplicarEscolhaContra(calculatedOptions);
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
    localStorage.removeItem(chaveDoCacheDeFrete(alvo));
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

  // O CONTEXTO DA LOJA mudou (provedor, transportadoras, retirada, endereço —
  // chegou o config real, ou a lojista salvou em outra aba): a lista na tela
  // pode não ser mais a que a edge daria. Recota o destino adotado — o cache
  // v2 recusa o envelope do contexto velho, e a resposta em voo do contexto
  // velho morre no lacre. A montagem não conta (quem cota nela é a adoção
  // do destino).
  const contextoVistoRef = useRef(contextoDaLoja);
  useEffect(() => {
    if (contextoVistoRef.current === contextoDaLoja) return;
    contextoVistoRef.current = contextoDaLoja;
    const alvo = cepAdotadoRef.current;
    if (!alvo || cart.length === 0) return;
    calculateShipping(alvo, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextoDaLoja]);

  // FORÇAR RECOTAÇÃO (R1-2/R2-8): o checkout, antes de criar o pedido,
  // descobre que a opção escolhida veio de uma cotação com revisão
  // diferente da atual e incrementa esta prop. Remove o cache do destino
  // adotado (senão a leitura de cache do PRÓXIMO `calculateShipping`
  // acharia a MESMA entrada desatualizada) e recota de rede — se o id
  // escolhido sumiu da lista nova, `resolverEscolhaDoFrete` já escolhe a
  // mais barata dela sozinho (só limpa de vez se a lista nova vier vazia).
  const forcarNovaCotacaoVistoRef = useRef(forcarNovaCotacaoEm);
  useEffect(() => {
    if (forcarNovaCotacaoEm === undefined) return;
    if (forcarNovaCotacaoVistoRef.current === forcarNovaCotacaoEm) return;
    forcarNovaCotacaoVistoRef.current = forcarNovaCotacaoEm;
    const alvo = cepAdotadoRef.current;
    if (!alvo || cart.length === 0) return;
    localStorage.removeItem(chaveDoCacheDeFrete(alvo));
    calculateShipping(alvo, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcarNovaCotacaoEm]);

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

  // DESTAQUES (release 1.5.7 — CONTRATO-1.5.7.md §6, R1-7, R2-4): a
  // retirada nunca disputa destaque (ela é modalidade da loja, aparece à
  // parte, como sempre); a entrega local participa do ranking igual a
  // qualquer transportadora.
  const opcaoDeRetirada = options.find((o) => ehRetiradaNaLoja(o.id)) ?? null;
  const destaques = destaquesDoFrete(options);
  const cartoesDeDestaque = [
    ...(destaques.maisBarata ? [destaques.maisBarata] : []),
    ...(!destaques.mesmaOferta && destaques.maisRapida
      ? [destaques.maisRapida]
      : []),
  ];
  // Recolhida, a lista de "outras" some — MENOS a opção que a cliente já
  // escolheu: recolher não pode tirar a escolha da vista nem trocá-la
  // (contrato §6).
  const outrasVisiveis = outrasExpandidas
    ? destaques.outras
    : destaques.outras.filter((o) => o.id === selectedOption?.id);

  function selosDoCartao(id: string): string[] {
    const selos: string[] = [];
    if (destaques.maisBarata?.id === id) selos.push("Mais barata");
    if (destaques.maisRapida?.id === id) selos.push("Mais rápida");
    return selos;
  }

  function renderizarCartaoDeOpcao(option: ShippingOption) {
    const isSelected = selectedOption?.id === option.id;
    const priceToDisplay = isFree ? 0 : option.price;
    // RETIRADA NA LOJA (release 1.5.3): sem prazo de entrega (não
    // há entrega) e sem "pronto agora" — o endereço REAL da loja
    // que a edge mandou e o aviso neutro de esperar a loja.
    const retirada = ehRetiradaNaLoja(option.id);
    const selos = retirada ? [] : selosDoCartao(option.id);

    return (
      <button
        key={option.id}
        type="button"
        // Laudo de acessibilidade 05/09, A1 (ALTA): a escolha é
        // anunciada por `aria-pressed`.
        aria-pressed={isSelected}
        onClick={() => {
          haptic.light();
          selecaoVivaRef.current = option;
          idTocadoNestaMontagemRef.current = option.id;
          escolhaDaClienteViaPropRef.current =
            escolhaDaClienteViaPropRef.current === undefined ? undefined : true;
          onSelectOption(option, "cliente");
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
            ) : retirada ? (
              <Store className="size-4" />
            ) : (
              <Truck className="size-4" />
            )}
          </div>
          <div>
            {selos.length > 0 && (
              <div className="mb-0.5 flex flex-wrap gap-1">
                {selos.map((selo) => (
                  <span
                    key={selo}
                    className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {selo}
                  </span>
                ))}
              </div>
            )}
            <span className="block text-[11px] font-bold leading-snug">
              {option.name}
            </span>
            {/* R1-7: a linha "Transportadora — Serviço · via Provedor"
                aparece SEMPRE que houver transportadora — nacional, nunca
                local/retirada/grátis. */}
            {!retirada && option.transportadora && (
              <span
                className={`mt-0.5 block text-[9px] leading-snug ${
                  isSelected ? "text-zinc-200" : "text-zinc-500"
                }`}
              >
                {option.transportadora}
                {option.servico ? ` — ${option.servico}` : ""}
                {option.provedorRotulo ? ` · via ${option.provedorRotulo}` : ""}
              </span>
            )}
            {retirada ? (
              <>
                {option.pickupAddress && (
                  <span
                    className={`mt-0.5 block text-[10px] leading-snug ${
                      isSelected ? "text-zinc-200" : "text-zinc-500"
                    }`}
                  >
                    Retire em: {option.pickupAddress}
                  </span>
                )}
                <span
                  className={`mt-0.5 block text-[9px] leading-snug ${
                    isSelected ? "text-zinc-300" : "text-zinc-400"
                  }`}
                >
                  Aguarde a confirmação da loja para retirar
                </span>
              </>
            ) : (
              <span
                className={`mt-0.5 block text-[9px] leading-none ${
                  isSelected ? "text-zinc-300" : "text-zinc-400"
                }`}
              >
                {/* Prazo 0 (release 1.5.7, EMENDA R1-4): "no mesmo dia" —
                    nunca "até 0 dia útil", um prazo que não existe. */}
                {option.deliveryDays === 0
                  ? "Entrega no mesmo dia"
                  : `Entrega em até ${option.deliveryDays} ${
                      option.deliveryDays > 1 ? "dias úteis" : "dia útil"
                    }`}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-center text-right">
          {retirada ? (
            <span className="text-xs font-black uppercase tracking-wider text-emerald-500">
              Grátis
            </span>
          ) : isFree ? (
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
  }

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
          {opcaoDeRetirada && renderizarCartaoDeOpcao(opcaoDeRetirada)}
          {cartoesDeDestaque.map(renderizarCartaoDeOpcao)}
          {outrasVisiveis.map(renderizarCartaoDeOpcao)}
          {/* "+ Ver outras opções" — discreto de propósito (o pedido do
              dono): não compete visualmente com os cartões de destaque.
              Só aparece quando existe algo além dos destaques/retirada.
              Recolher não troca a escolha (a opção escolhida continua
              visível em `outrasVisiveis` mesmo fechada). */}
          {destaques.outras.length > 0 && (
            <button
              type="button"
              onClick={() => setOutrasExpandidas((v) => !v)}
              className="w-full select-none py-1 text-center text-[10px] font-semibold text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline"
            >
              {outrasExpandidas
                ? "Ver menos opções"
                : `+ Ver outras opções (${destaques.outras.length})`}
            </button>
          )}
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
