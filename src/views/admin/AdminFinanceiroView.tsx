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

import { Eye, EyeOff, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import { AbaContasECategorias } from "@/components/admin/financeiro/AbaContasECategorias";
import { AbaDre } from "@/components/admin/financeiro/AbaDre";
import { AbaExtrato } from "@/components/admin/financeiro/AbaExtrato";
import { AbaPrevistos } from "@/components/admin/financeiro/AbaPrevistos";
import { AbaVisao } from "@/components/admin/financeiro/AbaVisao";
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
  PeriodoPersonalizadoFolha,
  SeletorDePeriodo,
} from "@/components/admin/financeiro/SeletorDePeriodo";
import type {
  AbaDoFinanceiro,
  FolhaDoFinanceiro,
  LadoDosPrevistos,
} from "@/components/admin/financeiro/navegacao";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ContextoDoCacheFinanceiro,
  useCategoriasFinanceiras,
  useContasFinanceiras,
  useValoresOcultos,
} from "@/hooks/useFinanceiro";
import {
  hojeEmSaoPaulo,
  intervaloDoPeriodo,
  rotuloDoPeriodo,
} from "@/lib/financeiro";
import type { View } from "@/types";
import type { PeriodoEscolhido } from "@/types/financeiro";

interface AdminFinanceiroViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

const ABAS: readonly { valor: AbaDoFinanceiro; rotulo: string }[] = [
  { valor: "visao", rotulo: "Visão" },
  { valor: "extrato", rotulo: "Extrato" },
  { valor: "previstos", rotulo: "A pagar e receber" },
  { valor: "caixa", rotulo: "Caixa" },
  { valor: "dre", rotulo: "DRE" },
  { valor: "contas", rotulo: "Contas e categorias" },
];

function ehAba(valor: string): valor is AbaDoFinanceiro {
  return ABAS.some((aba) => aba.valor === valor);
}

const CLASSE_ABA =
  "min-h-11 flex-none rounded-none border-0 border-b-2 border-transparent px-3 text-[11px] font-black uppercase tracking-wider text-zinc-500 hover:text-zinc-200 data-[state=active]:border-admin-gold data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:shadow-none dark:data-[state=active]:border-admin-gold dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-white dark:text-zinc-500 dark:hover:text-zinc-200";

export function AdminFinanceiroView({
  onNavigate,
  active = true,
  onSetDirty,
  onSetBackOverride,
}: AdminFinanceiroViewProps) {
  const ativo = active;
  const [cache] = useState(() => new Map<string, unknown>());
  const [hoje, setHoje] = useState(() => hojeEmSaoPaulo());
  // Tela aberta de um dia para o outro: "hoje" anda quando ela volta a ativar.
  useEffect(() => {
    if (ativo) setHoje(hojeEmSaoPaulo());
  }, [ativo]);

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
  const [sujo, setSujo] = useState(false);
  const [ocultos, alternarOcultos] = useValoresOcultos();

  const contas = useContasFinanceiras(ativo, versao);
  const categorias = useCategoriasFinanceiras(ativo, versao);

  const fecharFolha = useCallback(() => {
    setFolha(null);
    setSujo(false);
  }, []);
  const abrirFolha = useCallback((nova: FolhaDoFinanceiro) => {
    setSujo(false);
    setNumeroDaFolha((n) => n + 1);
    setFolha(nova);
  }, []);
  const invalidar = useCallback(() => setVersao((v) => v + 1), []);
  const aoSalvar = useCallback(
    (mensagem: string) => {
      invalidar();
      toast.success(mensagem);
      fecharFolha();
    },
    [invalidar, fecharFolha],
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
        <div className="pb-admin h-auto bg-[#09090b] text-white lg:pb-12">
          <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
            <AdminPageHeader
              titulo="Financeiro"
              acoes={
                <>
                  <button
                    type="button"
                    onClick={alternarOcultos}
                    aria-pressed={ocultos}
                    aria-label={ocultos ? "Mostrar valores" : "Ocultar valores"}
                    title={ocultos ? "Mostrar valores" : "Ocultar valores"}
                    className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {ocultos ? (
                      <EyeOff aria-hidden="true" className="size-4" />
                    ) : (
                      <Eye aria-hidden="true" className="size-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => novoLancamento()}
                    className="hidden min-h-11 items-center gap-2 rounded-xl bg-admin-gold px-4 text-sm font-black text-black transition-opacity hover:opacity-90 lg:inline-flex"
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    Novo lançamento
                  </button>
                </>
              }
            />
          </div>

          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 sm:px-6">
            <SeletorDePeriodo
              periodo={periodo}
              rotulo={rotulo}
              aoEscolher={setPeriodo}
              aoPedirPersonalizado={() => abrirFolha({ tipo: "periodo" })}
            />

            <Tabs
              value={aba}
              onValueChange={(valor) => setAba(ehAba(valor) ? valor : "visao")}
              className="gap-4"
            >
              <TabsList className="no-scrollbar -mx-4 size-auto justify-start gap-1 overflow-x-auto rounded-none border-b border-white/5 bg-transparent p-0 px-4 sm:mx-0 sm:px-0">
                {ABAS.map((item) => (
                  <TabsTrigger
                    key={item.valor}
                    value={item.valor}
                    className={CLASSE_ABA}
                  >
                    {item.rotulo}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="visao">
                <AbaVisao
                  ativo={ativo}
                  intervalo={intervalo}
                  hoje={hoje}
                  versao={versao}
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

            {/* Respiro para o botão flutuante não cobrir o fim da lista no celular. */}
            <div aria-hidden="true" className="h-16 lg:hidden" />
          </div>

          <div key={numeroDaFolha}>{renderizarFolha()}</div>

          {ativo && !folha && typeof document !== "undefined"
            ? createPortal(
                // Acima da barra inferior do admin no celular (mesma conta do
                // botão flutuante do formulário de produto); no computador o
                // botão mora no cabeçalho.
                <button
                  type="button"
                  onClick={() => novoLancamento()}
                  aria-label="Novo lançamento"
                  className="fixed bottom-[calc(6.5rem+var(--safe-area-bottom-fixed,env(safe-area-inset-bottom,0px)))] right-5 z-50 flex size-14 items-center justify-center rounded-full bg-admin-gold text-black shadow-[0_15px_30px_rgba(0,0,0,0.6)] transition-transform hover:scale-105 active:scale-95 lg:hidden"
                >
                  <Plus aria-hidden="true" className="size-6" />
                </button>,
                document.body,
              )
            : null}
        </div>
      </ContextoValoresOcultos.Provider>
    </ContextoDoCacheFinanceiro.Provider>
  );
}
