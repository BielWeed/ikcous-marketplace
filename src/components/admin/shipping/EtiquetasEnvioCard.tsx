import { Skeleton } from "@/components/ui/skeleton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  ExternalLink,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Card "Etiquetas de envio (Melhor Envio)" da tela de Frete — Onda 3
 * (rastreio automático; frente glm-onda3-rastreio-0309, 03/09/2026).
 *
 * O QUE FAZ: gera a etiqueta de envio de um pedido direto pela API do Melhor
 * Envio (1 clique com confirmação explícita) e mostra o código de rastreio +
 * o link de impressão. Até aqui o lojista comprava a etiqueta no site do ME
 * e digitava o código à mão na ficha do pedido.
 *
 * CONFIRMAÇÃO EXPLÍCITA OBRIGATÓRIA: a etiqueta usa o SALDO da conta do
 * lojista no Melhor Envio (checkout da API). Por isso o primeiro clique só
 * ABRE a confirmação; a geração só sai no segundo clique, com o pedido
 * nomeado. Nada gera etiqueta sem esse passo.
 *
 * IDEMPOTÊNCIA DE DINHEIRO (a function reforça, a tela repete): só pedido com
 * pagamento confirmado entra na lista, e pedido que já tem etiqueta devolve a
 * etiqueta existente (`already: true`) — re-clique ou aba lenta não compra
 * etiqueta duas vezes.
 *
 * Quem fala com a API é a edge function `melhor-envio-etiqueta` (admin-only);
 * este card NUNCA escreve no pedido direto — quem grava tracking_code e
 * etiqueta é a function, que também registra o evento no histórico de envio.
 */

type EtiquetaFase = "ocioso" | "confirmar" | "gerando" | "pronto";

// Tamanho da página da lista: mesmo valor de antes do achado 116, só que
// agora paginado por `.range()` em vez de um `.limit()` cego — "Carregar
// mais" pede a PRÓXIMA janela (offset += PAGE_SIZE) em vez de esconder tudo
// depois do pedido 20.
const PAGE_SIZE = 20;

// Teto da busca: o id do pedido é `uuid` no banco, e o PostgREST não casa
// `ilike` (busca por trecho) direto numa coluna uuid — exigiria um cast
// (`id::text`) sem precedente neste repo e arriscado de acertar às cegas
// aqui (achado 116 é só a tela; mexer em RPC/SQL é outra tarefa). Por isso
// a busca traz uma janela maior de pedidos vivos do servidor e filtra
// id/nome no cliente — 500 cobre com folga o cenário do achado ("~25 vendas
// pagas por dia").
//
// PII MINIMIZADA (achado ANTES DE CRESCER da rodada de correção): a consulta
// não traz mais `customer_data` inteiro (contém PII do comprador — whatsapp,
// endereço, CEP — migration 20261038000000) só para ler um campo. Pede
// direto o caminho JSON no `select` (`customer_data->>shipping_option_id`,
// sintaxe padrão do PostgREST para expandir um campo de coluna jsonb como
// atributo solto na linha, sem baixar a coluna inteira). O PostgREST devolve
// esse campo com o NOME DO CAMINHO (`shipping_option_id` solto, não
// aninhado em `customer_data`) — por isso `rotuloEtiquetaPedido` abaixo lê
// `p.shipping_option_id` direto, não mais `p.customer_data?.shipping_option_id`.
// Sem Postgres real nesta sessão para confirmar contra o schema vivo: se o
// comportamento divergir do documentado, a consulta falha ALTO (cai em
// `pedidosError`, com "Tentar de novo" na tela) — não corrompe dado nem
// finge sucesso calado.
const TETO_BUSCA = 500;

// Formato do id de opção que o checkout grava quando o cliente escolheu um
// serviço do Melhor Envio (mesmo padrão de `extrairServiceIdDaOpcao` em
// supabase/functions/melhor-envio-etiqueta/index.ts — duplicado aqui porque
// a function roda em Deno e esta tela não importa dali). Pedido de frete
// fixo/local ou de frete GRÁTIS (achado irmão index-691: sai com
// `shipping_option_id` nulo) não casa — e a tela avisa "sem serviço do ME"
// ANTES do clique, em vez do lojista descobrir só com o 400 da function.
//
// CONTRATO PENDENTE (achado ANOTADO da rodada de correção): a edge
// `melhor-envio-etiqueta` já classifica o pedido de frete grátis como
// RESGATÁVEL — `erroDeServicoParaEtiqueta` responde 400 com
// `precisa_escolher_servico: true` e existe `normalizarServicoEscolhidoPeloLojista`
// esperando um `serviceId` do card. O aviso abaixo cobre só a METADE de
// "avisar antes do clique"; a outra metade do contrato — um seletor de
// serviço aqui na tela, que devolva `serviceId` no corpo do invoke — não
// existe ainda. Se o lojista insistir mesmo com o aviso, a function
// continua recusando e não há como escolher pela tela. Falta tarefa
// própria para o seletor (mexeria em `handleGerarEtiqueta`, fora do
// escopo desta tarefa, que é só a lista).
const SERVICO_MELHOR_ENVIO = /^melhor-envio-\d+$/;

/**
 * O selo que a lista mostra para cada pedido — ANTES de qualquer clique.
 *
 * `shipping_label_id` (não `tracking_code`!) é o campo que de fato impede a
 * compra dupla na function — o rastreio pode nascer vazio num pedido já
 * etiquetado (fetch de tracking em falha suave), então rotular por ele
 * mentiria "ainda não etiquetado" para quem já tem etiqueta (revisor
 * "reprodução", achado 116).
 */
function rotuloEtiquetaPedido(p: any): string {
  if (p.shipping_label_id) return "já etiquetado";
  // Campo solto na linha (não `p.customer_data.shipping_option_id`): o
  // `select` pede o caminho JSON direto (`customer_data->>shipping_option_id`),
  // e o PostgREST devolve esse valor com o nome do próprio caminho — ver
  // comentário de TETO_BUSCA.
  const opcaoDoCheckout = p?.shipping_option_id;
  if (!SERVICO_MELHOR_ENVIO.test(String(opcaoDoCheckout || ""))) {
    return "sem serviço do ME";
  }
  return p.status || "aberto";
}

interface EtiquetaResultado {
  tracking_code: string | null;
  label_url: string | null;
  label_id: string;
  already: boolean;
}

/**
 * Contrato do supabase-js v2 (mesmo padrão de src/hooks/useOrders.ts): quando
 * a edge function responde FORA de 2xx, `data` chega NULL e o corpo da
 * resposta fica em `error.context` (um Response). Lê o corpo do erro da
 * invocação e devolve a mensagem de negócio + o sinal de RESGATE: a function
 * marca `resgate: true` nos ramos em que a etiqueta já existe/está paga (409
 * corrida, 500 gravação, 502 generate pago, 502 indeterminado — revisor E′,
 * PR #423): nesses a tela volta para a lista, porque "Confirmar e gerar"
 * ativo embaixo de uma mensagem que pede para não clicar é convite ao
 * re-clique. CONTRATO EXPLÍCITO no lugar de regex sobre a prosa em
 * português. Sem corpo legível: mensagem genérica, sem resgate.
 */
async function mensagemDeErroInvocacao(
  err: unknown,
  opcoes: { mensagemGenerica: string },
): Promise<{ mensagem: string; resgate: boolean }> {
  try {
    const corpo = await (
      err as { context?: { json?: () => unknown } }
    )?.context?.json?.();
    if (
      corpo &&
      typeof corpo === "object" &&
      "error" in corpo &&
      (corpo as { error: unknown }).error
    ) {
      return {
        mensagem: String((corpo as { error: unknown }).error),
        resgate: (corpo as { resgate?: unknown }).resgate === true,
      };
    }
  } catch {
    // Corpo ilegível: segue para a mensagem genérica.
  }
  return {
    mensagem: mensagemAmigavelErroEdgeFunction(err as Error, opcoes),
    resgate: false,
  };
}

export const EtiquetasEnvioCard = memo(function EtiquetasEnvioCard() {
  const isOffline = useOnlineStatus();

  const [pedidos, setPedidos] = useState<any[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [temMaisPedidos, setTemMaisPedidos] = useState(false);
  const [pedidosError, setPedidosError] = useState(false);
  const [busca, setBusca] = useState("");
  // Só o clique em "Buscar" (ou Enter) refaz a consulta — `busca` sozinho
  // reescreveria a cada tecla e brigaria com a digitação, mesmo padrão do
  // `pedidoSelecionado` que só muda a lista depois de um evento explícito.
  const [buscaAplicada, setBuscaAplicada] = useState("");
  // A busca veio da janela CHEIA de TETO_BUSCA e não achou nada — usado só
  // para trocar a frase de "não encontrei" por "pode estar fora da janela"
  // (achado ANTES DE CRESCER).
  const [buscaTruncada, setBuscaTruncada] = useState(false);
  const [pedidoSelecionado, setPedidoSelecionado] = useState("");
  const [fase, setFase] = useState<EtiquetaFase>("ocioso");
  const [resultado, setResultado] = useState<EtiquetaResultado | null>(null);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const [consultandoRastreio, setConsultandoRastreio] = useState(false);

  // Espelho de `pedidoSelecionado` para o `fetchPedidos` abaixo, que só é
  // recriado quando `buscaAplicada` muda: um `fetchPedidos()` disparado por
  // um handler criado ANTES de uma seleção nova (ex.: o catch do erro de
  // RESGATE em `handleGerarEtiqueta`) chamaria a closure VELHA de
  // `fetchPedidos`, que leria o `pedidoSelecionado` de quando ELA foi
  // criada — não o que está selecionado agora — e a guarda de seleção órfã
  // julgaria errado (mesmo padrão de `enabledRef` em src/hooks/useOrders.ts).
  const pedidoSelecionadoRef = useRef(pedidoSelecionado);
  pedidoSelecionadoRef.current = pedidoSelecionado;

  // Mesmo motivo do ref acima, para a guarda de seleção órfã de
  // `fetchPedidos` não limpar a seleção enquanto o painel de sucesso
  // ("pronto") está na tela (achado BLOQUEIA da rodada de correção).
  const faseRef = useRef(fase);
  faseRef.current = fase;

  const pedido = pedidos.find((p) => p.id === pedidoSelecionado) || null;

  // Uma página (ou a janela cheia da busca) de pedidos vivos para envio:
  // cancelado e entregue não etiquetam, e só pagamento CONFIRMADO etiqueta
  // (`pago`, `pago_apos_expirar` e `recebido_na_entrega` — os TRÊS valores
  // de "dinheiro que entrou" do CHECK, o MESMO critério de falha fechado que
  // a function aplica; a lista já nasce honesta e ninguém gasta saldo com
  // pedido não pago). `shipping` é o valor do frete que o cliente pagou —
  // entra na confirmação. `shipping_label_id` e `shipping_option_id` (campo
  // extraído de `customer_data`, não a coluna inteira — ver TETO_BUSCA)
  // alimentam o selo de `rotuloEtiquetaPedido` (achado 116).
  //
  // Sem termo de busca: pagina de verdade por `.range()` (offset/offset+19).
  // Com termo: traz a janela de `TETO_BUSCA` pedidos e filtra id/nome no
  // cliente (ver docstring de TETO_BUSCA — cast de uuid no PostgREST fica
  // fora do escopo desta tela).
  const buscarPedidos = useCallback(
    async (
      offset: number,
      termo: string,
    ): Promise<{ linhas: any[]; janelaTruncada: boolean }> => {
      const termoLimpo = termo.trim();
      const { data, error } = await supabase
        .from("marketplace_orders")
        .select(
          "id, customer_name, status, payment_status, shipping, tracking_code, shipping_label_id, created_at, customer_data->>shipping_option_id",
        )
        .in("status", ["new", "pending", "processing", "shipping"])
        .in("payment_status", [
          "pago",
          "pago_apos_expirar",
          "recebido_na_entrega",
        ])
        .order("created_at", { ascending: false })
        .range(
          termoLimpo ? 0 : offset,
          termoLimpo ? TETO_BUSCA - 1 : offset + PAGE_SIZE - 1,
        );
      if (error) throw error;
      const linhas = data || [];
      if (!termoLimpo) return { linhas, janelaTruncada: false };
      // A janela de busca veio CHEIA (as `TETO_BUSCA` linhas pedidas) — pode
      // existir pedido mais antigo que o filtro no cliente nunca chega a
      // ver. Sem marcar isso, um resultado vazio mentiria "esse pedido não
      // existe" quando na verdade é só "está fora da janela pesquisada"
      // (achado ANTES DE CRESCER da rodada de revisão: loja com 600 pedidos
      // vivos, busca pelo mais antigo, tela diz "Nenhum pedido encontrado").
      const janelaTruncada = linhas.length === TETO_BUSCA;
      const alvo = termoLimpo.toLowerCase();
      const filtradas = linhas.filter(
        (p) =>
          String(p.id).toLowerCase().includes(alvo) ||
          String(p.customer_name || "")
            .toLowerCase()
            .includes(alvo),
      );
      return { linhas: filtradas, janelaTruncada };
    },
    [],
  );

  // Contador de geração (achado ANOTADO da rodada de correção): "Buscar",
  // "Limpar busca" e "Carregar mais" agora são TRÊS gatilhos concorrentes
  // para a mesma lista, e nenhuma das consultas cancela a anterior. Sem
  // isso, a resposta que chega POR ÚLTIMO vence, mesmo sendo a mais velha —
  // ex.: lojista busca "Silva", desiste e clica "Limpar busca" antes da
  // busca voltar; se a busca (mais lenta) responder depois do "Limpar", ela
  // reescreveria a lista já limpa com o resultado filtrado, e o lojista
  // ficaria preso numa lista sem "Limpar busca" nem "Carregar mais" (o
  // `temMaisPedidos` daquela resposta foi calculado com busca ativa). Mesmo
  // padrão de `generation` em src/hooks/useOnlineStatus.ts: incrementa no
  // INÍCIO de cada chamada e descarta o resultado se a geração mudou
  // enquanto ela estava em voo.
  const geracaoRef = useRef(0);

  const fetchPedidos = useCallback(async () => {
    const minhaGeracao = ++geracaoRef.current;
    setLoadingPedidos(true);
    // Limpa o erro da rodada anterior no início de CADA busca — mesmo padrão
    // do Histórico de cotações: um "Atualizar" que deu certo não deixa o
    // aviso vermelho velho na tela.
    setPedidosError(false);
    try {
      const { linhas, janelaTruncada } = await buscarPedidos(0, buscaAplicada);
      // Resposta obsoleta (uma consulta mais nova já começou e talvez já
      // tenha resolvido) — descarta sem tocar em nenhum estado.
      if (geracaoRef.current !== minhaGeracao) return;
      setPedidos(linhas);
      setBuscaTruncada(janelaTruncada);
      // Com busca aplicada a janela de TETO_BUSCA já veio inteira e foi
      // filtrada no cliente — "Carregar mais" não faz sentido nesse modo.
      setTemMaisPedidos(!buscaAplicada && linhas.length === PAGE_SIZE);
      // Seleção órfã não sobrevive à troca da lista: toda recarga por aqui
      // (busca, "Limpar busca", ou o fetchPedidos() do catch/sucesso de
      // handleGerarEtiqueta/handleConsultarRastreio) pode fazer o pedido
      // escolhido sair da janela nova. `pedido` (linha ~195, derivado de
      // `pedidos.find(...)`) já vira null sozinho nesse caso — é ELE quem
      // desabilita "Gerar etiqueta" e o early-return de `handleGerarEtiqueta`
      // agora, não mais um `!pedidoSelecionado` cego (achado BLOQUEIA da
      // rodada de correção: a versão antiga chamava `setFase("ocioso")` e
      // `setErroMsg(null)` aqui, e como o refetch de sucesso/resgate sempre
      // recarrega a PÁGINA 1, um pedido alcançado por "Carregar mais"
      // derrubava a fase "pronto" — apagando o painel verde com o rastreio
      // — ou apagava a mensagem de RESGATE que carrega o id da etiqueta já
      // paga, exatamente quando o lojista mais precisa dela na tela). Esta
      // guarda só limpa a SELEÇÃO (para o <select> não ficar mostrando um id
      // que já não existe na lista), nunca `fase` nem `erroMsg` — e nem isso
      // quando a fase é "pronto" (o resultado da compra não depende do
      // <select>, e não há motivo para mexer no estado da seleção enquanto o
      // painel de sucesso está na tela). Lê pelo ref — não por
      // `pedidoSelecionado` direto — pelo motivo do comentário do ref acima.
      const selecionadoAtual = pedidoSelecionadoRef.current;
      if (
        selecionadoAtual &&
        faseRef.current !== "pronto" &&
        !linhas.some((p) => p.id === selecionadoAtual)
      ) {
        setPedidoSelecionado("");
      }
    } catch (err) {
      if (geracaoRef.current !== minhaGeracao) return;
      console.error("[EtiquetasEnvio] Erro ao carregar pedidos:", err);
      setPedidosError(true);
    } finally {
      // Sem guarda de geração: o flag diz só "tenho requisição em voo", e
      // uma requisição mais nova do OUTRO tipo (Carregar mais) já teria
      // deixado este flag preso em true para sempre (ressalva da revisão).
      setLoadingPedidos(false);
    }
  }, [buscarPedidos, buscaAplicada]);

  useEffect(() => {
    fetchPedidos();
  }, [fetchPedidos]);

  const handleCarregarMais = useCallback(async () => {
    const minhaGeracao = ++geracaoRef.current;
    setCarregandoMais(true);
    try {
      const { linhas } = await buscarPedidos(pedidos.length, "");
      if (geracaoRef.current !== minhaGeracao) return;
      // Deduplica por id: a paginação é por offset sobre `created_at` sem
      // desempate estável, então um pedido pago ENTRE duas páginas desliza a
      // janela e a fronteira repete a mesma linha — sem isso o React reclama
      // de chave duplicada no <select> e o pedido aparece duas vezes (achado
      // ANOTADO da rodada de revisão).
      setPedidos((prev) => {
        const idsExistentes = new Set(prev.map((p) => p.id));
        return [...prev, ...linhas.filter((l) => !idsExistentes.has(l.id))];
      });
      setTemMaisPedidos(linhas.length === PAGE_SIZE);
    } catch (err) {
      if (geracaoRef.current !== minhaGeracao) return;
      console.error("[EtiquetasEnvio] Erro ao carregar mais pedidos:", err);
      toast.error("Não foi possível carregar mais pedidos.");
    } finally {
      // Idem: limpar em resposta obsoleta é correto e idempotente; guardar
      // pelo contador deixava o botão "Carregar mais" travado quando um
      // "Buscar" mais novo o ultrapassava.
      setCarregandoMais(false);
    }
  }, [buscarPedidos, pedidos.length]);

  const handleGerarEtiqueta = useCallback(async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    // `pedido` (derivado de `pedidos.find(...)`) é null tanto para "nada
    // selecionado" quanto para "a seleção saiu da lista recarregada" — a
    // MESMA guarda cobre os dois casos sem precisar de ref nem de mexer em
    // `fase`/`erroMsg` no fetch (achado BLOQUEIA da rodada de correção).
    if (!pedido) {
      toast.error("Selecione um pedido para gerar a etiqueta.");
      return;
    }

    setFase("gerando");
    setErroMsg(null);
    haptic.medium();
    try {
      const { data, error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        {
          body: { action: "gerar_etiqueta", orderId: pedidoSelecionado },
        },
      );
      // Contrato do supabase-js v2: resposta fora de 2xx vem em `error` com
      // `data` null — a mensagem de negócio da function está no corpo de
      // `error.context`. (Esta function nunca responde 2xx com `error` no
      // corpo, então só `error` precisa ser checado.)
      if (error) {
        throw error;
      }

      setResultado({
        tracking_code: data?.tracking_code ?? null,
        label_url: data?.label_url ?? null,
        label_id: String(data?.label_id || ""),
        already: !!data?.already,
      });
      setFase("pronto");
      haptic.success();
      toast.success(
        data?.already
          ? "Este pedido já tinha etiqueta gerada — nada foi comprado de novo."
          : "Etiqueta gerada com sucesso!",
      );
      fetchPedidos();
    } catch (err) {
      console.error("[EtiquetasEnvio] Erro na geração:", err);
      const { mensagem: detalhe, resgate } = await mensagemDeErroInvocacao(
        err,
        {
          mensagemGenerica:
            "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
        },
      );
      setErroMsg(detalhe);
      // Em erro de RESGATE (a function marcou `resgate: true` — etiqueta já
      // existe/está paga) o botão de gasto não pode ficar ativo (revisor,
      // E e E′, PR #423): recarrega a lista e volta para ela em vez de
      // reapresentar "Confirmar e gerar" — o re-clique nesses casos só
      // devolve `already` sem link. O detalhe de negócio NÃO morre no toast:
      // com a fase em "ocioso" o bloco vermelho acima de "Gerar etiqueta"
      // mantém a mensagem na tela (revisor, item I, PR #423).
      // Só o RESGATE recarrega a lista (a etiqueta existe e precisa aparecer
      // como emitida). Em erro comum a lista e a seleção ficam como estão:
      // o refetch volta à página 1 e, para um pedido alcançado por
      // "Carregar mais", derrubava a seleção e reabria "confirmar" com
      // pedido null, sem nome, frete nem botão (ressalva da revisão r3).
      if (resgate) fetchPedidos();
      setFase(resgate ? "ocioso" : "confirmar");
      haptic.error();
      toast.error(resgate ? detalhe : "Erro ao gerar etiqueta");
    }
  }, [isOffline, pedido, pedidoSelecionado, fetchPedidos]);

  const handleConsultarRastreio = useCallback(async () => {
    if (isOffline || !pedidoSelecionado) return;
    setConsultandoRastreio(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        {
          body: { action: "consultar_rastreio", orderId: pedidoSelecionado },
        },
      );
      // Mesmo contrato do gerar: erro de negócio vem em `error.context`.
      if (error) {
        throw error;
      }
      if (data?.tracking_code) {
        setResultado((prev) =>
          prev ? { ...prev, tracking_code: String(data.tracking_code) } : prev,
        );
        toast.success("Rastreio atualizado!");
      } else {
        toast.info(
          "A transportadora ainda não publicou o código. Tente novamente mais tarde.",
        );
      }
      fetchPedidos();
    } catch (err) {
      console.error("[EtiquetasEnvio] Erro ao consultar rastreio:", err);
      const { mensagem } = await mensagemDeErroInvocacao(err, {
        mensagemGenerica:
          "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
      });
      toast.error(mensagem);
    } finally {
      setConsultandoRastreio(false);
    }
  }, [isOffline, pedidoSelecionado, fetchPedidos]);

  const voltarParaLista = useCallback(() => {
    setFase("ocioso");
    setResultado(null);
    setErroMsg(null);
    setPedidoSelecionado("");
  }, []);

  // Espelho booleano para o render: `fase !== "confirmar" ? A : B` faria o
  // TypeScript acharem que dentro de B a fase só pode ser "confirmar" — e
  // recusar o `fase === "gerando"` do clique em andamento (que MUDA a fase
  // durante o await). A booleana derivada não estreita o tipo da fase.
  const confirmacaoAberta = fase === "confirmar" || fase === "gerando";

  // O lojista confirma o gasto vendo o que o cliente pagou de frete (revisor,
  // item 7): serviço Melhor Envio + valor do pedido selecionado, quando existe.
  const freteTexto =
    pedido?.shipping != null && Number(pedido.shipping) > 0
      ? `Melhor Envio — frete pago pelo cliente: R$ ${Number(pedido.shipping)
          .toFixed(2)
          .replace(".", ",")}`
      : null;

  return (
    <div
      id="etiquetas-envio-section"
      className="admin-glass border-y border-white/5 p-3.5 shadow-2xl sm:rounded-2xl sm:border-x sm:p-4"
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-left text-[9.5px] leading-snug text-zinc-400">
          <PackageCheck className="mt-0.5 size-3.5 shrink-0 text-admin-gold" />
          <span>
            Gere a etiqueta de envio de um pedido com um clique — o código de
            rastreio é salvo no pedido automaticamente. A etiqueta usa o saldo
            da sua conta no Melhor Envio; a chave fica em{" "}
            <span className="font-semibold text-zinc-300">
              Ajustes &gt; Transportadoras
            </span>
            .
          </span>
        </p>

        {fase === "pronto" && resultado ? (
          /* ── Resultado: a etiqueta existe ─────────────────────────────── */
          <div className="space-y-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 duration-200 animate-in fade-in">
            <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-300">
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span>
                {resultado.already
                  ? "Este pedido já tinha etiqueta — nada foi comprado de novo."
                  : "Etiqueta gerada e vinculada ao pedido!"}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/60 px-2.5 py-2">
              <div className="min-w-0">
                <span className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                  Código de rastreio
                </span>
                <span
                  className="block truncate font-mono text-xs font-bold text-white"
                  data-testid="codigo-rastreio"
                >
                  {resultado.tracking_code ||
                    "Ainda sem código — atualize depois da postagem"}
                </span>
              </div>
              <Barcode className="size-4 shrink-0 text-zinc-500" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {resultado.label_url && (
                <a
                  href={resultado.label_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-admin-gold transition-colors hover:bg-admin-gold/20 active:scale-95"
                >
                  <ExternalLink className="size-3" />
                  <span>Abrir etiqueta</span>
                </a>
              )}
              <button
                type="button"
                onClick={handleConsultarRastreio}
                disabled={consultandoRastreio || isOffline}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:text-white active:scale-95 disabled:opacity-40"
              >
                <RefreshCw
                  className={`size-3 ${consultandoRastreio ? "animate-spin" : ""}`}
                />
                <span>Atualizar rastreio</span>
              </button>
              <button
                type="button"
                onClick={voltarParaLista}
                className="ml-auto rounded-lg px-2 py-1.5 text-[10px] font-bold text-zinc-400 transition-colors hover:text-white"
              >
                Gerar para outro pedido
              </button>
            </div>
          </div>
        ) : (
          /* ── Lista de pedidos + confirmação ───────────────────────────── */
          <div className="space-y-2.5">
            {/* Busca por número do pedido (sufixo do id que a lista mostra)
                ou nome do cliente — alcança um pedido que caiu fora da
                janela carregada sem precisar clicar em "Carregar mais"
                várias vezes (achado 116, cenário da loja de movimento). Só
                dispara na busca EXPLÍCITA (botão/Enter), não a cada tecla —
                mesmo motivo de `buscaAplicada` ser estado separado. */}
            <div className="space-y-1.5">
              <label
                htmlFor="busca-pedido-etiqueta"
                className="block text-[11px] font-semibold text-zinc-300"
              >
                Buscar pedido
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="busca-pedido-etiqueta"
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setBuscaAplicada(busca.trim());
                    }
                  }}
                  disabled={isOffline}
                  placeholder="Número do pedido ou nome do cliente"
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/60 px-2.5 text-xs font-semibold text-white focus:border-admin-gold focus:outline-none disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={() => setBuscaAplicada(busca.trim())}
                  disabled={isOffline}
                  className="h-9 shrink-0 rounded-lg border border-white/10 bg-zinc-900 px-3 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:text-white disabled:opacity-40"
                >
                  Buscar
                </button>
              </div>
              {buscaAplicada && (
                <button
                  type="button"
                  onClick={() => {
                    setBusca("");
                    setBuscaAplicada("");
                  }}
                  className="text-[10px] font-bold text-zinc-400 underline transition-colors hover:text-white"
                >
                  Limpar busca
                </button>
              )}
            </div>

            {loadingPedidos ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full rounded-lg bg-white/5" />
              </div>
            ) : pedidosError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-center text-xs font-semibold text-red-300">
                Não foi possível carregar os pedidos.{" "}
                <button
                  type="button"
                  onClick={fetchPedidos}
                  className="font-black underline hover:no-underline"
                >
                  Tentar de novo
                </button>
              </div>
            ) : pedidos.length === 0 ? (
              <p className="py-2 text-center text-xs text-zinc-400">
                {buscaAplicada
                  ? buscaTruncada
                    ? "Nada encontrado entre os 500 pedidos mais recentes — refine o termo ou tente pelo site do Melhor Envio."
                    : `Nenhum pedido encontrado para "${buscaAplicada}".`
                  : "Nenhum pedido aberto para etiquetar — pedidos cancelados e entregues não aparecem aqui."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {/* Mesmo aviso do caso "zero resultados" (achado ANTES DE
                    CRESCER da rodada de correção): a janela de busca veio
                    CHEIA e AINDA ASSIM achou pedido(s) — sem esta linha o
                    lojista não tem como saber que pode existir um pedido
                    mais antigo, fora da janela de TETO_BUSCA, que o termo
                    também casaria. A assimetria (só avisar quando dá zero)
                    era o próprio defeito. */}
                {buscaAplicada && buscaTruncada && (
                  <p className="text-[9.5px] font-medium leading-snug text-zinc-500">
                    Mostrando resultados dentro dos {TETO_BUSCA} pedidos mais
                    recentes — pode haver pedidos mais antigos fora desta
                    janela.
                  </p>
                )}
                <label
                  htmlFor="pedido-etiqueta-select"
                  className="block text-[11px] font-semibold text-zinc-300"
                >
                  Pedido
                </label>
                <select
                  id="pedido-etiqueta-select"
                  value={pedidoSelecionado}
                  onChange={(e) => {
                    setPedidoSelecionado(e.target.value);
                    setFase("ocioso");
                    setErroMsg(null);
                  }}
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/60 px-2.5 text-xs font-semibold text-white focus:border-admin-gold focus:outline-none"
                >
                  <option value="">Selecione o pedido…</option>
                  {pedidos.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{String(p.id).slice(-6)} — {p.customer_name || "Cliente"}{" "}
                      ({rotuloEtiquetaPedido(p)})
                    </option>
                  ))}
                </select>
                {/* "Carregar mais" pagina de verdade (`.range()`) em vez de
                    esconder tudo depois do pedido 20 — some durante a busca,
                    que já trouxe a janela de TETO_BUSCA inteira. */}
                {temMaisPedidos && !buscaAplicada && (
                  <button
                    type="button"
                    onClick={handleCarregarMais}
                    disabled={carregandoMais || isOffline}
                    className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:text-white disabled:opacity-40"
                  >
                    {carregandoMais ? "Carregando…" : "Carregar mais pedidos"}
                  </button>
                )}
              </div>
            )}

            {!confirmacaoAberta ? (
              <>
                {/* Erro de RESGATE fica NA TELA (revisor, item I, PR #423): o
                    id da etiqueta que amarra o pedido à compra no Melhor Envio
                    não pode viver só ~4 s no toast — fica aqui, acima do botão
                    de gasto, até o lojista trocar de pedido (o onChange do
                    select limpa) ou reabrir a confirmação. */}
                {erroMsg && (
                  <p
                    data-testid="erro-etiqueta"
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[10.5px] font-semibold leading-snug text-red-300 duration-200 animate-in fade-in"
                  >
                    {erroMsg}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    // `pedido`, não `pedidoSelecionado`: cobre também o caso
                    // (raro, o botão já vem `disabled`) de a seleção ter
                    // saído da lista recarregada — achado BLOQUEIA da rodada
                    // de correção, ver comentário da guarda em `fetchPedidos`.
                    if (!pedido) {
                      toast.error("Selecione um pedido para gerar a etiqueta.");
                      return;
                    }
                    setErroMsg(null);
                    setFase("confirmar");
                  }}
                  disabled={!pedido || isOffline || loadingPedidos}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-admin-gold/30 bg-admin-gold px-4 py-2.5 text-xs font-bold text-black shadow-lg shadow-amber-500/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:w-auto"
                >
                  <PackageCheck className="size-3.5" />
                  <span>Gerar etiqueta</span>
                </button>
              </>
            ) : (
              /* ── Confirmação explícita: o saldo é de verdade ─────────── */
              <div className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 duration-200 animate-in fade-in">
                <p className="flex items-start gap-1.5 text-[10.5px] font-bold leading-snug text-amber-200">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                  <span>
                    A etiqueta é comprada com o saldo da SUA conta no Melhor
                    Envio. Confirmar a geração para{" "}
                    <span className="text-white">
                      {pedido?.customer_name || "o pedido selecionado"}
                    </span>
                    ?
                    {freteTexto && (
                      <span className="mt-1 block font-semibold text-amber-100/90">
                        Serviço: {freteTexto}
                      </span>
                    )}
                  </span>
                </p>
                {erroMsg && (
                  <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[10.5px] font-semibold leading-snug text-red-300">
                    {erroMsg}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGerarEtiqueta}
                    disabled={fase === "gerando" || isOffline}
                    className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                  >
                    {fase === "gerando" ? (
                      <RefreshCw className="size-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3" />
                    )}
                    <span>
                      {fase === "gerando" ? "Gerando…" : "Confirmar e gerar"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFase("ocioso")}
                    disabled={fase === "gerando"}
                    className="rounded-lg px-2.5 py-2 text-[10px] font-bold text-zinc-400 transition-colors hover:text-white disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
