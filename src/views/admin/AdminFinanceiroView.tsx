// Financeiro do painel — "o banco da loja" (spec 2026-09-26, inicio-crm-e-
// financeiro-do-painel): todo o dinheiro da loja física e do app num lugar
// só. Regra de ouro: o dinheiro mora na fonte — vendas e estornos são
// linhas DERIVADAS dos pedidos (a tela só lê); o que não tem fonte (aluguel,
// fornecedor, sangria, conta a pagar) nasce em `fin_lancamentos` pelas RPCs
// `fin_*` (contrato: docs/superpowers/plans/2026-09-26-painel-cartao-e-
// devolucoes.md, seção "Financeiro").
//
// A view é a dona de três coisas que atravessam as abas: o PERÍODO, a
// VERSÃO dos dados (sobe depois de qualquer escrita e toda consulta viva
// busca de novo) e a FOLHA aberta (uma por vez — é o que liga o Voltar do
// celular e o aviso de alterações não salvas ao formulário da vez).

import { CalendarClock, Eye, EyeOff, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import { AbaContasECategorias } from "@/components/admin/financeiro/AbaContasECategorias";
import { AbaDre } from "@/components/admin/financeiro/AbaDre";
import { AbaExtrato } from "@/components/admin/financeiro/AbaExtrato";
import { AbaPrevistos } from "@/components/admin/financeiro/AbaPrevistos";
import { AbaVisao } from "@/components/admin/financeiro/AbaVisao";
import { FolhaFinanceira } from "@/components/admin/financeiro/FolhaFinanceira";
import {
  CategoriaFolha,
  ContaFolha,
} from "@/components/admin/financeiro/FolhasDeCadastro";
import {
  BaixarLancamentoFolha,
  CancelarLancamentoDialogo,
  DetalheDoLancamentoFolha,
} from "@/components/admin/financeiro/FolhasDeLancamento";
import {
  AbrirCaixaFolha,
  FecharCaixaFolha,
  MovimentarCaixaFolha,
} from "@/components/admin/financeiro/FolhasDoCaixa";
import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import {
  OpcoesDePeriodo,
  PeriodoPersonalizadoFolha,
  SeletorDePeriodo,
} from "@/components/admin/financeiro/SeletorDePeriodo";
import { ContextoDoDescarte } from "@/components/admin/financeiro/descarte";
import type {
  AbaDoFinanceiro,
  FolhaDoFinanceiro,
  LadoDosPrevistos,
} from "@/components/admin/financeiro/navegacao";
import {
  CLASSE_ABA_DO_FINANCEIRO,
  CLASSE_BOTAO_REDONDO_DO_FINANCEIRO,
  CLASSE_CHIP_COMUM,
  CLASSE_CHIP_SELECIONADO,
  type ConfirmacaoFinanceira,
  ContextoConfirmacaoFinanceira,
  ContextoValoresOcultos,
  ReciboFinanceiro,
} from "@/components/admin/financeiro/partes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useAuth } from "@/hooks/useAuth";
import { useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";
import {
  ContextoDoCacheFinanceiro,
  conferirCaixaParaReconciliar,
  useCaixaAtual,
  useCategoriasFinanceiras,
  useContasFinanceiras,
  useValoresOcultos,
} from "@/hooks/useFinanceiro";
import { intervaloDoPeriodo, rotuloDoPeriodo } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { PeriodoEscolhido } from "@/types/financeiro";

interface AdminFinanceiroViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
  onSetBackOverride?: (fn: (() => void) | null) => void;
  /**
   * Aba com que a tela abre (o `id` de `onNavigate("admin-financeiro", id)`):
   * só vale se for uma das abas da fila; qualquer outro valor é ignorado e a
   * tela abre na Visão, como sempre.
   */
  abaInicial?: string | null;
}

// O `valor` é a chave da aba (o "dre" busca `fin_dre`); o `rotulo` é o que a
// lojista lê. Abas só com texto (desenho aprovado de 22/10/2026). A visão
// `contas` (Contas e categorias, configuração) saiu da fila: abre pelo chip
// "Contas" do cabeçalho e, enquanto está aberta, nenhuma aba fica ativa.
const ABAS: readonly {
  valor: AbaDoFinanceiro;
  rotulo: string;
}[] = [
  { valor: "visao", rotulo: "Visão" },
  { valor: "caixa", rotulo: "Caixa" },
  { valor: "extrato", rotulo: "Extrato" },
  { valor: "previstos", rotulo: "Pagar e receber" },
  { valor: "dre", rotulo: "Resultado" },
];

// Contas e Ocultar do cabeçalho: chip de 36px (desenho de 24/10/2026) com
// toque de 44px — a área extra de 4px em cima e embaixo é um pseudo-elemento do
// próprio botão, então o chip não engorda. `border-solid`: o index.css zera a
// borda de todo `<button>`. Cantos de 12px por valor: o `rounded-xl` deste
// projeto vale 28px (`--radius` de 1.5rem), quase uma pílula.
// Ponto "caixa aberto" da aba: verde claro nos temas escuros e verde escuro no
// Claro, onde o claro some sobre o fundo (1,7:1 medido); o texto fica no
// `aria-label` da aba.
const CLASSE_PONTO_DA_ABA =
  "size-2 shrink-0 rounded-full bg-emerald-400 [html[data-admin-tema=claro]_&]:bg-emerald-700";
const CLASSE_CHIP_DO_TOPO =
  "relative inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] border border-solid px-2.5 text-[13px] font-semibold transition-colors before:absolute before:inset-x-0 before:-inset-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:scale-[0.98]";

// "A receber" do Início: abre em Pagar e receber já no lado de receber.
const ALVO_A_RECEBER = "previstos-entrada";

function ehAba(valor: string): valor is AbaDoFinanceiro {
  return ABAS.some((aba) => aba.valor === valor);
}

function abaDeAbertura(valor: string | null | undefined): AbaDoFinanceiro {
  if (valor === ALVO_A_RECEBER) return "previstos";
  return valor && ehAba(valor) ? valor : "visao";
}

// Marca da entrada de histórico que a folha aberta empurra: é ela que o Voltar do
// aparelho consome, em vez de tirar o lojista da tela com o rascunho dentro.
const MARCA_DA_FOLHA = "fin-folha";
// Intervalo mínimo entre duas releituras automáticas ao voltar ao app.
const TRAVA_DA_RELEITURA_MS = 15_000;

export function AdminFinanceiroView({
  onNavigate,
  active = true,
  onSetDirty,
  onSetBackOverride,
  abaInicial,
}: AdminFinanceiroViewProps) {
  const ativo = active;
  const { user } = useAuth();
  const sessaoAtual = useRef<string | null | undefined>(undefined);
  const [cache] = useState(() => new Map<string, unknown>());
  const hoje = useDiaDeSaoPaulo(ativo);

  const [aba, setAba] = useState<AbaDoFinanceiro>(() =>
    abaDeAbertura(abaInicial),
  );
  const listaDeAbas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ativo) return;
    listaDeAbas.current
      ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [aba, ativo]);
  const [ladoDosPrevistos, setLadoDosPrevistos] = useState<LadoDosPrevistos>(
    abaInicial === ALVO_A_RECEBER ? "entrada" : "saida",
  );
  const [periodo, setPeriodo] = useState<PeriodoEscolhido>({
    preset: "mes_atual",
  });
  const intervalo = useMemo(
    () => intervaloDoPeriodo(periodo, hoje),
    [periodo, hoje],
  );
  const rotulo = rotuloDoPeriodo(periodo, intervalo);

  const [versao, setVersao] = useState(0);
  const [folha, setFolha] = useState<FolhaDoFinanceiro | null>(null);
  const [numeroDaFolha, setNumeroDaFolha] = useState(0);
  const geracaoDaFolha = useRef(0);
  const folhaEmEnvio = useRef(false);
  // Houve gravação sem a tela saber o desfecho (prazo estourado, rede): ao
  // fechar a folha a lista é relida, para a conferência não olhar dado velho.
  const gravouSemConfirmar = useRef(false);
  const [sujo, setSujo] = useState(false);
  const sujoRef = useRef(false);
  // Pergunta "Descartar o que você escreveu?" na tela. O ref espelha o estado
  // para o Esc e o Voltar, que chegam por callbacks estáveis.
  const [perguntando, setPerguntando] = useState(false);
  const perguntandoRef = useRef(false);
  // `abertaRef` espelha "há folha" de forma síncrona; `entradaDaFolha` diz que
  // temos uma entrada de histórico empurrada e ainda não devolvida;
  // `aoDevolver` é o que espera essa devolução (ir para o pedido).
  const abertaRef = useRef(false);
  const entradaDaFolha = useRef(false);
  const aoDevolver = useRef<(() => void) | null>(null);
  const relogioDaEntrada = useRef(0);
  const [ocultos, alternarOcultos] = useValoresOcultos();
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoFinanceira | null>(
    null,
  );

  const contas = useContasFinanceiras(ativo, versao);
  const categorias = useCategoriasFinanceiras(ativo, versao);
  // UMA leitura do caixa para a tela toda: o cartão da Visão, o ponto da aba e
  // a aba Caixa mostram o mesmo estado e nunca discordam.
  const caixa = useCaixaAtual(ativo, versao);
  const caixaAberto = caixa.dados?.sessao != null;

  const mostrarPergunta = useCallback((mostrar: boolean) => {
    perguntandoRef.current = mostrar;
    setPerguntando(mostrar);
  }, []);
  // Fecha de verdade (depois de salvar, de escolher um período, de descartar).
  const fecharFolha = useCallback(() => {
    if (folhaEmEnvio.current) return;
    if (gravouSemConfirmar.current) {
      gravouSemConfirmar.current = false;
      setVersao((v) => v + 1);
    }
    abertaRef.current = false;
    mostrarPergunta(false);
    setFolha(null);
    setSujo(false);
  }, [mostrarPergunta]);
  // Pedido de fechar de quem está olhando para a folha: X, toque no véu, arrasto
  // para baixo, Esc e Voltar. Com algo escrito ele pergunta antes; um segundo
  // Esc ou Voltar com a pergunta aberta vale "continuar escrevendo".
  const pedirParaFechar = useCallback(() => {
    if (folhaEmEnvio.current) return;
    if (perguntandoRef.current) {
      mostrarPergunta(false);
      return;
    }
    if (sujoRef.current) {
      mostrarPergunta(true);
      return;
    }
    fecharFolha();
  }, [fecharFolha, mostrarPergunta]);
  const descarteDaFolha = useMemo(
    () => ({
      sujo,
      perguntando,
      aoContinuar: () => mostrarPergunta(false),
      aoDescartar: fecharFolha,
    }),
    [sujo, perguntando, mostrarPergunta, fecharFolha],
  );
  const abrirFolha = useCallback(
    (nova: FolhaDoFinanceiro) => {
      if (folhaEmEnvio.current) return;
      abertaRef.current = true;
      mostrarPergunta(false);
      setSujo(false);
      geracaoDaFolha.current += 1;
      setNumeroDaFolha(geracaoDaFolha.current);
      setFolha(nova);
    },
    [mostrarPergunta],
  );
  const aoMudarEnviando = useCallback(
    (enviando: boolean) => {
      if (geracaoDaFolha.current === numeroDaFolha) {
        folhaEmEnvio.current = enviando;
        if (enviando) gravouSemConfirmar.current = true;
        if (
          !enviando &&
          folha?.tipo === "caixa-movimentar" &&
          sessaoAtual.current !== undefined &&
          sessaoAtual.current !== folha.sessaoId
        )
          fecharFolha();
      }
    },
    [numeroDaFolha, folha, fecharFolha],
  );
  const invalidar = useCallback(() => {
    gravouSemConfirmar.current = false;
    setVersao((v) => v + 1);
  }, []);
  // Tela aberta há tempo (tablet no balcão): ao voltar a ver o app, relê tudo
  // (o esperado na gaveta, o saldo e o extrato ficam velhos). Nunca por cima de
  // uma folha aberta (formulário com digitação), e com trava contra rajada
  // (voltar à aba dispara `visibilitychange` e `focus` quase juntos).
  useEffect(() => {
    if (!ativo) return;
    let ultima = Date.now();
    const aoVoltar = () => {
      if (document.visibilityState === "hidden" || abertaRef.current) return;
      const agora = Date.now();
      if (agora - ultima < TRAVA_DA_RELEITURA_MS) return;
      ultima = agora;
      invalidar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [ativo, invalidar]);
  const aoSalvar = useCallback(
    (mensagem: string, tom: "sucesso" | "informacao" = "sucesso") => {
      invalidar();
      if (tom === "informacao") toast.info(mensagem);
      else toast.success(mensagem);
      // A resposta pertence à folha que iniciou a escrita, mesmo que outra
      // já tenha aberto. Atualizar os dados não deve apagar o formulário novo.
      if (geracaoDaFolha.current !== numeroDaFolha) return;
      folhaEmEnvio.current = false;
      fecharFolha();
    },
    [invalidar, fecharFolha, numeroDaFolha],
  );
  const aoReconciliarCaixa = useCallback(
    async (mensagem: string) => {
      await conferirCaixaParaReconciliar();
      aoSalvar(mensagem, "informacao");
    },
    [aoSalvar],
  );
  const aoSessaoAtual = useCallback(
    (id: string | null) => {
      sessaoAtual.current = id;
      if (folha?.tipo === "caixa-movimentar" && folha.sessaoId !== id) {
        fecharFolha();
      }
    },
    [folha, fecharFolha],
  );
  const abrirPedido = useCallback(
    (pedidoId: string) => {
      const ir = () => onNavigate("admin-orders", pedidoId);
      // Com a entrada da folha ainda no histórico, devolve ela ANTES de ir para
      // o pedido; senão ela ficaria embaixo e o Voltar do pedido pararia nela.
      if (entradaDaFolha.current && !folhaEmEnvio.current) {
        aoDevolver.current = ir;
        fecharFolha();
      } else {
        fecharFolha();
        ir();
      }
    },
    [fecharFolha, onNavigate],
  );
  const novoLancamento = useCallback(
    (lado?: LadoDosPrevistos) =>
      abrirFolha({
        tipo: "novo-lancamento",
        inicial: lado
          ? {
              tipo: lado === "entrada" ? "entrada" : "saida",
              situacao: "previsto",
            }
          : undefined,
      }),
    [abrirFolha],
  );

  // Formulário com digitação pendente → o roteador pergunta antes de sair.
  useEffect(() => {
    sujoRef.current = sujo;
    onSetDirty?.(sujo);
  }, [sujo, onSetDirty]);
  useEffect(() => () => onSetDirty?.(false), [onSetDirty]);

  // A folha aberta tem uma entrada PRÓPRIA no histórico (mesmo padrão dos
  // Banners e do PDV). Sem ela, o Voltar do aparelho fechava/perguntava pela
  // folha e, logo em seguida, o App trocava de tela e o rascunho ia embora.
  // Só existe com quem consome o Voltar (o App passa `onSetBackOverride`): sem
  // ele a entrada ficaria no histórico sem ninguém para devolvê-la.
  const temDesvio = onSetBackOverride !== undefined;
  const empurrarEntrada = useCallback(() => {
    if (
      temDesvio &&
      abertaRef.current &&
      globalThis.history.state?.modal !== MARCA_DA_FOLHA
    )
      globalThis.history.pushState(
        { ...globalThis.history.state, modal: MARCA_DA_FOLHA },
        "",
        globalThis.location.pathname + globalThis.location.search,
      );
  }, [temDesvio]);

  // Folha aberta → o Voltar do celular fecha a folha, não a tela (e, com algo
  // escrito, pergunta antes). Cancelar lançamento é só um motivo de uma linha,
  // numa janela que não é folha: fecha direto como sempre. Se o Voltar do
  // aparelho já consumiu a entrada e a folha continua aberta (pergunta, ou envio
  // em andamento), empurra outra para o próximo Voltar valer de novo.
  useEffect(() => {
    if (!onSetBackOverride) return;
    onSetBackOverride(
      folha
        ? () => () => {
            (folha.tipo === "cancelar" ? fecharFolha : pedirParaFechar)();
            empurrarEntrada();
          }
        : null,
    );
  }, [folha, fecharFolha, pedirParaFechar, empurrarEntrada, onSetBackOverride]);
  useEffect(() => () => onSetBackOverride?.(null), [onSetBackOverride]);
  useEffect(() => () => clearTimeout(relogioDaEntrada.current), []);

  // Abre → empurra a entrada; fecha por QUALQUER caminho (X, véu, Esc, Descartar,
  // salvar) → devolve ela com `history.back()`, só se ainda for a nossa (no Voltar
  // do aparelho o navegador já a consumiu). Fica DEPOIS do efeito do Voltar: o
  // `back()` entrega o popstate depois do commit, e o desvio de uso único abaixo
  // (que só engole esse popstate) tem de vencer o `null` que aquele efeito
  // registra ao fechar — sem ele o App leria "sem desvio" e, com o formulário
  // ainda marcado como sujo, abriria o aviso de alterações não salvas.
  const folhaAberta = folha !== null;
  useEffect(() => {
    if (folhaAberta) {
      empurrarEntrada();
      entradaDaFolha.current = temDesvio;
      return;
    }
    if (!entradaDaFolha.current) return;
    entradaDaFolha.current = false;
    const depois = () => {
      const seguir = aoDevolver.current;
      aoDevolver.current = null;
      seguir?.();
    };
    if (globalThis.history.state?.modal !== MARCA_DA_FOLHA) {
      depois();
      return;
    }
    const concluir = () => {
      clearTimeout(relogioDaEntrada.current);
      if (!abertaRef.current) onSetBackOverride?.(null);
      // Fora do tratamento do popstate: o App ainda vai conferir a rota.
      window.setTimeout(depois, 0);
    };
    onSetBackOverride?.(() => concluir);
    // Rede de segurança: se o popstate nunca chegar, não deixa o desvio preso.
    relogioDaEntrada.current = window.setTimeout(concluir, 1500);
    globalThis.history.back();
  }, [folhaAberta, empurrarEntrada, temDesvio, onSetBackOverride]);

  const listaDeContas = contas.dados ?? [];
  const listaDeCategorias = categorias.dados ?? [];

  function renderizarFolha() {
    if (!folha) return null;
    switch (folha.tipo) {
      case "periodos":
        return (
          <FolhaFinanceira
            titulo="Período"
            descricao="Usado em Visão, Extrato e Resultado."
            icone={CalendarClock}
            aoFechar={fecharFolha}
          >
            <OpcoesDePeriodo
              periodo={periodo}
              hoje={hoje}
              aoEscolher={(escolhido) => {
                setPeriodo(escolhido);
                fecharFolha();
              }}
              aoPedirPersonalizado={() => abrirFolha({ tipo: "periodo" })}
            />
            <p className="mt-4 rounded-2xl bg-sky-400/5 p-3 text-xs leading-relaxed text-zinc-400">
              Pagar e receber, Caixa e Contas e categorias não usam este
              período. O fluxo usa sempre seus últimos 30 dias.
            </p>
          </FolhaFinanceira>
        );
      case "periodo":
        return (
          <PeriodoPersonalizadoFolha
            inicial={intervalo}
            hoje={hoje}
            aoFechar={fecharFolha}
            aoAplicar={(personalizado) => {
              setPeriodo({ preset: "personalizado", personalizado });
              fecharFolha();
            }}
          />
        );
      case "novo-lancamento":
        return (
          <NovoLancamentoFolha
            hoje={hoje}
            contas={listaDeContas}
            categorias={listaDeCategorias}
            inicial={folha.inicial}
            aviso={contas.erro ?? categorias.erro}
            aoMudarEnviando={aoMudarEnviando}
            aoFechar={pedirParaFechar}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      case "detalhe":
        return (
          <DetalheDoLancamentoFolha
            linha={folha.linha}
            aoFechar={fecharFolha}
            aoCancelar={(alvo) => abrirFolha({ tipo: "cancelar", alvo })}
            aoBaixar={(alvo) => abrirFolha({ tipo: "baixar", alvo })}
            aoAbrirPedido={abrirPedido}
          />
        );
      case "baixar":
        return (
          <BaixarLancamentoFolha
            alvo={folha.alvo}
            hoje={hoje}
            contas={listaDeContas}
            aoMudarEnviando={aoMudarEnviando}
            aoFechar={pedirParaFechar}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      case "cancelar":
        return (
          <CancelarLancamentoDialogo
            alvo={folha.alvo}
            aoMudarEnviando={aoMudarEnviando}
            aoFechar={fecharFolha}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      case "caixa-abrir":
        return (
          <AbrirCaixaFolha
            contas={listaDeContas}
            aoReconciliar={aoReconciliarCaixa}
            aoMudarEnviando={aoMudarEnviando}
            aoFechar={pedirParaFechar}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      case "caixa-movimentar":
        return (
          <MovimentarCaixaFolha
            key={user?.id ?? "sem-autor"}
            autorId={user?.id ?? null}
            aoMudarEnviando={aoMudarEnviando}
            aoReconciliar={aoReconciliarCaixa}
            sessaoId={folha.sessaoId}
            movimento={folha.movimento}
            esperado={folha.esperado}
            contaDoCaixa={folha.contaDoCaixa}
            contas={listaDeContas}
            aoFechar={pedirParaFechar}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      case "caixa-fechar":
        return (
          <FecharCaixaFolha
            aoMudarEnviando={aoMudarEnviando}
            aoReconciliar={aoReconciliarCaixa}
            caixa={folha.caixa}
            aoFechar={pedirParaFechar}
            aoFechado={() => {
              invalidar();
              toast.success("Caixa fechado.");
            }}
            aoMudarSujo={setSujo}
          />
        );
      case "conta":
        return (
          <ContaFolha
            conta={folha.conta}
            hoje={hoje}
            aoFechar={pedirParaFechar}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      case "categoria":
        return (
          <CategoriaFolha
            categoria={folha.categoria}
            aoFechar={pedirParaFechar}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      default:
        return null;
    }
  }

  return (
    <ContextoDoCacheFinanceiro.Provider value={cache}>
      <ContextoValoresOcultos.Provider value={ocultos}>
        <ContextoConfirmacaoFinanceira.Provider value={setConfirmacao}>
          <div
            className={cn(
              "h-auto bg-admin-bg text-white",
              // O botão redondo flutua 56px acima da pílula: o conteúdo ganha
              // folga para o último item nunca ficar por baixo dele. Na aba
              // Caixa (ação na pílula) vale a folga de sempre.
              aba === "caixa"
                ? "pb-admin lg:pb-12"
                : "pb-[calc(var(--admin-tab-pb,6.25rem)_+_4rem)] lg:pb-28",
            )}
          >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4 [&_h1]:text-[28px] [&_h1]:font-bold [&_h1]:normal-case [&_h1]:leading-8 [&_h1]:tracking-tight [&_h1_span]:not-italic">
              <AdminPageHeader
                titulo={NOMES_DO_PAINEL["admin-financeiro"]}
                acoes={
                  // Chips compactos (px-2.5, 6px entre eles): título e chips ficam
                  // na mesma linha quando cabem e quebram para a de baixo quando não.
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setAba(aba === "contas" ? "visao" : "contas")
                      }
                      aria-pressed={aba === "contas"}
                      className={cn(
                        CLASSE_CHIP_DO_TOPO,
                        aba === "contas"
                          ? CLASSE_CHIP_SELECIONADO
                          : CLASSE_CHIP_COMUM,
                      )}
                    >
                      Contas
                    </button>
                    <button
                      type="button"
                      onClick={alternarOcultos}
                      aria-pressed={ocultos}
                      aria-label={
                        ocultos ? "Mostrar valores" : "Ocultar valores"
                      }
                      title={ocultos ? "Mostrar valores" : "Ocultar valores"}
                      className={cn(CLASSE_CHIP_DO_TOPO, CLASSE_CHIP_COMUM)}
                    >
                      {ocultos ? (
                        <EyeOff aria-hidden="true" className="size-4" />
                      ) : (
                        <Eye aria-hidden="true" className="size-4" />
                      )}
                      <span>{ocultos ? "Mostrar" : "Ocultar"}</span>
                    </button>
                  </div>
                }
              />
            </div>

            <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5">
              {confirmacao ? (
                <ReciboFinanceiro
                  confirmacao={confirmacao}
                  aoFechar={() => setConfirmacao(null)}
                />
              ) : null}
              <div>
                {aba === "visao" || aba === "extrato" || aba === "dre" ? (
                  <SeletorDePeriodo
                    periodo={periodo}
                    rotulo={rotulo}
                    aoEscolher={setPeriodo}
                    aoPedirPersonalizado={() => abrirFolha({ tipo: "periodo" })}
                    aoPedirOpcoes={() => abrirFolha({ tipo: "periodos" })}
                  />
                ) : (
                  <p className="text-xs text-zinc-400">
                    {aba === "caixa"
                      ? "Sessão atual"
                      : aba === "previstos"
                        ? "Todos os vencimentos"
                        : "Cadastros da loja"}
                  </p>
                )}
              </div>

              <Tabs
                value={aba}
                onValueChange={(valor) =>
                  setAba(ehAba(valor) ? valor : "visao")
                }
                className="min-w-0 gap-4"
              >
                <div className="sticky top-0 z-20 -mx-5 border-b border-admin-border bg-admin-bg/95 px-5 backdrop-blur-sm before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-5 before:bg-gradient-to-r before:from-admin-bg before:to-transparent after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-5 after:bg-gradient-to-l after:from-admin-bg after:to-transparent">
                  <TabsList
                    ref={listaDeAbas}
                    aria-label="Abas do Financeiro"
                    className="no-scrollbar -mx-5 flex h-auto w-[calc(100%+2.5rem)] scroll-px-5 justify-start gap-1 overflow-x-auto rounded-none bg-transparent px-5 py-0"
                  >
                    {ABAS.map((item) => (
                      <TabsTrigger
                        key={item.valor}
                        value={item.valor}
                        className={CLASSE_ABA_DO_FINANCEIRO}
                        aria-label={
                          item.valor === "caixa" && caixaAberto
                            ? "Caixa, aberto"
                            : undefined
                        }
                      >
                        {item.rotulo}
                        {item.valor === "caixa" && caixaAberto ? (
                          <span
                            data-ponto-do-caixa=""
                            aria-hidden="true"
                            className={CLASSE_PONTO_DA_ABA}
                          />
                        ) : null}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                <TabsContent value="visao">
                  <AbaVisao
                    ativo={ativo}
                    intervalo={intervalo}
                    hoje={hoje}
                    versao={versao}
                    contas={listaDeContas}
                    caixa={caixa}
                    abrirFolha={abrirFolha}
                    irParaAba={setAba}
                    verPrevistos={(lado) => {
                      setLadoDosPrevistos(lado);
                      setAba("previstos");
                    }}
                  />
                </TabsContent>
                <TabsContent value="extrato">
                  <AbaExtrato
                    ativo={ativo}
                    intervalo={intervalo}
                    hoje={hoje}
                    versao={versao}
                    contas={listaDeContas}
                    rotuloDoPeriodo={rotulo}
                    abrirFolha={abrirFolha}
                    aoNovoLancamento={() => novoLancamento()}
                  />
                </TabsContent>
                <TabsContent value="previstos">
                  <AbaPrevistos
                    ativo={ativo}
                    hoje={hoje}
                    versao={versao}
                    lado={ladoDosPrevistos}
                    aoMudarLado={setLadoDosPrevistos}
                    abrirFolha={abrirFolha}
                    aoNovoLancamento={novoLancamento}
                    aoAbrirPedido={abrirPedido}
                  />
                </TabsContent>
                <TabsContent value="caixa">
                  <AbaCaixa
                    aoSessaoAtual={aoSessaoAtual}
                    ativo={ativo}
                    versao={versao}
                    abrirFolha={abrirFolha}
                    aoNovoLancamento={() => novoLancamento()}
                    mostrarAcaoFixa={ativo && !folha}
                    caixaDaTela={caixa}
                  />
                </TabsContent>
                <TabsContent value="dre">
                  <AbaDre
                    ativo={ativo}
                    intervalo={intervalo}
                    versao={versao}
                    rotuloDoPeriodo={rotulo}
                  />
                </TabsContent>
                <TabsContent value="contas" className="flex flex-col gap-4">
                  {/* A visão não tem mais aba: o chip "Contas" a abre, então
                      ela se apresenta pelo nome de sempre. */}
                  <h2 className="text-xl font-bold text-white">
                    Contas e categorias
                  </h2>
                  <AbaContasECategorias
                    contas={contas}
                    categorias={categorias}
                    abrirFolha={abrirFolha}
                  />
                </TabsContent>
              </Tabs>
              {ativo && !folha && aba !== "caixa" ? (
                <button
                  type="button"
                  onClick={() => novoLancamento()}
                  aria-label="Novo lançamento"
                  className={CLASSE_BOTAO_REDONDO_DO_FINANCEIRO}
                >
                  <Plus aria-hidden="true" className="size-7" />
                  <span className="sr-only">Novo lançamento</span>
                </button>
              ) : null}
            </div>

            <ContextoDoDescarte.Provider value={descarteDaFolha}>
              <div key={numeroDaFolha}>{renderizarFolha()}</div>
            </ContextoDoDescarte.Provider>
          </div>
        </ContextoConfirmacaoFinanceira.Provider>
      </ContextoValoresOcultos.Provider>
    </ContextoDoCacheFinanceiro.Provider>
  );
}
