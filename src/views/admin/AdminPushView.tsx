import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useVOR } from "@/hooks/useVOR";
import { supabase } from "@/lib/supabase";
import type { View } from "@/types";
import {
  type ContagemMedida,
  rotuloDaContagem,
  textoDeAlcanceEmAparelhos,
} from "@/utils/contadores-de-push";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  HelpCircle,
  History,
  Radio,
  Send,
  Settings,
  Smartphone,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Seção colapsável da tela de Avisar clientes (frente
 * glm-visual-canais-avisar-0309): o mesmo padrão da `SecaoColapsavel` dos
 * Ajustes — cabeçalho clicável com `aria-expanded`, conteúdo montado só
 * quando aberta e trava de pendência ("Salve antes de fechar": fechar
 * desmonta o conteúdo e jogaria fora o que foi digitado). Local a este
 * arquivo de propósito; o acento é o verde desta tela.
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

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-3.5 shadow-lg backdrop-blur-xl sm:p-4">
      <button
        type="button"
        onClick={() => {
          if (aberta && comPendencia) return;
          setAberta(!aberta);
        }}
        aria-expanded={aberta}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            <Icone className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-black uppercase tracking-wider text-white">
              {titulo}
            </span>
            {descricao ? (
              <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                {descricao}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {extra}
          {aberta && comPendencia && (
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-400">
              Salve antes de fechar
            </span>
          )}
          <ChevronDown
            className={`size-4 shrink-0 text-zinc-400 transition-transform duration-200 ${
              aberta ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {aberta && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
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
  const [history, setHistory] = useState<any[] | null>(null);
  const [targetUserName, setTargetUserName] = useState<string | null>(null);
  const [destType, setDestType] = useState<string>("home");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [customPath, setCustomPath] = useState<string>("");
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

  const updateUrl = (type: string, prodId: string, custom: string) => {
    let finalUrl = "/";
    if (type === "home") {
      finalUrl = "/";
    } else if (type === "search") {
      finalUrl = "/search";
    } else if (type === "cart") {
      finalUrl = "/cart";
    } else if (type === "favorites") {
      finalUrl = "/favorites";
    } else if (type === "orders") {
      finalUrl = "/orders";
    } else if (type === "profile") {
      finalUrl = "/profile";
    } else if (type === "product") {
      finalUrl = prodId ? `/product-detail?id=${prodId}` : "/product-detail";
    } else if (type === "custom") {
      finalUrl = custom;
    }
    setNotification((prev) => ({ ...prev, url: finalUrl }));
  };

  const handleDestTypeChange = (type: string) => {
    setDestType(type);
    updateUrl(type, selectedProductId, customPath);
  };

  const handleProductChange = (prodId: string) => {
    setSelectedProductId(prodId);
    updateUrl(destType, prodId, customPath);
  };

  const handleCustomPathChange = (val: string) => {
    setCustomPath(val);
    updateUrl(destType, selectedProductId, val);
  };

  useEffect(() => {
    const url = notification.url;
    if (url === "/" || url === "" || url === "/home") {
      if (destType !== "home") setDestType("home");
    } else if (url === "/search") {
      if (destType !== "search") setDestType("search");
    } else if (url === "/cart") {
      if (destType !== "cart") setDestType("cart");
    } else if (url === "/favorites") {
      if (destType !== "favorites") setDestType("favorites");
    } else if (url === "/orders") {
      if (destType !== "orders") setDestType("orders");
    } else if (url === "/profile") {
      if (destType !== "profile") setDestType("profile");
    } else if (
      url.startsWith("/product-detail?id=") ||
      url.startsWith("/product/")
    ) {
      if (destType !== "product") setDestType("product");
      const id = url.includes("?id=")
        ? url.split("?id=")[1] || ""
        : url.split("/product/")[1] || "";
      if (selectedProductId !== id) setSelectedProductId(id);
    } else {
      if (destType !== "custom") setDestType("custom");
      if (customPath !== url) setCustomPath(url);
    }
  }, [notification.url]);

  useEffect(() => {
    if (targetUserId) {
      setSegment(targetUserId);
      const fetchUserName = async () => {
        const { data, error } = await supabase
          .from("public_profiles")
          .select("full_name")
          .eq("id", targetUserId)
          .single();
        if (!error && data) {
          setTargetUserName(data.full_name);
        }
      };
      fetchUserName();
    } else {
      setTargetUserName(null);
      setSegment("all");
    }
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
      .limit(20);

    // PAINEL-08: `null` em falha — `history` nasce `[]` e o render
    // exibia "Nenhuma mensagem enviada" para uma falha de rede. O
    // subCount ao lado (linha 244) já usava null; o histórico não.
    setHistory(error || !data ? null : data);
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
      if (!error && data !== null && data !== undefined) {
        setPredictedReach(Number(data));
      } else {
        setPredictedReach(null);
      }
    } catch (err) {
      console.error("Error calculating reach:", err);
      setPredictedReach(null);
    }
  }, [segment, subCount]);

  useEffect(() => {
    calculateReach();
  }, [calculateReach]);

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

    setLoading(true);
    try {
      if (!user) throw new Error("Administrador não autenticado");

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
            setNotification({ title: "", body: "", url: "/" });
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

      const { data: envio, error: pushError } = await supabase.functions.invoke(
        "send-push",
        {
          body: {
            title: notification.title,
            body: notification.body,
            url: notification.url,
            tokens: targetList.map((t: any) => ({
              endpoint: t.endpoint,
              keys: { p256dh: t.p256dh, auth: t.auth },
            })),
          },
        },
      );

      // A resposta agora traz contagem de verdade. Até 05/08/2026 a função
      // devolvia `{ success: true }` mesmo com todos os envios falhando, e esta
      // tela nem lia o `data` — só o erro do invoke. Resultado: toast verde em
      // cima de zero entrega. Ver PUSH-010 (#80).
      const entregues = Number(envio?.enviados ?? 0);
      const falharam = Number(envio?.falharam ?? 0);
      const primeiraFalha = envio?.falhas?.[0];
      const detalheDaFalha = primeiraFalha
        ? `${primeiraFalha.quantidade}x ${primeiraFalha.motivo}`
        : undefined;

      if (entregues > 0) {
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

      if (pushError) {
        // A função recusou a requisição inteira: chave VAPID ausente, sessão
        // sem permissão de admin, corpo inválido. Nada saiu.
        console.error("send-push recusou a requisição:", pushError);
        toast.error("Nenhum push saiu", {
          description:
            "A função de envio recusou a requisição. O registro ficou salvo com 0 entregas.",
        });
      } else if (entregues === 0) {
        toast.error(`Nenhum dos ${finalRecipientCount} dispositivos recebeu`, {
          description:
            detalheDaFalha ?? "A função não informou o motivo da falha.",
        });
      } else if (falharam > 0) {
        toast.warning(`Entregue em ${entregues} de ${entregues + falharam}`, {
          description: detalheDaFalha,
        });
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
          status: pushError
            ? "error"
            : entregues === 0
              ? "error"
              : falharam > 0
                ? "partial"
                : "success",
          entregues,
          falharam,
          falhas: envio?.falhas ?? null,
          timestamp: new Date().toISOString(),
        },
      );

      setNotification({ title: "", body: "", url: "/" });
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
  const botaoEnviarDesabilitado =
    loading ||
    isOffline ||
    reachDesconhecido ||
    (effectiveReach === 0 && !podeGravarAvisoSemPush);

  return (
    <div className="min-h-screen bg-[#09090b] pb-admin lg:pb-12 text-white duration-200 animate-in fade-in selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Header Bar — fórmula "Elite Header" (AdminPageHeader), mesma
          casca das ondas anteriores: o título padrão, a ajuda na linha do
          título e os indicadores à direita. O subtítulo fica na view. */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-[#09090b]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex items-center justify-between gap-4">
            <AdminPageHeader
              titulo="Enviar Notificações"
              acoes={
                <>
                  {/* Indicadores no Topbar (os mesmos de antes) */}
                  <div className="hidden sm:flex items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/80 px-2.5 py-1 text-[10px] font-semibold text-zinc-300">
                    <Smartphone className="size-3.5 text-emerald-400" />
                    <span>
                      <strong className="text-white font-bold">
                        {rotuloDaContagem(subCount)}
                      </strong>{" "}
                      Celulares Cadastrados
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900/80 px-2.5 py-1 text-[10px] font-semibold">
                    <span
                      className={`size-2 rounded-full ${config.realTimeSalesAlerts ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"}`}
                    />
                    <span className="text-zinc-400 uppercase tracking-wider text-[9px]">
                      {config.realTimeSalesAlerts
                        ? "Avisos de Vendas Ativos"
                        : "Avisos Desativados"}
                    </span>
                  </div>
                </>
              }
            >
              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
                title="Ajuda e explicação desta tela"
              >
                <HelpCircle className="size-4" />
              </button>
            </AdminPageHeader>
          </div>
          <p className="mt-1 text-[9px] font-extrabold uppercase tracking-widest text-zinc-500">
            Envie mensagens e avisos direto no celular dos clientes
          </p>
        </div>
      </div>

      {/* Conteúdo Principal — seções colapsáveis e cartões fixos (padrão
          da onda 1 do rebuild). A porta de trabalho (escrever/enviar) e o
          histórico nascem abertos; os cartões de estado (prova social,
          métrica, dica) ficam sempre visíveis. Todo o conteúdo de dentro
          (campos, segmentos, envio, listas) é o de antes, um a um. */}
      <div className="mx-auto max-w-4xl space-y-3.5 px-3 pt-3 sm:px-4 sm:pt-4">
        {/* Painel único de composição (direção B "Rádio do lojista",
            12/09/2026): entra, escreve e dispara — CARTÃO FIXO, "painel
            único aceso, nada escondido" (mesma decisão da T1 no Atendimento;
            revisão do lote B). Os inputs são controlados por um useState
            daqui e remontam com o valor, então colapso aqui nunca protegeu
            rascunho nenhum — só escondia a porta de trabalho. Conteúdo na
            ordem nova: pílulas de modelos, texto, prévia no celular,
            público em chips, destino inline e um botão só. O alcance fica à
            vista no selo do cabeçalho, no chip do segmento e no botão de
            enviar. */}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-3.5 shadow-lg backdrop-blur-xl sm:p-4">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2.5 text-xs font-black uppercase tracking-wider text-white">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                <Radio className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate">No ar agora</span>
                <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                  Escreva e envie mensagens para os clientes
                </span>
              </span>
            </p>
            <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
              <Radio className="size-3 animate-pulse" />
              <span>Receberão: {textoDeAlcanceEmAparelhos(reachExibido)}</span>
            </div>
          </div>
          {/* Mensagens Prontas — pílulas (direção B). Os mesmos 3 arquétipos
              de antes: o preenchimento, o registro VOR e o toast não mudam —
              só a forma (cartão grande → pílula de um clique). */}
          <div className="mb-3.5 flex flex-wrap gap-2">
            {[
              {
                id: "fomo",
                emoji: "⚡",
                title: "Desconto Relâmpago",
                desc: "Preenche oferta de 10% OFF",
              },
              {
                id: "auth",
                emoji: "🛒",
                title: "Lembrete de Carrinho",
                desc: "Lembrar de finalizar compra",
              },
              {
                id: "value",
                emoji: "🎁",
                title: "Cupom de R$20",
                desc: "Cupom de desconto especial",
              },
            ].map((arch) => (
              <button
                key={arch.id}
                type="button"
                title={arch.desc}
                className="rounded-full border border-white/10 bg-black/35 px-3.5 py-1.5 text-[11px] font-bold text-zinc-300 transition-all duration-200 hover:border-emerald-500/45 hover:bg-emerald-500/5 hover:text-white active:scale-[0.98]"
                onClick={() => {
                  if (arch.id === "fomo") {
                    setNotification({
                      title: "Cupom Relâmpago: 10% OFF ativo por 1 hora! ⚡",
                      body: "Aproveite o desconto exclusivo nos produtos da loja. Garanta o seu antes que acabe!",
                      url: "/search",
                    });
                  } else if (arch.id === "auth") {
                    setNotification({
                      title: "Seu carrinho de compras está te esperando! 🛒",
                      body: "Finalize seu pedido agora e garanta seus produtos com rapidez. Não perca!",
                      url: "/cart",
                    });
                  } else {
                    setNotification({
                      title: "Presente para você: Cupom de R$20! 🎁",
                      body: "Use o cupom BEMVINDO e garanta um desconto especial na sua próxima compra na loja.",
                      url: "/profile",
                    });
                  }

                  recordAction(
                    "CAMPAIGN_TEMPLATE_LOAD",
                    { template: arch.id, title: arch.title },
                    {
                      result: "applied",
                      timestamp: new Date().toISOString(),
                    },
                  );

                  toast.success(`Mensagem pronta "${arch.title}" preenchida!`);
                }}
              >
                <span aria-hidden="true">{arch.emoji}</span> {arch.title}
              </button>
            ))}
          </div>

          {isOffline && (
            <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-rose-300 animate-in fade-in">
              <AlertCircle className="size-4 shrink-0" />
              <div className="text-[10px]">
                <span className="font-bold uppercase">Você está offline:</span>{" "}
                Conecte-se à internet para poder enviar notificações aos
                clientes.
              </div>
            </div>
          )}

          <div className="space-y-3">
            {/* Título & Mensagem — sobem para antes do público (direção B:
                primeiro se escreve, depois se escolhe quem lê). Contadores
                tabulares para o número não dançar enquanto digita. */}
            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label
                    htmlFor="push-title"
                    className="text-[9px] font-black uppercase tracking-widest text-zinc-400"
                  >
                    Título da mensagem
                  </Label>
                  <span className="text-[8px] font-mono tabular-nums text-zinc-500">
                    {notification.title.length}/60
                  </span>
                </div>
                <LocalBufferedInput
                  id="push-title"
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
                      : "Ex: Oferta especial liberada para você! 🎁"
                  }
                  useShadcn={true}
                  className="h-9 rounded-lg border-white/10 bg-black/50 px-3 text-xs text-white shadow-inner focus:border-emerald-500/50 focus:ring-0 placeholder:text-zinc-600 disabled:opacity-40"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label
                    htmlFor="push-body"
                    className="text-[9px] font-black uppercase tracking-widest text-zinc-400"
                  >
                    Texto da mensagem
                  </Label>
                  <span className="text-[8px] font-mono tabular-nums text-zinc-500">
                    {notification.body.length}/140
                  </span>
                </div>
                <LocalBufferedTextarea
                  id="push-body"
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
                  className="resize-none rounded-lg border-white/10 bg-black/50 p-2.5 text-xs font-medium text-white shadow-inner focus:border-emerald-500/50 focus:ring-0 placeholder:text-zinc-600 disabled:opacity-40"
                />
              </div>
            </div>

            {/* Prévia no celular — emprestada da direção A (aprovada junto no
                mesmo desenho): a notificação EXATAMENTE como chega, ao vivo
                com o que foi digitado, antes de sair do aparelho de ninguém.
                Com campo vazio o mockup não finge ter mensagem. */}
            <div
              data-testid="previa-celular"
              className="flex flex-col items-center gap-2 py-1"
            >
              <div className="w-[270px] rounded-[26px] border border-white/10 bg-gradient-to-b from-zinc-900 to-black p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <div className="mb-3 flex items-center justify-between text-[9px] tabular-nums text-zinc-500">
                  <span>Vivo</span>
                  <span>10:42</span>
                </div>
                <div className="flex gap-2.5 rounded-2xl border border-white/10 bg-zinc-800/80 p-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-sm">
                    <span aria-hidden="true">🛍️</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs font-bold leading-tight ${notification.title ? "text-white" : "text-zinc-600"}`}
                    >
                      {notification.title || "Título da notificação aqui"}
                    </p>
                    <p
                      className={`mt-0.5 text-[11px] leading-snug ${notification.body ? "text-zinc-400" : "text-zinc-600"}`}
                    >
                      {notification.body || "O texto digitado aparece aqui."}
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[9px] text-zinc-500">
                    agora
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-zinc-500">
                Prévia ao vivo — é assim que chega no celular do cliente
              </p>
            </div>

            {/* Quem recebe — chips com o número GRANDE (direção B). Segmento
                MEDIDO como zero nasce desativado COM o motivo do zero;
                contagem desconhecida (null → "—") continua selecionável,
                porque é o selecionar que dispara a medição daquele segmento. */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
                  Quem recebe{" "}
                  <span className="font-semibold normal-case tracking-normal text-zinc-500">
                    — contado agora, de verdade
                  </span>
                </span>
              </div>

              {targetUserId ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-400" />
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400 leading-none">
                        Mensagem para Cliente Específico
                      </p>
                      <p className="text-xs font-bold text-white mt-0.5">
                        Cliente: {targetUserName || "Carregando..."}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => onNavigate("admin-push")}
                    disabled={isOffline}
                    className="rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 hover:text-white"
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
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-300 animate-in fade-in">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <p className="text-[10px] font-medium leading-tight">
                    Este cliente não tem aparelho inscrito para push — a
                    mensagem será registrada como aviso dentro do app, e ele vai
                    ver na próxima vez que abrir a loja.
                  </p>
                </div>
              )}

              {!targetUserId && (
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {[
                    {
                      id: "all",
                      label: "Todos os Clientes",
                      // "all" segue vindo de `subCount`: é a única
                      // contagem que já era medição de verdade e não
                      // precisa de RPC nenhuma (achado 6, decisão 1).
                      // `subCount` já é `ContagemMedida` — não passa por
                      // `effectiveReach`, que converte desconhecido em 0
                      // só para a trava do botão de enviar.
                      count: subCount,
                      motivoDoZero: "nenhum aparelho cadastrado ainda",
                    },
                    {
                      id: "vip",
                      // Laudo 0109 (A11): o rótulo descreve a regra real
                      // do servidor (get_segmented_push_targets: LTV de
                      // dinheiro RECONHECIDO >= R$ 150), não um apelido
                      // que promete outra coisa.
                      label: "Gastaram R$ 150+ (pagos)",
                      // `reachExibido`, não `effectiveReach`: o badge do
                      // segmento selecionado tem de poder mostrar "—"
                      // quando a medição está no ar ou falhou — se
                      // usasse `effectiveReach` (sempre numérico, de
                      // propósito, para a trava do botão) ele "viraria
                      // 0" bem na hora em que os outros chips mostram
                      // traço, contradizendo a própria tela.
                      count: (segment === "vip"
                        ? reachExibido
                        : segmentCounts.vip) as ContagemMedida,
                      motivoDoZero: "nenhuma compra paga ainda",
                    },
                    {
                      id: "inactive",
                      // A11: o servidor olha o último pedido de
                      // QUALQUER status (MAX sem filtro) — um pedido
                      // cancelado ontem mantém o cliente fora daqui.
                      label: "Sem pedidos há 30d (qualquer status)",
                      count: (segment === "inactive"
                        ? reachExibido
                        : segmentCounts.inactive) as ContagemMedida,
                      motivoDoZero: "ninguém passou de 30 dias sem pedir",
                    },
                    {
                      id: "new",
                      // A11: o segmento é nascimento de PERFIL nos
                      // últimos 7 dias (profiles.created_at), não
                      // "novos clientes" em sentido vago.
                      label: "Cadastrados há ≤ 7 dias",
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
                      className={`flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left transition-all duration-200 ${
                        segment === s.id
                          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                          : "border-white/5 bg-white/[0.02] text-zinc-400 hover:bg-white/5 hover:text-white"
                      } disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      <span className="w-full truncate text-[9px] font-black uppercase tracking-wider">
                        {s.label}
                      </span>
                      {/* O número GRANDE do chip (direção B), no span
                          font-mono que os testes leem — `rotuloDaContagem`
                          mantém o traço quando a medição não chegou. */}
                      <span
                        className={`font-mono text-lg font-black tabular-nums leading-none ${
                          segment === s.id
                            ? "text-emerald-300"
                            : s.count === 0
                              ? "text-zinc-500"
                              : "text-white"
                        }`}
                      >
                        {rotuloDaContagem(s.count)}
                      </span>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">
                        {/* Zero MEDIDO tem motivo na cara (a regra do
                            servidor, em palavras — é o que a direção B
                            pediu). Desconhecido não tem motivo: null não é
                            zero, é "ainda não mediu". */}
                        {s.count === 0 ? s.motivoDoZero : "aparelhos"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Destino — inline (direção B): o próprio gatilho do Select é a
                linha "Ao clicar na mensagem, o cliente abre … mudar ↗" — um
                clique abre as opções. Os 8 itens e a trava PAINEL-07 são os
                de antes; a leitura mono do URL saiu (o destino escolhido já
                aparece no próprio gatilho — dizer de novo era redundância). */}
            <div className="space-y-2">
              <Select
                name="destType"
                value={destType}
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
                  className="h-auto w-full justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-left shadow-inner focus:border-emerald-500/50 focus:ring-0 [&>svg]:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block text-[10px] font-semibold text-zinc-400">
                      Ao clicar na mensagem, o cliente abre
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[13px] font-bold text-white">
                      <SelectValue placeholder="Selecione a tela..." />
                      <span className="shrink-0 text-[11px] font-black text-emerald-400">
                        mudar ↗
                      </span>
                    </span>
                  </span>
                </SelectTrigger>
                <SelectContent className="rounded-xl border border-white/10 bg-zinc-950 text-white shadow-2xl">
                  <SelectItem value="home">Página Inicial da Loja</SelectItem>
                  <SelectItem value="search">
                    Página de Busca de Produtos
                  </SelectItem>
                  <SelectItem value="cart">Carrinho de Compras</SelectItem>
                  <SelectItem value="favorites">
                    Lista de Favoritos
                  </SelectItem>
                  <SelectItem value="orders">Meus Pedidos</SelectItem>
                  <SelectItem value="profile">Perfil do Cliente</SelectItem>
                  <SelectItem value="product">
                    Abrir um Produto Específico
                  </SelectItem>
                  <SelectItem value="custom">
                    Outra Página (Link manual)
                  </SelectItem>
                </SelectContent>
              </Select>

              {destType === "product" && (
                <div className="space-y-1 duration-200 animate-in fade-in">
                  <Label
                    htmlFor="push-product-select"
                    className="text-[9px] font-black uppercase tracking-widest text-zinc-400"
                  >
                    Selecione o produto
                  </Label>
                  <Select
                    name="productId"
                    value={selectedProductId}
                    onValueChange={handleProductChange}
                    disabled={isOffline || loading || loadingProducts}
                  >
                    <SelectTrigger
                      id="push-product-select"
                      className="h-9 w-full rounded-lg border border-white/10 bg-black/50 px-2.5 text-xs text-white shadow-inner focus:border-emerald-500/50 focus:ring-0 [&>svg]:opacity-50"
                    >
                      <SelectValue
                        placeholder={
                          loadingProducts
                            ? "Carregando..."
                            : "Escolha o produto..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 text-white shadow-2xl">
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {destType === "custom" && (
                <div className="space-y-1 duration-200 animate-in fade-in">
                  <Label
                    htmlFor="push-custom-path"
                    className="text-[9px] font-black uppercase tracking-widest text-zinc-400"
                  >
                    Digite o caminho da página
                  </Label>
                  <LocalBufferedInput
                    id="push-custom-path"
                    name="customPath"
                    autoComplete="off"
                    value={customPath}
                    onFlush={handleCustomPathChange}
                    disabled={isOffline || loading}
                    placeholder="/exemplo-pagina"
                    useShadcn={true}
                    className="h-9 rounded-lg border-white/10 bg-black/50 font-mono text-xs text-white shadow-inner focus:border-emerald-500/50 focus:ring-0 placeholder:text-zinc-600"
                  />
                </div>
              )}
            </div>

            {/* Botão de Ação */}
            <button
              className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 text-xs font-black uppercase tracking-[0.15em] text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-400 hover:shadow-[0_0_25px_rgba(16,185,129,0.4)] active:scale-[0.98] disabled:opacity-30 disabled:grayscale disabled:shadow-none"
              onClick={handleSend}
              disabled={botaoEnviarDesabilitado}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="size-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                  <span>Enviando Notificação...</span>
                </div>
              ) : (
                <>
                  <Send className="size-4 fill-current" />
                  {/* Direção B: um botão só, com o número real do segmento
                      escolhido — `textoDeAlcanceEmAparelhos` mantém o
                      singular e o traço do desconhecido, como sempre. */}
                  Enviar agora para {textoDeAlcanceEmAparelhos(reachExibido)}
                </>
              )}
            </button>
          </div>
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
          <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3.5 shadow-lg backdrop-blur-xl">
            <div className="flex items-center justify-between mb-2">
              <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                <Users className="size-3.5 text-emerald-400" /> Clientes
                Prontos para Receber
              </p>
              <span className="text-[9px] font-mono text-emerald-400 font-bold uppercase">
                Ativos
              </span>
            </div>

            <div className="flex items-baseline justify-between border-b border-white/5 pb-2.5">
              <div className="flex items-baseline gap-2">
                <h2 className="text-3xl font-black tabular-nums tracking-tight text-white">
                  {rotuloDaContagem(subCount)}
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Celulares e Computadores Cadastrados
                </span>
              </div>
            </div>
          </div>

          {/* Dica de Vendas — a outra metade do par (o texto é o de antes) */}
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 backdrop-blur-md">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Clock className="size-3.5 text-emerald-400" />
            </div>
            <p className="text-[10px] font-medium text-zinc-300 leading-tight">
              <span className="font-bold text-emerald-400 uppercase tracking-wider">
                Dica de Vendas:
              </span>{" "}
              Enviar mensagens entre{" "}
              <strong className="text-white">10h e 12h</strong> costuma atrair{" "}
              <span className="font-black text-emerald-300">
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
            <span className="text-[8px] font-mono text-zinc-500">
              Últimas 20 mensagens
            </span>
          }
        >
          <div className="max-h-[350px] overflow-y-auto pr-1 space-y-2 scrollbar-thin scrollbar-thumb-zinc-700">
            {history === null ? (
              <div className="py-6 text-center italic text-zinc-600">
                <p className="text-[9px] font-bold uppercase tracking-widest">
                  Não foi possível carregar o histórico
                </p>
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 py-7 text-center">
                <div className="mb-2 text-2xl" aria-hidden="true">
                  📭
                </div>
                <p className="text-[11px] font-bold text-zinc-300">
                  Nenhuma mensagem enviada até agora
                </p>
                <span className="mt-1 block text-[10px] font-medium text-zinc-500">
                  Quando você enviar, cada mensagem aparece aqui — com quantos
                  aparelhos receberam de verdade.
                </span>
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-white/5 bg-black/30 p-2.5 transition-all hover:border-white/10 hover:bg-black/50"
                >
                  <div className="flex items-center justify-between text-[8px] font-bold uppercase tracking-widest text-zinc-400 mb-1">
                    <span className="text-emerald-400 font-mono">
                      {new Date(item.sent_at).toLocaleDateString()} às{" "}
                      {new Date(item.sent_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="flex items-center gap-1 bg-zinc-800/80 px-1.5 py-0.5 rounded text-zinc-300">
                      <Users className="size-2.5 text-emerald-400" />{" "}
                      {textoDeAlcanceEmAparelhos(item.recipient_count)}
                    </span>
                  </div>
                  <h4 className="text-[10px] font-bold text-white line-clamp-1">
                    {item.title}
                  </h4>
                  <p className="text-[9px] text-zinc-400 line-clamp-1 mt-0.5 font-medium">
                    {item.body}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between border-t border-white/5 pt-1 text-[8px]">
                    <span className="font-mono text-zinc-500 truncate max-w-[150px]">
                      Ao clicar: {item.url}
                    </span>
                    {/* Achado 11 da auditoria de 20/08/2026: o registro
                            nasce com `recipient_count: 0` até a edge function
                            confirmar entrega (comentário acima, em
                            `handleSend`) — 0 não é "falhou com certeza", é
                            "ninguém confirmou ainda". O selo deixou de
                            afirmar sucesso sem olhar o número. */}
                    {item.recipient_count > 0 ? (
                      <span className="font-bold uppercase text-emerald-400">
                        Entregue
                      </span>
                    ) : (
                      <span className="font-bold uppercase text-amber-400">
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
        <SecaoColapsavel
          titulo="Ajustes"
          descricao="Prova social e teste de recebimento"
          icone={Settings}
        >
          <div className="space-y-2.5">
            {/* Avisos de Compras Recentes — cartão intocado, só mudou de
                lugar (o conteúdo de dentro, inclusive a expansão de
                explicação, é o de antes) */}
            {configLoaded && (
              <div
                className={`rounded-xl border p-3.5 transition-all duration-300 ${
                  config.realTimeSalesAlerts
                    ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_15px_rgba(16,185,129,0.08)]"
                    : "border-white/10 bg-zinc-900/60"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
                        config.realTimeSalesAlerts
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-white/5 bg-zinc-950 text-zinc-500"
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
                              ? "bg-emerald-500 animate-pulse"
                              : "bg-zinc-600"
                          }`}
                        />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[10px] text-zinc-400 leading-none">
                          Mostra na loja avisos de compras em tempo real.
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setIsSocialProofExpanded(!isSocialProofExpanded)
                          }
                          className="flex items-center text-[10px] font-bold text-emerald-400 hover:text-emerald-300 leading-none"
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
                    className="scale-90 data-[state=checked]:bg-emerald-500"
                    disabled={isOffline || isUpdatingConfig}
                  />
                </div>

                <AnimatePresence initial={false}>
                  {isSocialProofExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2.5 pt-2.5 border-t border-white/5 text-[10px] leading-relaxed text-zinc-400 space-y-1">
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
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2 text-[9px] font-black uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/20 active:scale-95 disabled:opacity-40"
              >
                <Zap className="size-3 fill-emerald-400" />
                Testar Recebimento Neste Aparelho
              </button>
            )}
          </div>
        </SecaoColapsavel>
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
            <h4 className="border-l-2 border-emerald-500 pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              O que você pode fazer aqui
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Send className="size-3.5 text-emerald-500" />
                  Enviar Notificação
                </div>
                <p className="text-xs text-zinc-400">
                  Escreva o título, a mensagem e escolha qual tela abre quando o
                  cliente clica.
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Sparkles className="size-3.5 text-emerald-400" />
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
