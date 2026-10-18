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

import {
  BarChart3,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Plus,
  ReceiptText,
  SlidersHorizontal,
  Store,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  CLASSE_BOTAO_PRIMARIO,
  type ConfirmacaoFinanceira,
  ContextoConfirmacaoFinanceira,
  ContextoValoresOcultos,
  ReciboFinanceiro,
  SeloFinanceiro,
} from "@/components/admin/financeiro/partes";
import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";
import {
  ContextoDoCacheFinanceiro,
  useCategoriasFinanceiras,
  useContasFinanceiras,
  useValoresOcultos,
} from "@/hooks/useFinanceiro";
import { intervaloDoPeriodo, rotuloDoPeriodo } from "@/lib/financeiro";
import type { View } from "@/types";
import type { PeriodoEscolhido } from "@/types/financeiro";

interface AdminFinanceiroViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

// O `valor` é a chave da aba (o "dre" busca `fin_dre`); o `rotulo` é o que a
// lojista lê. "Contas e categorias" é configuração: fica no fim, com o selo
// "Avançado" (spec "Painel simples", §10).
const ABAS: readonly {
  valor: AbaDoFinanceiro;
  rotulo: string;
  icone: LucideIcon;
  matiz: string;
  avancado?: boolean;
}[] = [
  { valor: "visao", rotulo: "Visão", icone: Wallet, matiz: "#69C8FF" },
  { valor: "extrato", rotulo: "Extrato", icone: ReceiptText, matiz: "#7AA2FF" },
  {
    valor: "previstos",
    rotulo: "A pagar e receber",
    icone: CalendarClock,
    matiz: "#FF8BB2",
  },
  { valor: "caixa", rotulo: "Caixa", icone: Store, matiz: "#2DD4BF" },
  { valor: "dre", rotulo: "Resultado", icone: BarChart3, matiz: "#BA9AFF" },
  {
    valor: "contas",
    rotulo: "Contas e categorias",
    icone: SlidersHorizontal,
    matiz: "#FF9F5A",
    avancado: true,
  },
];

function ehAba(valor: string): valor is AbaDoFinanceiro {
  return ABAS.some((aba) => aba.valor === valor);
}

const CLASSE_ABA =
  "min-h-11 flex-none rounded-xl border border-transparent px-3 text-xs font-bold text-zinc-400 hover:text-white data-[state=active]:border-admin-gold/50 data-[state=active]:bg-admin-gold/10 data-[state=active]:text-admin-gold data-[state=active]:shadow-none dark:data-[state=active]:bg-admin-gold/10 dark:data-[state=active]:text-admin-gold";

export function AdminFinanceiroView({
  onNavigate,
  active = true,
  onSetDirty,
  onSetBackOverride,
}: AdminFinanceiroViewProps) {
  const ativo = active;
  const [cache] = useState(() => new Map<string, unknown>());
  const hoje = useDiaDeSaoPaulo(ativo);

  const [aba, setAba] = useState<AbaDoFinanceiro>("visao");
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
      }
    },
    [numeroDaFolha],
  );
  const invalidar = useCallback(() => setVersao((v) => v + 1), []);
  const aoSalvar = useCallback(
    (mensagem: string) => {
      invalidar();
      toast.success(mensagem);
      // A resposta pertence à folha que iniciou a escrita, mesmo que outra
      // já tenha aberto. Atualizar os dados não deve apagar o formulário novo.
      if (geracaoDaFolha.current !== numeroDaFolha) return;
      folhaEmEnvio.current = false;
      fecharFolha();
    },
    [invalidar, fecharFolha, numeroDaFolha],
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
      case "secoes":
        return (
          <FolhaFinanceira
            titulo="Seções do Financeiro"
            descricao="Escolha o que precisa conferir."
            icone={SlidersHorizontal}
            aoFechar={fecharFolha}
          >
            <div
              aria-label="Escolha a seção"
              className="flex flex-col gap-2 rounded-3xl border border-white/10 bg-[#101013] p-3"
            >
              {ABAS.map((item) => (
                <button
                  key={item.valor}
                  type="button"
                  data-secao={item.valor}
                  aria-pressed={item.valor === aba}
                  onClick={() => {
                    setAba(item.valor);
                    fecharFolha();
                  }}
                  className={`flex min-h-16 items-center gap-3 rounded-2xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${item.valor === aba ? "bg-admin-gold/10 text-admin-gold" : "text-white hover:bg-white/5"}`}
                >
                  <SeloFinanceiro icone={item.icone} matiz={item.matiz} />
                  <span className="min-w-0 flex-1 break-words text-sm font-bold">
                    {item.rotulo}
                    {item.avancado ? (
                      <span className="block text-xs font-normal text-zinc-400">
                        Avançado
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0"
                  />
                </button>
              ))}
            </div>
          </FolhaFinanceira>
        );
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
              A pagar e receber, Caixa e Contas e categorias não usam este
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
          <div className="pb-admin h-auto bg-[#08080A] text-white lg:pb-12">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 pb-7 pt-6 [&_h1]:text-[32px] [&_h1]:font-bold [&_h1]:normal-case [&_h1]:tracking-tight [&_h1_span]:not-italic">
              <AdminPageHeader
                titulo={NOMES_DO_PAINEL["admin-financeiro"]}
                acoes=<button
                  type="button"
                  onClick={alternarOcultos}
                  aria-pressed={ocultos}
                  aria-label={ocultos ? "Mostrar valores" : "Ocultar valores"}
                  title={ocultos ? "Mostrar valores" : "Ocultar valores"}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#17171C] px-4 text-xs text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  {ocultos ? (
                    <EyeOff aria-hidden="true" className="size-4" />
                  ) : (
                    <Eye aria-hidden="true" className="size-4" />
                  )}
                  <span>{ocultos ? "Mostrar" : "Ocultar"}</span>
                </button>
              />
            </div>

            <div className="mx-auto flex max-w-7xl flex-col gap-7 px-5">
              {confirmacao ? (
                <ReciboFinanceiro
                  confirmacao={confirmacao}
                  aoFechar={() => setConfirmacao(null)}
                />
              ) : null}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 lg:block">
                {aba === "visao" || aba === "extrato" || aba === "dre" ? (
                  <SeletorDePeriodo
                    periodo={periodo}
                    rotulo={rotulo}
                    aoEscolher={setPeriodo}
                    aoPedirPersonalizado={() => abrirFolha({ tipo: "periodo" })}
                    aoPedirOpcoes={() => abrirFolha({ tipo: "periodos" })}
                  />
                ) : (
                  <p className="flex min-h-12 items-center gap-2 rounded-2xl bg-[#17171C] px-3 text-xs text-zinc-300">
                    <Clock
                      aria-hidden="true"
                      className="size-5 shrink-0 text-teal-300"
                    />
                    {aba === "caixa"
                      ? "Sessão atual"
                      : aba === "previstos"
                        ? "Todos os vencimentos"
                        : "Cadastros da loja"}
                  </p>
                )}
                <button
                  type="button"
                  aria-label="Seções do Financeiro"
                  aria-haspopup="dialog"
                  aria-expanded={folha?.tipo === "secoes"}
                  onClick={() => abrirFolha({ tipo: "secoes" })}
                  className="flex min-h-12 items-center gap-3 rounded-2xl bg-admin-gold/10 px-3 text-left text-xs text-admin-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:hidden"
                >
                  <span>
                    Seções
                    <strong className="block max-w-32 break-words text-sm">
                      {ABAS.find((item) => item.valor === aba)?.rotulo}
                    </strong>
                  </span>
                  <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
                </button>
              </div>

              <Tabs
                value={aba}
                onValueChange={(valor) =>
                  setAba(ehAba(valor) ? valor : "visao")
                }
                className="gap-7"
              >
                <TabsList className="no-scrollbar hidden size-auto justify-start gap-1 overflow-x-auto rounded-2xl bg-[#17171C] p-1 lg:flex">
                  {ABAS.map((item) => (
                    <TabsTrigger
                      key={item.valor}
                      value={item.valor}
                      className={CLASSE_ABA}
                    >
                      {item.rotulo}
                      {item.avancado ? (
                        <>
                          {" "}
                          <span
                            data-selo-avancado=""
                            className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal text-zinc-400"
                          >
                            Avançado
                          </span>
                        </>
                      ) : null}
                    </TabsTrigger>
                  ))}
                </TabsList>

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
                <TabsContent value="contas">
                  <AbaContasECategorias
                    contas={contas}
                    categorias={categorias}
                    abrirFolha={abrirFolha}
                  />
                </TabsContent>
              </Tabs>
              {ativo && !folha && aba !== "caixa" ? (
                <AcaoDaBarra>
                  <button
                    type="button"
                    onClick={() => novoLancamento()}
                    aria-label="Novo lançamento"
                    className={`${CLASSE_BOTAO_PRIMARIO} admin-barra-principal w-full`}
                  >
                    <Plus aria-hidden="true" className="size-6" />
                    Novo lançamento
                  </button>
                </AcaoDaBarra>
              ) : null}
            </div>

            <div key={numeroDaFolha}>{renderizarFolha()}</div>
          </div>
        </ContextoConfirmacaoFinanceira.Provider>
      </ContextoValoresOcultos.Provider>
    </ContextoDoCacheFinanceiro.Provider>
  );
}
