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
import type {
  AbaDoFinanceiro,
  FolhaDoFinanceiro,
  LadoDosPrevistos,
} from "@/components/admin/financeiro/navegacao";
import {
  CLASSE_ABA_DO_FINANCEIRO,
  CLASSE_BOTAO_REDONDO_DO_FINANCEIRO,
  CLASSE_CHIP,
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
  { valor: "extrato", rotulo: "Extrato" },
  { valor: "previstos", rotulo: "Pagar e receber" },
  { valor: "caixa", rotulo: "Caixa" },
  { valor: "dre", rotulo: "Resultado" },
];

function ehAba(valor: string): valor is AbaDoFinanceiro {
  return ABAS.some((aba) => aba.valor === valor);
}

export function AdminFinanceiroView({
  onNavigate,
  active = true,
  onSetDirty,
  onSetBackOverride,
}: AdminFinanceiroViewProps) {
  const ativo = active;
  const { user } = useAuth();
  const sessaoAtual = useRef<string | null | undefined>(undefined);
  const [cache] = useState(() => new Map<string, unknown>());
  const hoje = useDiaDeSaoPaulo(ativo);

  const [aba, setAba] = useState<AbaDoFinanceiro>("visao");
  const listaDeAbas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ativo) return;
    listaDeAbas.current
      ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [aba, ativo]);
  const [ladoDosPrevistos, setLadoDosPrevistos] =
    useState<LadoDosPrevistos>("saida");
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
  const [sujo, setSujo] = useState(false);
  const [ocultos, alternarOcultos] = useValoresOcultos();
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoFinanceira | null>(
    null,
  );

  const contas = useContasFinanceiras(ativo, versao);
  const categorias = useCategoriasFinanceiras(ativo, versao);

  const fecharFolha = useCallback(() => {
    if (folhaEmEnvio.current) return;
    setFolha(null);
    setSujo(false);
  }, []);
  const abrirFolha = useCallback((nova: FolhaDoFinanceiro) => {
    if (folhaEmEnvio.current) return;
    setSujo(false);
    geracaoDaFolha.current += 1;
    setNumeroDaFolha(geracaoDaFolha.current);
    setFolha(nova);
  }, []);
  const aoMudarEnviando = useCallback(
    (enviando: boolean) => {
      if (geracaoDaFolha.current === numeroDaFolha) {
        folhaEmEnvio.current = enviando;
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
  const invalidar = useCallback(() => setVersao((v) => v + 1), []);
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
      fecharFolha();
      onNavigate("admin-orders", pedidoId);
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
    onSetDirty?.(sujo);
  }, [sujo, onSetDirty]);
  useEffect(() => () => onSetDirty?.(false), [onSetDirty]);

  // Folha aberta → o Voltar do celular fecha a folha, não a tela.
  useEffect(() => {
    if (!onSetBackOverride) return;
    onSetBackOverride(folha ? () => fecharFolha : null);
  }, [folha, fecharFolha, onSetBackOverride]);
  useEffect(() => () => onSetBackOverride?.(null), [onSetBackOverride]);

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
            aoFechar={fecharFolha}
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
            aoFechar={fecharFolha}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      case "cancelar":
        return (
          <CancelarLancamentoDialogo
            alvo={folha.alvo}
            aoFechar={fecharFolha}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      case "caixa-abrir":
        return (
          <AbrirCaixaFolha
            contas={listaDeContas}
            aoFechar={fecharFolha}
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
            aoFechar={fecharFolha}
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
            aoFechar={fecharFolha}
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
            aoFechar={fecharFolha}
            aoSalvar={aoSalvar}
            aoMudarSujo={setSujo}
          />
        );
      case "categoria":
        return (
          <CategoriaFolha
            categoria={folha.categoria}
            aoFechar={fecharFolha}
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
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pb-3 pt-6 [&_h1]:text-[32px] [&_h1]:font-bold [&_h1]:normal-case [&_h1]:tracking-tight [&_h1_span]:not-italic">
              <AdminPageHeader
                titulo={NOMES_DO_PAINEL["admin-financeiro"]}
                acoes={
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setAba(aba === "contas" ? "visao" : "contas")
                      }
                      aria-pressed={aba === "contas"}
                      className={cn(
                        CLASSE_CHIP,
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
                      className={cn(CLASSE_CHIP, CLASSE_CHIP_COMUM)}
                    >
                      {ocultos ? (
                        <EyeOff aria-hidden="true" className="size-4" />
                      ) : (
                        <Eye aria-hidden="true" className="size-4" />
                      )}
                      <span>{ocultos ? "Mostrar" : "Ocultar"}</span>
                    </button>
                  </>
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
                      >
                        {item.rotulo}
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

            <div key={numeroDaFolha}>{renderizarFolha()}</div>
          </div>
        </ContextoConfirmacaoFinanceira.Provider>
      </ContextoValoresOcultos.Provider>
    </ContextoDoCacheFinanceiro.Provider>
  );
}
