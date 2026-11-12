import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { criarCanalDeAbas } from "@/lib/canal-de-abas";
import {
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import type { Notification } from "@/types";
import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { NotificationContext } from "./NotificationContextCore";

// Notificação de campanha ("Todos os Clientes", AdminPushView) grava UMA
// linha só, com usuario_id NULO — vista por toda cliente. As policies de
// UPDATE/DELETE de `notificacoes` exigem `auth.uid() = usuario_id`
// (supabase/migrations/20260806000000_baseline_do_schema_vivo.sql), então
// essa linha nunca pode ser marcada como lida nem apagada no banco por uma
// cliente comum — o Postgrest simplesmente ignora a linha, sem erro. "Lida"
// e "dispensada" para esse tipo de aviso só podem valer NESTE aparelho,
// guardadas localmente por usuário.
function chaveEstadoLocalDaCampanha(userId: string): string {
  return `notificacoes-campanha-estado:${userId}`;
}

// Campanha "para todos" é uma linha só, sem dono: sem filtro de data, cliente
// NOVA abriria o app e veria até 20 campanhas antigas como "não lidas" (com
// cupom vencido), e o contador as contaria. Vale só a que saiu DEPOIS de a
// conta existir e nos últimos 30 dias.
const JANELA_DA_CAMPANHA_MS = 30 * 24 * 60 * 60 * 1000;

function campanhaValeParaACliente(
  criadaEm: string,
  contaCriadaEm: string | undefined,
  agora: number,
): boolean {
  const criada = new Date(criadaEm).getTime();
  if (Number.isNaN(criada) || criada < agora - JANELA_DA_CAMPANHA_MS) {
    return false;
  }
  const conta = contaCriadaEm ? new Date(contaCriadaEm).getTime() : Number.NaN;
  return Number.isNaN(conta) || criada >= conta;
}

// Quantos avisos próprios a tela lê de uma vez. Se a consulta voltar CHEIA,
// pode haver avisos mais antigos fora da lista — a tela avisa a cliente.
const LIMITE_DOS_AVISOS_PROPRIOS = 50;

// "Marcar como lida" grava só os ids que a cliente tinha na mão. Os ids vão
// na URL do pedido (`id=in.(...)`): em lotes, para uma lista grande não
// estourar o tamanho da URL.
const IDS_POR_PEDIDO_AO_BANCO = 100;

function emLotes<T>(itens: T[], tamanho = IDS_POR_PEDIDO_AO_BANCO): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    lotes.push(itens.slice(i, i + tamanho));
  }
  return lotes;
}

interface EstadoLocalDaCampanha {
  lidas: Set<string>;
  ocultas: Set<string>;
}

function lerEstadoLocalDaCampanha(userId: string): EstadoLocalDaCampanha {
  try {
    const bruto = localStorage.getItem(chaveEstadoLocalDaCampanha(userId));
    const dados = bruto ? JSON.parse(bruto) : null;
    return {
      lidas: new Set(Array.isArray(dados?.lidas) ? dados.lidas : []),
      ocultas: new Set(Array.isArray(dados?.ocultas) ? dados.ocultas : []),
    };
  } catch {
    // localStorage indisponível (modo privado, quota etc.) — sem estado
    // local, a marcação de leitura/dispensa fica só nesta sessão em memória.
    return { lidas: new Set(), ocultas: new Set() };
  }
}

function persistirEstadoLocalDaCampanha(
  userId: string,
  estado: EstadoLocalDaCampanha,
): void {
  try {
    localStorage.setItem(
      chaveEstadoLocalDaCampanha(userId),
      JSON.stringify({
        lidas: Array.from(estado.lidas),
        ocultas: Array.from(estado.ocultas),
      }),
    );
  } catch {
    // Mesma ressalva de lerEstadoLocalDaCampanha: falha em silêncio, a tela
    // continua funcionando só sem persistir entre sessões.
  }
}

export function NotificationProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, loading: carregandoConta } = useAuth();
  const { isLeader } = useLeaderElection();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  // Falha de fetch ≠ caixa vazia: sem este estado, a tela anunciava
  // "Tudo em ordem" para uma cliente com avisos não lidos que a consulta
  // não conseguiu trazer.
  const [erro, setErro] = useState<string | null>(null);
  // A última consulta dos avisos próprios voltou cheia: a lista pode ter
  // avisos mais antigos que não aparecem.
  const [listaCortada, setListaCortada] = useState(false);
  // Troca direta de conta (A→B sem passar por deslogado): o efeito de limpeza
  // roda DEPOIS do primeiro quadro, que mostraria os avisos de A para B. Zerar
  // durante a renderização faz o React descartar esse quadro antes de pintar.
  const [donoDosAvisos, setDonoDosAvisos] = useState(user?.id ?? null);
  if (donoDosAvisos !== (user?.id ?? null)) {
    setDonoDosAvisos(user?.id ?? null);
    setNotifications([]);
    setListaCortada(false);
    setErro(null);
    // O efeito logo abaixo busca os avisos da conta nova: até lá o quadro já
    // diz "carregando", em vez de anunciar uma caixa vazia ("Tudo em ordem").
    setLoading(user != null);
  }
  const lastFetchRef = useRef<number>(0);
  // ids da última busca cujo usuario_id era nulo (aviso de campanha) — é o
  // que diferencia, em markAsRead/markAllAsRead/deleteNotification, uma
  // linha que o UPDATE/DELETE do banco alcança de uma que a policy ignora.
  const campanhaIdsRef = useRef<Set<string>>(new Set());

  // Varredura 12/10/2026 — resposta de A que chega depois da troca para B não
  // pode gravar a lista de A nem encerrar o `loading` da rodada de B. Cada
  // busca pega um número de rodada; só a mais recente, do usuário atual,
  // escreve estado.
  const rodadaRef = useRef(0);
  const consultasEmVooRef = useRef(0);
  const usuarioAtualIdRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    const usuarioId = user?.id ?? null;
    if (usuarioAtualIdRef.current !== usuarioId) {
      // Troca direta de conta também encerra os dados da sessão anterior,
      // antes de buscar os avisos da nova conta (mesmo se a consulta falhar).
      setNotifications([]);
      setListaCortada(false);
      campanhaIdsRef.current = new Set();
      setErro(null);
    }
    usuarioAtualIdRef.current = usuarioId;
  }, [user]);

  const fetchNotifications = useCallback(
    async (force = false) => {
      if (!user) {
        rodadaRef.current++;
        setNotifications([]);
        setListaCortada(false);
        campanhaIdsRef.current = new Set();
        setLoading(false);
        // Este ramo NÃO é o caminho do logout (o efeito lá embaixo é, e a
        // limpeza que resolve o defeito mora lá). Ele é alcançado pelo
        // `refresh()` — o botão "Tentar de novo" da tela, tocado por quem não
        // tem sessão. Sem sessão não há o que buscar, mas também não há erro
        // a exibir: limpar aqui é o que faz esse botão deixar de ser um
        // clique que não produz nada.
        setErro(null);
        return;
      }

      const now = Date.now();
      if (!force && now - lastFetchRef.current < 10000) return; // cache 10s
      lastFetchRef.current = now;
      const rodada = ++rodadaRef.current;
      consultasEmVooRef.current++;
      const donoDaRodada = user.id;
      const ehVelha = () =>
        rodada !== rodadaRef.current ||
        usuarioAtualIdRef.current !== donoDaRodada;

      try {
        setLoading(true);
        // Laudo 0109 (A9): a consulta única misturava avisos próprios com
        // campanha (`usuario_id` nulo) num único `.limit(50)` por created_at
        // — cliente frequente com 50+ avisos de status nunca via a campanha
        // que o lojista mandou "para todos", nem no contador de não lidas.
        // As duas pontas andam em paralelo, cada uma com o seu limite;
        // campanha é rara (uma linha por envio), 20 já sobra.
        // Rede "pendurada" conecta e não responde: se UMA das duas nunca
        // voltava, o `loading` ficava ligado para sempre, sem erro e sem
        // "Tentar de novo". O prazo só encerra a ESPERA da tela (a consulta
        // não grava nada): estourou = cai no `catch` abaixo. A resposta tardia
        // da consulta abandonada é descartada por `ehVelha()`.
        const [dosProprios, deCampanha] = await aguardarComPrazo(
          Promise.all([
            supabase
              .from("notificacoes")
              .select("*")
              .eq("usuario_id", user.id)
              .order("created_at", { ascending: false })
              .limit(LIMITE_DOS_AVISOS_PROPRIOS),
            supabase
              .from("notificacoes")
              .select("*")
              .is("usuario_id", null)
              .order("created_at", { ascending: false })
              .limit(20),
          ]),
          PRAZO_DA_CONSULTA_DO_PAINEL_MS,
          () => erroDeConsultaSemResposta(),
        );

        if (ehVelha()) return;
        if (dosProprios.error) throw dosProprios.error;
        if (deCampanha.error) throw deCampanha.error;

        const data = [
          ...(dosProprios.data || []),
          ...(deCampanha.data || []).filter((c) =>
            campanhaValeParaACliente(c.created_at, user.created_at, now),
          ),
        ].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

        const estadoLocal = lerEstadoLocalDaCampanha(user.id);
        const campanhaIds = new Set<string>();

        const mappedData: Notification[] = (data || [])
          .filter((item) => !estadoLocal.ocultas.has(item.id))
          .map((item) => {
            const isCampanha = item.usuario_id === null;
            if (isCampanha) campanhaIds.add(item.id);
            return {
              id: item.id,
              title: item.titulo,
              message: item.mensagem || "",
              type: (item.tipo as any) || "system",
              read:
                !!item.lida || (isCampanha && estadoLocal.lidas.has(item.id)),
              created_at: item.created_at,
              action_url:
                (item.acao as any)?.url || (item.dados as any)?.action_url,
              order_id: (item.dados as any)?.order_id,
            };
          });

        campanhaIdsRef.current = campanhaIds;
        setNotifications(mappedData);
        setListaCortada(
          (dosProprios.data || []).length >= LIMITE_DOS_AVISOS_PROPRIOS,
        );
        setErro(null);
      } catch (err) {
        if (ehVelha()) return;
        console.error("[Notifications] Fetch error:", err);
        setErro("Não conseguimos carregar suas notificações.");
      } finally {
        consultasEmVooRef.current--;
        if (!ehVelha()) setLoading(false);
      }
    },
    [user],
  );

  // Uma ação (ler, excluir) invalida a consulta que já estava no ar, que pode
  // trazer o retrato de antes dela. Se havia consulta no ar, uma nova consulta
  // reconcilia: sem ela, um aviso que só vinha na resposta descartada
  // ficaria ausente até o próximo evento.
  const invalidarConsultasEmVoo = useCallback(() => {
    const havia = consultasEmVooRef.current > 0;
    rodadaRef.current++;
    setLoading(false);
    if (havia) void fetchNotifications(true);
  }, [fetchNotifications]);

  const markAsRead = useCallback(
    async (id: string) => {
      if (user && campanhaIdsRef.current.has(id)) {
        // Aviso de campanha: o UPDATE do banco não alcança essa linha (RLS
        // exige auth.uid() = usuario_id). "Lida" só pode valer aqui.
        const estadoLocal = lerEstadoLocalDaCampanha(user.id);
        estadoLocal.lidas.add(id);
        persistirEstadoLocalDaCampanha(user.id, estadoLocal);
        invalidarConsultasEmVoo();
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
        );
        return;
      }

      // Resposta de A que chega depois da troca direta para B não é de B: não
      // invalida a rodada dele, não mexe na lista e não avisa erro (igual
      // markAllAsRead).
      const donoDaOperacao = user?.id ?? null;
      try {
        const { error } = await supabase
          .from("notificacoes")
          .update({ lida: true })
          .eq("id", id);

        if (error) throw error;
        if (usuarioAtualIdRef.current !== donoDaOperacao) return;
        // A consulta anterior à leitura não pode repor o aviso não lido.
        invalidarConsultasEmVoo();
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
        );
      } catch (err) {
        if (usuarioAtualIdRef.current !== donoDaOperacao) return;
        // Achado 4 da auditoria rodada 2: sem este aviso a cliente toca em
        // "marcar como lida", nada acontece, e nada explica o porquê — ela
        // toca de novo, e de novo. O estado da tela continua honesto (o
        // `setNotifications` acima só roda no caminho de sucesso); o que
        // faltava era a tela CONTAR que não deu.
        console.error("[Notifications] Mark as read error:", err);
        toast.error("Não conseguimos marcar como lida. Tente de novo.");
      }
    },
    [user, invalidarConsultasEmVoo],
  );

  // Espelho de `notifications` para o markOrderAsRead ler a lista de AGORA sem
  // entrar nas dependências (a função mudaria a cada aviso novo, e o efeito da
  // tela do pedido que a chama religaria).
  const notificationsRef = useRef(notifications);
  // Layout effect: o efeito da tela do pedido (filha) roda ANTES dos efeitos
  // normais do provedor (pai) no mesmo commit, e precisa já ver a lista nova.
  useLayoutEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);
  // Pedidos com a marcação em voo: duas chamadas seguidas não geram dois UPDATEs.
  const pedidosEmMarcacaoRef = useRef<Set<string>>(new Set());

  // A cliente abriu o pedido: os avisos dele (já vistos na tela) deixam de pesar
  // no contador do sino. Um UPDATE só, amarrado à dona e ao pedido; o filtro
  // `usuario_id` também deixa de fora os avisos de campanha (que a policy não
  // alcança). Ação automática: sem internet ou sem conta não faz nada, e falha
  // não gera aviso na tela (ela não pediu nada) — o aviso só segue não lido.
  const markOrderAsRead = useCallback(
    async (orderId: string) => {
      if (!user) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }
      const idsDoPedido = new Set(
        notificationsRef.current
          .filter(
            (n) =>
              !n.read &&
              n.order_id === orderId &&
              !campanhaIdsRef.current.has(n.id),
          )
          .map((n) => n.id),
      );
      if (idsDoPedido.size === 0) return;
      if (pedidosEmMarcacaoRef.current.has(orderId)) return;
      pedidosEmMarcacaoRef.current.add(orderId);

      const donoDaOperacao = user.id;
      try {
        // O UPDATE vai FILTRADO pelos ids que a cliente tinha na mão: sem o
        // filtro de ids, o banco marcava também o aviso do mesmo pedido que
        // nasceu enquanto o pedido de gravar ainda viajava.
        for (const lote of emLotes(Array.from(idsDoPedido))) {
          const { error } = await supabase
            .from("notificacoes")
            .update({ lida: true })
            .in("id", lote)
            .eq("usuario_id", donoDaOperacao)
            .eq("lida", false)
            .contains("dados", { order_id: orderId });
          if (error) throw error;
        }
        if (usuarioAtualIdRef.current !== donoDaOperacao) return;
        invalidarConsultasEmVoo();
        // Só os que estavam na lista quando a chamada saiu: aviso que chegou
        // durante o UPDATE continua não lido (na tela e no banco).
        setNotifications((prev) =>
          prev.map((n) => (idsDoPedido.has(n.id) ? { ...n, read: true } : n)),
        );
      } catch (err) {
        console.error("[Notifications] Mark order as read error:", err);
      } finally {
        pedidosEmMarcacaoRef.current.delete(orderId);
      }
    },
    [user, invalidarConsultasEmVoo],
  );

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    const donoDaOperacao = user.id;
    const idsNaoLidos = new Set(
      notifications.filter((n) => !n.read).map((n) => n.id),
    );
    const idsDeCampanhaNaoLidos = Array.from(idsNaoLidos).filter((id) =>
      campanhaIdsRef.current.has(id),
    );
    // Só os avisos PRÓPRIOS que a cliente tinha na tela: o UPDATE vai
    // filtrado por esses ids. Sem o filtro, o banco marcava também o aviso
    // que nasceu durante o toque e os mais antigos que a lista de 50 nunca
    // mostrou. Lotes sequenciais: o primeiro que falhar interrompe o resto.
    const idsPropriosNaoLidos = Array.from(idsNaoLidos).filter(
      (id) => !campanhaIdsRef.current.has(id),
    );
    try {
      let error: unknown = null;
      for (const lote of emLotes(idsPropriosNaoLidos)) {
        const resposta = await supabase
          .from("notificacoes")
          .update({ lida: true })
          .in("id", lote)
          .eq("usuario_id", donoDaOperacao)
          .eq("lida", false);
        if (resposta.error) {
          error = resposta.error;
          break;
        }
      }

      const contaMudou = usuarioAtualIdRef.current !== donoDaOperacao;
      if (error) {
        if (contaMudou) return;
        throw error;
      }

      // O UPDATE acima só alcança as linhas da própria cliente. Os avisos de
      // campanha (usuario_id nulo) que ainda estavam não lidos ficam de fora
      // da policy — a leitura deles é registrada localmente, para o contador
      // e a lista concordarem com o que a tela acabou de afirmar.
      if (idsDeCampanhaNaoLidos.length > 0) {
        // Gravar na chave de A é certo mesmo se a conta já trocou: o gesto foi de A.
        const estadoLocal = lerEstadoLocalDaCampanha(donoDaOperacao);
        for (const id of idsDeCampanhaNaoLidos) estadoLocal.lidas.add(id);
        persistirEstadoLocalDaCampanha(donoDaOperacao, estadoLocal);
      }

      // O estado em memória já é de outra conta: não toca.
      if (contaMudou) return;
      invalidarConsultasEmVoo();

      // Avisos que chegaram durante o UPDATE continuam não lidos (na tela e,
      // agora, também no banco).
      setNotifications((prev) =>
        prev.map((n) => (idsNaoLidos.has(n.id) ? { ...n, read: true } : n)),
      );
    } catch (err) {
      // Achado 4 da auditoria rodada 2 — mesmo motivo do markAsRead.
      console.error("[Notifications] Mark all as read error:", err);
      toast.error(
        "Não conseguimos marcar os avisos como lidos. Tente de novo.",
      );
    }
  }, [user, notifications, invalidarConsultasEmVoo]);

  const deleteNotification = useCallback(
    async (id: string) => {
      if (user && campanhaIdsRef.current.has(id)) {
        // O DELETE do banco também exige auth.uid() = usuario_id — dispensar
        // um aviso de campanha só pode significar "sumir dele neste
        // aparelho", nunca apagar a linha (que é de todas as clientes).
        const estadoLocal = lerEstadoLocalDaCampanha(user.id);
        estadoLocal.ocultas.add(id);
        estadoLocal.lidas.delete(id);
        persistirEstadoLocalDaCampanha(user.id, estadoLocal);
        invalidarConsultasEmVoo();
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        return;
      }

      // Mesma guarda do markAsRead: resposta de A não mexe em B.
      const donoDaOperacao = user?.id ?? null;
      try {
        const { error } = await supabase
          .from("notificacoes")
          .delete()
          .eq("id", id);

        if (error) throw error;
        if (usuarioAtualIdRef.current !== donoDaOperacao) return;
        invalidarConsultasEmVoo();
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      } catch (err) {
        if (usuarioAtualIdRef.current !== donoDaOperacao) return;
        // Achado 4 da auditoria rodada 2 — mesmo motivo do markAsRead. Este é
        // o pior dos três para quem usa: apagar é o gesto de que a pessoa mais
        // espera retorno imediato.
        console.error("[Notifications] Delete error:", err);
        toast.error("Não conseguimos apagar este aviso. Tente de novo.");
      }
    },
    [user, invalidarConsultasEmVoo],
  );

  useEffect(() => {
    const bc = criarCanalDeAbas("ikcous_notifications");

    if (user) {
      fetchNotifications(true);

      // "Marcar todas como lidas" vira uma rajada de eventos (um por aviso):
      // junta a rajada numa só releitura, e num só aviso às outras abas.
      let esperaDaRajada: ReturnType<typeof setTimeout> | null = null;
      const releituraAposRajada = (avisarAsOutrasAbas: boolean) => {
        if (esperaDaRajada) clearTimeout(esperaDaRajada);
        esperaDaRajada = setTimeout(() => {
          esperaDaRajada = null;
          fetchNotifications(true);
          if (avisarAsOutrasAbas) {
            bc?.postMessage({ type: "notification_update" });
          }
        }, 500);
      };

      // O app volta de segundo plano (o aparelho congela o PWA), a internet
      // volta, ou o canal ao vivo reconecta: avisos que chegaram nesse
      // meio-tempo não vêm por evento nenhum (o Realtime não reenvia o que
      // perdeu). Os três gatilhos passam pela MESMA junção de 500 ms da
      // rajada, então um retorno típico (visível + online + canal) vira UMA
      // releitura; a proteção de rodada do fetch descarta resposta velha.
      // Só existe com usuária logada: o cleanup abaixo remove tudo.
      let ativo = true;
      let canalJaCaiu = false;
      const releituraAoVoltar = () => {
        if (ativo) releituraAposRajada(false);
      };
      const aoMudarDeVisibilidade = () => {
        if (document.visibilityState === "visible") releituraAoVoltar();
      };
      document.addEventListener("visibilitychange", aoMudarDeVisibilidade);
      window.addEventListener("online", releituraAoVoltar);

      let channel: any = null;

      if (isLeader) {
        console.log(
          "[Notifications] Leader tab subscribing to realtime notifications...",
        );
        channel = supabase
          .channel(`notificacoes:${user.id}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "notificacoes",
            },
            () => releituraAposRajada(true),
          )
          .subscribe((status: string) => {
            // A primeira conexão não relê (o efeito já buscou); só o
            // SUBSCRIBED que vem DEPOIS de uma queda.
            if (status === "SUBSCRIBED") {
              if (canalJaCaiu) {
                canalJaCaiu = false;
                releituraAoVoltar();
              }
            } else if (
              status === "CHANNEL_ERROR" ||
              status === "TIMED_OUT" ||
              status === "CLOSED"
            ) {
              canalJaCaiu = true;
            }
          });
      } else {
        console.log(
          "[Notifications] Secondary tab listening to notifications via BroadcastChannel...",
        );
        if (bc) {
          bc.onmessage = (event) => {
            if (event.data?.type === "notification_update") {
              console.log(
                "[Notifications-Secondary] Received notification ping from Leader tab, fetching...",
              );
              releituraAposRajada(false);
            }
          };
        }
      }

      return () => {
        ativo = false;
        document.removeEventListener("visibilitychange", aoMudarDeVisibilidade);
        window.removeEventListener("online", releituraAoVoltar);
        if (esperaDaRajada) clearTimeout(esperaDaRajada);
        if (channel) {
          supabase.removeChannel(channel);
        }
        bc?.close();
      };
    }
    setNotifications([]);
    setListaCortada(false);
    setLoading(false);
    // ESTE é o caminho do logout — o efeito não chama `fetchNotifications`
    // quando `user` some, então limpar `erro` lá dentro não alcança aqui.
    // `erro` descreve a falha de UMA consulta logada e não pode sobreviver à
    // sessão que o criou: o sino do topo abre para qualquer pessoa, e sem
    // esta linha a falha de quem deslogou virava "Não conseguimos carregar"
    // permanente para o visitante seguinte no mesmo aparelho, com o "Tentar
    // de novo" incapaz de limpá-la. Regressão introduzida por mim em 9142182,
    // apontada pela revisão cruzada do parceiro (laudo da rodada 2, #5).
    setErro(null);
    bc?.close();
  }, [user, fetchNotifications, isLeader]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const contextValue = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      erro,
      listaCortada,
      semConta: !user && !carregandoConta,
      markAsRead,
      markOrderAsRead,
      markAllAsRead,
      deleteNotification,
      refresh: () => fetchNotifications(true),
    }),
    [
      notifications,
      unreadCount,
      loading,
      erro,
      listaCortada,
      user,
      carregandoConta,
      markAsRead,
      markOrderAsRead,
      markAllAsRead,
      deleteNotification,
      fetchNotifications,
    ],
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}
