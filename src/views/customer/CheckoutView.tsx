import {
  type CategoriaErroPagamento,
  PagamentoOnline,
} from "@/components/checkout/PagamentoOnline";
import { Button } from "@/components/ui/button";
import { AddressForm } from "@/components/ui/custom/AddressForm";
import { AddressList } from "@/components/ui/custom/AddressList";
import { CouponInput } from "@/components/ui/custom/CouponInput";
import { SaidaDaRecusa } from "@/components/ui/custom/SaidaDaRecusa";
import { useStore } from "@/contexts/StoreContext";
import { useAddresses } from "@/hooks/useAddresses";
import { useAuth } from "@/hooks/useAuth";
import { formatarCep, useBuscaCep } from "@/hooks/useBuscaCep";
import { useCart } from "@/hooks/useCart";
import { useCoupons } from "@/hooks/useCoupons";
import { useDeferredRender } from "@/hooks/useDeferredRender";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemAmigavelErroPedido, useOrders } from "@/hooks/useOrders";
import { cepEhLocal } from "@/lib/cep-local";
import {
  criarGerenciadorDeChave,
  impressaoDaCompra,
} from "@/lib/chave-do-pedido";
import { PAGAMENTO_ONLINE_LIGADO } from "@/lib/flags";
import { finalizarBloqueadoPorFrete } from "@/lib/guarda-de-frete";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { precoVendido } from "@/lib/preco-vendido";
import {
  lerRascunhoDoCheckout,
  limparRascunhoDoCheckout,
  rascunhoTemConteudo,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";
import { cotacaoValeParaDestino, soDigitos } from "@/lib/reconciliacao-de-cep";
import {
  type AcaoDeRecusa,
  type RecusaDoPedido,
  classificarRecusaDoPedido,
} from "@/lib/recusaDoPedido";
import { supabase } from "@/lib/supabase";
import { criarTravaDeEnvio } from "@/lib/travaDeEnvio";
import { cn } from "@/lib/utils";
import type { Address, CartItem, Customer, PaymentMethod, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { zodResolver } from "@hookform/resolvers/zod";
import confetti from "canvas-confetti";
import { AnimatePresence, motion, usePresence } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Check,
  ChevronDown,
  CreditCard,
  FileText,
  Loader2,
  Lock,
  MapPin,
  Phone,
  Plus,
  Smartphone,
  Sparkles,
  Tag,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

// Intervalo da verificação periódica da tela do PIX (ver o useEffect de
// polling, no corpo do componente) — extraído para constante porque o teto
// de segurança abaixo é derivado DELE (contagem de ticks, não de relógio).
const INTERVALO_VERIFICACAO_PAGAMENTO_MS = 10_000;

// Teto de segurança da verificação periódica da tela do PIX. NÃO é o
// critério normal de parada — esse é o `payment_status` terminal do pedido
// (ver `verificarPagamento`, no useEffect). Isto é só para não consultar
// para sempre um pedido que ninguém vai pagar depois que a reserva expira.
//
// De onde vem o número: a varredura do prazo roda a cada 5 minutos
// (`supabase/migrations/20260807000001_agenda_expiracao.sql:12`,
// `*/5 * * * *`) e o webhook do Mercado Pago levou ~90s no incidente real
// de 16/08/2026 que motivou a correção original (CHECKOUT-090) — 60 min de
// vida (a partir de quando esta tela monta, perto de quando expires_at é
// carimbado) dão folga generosa sobre esse pior caso medido. NÃO reduza
// este número sem entender por que ele existe.
//
// Por que é CONTAGEM DE TICKS, e não relógio (2ª correção, achado
// BLOQUEANTE da revisão de 16/08/2026 — a MESMA classe de defeito
// reaparecendo por outra porta): a 1ª correção trocou "prazo vencido"
// (`expires_at <= Date.now()`) por "estado terminal", mas manteve um teto
// de segurança que comparava `Date.now()` do NAVEGADOR do cliente com
// `expires_at`, um instante gravado pelo SERVIDOR. Num aparelho com o
// relógio adiantado em δ, a parada acontece em `expires_at + 30min − δ` —
// com δ maior que ~28 min (nada incomum: fuso mal configurado, relógio de
// hardware sem NTP), o polling morre ANTES do webhook conseguir gravar, e o
// cliente que pagou fica preso na tela do QR. Contar TICKS do próprio
// `setInterval` mede o mesmo relógio nas DUAS pontas — não há nada do
// servidor para comparar, então não há divergência de relógio para
// explorar. `expires_at` continua sendo lido na consulta (é o único caminho
// até `pago_apos_expirar`), só deixou de decidir quando parar.
const TETO_TICKS_VERIFICACAO_PAGAMENTO =
  (60 * 60 * 1000) / INTERVALO_VERIFICACAO_PAGAMENTO_MS; // 60 min / 10s = 360 ticks

interface CheckoutFormValues {
  name: string;
  whatsapp: string;
  cep?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  complement?: string;
}

// Ordem de tabulação do formulário. Usada para levar o foco ao PRIMEIRO campo
// com erro quando o pedido é recusado por preenchimento (laudo de
// acessibilidade 03/09, achado 1): o leitor de tela cai no campo já marcado
// com `aria-invalid` e anuncia a mensagem ligada por `aria-describedby`.
// `satisfies` quebra a compilação se um campo renomear e a lista envelhecer.
const ORDEM_CAMPOS_FOCO = [
  "name",
  "whatsapp",
  "cep",
  "number",
  "street",
  "neighborhood",
  "city",
  "state",
] as const satisfies readonly (keyof CheckoutFormValues)[];

/**
 * Decide QUAL saída a tela oferece para a recusa que o banco deu no último
 * clique.
 *
 * É uma função pura exportada de propósito: montar a `CheckoutView` inteira num
 * teste arrasta `useAuth`, `useOrders`, `useCoupons`, confetti e Supabase, e
 * nada disso participa desta decisão. O teste que prende as onze recusas
 * (`tests/front/checkout-oferece-saida-na-recusa.test.tsx`) exercita esta função,
 * não a view.
 *
 * Hoje ela apenas delega — o valor de existir é o ponto de costura ficar
 * nomeado e testável. Se um dia a tela precisar de uma regra que só ela conhece
 * (por exemplo: sem cupom aplicado, `remover_cupom` não faz sentido), é aqui que
 * ela entra, e o teste já está montado.
 */
export const decidirSaidaDoCheckout = (error: unknown): RecusaDoPedido =>
  classificarRecusaDoPedido(error);

/**
 * Para ONDE cada ação leva. Tabela, e não cadeia de `if`, pelo mesmo motivo do
 * `ROTULO_DA_ACAO` no componente: `Record<AcaoDeRecusa, …>` **para de compilar**
 * no dia em que `AcaoDeRecusa` ganhar um caso novo, em vez de deixá-lo cair num
 * `default` silencioso — que é o beco que este trabalho inteiro existe para
 * fechar.
 *
 * Seis das dez levam ao CARRINHO porque é lá que o problema se resolve de fato:
 * quantidade, variação, item indisponível e a cotação do frete são todos
 * editáveis lá, e nenhum deles é editável na tela do checkout.
 */
type DestinoDaRecusa =
  | "carrinho"
  | "cupom"
  | "endereco"
  | "pedidos"
  | "so_fechar";

const DESTINO_DA_ACAO: Record<AcaoDeRecusa, DestinoDaRecusa> = {
  reconferir_carrinho: "carrinho",
  recotar_frete: "carrinho",
  ajustar_estoque: "carrinho",
  remover_item: "carrinho",
  escolher_variacao: "carrinho",
  trocar_entrega: "carrinho",
  remover_cupom: "cupom",
  trocar_endereco: "endereco",
  conferir_antes: "pedidos",
  // 🔴 `tentar_de_novo` NÃO reenvia sozinho. O botão "Finalizar Pedido"
  // continua na tela e é a pessoa que decide apertá-lo de novo. Reenviar por
  // conta própria transformaria um clique em dois pedidos no dia em que a
  // classificação errasse — exatamente o estrago que este trabalho evita.
  tentar_de_novo: "so_fechar",
};

/**
 * O mesmo conteúdo como `Map`, gerado a partir do `Record` acima — mesma fonte,
 * não uma segunda. O `eslint-plugin-security` não distingue um `Record`
 * exaustivo de um dicionário arbitrário e acusa `detect-object-injection` em
 * toda indexação dinâmica; `Map.get` não é indexação para ele. Mesmo padrão de
 * `OrderStatusBadge.tsx` e `SaidaDaRecusa.tsx`.
 */
const DESTINO_POR_ACAO = new Map(
  Object.entries(DESTINO_DA_ACAO) as [AcaoDeRecusa, DestinoDaRecusa][],
);

interface CheckoutViewProps {
  readonly cart?: CartItem[];
  readonly subtotal?: number;
  readonly shipping?: number;
  readonly total?: number;
  readonly onClearCart?: () => void;
  readonly onNavigate: (view: View, productId?: string) => void;
  readonly onSetBackOverride: (override: (() => void) | null) => void;
}

export function CheckoutView({
  cart: propCart,
  subtotal: propSubtotal,
  shipping: propShipping,
  total: propTotal,
  onClearCart: propOnClearCart,
  onNavigate,
  onSetBackOverride,
}: CheckoutViewProps) {
  const { config, isLoaded: storeConfigLoaded } = useStore();
  const [isPresent] = usePresence();
  const isReady = useDeferredRender(380);
  const {
    cart: ctxCart,
    cartTotal: ctxSubtotal,
    shippingFee: ctxShipping,
    clearCart: ctxClearCart,
    addToCart,
    selectedShippingOption,
    shippingCep,
    setSelectedShippingOption,
    setShippingCep,
    freteIndefinido: ctxFreteIndefinido,
  } = useCart();

  const cart = propCart ?? ctxCart;
  const subtotal = propSubtotal ?? ctxSubtotal;
  const shipping = propShipping ?? ctxShipping;
  // Laudo 31/08 (nota 3 da revisão do PR #367): com frete indefinido o
  // fallback R$ 15 não é preço — o total exibido não o soma (o carrinho
  // diz "A calcular"; nenhum pedido nasce nesse estado, o Finalizar
  // está travado).
  const total =
    propTotal ?? ctxSubtotal + (ctxFreteIndefinido ? 0 : ctxShipping);
  const onClearCart = propOnClearCart ?? ctxClearCart;
  // CHECKOUT-090: realtime ligado (antes `useOrders(false, true)` desligava
  // o efeito inteiro na primeira linha de useOrders.ts — nenhuma assinatura
  // era criada, e a tela do PIX nunca soube que o pedido tinha sido pago) e
  // `isAdmin` corrigido para `false` — esta é a tela do CLIENTE, e o valor
  // antigo (`true`) só era inofensivo porque `enabled=false` desligava tudo
  // antes de chegar a importar. `createOrder` não lê `isAdmin` em nenhum
  // ramo (useOrders.ts); `updateOrderStatus` passa a validar de verdade
  // (só cancela pedido `pending`), mas o único uso daqui
  // (handleCancelarPedidoESairDoPagamento) já embrulha a chamada num
  // try/catch que relê o pedido depois — uma recusa cliente-side cai no
  // mesmo caminho que uma recusa da RPC.
  //
  // `onRealtimeEvent` recebe o payload CRU do Postgres (não o `Order`
  // mapeado) — é o único lugar que carrega `payment_status`: o
  // `handleRealtimeUpdate` interno de useOrders.ts só copia `status` e
  // `trackingCode` para o array `orders`, nunca `payment_status`. Fecha
  // sobre `orderId`/`setStatusPagamentoPix`, declarados mais abaixo no
  // corpo do componente — seguro porque este callback só é INVOCADO de
  // forma assíncrona, depois que o componente já terminou de renderizar (e
  // as duas ligações já existem), nunca durante a construção da função.
  const { createOrder, updateOrderStatus } = useOrders(true, false, {
    onRealtimeEvent: (payload: any) => {
      if (payload?.eventType !== "UPDATE") return;
      const pedidoAtualizado = payload.new;
      if (!pedidoAtualizado || pedidoAtualizado.id !== orderId) return;
      if (pedidoAtualizado.payment_status === "pago") {
        setStatusPagamentoPix("confirmado");
      } else if (pedidoAtualizado.payment_status === "pago_apos_expirar") {
        setStatusPagamentoPix("fora-do-prazo");
      }
    },
  });
  const { validateCoupon } = useCoupons();
  const { user, profile, loading: authLoading } = useAuth();
  // CHECKOUT-070 (#197): sinal de rede para o cancelamento do pagamento
  // falho — mesmo hook já usado por ShippingCalculator, sem mecanismo novo.
  const isOffline = useOnlineStatus();
  const {
    addresses,
    fetchAddresses,
    addAddress,
    updateAddress,
    loading: addressesLoading,
  } = useAddresses();

  const formatWhatsApp = (value: string) => {
    const numbers = value.replaceAll(/\D/g, "");

    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 7)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 11)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
  };

  const getDefaultWhatsApp = () => {
    const whatsapp = profile?.whatsapp || user?.user_metadata?.whatsapp;
    return whatsapp ? formatWhatsApp(whatsapp) : "";
  };

  const dynamicSchema = useMemo(() => {
    return z
      .object({
        name: z.string().min(1, "Nome é obrigatório"),
        whatsapp: z.string().min(14, "WhatsApp inválido"),
        cep: z.string().optional(),
        street: z.string().optional(),
        number: z.string().optional(),
        neighborhood: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        complement: z.string().optional(),
      })
      .superRefine((data, ctx) => {
        if (!user) {
          // 8 DÍGITOS, não 8 caracteres: "1234-678" tem 8 caracteres e 7
          // dígitos — passava na régua antiga e virava endereço não
          // entregável no pedido (laudo caça-bugs 30/08, achado 11).
          if (!data.cep || data.cep.replace(/\D/g, "").length !== 8) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "CEP inválido",
              path: ["cep"],
            });
          }
          if (!data.street || data.street.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Rua é obrigatória",
              path: ["street"],
            });
          }
          if (!data.number || data.number.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Número é obrigatório",
              path: ["number"],
            });
          }
          if (!data.neighborhood || data.neighborhood.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Bairro é obrigatório",
              path: ["neighborhood"],
            });
          }
          if (!data.city || data.city.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Cidade é obrigatória",
              path: ["city"],
            });
          }
          if (!data.state || data.state.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Estado inválido",
              path: ["state"],
            });
          }
        }
      });
  }, [user]);

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(dynamicSchema),
    defaultValues: {
      name: profile?.full_name || user?.user_metadata?.name || "",
      whatsapp: getDefaultWhatsApp(),
      cep: localStorage.getItem("ikcous_last_shipping_cep") || "",
      city: "",
      state: "",
    },
    mode: "onChange",
  });

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (storeConfigLoaded && !hasInitializedRef.current) {
      // O RASCUNHO É LIDO ANTES DE QUALQUER form.reset E ANTES DE ABRIR A
      // TRAVA (corrida achada pela revisão do PR #374): `form.reset` emite
      // SINCRONAMENTE para a assinatura do `form.watch`, e o callback grava
      // rascunho — com a trava já aberta, o reset de defaults gravava um
      // rascunho só-de-CEP POR CIMA do rascunho cheio antes da leitura
      // (acontece quando a view monta antes da config da loja chegar — F5
      // com IndexedDB lento). Lendo primeiro na memória, qualquer gravação
      // transitória dos resets é substituída, logo depois, pela gravação dos
      // valores restaurados.
      const rascunho = lerRascunhoDoCheckout(globalThis.sessionStorage);
      hasInitializedRef.current = true;
      if (!form.formState.isDirty) {
        // Cidade e estado nascem vazios em QUALQUER cobertura de entrega —
        // a cobertura decide para onde a loja entrega, nunca onde o cliente
        // mora. O ternário de `isNational` que existia aqui preenchia os
        // dois com "Monte Carmelo"/"MG" na cobertura local.
        form.reset({
          name: profile?.full_name || user?.user_metadata?.name || "",
          whatsapp: getDefaultWhatsApp(),
          cep: localStorage.getItem("ikcous_last_shipping_cep") || "",
          city: "",
          state: "",
        });

        // RASCUNHO DA SESSÃO (laudo ofensiva 3108, N7): o que a pessoa já
        // digitou num checkout desta sessão volta POR CIMA do reset — voltar
        // ao carrinho para conferir qualquer coisa não custa mais redigitar
        // o formulário inteiro e perder o cupom. O cupom volta só o CÓDIGO,
        // revalidado contra o subtotal atual no efeito logo abaixo; o que
        // deixou de valer não volta mentindo.
        if (rascunho && rascunhoTemConteudo(rascunho)) {
          form.reset({
            name:
              rascunho.nome ||
              profile?.full_name ||
              user?.user_metadata?.name ||
              "",
            whatsapp: rascunho.whatsapp || getDefaultWhatsApp(),
            cep:
              rascunho.cep ||
              localStorage.getItem("ikcous_last_shipping_cep") ||
              "",
            street: rascunho.rua,
            number: rascunho.numero,
            neighborhood: rascunho.bairro,
            city: rascunho.cidade,
            state: rascunho.estado,
            complement: rascunho.complemento,
          });
          setNotes(rascunho.notas);
          // O dono dos campos de endereço passa a ser o CEP do rascunho —
          // mesmo contrato da semente de `ikcous_last_shipping_cep` acima.
          if (rascunho.cep) {
            cepAssociadoRef.current = formatarCep(rascunho.cep).limpo;
          }
          // O cupom volta SÓ o código: o efeito de revalidação do E1
          // (logo acima, [codigoDoCupom, subtotal]) decide em seguida —
          // válido atualiza o desconto; inválido sai com o motivo na tela.
          if (rascunho.cupom) {
            setAppliedCoupon({ code: rascunho.cupom, discount: 0 });
          }
        }
      }
    }
  }, [storeConfigLoaded, profile, user]);

  // A quem os campos de endereço ATUALMENTE pertencem: o último CEP cuja
  // busca foi aplicada. `null` só quando o campo nasce vazio — aí não existe
  // outro CEP "dono" do que a pessoa já digitou à mão, e um campo que o
  // ViaCEP não determina fica como está. Mesmo desenho de AddressForm.tsx
  // (linhas 81-83), e pela mesma razão: `cep` aqui NASCE preenchido de
  // `ikcous_last_shipping_cep` (visita anterior), e um campo pré-preenchido
  // nunca dispara `onChange` — sem esta semente, `cepAssociadoRef` ficava
  // `null` para sempre nesse caminho, `eraDeOutroCep` nunca era `true`, e a
  // rua completada à mão para o CEP antigo sobrevivia misturada com a
  // cidade/estado de um CEP novo digitado por cima (achado da revisão de
  // 25/08/2026).
  const cepAssociadoRef = useRef<string | null>(
    (() => {
      const cepDaVisitaAnterior = localStorage.getItem(
        "ikcous_last_shipping_cep",
      );
      return cepDaVisitaAnterior
        ? formatarCep(cepDaVisitaAnterior).limpo
        : null;
    })(),
  );
  // CEP da busca em voo, gravado pelo `onChange` do campo ANTES de chamar
  // `buscarCep` — ver o comentário equivalente em AddressForm.tsx.
  const cepEmBuscaRef = useRef<string>("");

  // Busca de CEP do checkout de convidado — mesma implementação do
  // AddressForm, atrás de useBuscaCep (#184 corrida, #185 timeout, #186
  // abort no desmonte). Campo que o ViaCEP não devolveu (CEP de localidade
  // única) só é limpo se pertencia a um CEP DIFERENTE do que acabou de
  // responder — ver AddressForm.tsx para o mecanismo completo.
  const { buscando: isSearchingCep, buscar: buscarCep } = useBuscaCep(
    (endereco) => {
      const cepDaResposta = cepEmBuscaRef.current;
      const eraDeOutroCep =
        cepAssociadoRef.current !== null &&
        cepAssociadoRef.current !== cepDaResposta;

      if (endereco.logradouro) {
        form.setValue("street", endereco.logradouro, {
          shouldValidate: true,
        });
      } else if (eraDeOutroCep) {
        form.setValue("street", "", { shouldValidate: true });
      }
      if (endereco.bairro) {
        form.setValue("neighborhood", endereco.bairro, {
          shouldValidate: true,
        });
      } else if (eraDeOutroCep) {
        form.setValue("neighborhood", "", { shouldValidate: true });
      }
      if (endereco.localidade)
        form.setValue("city", endereco.localidade, {
          shouldValidate: true,
        });
      if (endereco.uf)
        form.setValue("state", endereco.uf, { shouldValidate: true });

      cepAssociadoRef.current = cepDaResposta;
    },
  );

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A recusa que o banco deu no último clique, quando deu. `null` é o estado
  // normal — o painel só existe depois de uma recusa e some assim que a pessoa
  // age ou fecha.
  const [recusaDoUltimoClique, setRecusaDoUltimoClique] =
    useState<RecusaDoPedido | null>(null);
  /** Ver `criarTravaDeEnvio`: fecha o botao no tique do clique (#27). */
  const travaDeEnvioRef = useRef(criarTravaDeEnvio());
  // A CHAVE DA COMPRA (laudo 31/08, A1 — metade cliente da idempotência do
  // pedido; a metade servidor é a migration 20261038000000). Gera um uuid
  // POR COMPRA — impressão digital de itens+frete+cupom+total+CEP — repete
  // a chave na retentativa (rede caiu DEPOIS do commit: o segundo clique
  // legítimo recebe o pedido que JÁ nasceu, não um gêmeo) e esquece no
  // sucesso. Morando em sessionStorage, sobrevive ao recarregar da página
  // e morre ao fechar a aba; impressão nova (compra diferente) gira outra.
  const gerenteDaChaveRef = useRef<ReturnType<
    typeof criarGerenciadorDeChave
  > | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [orderId, setOrderId] = useState("");
  // O prazo NÃO é estado daqui — chega do banco pela resposta da edge
  // function, dentro do PagamentoOnline (ver comentário lá).
  const [aguardandoPagamento, setAguardandoPagamento] = useState(false);
  // CHECKOUT-090: estado de três valores, não dois booleanos independentes
  // — dois booleanos podem divergir (os dois `true` ao mesmo tempo, ou os
  // dois `false` quando um dos dois status chegou), e essa divergência é
  // exatamente o defeito que esta tarefa existe para impedir. `null` é o
  // QR ainda valendo; os outros dois são finais, sem caminho de volta a
  // `null` nem um para o outro.
  //
  // 'confirmado' é o `payment_status === 'pago'` de sempre.
  //
  // 'fora-do-prazo' é `payment_status === 'pago_apos_expirar'`. Achado 1 da
  // revisão (16/08/2026): esse status NÃO é pagamento legítimo do ponto de
  // vista do pedido — é o que a varredura do prazo grava quando o
  // pagamento chega DEPOIS da reserva vencer, e nesse caminho o pedido já
  // foi marcado `status='cancelled'` e o estoque já foi devolvido ANTES
  // (supabase/migrations/20260807000000_reserva_com_expiracao.sql:113-116).
  // A spec do webhook confirma que esse status "não toca estoque nem
  // status" (docs/superpowers/specs/2026-08-07-fase-3-webhook-design.md:79)
  // e a decisão do Gabriel (mesma spec, linha 136, e reafirmada em
  // 16/08/2026 para o texto desta tela) é que ninguém automático reativa o
  // pedido: ele decide caso a caso, pelo painel, depois do push "Pagamento
  // fora do fluxo" que o webhook manda ao lojista. Mostrar "a loja já está
  // preparando seu pedido" aqui seria mentir sobre um pedido cancelado — a
  // tela própria deste estado (PagamentoForaDoPrazoView, abaixo) diz que o
  // dinheiro entrou, que o prazo venceu e que a loja entra em contato para
  // confirmar ou devolver o valor, sem prometer entrega.
  //
  // Confirmado por dois caminhos independentes — o evento de realtime
  // (onRealtimeEvent, acima) e a verificação periódica (useEffect abaixo,
  // rede de segurança contra WebSocket caído) — e nenhum dos dois estados
  // finais tem caminho de volta a `null`.
  const [statusPagamentoPix, setStatusPagamentoPix] = useState<
    "confirmado" | "fora-do-prazo" | null
  >(null);
  // CHECKOUT-050: falha da criação da cobrança precisa ficar NA TELA — um
  // toast (2500ms, sonner.tsx) some antes do cliente sair de olhar o botão
  // "Pagar", no rodapé, para o topo. `categoria` decide se existe "Tentar de
  // novo" (ver CategoriaErroPagamento em PagamentoOnline.tsx): nunca
  // reclassificada aqui por texto de mensagem, só repassada como o
  // PagamentoOnline mandou.
  const [erroPagamento, setErroPagamento] = useState<{
    mensagem: string;
    categoria: CategoriaErroPagamento;
  } | null>(null);
  // CHECKOUT-070 (#197): saída para pagamento falho. `isCancelandoPedido`
  // trava o botão contra clique repetido (cancelar duas vezes bateria na
  // guarda de status da RPC, mas evitar a segunda viagem de rede evita até
  // o erro). `erroCancelamento` é o mesmo padrão de `erroPagamento`: banner
  // fixo na tela, não toast — um toast (2500ms) some antes do cliente ler.
  const [isCancelandoPedido, setIsCancelandoPedido] = useState(false);
  const isCancelandoPedidoRef = useRef(false);
  const [erroCancelamento, setErroCancelamento] = useState<string | null>(null);
  // Congelado no momento do submit, como orderId — sem isso, o onClearCart()
  // duas linhas abaixo zera o carrinho, cartTotal/shippingFee caem para 0
  // (ou ficam negativos com cupom aplicado) e o Brick nasce cobrando um
  // valor que não bate com o total já gravado no pedido.
  const [valorDoPedido, setValorDoPedido] = useState(0);
  // Mesmo motivo do valorDoPedido: onClearCart() zera `cart` duas linhas
  // abaixo, e cancelar o pagamento precisa devolver estes itens depois. Um
  // ref (não estado) porque nada aqui precisa re-renderizar a tela.
  const itensDoPedidoParaRestaurarRef = useRef<CartItem[]>([]);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string>("");
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null,
  );
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const hasPushedAddressModalState = useRef(false);
  // Painel de resumo do pedido (aberto ao tocar no bloco do total, na barra
  // fixa do rodapé) — mesmo padrão do modal de endereço logo abaixo: um
  // estado de UI simples e um `history.pushState` próprio, para o voltar do
  // Android fechar o painel em vez de sair da tela de checkout.
  const [isSummaryPanelOpen, setIsSummaryPanelOpen] = useState(false);
  const hasPushedSummaryPanelState = useRef(false);

  // A COTAÇÃO DE FRETE VALE PARA UM DESTINO (laudo 31/08, item E —
  // reconciliação de CEP): o frete é cotado no CARRINHO (campo de CEP
  // próprio da ShippingCalculator) e a entrega é endereçada AQUI — campos
  // diferentes, e nada os amarrava: cotava no CEP A, entregava no B e
  // pagava o frete de A. A metade SERVIDOR da cura (20261039000000) recusa
  // o pedido divergente; aqui o cliente nem chega lá — mudou o destino,
  // a opção cai e o carrinho volta a "A calcular" para re-cotar no CEP
  // certo. Cotação ausente não decide (frete grátis/taxa fixa sem
  // cotação): o portão do SERVIDOR é quem policia esses caminhos.
  const cepDigitadoNoFormulario = form.watch("cep");
  const cepDeEntrega = user
    ? (addresses.find((a) => a.id === selectedAddressId)?.cep ?? null)
    : cepDigitadoNoFormulario || null;
  useEffect(() => {
    if (!shippingCep || !cepDeEntrega) return;
    // Ressalva R4 da revisão: CEP parcial é digitação em curso — decidir
    // com ele derrubaria uma opção válida no primeiro dígito de quem só
    // REDIGITA o mesmo CEP. A divergência só interessa com CEP completo;
    // a recusa fail-closed de um CEP incompleto é do SERVIDOR
    // (20261039000000), que chega no clique.
    if (soDigitos(cepDeEntrega).length < 8) return;
    if (!cotacaoValeParaDestino(shippingCep, cepDeEntrega)) {
      setSelectedShippingOption(null);
      setShippingCep(null);
    }
  }, [shippingCep, cepDeEntrega, setSelectedShippingOption, setShippingCep]);

  // O CUPOM VALE PARA O CARRINHO DE AGORA (laudo 31/08, menor E): o cupom
  // era conferido SÓ no momento de aplicar. O carrinho encolhia depois —
  // item removido, quantidade menor — e o desconto continuava o antigo: a
  // barra somava um total errado (podia até negativar) e quem impedia o
  // estrago era só a recusa do servidor no último clique. Agora toda
  // mudança de subtotal revalida: válido, o desconto se atualiza; inválido
  // (mínimo de compra deixou de ser batido, expirou), o cupom SAI com o
  // motivo na frente do cliente — sem chegar a recusar pedido. FALHA DE
  // REDE na revalidação mantém o cupom como está — o validateCoupon não
  // lança; ele devolve networkError (ressalva da revisão do PR #370), e o
  // desconto duvidoso continua coberto pela validação da criação. MORRE
  // ANTES DO PRIMEIRO RETURN (regra dos hooks — o eslint pegou a 1ª versão
  // deste efeito depois do return de carregamento).
  const codigoDoCupom = appliedCoupon?.code ?? null;
  useEffect(() => {
    if (!codigoDoCupom) return;
    let vivo = true;
    (async () => {
      try {
        const resultado = await validateCoupon(codigoDoCupom, subtotal);
        if (!vivo) return;
        if (resultado.networkError) return;
        if (resultado.valid) {
          setAppliedCoupon({
            code: codigoDoCupom,
            discount: resultado.discount,
          });
        } else {
          setAppliedCoupon(null);
          setCouponError(resultado.message || "Cupom inválido");
        }
      } catch {
        // Defesa: o validateCoupon não lança; se um dia lançar, mantém.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [codigoDoCupom, subtotal, validateCoupon, isOffline]);
  // `isOffline` nos deps é a pílula da re-revisão do PR #374 (ressalva 2):
  // em falha de REDE a revalidação mantém o cupom com desconto 0 e não
  // havia retry — com a conexão de volta o efeito roda de novo e o desconto
  // real chega (ou o motivo da recusa aparece na tela).

  // GRAVAÇÃO DO RASCUNHO (laudo ofensiva 3108, N7): cada mudança de campo,
  // de notas ou de cupom repõe o rascunho da sessão. Os espelhos em ref
  // existem porque a assinatura do `form.watch` fecha sobre valores do
  // momento da assinatura — estado dentro do callback sairia velho. O bloco
  // inteiro mora ANTES do primeiro return da tela (regra dos hooks — a
  // revisão do #370 já tinha pegado esta armadilha no efeito do cupom).
  //
  // DUAS TRAVAS contra o autossabotagem (o conserto apagar o que veio
  // consertar): (1) NÃO grava antes do init/restore ter acontecido
  // (`hasInitializedRef`) — a config da loja chega async, e um efeito de
  // gravação rodando antes do restore sobrescreveria o rascunho com um
  // vazio; (2) NÃO grava rascunho SEM CONTEÚDO — escrever vazio por cima de
  // rascunho com dados é perda silenciosa.
  const notasRef = useRef(notes);
  const cupomRef = useRef(appliedCoupon);
  useEffect(() => {
    notasRef.current = notes;
  }, [notes]);
  useEffect(() => {
    cupomRef.current = appliedCoupon;
  }, [appliedCoupon]);
  useEffect(() => {
    const gravarRascunho = (valores: {
      name?: string;
      whatsapp?: string;
      cep?: string;
      street?: string;
      number?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      complement?: string;
    }) => {
      if (!hasInitializedRef.current) return;
      const rascunho = {
        nome: valores.name ?? "",
        whatsapp: valores.whatsapp ?? "",
        cep: valores.cep ?? "",
        numero: valores.number ?? "",
        rua: valores.street ?? "",
        bairro: valores.neighborhood ?? "",
        cidade: valores.city ?? "",
        estado: valores.state ?? "",
        complemento: valores.complement ?? "",
        notas: notasRef.current,
        cupom: cupomRef.current?.code ?? null,
      };
      if (!rascunhoTemConteudo(rascunho)) return;
      salvarRascunhoDoCheckout(globalThis.sessionStorage, rascunho);
    };
    const subscription = form.watch((valores) =>
      gravarRascunho(valores as CheckoutFormValues),
    );
    return () => subscription.unsubscribe();
  }, [form]);
  // Notas e cupom não passam pelo form.watch (estado próprio) — gravação
  // própria, lendo o formulário atual via getValues. Mesmas duas travas.
  useEffect(() => {
    if (!hasInitializedRef.current) return;
    const rascunho = {
      nome: form.getValues("name") ?? "",
      whatsapp: form.getValues("whatsapp") ?? "",
      cep: form.getValues("cep") ?? "",
      numero: form.getValues("number") ?? "",
      rua: form.getValues("street") ?? "",
      bairro: form.getValues("neighborhood") ?? "",
      cidade: form.getValues("city") ?? "",
      estado: form.getValues("state") ?? "",
      complemento: form.getValues("complement") ?? "",
      notas: notes,
      cupom: appliedCoupon?.code ?? null,
    };
    if (!rascunhoTemConteudo(rascunho)) return;
    salvarRascunhoDoCheckout(globalThis.sessionStorage, rascunho);
  }, [notes, appliedCoupon, form]);
  // Achado 8 da revisão (17/08/2026): o painel precisa devolver o foco ao
  // botão que o abriu quando fecha (teclado) — `wasOpenRef` evita focar o
  // gatilho já na montagem (isSummaryPanelOpen começa `false`).
  const summaryPanelRef = useRef<HTMLDivElement>(null);
  const summaryPanelTriggerRef = useRef<HTMLButtonElement>(null);
  const summaryPanelWasOpenRef = useRef(false);

  // Solo-ninja: Reset scroll when internal views change (address form or success)
  useEffect(() => {
    if (isAddressModalOpen || showSuccess) {
      const mainContainer = document.querySelector("main");
      if (mainContainer) {
        mainContainer.scrollTop = 0;
      }
      globalThis.scrollTo(0, 0);
    }
  }, [isAddressModalOpen, showSuccess]);

  // Push virtual history state when modal opens to intercept browser back button
  useEffect(() => {
    if (isAddressModalOpen && !hasPushedAddressModalState.current) {
      console.log("[CheckoutView] Pushing virtual address state");
      globalThis.history.pushState(
        { modal: "address" },
        "",
        globalThis.location.pathname,
      );
      hasPushedAddressModalState.current = true;
    } else if (!isAddressModalOpen) {
      hasPushedAddressModalState.current = false;
    }
  }, [isAddressModalOpen]);

  // Mesmo mecanismo acima, para o painel de resumo do pedido — sem isto o
  // voltar do Android sairia da tela de checkout (apagando o que o cliente
  // já digitou) em vez de só fechar o painel.
  useEffect(() => {
    if (isSummaryPanelOpen && !hasPushedSummaryPanelState.current) {
      globalThis.history.pushState(
        { modal: "checkout-summary" },
        "",
        globalThis.location.pathname,
      );
      hasPushedSummaryPanelState.current = true;
    } else if (!isSummaryPanelOpen) {
      hasPushedSummaryPanelState.current = false;
    }
  }, [isSummaryPanelOpen]);

  // Handle back button override for address modal
  useEffect(() => {
    if (isAddressModalOpen) {
      onSetBackOverride(() => () => {
        setIsAddressModalOpen(false);
        setEditingAddressId(null);
      });
    } else if (isSummaryPanelOpen) {
      onSetBackOverride(() => () => setIsSummaryPanelOpen(false));
    } else if (showSuccess || aguardandoPagamento) {
      // Sucesso ou aguardando pagamento: o pedido já foi criado e o carrinho
      // já foi limpo — não existe formulário para o botão voltar recuperar.
      // Sem este ramo, o voltar do Android saía direto para o carrinho vazio,
      // sem aviso, com o pedido reservado e o prazo de 30 minutos correndo.
      onSetBackOverride(() => () => onNavigate("home"));
    } else {
      onSetBackOverride(null);
    }

    return () => onSetBackOverride(null);
  }, [
    isAddressModalOpen,
    isSummaryPanelOpen,
    showSuccess,
    aguardandoPagamento,
    onSetBackOverride,
    onNavigate,
  ]);

  // Achado 8 da revisão (17/08/2026): o painel era `role="dialog"` sem
  // Escape. Mesmo caminho da setinha e do fundo (achado 5): `history.back()`
  // consome a entrada empurrada acima e deixa o `popstate` fechar o painel.
  useEffect(() => {
    if (!isSummaryPanelOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        globalThis.history.back();
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [isSummaryPanelOpen]);

  // Achado 8 da revisão: mover o foco para dentro do painel ao abrir, e
  // devolvê-lo ao botão do total ao fechar — sem isto quem navega por
  // teclado ficava preso no formulário atrás do fundo. `wasOpenRef` evita
  // "devolver" o foco na montagem, quando o painel nunca esteve aberto.
  useEffect(() => {
    if (isSummaryPanelOpen) {
      summaryPanelWasOpenRef.current = true;
      summaryPanelRef.current?.focus();
    } else if (summaryPanelWasOpenRef.current) {
      summaryPanelWasOpenRef.current = false;
      summaryPanelTriggerRef.current?.focus();
    }
  }, [isSummaryPanelOpen]);

  // Guest checkout enabled - no redirect
  useEffect(() => {
    if (!authLoading && !user) {
      console.log("[CheckoutView] Guest mode active.");
    }
  }, [user, authLoading]);

  // Pagamento online exige conta (decisão do Gabriel, 16/08/2026) — sem isto,
  // um cliente que selecionou "Pagar agora com PIX" e teve a SESSÃO expirar
  // com a tela ainda aberta (ex.: token vencendo enquanto ele preenchia o
  // formulário) ficaria com `paymentMethod` preso em "online" mesmo sem
  // `user`, e `handleSubmitEvent` tentaria criar um pedido que o backend
  // (`criar-pagamento`, guard `PAGAMENTO_ONLINE_EXIGE_CONTA`) recusaria de
  // qualquer jeito — só que depois de já ter criado o PEDIDO (a recusa é na
  // função que gera a cobrança, uma chamada depois). `!authLoading`: não
  // mexe enquanto o hook de auth ainda está resolvendo a sessão inicial —
  // nesse intervalo `user` é `undefined`, não uma sessão que caiu de
  // verdade.
  useEffect(() => {
    if (!authLoading && !user && paymentMethod === "online") {
      setPaymentMethod("pix");
    }
  }, [authLoading, user, paymentMethod]);

  useEffect(() => {
    if (profile) {
      form.setValue("name", profile.full_name || "", { shouldValidate: true });
      form.setValue(
        "whatsapp",
        profile.whatsapp ? formatWhatsApp(profile.whatsapp) : "",
        { shouldValidate: true },
      );
      form.trigger();
    } else if (user) {
      form.trigger();
    }
  }, [profile, user, form]);

  useEffect(() => {
    if (user) {
      fetchAddresses();
    }
  }, [user, fetchAddresses]);

  const handleSelectAddress = useCallback((address: Address) => {
    setSelectedAddressId(address.id);
  }, []);

  useEffect(() => {
    if (addresses.length > 0 && !selectedAddressId) {
      const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
      handleSelectAddress(defaultAddr);
    }
  }, [addresses, selectedAddressId, handleSelectAddress]);

  // CHECKOUT-090: verificação periódica do pagamento. Nasceu como "rede de
  // segurança" contra o WebSocket do realtime cair sem avisar, mas o achado
  // 3 da revisão (16/08/2026) mostrou que no celular ela é o mecanismo
  // PRINCIPAL, não a rede de segurança: esconder a aba por ~3s já derruba a
  // liderança do realtime (useLeaderElection.ts: debounce de 300ms +
  // resignLeadership) e ~4s depois disso o canal compartilhado é removido
  // (useOrders.ts: refCount-- -> removeChannel após o debounce de 4s) — o
  // `postgres_changes` do Supabase NÃO tem replay, então o UPDATE que chegar
  // nesse intervalo (~3,3s a ~7,3s sem cobertura) está perdido para sempre.
  // No fluxo DOMINANTE (abrir o app do banco, pagar, voltar para cá) é este
  // useEffect quem descobre a confirmação, não o realtime.
  //
  // Por isso, além de reler o BANCO (nunca a edge function `criar-pagamento`,
  // que bate na API do Mercado Pago a cada chamada) a cada
  // INTERVALO_VERIFICACAO_PAGAMENTO_MS, o listener de `visibilitychange`
  // abaixo dispara a verificação IMEDIATAMENTE quando a aba volta a ficar
  // visível — sem ele o cliente esperaria o próximo tick de até 10s, ou bem
  // mais, porque o navegador aplica "intensive throttling" a timer de aba em
  // segundo plano. Fica de fora quando a aba está em segundo plano —
  // desperdício que multiplica por cliente parado — e para sozinho quando o
  // pedido é confirmado (efeito não recria o intervalo, e a limpeza do
  // anterior já rodou), quando o componente desmonta (mesma limpeza), quando
  // o `payment_status` chega a um dos quatro status TERMINAIS ('pago',
  // 'pago_apos_expirar', 'recusado', 'estornado' — ver `verificarPagamento`,
  // abaixo), ou quando o teto de TICKS (não de relógio — ver o comentário
  // grande de `TETO_TICKS_VERIFICACAO_PAGAMENTO`, no topo do arquivo) é
  // atingido. 'expirado' continua sendo consultado normalmente, porque é o
  // único caminho até 'pago_apos_expirar'.
  //
  // ESCOPO (decidido na tarefa): só cliente LOGADO. `marketplace_orders_
  // select_policy` só concede SELECT a `authenticated` — pedido de convidado
  // tem `user_id` NULL e `anon` não tem política nenhuma, então a consulta
  // abaixo voltaria vazia (RLS) mesmo sem este `!user`. A checagem explícita
  // evita gastar uma consulta por 10s sabendo de antemão que ela nunca pode
  // confirmar nada, e documenta a decisão em vez de depender do RLS calado.
  useEffect(() => {
    if (!aguardandoPagamento || !orderId || statusPagamentoPix || !user?.id)
      return;

    let parado = false;
    // Conta ticks do INTERVALO, não invocações de verificarPagamento — a
    // chamada extra do visibilitychange (abaixo) não é uma passagem do
    // relógio programado, é uma verificação avulsa disparada por um evento
    // do usuário. Contar as duas juntas faria quem alterna de aba com
    // frequência esgotar o teto bem antes dos 60 min reais de vida.
    let ticks = 0;

    const verificarPagamento = async () => {
      if (parado) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      const { data, error } = await supabase
        .from("marketplace_orders")
        .select("payment_status, expires_at")
        .eq("id", orderId)
        .single();

      if (parado || error || !data) return;

      // Ver o comentário do estado `statusPagamentoPix`, acima: os dois
      // status são finais e mutuamente exclusivos.
      if (data.payment_status === "pago") {
        setStatusPagamentoPix("confirmado");
        return;
      }
      if (data.payment_status === "pago_apos_expirar") {
        setStatusPagamentoPix("fora-do-prazo");
        return;
      }

      // Os outros dois status terminais não têm tela própria aqui — só
      // param de consultar (a constraint do banco não modela caminho de
      // volta a partir deles, ver
      // `supabase/migrations/20260807000000_reserva_com_expiracao.sql:17`).
      if (
        data.payment_status === "recusado" ||
        data.payment_status === "estornado"
      ) {
        parado = true;
        clearInterval(intervalId);
        return;
      }

      // `data.expires_at` continua sendo LIDO (é o único caminho até
      // 'pago_apos_expirar'), mas não decide mais quando parar — ver o
      // comentário grande de `TETO_TICKS_VERIFICACAO_PAGAMENTO`, no topo do
      // arquivo, sobre por que comparar com o relógio do cliente é o mesmo
      // defeito por outra porta.
    };

    const intervalId = setInterval(() => {
      ticks += 1;
      // Teto de segurança por TICKS, nunca por `expires_at`/`Date.now()`
      // (ver o comentário grande de `TETO_TICKS_VERIFICACAO_PAGAMENTO`, no
      // topo do arquivo). REGRESSÃO corrigida na 3ª revisão (16/08/2026):
      // gravar `parado = true` de forma SÍNCRONA aqui, logo após disparar
      // `verificarPagamento()`, acontecia ANTES da consulta ao Supabase
      // resolver — `verificarPagamento` suspende no primeiro `await`, e
      // `await` sempre cede pelo menos um microtask antes de voltar. Como o
      // guard de `verificarPagamento` é `if (parado || error || !data)
      // return;`, a resposta do último tick era descartada em 100% dos
      // casos, mesmo quando ela trazia `payment_status: 'pago'`. Anexar o
      // corte ao `.finally()` da PRÓPRIA chamada garante que `parado` só
      // vira `true` depois que `verificarPagamento` já consumiu a resposta
      // deste tick — o teto continua parando no mesmo tick de antes, só que
      // sem descartar o resultado que o motivou.
      //
      // `tickDesteCiclo` congela o contador ANTES da chamada, e o `.finally()`
      // compara ele — não o `ticks` compartilhado (achado da 5ª revisão). Sob
      // latência de consulta MAIOR que o intervalo de 10 s, o `ticks` mutável
      // reintroduziria o mesmo defeito com janela pequena: o tick 359 dispara
      // a consulta A, 10 s depois o tick 360 incrementa `ticks` e dispara a
      // consulta B, A resolve e seu `finally` lê `ticks === 360` e grava
      // `parado = true` — e B chega com 'pago' para ser descartada. Com o
      // valor congelado, cada corte pertence à sua própria chamada. Não se
      // perde robustez: os ticks seguintes também satisfazem a condição, então
      // uma consulta pendurada não impede o corte.
      const tickDesteCiclo = ticks;
      verificarPagamento().finally(() => {
        if (tickDesteCiclo >= TETO_TICKS_VERIFICACAO_PAGAMENTO) {
          parado = true;
          clearInterval(intervalId);
        }
      });
    }, INTERVALO_VERIFICACAO_PAGAMENTO_MS);

    // Achado 3 da revisão: dispara a verificação NA HORA em que a aba volta
    // a ficar visível, em vez de esperar o próximo tick do intervalo acima.
    // `verificarPagamento` já se protege sozinha (checa `document.
    // visibilityState` e `parado` no topo), então só precisa ser chamada —
    // as mesmas guardas de parada valem aqui.
    const aoVoltarAFicarVisivel = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        verificarPagamento();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", aoVoltarAFicarVisivel);
    }

    return () => {
      parado = true;
      clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", aoVoltarAFicarVisivel);
      }
    };
  }, [aguardandoPagamento, orderId, statusPagamentoPix, user?.id]);

  if (authLoading) {
    return (
      // `min-h-dvh` (era min-h-screen): mesma altura de tela cheia, mas
      // estável no celular — o 100vh sobe/desce quando a barra do navegador
      // aparece e some, e o spinner pulava de lugar durante o carregamento.
      <div className="flex min-h-dvh items-center justify-center bg-white">
        <div className="size-12 animate-spin rounded-full border-4 border-zinc-100 border-t-zinc-900" />
      </div>
    );
  }

  // Remove !user early return to allow guest checkout UI to render
  // if (!user) return null; // Wait for redirect

  // Values are now passed from props to ensure consistency
  const discount = appliedCoupon?.discount || 0;
  const finalTotal = total - discount;

  // Linha de cima da barra do total: o que está sendo comprado. Defeito
  // medido (17/08/2026): três das quatro formas de pagamento são "na
  // entrega" e o cliente não descobre em lugar nenhum do app o que está no
  // carrinho sem sair da tela — e sair apaga o endereço digitado.
  const itemsLabel =
    cart.length === 1
      ? `${cart[0].quantity}× ${cart[0].product.name}`
      : cart.length > 1
        ? `${cart.reduce((soma, item) => soma + item.quantity, 0)} itens no pedido`
        : "";

  // Linha de baixo: o Gabriel confirmou (17/08/2026) que a entrega está
  // dentro do valor cobrado — "Inclui" é o texto correto, não uma ressalva.
  // Achado 6 da revisão: com o carrinho vazio não existe entrega nenhuma
  // para incluir — "Entrega grátis inclusa" sem nada para entregar é uma
  // afirmação falsa (o R$ 0,00 é pré-existente e não muda aqui).
  const entregaLabel =
    cart.length === 0
      ? ""
      : shipping > 0
        ? `Inclui R$ ${shipping.toFixed(2).replace(".", ",")} de entrega`
        : "Entrega grátis inclusa";

  const isValid = form.formState.isValid;

  // REGRA DO CONVIDADO (decisão do Gabriel, 30/08/2026 — laudo caça-bugs
  // Savy, achado 3): convidado só compra com ENTREGA LOCAL; envio para outra
  // cidade exige conta. Sem cadastro não existe rastreio honesto do pedido
  // (o OTP precisa de e-mail, que o convidado não dá). A decisão final do
  // frete é do servidor; esta checagem é o portão da tela, espelhando
  // `is_local_cep` do banco via `cepEhLocal`. Sem CEP de origem configurado
  // a regra fica silenciosa — sem origem o próprio `semFreteSelecionado`
  // já trava o pedido, e o aviso aqui diria a mentira errada.
  const cepDoConvidado = form.watch("cep");
  const convidadoForaDaCidade =
    !user &&
    !!config.originCep &&
    !!cepDoConvidado &&
    !cepEhLocal(config.originCep, cepDoConvidado, config.localCepRange);

  // Achado da revisão (18/08/2026): a Tarefa 7 deste bloco fez a
  // `calculate-shipping` recusar cotar quando a loja não configurou o CEP de
  // origem — correto. Mas este botão só olhava `isValid` (validade do
  // FORMULÁRIO), nunca a existência de uma opção de frete. `shipping`
  // (= CartContext `shippingFee`, CartContext.tsx:745-770) cai para
  // `config.shippingFee` (padrão R$ 15) quando não há `selectedShippingOption`
  // — o MESMO fallback que `create_marketplace_order_v24` usa no servidor
  // quando `p_shipping_option_id` chega nulo. Resultado sem esta guarda:
  // cotação falha, tela não mostra opção nenhuma, e o pedido fechava mesmo
  // assim cobrando o frete de fallback sem entrega correspondente.
  //
  // `shipping > 0 && !selectedShippingOption` não reinventa a regra de
  // frete grátis: o CartContext já devolve `shipping === 0` para os dois
  // caminhos legítimos sem opção selecionada — item com `freeShipping`
  // (CartContext.tsx:748-749) e limite de frete grátis atingido por
  // cliente logado (CartContext.tsx:751-756) — então o único jeito de
  // `shipping` vir POSITIVO sem opção selecionada é o fallback do defeito
  // acima descrito.
  // Laudo 31/08 (B2): a guarda migrou para `finalizarBloqueadoPorFrete`
  // (src/lib/guarda-de-frete.ts) — função pura, testada com o par
  // mutante-killer. A diferença da guarda velha: a bandeira
  // `freteIndefinido` entra na conta — provedor de cotação com taxa 0
  // configurada deixava `shipping === 0`, a guarda antiga não disparava, e
  // o pedido fechava com frete R$ 0 sem cotação nenhuma, depois do
  // carrinho ter dito "A calcular".
  const semFreteSelecionado = finalizarBloqueadoPorFrete({
    carrinhoVazio: cart.length === 0,
    freteIndefinido: ctxFreteIndefinido,
    shipping,
    temOpcaoSelecionada: !!selectedShippingOption,
  });

  // `SaidaDaRecusa` promete, por escrito, que `conferir_antes` nunca oferece
  // "tentar de novo" — é o caso em que não se sabe se o pedido nasceu, e
  // repetir debita estoque duas vezes e queima cupom de uso único. Mas o
  // painel só CONTROLA o próprio botão; o "Finalizar Pedido" ficava livre ao
  // lado dele, e a pessoa clicava de novo sem ler o aviso. Travar o botão
  // ENQUANTO o painel está na tela fecha essa porta sem fechar de vez: quem
  // sabe que o pedido não nasceu fecha o painel (`onFechar`) e o botão volta
  // sozinho. Em `tentar_de_novo` o botão continua livre de propósito — ali o
  // reenvio manual É a saída desenhada.
  const aguardandoConferenciaDaRecusa =
    recusaDoUltimoClique?.acao === "conferir_antes";

  // Fonte ÚNICA da condição de "Finalizar Pedido" apagado. Antes desta
  // constante, o `disabled` do botão e o `cn(...)` que decide a APARÊNCIA
  // dele repetiam a mesma expressão em dois lugares — e as duas estavam
  // ERRADAS JUNTAS: nenhuma incluía `aguardandoConferenciaDaRecusa`, porque
  // nenhuma foi lembrada quando o painel `SaidaDaRecusa` entrou. A razão de
  // existir esta constante é PROSPECTIVA, não o relato de uma divergência
  // que já aconteceu: duas cópias da mesma condição divergem no primeiro
  // requisito novo que precisa ser lembrado nos dois lugares — e foi
  // exatamente isso que acabou de acontecer aqui. Com um nome só, a próxima
  // exigência entra num lugar, não em dois.
  const botaoFinalizarDesabilitado =
    !isValid ||
    isSubmitting ||
    semFreteSelecionado ||
    aguardandoConferenciaDaRecusa ||
    convidadoForaDaCidade;

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponError("");
  };

  /**
   * O que acontece quando a pessoa aperta o botão do painel da recusa.
   *
   * O painel some em TODOS os caminhos: ou o problema vai ser resolvido em
   * outra tela, ou foi resolvido aqui mesmo, ou a pessoa escolheu só fechar.
   * Painel que sobrevive à própria ação vira aviso velho na tela.
   */
  const agirNaRecusa = (acao: AcaoDeRecusa) => {
    setRecusaDoUltimoClique(null);
    haptic.light();

    switch (DESTINO_POR_ACAO.get(acao)) {
      case "carrinho":
        onNavigate("cart");
        return;
      case "cupom":
        // Resolve aqui mesmo: o cupom é editável nesta tela, e mandar a pessoa
        // para o carrinho para tirar algo que está na frente dela seria pior.
        handleRemoveCoupon();
        return;
      case "endereco":
        setIsAddressModalOpen(true);
        return;
      case "pedidos":
        // `conferir_antes` é o caso em que NÃO se sabe se o pedido nasceu.
        // A única saída segura é olhar os próprios pedidos antes de repetir.
        onNavigate("orders");
        return;
      case "so_fechar":
        return;
    }
  };

  const handleApplyCoupon = async (code: string) => {
    setCouponError("");
    try {
      const result = await validateCoupon(code, subtotal);

      if (result.valid) {
        setAppliedCoupon({ code, discount: result.discount });
      } else {
        setCouponError(result.message || "Cupom inválido");
      }
    } catch (error) {
      console.error("Error applying coupon:", error);
      setCouponError("Erro ao validar cupom");
    }
  };

  const handleNewAddressSubmit = async (
    data: Omit<Address, "id" | "user_id">,
  ): Promise<void> => {
    let result;
    if (editingAddressId) {
      const success = await updateAddress(editingAddressId, data);
      if (success) {
        result = addresses.find((a) => a.id === editingAddressId);
      }
    } else {
      result = await addAddress(data);
    }

    if (result) {
      // Use history.back() to close instead of direct state set
      // This ensures history is cleared and triggers our backOverride cleanup
      globalThis.history.back();
      handleSelectAddress(result);
      // Auto-scroll back to summary section if needed
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleEditAddress = (address: Address) => {
    setEditingAddressId(address.id);
    setIsAddressModalOpen(true);
  };

  const handleSubmitEvent = async () => {
    /*
      TRAVA SINCRONA, ANTES DE QUALQUER `await` (CHECKOUT-030, #27).

      `disabled={isSubmitting}` nao fecha a janela do duplo toque: `isSubmitting`
      e' estado do React e so' chega na tela no render seguinte, enquanto a
      primeira coisa que este handler faz e' `await form.trigger()`. Dois toques
      rapidos entravam os dois e criavam DOIS pedidos -- estoque debitado duas
      vezes, cupom de uso unico consumido duas vezes. Celular com tela travada
      emite esse toque repetido sozinho, e a janela cresce justamente quando o
      aparelho esta' lento.

      `travaDeEnvioRef.current.tentarEntrar()` fecha no mesmo tique do clique.
      A liberacao vai no `finally` la' embaixo, junto com `setIsSubmitting`.
    */
    if (!travaDeEnvioRef.current.tentarEntrar()) return;

    // A recusa anterior sai da tela assim que uma tentativa nova começa. Sem
    // isto, o painel da recusa passada ficaria ao lado do spinner da tentativa
    // atual, oferecendo uma ação para um problema que já pode não existir mais.
    setRecusaDoUltimoClique(null);

    let isFormValid: boolean;
    try {
      isFormValid = await form.trigger();
    } catch (err) {
      travaDeEnvioRef.current.liberar();
      throw err;
    }

    if (!isFormValid) {
      travaDeEnvioRef.current.liberar();
      // Laudo de acessibilidade 03/09, achado 1: o aviso genérico do toast
      // não diz ONDE está o erro. Levar o foco ao primeiro campo inválido faz
      // o leitor de tela anunciar o campo já marcado com `aria-invalid` e a
      // mensagem específica dele, ligada por `aria-describedby`.
      const primeiroErro = ORDEM_CAMPOS_FOCO.find(
        (campo) => form.getFieldState(campo).invalid,
      );
      if (primeiroErro) {
        form.setFocus(primeiroErro);
      }
      toast.error(
        "Por favor, preencha todos os campos obrigatórios corretamente.",
      );
      return;
    }

    const data = form.getValues();

    setIsSubmitting(true);

    if (user && !selectedAddressId) {
      toast.error("Por favor, adicione ou selecione um endereço de entrega.");
      setIsSubmitting(false);
      travaDeEnvioRef.current.liberar();
      return;
    }

    // Segunda trava, redundante com `disabled` no botão de propósito: o
    // `disabled` do DOM barra o clique do mouse/toque, mas não protege
    // quem chama `handleSubmitEvent` por outro caminho. Mesmo motivo do
    // "endereço de entrega" acima.
    if (semFreteSelecionado) {
      toast.error(
        semFreteSelecionado &&
          ctxFreteIndefinido &&
          config.shippingProvider === "flat_fee" &&
          !config.originCep?.trim()
          ? "A loja ainda está configurando o frete. Fale com a loja para combinar a entrega."
          : "Escolha uma opção de frete no carrinho antes de finalizar o pedido.",
      );
      setIsSubmitting(false);
      travaDeEnvioRef.current.liberar();
      return;
    }

    const customerInfo = data as unknown as Customer;
    const observations = notes || undefined;

    const variantNotes = cart
      .filter((item) => item.variantNames)
      .map((item) => `${item.product.name}: ${item.variantNames}`)
      .join("\n");
    const shippingNotes = selectedShippingOption
      ? `Frete Escolhido: ${selectedShippingOption.name} (Prazo: ${selectedShippingOption.deliveryDays} dias)`
      : undefined;
    const noteParts = [observations, variantNotes, shippingNotes].filter(
      Boolean,
    );
    const finalNotes =
      noteParts.length > 0 ? noteParts.join("\n\n") : undefined;

    const orderData: any = {
      customer: customerInfo,
      items: cart.map((item) => ({
        product_id: item.product.id, // Fixed key name for RPC
        quantity: item.quantity,
        variant_id: item.variantId, // Fixed key name for RPC
      })),
      totalAmount: finalTotal,
      shippingCost: shipping,
      // Identificam a cotação que o servidor gravou; sem isso o banco cai na
      // taxa padrão da loja e o total não fecha.
      destinationCep: shippingCep,
      shippingOptionId: selectedShippingOption?.id ?? null,
      paymentMethod,
      addressId: user ? selectedAddressId : null,
      addressData: user
        ? null
        : {
            cep: data.cep,
            street: data.street,
            number: data.number,
            neighborhood: data.neighborhood,
            city: data.city,
            state: data.state,
            complement: data.complement,
          },

      couponCode: appliedCoupon?.code,
      notes: finalNotes,
      status: "pending",
    };

    // A chave desta compra: mesma impressão digital (mesma retentativa,
    // mesmo F5) devolve a MESMA chave — é o que faz o servidor devolver o
    // pedido original em vez de criar um gêmeo. Impressão nova (mudou
    // carrinho, frete, cupom ou endereço) gira chave nova.
    gerenteDaChaveRef.current ??= criarGerenciadorDeChave(
      globalThis.sessionStorage,
    );
    orderData.idempotencyKey = gerenteDaChaveRef.current.chavePara(
      impressaoDaCompra({
        items: orderData.items,
        totalAmount: orderData.totalAmount,
        shippingCost: orderData.shippingCost,
        destinationCep: orderData.destinationCep,
        shippingOptionId: orderData.shippingOptionId,
        couponCode: orderData.couponCode,
        addressId: orderData.addressId,
        cepDoEndereco: orderData.addressData?.cep ?? null,
      }),
    );

    try {
      const ehOnline = paymentMethod === "online";
      const order = await createOrder(orderData, {
        comPagamentoOnline: ehOnline,
      });
      // O pedido entrou. A chave cumpriu seu papel: a PRÓXIMA compra — mesmo
      // com carrinho idêntico — tem de nascer com chave nova, não herdar a
      // resposta desta.
      gerenteDaChaveRef.current.esquecer();
      // O rascunho morre junto (laudo 3108, N7): compra fechada não tem
      // rascunho — vale para sucesso E para aguardando pagamento (o pedido
      // nasceu nos dois; o que segue é pagamento, não digitação).
      limparRascunhoDoCheckout(globalThis.sessionStorage);
      setOrderId(order.id);
      setValorDoPedido(finalTotal);
      // Snapshot ANTES do onClearCart() da linha seguinte — depois dele
      // `cart` (propCart ?? ctxCart) já está vazio. CHECKOUT-070 (#197)
      // usa isto para devolver os itens se o pagamento online falhar.
      itensDoPedidoParaRestaurarRef.current = cart;

      // 🤖 Automação Solo-Ninja: O disparo agora é 100% via Backend (Edge Function + Webhook)
      onClearCart();
      // Achado 4 da revisão (17/08/2026): sem isto `isSummaryPanelOpen`
      // continuava `true` na tela seguinte (sucesso ou aguardando
      // pagamento) — o painel deixa de fazer sentido aqui, junto com o
      // carrinho que acabou de ser limpo, e o primeiro "voltar" naquela
      // tela fechava um painel invisível em vez de agir pelo ramo de
      // `showSuccess || aguardandoPagamento`.
      setIsSummaryPanelOpen(false);

      if (ehOnline) {
        // NÃO mostra sucesso e NÃO solta confete: o pedido só está reservado,
        // e quem confirma pagamento é o webhook (Fase 3). Chamar isso de
        // sucesso aqui é a mentira que a tela de hoje conta.
        setAguardandoPagamento(true);
        return;
      }

      setShowSuccess(true);

      // Trigger confetti celebration
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#000000", "#ffffff", "#10b981", "#fbbf24"],
      });
    } catch (error: any) {
      console.error("Error creating order:", error);
      // Este catch recebe o MESMO erro que useOrders.ts (createOrder) já
      // relança depois do próprio toast interno — mesma tradução aqui, para
      // não haver dois textos diferentes para a mesma falha.
      //
      // O alert() de emergência que existia aqui foi removido: a condição
      // era `if (!error.message)`, ou seja, disparava só quando NÃO havia
      // texto cru — quanto mais incompreensível o erro, MENOS aviso o
      // comprador recebia. Agora mensagemAmigavelErroPedido NUNCA devolve
      // vazio, então o toast sempre carrega uma frase utilizável e o alerta
      // deixou de ter um gatilho útil.
      toast.error(`Falha no Pedido: ${mensagemAmigavelErroPedido(error)}`);
      // O toast é o AVISO — ele alcança quem não está olhando esta parte da
      // tela. O painel abaixo é a AÇÃO. Os dois convivem de propósito: até
      // 28/08/2026 só existia o toast, ele sumia sozinho e não levava a lugar
      // nenhum, e a pessoa ficava parada no último clique com o dinheiro na mão.
      setRecusaDoUltimoClique(decidirSaidaDoCheckout(error));
    } finally {
      setIsSubmitting(false);
      travaDeEnvioRef.current.liberar();
    }
  };

  // CHECKOUT-070 (#197): saída para quem teve o pagamento online recusado —
  // cancela o pedido (devolve estoque) e devolve o cliente ao carrinho para
  // ele concluir escolhendo "pagar na entrega". Só existe para sessão
  // autenticada: `update_order_status_atomic` recusa qualquer chamador sem
  // `auth.uid()` desde o PEDIDO-010 (#115) — pedido de convidado não tem
  // sessão para passar nessa guarda, e isso não é contornado aqui (ver botão
  // condicionado a `user` abaixo, e o relatório desta task).
  //
  // Achados 1 e 2 da revisão: nunca confiar no retorno de updateOrderStatus
  // para decidir "foi cancelado". O ramo offline de useOrders empilha a
  // mudança e RESOLVE sem lançar (ele foi escrito para o admin); e a
  // mensagem de guarda "Apenas pedidos pendentes..." é a MESMA (P0001) tanto
  // para "o pg_cron já cancelou" quanto para "o lojista adiantou para
  // processing" — casos opostos. Por isso o handler relê o status real do
  // pedido depois de chamar a RPC (RLS do dono permite) e só navega quando a
  // releitura confirma 'cancelled'. Qualquer outra coisa é falha segura.
  const handleCancelarPedidoESairDoPagamento = async () => {
    // Proteção contra clique duplo. Precisa ser REF, não o estado
    // `isCancelandoPedido`: dois cliques síncronos (dois `dispatchEvent` na
    // mesma tarefa, antes de qualquer re-render) leriam o mesmo `false`
    // fechado no closure de cada chamada — o React 18 agrupa os dois
    // `setIsCancelandoPedido(true)` num único commit, então checar o ESTADO
    // aqui não pegaria o segundo clique a tempo. Mutação de ref é síncrona.
    if (isCancelandoPedidoRef.current) return;
    isCancelandoPedidoRef.current = true;

    setIsCancelandoPedido(true);
    setErroCancelamento(null);
    try {
      if (isOffline) {
        // Sem rede o ramo offline de useOrders só empilha e resolve — não
        // vale nem tentar a RPC. Mensagem específica em vez do genérico.
        setErroCancelamento(
          "Sem conexão com a internet. Conecte-se e tente cancelar de novo — o pedido continua reservado.",
        );
        return;
      }

      try {
        // MESMA rpc que a reconciliação da #180 (PR #198) já ensinou a
        // gravar payment_status — não existe, e não deve existir, outro
        // caminho de cancelamento neste front. `silent=true`: o toast de
        // 2500ms do useOrders someria antes do cliente ler; o erro fica no
        // banner fixo abaixo, como erroCancelamento.
        await updateOrderStatus(orderId, "cancelled", undefined, true);
      } catch (erroRpc) {
        // Não decide aqui: a RPC pode recusar com a MESMA mensagem P0001
        // por dois motivos opostos (pg_cron já cancelou vs. lojista
        // adiantou). Quem decide é a releitura logo abaixo.
        console.error("Erro ao chamar RPC de cancelamento:", erroRpc);
      }

      const { data, error: erroLeitura } = await supabase
        .from("marketplace_orders")
        .select("status")
        .eq("id", orderId)
        .single();

      const statusFinal = data?.status;
      if (erroLeitura || statusFinal !== "cancelled") {
        console.error("Cancelamento não confirmado:", erroLeitura);
        // Precedente ADMIN-010 (#94): só não segue em frente quando a
        // gravação não é confirmada — nunca leva o cliente ao carrinho como
        // se o cancelamento tivesse dado certo.
        setErroCancelamento(
          statusFinal && statusFinal !== "pending"
            ? "Este pedido não está mais pendente — o lojista já deve ter começado a prepará-lo. Fale com a loja se ainda quiser cancelar."
            : "Não foi possível confirmar o cancelamento. Tente novamente.",
        );
        return;
      }

      for (const item of itensDoPedidoParaRestaurarRef.current) {
        addToCart(
          item.product,
          item.quantity,
          item.variantId,
          item.variantNames,
        );
      }
      onNavigate("cart");
    } finally {
      isCancelandoPedidoRef.current = false;
      setIsCancelandoPedido(false);
    }
  };

  if (aguardandoPagamento && orderId) {
    // CHECKOUT-090: pagamento confirmado — troca o QR (e o aviso de reserva
    // de 30 minutos, que é justamente a frase que faz o cliente achar que
    // falhou) pela confirmação. Ramos separados, ANTES do JSX do QR: os três
    // (QR, confirmado, fora do prazo) nunca podem coexistir na tela.
    if (statusPagamentoPix === "confirmado") {
      return (
        <PagamentoConfirmadoView
          orderId={orderId}
          valor={valorDoPedido}
          onNavigate={onNavigate}
        />
      );
    }

    if (statusPagamentoPix === "fora-do-prazo") {
      return (
        <PagamentoForaDoPrazoView
          orderId={orderId}
          valor={valorDoPedido}
          onNavigate={onNavigate}
        />
      );
    }

    return (
      // Mesma coluna do formulário (`mx-auto max-w-md`): sem ela, o cliente
      // saía de uma tela de 448px de largura e caía numa que esticava o texto
      // "Seu pedido está reservado…" de ponta a ponta em tela larga.
      <div className="mx-auto min-h-dvh w-full max-w-md space-y-4 bg-gray-50/10 px-3.5 pt-4">
        <h1 className="text-lg font-bold text-zinc-900">
          Finalize o pagamento
        </h1>
        <p className="text-xs text-zinc-500">
          Seu pedido está reservado. Se o pagamento não sair em 30 minutos, os
          itens voltam para o estoque e o pedido é cancelado.
        </p>
        {erroPagamento ? (
          <div className="space-y-3 rounded-2xl border border-red-100 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-500" />
              <p className="text-sm font-medium text-red-700">
                {erroPagamento.mensagem}
              </p>
            </div>
            {erroPagamento.categoria === "recuperavel" && (
              <Button
                onClick={() => {
                  setErroPagamento(null);
                  // Achado da 2ª revisão do #197: sem isto, um cancelamento
                  // que falhou deixa a mensagem dele pendurada — "Tentar de
                  // novo" limpava só o erro de pagamento, e no erro seguinte
                  // a caixa vermelha reaparecia com um aviso de cancelamento
                  // que já não vale mais.
                  setErroCancelamento(null);
                }}
                className="w-full rounded-xl bg-red-600 text-white hover:bg-red-600/90"
              >
                Tentar de novo
              </Button>
            )}
            {/* CHECKOUT-070 (#197): visível nos dois casos — no terminal é a
                única ação; no recuperável fica em segundo plano (variant
                "outline"), sem roubar o destaque de "Tentar de novo". Só
                para sessão autenticada (ver comentário do handler acima). */}
            {user ? (
              <Button
                onClick={handleCancelarPedidoESairDoPagamento}
                disabled={isCancelandoPedido}
                variant={
                  erroPagamento.categoria === "terminal" ? "default" : "outline"
                }
                className={cn(
                  "w-full rounded-xl gap-2",
                  erroPagamento.categoria === "terminal" &&
                    "bg-zinc-900 text-white hover:bg-zinc-900/90",
                )}
              >
                {isCancelandoPedido && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Cancelar pedido e voltar ao carrinho
              </Button>
            ) : (
              // Achado 3 da revisão do #197: sem sessão, `update_order_status_atomic`
              // recusaria a chamada (PEDIDO-010, #115) — não dá para
              // esconder o botão e não dizer nada. O convidado precisa
              // saber que o pedido se resolve sozinho e que entrar na
              // conta é a única forma de cancelar antes disso.
              <p className="text-xs text-zinc-500">
                Como você não está com a conta aberta, não é possível cancelar
                por aqui. Se o pagamento não sair em 30 minutos, o pedido é
                cancelado automaticamente e os itens voltam para o estoque. Para
                cancelar agora, entre na sua conta.
              </p>
            )}
            {erroCancelamento && (
              <p className="text-xs font-medium text-red-700">
                {erroCancelamento}
              </p>
            )}
          </div>
        ) : (
          <PagamentoOnline
            orderId={orderId}
            valor={valorDoPedido}
            onErro={(msg, categoria) =>
              setErroPagamento((atual) =>
                // Achado 3 da revisão do CHECKOUT-050 (#194): a doc do
                // Mercado Pago não é clara sobre a ordem entre `onSubmit`
                // rejeitado e `callbacks.onError` do Brick — o segundo pode
                // disparar DEPOIS do primeiro. Uma vez terminal na tela,
                // NENHUM erro seguinte substitui: rebaixar para recuperável
                // reabriria "Tentar de novo" para uma recusa que nunca
                // muda com nova tentativa.
                atual?.categoria === "terminal"
                  ? atual
                  : { mensagem: msg, categoria },
              )
            }
          />
        )}
      </div>
    );
  }

  if (showSuccess) {
    return (
      <SuccessView
        orderId={orderId}
        appliedCoupon={appliedCoupon}
        discount={discount}
        onNavigate={onNavigate}
      />
    );
  }

  if (isAddressModalOpen) {
    return (
      <AddressSelectionView
        editingAddressId={editingAddressId}
        addresses={addresses}
        onNewAddressSubmit={handleNewAddressSubmit}
        onCancel={() => globalThis.history.back()}
      />
    );
  }

  return (
    <div className="pb-customer-summary min-h-dvh bg-gray-50/10 pt-2">
      {/* `mx-auto max-w-md` é a largura de conteúdo do resto do app (ver
          AccountSettingsView, ProfileView, UserProfileView, AddressFormView e
          a AddressSelectionView deste mesmo arquivo) e é a mesma que a barra
          fixa do total já promete (`md:max-w-md`). Sem ela, medido em
          17/08/2026 numa janela de 1280px, os cards do checkout iam a 1252px
          de largura enquanto a barra do total ficava com 448px centralizada —
          formulário esticado de ponta a ponta e desalinhado com o próprio
          rodapé. */}
      <div className="mx-auto w-full max-w-md space-y-4 px-3.5">
        {/* Customer Info */}
        <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100/55 bg-zinc-50/40 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
              <User className="size-4" />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Dados de Identificação
            </span>
          </div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="checkout-name"
                  className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                >
                  Nome Completo
                </label>
                <input
                  id="checkout-name"
                  type="text"
                  autoComplete="name"
                  {...form.register("name")}
                  placeholder="Como devemos te chamar?"
                  // Laudo de acessibilidade 03/09, achado 1: o campo errado
                  // precisa ser MARCADO (`aria-invalid`) e LIGADO à mensagem
                  // (`aria-describedby`) — texto vermelho sozinho o leitor de
                  // tela não anuncia.
                  aria-invalid={form.formState.errors.name ? true : undefined}
                  aria-describedby={
                    form.formState.errors.name
                      ? "erro-checkout-name"
                      : undefined
                  }
                  className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                />
                {form.formState.errors.name && (
                  <p
                    id="erro-checkout-name"
                    className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500"
                  >
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="checkout-tel"
                  className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                >
                  WhatsApp para Contato
                </label>
                <div className="relative">
                  <Phone
                    className="absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-zinc-400"
                    aria-hidden="true"
                  />
                  <Controller
                    control={form.control}
                    name="whatsapp"
                    render={({ field }) => (
                      <input
                        id="checkout-tel"
                        type="tel"
                        autoComplete="tel"
                        value={field.value}
                        onChange={(e) =>
                          field.onChange(formatWhatsApp(e.target.value))
                        }
                        ref={field.ref}
                        placeholder="(00) 00000-0000"
                        maxLength={15}
                        aria-invalid={
                          form.formState.errors.whatsapp ? true : undefined
                        }
                        aria-describedby={
                          form.formState.errors.whatsapp
                            ? "erro-checkout-tel"
                            : undefined
                        }
                        className="w-full rounded-xl border-2 border-transparent bg-zinc-50 py-3 pl-12 pr-4 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                      />
                    )}
                  />
                </div>
                {form.formState.errors.whatsapp && (
                  <p
                    id="erro-checkout-tel"
                    className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500"
                  >
                    {form.formState.errors.whatsapp.message}
                  </p>
                )}
              </div>
            </div>

            {/* Guest Address Fields */}
            {!user && (
              <div className="space-y-4 border-t border-zinc-100/50 pt-4">
                <div className="mb-1 flex items-center gap-2">
                  <MapPin className="size-4 text-zinc-400" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Endereço de Entrega
                  </span>
                </div>

                {/* GRADE DE 6 COLUNAS, e o número 6 é o conserto.
                    Com `grid-cols-2` cada campo só podia ser metade (151px em
                    375px de tela) ou linha inteira (313px) — e nenhuma dessas
                    duas medidas serve para Cidade (nome médio) nem para Estado
                    (duas letras). Foi essa premissa que fez a grade ser
                    rearranjada três vezes em 17/08/2026, empurrando o aperto de
                    um campo para o vizinho a cada tentativa: primeiro `Estado`
                    órfão, depois o `Bairro` espremido em 151px, depois a
                    `Cidade` cortando em 151px.
                    Com 6 colunas cada campo recebe a largura do que entra nele,
                    e as linhas continuam fechando (3+3 · 6 · 6 · 3+3 · 6):
                    `CEP | Número` (os dois de tamanho curto e fixo, e os dois
                    únicos que o cliente digita à mão) · Rua · Bairro ·
                    `Cidade | Estado` (o par clássico; no atendimento local os
                    dois vêm preenchidos e travados) · Complemento.
                    Medido depois da mudança de 02/09/2026, em 375px (coluna de
                    42,5px + gap de 12px): CEP 151,5px · Número 151,5px ·
                    Rua 315px · Bairro 315px · Cidade 151,5px · Estado 151,5px
                    · Complemento 315px. (Até 02/09 o par Cidade|Estado era
                    4+2 e o Estado ficava com ~96px — largura de sobra para
                    "UF", mas apertada para o toque e para o placeholder; com
                    3+3 os dois campos ficam iguais e a soma segue fechando 6.)
                    Ao mexer aqui: some os spans de cada linha (tem de dar 6) E
                    confira no navegador se o texto mais longo de cada campo
                    cabe — `input.scrollWidth <= input.clientWidth`.
                    O que ISTO não resolve, e não é a grade: nome de rua muito
                    longo ("Avenida Presidente Juscelino Kubitschek de Oliveira")
                    corta mesmo com os 313px da linha inteira, porque 375px de
                    tela não dão mais que isso. Se isso virar problema, o
                    tratamento é outro (rótulo flutuante, quebra em duas linhas),
                    nunca uma quarta contagem de colunas. */}
                <div className="grid grid-cols-6 gap-3">
                  {/* Sem variante `md:` em nenhum campo daqui: o container do
                      checkout tem `max-w-md` em toda largura, então não existe
                      mais o alargamento que o `md:` compensava — ele só
                      apertaria. */}
                  <div className="col-span-3">
                    <label
                      htmlFor="guest-cep"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      CEP
                    </label>
                    <div className="relative">
                      <input
                        id="guest-cep"
                        {...form.register("cep")}
                        placeholder="00000-000"
                        disabled={isSearchingCep}
                        aria-invalid={
                          form.formState.errors.cep ? true : undefined
                        }
                        aria-describedby={
                          form.formState.errors.cep
                            ? "erro-guest-cep"
                            : undefined
                        }
                        className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                        onChange={async (e) => {
                          const { limpo, formatado } = formatarCep(
                            e.target.value,
                          );
                          form.setValue("cep", formatado, {
                            shouldValidate: true,
                          });
                          localStorage.setItem(
                            "ikcous_last_shipping_cep",
                            formatado,
                          );

                          const isNational =
                            config.shippingCoverage === "national";
                          // `limpo.length === 8` é portante, não só filtro
                          // de busca — ver o comentário equivalente em
                          // AddressForm.tsx.
                          if (isNational && limpo.length === 8) {
                            cepEmBuscaRef.current = limpo;
                            await buscarCep(limpo);
                          }
                        }}
                      />
                      {isSearchingCep && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 className="size-4 animate-spin text-zinc-400" />
                        </div>
                      )}
                    </div>
                    {form.formState.errors.cep && (
                      <p
                        id="erro-guest-cep"
                        className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500"
                      >
                        {form.formState.errors.cep.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-3">
                    <label
                      htmlFor="guest-number"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Número
                    </label>
                    <input
                      id="guest-number"
                      {...form.register("number")}
                      placeholder="123"
                      aria-invalid={
                        form.formState.errors.number ? true : undefined
                      }
                      aria-describedby={
                        form.formState.errors.number
                          ? "erro-guest-number"
                          : undefined
                      }
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                    {form.formState.errors.number && (
                      <p
                        id="erro-guest-number"
                        className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500"
                      >
                        {form.formState.errors.number.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-6">
                    <label
                      htmlFor="guest-street"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Rua
                    </label>
                    <input
                      id="guest-street"
                      {...form.register("street")}
                      placeholder="Nome da rua"
                      aria-invalid={
                        form.formState.errors.street ? true : undefined
                      }
                      aria-describedby={
                        form.formState.errors.street
                          ? "erro-guest-street"
                          : undefined
                      }
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                    {form.formState.errors.street && (
                      <p
                        id="erro-guest-street"
                        className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500"
                      >
                        {form.formState.errors.street.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-6">
                    <label
                      htmlFor="guest-neighborhood"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Bairro
                    </label>
                    <input
                      id="guest-neighborhood"
                      {...form.register("neighborhood")}
                      placeholder="Seu bairro"
                      aria-invalid={
                        form.formState.errors.neighborhood ? true : undefined
                      }
                      aria-describedby={
                        form.formState.errors.neighborhood
                          ? "erro-guest-neighborhood"
                          : undefined
                      }
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                    {form.formState.errors.neighborhood && (
                      <p
                        id="erro-guest-neighborhood"
                        className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500"
                      >
                        {form.formState.errors.neighborhood.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-3">
                    <label
                      htmlFor="guest-city"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Cidade
                    </label>
                    <input
                      id="guest-city"
                      {...form.register("city")}
                      placeholder="Cidade"
                      // Sem mensagem renderizada para este campo, mas o erro
                      // existe no schema (convidado): `aria-invalid` + foco
                      // do handler anunciam o problema (laudo 03/09, achado 1).
                      aria-invalid={
                        form.formState.errors.city ? true : undefined
                      }
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                  </div>
                  <div className="col-span-3">
                    <label
                      htmlFor="guest-state"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Estado
                    </label>
                    <input
                      id="guest-state"
                      {...form.register("state")}
                      maxLength={2}
                      placeholder={
                        config.shippingCoverage === "national" ? "UF" : "MG"
                      }
                      aria-invalid={
                        form.formState.errors.state ? true : undefined
                      }
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                  </div>
                  <div className="col-span-6">
                    <label
                      htmlFor="guest-complement"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Complemento (Opcional)
                    </label>
                    <input
                      id="guest-complement"
                      {...form.register("complement")}
                      placeholder="Apto, Bloco, Fundos, etc."
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Saved Addresses (Logged In Only) */}
        {user && (
          <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
                  <MapPin className="size-4" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                  Seus Endereços
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingAddressId(null);
                  setIsAddressModalOpen(true);
                }}
                className="flex h-11 items-center gap-1 rounded-xl bg-primary px-3 text-[11px] font-bold uppercase tracking-wider text-white transition-all hover:opacity-90"
              >
                <Plus className="size-3" /> Novo
              </Button>
            </div>
            <div className="p-4">
              {addressesLoading ? (
                <div className="flex min-h-[112px] flex-col items-center justify-center py-8">
                  <div className="border-3 mb-3 size-6 animate-spin rounded-full border-zinc-100 border-t-primary" />
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Sincronizando endereços...
                  </p>
                </div>
              ) : (
                <AddressList
                  addresses={addresses}
                  selectable
                  selectedId={selectedAddressId || undefined}
                  onSelect={handleSelectAddress}
                  onEdit={handleEditAddress}
                />
              )}
            </div>
          </div>
        )}

        {/* Coupon */}
        {config.enableCoupons && (
          <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
              <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
                <Tag className="size-4" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                Vantagem Exclusiva
              </span>
            </div>
            <div className="p-4">
              <CouponInput
                onApply={handleApplyCoupon}
                onRemove={handleRemoveCoupon}
                appliedCoupon={appliedCoupon}
                error={couponError}
              />
            </div>
          </div>
        )}

        {/* Payment Method */}
        <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
              <CreditCard className="size-4" />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Meio de Pagamento
            </span>
          </div>
          {/* Laudo de acessibilidade 03/09, achado 3: as opções de pagamento
              são uma escolha ÚNICA, mas nada anunciava qual estava marcada —
              o "check" era só um desenho. `radiogroup` + `radio` com
              `aria-checked` dá o estado ao leitor de tela. */}
          <div
            role="radiogroup"
            aria-label="Meio de pagamento"
            className="grid grid-cols-1 gap-2.5 p-4"
          >
            {[
              ...(PAGAMENTO_ONLINE_LIGADO
                ? [
                    {
                      value: "online" as PaymentMethod,
                      // SÓ PIX, e o rótulo tem de dizer isso. A Fase 3 recusa
                      // cartão em DOIS lugares — o Brick só oferece
                      // `bankTransfer` (PagamentoOnline.tsx) e a criar-pagamento
                      // devolve 400 "No momento aceitamos apenas PIX". O rótulo
                      // antigo dizia "(PIX ou cartão)" e sobreviveu à Fase 3:
                      // prometia ao cliente o que o código nega.
                      // Ao religar cartão na Fase 3.5, este rótulo volta junto.
                      label: "Pagar agora com PIX",
                      icon: CreditCard,
                      color: "text-violet-500 bg-violet-50",
                      // Pagamento online exige conta (decisão do Gabriel,
                      // 16/08/2026) — só esta opção carrega a exigência; as
                      // outras (entrega) continuam abertas a convidado.
                      requerConta: true,
                    },
                  ]
                : []),
              {
                value: "pix" as PaymentMethod,
                label: "Pix na Entrega",
                icon: Smartphone,
                color: "text-emerald-500 bg-emerald-50",
                requerConta: false,
              },
              {
                value: "card" as PaymentMethod,
                label: "Cartão na Entrega",
                icon: CreditCard,
                color: "text-blue-500 bg-blue-50",
                requerConta: false,
              },
              {
                value: "cash" as PaymentMethod,
                label: "Dinheiro na Entrega",
                icon: Banknote,
                color: "text-amber-500 bg-amber-50",
                requerConta: false,
              },
            ].map((option) => {
              const Icon = option.icon;
              const isSelected = paymentMethod === option.value;
              // Bloqueada só pela FALTA DE CONTA, nunca só por
              // `requerConta` — um cliente logado escolhe "Pagar agora com
              // PIX" normalmente. NÃO esconde a opção: some sem explicação
              // faria o convidado achar que a loja não aceita PIX pelo
              // site. Mostra com aparência de indisponível, e o clique vira
              // o caminho para resolver (entrar/criar conta), em vez de
              // selecionar o método.
              const bloqueadaPorFaltaDeConta = option.requerConta && !user;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  // Fiel ao que se VÊ: opção bloqueada por falta de conta não
                  // mostra seleção (a borda dela não usa `isSelected`), então
                  // não anuncia seleção.
                  aria-checked={isSelected && !bloqueadaPorFaltaDeConta}
                  onClick={() => {
                    if (bloqueadaPorFaltaDeConta) {
                      haptic.light();
                      onNavigate("auth");
                      return;
                    }
                    setPaymentMethod(option.value);
                  }}
                  // Sem `opacity-70` na opção bloqueada: ela multiplicava
                  // cores JÁ claras e derrubava o texto para ~1,9:1 de
                  // contraste (medido em 17/08/2026), abaixo do 4,5:1 que
                  // texto pequeno exige — e este é justamente o único item da
                  // lista que precisa ser LIDO, porque explica o que fazer.
                  // Quem diz "indisponível" aqui é o fundo cinza, o cadeado e
                  // a cor do rótulo, não a transparência.
                  className={`flex w-full items-center gap-4 rounded-2xl border-2 p-3.5 shadow-sm transition-all duration-300 active:scale-[0.99] ${
                    bloqueadaPorFaltaDeConta
                      ? "border-zinc-100 bg-zinc-50/60"
                      : isSelected
                        ? "z-10 border-zinc-900 bg-white shadow-md"
                        : "border-zinc-50 bg-zinc-50/50 hover:border-zinc-100 hover:bg-white"
                  }`}
                >
                  <div
                    className={`flex size-10 items-center justify-center rounded-xl ${option.color} transition-all duration-300 ${isSelected && !bloqueadaPorFaltaDeConta ? "scale-105" : ""}`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex min-w-0 flex-col items-start gap-1.5 text-left">
                    {/* `zinc-400` sobre branco dá 2,56:1 — os três meios de
                        pagamento não escolhidos ficavam ilegíveis, com cara de
                        desabilitados. `zinc-600` (7:1) mantém a hierarquia
                        (escolhido continua sendo o mais escuro) sem apagar as
                        outras opções. */}
                    <span
                      className={`text-xs font-bold uppercase tracking-wider ${
                        bloqueadaPorFaltaDeConta
                          ? "text-zinc-500"
                          : isSelected
                            ? "text-zinc-900"
                            : "text-zinc-600"
                      }`}
                    >
                      {option.label}
                    </span>
                    {bloqueadaPorFaltaDeConta && (
                      // Mesma frase, leitura melhor (02/09/2026): leading
                      // normal e mais respiro da linha de cima — as três
                      // linhas da explicação param de parecer um bloco
                      // compacto demais em 375px.
                      <span className="text-[11px] font-medium normal-case leading-normal tracking-normal text-zinc-500">
                        Pagar pelo site exige conta, para você acompanhar o
                        pedido e receber a confirmação. Toque para entrar ou
                        criar a sua.
                      </span>
                    )}
                  </div>
                  {bloqueadaPorFaltaDeConta ? (
                    <Lock className="ml-auto size-4 shrink-0 text-zinc-500" />
                  ) : (
                    <div
                      className={`ml-auto flex size-5 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${isSelected ? "scale-105 border-primary bg-primary" : "border-zinc-200"}`}
                    >
                      {isSelected && <Check className="size-3 text-white" />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
              <FileText className="size-4" />
            </div>
            <label
              htmlFor="order-notes"
              className="text-[11px] font-bold uppercase tracking-wider text-zinc-500"
            >
              Notas Adicionais (Opcional)
            </label>
          </div>
          <div className="p-4">
            <textarea
              id="order-notes"
              name="order_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Deixar na portaria, campainha estragada, etc..."
              rows={2}
              className="w-full resize-none rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-primary focus:bg-white"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Location Notice — some por inteiro quando a loja não configurou
            cidade. A cobertura de entrega decide para onde ela entrega, mas
            este aviso é sobre a loja, não sobre o cliente. */}
        {config.storeCity && (
          <div className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-slate-800 shadow-md">
            <div className="absolute right-0 top-0 rotate-12 p-4 opacity-5 transition-transform duration-700 group-hover:rotate-0">
              <MapPin className="size-16 text-zinc-500" />
            </div>
            <div className="relative z-10 flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <AlertCircle className="size-5 text-zinc-500" />
              </div>
              <div>
                <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-900">
                  Aviso de Região
                </h4>
                <p className="text-[10px] font-medium uppercase leading-relaxed tracking-tight text-slate-500">
                  Nossos serviços de entrega premium estão ativos exclusivamente
                  em{" "}
                  <span className="font-black text-slate-900">
                    {config.storeCity}
                    {config.storeState ? `, ${config.storeState}` : ""}
                  </span>
                  .
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Spacer to prevent overlap by the sticky footer and bottom nav.
          REMEDIDO em 02/09/2026, depois do redesenho da barra (mesmo método
          do navegador de 17/08/2026: fim do último card menos `top` da barra
          fixa, no scroll máximo — nunca somar número por adivinhação).
          Medição REAL desta vez: Chrome via puppeteer, viewport 375×667,
          dev server local, carrinho injetado no localStorage.

          O que mudou na barra: a coluna do total tinha 4 linhas e, com
          cupom, o selo "(-R$ X OFF)" quebrava para uma 5ª (~87px sem cupom,
          ~100px com). Agora são 3 linhas com o selo INLINE truncado — a
          barra tem altura fixa de 73px (24px de padding + 48px do botão
          "Finalizar Pedido" + 1px de borda; medido com e sem itens: igual,
          a coluna nova mede 45,5px e a linha "itens · entrega" fica em UMA
          linha truncada de 12,5px). O maior consumidor de altura da barra
          passou a ser o aviso de frete: 1–2 linhas (33px medido em 2 linhas
          no ambiente de medida) → barra 112px no pior caso medido.

          Mobile (375px), medido no scroll máximo: com espaçador de 168px o
          GAP foi +31,5px no caso comum (barra 73px) e −7,5px no pior caso
          (aviso de frete em 2 linhas, barra 112px). Necessário = 168 + 7,5
          ≈ 175,5px → 196px adotado (fecha o pior caso e mantém ~20px de
          folga; o buraco no caso comum, ~123px, é da mesma ordem do valor
          antigo, que com barra mínima de 87px sobrava ~113px).

          Desktop (1280px): mesma barra de 3 linhas cai de ~92px para 73px;
          necessário antigo era 215,9px → 215,9 − 19 ≈ 197 → 200px mantidos.

          Se a barra crescer de novo (nova linha, mais um selo, aviso novo),
          remedir do mesmo jeito antes de só somar um número por adivinhação. */}
      <div
        className="hidden md:block"
        style={{ height: "200px" }}
        aria-hidden="true"
      />
      <div
        className="block md:hidden"
        style={{ height: "calc(196px + var(--safe-area-bottom, 0px))" }}
        aria-hidden="true"
      />

      {/* Order Summary - Fixed Bottom Bar */}
      {typeof document !== "undefined" &&
        document.body &&
        createPortal(
          <>
            {/* Fundo que fecha o painel de resumo ao toque fora — portal
                próprio, z-index abaixo do container da barra (z-[110], que
                hospeda o painel) para nunca cobrir a barra em si. */}
            <AnimatePresence>
              {isSummaryPanelOpen && (
                <motion.div
                  key="checkout-summary-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-[105] bg-black/40"
                  // Achado 5 da revisão (17/08/2026): fechar direto pelo
                  // estado deixava a entrada do `pushState` (linhas
                  // 430-441) órfã na pilha do histórico — o próximo "voltar"
                  // não fazia nada visível. `history.back()` consome a
                  // entrada e deixa o `popstate` (App.tsx) fechar o painel
                  // pelo `onSetBackOverride` já registrado — mesmo padrão de
                  // `onCancel={() => globalThis.history.back()}` (linha ~1116).
                  onClick={() => globalThis.history.back()}
                  aria-hidden="true"
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {isPresent && isReady && (
                // POSICIONAMENTO NO DIV DE FORA, ANIMAÇÃO NO motion.div DE
                // DENTRO — é como o carrinho (CartFooterSummary) e os favoritos
                // (FavoritesView) fazem, e a separação não é estética: o
                // framer-motion escreve `transform: translateY(...)` inline no
                // elemento que anima, e isso SOBRESCREVE o `md:-translate-x-1/2`
                // do Tailwind. Com as duas coisas no mesmo elemento (como estava
                // aqui), a centralização de md morria em silêncio: medido em
                // 17/08/2026 numa janela de 1280px, a barra ficava em 640–1088px
                // em vez de 416–864px — meia tela à direita do formulário.
                //
                // `bottom-docked-navigation` cola a barra na navegação inferior,
                // como o carrinho, o produto e os favoritos já faziam. Esta barra
                // usava uma `bottom-safe-navigation` — a mesma conta mais 12px —
                // e era o único uso dela no app: aqueles 12px não eram respiro,
                // eram uma fresta por onde o formulário rolando aparecia entre as
                // duas barras (medido no mesmo dia: barra terminando em 736px,
                // navegação começando em 747px, com um campo cinza à mostra no
                // meio). A classe foi removida de `src/index.css` junto com este
                // uso, para ninguém reabrir a fresta escolhendo o nome que soa
                // mais seguro.
                <div className="bottom-docked-navigation fixed inset-x-0 z-[110] md:bottom-[104px] md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2">
                  {/* Painel de resumo — sobe ACIMA da barra porque é o
                      irmão anterior dela dentro deste mesmo container
                      `fixed`/`bottom-docked-navigation`: cresce para cima em
                      vez de deslocar a barra, sem tocar no `motion.div` da
                      barra logo abaixo.

                      LIMITE CONHECIDO, MEDIDO E DEIXADO DE PROPÓSITO
                      (17/08/2026): a saída deste painel é animada, e
                      `AnimatePresence` só desmonta o nó quando a animação de
                      saída TERMINA. Ela depende de `requestAnimationFrame`, que
                      não dispara em aba oculta — medido 6 de 6 vezes: o estado
                      React já fechou (`aria-expanded` volta a "false", o
                      `backOverride` volta a null) e o nó continua no DOM por
                      tempo indeterminado. Quando a aba volta a ficar visível os
                      quadros voltam e o nó sai.
                      E não é só "um nó invisível": medido, o que fica é o FUNDO
                      em tela cheia com `opacity: 0` e `pointer-events: auto`
                      cobrindo o viewport inteiro — ou seja, um engolidor de
                      cliques invisível. Enquanto ele está lá, o formulário não
                      recebe toque; só a barra (z-110) e a navegação (z-120)
                      passam por cima.
                      Por que NÃO consertar mesmo assim: a janela de exposição é
                      exatamente a aba oculta, onde o cliente não está tocando em
                      nada, e ela fecha sozinha quando a aba volta a ficar
                      visível (o `rAF` pendente do framer retoma — é
                      especificação, não sorte). A única correção possível mexe
                      na `AnimatePresence` desta barra, a mesma peça que quebrou
                      DUAS vezes hoje (centralização morta pelo `transform`
                      inline do framer-motion, e fresta de 12px entre barra e
                      navegação). Trocar uma barra que funciona por isso é o
                      negócio errado — mas quem reabrir esta decisão precisa
                      saber que o preço é engolir clique, não só sujar o DOM.
                      Se um dia isso precisar de conserto de verdade, a saída é
                      não depender da animação para remover o nó — nunca
                      reescrever o esqueleto de posicionamento. */}
                  <AnimatePresence>
                    {isSummaryPanelOpen && (
                      <motion.div
                        key="checkout-summary-panel"
                        initial={{ y: 12, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 12, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        ref={summaryPanelRef}
                        // `role="dialog"` SEM `aria-modal`, de propósito.
                        // `aria-modal="true"` manda o leitor de tela esconder
                        // tudo que está fora daqui — e não é verdade: medido em
                        // 17/08/2026, o fundo escuro (z-105) cobre o formulário
                        // mas NÃO cobre a barra (z-110) nem a navegação inferior
                        // (z-120), que seguem clicáveis por toque. Afirmar modal
                        // esconderia do leitor de tela justamente o "Finalizar
                        // Pedido" que continua funcionando.
                        // O que este painel é de fato: um disclosure — o gatilho
                        // carrega `aria-expanded` e a dica "toque para ver os
                        // itens". A outra saída seria subir o fundo acima da
                        // barra, e isso mexe no empilhamento que já quebrou duas
                        // vezes hoje.
                        role="dialog"
                        aria-label="Resumo do pedido"
                        tabIndex={-1}
                        // 50vh (era 45vh): o bloco de totais passou a ser
                        // sticky no fundo do painel (SEMPRE visível — com
                        // carrinho grande ele não rola mais para fora), então
                        // ele consome ~96px fixos do painel; os 5vh extras
                        // devolvem à lista de itens o espaço que o bloco
                        // ocupa, mantendo a lista rolável útil.
                        className="mx-auto mb-2 max-h-[50vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-100 bg-white px-4 pt-3 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] outline-none"
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                            Resumo do Pedido
                          </span>
                          <button
                            type="button"
                            // Mesmo motivo do fundo: consumir a entrada do
                            // histórico via `history.back()`, não fechar
                            // direto pelo estado.
                            onClick={() => globalThis.history.back()}
                            aria-label="Fechar resumo do pedido"
                            // `after:-inset-2` amplia a área de toque para
                            // 44px (28px do ícone + 16px) sem mudar o visual
                            // discreto do chevron.
                            className="relative flex size-7 items-center justify-center rounded-full text-zinc-400 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-zinc-50 hover:text-zinc-600"
                          >
                            <ChevronDown className="size-4" />
                          </button>
                        </div>

                        {/* Sem botão de editar e sem link para o carrinho —
                            voltar ao carrinho apaga o endereço já digitado
                            (ver AGENTS.md/comentários do checkout), e este
                            painel existe justamente para conferir sem sair
                            da tela. */}
                        <ul className="space-y-3">
                          {cart.map((item) => {
                            // Mesma fórmula de CartContext.tsx (cartTotal) —
                            // não uma conta nova. Laudo 31/08 (menor E): a
                            // regra única mora em preco-vendido.ts — `||`
                            // cobrava o preço cheio de variação com override
                            // ZERO.
                            const precoUnitario = precoVendido(
                              item.product,
                              item.product.variants?.find(
                                (v) => v.id === item.variantId,
                              ),
                            );

                            return (
                              <li
                                key={`${item.product.id}-${item.variantId ?? ""}`}
                                className="flex items-center gap-3"
                              >
                                <img
                                  src={item.product.images?.[0]}
                                  alt=""
                                  className="size-12 shrink-0 rounded-xl border border-zinc-100 bg-zinc-50 object-cover"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-zinc-800">
                                    {item.product.name}
                                  </p>
                                  {item.variantNames && (
                                    <p className="truncate text-[11px] text-zinc-400">
                                      {item.variantNames}
                                    </p>
                                  )}
                                </div>
                                <span className="shrink-0 text-xs font-semibold text-zinc-600">
                                  {item.quantity} × R${" "}
                                  {precoUnitario.toFixed(2).replace(".", ",")}
                                </span>
                              </li>
                            );
                          })}
                        </ul>

                        {/* Sticky no fundo do painel (ponto de revisão de
                            02/09/2026): com carrinho grande a lista rola
                            DEBAIXO deste bloco e o Total nunca mais sai da
                            tela. O `-mx-4 px-4` estende o fundo branco por
                            toda a largura do painel (que agora só tem `px-4
                            pt-3`), para nada aparecer na fresta do padding. */}
                        <div className="sticky bottom-0 -mx-4 mt-3 space-y-1.5 border-t border-zinc-100 bg-white px-4 py-3 text-xs">
                          <div className="flex items-center justify-between text-zinc-500">
                            <span>Subtotal</span>
                            <span>
                              R$ {subtotal.toFixed(2).replace(".", ",")}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-zinc-500">
                            <span>Entrega</span>
                            <span>
                              {shipping > 0
                                ? `R$ ${shipping.toFixed(2).replace(".", ",")}`
                                : "Grátis"}
                            </span>
                          </div>
                          {discount > 0 && (
                            <div className="flex items-center justify-between text-red-500">
                              <span>Desconto</span>
                              <span>
                                -R$ {discount.toFixed(2).replace(".", ",")}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between pt-1 text-sm font-black text-zinc-900">
                            <span>Total</span>
                            <span>
                              R$ {finalTotal.toFixed(2).replace(".", ",")}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.div
                    initial={{ y: "100%", opacity: 0.5 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: "100%", opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="w-full rounded-t-2xl border-t border-zinc-100 bg-white/95 p-3 px-4 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl md:rounded-b-none md:rounded-t-2xl md:border-x md:border-b-0 md:border-t md:border-zinc-200/60"
                  >
                    {/* `max-w-md` (não `max-w-screen-md`) para o total e o botão
                        ficarem na mesma coluna dos cards do formulário. */}
                    <div className="mx-auto flex max-w-md items-center justify-between gap-3">
                      <button
                        type="button"
                        ref={summaryPanelTriggerRef}
                        onClick={() => {
                          haptic.light();
                          setIsSummaryPanelOpen((open) => !open);
                        }}
                        // Carrinho vazio não tem o que listar. `disabled` em vez
                        // de um `return` no clique: o `return` fazia o botão
                        // parar de funcionar sem PARECER parado — continuava
                        // focável, com cursor de mão, e anunciado ao leitor de
                        // tela como "recolhido", coisa que nunca expandiria.
                        // Cenário real e alcançável: finalizar um pedido e
                        // recarregar a página (a URL segue /checkout, o carrinho
                        // já foi limpo). O "Finalizar Pedido" ao lado já se
                        // explica assim.
                        disabled={cart.length === 0}
                        aria-expanded={isSummaryPanelOpen}
                        className="flex min-w-0 flex-1 flex-col text-left"
                      >
                        {/* REDESENHO EM 375px (02/09/2026): eram 4 linhas
                            empilhadas e, com cupom aplicado, o selo
                            "(-R$ X OFF)" quebrava para uma 5ª (a coluna tem
                            ~141px e valor+selo exigem ~180px) — a barra
                            engordava de ~87 para ~100px. Agora: "itens ·
                            entrega" numa ÚNICA linha truncada, o valor
                            dominante em linha própria e o selo INLINE com
                            truncate (shrink-0 no valor) — nunca empurra a
                            barra a crescer. O valor completo do desconto
                            segue no painel de resumo, na linha "Desconto". */}
                        {(itemsLabel || entregaLabel) && (
                          <span className="mb-0.5 flex min-w-0 items-center gap-1 text-[10px] font-medium leading-tight text-zinc-400">
                            {itemsLabel && (
                              <span className="truncate">{itemsLabel}</span>
                            )}
                            {itemsLabel && entregaLabel && (
                              <span aria-hidden="true" className="shrink-0">
                                ·
                              </span>
                            )}
                            {entregaLabel && (
                              <span className="truncate">{entregaLabel}</span>
                            )}
                          </span>
                        )}
                        <span className="mb-0.5 text-[11px] font-bold uppercase leading-none tracking-wider text-zinc-400">
                          Total a Pagar
                        </span>
                        <div className="flex min-w-0 items-baseline gap-1.5">
                          <span className="shrink-0 text-lg font-black leading-none tracking-tight text-zinc-900">
                            R$ {finalTotal.toFixed(2).replace(".", ",")}
                          </span>
                          {discount > 0 && (
                            <span className="min-w-0 truncate text-[11px] font-bold uppercase text-red-500">
                              (-R$ {discount.toFixed(2).replace(".", ",")} OFF)
                            </span>
                          )}
                        </div>
                        {cart.length > 0 && (
                          <span className="sr-only">
                            , toque para ver os itens
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          haptic.medium();
                          handleSubmitEvent();
                        }}
                        disabled={botaoFinalizarDesabilitado}
                        className={cn(
                          "h-12 px-6 transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-2 rounded-2xl uppercase tracking-wider font-bold text-xs shrink-0 shadow-lg",
                          botaoFinalizarDesabilitado
                            ? "bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200 shadow-none"
                            : "bg-primary text-white hover:bg-primary/90 shadow-black/10",
                        )}
                      >
                        {isSubmitting ? (
                          <div className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                        ) : (
                          <>
                            <span>Finalizar Pedido</span>
                            <ArrowLeft className="size-4 rotate-180" />
                          </>
                        )}
                      </button>
                    </div>
                    {semFreteSelecionado && (
                      // Motivo visível: botão apagado sem explicação faz a
                      // pessoa desistir sem saber por quê. Cenário real: a
                      // loja não configurou de onde despacha, a cotação de
                      // frete recusa, e sem este aviso o cliente só via um
                      // botão cinza sem saber que precisa voltar ao
                      // carrinho e calcular o frete.
                      <p className="mx-auto mt-1.5 flex max-w-md items-start gap-1.5 text-[11px] font-bold uppercase text-red-500">
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        {semFreteSelecionado &&
                        ctxFreteIndefinido &&
                        config.shippingProvider === "flat_fee" &&
                        !config.originCep?.trim()
                          ? "A loja ainda está configurando o frete — fale com a loja para combinar a entrega"
                          : "Volte ao carrinho e calcule o frete para continuar"}
                      </p>
                    )}
                    {convidadoForaDaCidade && (
                      // Motivo visível da regra do convidado (decisão do
                      // Gabriel, 30/08/2026): entrega para fora da cidade é
                      // só com conta — sem cadastro não há como acompanhar
                      // o pedido. Botão apagado SEM este aviso virava
                      // desistência silenciosa.
                      //
                      // Compactado (02/09/2026): bloco mais enxuto (p-2.5,
                      // gaps menores) com a AÇÃO como botão de 44px — em
                      // telas estreitas como 375px o flex-wrap empilha o
                      // botão na linha de baixo (~265px de título + ~200px
                      // de botão não cabem nos ~343px úteis); em telas
                      // largas título e botão dividem a primeira linha.
                      // O bloco encolhe de ~137px para ~120px de altura e
                      // cresce menos para cima sobre o formulário.
                      <div className="mx-auto mt-1.5 flex max-w-md flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5">
                        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-600">
                          <AlertCircle className="size-3.5 shrink-0" />
                          Entrega fora da cidade é só com conta
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            haptic.light();
                            onNavigate("auth");
                          }}
                          className="flex min-h-[44px] items-center rounded-lg border border-primary/40 bg-primary/10 px-4 text-[11px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
                        >
                          Entrar ou criar conta
                        </button>
                        <p className="w-full text-center text-[11px] leading-snug text-zinc-500">
                          Crie sua conta para receber em outro CEP — assim você
                          também acompanha seu pedido por aqui.
                        </p>
                      </div>
                    )}
                    {aguardandoConferenciaDaRecusa && (
                      // A única porta de saída daqui era o "X" de 16px no
                      // painel abaixo (aria-label "Fechar o aviso"), sem
                      // nenhum texto ligando "fechar o aviso" a "o botão
                      // volta". O painel já explica O PROBLEMA (a frase do
                      // banco); esta linha explica só COMO DESTRAVAR o
                      // botão — mesmo espírito do aviso de frete acima.
                      //
                      // `conferir_antes` reúne DOIS casos (recusaDoPedido.ts:
                      // 141-169), não um: erro sem código reconhecível, onde
                      // a resposta pode não ter chegado e ninguém sabe se o
                      // pedido existe; e um P0001 cujo texto nenhuma regra
                      // prevista casa, onde a resposta CHEGOU e o
                      // `RAISE EXCEPTION` garante que o pedido não nasceu —
                      // a trava aí é conservadora de propósito, não por
                      // falta de prova. Nos dois, a frase não manda
                      // "conferir sua lista de pedidos": quem compra sem
                      // conta não tem, aqui, nem o id do pedido nem o
                      // comprovante que o "Ver meus pedidos" exige
                      // (OrderSearch.tsx:80-85) — mandar conferir algo
                      // impossível só empurrava para "então fecha e tenta de
                      // novo", que é o pedido em dobro que esta trava existe
                      // para evitar. Por isso a frase não afirma nenhum
                      // estado de tela: só instrui a saída, para quem já tem
                      // certeza.
                      <p
                        data-testid="aviso-como-destravar-finalizar"
                        className="mx-auto mt-1.5 flex max-w-md items-start gap-1.5 text-[11px] font-bold uppercase text-red-500"
                      >
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        Só feche o aviso abaixo se tiver certeza de que o pedido
                        não foi criado
                      </p>
                    )}
                    {recusaDoUltimoClique && (
                      // Fica ao lado do botão que acabou de falhar, de
                      // propósito: é onde a pessoa está olhando no instante da
                      // recusa. O toast avisa; este painel é o que dá a saída.
                      <div className="mx-auto max-w-md">
                        <SaidaDaRecusa
                          recusa={recusaDoUltimoClique}
                          onAgir={agirNaRecusa}
                          onFechar={() => setRecusaDoUltimoClique(null)}
                        />
                      </div>
                    )}
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </>,
          document.body,
        )}
    </div>
  );
}

// Sub-components to reduce cognitive complexity

interface SuccessViewProps {
  orderId: string;
  appliedCoupon: { code: string; discount: number } | null;
  discount: number;
  onNavigate: (view: View, productId?: string) => void;
}

function SuccessView({
  orderId,
  appliedCoupon,
  discount,
  onNavigate,
}: Readonly<SuccessViewProps>) {
  return (
    <div className="pb-customer flex min-h-full flex-col items-center justify-center bg-white px-6 text-center">
      <div className="group relative mb-12">
        <div className="absolute inset-0 scale-[2.5] rounded-2xl bg-emerald-100 opacity-30 blur-3xl transition-opacity duration-1000 group-hover:opacity-50" />
        <div className="relative flex size-32 items-center justify-center rounded-2xl border-4 border-white bg-emerald-50 shadow-2xl transition-transform duration-700 group-hover:scale-110">
          <Check className="size-14 text-emerald-500" />
        </div>
        <div className="absolute -right-4 -top-4 size-8 animate-pulse rounded-full bg-amber-400 blur-xl" />
        <div className="absolute -bottom-2 -left-2 size-6 animate-pulse rounded-full bg-primary/30 blur-lg delay-500" />
      </div>

      <h2 className="mb-4 text-4xl font-black leading-tight tracking-tighter text-zinc-900 duration-700 animate-in slide-in-from-bottom-4">
        Pedido Celebrado!
      </h2>

      <div className="mb-12 space-y-4 duration-1000 animate-in fade-in slide-in-from-bottom-8">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">
          Identificador:{" "}
          <span className="text-zinc-900">
            #{orderId.slice(-6).toUpperCase()}
          </span>
        </p>
        <div className="mx-auto max-w-[300px]">
          <p className="text-sm font-medium leading-relaxed text-zinc-500">
            Sua escolha premium foi registrada. Agora, nossa equipe cuidará de
            cada detalhe da logística.
          </p>
        </div>
        {appliedCoupon && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-100/50 bg-emerald-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700">
            Vantagem Ativa: R$ {discount.toFixed(2).replace(".", ",")} OFF
          </div>
        )}
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4 duration-1000 animate-in slide-in-from-bottom-12">
        <button
          onClick={() => onNavigate("home")}
          className="shadow-3xl flex h-16 items-center justify-center gap-3 rounded-2xl bg-primary text-[11px] font-black uppercase tracking-[0.3em] text-white shadow-black/10 transition-all hover:bg-primary/90 active:scale-95"
        >
          Retornar à Vitrine
          <ArrowLeft className="size-5 rotate-180" />
        </button>
        <button
          onClick={() => onNavigate("orders")}
          className="flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95"
        >
          Ver Meus Pedidos
        </button>
      </div>
    </div>
  );
}

// CHECKOUT-090: tela de PIX confirmado. Mesmo padrão visual do SuccessView
// (ícone de check em círculo esmeralda, hierarquia de texto, dois botões de
// saída) — sem redesenho. Diferente do SuccessView (pedido pago na entrega,
// nada a confirmar), aqui existiu de fato um pagamento online recebido, daí
// o valor pago em destaque.
interface PagamentoConfirmadoViewProps {
  orderId: string;
  valor: number;
  onNavigate: (view: View, productId?: string) => void;
}

function PagamentoConfirmadoView({
  orderId,
  valor,
  onNavigate,
}: Readonly<PagamentoConfirmadoViewProps>) {
  return (
    <div className="pb-customer flex min-h-full flex-col items-center justify-center bg-white px-6 text-center">
      <div className="group relative mb-12">
        <div className="absolute inset-0 scale-[2.5] rounded-2xl bg-emerald-100 opacity-30 blur-3xl transition-opacity duration-1000 group-hover:opacity-50" />
        <div className="relative flex size-32 items-center justify-center rounded-2xl border-4 border-white bg-emerald-50 shadow-2xl transition-transform duration-700 group-hover:scale-110">
          <Check className="size-14 text-emerald-500" />
        </div>
        <div className="absolute -right-4 -top-4 size-8 animate-pulse rounded-full bg-amber-400 blur-xl" />
        <div className="absolute -bottom-2 -left-2 size-6 animate-pulse rounded-full bg-primary/30 blur-lg delay-500" />
      </div>

      <h2 className="mb-4 text-4xl font-black leading-tight tracking-tighter text-zinc-900 duration-700 animate-in slide-in-from-bottom-4">
        Pagamento Confirmado!
      </h2>

      <div className="mb-12 space-y-4 duration-1000 animate-in fade-in slide-in-from-bottom-8">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">
          Pedido:{" "}
          <span className="text-zinc-900">
            #{orderId.slice(-6).toUpperCase()}
          </span>
        </p>
        <p className="text-lg font-black text-emerald-700">
          R$ {valor.toFixed(2).replace(".", ",")} recebido
        </p>
        <div className="mx-auto max-w-[300px]">
          <p className="text-sm font-medium leading-relaxed text-zinc-500">
            Seu pagamento foi confirmado e a loja já está preparando seu pedido.
          </p>
        </div>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4 duration-1000 animate-in slide-in-from-bottom-12">
        <button
          onClick={() => onNavigate("orders")}
          className="shadow-3xl flex h-16 items-center justify-center gap-3 rounded-2xl bg-primary text-[11px] font-black uppercase tracking-[0.3em] text-white shadow-black/10 transition-all hover:bg-primary/90 active:scale-95"
        >
          Ver Meus Pedidos
        </button>
        <button
          onClick={() => onNavigate("home")}
          className="flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95"
        >
          Retornar à Vitrine
        </button>
      </div>
    </div>
  );
}

// CHECKOUT-090: tela do pagamento recebido DEPOIS que o prazo de reserva
// venceu. Decisão de produto do Gabriel (16/08/2026, tomada explicitamente
// com ele — texto abaixo NÃO é redação livre): "Recebemos seu pagamento,
// mas o prazo de reserva venceu. A loja vai te contatar em breve para
// confirmar ou devolver o valor." Honesto, não promete o que talvez não
// possa cumprir, e evita que a pessoa pague de novo achando que falhou.
//
// Por trás: `payment_status = 'pago_apos_expirar'` significa que a
// varredura do prazo já marcou `status='cancelled'` e já devolveu o
// estoque (20260807000000_reserva_com_expiracao.sql:113-116) — a
// mercadoria pode já ter sido vendida a outra pessoa. Um humano decide
// caso a caso (spec do webhook, linha 136): reativa se ainda tiver a
// mercadoria, ou estorna pelo painel do MP se não tiver. Por isso esta
// tela NUNCA promete entrega, preparo, envio ou prazo — só que o dinheiro
// chegou e que alguém vai falar com o cliente. Visual deliberadamente
// distinto do sucesso (âmbar, não esmeralda; ícone de alerta, não de
// check): isto não é uma comemoração.
interface PagamentoForaDoPrazoViewProps {
  orderId: string;
  valor: number;
  onNavigate: (view: View, productId?: string) => void;
}

function PagamentoForaDoPrazoView({
  orderId,
  valor,
  onNavigate,
}: Readonly<PagamentoForaDoPrazoViewProps>) {
  const { config } = useStore();

  // Mesmo mecanismo de contato já usado em OrderDetailsView, ProductView e
  // ProfileView (wa.me com DDI 55 prefixado para número de 10 ou 11
  // dígitos) — não um novo. `numeroLimpo` vazio (config.whatsappNumber não
  // configurado) desliga o botão em vez de abrir um link quebrado.
  const numeroLimpo = (config.whatsappNumber || "").replace(/\D/g, "");
  // Laudo 31/08 (C1, ressalva 1 da revisão do PR #367): a régua deste ponto
  // era mais fraca (`!numeroLimpo` aceitava até 1 dígito) e abria
  // `wa.me/` quebrado. Mesma régua única dos outros 4 pontos.
  const lojaTemWhatsappAgora = lojaTemWhatsapp(config.whatsappNumber);

  const handleFalarComALoja = () => {
    if (!lojaTemWhatsappAgora) return;
    let phone = numeroLimpo;
    if (phone.length === 11 || phone.length === 10) {
      phone = `55${phone}`;
    }
    const mensagem = `Olá! Paguei o pedido #${orderId.slice(-6).toUpperCase()}, mas o prazo de reserva venceu. Podem me ajudar?`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(mensagem)}`;
    globalThis.open(url, "_blank");
  };

  return (
    <div className="pb-customer flex min-h-full flex-col items-center justify-center bg-white px-6 text-center">
      <div className="group relative mb-12">
        <div className="absolute inset-0 scale-[2.5] rounded-2xl bg-amber-100 opacity-30 blur-3xl transition-opacity duration-1000 group-hover:opacity-50" />
        <div className="relative flex size-32 items-center justify-center rounded-2xl border-4 border-white bg-amber-50 shadow-2xl transition-transform duration-700 group-hover:scale-110">
          <AlertCircle className="size-14 text-amber-500" />
        </div>
      </div>

      <h2 className="mb-4 text-4xl font-black leading-tight tracking-tighter text-zinc-900 duration-700 animate-in slide-in-from-bottom-4">
        Pagamento Recebido
      </h2>

      <div className="mb-12 space-y-4 duration-1000 animate-in fade-in slide-in-from-bottom-8">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">
          Pedido:{" "}
          <span className="text-zinc-900">
            #{orderId.slice(-6).toUpperCase()}
          </span>
        </p>
        <p className="text-lg font-black text-amber-600">
          R$ {valor.toFixed(2).replace(".", ",")} recebido
        </p>
        <div className="mx-auto max-w-[300px]">
          <p className="text-sm font-medium leading-relaxed text-zinc-500">
            Recebemos seu pagamento, mas o prazo de reserva venceu. A loja vai
            te contatar em breve para confirmar ou devolver o valor.
          </p>
        </div>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4 duration-1000 animate-in slide-in-from-bottom-12">
        {numeroLimpo && (
          <button
            onClick={handleFalarComALoja}
            className="shadow-3xl flex h-16 items-center justify-center gap-3 rounded-2xl bg-amber-500 text-[11px] font-black uppercase tracking-[0.3em] text-white shadow-black/10 transition-all hover:bg-amber-500/90 active:scale-95"
          >
            Falar com a Loja
          </button>
        )}
        <button
          onClick={() => onNavigate("orders")}
          className="flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95"
        >
          Ver Meus Pedidos
        </button>
        <button
          onClick={() => onNavigate("home")}
          className="flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95"
        >
          Retornar à Vitrine
        </button>
      </div>
    </div>
  );
}

interface AddressSelectionViewProps {
  editingAddressId: string | null;
  addresses: Address[];
  onNewAddressSubmit: (data: Omit<Address, "id" | "user_id">) => Promise<void>;
  onCancel: () => void;
}

function AddressSelectionView({
  editingAddressId,
  addresses,
  onNewAddressSubmit,
  onCancel,
}: Readonly<AddressSelectionViewProps>) {
  return (
    <div className="min-h-screen bg-white pb-16 duration-500 animate-in slide-in-from-right">
      <div className="mx-auto max-w-md p-4">
        <div className="group relative mb-5 overflow-hidden rounded-2xl bg-primary p-5 shadow-lg">
          <div className="absolute right-0 top-0 -mr-16 -mt-16 size-32 rounded-full bg-white/5 blur-2xl transition-colors group-hover:bg-white/10" />
          <div className="absolute bottom-0 left-0 -mb-12 -ml-12 size-24 rounded-full bg-white/5 blur-xl" />

          <div className="relative z-10 flex flex-col">
            <h2 className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
              {editingAddressId ? "Editar Endereço" : "Novo Endereço"}
              <Sparkles className="size-4.5 animate-pulse text-amber-400" />
            </h2>
            <p className="text-[10px] font-bold uppercase leading-tight tracking-wider text-white/80">
              {editingAddressId
                ? "Atualize os dados para entrega"
                : "Onde entregaremos seu produto?"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
          <AddressForm
            initialData={
              editingAddressId
                ? addresses.find((a) => a.id === editingAddressId)
                : undefined
            }
            onSubmit={onNewAddressSubmit}
            onCancel={onCancel}
          />
        </div>

        <div className="mt-8 px-6 text-center">
          <p className="text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-300">
            Seus dados estão seguros e serão usados apenas para a logística de
            entrega.
          </p>
        </div>
      </div>
    </div>
  );
}
