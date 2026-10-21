import { useEffect, useRef } from "react";

import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  Lock,
  LockOpen,
  Plus,
  Store,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useCaixaAtual, useHistoricoDoCaixa } from "@/hooks/useFinanceiro";
import { diferencaDoFechamento, formatarDataHora } from "@/lib/financeiro";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { CaixaAtual, SessaoDeCaixa } from "@/types/financeiro";
import type { AbrirFolha } from "./navegacao";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CASCA_DO_CARTAO,
  CLASSE_ROTULO_DO_CARTAO,
  CartaoSecao,
  Dinheiro,
  EsqueletoDeLista,
  EstadoDeErro,
  Etiqueta,
  SeloFinanceiro,
} from "./partes";
import { esquecerTentativasDeSessoesFechadas } from "./tentativasDoCaixa";

function LinhaDaConta({
  rotulo,
  valor,
  sentido,
  total,
}: {
  readonly rotulo: string;
  readonly valor: number;
  readonly sentido?: 1 | -1;
  readonly total?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-2 text-sm",
        total && "mt-1 border-t border-admin-border pt-3",
      )}
    >
      <dt className={total ? "font-black text-white" : "text-zinc-400"}>
        {rotulo}
      </dt>
      <dd
        className={cn(
          "font-bold",
          total && "text-lg font-black text-white",
          sentido === 1 && "text-emerald-300",
          sentido === -1 && "text-red-300",
          sentido === undefined && !total && "text-zinc-100",
        )}
      >
        <Dinheiro valor={valor} sentido={sentido} />
      </dd>
    </div>
  );
}

function CaixaAberto({
  caixa,
  abrirFolha,
  aoNovoLancamento,
  mostrarAcaoFixa,
}: {
  readonly caixa: CaixaAtual;
  readonly abrirFolha: AbrirFolha;
  readonly aoNovoLancamento?: () => void;
  readonly mostrarAcaoFixa: boolean;
}) {
  return (
    <>
      <CartaoSecao
        titulo="Caixa aberto"
        subtitulo={`${caixa.contaNome} · desde ${formatarDataHora(caixa.abertoEm)}`}
        acao={<Etiqueta tom="sucesso">Aberto</Etiqueta>}
      >
        <div className="grid grid-cols-1 gap-7">
          <div className="flex flex-col gap-1">
            <p className={CLASSE_ROTULO_DO_CARTAO}>Esperado na gaveta agora</p>
            <Dinheiro
              valor={caixa.esperado}
              className="text-4xl font-black tracking-tighter text-white"
            />
            <p className="text-xs font-medium text-zinc-400">
              Inclui vendas em dinheiro desta sessão.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  abrirFolha({
                    tipo: "caixa-movimentar",
                    sessaoId: caixa.id,
                    movimento: "sangria",
                    esperado: caixa.esperado,
                    contaDoCaixa: caixa.contaId,
                  })
                }
                className={cn(
                  CLASSE_BOTAO_SECUNDARIO,
                  classeDoTexto("atencao"),
                )}
              >
                <ArrowUpFromLine aria-hidden="true" className="size-4" />
                Sangria
              </button>
              <button
                type="button"
                onClick={() =>
                  abrirFolha({
                    tipo: "caixa-movimentar",
                    sessaoId: caixa.id,
                    movimento: "suprimento",
                    esperado: caixa.esperado,
                    contaDoCaixa: caixa.contaId,
                  })
                }
                className={cn(CLASSE_BOTAO_SECUNDARIO, "text-teal-300")}
              >
                <ArrowDownToLine aria-hidden="true" className="size-4" />
                Suprimento
              </button>
              {!mostrarAcaoFixa && (
                <button
                  type="button"
                  onClick={() => abrirFolha({ tipo: "caixa-fechar", caixa })}
                  className={`${CLASSE_BOTAO_PRIMARIO} col-span-2`}
                >
                  <Lock aria-hidden="true" className="size-4" />
                  Fechar caixa
                </button>
              )}
              {aoNovoLancamento ? (
                <button
                  type="button"
                  onClick={aoNovoLancamento}
                  className={`${CLASSE_BOTAO_SECUNDARIO} col-span-2 text-sky-300`}
                >
                  <Plus aria-hidden="true" className="size-5" />
                  Novo lançamento
                </button>
              ) : null}
            </div>
          </div>
          <dl
            id="fin-composicao-do-caixa"
            aria-label="Como o esperado é calculado"
            className={`px-4 py-2 ${CLASSE_CASCA_DO_CARTAO}`}
          >
            <div className="mb-3 flex items-center gap-3 pt-3">
              <SeloFinanceiro icone={Store} matiz="#2DD4BF" />
              <dt className="text-base font-bold text-white">
                Como o esperado é calculado
              </dt>
            </div>
            <LinhaDaConta
              rotulo="Abertura (troco)"
              valor={caixa.valorAbertura}
            />
            <LinhaDaConta
              rotulo="Vendas em dinheiro"
              valor={caixa.vendasDinheiro}
              sentido={1}
            />
            <LinhaDaConta
              rotulo="Devoluções em dinheiro"
              valor={caixa.devolucoesDinheiro}
              sentido={-1}
            />
            <LinhaDaConta
              rotulo="Suprimentos e entradas"
              valor={caixa.entradasManuais}
              sentido={1}
            />
            <LinhaDaConta
              rotulo="Sangrias e saídas"
              valor={caixa.saidasManuais}
              sentido={-1}
            />
            <LinhaDaConta rotulo="Esperado" valor={caixa.esperado} total />
          </dl>
        </div>
      </CartaoSecao>

      {mostrarAcaoFixa ? (
        <AcaoDaBarra>
          <button
            type="button"
            onClick={() => abrirFolha({ tipo: "caixa-fechar", caixa })}
            className={`${CLASSE_BOTAO_PRIMARIO} admin-barra-principal w-full`}
          >
            <Lock aria-hidden="true" className="size-5" />
            Fechar caixa
          </button>
        </AcaoDaBarra>
      ) : null}

      <CartaoSecao titulo="Movimentos desta sessão">
        {caixa.movimentos.length === 0 ? (
          <p className="text-xs text-zinc-400">
            Nenhuma sangria ou suprimento. As vendas em dinheiro somam no
            esperado.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-admin-border">
            {caixa.movimentos.map((movimento) => (
              <li
                key={movimento.id}
                className="flex min-h-14 flex-wrap items-start justify-between gap-3 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl border",
                      movimento.tipo === "entrada"
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                        : "border-red-500/20 bg-red-500/10 text-red-300",
                    )}
                  >
                    {movimento.tipo === "entrada" ? (
                      <ArrowDownToLine aria-hidden="true" className="size-4" />
                    ) : (
                      <ArrowUpFromLine aria-hidden="true" className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold text-white">
                      {movimento.descricao}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {formatarDataHora(movimento.em)}
                    </p>
                  </div>
                </div>
                <Dinheiro
                  valor={movimento.valor}
                  sentido={movimento.tipo === "entrada" ? 1 : -1}
                  className={cn(
                    "text-sm font-black",
                    movimento.tipo === "entrada"
                      ? "text-emerald-300"
                      : "text-red-300",
                  )}
                />
              </li>
            ))}
          </ul>
        )}
      </CartaoSecao>
    </>
  );
}

function CaixaFechado({ abrirFolha }: { readonly abrirFolha: AbrirFolha }) {
  return (
    <CartaoSecao>
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-admin-border bg-white/5">
          <Store aria-hidden="true" className="size-6 text-zinc-300" />
        </div>
        <div>
          <p className="text-lg font-black text-white">Caixa fechado</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-400">
            Abra contando o troco. As vendas em dinheiro somam no esperado. No
            fim do dia, conte de novo: o app mostra se sobrou ou faltou.
          </p>
        </div>
        <button
          type="button"
          onClick={() => abrirFolha({ tipo: "caixa-abrir" })}
          className={CLASSE_BOTAO_PRIMARIO}
        >
          <LockOpen aria-hidden="true" className="size-4" />
          Abrir caixa
        </button>
      </div>
    </CartaoSecao>
  );
}

function SessaoDoHistorico({ sessao }: { readonly sessao: SessaoDeCaixa }) {
  const situacao =
    sessao.esperado !== null && sessao.contado !== null
      ? diferencaDoFechamento(sessao.esperado, sessao.contado).situacao
      : null;
  return (
    <li className={`flex flex-col gap-2 p-3 ${CLASSE_CASCA_DO_CARTAO}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-white">
          {formatarDataHora(sessao.abertoEm)}
          {sessao.fechadoEm ? ` → ${formatarDataHora(sessao.fechadoEm)}` : ""}
        </p>
        {situacao === "quebra" ? (
          <Etiqueta tom="perigo">Quebra</Etiqueta>
        ) : situacao === "sobra" ? (
          <Etiqueta tom="aviso">Sobra</Etiqueta>
        ) : situacao === "bateu" ? (
          <Etiqueta tom="sucesso">Bateu</Etiqueta>
        ) : (
          <Etiqueta>{sessao.fechadoEm ? "Fechado" : "Aberto"}</Etiqueta>
        )}
      </div>
      <p className="text-xs font-medium text-zinc-400">{sessao.contaNome}</p>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className={CLASSE_ROTULO_DO_CARTAO}>Esperado</dt>
          <dd className="font-bold text-zinc-100">
            {sessao.esperado === null ? (
              "—"
            ) : (
              <Dinheiro valor={sessao.esperado} />
            )}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className={CLASSE_ROTULO_DO_CARTAO}>Contado</dt>
          <dd className="font-bold text-zinc-100">
            {sessao.contado === null ? (
              "—"
            ) : (
              <Dinheiro valor={sessao.contado} />
            )}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className={CLASSE_ROTULO_DO_CARTAO}>Diferença</dt>
          <dd
            className={cn(
              "font-bold",
              situacao === "quebra" && classeDoTexto("negativo"),
              situacao === "sobra" && classeDoTexto("atencao"),
              situacao === "bateu" && classeDoTexto("positivo"),
            )}
          >
            {sessao.diferenca === null ? (
              "—"
            ) : (
              <Dinheiro valor={sessao.diferenca} comSinal />
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * Aba "Caixa": a gaveta da loja física. Fechado → abrir contando o troco;
 * aberto → esperado ao vivo (abertura + vendas em dinheiro − devoluções em
 * dinheiro + entradas − saídas), sangria, suprimento e fechamento com
 * esperado × contado × diferença; embaixo, o histórico das sessões.
 */
export function AbaCaixa({
  aoSessaoAtual,
  ativo,
  versao,
  abrirFolha,
  aoNovoLancamento,
  mostrarAcaoFixa = false,
}: {
  readonly aoSessaoAtual?: (id: string | null) => void;
  readonly ativo: boolean;
  readonly versao: number;
  readonly abrirFolha: AbrirFolha;
  readonly aoNovoLancamento?: () => void;
  readonly mostrarAcaoFixa?: boolean;
}) {
  const atual = useCaixaAtual(ativo, versao);
  const historico = useHistoricoDoCaixa(ativo, versao);
  const { user } = useAuth();
  const historicoLido = useRef<SessaoDeCaixa[] | null>(null);
  useEffect(() => {
    if (
      ativo &&
      historico.dados &&
      !historico.carregando &&
      !historico.erro &&
      historicoLido.current !== historico.dados
    ) {
      historicoLido.current = historico.dados;
      esquecerTentativasDeSessoesFechadas(user?.id ?? null, historico.dados);
    }
  }, [ativo, historico.dados, historico.carregando, historico.erro, user?.id]);
  useEffect(() => {
    if (ativo && atual.dados && !atual.carregando && !atual.erro) {
      aoSessaoAtual?.(atual.dados.sessao?.id ?? null);
    }
  }, [ativo, atual.dados, atual.carregando, atual.erro, aoSessaoAtual]);

  return (
    <div className="flex flex-col gap-7">
      {atual.erro && !atual.dados ? (
        <EstadoDeErro mensagem={atual.erro} aoTentarDeNovo={atual.recarregar} />
      ) : !atual.dados ? (
        <EsqueletoDeLista linhas={3} />
      ) : atual.dados.sessao ? (
        <CaixaAberto
          caixa={atual.dados.sessao}
          abrirFolha={abrirFolha}
          aoNovoLancamento={aoNovoLancamento}
          mostrarAcaoFixa={mostrarAcaoFixa}
        />
      ) : (
        <CaixaFechado abrirFolha={abrirFolha} />
      )}

      {!atual.dados?.sessao && aoNovoLancamento ? (
        <AcaoDaBarra ativa={ativo && mostrarAcaoFixa}>
          <button
            type="button"
            aria-label="Novo lançamento"
            onClick={aoNovoLancamento}
            className={`${CLASSE_BOTAO_PRIMARIO} admin-barra-principal w-full`}
          >
            <Plus aria-hidden="true" className="size-5" />
            Novo lançamento
          </button>
        </AcaoDaBarra>
      ) : null}

      <CartaoSecao
        titulo="Histórico do caixa"
        subtitulo="As últimas 30 sessões"
        acao={<History aria-hidden="true" className="size-4 text-zinc-400" />}
      >
        {historico.erro && !historico.dados ? (
          <EstadoDeErro
            mensagem={historico.erro}
            aoTentarDeNovo={historico.recarregar}
          />
        ) : !historico.dados ? (
          <EsqueletoDeLista linhas={2} />
        ) : historico.dados.length === 0 ? (
          <p className="text-xs text-zinc-400">Nenhum caixa fechado ainda.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {historico.dados.map((sessao) => (
              <SessaoDoHistorico key={sessao.id} sessao={sessao} />
            ))}
          </ul>
        )}
      </CartaoSecao>
    </div>
  );
}
