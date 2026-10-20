import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import { SecaoRecolhivel } from "@/components/admin/primitivos/SecaoRecolhivel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useVOR } from "@/hooks/useVOR";
import { destinoDaUrl, urlDoDestino } from "@/lib/destino-do-aviso";
import {
  LIMITE_DA_BUSCA_DO_HISTORICO,
  somenteCampanhasReais,
} from "@/lib/historico-de-campanhas";
import {
  type CupomDaLoja,
  MARCADOR_DO_CUPOM,
  MODELOS_DE_CAMPANHA,
  codigosDeCupomCitados,
  filtroDosCodigosCitados,
  mensagemDoProblemaDoCupom,
  problemaDoCupom,
  temMarcadorPendente,
} from "@/lib/modelos-de-campanha";
import { supabase } from "@/lib/supabase";
import { normalizeText } from "@/lib/utils";
import type { View } from "@/types";
import {
  type ContagemMedida,
  rotuloDaContagem,
  textoDeAlcanceEmAparelhos,
} from "@/utils/contadores-de-push";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Gift,
  HelpCircle,
  History,
  Home,
  Inbox,
  LockKeyhole,
  Moon,
  MousePointer2,
  Pencil,
  Percent,
  Send,
  Settings,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Target,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Selos locais: a cor identifica a função, sem competir com a seleção. */
function SeloDeIcone({
  icone: Icone,
  matiz,
  indisponivel = false,
  className = "size-[38px] rounded-xl",
}: {
  readonly icone: React.ElementType;
  readonly matiz: string;
  readonly indisponivel?: boolean;
  readonly className?: string;
}) {
  const cor = indisponivel ? "#7E7E8A" : matiz;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center border ${className}`}
      style={{
        color: cor,
        backgroundColor: `${cor}26`,
        borderColor: `${cor}40`,
      }}
    >
      <Icone className="size-5" strokeWidth={1.9} />
    </span>
  );
}

function TituloDeSecao({
  icone: Icone,
  children,
}: {
  readonly icone: React.ElementType;
  readonly children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-zinc-400">
      <Icone aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </h2>
  );
}

/**
 * Seção colapsável da tela de Avisar clientes (frente
 * glm-visual-canais-avisar-0309): o mesmo padrão da `SecaoColapsavel` dos
 * Ajustes — cabeçalho clicável com `aria-expanded`, conteúdo montado só
 * quando aberta e trava de pendência ("Salve antes de fechar": fechar
 * desmonta o conteúdo e jogaria fora o que foi digitado). Local a este
 * arquivo de propósito, com a superfície neutra usada nesta tela.
 *
 * `extra`: selo exibido na linha do cabeçalho (ex.: o "Receberão: N
 * aparelhos" da seção de escrita — a informação fica à vista mesmo com o
 * conteúdo recolhido).
 */
function SecaoColapsavel({
  titulo,
  descricao,
  icone: Icone,
  abertaPorPadrao = false,
  comPendencia = false,
  extra,
  children,
}: {
  readonly titulo: string;
  readonly descricao?: string;
  readonly icone: React.ElementType;
  readonly abertaPorPadrao?: boolean;
  readonly comPendencia?: boolean;
  readonly extra?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(abertaPorPadrao);
  const reduzirMovimento = useReducedMotion();

  return (
    <div className="rounded-[20px] border border-white/[0.08] bg-admin-card p-4">
      <button
        type="button"
        onClick={() => {
          if (aberta && comPendencia) return;
          setAberta(!aberta);
        }}
        aria-expanded={aberta}
        className="flex min-h-12 w-full flex-wrap items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-admin-border bg-white/5 text-zinc-400">
            <Icone className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold uppercase tracking-wider text-zinc-300">
              {titulo}
            </span>
            {descricao ? (
              <span className="mt-0.5 block text-xs text-zinc-400">
                {descricao}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {extra}
          {aberta && comPendencia && (
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">
              Salve antes de fechar
            </span>
          )}
          <ChevronDown
            className={`size-4 shrink-0 text-zinc-400 transition-transform duration-200 motion-reduce:transition-none ${
              aberta ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {aberta && (
          <motion.div
            initial={reduzirMovimento ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              duration: reduzirMovimento ? 0 : 0.22,
              ease: "easeOut",
            }}
            className="overflow-hidden"
          >
            <div className="pt-3.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface AdminPushViewProps {
  onNavigate: (view: View, id?: string) => void;
  targetUserId?: string;
  onSetDirty?: (dirty: boolean) => void;
}

/**
 * Ícone da loja para a prévia — o ÍCONE CADASTRADO da loja
 * (`config.logoUrl`), com fallback honesto: sem logo (ou logo que não
 * carrega), o monograma da loja em neutro escuro — o card real da
 * notificação do Android é neutro, e a prévia promete ser o que o cliente
 * vê. Nunca um emoji genérico.
 */
function IconeDaLoja({
  logoUrl,
  nome,
}: {
  readonly logoUrl?: string | null;
  readonly nome: string;
}) {
  const [falhou, setFalhou] = useState(false);
  if (!logoUrl || falhou) {
    const inicial = nome.trim().charAt(0).toUpperCase() || "?";
    return (
      <div
        aria-hidden="true"
        className="flex size-full items-center justify-center bg-black text-sm font-black text-zinc-100"
      >
        {inicial}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt=""
      onError={() => setFalhou(true)}
      className="size-full object-cover"
    />
  );
}

/** Prévia de apresentação: relógio local e a mesma identidade da loja. */
function PreviaNoCelular({
  title,
  body,
  logoUrl,
  nomeLoja,
}: {
  readonly title: string;
  readonly body: string;
  readonly logoUrl?: string | null;
  readonly nomeLoja?: string | null;
}) {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(new Date()), 60_000);
    return () => window.clearInterval(relogio);
  }, []);
  const hora = agora.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const data = agora.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const nome = (nomeLoja ?? "").trim() || "Sua loja";

  return (
    <div data-testid="previa-celular" className="min-w-0">
      <div className="relative mx-auto min-w-0 w-full max-w-[360px] overflow-hidden rounded-[32px] border border-white/[0.14] bg-gradient-to-b from-[#2A2A33] to-[#0D0D11] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.2)] sm:p-5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-12 left-1/4 h-28 w-1/2 rounded-full bg-white/[0.13] blur-3xl"
        />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-200">
            <span className="size-1.5 rounded-full bg-admin-accent" />
            <Smartphone aria-hidden="true" className="size-[13px]" />
            Prévia ao vivo
          </span>
          <p className="mt-5 text-center text-sm text-zinc-300">{data}</p>
          <p className="mt-1 text-center text-[52px] font-light leading-tight tabular-nums tracking-tight text-white">
            {hora}
          </p>
          <div className="mt-5 flex items-start gap-3 rounded-[22px] border border-white/[0.17] bg-white/[0.12] p-3.5 shadow-lg backdrop-blur-xl">
            <div className="size-11 shrink-0 overflow-hidden rounded-[11px] bg-black ring-1 ring-white/10">
              <IconeDaLoja logoUrl={logoUrl} nome={nome} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-xs text-zinc-200">
                <span className="min-w-0 truncate">{nome}</span>
                <span className="shrink-0">agora</span>
              </div>
              <p
                className={`mt-1 break-words text-[15px] font-bold leading-snug [overflow-wrap:anywhere] ${title ? "text-white" : "text-zinc-200"}`}
              >
                {title || "Título da notificação aqui"}
              </p>
              <p
                className={`mt-1 break-words text-sm leading-relaxed [overflow-wrap:anywhere] ${body ? "text-zinc-100" : "text-zinc-200"}`}
              >
                {body || "O texto digitado aparece aqui."}
              </p>
            </div>
          </div>
          <p className="mt-4 text-center text-xs leading-relaxed text-zinc-400">
            É assim que chega no celular do cliente.
          </p>
        </div>
      </div>
    </div>
  );
}

// Escondida: nada na vitrine nem no servidor lê `realTimeSalesAlerts`, então a
// chave prometia "avisos de compras" que a loja nunca mostra. A configuração
// guardada segue intacta; religar = trocar para `true` quando o recurso existir.
const MOSTRAR_AVISOS_DE_COMPRAS: boolean = false;

/**
 * Confere na tabela de cupons da loja os códigos que o texto cita. Devolve as
 * frases de problema (uma por código) — lista vazia = tudo certo. Se a
 * consulta falhar, o desconhecido NÃO vira "tudo certo": devolve um aviso de
 * que não deu para conferir (a tela deixa a lojista decidir, nunca envia
 * calada). Só roda quando o texto cita um código; sem citação, nem consulta.
 */
async function avisosDosCuponsCitados(codigos: string[]): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("coupons")
      .select("code, active, valid_until, usage_limit, usage_count")
      .or(filtroDosCodigosCitados(codigos));
    if (error) throw error;
    const cupons = (data ?? []) as CupomDaLoja[];
    const agora = new Date();
    const avisos: string[] = [];
    for (const codigo of codigos) {
      const problema = problemaDoCupom(codigo, cupons, agora);
      if (problema) avisos.push(mensagemDoProblemaDoCupom(codigo, problema));
    }
    return avisos;
  } catch (err) {
    console.error("Erro ao conferir os cupons citados:", err);
    return ["Não consegui conferir se o cupom citado existe na sua loja"];
  }
}

export const AdminPushView = memo(function AdminPushView({
  onNavigate,
  targetUserId,
  onSetDirty,
}: AdminPushViewProps) {
  const { user } = useAuth();
  const isOffline = useOnlineStatus();
  const { config, isLoaded: configLoaded, updateConfig } = useStore();
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [isSocialProofExpanded, setIsSocialProofExpanded] = useState(false);

  const handleToggleRealTimeSalesAlerts = async (checked: boolean) => {
    if (isOffline) {
      toast.error("Você está offline");
      return;
    }
    setIsUpdatingConfig(true);
    try {
      // O toast de erro sai de dentro do `updateConfig`; aqui só não se segue
      // em frente. Antes o retorno era `void` e o sucesso era anunciado mesmo
      // quando a gravação falhava (ADMIN-010, #94).
      const salvou = await updateConfig({ realTimeSalesAlerts: checked });
      if (!salvou) return;
      toast.success(
        checked
          ? "Notificações de prova social ativadas"
          : "Notificações de prova social desativadas",
      );
    } catch (err) {
      console.error(err);
      toast.error("Erro ao atualizar a configuração");
    } finally {
      setIsUpdatingConfig(false);
    }
  };
  const [loading, setLoading] = useState(false);
  // Texto (título + corpo) para o qual a tela JÁ avisou que o cupom citado não
  // confere. O segundo toque no enviar, com o mesmo texto, segue: quem insiste
  // sabe o que faz (o aviso é de apoio, a leitura do texto é heurística).
  const textoJaAvisadoDeCupom = useRef<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  // O quarto contador (achado do revisor sobre o commit 6e406b4, em
  // 20/08/2026): nascia em `useState(0)` e o `if (!error) setSubCount(...)`
  // não fazia nada quando a consulta falhava — ficava preso em 0 para
  // sempre, indistinguível de uma loja sem ninguém cadastrado. `null` é
  // "ainda não medi ou não consegui medir"; `0` só aparece depois que o
  // banco respondeu de verdade. Mesma convenção de `segmentCounts` acima.
  const [subCount, setSubCount] = useState<ContagemMedida>(null);
  const [notification, setNotification] = useState({
    title: "",
    body: "",
    url: "/",
  });
  const notificationAtualRef = useRef(notification);
  useEffect(() => {
    notificationAtualRef.current = notification;
  }, [notification]);

  const limparMensagemEnviada = (enviada: typeof notification) => {
    const aindaEhEnviada = (atual: typeof notification) =>
      atual.title === enviada.title &&
      atual.body === enviada.body &&
      atual.url === enviada.url;
    // A conclusão de X não pode apagar Y, escolhida enquanto o envio aguardava.
    if (!aindaEhEnviada(notificationAtualRef.current)) return;
    setNotification((atual) =>
      aindaEhEnviada(atual) ? { title: "", body: "", url: "/" } : atual,
    );
    setCustomPath("");
  };

  const { isSupported, subscribe } = usePushNotifications();
  const { recordAction } = useVOR();
  const [isTestSubscribed, setIsTestSubscribed] = useState(false);
  const [segment, setSegment] = useState("all");
  // O quinto contador (achado do revisor sobre a correção do quarto, em
  // 20/08/2026): igual a `subCount`, nascia em `useState(0)` e o
  // `if (!error && data)` de `calculateReach` não fazia nada quando a RPC
  // falhava — o valor medido para o segmento ANTERIOR sobrevivia à falha do
  // segmento seguinte. `null` é "ainda não medi este segmento, ou não
  // consegui".
  const [predictedReach, setPredictedReach] = useState<ContagemMedida>(null);
  const rodadaDoAlcanceRef = useRef(0);
  const [history, setHistory] = useState<any[] | null>(null);
  const [targetUserName, setTargetUserName] = useState<{
    id: string;
    nome: string | null;
  } | null>(null);
  const [destType, setDestType] = useState<string>("home");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [customPath, setCustomPath] = useState<string>("");
  const [filtroDeProduto, setFiltroDeProduto] = useState("");
  const [products, setProducts] = useState<{ id: string; nome: string }[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  useEffect(() => {
    const loadProducts = async () => {
      setLoadingProducts(true);
      try {
        const { data, error } = await supabase
          .from("vw_produtos_public")
          .select("id, nome")
          .eq("ativo", true)
          .order("nome", { ascending: true });
        if (!error && data) {
          const validProducts = (data as any[])
            .filter((p) => p.id && p.nome)
            .map((p) => ({ id: p.id as string, nome: p.nome as string }));
          setProducts(validProducts);
          if (validProducts.length > 0) {
            setSelectedProductId(validProducts[0].id);
          }
        }
      } catch (err) {
        console.error("Erro ao carregar produtos:", err);
      } finally {
        setLoadingProducts(false);
      }
    };
    loadProducts();
  }, []);

  // A URL de cada destino mora em `src/lib/destino-do-aviso.ts` (função pura,
  // com a tabela de URLs presa em teste): este componente só guarda a escolha.
  const updateUrl = (type: string, prodId: string, custom: string) => {
    setNotification((prev) => ({
      ...prev,
      url: urlDoDestino(type, prodId, custom),
    }));
  };

  const handleDestTypeChange = (type: string) => {
    setDestType(type);
    // O caminho manual (Avançado) só vale enquanto "Outra página" é o destino:
    // escolher uma tela da lista o esvazia para o campo não mostrar um caminho
    // que o aviso já não leva.
    setCustomPath("");
    updateUrl(type, selectedProductId, "");
  };

  const handleProductChange = (prodId: string) => {
    setSelectedProductId(prodId);
    updateUrl(destType, prodId, customPath);
  };

  // Digitar no Avançado É escolher a "outra página": o destino vira `custom`.
  // Campo vazio volta para a página inicial (a URL "" é lida como "home").
  // O campo devolve o valor também ao perder o foco SEM mudança, e ele existe
  // sempre (o Avançado só o esconde): sem a guarda, focar e sair viraria
  // "escolhi outra página" e zeraria o destino já escolhido na lista.
  const handleCustomPathChange = (val: string) => {
    if (val === customPath) return;
    setCustomPath(val);
    setDestType("custom");
    updateUrl("custom", selectedProductId, val);
  };

  useEffect(() => {
    const destino = destinoDaUrl(notification.url);
    if (destType !== destino.tipo) setDestType(destino.tipo);
    if (
      destino.idDoProduto !== null &&
      selectedProductId !== destino.idDoProduto
    )
      setSelectedProductId(destino.idDoProduto);
    if (destino.caminho !== null && customPath !== destino.caminho)
      setCustomPath(destino.caminho);
    // O destino virou uma tela da lista (ex.: um modelo pronto): o caminho
    // manual que sobrou não é mais o do aviso. Um caminho que é a própria URL
    // (digitou "/cart" à mão) fica como está.
    if (
      destino.tipo !== "custom" &&
      customPath !== "" &&
      customPath !== notification.url
    )
      setCustomPath("");
  }, [notification.url]);

  // Produtos que o filtro por nome deixa à vista. O produto já escolhido fica
  // sempre na lista: sem ele o seletor ficaria vazio enquanto o aviso sairia
  // com aquele produto.
  const produtosVisiveis = (() => {
    const termo = normalizeText(filtroDeProduto);
    if (!termo) return products;
    return products.filter(
      (p) =>
        p.id === selectedProductId || normalizeText(p.nome).includes(termo),
    );
  })();

  useEffect(() => {
    let superada = false;
    setTargetUserName(null);
    if (targetUserId) {
      setSegment(targetUserId);
      const fetchUserName = async () => {
        const { data, error } = await supabase
          .from("public_profiles")
          .select("full_name")
          .eq("id", targetUserId)
          .single();
        if (!superada && !error && data) {
          setTargetUserName({ id: targetUserId, nome: data.full_name });
        }
      };
      fetchUserName();
    } else {
      setSegment("all");
    }
    return () => {
      superada = true;
    };
  }, [targetUserId]);

  const fetchSubscribers = useCallback(async () => {
    const { count, error } = await supabase
      .from("push_subscriptions")
      .select("*", { count: "exact", head: true });

    // Consulta falhou: `null`, nunca `0` — zero é a afirmação de que a loja
    // não tem ninguém cadastrado, e isso só se pode dizer depois de medir.
    setSubCount(error ? null : (count ?? 0));
  }, []);

  const fetchHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from("push_notifications_log")
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(LIMITE_DA_BUSCA_DO_HISTORICO);

    // PAINEL-08: `null` em falha — `history` nasce `[]` e o render
    // exibia "Nenhuma mensagem enviada" para uma falha de rede. O
    // subCount ao lado (linha 244) já usava null; o histórico não.
    //
    // Só campanhas: as linhas "Sua pergunta/avaliação foi respondida!" que as
    // RPCs de resposta da loja gravam neste log não são envio nenhum — a
    // busca traz mais linhas do que a tela mostra para que elas não ocupem os
    // 20 lugares das campanhas (src/lib/historico-de-campanhas.ts).
    setHistory(error || !data ? null : somenteCampanhasReais(data));
  }, []);

  // Achado 6 da auditoria de 20/08/2026: dos quatro botões de público, só o
  // segmento SELECIONADO era medido de verdade — os outros três eram
  // `subCount * 0,3 / 0,25 / 0,45`, escritos aqui no componente. Agora os
  // três não selecionados também vêm da mesma RPC que já mede o
  // selecionado (`get_segmented_push_targets`), e `null` (medição ainda não
  // chegou, ou falhou) não vira zero — vira traço no rótulo
  // (`rotuloDaContagem`). Zero é uma afirmação forte demais para chutar.
  const [segmentCounts, setSegmentCounts] = useState<{
    vip: ContagemMedida;
    inactive: ContagemMedida;
    new: ContagemMedida;
  }>({ vip: null, inactive: null, new: null });

  const fetchSegmentCounts = useCallback(async () => {
    const segmentosNaoSelecionaveisPeloTodos = [
      "vip",
      "inactive",
      "new",
    ] as const;
    // Laudo 29/08 (achado config 18): medir público não precisa baixar a
    // credencial de envio de cada aparelho. `get_segmented_push_count`
    // replica os filtros da `get_segmented_push_targets` e devolve só o
    // número — a original fica para o ENVIO, que precisa das linhas.
    const resultados = await Promise.all(
      segmentosNaoSelecionaveisPeloTodos.map(async (seg) => {
        try {
          const { data, error } = await (supabase.rpc as any)(
            "get_segmented_push_count",
            { p_segment: seg },
          );
          if (error || data === null || data === undefined) return null;
          return Number(data);
        } catch (err) {
          console.error(`Erro ao medir o segmento ${seg}:`, err);
          return null;
        }
      }),
    );
    setSegmentCounts({
      vip: resultados[0],
      inactive: resultados[1],
      new: resultados[2],
    });
  }, []);

  useEffect(() => {
    fetchSubscribers();
    fetchHistory();
    fetchSegmentCounts();
  }, [fetchSubscribers, fetchHistory, fetchSegmentCounts]);

  const calculateReach = useCallback(async () => {
    const rodada = ++rodadaDoAlcanceRef.current;
    if (segment === "all") {
      // `predictedReach` só é lido quando `segment !== "all"` (ver
      // `effectiveReach`/`reachExibido`), então este valor nunca aparece na
      // tela para "all" — mas mantém os dois em sincronia mesmo assim.
      setPredictedReach(subCount);
      return;
    }

    // Zera ANTES do `await`: enquanto a nova medição está no ar, ou se ela
    // falhar, o valor do segmento ANTERIOR não pode sobreviver — senão a
    // tela mostra, para o segmento recém-selecionado, um número que nunca
    // foi medido para ele (achado do revisor sobre a correção do quarto
    // contador, 20/08/2026).
    setPredictedReach(null);
    try {
      // Mesma emenda da medição dos segmentos: a previsão de alcance é um
      // número — a função de contagem devolve ele sem baixar credencial.
      const { data, error } = await (supabase.rpc as any)(
        "get_segmented_push_count",
        {
          p_segment: segment,
        },
      );
      if (rodada !== rodadaDoAlcanceRef.current) return;
      if (!error && data !== null && data !== undefined) {
        setPredictedReach(Number(data));
      } else {
        setPredictedReach(null);
      }
    } catch (err) {
      if (rodada !== rodadaDoAlcanceRef.current) return;
      console.error("Error calculating reach:", err);
      setPredictedReach(null);
    }
  }, [segment, subCount]);

  useEffect(() => {
    calculateReach();
  }, [calculateReach]);

  // Achado 3 (menor) da revisão cruzada do PR 549 (recado 20260912-2320):
  // as contagens dos chips nasciam SÓ no efeito de montagem — e o chip de
  // zero nasce desativado, então "cliente novo cadastrou com a tela aberta"
  // deixava o chip travado no zero para sempre, sem caminho de remedir (o
  // clique que remedeia a medição só existe para chip ativo; antes do rádio
  // era assim que se remedava). Remede-se do jeito barato: o foco voltando
  // à janela/aba mede os segmentos de novo. O desenho aprovado na direção B
  // (zero desativado com o motivo na cara) segue igual — só a MEDIDA deixa
  // de congelar.
  //
  // Achado do bot de revisão do GitHub sobre o ef4c1ee: o foco remediava só
  // os segmentos — o público "Todos" (`subCount`) e o alcance do segmento
  // selecionado (`predictedReach`) congelavam na mesma situação. Agora o
  // foco remedeia os três. (O bloco mora DEPOIS do `calculateReach` porque
  // o array de dependências o lê — declará-lo acima seria TDZ.)
  useEffect(() => {
    const remedirAoVoltar = () => {
      if (document.visibilityState === "visible") {
        fetchSegmentCounts();
        fetchSubscribers();
        if (segment !== "all") {
          calculateReach();
        }
      }
    };
    window.addEventListener("focus", remedirAoVoltar);
    document.addEventListener("visibilitychange", remedirAoVoltar);
    return () => {
      window.removeEventListener("focus", remedirAoVoltar);
      document.removeEventListener("visibilitychange", remedirAoVoltar);
    };
  }, [fetchSubscribers, fetchSegmentCounts, calculateReach, segment]);

  // Rascunho não enviado = pendência para o APP (onSetDirty): é guarda de
  // navegação — sair da tela com texto não enviado avisa antes de perder.
  // A composição é cartão fixo (nada desmonta o formulário), então o
  // comentário anterior — que dizia "fechar desmontaria e descartaria o
  // rascunho" — afirmava uma perda que o código nunca produziu (revisão do
  // lote B, 12/09/2026).
  const rascunhoPendente =
    notification.title.trim().length > 0 || notification.body.trim().length > 0;

  useEffect(() => {
    if (!onSetDirty) return;
    onSetDirty(rascunhoPendente);
    return () => {
      onSetDirty(false);
    };
  }, [rascunhoPendente, onSetDirty]);

  const handleTestSubscription = async () => {
    if (isOffline) {
      toast.error("Você está offline", {
        description:
          "Não é possível se inscrever para notificações de teste sem conexão.",
      });
      return;
    }
    try {
      await subscribe();
      setIsTestSubscribed(true);
      fetchSubscribers();
    } catch {
      // Error handled in hook
    }
  };

  const handleSend = async () => {
    if (isOffline) {
      toast.error("Você está offline", {
        description: "Não é possível enviar notificações push sem conexão.",
      });
      return;
    }
    if (!notification.title || !notification.body) {
      toast.error("Preencha título e mensagem");
      return;
    }
    // O botão já fica travado com o marcador no texto; esta guarda cobre o
    // caminho em que o clique chega mesmo assim. "[CÓDIGO DO SEU CUPOM]" nunca
    // vai para o celular de cliente.
    if (temMarcadorPendente(notification.title, notification.body)) {
      toast.error("Troque o marcador pelo código do seu cupom", {
        description: `Troque ${MARCADOR_DO_CUPOM} pelo código do cupom que você criou em Cupons.`,
      });
      return;
    }

    // O objeto deste render é o instantâneo usado por todo o envio.
    const mensagemEnviada = notification;
    setLoading(true);
    try {
      if (!user) throw new Error("Administrador não autenticado");

      // Promessa de cupom: se o texto cita um código, a loja precisa ter esse
      // cupom ativo — senão a cliente digita e lê "O cupom X não existe".
      const codigosCitados = codigosDeCupomCitados(
        notification.title,
        notification.body,
      );
      const chaveDoTexto = `${notification.title}\n${notification.body}`;
      if (
        codigosCitados.length > 0 &&
        textoJaAvisadoDeCupom.current !== chaveDoTexto
      ) {
        const avisos = await avisosDosCuponsCitados(codigosCitados);
        if (avisos.length > 0) {
          textoJaAvisadoDeCupom.current = chaveDoTexto;
          toast.error(avisos.join(". "), {
            description:
              "Crie ou ative o cupom em Cupons, ou troque o código no texto. Se está tudo certo, toque em enviar de novo.",
            duration: 10000,
          });
          return;
        }
      }

      const { data: targets, error: targetError } = await (supabase.rpc as any)(
        "get_segmented_push_targets",
        {
          p_segment: segment,
        },
      );

      if (targetError) throw targetError;

      const targetList = targets as any[];
      const finalRecipientCount = targetList?.length || 0;

      if (finalRecipientCount === 0) {
        // Achado 8 da auditoria de 20/08/2026: para "Mensagem para Cliente
        // Específico" (`targetUserId`), o `return` engolia até o aviso
        // dentro do app — que não depende de push nenhum. Das duas metades
        // do recurso, só a de push fica sem alvo aqui; a outra continua
        // funcionando, então ela continua acontecendo. Segmento (sem
        // `targetUserId`) não tem essa segunda metade: `all` grava aviso
        // para todo mundo, e os demais segmentos não têm um destinatário
        // único para gravar — por isso o comportamento deles não muda.
        if (targetUserId) {
          try {
            // Conserto 4 (revisão sobre o commit 8292d27, 20/08/2026): o
            // cliente do Supabase NÃO lança exceção quando o Postgrest
            // recusa a linha — ele resolve com `{ error }` preenchido. Sem
            // conferir isso (como `targetError` e `logError` já conferem,
            // acima), o `catch` nunca disparava e a tela anunciava sucesso
            // e limpava o formulário mesmo sem ter gravado nada.
            const { error: inAppInsertError } = await supabase
              .from("notificacoes")
              .insert({
                titulo: notification.title,
                mensagem: notification.body,
                tipo: "aviso",
                usuario_id: targetUserId,
                dados: { segment, action_url: notification.url },
              });
            if (inAppInsertError) throw inAppInsertError;
            toast.error("Este cliente não tem aparelho inscrito para push", {
              description:
                "A mensagem foi registrada como aviso dentro do app — ele vai ver na próxima vez que abrir a loja.",
            });
            limparMensagemEnviada(mensagemEnviada);
          } catch (inAppErr) {
            console.error("Error saving in-app notification:", inAppErr);
            toast.error("Não foi possível registrar o aviso para este cliente");
          }
        } else {
          toast.error("Nenhum destinatário encontrado para este segmento");
        }
        return;
      }

      // O log nasce com 0 entregas e só sobe quando a edge function CONFIRMAR
      // quantas saíram (PUSH-010). Antes ele nascia com o número de alvos, e
      // era esse número que o histórico mostrava — mesmo quando ninguém
      // recebeu. Se o passo de correção abaixo falhar, o registro fica em 0,
      // que é o padrão honesto: entrega não confirmada.
      const { data: logRow, error: logError } = await supabase
        .from("push_notifications_log")
        .insert({
          title: notification.title,
          body: notification.body,
          url: notification.url,
          recipient_count: 0,
          created_by: user?.id,
        })
        .select("id")
        .single();

      if (logError) throw logError;

      // Parte B da revisão de 20/08/2026: o Conserto 4 checou o `{ error }`
      // só no insert do caminho "alcance zero" (achado 8), logo acima. Estes
      // três — cliente específico COM aparelho, segmento "all" e segmento
      // não vazio — não checavam, e o `catch` abaixo só fazia
      // `console.error`: o push saía e o aviso dentro do app podia falhar
      // em silêncio, sem ninguém saber (cenário: "Todos os Clientes", banco
      // recusa a linha, e quem não tem aparelho nunca é avisado). O push
      // não pode virar falha por causa disso — só marca `avisoNoAppFalhou`
      // para o toast separado logo abaixo do envio.
      let avisoNoAppFalhou = false;
      try {
        if (targetUserId) {
          const { error: avisoError } = await supabase
            .from("notificacoes")
            .insert({
              titulo: notification.title,
              mensagem: notification.body,
              tipo: "aviso",
              usuario_id: targetUserId,
              dados: { segment, action_url: notification.url },
            });
          if (avisoError) avisoNoAppFalhou = true;
        } else if (segment === "all") {
          const { error: avisoError } = await supabase
            .from("notificacoes")
            .insert({
              titulo: notification.title,
              mensagem: notification.body,
              tipo: "aviso",
              usuario_id: null,
              dados: { segment, action_url: notification.url },
            });
          if (avisoError) avisoNoAppFalhou = true;
        } else {
          const uniqueUserIds = Array.from(
            new Set(targetList.map((t: any) => t.user_id).filter(Boolean)),
          ) as string[];
          if (uniqueUserIds.length > 0) {
            const inAppRows = uniqueUserIds.map((uId) => ({
              titulo: notification.title,
              mensagem: notification.body,
              tipo: "aviso",
              usuario_id: uId,
              dados: { segment, action_url: notification.url },
            }));
            const chunkSize = 100;
            for (let i = 0; i < inAppRows.length; i += chunkSize) {
              const chunk = inAppRows.slice(i, i + chunkSize);
              const { error: avisoError } = await supabase
                .from("notificacoes")
                .insert(chunk);
              if (avisoError) avisoNoAppFalhou = true;
            }
          }
        }
      } catch (inAppErr) {
        console.error("Error saving in-app notification:", inAppErr);
        avisoNoAppFalhou = true;
      }

      const { data: envio, error: pushError } = await supabase.functions
        .invoke("send-push", {
          body: {
            title: notification.title,
            body: notification.body,
            url: notification.url,
            tokens: targetList.map((t: any) => ({
              endpoint: t.endpoint,
              keys: { p256dh: t.p256dh, auth: t.auth },
            })),
          },
        })
        .catch((error: unknown) => ({ data: null, error }));

      // A resposta agora traz contagem de verdade. Até 05/08/2026 a função
      // devolvia `{ success: true }` mesmo com todos os envios falhando, e esta
      // tela nem lia o `data` — só o erro do invoke. Resultado: toast verde em
      // cima de zero entrega. Ver PUSH-010 (#80).
      const entregues = Number(envio?.enviados ?? 0);
      const falharam = Number(envio?.falharam ?? 0);
      const naoTentados =
        Number.isInteger(envio?.naoTentados) && envio.naoTentados >= 0
          ? envio.naoTentados
          : 0;
      // Sem contagem válida, o resultado continua desconhecido.
      const envioConfirmado =
        !pushError && Number.isInteger(envio?.enviados) && envio.enviados >= 0;
      const primeiraFalha = envio?.falhas?.[0];
      const detalheDaFalha = primeiraFalha
        ? `${primeiraFalha.quantidade}x ${primeiraFalha.motivo}`
        : undefined;

      if (envioConfirmado && entregues > 0) {
        const { error: ajusteError } = await supabase
          .from("push_notifications_log")
          .update({ recipient_count: entregues })
          .eq("id", logRow.id);
        if (ajusteError) {
          console.error(
            "Falha ao corrigir o recipient_count do log:",
            ajusteError,
          );
        }
      }

      if (!envioConfirmado) {
        console.error("Envio de push não confirmado:", pushError);
        toast.error("Não foi possível confirmar o envio", {
          description:
            "Sua campanha foi mantida. Alguns clientes podem ter recebido. Se enviar de novo, eles podem receber a mensagem repetida.",
        });
      } else if (entregues === 0) {
        toast.error(`Nenhum dos ${finalRecipientCount} dispositivos recebeu`, {
          description: `${detalheDaFalha ?? "A função não informou o motivo da falha."}${naoTentados > 0 ? ` ${naoTentados} ${naoTentados === 1 ? "dispositivo nem chegou a ser tentado" : "dispositivos nem chegaram a ser tentados"} porque o envio demorou demais.` : ""} Sua campanha foi mantida. Se reenviar, o aviso dentro do app também aparece de novo para os clientes.`,
        });
      } else if (falharam > 0 || naoTentados > 0) {
        toast.warning(
          `Entregue em ${entregues} de ${entregues + falharam + naoTentados}`,
          {
            description:
              naoTentados > 0
                ? [
                    detalheDaFalha,
                    `${naoTentados} ${naoTentados === 1 ? "dispositivo não recebeu" : "dispositivos não receberam"} porque o envio demorou demais. Se reenviar esta campanha, quem já recebeu pode receber a mensagem repetida.`,
                  ]
                    .filter(Boolean)
                    .join(" ")
                : detalheDaFalha,
          },
        );
      } else {
        toast.success(`Notificação entregue em ${entregues} dispositivo(s)`);
      }

      // Segundo fato, distinto do de cima: o push é uma coisa, o aviso
      // dentro do app é outra — e o toast do push não pode ser o único jeito
      // de saber que o aviso falhou (Parte B da revisão de 20/08/2026).
      //
      // ⚠️ ESTA MENSAGEM FALA SÓ DO QUE ELA OBSERVOU. A versão anterior
      // começava com "O push saiu, mas..." e a descrição dizia "só vê essa
      // mensagem se o push chegar" — duas afirmações sobre o PUSH, feitas por
      // uma condição (`avisoNoAppFalhou`) que não olha nem `pushError` nem
      // `entregues`. Com os dois falhando juntos, a tela mostrava "Nenhum
      // push saiu" e, logo abaixo, "O push saiu".
      //
      // A saída não foi acrescentar condição: foi TIRAR a afirmação que esta
      // mensagem não tem como sustentar. São 4 desfechos de push × 2 estados
      // do aviso = 8 combinações; enquanto a segunda frase falar da primeira,
      // cada combinação nova é uma chance de mentir. Falando só do próprio
      // fato, a contradição deixa de ser construível em todas as 8.
      if (avisoNoAppFalhou) {
        toast.warning("O aviso dentro do app não foi registrado", {
          description:
            "O banco recusou gravar a mensagem que o cliente veria ao abrir a loja. Confira o resultado do envio acima.",
        });
      }

      recordAction(
        "PUSH_DISPATCH",
        {
          title: notification.title,
          alvos: finalRecipientCount,
          segment,
        },
        {
          status: !envioConfirmado
            ? "error"
            : entregues === 0
              ? "error"
              : falharam > 0 || naoTentados > 0
                ? "partial"
                : "success",
          entregues,
          falharam,
          ...(naoTentados > 0 ? { naoTentados } : {}),
          falhas: envio?.falhas ?? null,
          timestamp: new Date().toISOString(),
        },
      );

      if (envioConfirmado && entregues > 0) {
        limparMensagemEnviada(mensagemEnviada);
      }
      fetchHistory();
    } catch (error) {
      console.error("Error sending push:", error);
      toast.error("Falha ao registrar notificação no banco");
    } finally {
      setLoading(false);
    }
  };

  // `effectiveReach` é a versão SEMPRE numérica do alcance — total ou
  // alcance desconhecido vira 0 aqui de propósito (antes da correção do
  // quinto contador, só o ramo "all" tinha esse `?? 0`; o ramo do segmento
  // usava `predictedReach` puro, que nunca chegava a ser `null`). Ela
  // alimenta a trava do botão de enviar JUNTO com `reachDesconhecido`,
  // abaixo — mas não é ela quem fecha primeiro hoje.
  //
  // Reescrito na revisão de 20/08/2026 (achado C1): a versão anterior deste
  // comentário dizia que `effectiveReach === 0` era a trava que falha
  // fechada para alcance desconhecido — não é. Quem fecha primeiro é
  // `reachDesconhecido`, definida logo abaixo de `reachExibido` — porque
  // `reachExibido` (a MESMA fonte, sem o `?? 0`) sendo `null` já basta
  // sozinho. `effectiveReach === 0` fecha a mesma situação por um caminho
  // diferente — o `?? 0` também vira 0 quando o alcance é desconhecido — e
  // por isso as duas guardas são mutuamente redundantes NO CÓDIGO ATUAL
  // (medido: mutar qualquer uma das duas, isolada, não derruba teste
  // nenhum). Cada uma continua aqui porque segura uma edição futura
  // diferente da outra: mudar `effectiveReach` para não usar `?? 0`, ou
  // remover `reachDesconhecido` da expressão. Isso é legítimo — só não
  // pode ficar documentado como se uma delas, sozinha, fosse A trava.
  const effectiveReach =
    segment === "all" ? (subCount ?? 0) : (predictedReach ?? 0);

  // `reachExibido` é o que os TEXTOS e os SELOS de segmento mostram
  // ("Receberão: N aparelhos", botão de enviar, badge do segmento
  // selecionado). Ao contrário de `effectiveReach`, preserva o `null` — é
  // ele que faz a tela dizer "desconhecido" em vez de "0" quando a medição
  // falhou, e é por isso que os badges abaixo leem `reachExibido` (nunca
  // `effectiveReach`) para o segmento selecionado.
  const reachExibido: ContagemMedida =
    segment === "all" ? subCount : predictedReach;

  // Conserto 3 (decisão do plano, 20/08/2026, corrigindo o achado 8): com
  // `targetUserId` (Mensagem para Cliente Específico) e o cliente sem
  // aparelho, o botão nascia desabilitado para sempre — `effectiveReach`
  // media 0 e a trava fechava, mesmo havendo uma ação real e segura a
  // executar: gravar o aviso dentro do app, que não depende de push
  // nenhum. Só essa porta abre; todo o resto continua fechado como antes.
  const reachDesconhecido = reachExibido === null;
  const podeGravarAvisoSemPush = Boolean(targetUserId) && reachExibido === 0;
  // O texto ainda tem o marcador do modelo pronto no lugar do código do cupom:
  // enviar mandaria "[CÓDIGO DO SEU CUPOM]" para os clientes.
  const marcadorDoCupomPendente = temMarcadorPendente(
    notification.title,
    notification.body,
  );
  const botaoEnviarDesabilitado =
    loading ||
    isOffline ||
    marcadorDoCupomPendente ||
    reachDesconhecido ||
    (effectiveReach === 0 && !podeGravarAvisoSemPush);

  return (
    <div className="min-h-screen bg-admin-bg pb-admin lg:pb-12 text-white motion-safe:duration-200 motion-safe:animate-in motion-safe:fade-in">
      {/* Top Header Bar — fórmula "Elite Header" (AdminPageHeader), mesma
          casca das ondas anteriores: o título padrão, a ajuda na linha do
          título e os indicadores à direita. O subtítulo fica na view. */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-[#09090b]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-4xl">
          {/* `flex-wrap` (correção 23/09/2026, pedido do dono): título
              (h1, shrink-0) e o wrapper de `acoes` (selo de status,
              shrink-0 também — vem do próprio AdminPageHeader) são os DOIS
              filhos desta linha. Nenhum encolhe, e sem quebra a soma das
              duas larguras estourava a página inteira em 360-390px ("Enviar
              Notificações" ~300px + selo ~160px > ~328px disponíveis). O
              `AdminPageHeader` é compartilhado por 20 telas — a correção
              fica aqui, local: o selo cai para uma segunda linha quando não
              cabe, em vez de mudar o componente para todo mundo. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            <AdminPageHeader
              titulo={NOMES_DO_PAINEL["admin-push"]}
              acoes={
                <>
                  {/* Indicadores no Topbar (os mesmos de antes) */}
                  <div className="hidden sm:flex items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
                    <Smartphone className="size-3.5 text-admin-gold" />
                    <span>
                      <strong className="text-white font-bold">
                        {rotuloDaContagem(subCount)}
                      </strong>{" "}
                      Celulares Cadastrados
                    </span>
                  </div>
                  {MOSTRAR_AVISOS_DE_COMPRAS && (
                    <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900/80 px-2.5 py-1 text-[11px] font-semibold">
                      <span
                        className={`size-2 rounded-full ${config.realTimeSalesAlerts ? "bg-admin-gold animate-pulse" : "bg-zinc-600"}`}
                      />
                      <span className="text-zinc-400 uppercase tracking-wider text-[11px]">
                        {config.realTimeSalesAlerts
                          ? "Avisos de Vendas Ativos"
                          : "Avisos Desativados"}
                      </span>
                    </div>
                  )}
                </>
              }
            >
              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full active:scale-95"
                title="Ajuda e explicação desta tela"
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 group-hover:border-white/10 group-hover:text-white"
                >
                  <HelpCircle className="size-4" />
                </span>
              </button>
            </AdminPageHeader>
          </div>
          <p className="mt-1 text-[11px] font-extrabold uppercase tracking-widest text-zinc-500">
            Envie mensagens e avisos direto no celular dos clientes
          </p>
        </div>
      </div>

      {/* Fluxo de composição v4; os controles e suas travas são os mesmos. */}
      <div className="mx-auto w-full min-w-0 max-w-4xl space-y-8 px-5 pb-8 pt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-admin-accent"
          />
          <span>No ar ·</span>
          <span>Receberão: {textoDeAlcanceEmAparelhos(reachExibido)}</span>
        </div>
        <div className="min-w-0">
          <div className="min-w-0 space-y-8">
            <section className="min-w-0 space-y-4" aria-label="Mensagem">
              <TituloDeSecao icone={Pencil}>Mensagem</TituloDeSecao>
              {/* Mensagens Prontas — pílulas (direção B). Os mesmos 3 arquétipos
                  de antes: o preenchimento, o registro VOR e o toast não mudam —
                  só a forma (cartão grande → pílula de um clique). */}
              <div className="relative min-w-0">
                <div className="flex gap-2 overflow-x-auto pb-1 pr-5">
                  {/* Os textos dos modelos moram em `lib/modelos-de-campanha.ts`:
                      nenhum traz código de cupom, percentual, valor ou prazo
                      inventado — onde vai o cupom da lojista fica o MARCADOR, e o
                      envio trava até ela trocá-lo. */}
                  {[
                    {
                      Icone: Percent,
                      matiz: "#A78BFA",
                      ...MODELOS_DE_CAMPANHA.fomo,
                    },
                    {
                      Icone: ShoppingCart,
                      matiz: "#FF9F5A",
                      ...MODELOS_DE_CAMPANHA.auth,
                    },
                    {
                      Icone: Gift,
                      matiz: "#FF7AA8",
                      ...MODELOS_DE_CAMPANHA.value,
                    },
                  ].map((arch) => (
                    <button
                      key={arch.id}
                      type="button"
                      title={arch.desc}
                      aria-pressed={
                        notification.title === arch.mensagem.title &&
                        notification.body === arch.mensagem.body &&
                        notification.url === arch.mensagem.url
                      }
                      className={`flex min-h-12 shrink-0 items-center gap-2 rounded-full border-[1.5px] py-1.5 pl-1.5 pr-4 text-sm font-medium text-zinc-200 transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60 ${
                        notification.title === arch.mensagem.title &&
                        notification.body === arch.mensagem.body &&
                        notification.url === arch.mensagem.url
                          ? "border-admin-gold bg-admin-gold/10"
                          : "border-white/[0.08] bg-admin-card hover:border-white/25"
                      }`}
                      onClick={() => {
                        setNotification({ ...arch.mensagem });

                        recordAction(
                          "CAMPAIGN_TEMPLATE_LOAD",
                          { template: arch.id, title: arch.title },
                          {
                            result: "applied",
                            timestamp: new Date().toISOString(),
                          },
                        );

                        toast.success(
                          temMarcadorPendente(
                            arch.mensagem.title,
                            arch.mensagem.body,
                          )
                            ? `Mensagem pronta "${arch.title}" preenchida — troque ${MARCADOR_DO_CUPOM} pelo cupom que você criou em Cupons`
                            : `Mensagem pronta "${arch.title}" preenchida!`,
                        );
                      }}
                    >
                      <SeloDeIcone
                        icone={arch.Icone}
                        matiz={arch.matiz}
                        className="size-8 rounded-full"
                      />
                      {arch.title}
                    </button>
                  ))}
                </div>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-admin-bg to-transparent"
                />
              </div>

              {isOffline && (
                <div className="flex items-center gap-2.5 rounded-[20px] border border-white/[0.08] bg-admin-card p-4 text-zinc-300 motion-safe:animate-in motion-safe:fade-in">
                  <AlertCircle className="size-4 shrink-0" />
                  <div className="text-sm leading-relaxed">
                    <span className="font-bold uppercase">
                      Você está offline:
                    </span>{" "}
                    Conecte-se à internet para poder enviar notificações aos
                    clientes.
                  </div>
                </div>
              )}

              {/* Título & Mensagem — sobem para antes do público (direção B:
                  primeiro se escreve, depois se escolhe quem lê). Contadores
                  tabulares para o número não dançar enquanto digita. */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/[0.08] bg-admin-card px-4 py-3 transition-shadow focus-within:border-white/[0.35] focus-within:ring-4 focus-within:ring-white/5 motion-reduce:transition-none">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor="push-title"
                      className="text-xs text-zinc-400"
                    >
                      Título
                    </Label>
                    <span className="text-xs tabular-nums text-zinc-400">
                      {notification.title.length}/60
                    </span>
                  </div>
                  <LocalBufferedInput
                    id="push-title"
                    aria-label="Título da mensagem"
                    name="title"
                    autoComplete="off"
                    // Trava da proposta (revisão do lote B, 12/09/2026): o
                    // contador "{n}/60" só é honesto acompanhado do limite —
                    // sem o atributo, o envio saía maior que 60.
                    maxLength={60}
                    value={notification.title}
                    onFlush={(val) =>
                      setNotification((prev) => ({ ...prev, title: val }))
                    }
                    disabled={isOffline || loading}
                    placeholder={
                      isOffline
                        ? "Indisponível offline"
                        : "Ex: Oferta especial liberada para você!"
                    }
                    useShadcn={true}
                    className="h-auto min-h-10 rounded-none border-0 bg-transparent dark:bg-transparent px-0 py-1 text-[17px] md:text-[17px] font-medium text-white shadow-none motion-reduce:transition-none focus-visible:ring-0 placeholder:text-zinc-400 disabled:opacity-100 disabled:text-zinc-400"
                  />
                </div>

                <div className="min-h-[112px] rounded-2xl border border-white/[0.08] bg-admin-card px-4 py-3 transition-shadow focus-within:border-white/[0.35] focus-within:ring-4 focus-within:ring-white/5 motion-reduce:transition-none">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor="push-body"
                      className="text-xs text-zinc-400"
                    >
                      Mensagem
                    </Label>
                    <span className="text-xs tabular-nums text-zinc-400">
                      {notification.body.length}/140
                    </span>
                  </div>
                  <LocalBufferedTextarea
                    id="push-body"
                    aria-label="Texto da mensagem"
                    name="body"
                    autoComplete="off"
                    // Mesma trava do título: 140 é o que a notificação real
                    // carrega — sem o atributo, a prévia mostrava inteiro o
                    // que o SO do cliente trunca.
                    maxLength={140}
                    value={notification.body}
                    onFlush={(val) =>
                      setNotification((prev) => ({ ...prev, body: val }))
                    }
                    disabled={isOffline || loading}
                    placeholder={
                      isOffline
                        ? "Indisponível offline"
                        : "Escreva aqui a mensagem curta que o cliente vai ver no celular..."
                    }
                    rows={2}
                    useShadcn={true}
                    className="min-h-[72px] resize-none rounded-none border-0 bg-transparent dark:bg-transparent px-0 py-1 text-[17px] md:text-[17px] font-medium leading-relaxed text-white shadow-none motion-reduce:transition-none focus-visible:ring-0 placeholder:text-zinc-400 disabled:opacity-100 disabled:text-zinc-400"
                  />
                </div>

                {/* Marcador do modelo pronto ainda no texto: o envio está
                    travado e o motivo fica na cara, com o que fazer. */}
                {marcadorDoCupomPendente && (
                  <div
                    data-testid="aviso-codigo-pendente"
                    role="alert"
                    className="flex items-start gap-2 rounded-[20px] border border-white/[0.08] bg-admin-card p-4 text-zinc-300 motion-safe:animate-in motion-safe:fade-in"
                  >
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <p className="text-sm leading-relaxed">
                      Falta o cupom: troque{" "}
                      <strong className="font-black">
                        {MARCADOR_DO_CUPOM}
                      </strong>{" "}
                      pelo código do cupom que você criou em Cupons. O envio
                      fica travado enquanto esse marcador estiver no texto.
                    </p>
                  </div>
                )}
              </div>
            </section>
            <div className="min-w-0">
              <PreviaNoCelular
                title={notification.title}
                body={notification.body}
                logoUrl={config?.logoUrl}
                nomeLoja={config?.storeName}
              />
            </div>

            {/* Zero medido continua desabilitado; desconhecido permite medir ao selecionar. */}
            <section className="space-y-4" aria-label="Quem recebe">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TituloDeSecao icone={Target}>Quem recebe</TituloDeSecao>
                <span className="text-xs text-zinc-400">contado agora</span>
              </div>

              {targetUserId ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-admin-gold bg-admin-gold/10 p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-admin-gold" />
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-wider text-admin-gold leading-tight">
                        Mensagem para Cliente Específico
                      </p>
                      <p className="text-xs font-bold text-white mt-0.5">
                        Cliente:{" "}
                        {(targetUserName?.id === targetUserId &&
                          targetUserName.nome) ||
                          "Carregando..."}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => onNavigate("admin-push")}
                    disabled={isOffline}
                    className="min-h-12 rounded-full border border-admin-border bg-white/5 px-4 py-2 text-sm font-bold text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Mudar para todos os clientes
                  </button>
                </div>
              ) : null}

              {/* Conserto 3: alcance MEDIDO como zero (nunca desconhecido)
                      para um cliente específico — avisa ANTES do clique que
                      não vai sair push, mas que a mensagem ainda vira aviso
                      dentro do app (o botão está habilitado por isso).
                      C4 (revisão de 20/08/2026): `podeGravarAvisoSemPush` já
                      inclui `Boolean(targetUserId)` — o `targetUserId &&`
                      daqui era o mesmo termo repetido duas vezes. */}
              {podeGravarAvisoSemPush && (
                <div className="mt-2 flex items-center gap-2 rounded-[20px] border border-white/[0.08] bg-admin-card p-4 text-zinc-300 motion-safe:animate-in motion-safe:fade-in">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <p className="text-sm leading-relaxed">
                    Este cliente não tem aparelho inscrito para push — a
                    mensagem será registrada como aviso dentro do app, e ele vai
                    ver na próxima vez que abrir a loja.
                  </p>
                </div>
              )}

              {!targetUserId && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      id: "all",
                      label: "Todos os clientes",
                      detalhe: "Toda a base da loja",
                      Icone: Users,
                      matiz: "#6C8CFF",
                      count: subCount,
                      motivoDoZero: "nenhum aparelho cadastrado ainda",
                    },
                    {
                      id: "inactive",
                      label: "Inativos há 30 dias",
                      detalhe: "Sem pedidos de qualquer status",
                      Icone: Moon,
                      matiz: "#2DD4BF",
                      count: (segment === "inactive"
                        ? reachExibido
                        : segmentCounts.inactive) as ContagemMedida,
                      motivoDoZero: "ninguém passou de 30 dias sem pedir",
                    },
                    {
                      id: "vip",
                      label: "Gastaram R$ 150+",
                      detalhe: "Só compras pagas",
                      Icone: Coins,
                      matiz: "#3DDC97",
                      count: (segment === "vip"
                        ? reachExibido
                        : segmentCounts.vip) as ContagemMedida,
                      motivoDoZero: "nenhuma compra paga ainda",
                    },
                    {
                      id: "new",
                      label: "Novos em 7 dias",
                      detalhe: "Cadastros dos últimos 7 dias",
                      Icone: UserPlus,
                      matiz: "#A3E635",
                      count: (segment === "new"
                        ? reachExibido
                        : segmentCounts.new) as ContagemMedida,
                      motivoDoZero: "nenhum cadastro nos últimos 7 dias",
                    },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSegment(s.id)}
                      disabled={isOffline || s.count === 0}
                      aria-pressed={segment === s.id}
                      className={`flex min-h-[192px] min-w-0 flex-col items-start rounded-[20px] border-[1.5px] p-3.5 text-left transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60 ${
                        segment === s.id && s.count !== 0 && !isOffline
                          ? "border-admin-gold bg-gradient-to-b from-admin-gold/[0.16] to-admin-gold/[0.04]"
                          : "border-white/[0.08] bg-admin-card enabled:hover:border-white/25"
                      } disabled:cursor-not-allowed`}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <SeloDeIcone
                          icone={s.Icone}
                          matiz={s.matiz}
                          indisponivel={s.count === 0 || isOffline}
                        />
                        {s.count === 0 || isOffline ? (
                          <LockKeyhole
                            aria-hidden="true"
                            className="size-[22px] text-[#7E7E8A]"
                          />
                        ) : segment === s.id ? (
                          <CheckCircle2
                            aria-hidden="true"
                            className="size-[22px] fill-admin-gold text-admin-bg"
                          />
                        ) : null}
                      </span>
                      <span className="mt-4 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                        <span
                          className={`font-mono text-4xl font-bold tabular-nums leading-none tracking-tight ${s.count === 0 || isOffline ? "text-zinc-400" : segment === s.id ? "text-admin-gold" : "text-white"}`}
                        >
                          {rotuloDaContagem(s.count)}
                        </span>
                        <span className="text-xs text-zinc-400">
                          {s.count === 1 ? "aparelho" : "aparelhos"}
                        </span>
                      </span>
                      <span className="mt-3 w-full break-words text-sm font-bold leading-snug text-zinc-100">
                        {s.label}
                      </span>
                      <span className="mt-1 text-xs leading-relaxed text-zinc-400">
                        {s.detalhe}
                      </span>
                      {s.count === 0 && (
                        <span className="mt-1 text-xs leading-relaxed text-zinc-300">
                          <strong className="block font-bold">
                            Indisponível
                          </strong>
                          {s.motivoDoZero}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* O cartão e a pílula Mudar acionam o mesmo Select de antes.
                Os sete destinos e a trava PAINEL-07 permanecem; o caminho
                manual continua dentro do Avançado. */}
            <section className="space-y-4" aria-label="Ao tocar na mensagem">
              <TituloDeSecao icone={MousePointer2}>
                Ao tocar na mensagem
              </TituloDeSecao>
              <Select
                name="destType"
                // "custom" (caminho digitado no Avançado) não é item da lista:
                // o seletor fica vazio e o placeholder diz onde está o destino.
                value={destType === "custom" ? "" : destType}
                onValueChange={handleDestTypeChange}
                // PAINEL-07: sem o loadingProducts aqui, escolher
                // "Produto" antes da lista carregar gerava um URL
                // '/product-detail' sem id — que o efeito de
                // sincronização reinterpretava como "custom page".
                disabled={isOffline || loading || loadingProducts}
              >
                <SelectTrigger
                  id="push-destination"
                  aria-label="Para onde o cliente vai ao clicar"
                  className="h-auto min-h-[88px] w-full justify-between gap-3 whitespace-normal rounded-[20px] border-white/[0.08] bg-admin-card dark:bg-admin-card px-3.5 py-3 text-left shadow-none motion-reduce:transition-none focus-visible:border-white/35 focus-visible:ring-white/10 disabled:opacity-60 [&>svg]:hidden"
                >
                  <SeloDeIcone
                    icone={Home}
                    matiz="#38BDF8"
                    className="size-11 rounded-xl"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-zinc-400">Abre a</span>
                    <span className="mt-0.5 block break-words text-base font-bold leading-snug text-white">
                      <SelectValue
                        placeholder={
                          destType === "custom"
                            ? "Outra página (veja Avançado)"
                            : "Selecione a tela..."
                        }
                      />
                    </span>
                  </span>
                  <span className="inline-flex min-h-12 shrink-0 items-center rounded-full bg-white/[0.06] px-4 text-sm font-bold text-zinc-200">
                    Mudar
                  </span>
                </SelectTrigger>
                <SelectContent className="rounded-[20px] border border-white/[0.08] bg-admin-card text-white shadow-2xl motion-reduce:animate-none">
                  <SelectItem className="min-h-12" value="home">
                    Página Inicial da Loja
                  </SelectItem>
                  <SelectItem className="min-h-12" value="search">
                    Página de Busca de Produtos
                  </SelectItem>
                  <SelectItem className="min-h-12" value="cart">
                    Carrinho de Compras
                  </SelectItem>
                  <SelectItem className="min-h-12" value="favorites">
                    Lista de Favoritos
                  </SelectItem>
                  <SelectItem className="min-h-12" value="orders">
                    Meus Pedidos
                  </SelectItem>
                  <SelectItem className="min-h-12" value="profile">
                    Perfil do Cliente
                  </SelectItem>
                  <SelectItem className="min-h-12" value="product">
                    Abrir um Produto Específico
                  </SelectItem>
                </SelectContent>
              </Select>

              {destType === "product" && (
                <div className="space-y-3 motion-safe:duration-200 motion-safe:animate-in motion-safe:fade-in">
                  <Label
                    htmlFor="push-product-select"
                    className="text-xs font-bold uppercase tracking-wider text-zinc-400"
                  >
                    Selecione o produto
                  </Label>
                  <Input
                    id="push-product-filter"
                    type="search"
                    autoComplete="off"
                    aria-label="Buscar produto pelo nome"
                    placeholder="Buscar pelo nome..."
                    value={filtroDeProduto}
                    onChange={(e) => setFiltroDeProduto(e.target.value)}
                    disabled={isOffline || loading || loadingProducts}
                    className="min-h-12 rounded-2xl border-white/[0.08] bg-admin-card text-sm text-white placeholder:text-zinc-400 focus-visible:border-white/35 focus-visible:ring-white/10"
                  />
                  <Select
                    name="productId"
                    value={selectedProductId}
                    onValueChange={handleProductChange}
                    disabled={isOffline || loading || loadingProducts}
                  >
                    <SelectTrigger
                      id="push-product-select"
                      className="h-auto min-h-12 w-full rounded-2xl border border-white/[0.08] bg-admin-card px-3 text-sm text-white focus-visible:border-white/35 focus-visible:ring-white/10 [&>svg]:opacity-50"
                    >
                      <SelectValue
                        placeholder={
                          loadingProducts
                            ? "Carregando..."
                            : "Escolha o produto..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="max-h-56 overflow-y-auto rounded-[20px] border border-white/[0.08] bg-admin-card text-white shadow-2xl motion-reduce:animate-none">
                      {produtosVisiveis.map((p) => (
                        <SelectItem
                          className="min-h-12"
                          key={p.id}
                          value={p.id}
                        >
                          {p.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Avançado: o caminho manual (mesmo `#push-custom-path` de
                  antes). Recolhido por padrão; abre sozinho quando a URL de
                  um modelo pronto não é uma das telas da lista (destino
                  `custom`), para o caminho nunca ficar escondido. */}
              <div className="[&>section>button]:min-h-12 [&>section>button]:rounded-[20px] [&>section>button]:border [&>section>button]:border-white/[0.08] [&>section>button]:bg-admin-card [&>section>button]:px-4 [&>section>button>svg]:motion-reduce:transition-none">
                <SecaoRecolhivel
                  titulo="Avançado: abrir outra página"
                  temErro={destType === "custom"}
                >
                  <div className="space-y-1">
                    <Label
                      htmlFor="push-custom-path"
                      className="text-xs font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Endereço da página (comece com /)
                    </Label>
                    <LocalBufferedInput
                      id="push-custom-path"
                      name="customPath"
                      autoComplete="off"
                      value={customPath}
                      onFlush={handleCustomPathChange}
                      disabled={isOffline || loading}
                      placeholder="/nome-da-pagina"
                      useShadcn={true}
                      className="min-h-12 rounded-2xl border-white/[0.08] bg-admin-card font-mono text-sm text-white focus-visible:border-white/35 focus-visible:ring-white/10 placeholder:text-zinc-400"
                    />
                  </div>
                </SecaoRecolhivel>
              </div>
            </section>
          </div>
        </div>

        <div className="bg-gradient-to-b from-transparent to-admin-bg pt-6">
          {/* Botão de Ação */}
          <button
            className="flex min-h-[60px] w-full items-center justify-center gap-2 rounded-[20px] bg-gradient-to-b from-[#F8D25A] to-[#E2A81E] p-3 text-base font-bold leading-snug text-zinc-950 shadow-[0_8px_28px_rgba(226,168,30,0.2)] transition-shadow motion-reduce:transition-none hover:shadow-[0_8px_32px_rgba(226,168,30,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold focus-visible:ring-offset-2 focus-visible:ring-offset-admin-bg disabled:cursor-not-allowed disabled:from-zinc-300 disabled:to-zinc-400 disabled:shadow-none"
            onClick={handleSend}
            disabled={botaoEnviarDesabilitado}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="size-4 motion-safe:animate-spin rounded-full border-2 border-zinc-950/25 border-t-zinc-950" />
                <span>Enviando Notificação...</span>
              </div>
            ) : (
              <>
                <Send aria-hidden="true" className="size-[22px] shrink-0" />
                {/* Direção B: um botão só, com o número real do segmento
                    escolhido — `textoDeAlcanceEmAparelhos` mantém o
                    singular e o traço do desconhecido, como sempre. */}
                Enviar agora para {textoDeAlcanceEmAparelhos(reachExibido)}
              </>
            )}
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs leading-relaxed text-zinc-400">
            <Shield aria-hidden="true" className="size-4 shrink-0" />
            Depois de enviar, não dá para desfazer.
          </p>
        </div>

        {/* Métrica + dica, lado a lado (direção B): os dois cartões de estado
            viram um par compacto. A prova social e o botão de teste de
            recebimento desceram para o bloco "Ajustes", no fim da tela —
            fora do caminho da composição. */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {/* Metric Card - Celulares Cadastrados */}
          {/*
              Achado 7 da auditoria de 20/08/2026: este card tinha selos
              "iOS: X" e "Android: Y" que eram 40% e 60% de `subCount`,
              arredondados — não existe coluna de plataforma em
              `push_subscriptions` (id, endpoint, p256dh, auth, user_id,
              created_at), então não havia nada para medir. Sem dado, a
              única saída honesta é não afirmar: os selos saíram, sem
              inventar substituto.
            */}
          <div className="rounded-[20px] border border-white/[0.08] bg-admin-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
                <Users className="size-3.5 text-zinc-300" /> Clientes Prontos
                para Receber
              </p>
              <span className="text-[11px] font-mono text-zinc-300 font-bold uppercase">
                Ativos
              </span>
            </div>

            <div className="flex items-baseline justify-between border-b border-white/5 pb-2.5">
              <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                <h2 className="text-3xl font-black tabular-nums tracking-tight text-white">
                  {rotuloDaContagem(subCount)}
                </h2>
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                  Celulares e Computadores Cadastrados
                </span>
              </div>
            </div>
          </div>

          {/* Dica de Vendas — a outra metade do par (o texto é o de antes) */}
          <div className="flex items-start gap-3 rounded-[20px] border border-white/[0.08] bg-admin-card p-4">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-admin-border bg-white/5 text-zinc-300">
              <Clock className="size-3.5 text-zinc-300" />
            </div>
            <p className="text-sm leading-relaxed text-zinc-300">
              <span className="font-bold text-zinc-300 uppercase tracking-wider">
                Dica de Vendas:
              </span>{" "}
              Enviar mensagens entre{" "}
              <strong className="text-white">10h e 12h</strong> costuma atrair{" "}
              <span className="font-black text-zinc-300">
                mais clientes e aumentar as vendas
              </span>
              .
            </p>
          </div>
        </div>

        {/* O que já foi ao ar — seção colapsável (consulta), nasce aberta.
            Direção B: o estado vazio é DESENHADO (caixa postal vazia + o que
            vai aparecer aqui quando houver envio) — não uma frase seca. */}
        <SecaoColapsavel
          titulo="O que já foi ao ar"
          icone={History}
          abertaPorPadrao
          extra={
            <span className="text-[11px] font-mono text-zinc-400">
              Últimas 20 mensagens
            </span>
          }
        >
          <div className="max-h-[350px] overflow-y-auto pr-1 space-y-2 scrollbar-thin scrollbar-thumb-zinc-700">
            {history === null ? (
              <div className="py-6 text-center italic text-zinc-400">
                <p className="text-[11px] font-bold uppercase tracking-widest">
                  Não foi possível carregar o histórico
                </p>
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 py-7 text-center">
                <div className="mb-3 flex justify-center" aria-hidden="true">
                  <Inbox className="size-8 text-zinc-400" />
                </div>
                <p className="text-sm font-bold text-zinc-300">
                  Nenhuma mensagem enviada até agora
                </p>
                <span className="mt-1 block text-sm leading-relaxed text-zinc-400">
                  Quando você enviar, cada mensagem aparece aqui — com quantos
                  aparelhos receberam de verdade.
                </span>
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[20px] border border-white/[0.08] bg-white/[0.02] p-3.5"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                    <span className="text-zinc-400 font-mono">
                      {new Date(item.sent_at).toLocaleDateString()} às{" "}
                      {new Date(item.sent_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="flex items-center gap-1 bg-zinc-800/80 px-1.5 py-0.5 rounded text-zinc-300">
                      <Users className="size-2.5 text-zinc-400" />{" "}
                      {textoDeAlcanceEmAparelhos(item.recipient_count)}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white line-clamp-1">
                    {item.title}
                  </h4>
                  <p className="mt-1 text-sm text-zinc-400 line-clamp-1">
                    {item.body}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between border-t border-white/5 pt-1 text-[11px]">
                    <span className="min-w-0 flex-1 font-mono text-zinc-400 truncate">
                      Ao clicar: {item.url}
                    </span>
                    {/* Achado 11 da auditoria de 20/08/2026: o registro
                            nasce com `recipient_count: 0` até a edge function
                            confirmar entrega (comentário acima, em
                            `handleSend`) — 0 não é "falhou com certeza", é
                            "ninguém confirmou ainda". O selo deixou de
                            afirmar sucesso sem olhar o número. */}
                    {item.recipient_count > 0 ? (
                      <span className="shrink-0 pl-2 font-bold uppercase text-zinc-300">
                        Entregue
                      </span>
                    ) : (
                      <span className="shrink-0 pl-2 font-bold uppercase text-zinc-300">
                        Não confirmada
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </SecaoColapsavel>

        {/* Ajustes — o sacrifício aprovado do desenho (direção B): prova
            social e teste de recebimento saíram do caminho da composição e
            recolhem no fim da tela. A função é exatamente a de antes — o
            interruptor grava na hora (updateConfig), nada aqui guarda texto
            não enviado, então fechar o bloco não descarta rascunho nenhum; a
            trava "Salve antes de fechar" continua na seção de escrita,
            onde o rascunho vive. */}
        {/* Sem a chave de avisos de compras (escondida), o bloco só existe
            quando o botão de teste aparece — nunca um "Ajustes" vazio. */}
        {(MOSTRAR_AVISOS_DE_COMPRAS || (isSupported && !isTestSubscribed)) && (
          <SecaoColapsavel
            titulo="Ajustes"
            descricao={
              MOSTRAR_AVISOS_DE_COMPRAS
                ? "Prova social e teste de recebimento"
                : "Teste de recebimento"
            }
            icone={Settings}
          >
            <div className="space-y-2.5">
              {/* Avisos de Compras Recentes — cartão intocado, só mudou de
                lugar (o conteúdo de dentro, inclusive a expansão de
                explicação, é o de antes) */}
              {MOSTRAR_AVISOS_DE_COMPRAS && configLoaded && (
                <div
                  className={`rounded-xl border p-3.5 transition-colors duration-300 motion-reduce:transition-none ${
                    config.realTimeSalesAlerts
                      ? "border-admin-border bg-white/[0.02]"
                      : "border-white/10 bg-zinc-900/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-300 motion-reduce:transition-none ${
                          config.realTimeSalesAlerts
                            ? "border-admin-border bg-white/5 text-zinc-300"
                            : "border-white/5 bg-zinc-950 text-zinc-400"
                        }`}
                      >
                        <Sparkles className="size-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor="realtime-sales-alerts-switch"
                            className="cursor-pointer text-xs font-bold text-white"
                          >
                            Avisos de Compras Recentes
                          </Label>
                          <span
                            className={`size-1.5 rounded-full ${
                              config.realTimeSalesAlerts
                                ? "bg-zinc-300 motion-safe:animate-pulse"
                                : "bg-zinc-600"
                            }`}
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[11px] text-zinc-400 leading-tight">
                            Mostra na loja avisos de compras em tempo real.
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setIsSocialProofExpanded(!isSocialProofExpanded)
                            }
                            className="flex min-h-12 min-w-12 items-center justify-center text-xs font-bold text-zinc-300 hover:text-zinc-300/80 leading-none"
                          >
                            {isSocialProofExpanded ? (
                              <ChevronUp className="size-3" />
                            ) : (
                              <ChevronDown className="size-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    <Switch
                      id="realtime-sales-alerts-switch"
                      checked={config.realTimeSalesAlerts}
                      onCheckedChange={handleToggleRealTimeSalesAlerts}
                      className="scale-90 data-[state=checked]:bg-zinc-300"
                      disabled={isOffline || isUpdatingConfig}
                    />
                  </div>

                  <AnimatePresence initial={false}>
                    {isSocialProofExpanded && (
                      <motion.div
                        initial={false}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2.5 pt-2.5 border-t border-white/5 text-[11px] leading-relaxed text-zinc-400 space-y-1">
                          <p>
                            Esta opção exibe pequenas notificações discretas na
                            loja quando alguém faz um pedido, passando mais
                            segurança e confiança aos novos clientes.
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Teste de recebimento — o mesmo botão do cartão métrico, na
                mesma condição (`isSupported && !isTestSubscribed`). */}
              {isSupported && !isTestSubscribed && (
                <button
                  onClick={handleTestSubscription}
                  disabled={isOffline}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-admin-border bg-white/5 min-h-12 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-white/10 motion-safe:active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Zap className="size-3 text-zinc-300" />
                  Testar Recebimento Neste Aparelho
                </button>
              )}
            </div>
          </SecaoColapsavel>
        )}
      </div>

      {/* Modal de Ajuda Limpo */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Ajuda - Notificações para Clientes"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Nesta tela você pode criar e enviar mensagens curtas direto para os
            celulares dos clientes que aceitaram receber avisos da sua loja.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
              O que você pode fazer aqui
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Send className="size-3.5 text-admin-gold" />
                  Enviar Notificação
                </div>
                <p className="text-xs text-zinc-400">
                  Escreva o título, a mensagem e escolha qual tela abre quando o
                  cliente clica.
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Sparkles className="size-3.5 text-admin-gold" />
                  Mensagens Prontas
                </div>
                <p className="text-xs text-zinc-400">
                  Escolha exemplos prontos para preencher o texto rapidamente
                  com apenas 1 clique.
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Users className="size-3.5 text-sky-500" />
                  Quem Vai Receber
                </div>
                <p className="text-xs text-zinc-400">
                  {/* A11: a redação descreve as regras reais dos segmentos
                  (os mesmos critérios dos botões acima) — a antiga dizia
                  "sem comprar há 30 dias", mas para o servidor pedido
                  cancelado também conta como último pedido. */}
                  Escolha enviar para todos os clientes ou para grupos (ex:
                  gastaram R$ 150+ em compras pagas, sem pedidos há 30 dias ou
                  cadastrados na última semana).
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <History className="size-3.5 text-purple-500" />
                  Histórico de Envios
                </div>
                <p className="text-xs text-zinc-400">
                  Veja a lista das últimas mensagens que você enviou e quantas
                  pessoas receberam.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});
