import {
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  Lock,
  LockOpen,
  Store,
} from "lucide-react";

import { useCaixaAtual, useHistoricoDoCaixa } from "@/hooks/useFinanceiro";
import { diferencaDoFechamento, formatarDataHora } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type { CaixaAtual, SessaoDeCaixa } from "@/types/financeiro";
import type { AbrirFolha } from "./navegacao";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CartaoSecao,
  Dinheiro,
  EsqueletoDeLista,
  EstadoDeErro,
  Etiqueta,
} from "./partes";

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
        total && "mt-1 border-t border-white/10 pt-3",
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
}: {
  readonly caixa: CaixaAtual;
  readonly abrirFolha: AbrirFolha;
}) {
  return (
    <>
      <CartaoSecao
        titulo="Caixa aberto"
        subtitulo={`${caixa.contaNome} · desde ${formatarDataHora(caixa.abertoEm)}`}
        acao={<Etiqueta tom="sucesso">Aberto</Etiqueta>}
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Esperado na gaveta agora
            </p>
            <Dinheiro
              valor={caixa.esperado}
              className="text-4xl font-black tracking-tighter text-white"
            />
            <p className="text-xs text-zinc-500">
              Atualiza sozinho a cada venda em dinheiro.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  abrirFolha({
                    tipo: "caixa-movimentar",
                    movimento: "sangria",
                    esperado: caixa.esperado,
                    contaDoCaixa: caixa.contaId,
                  })
                }
                className={CLASSE_BOTAO_SECUNDARIO}
              >
                <ArrowUpFromLine aria-hidden="true" className="size-4" />
                Sangria
              </button>
              <button
                type="button"
                onClick={() =>
                  abrirFolha({
                    tipo: "caixa-movimentar",
                    movimento: "suprimento",
                    esperado: caixa.esperado,
                    contaDoCaixa: caixa.contaId,
                  })
                }
                className={CLASSE_BOTAO_SECUNDARIO}
              >
                <ArrowDownToLine aria-hidden="true" className="size-4" />
                Suprimento
              </button>
              <button
                type="button"
                onClick={() => abrirFolha({ tipo: "caixa-fechar", caixa })}
                className={`${CLASSE_BOTAO_PRIMARIO} col-span-2`}
              >
                <Lock aria-hidden="true" className="size-4" />
                Fechar caixa
              </button>
            </div>
          </div>
          <dl
            aria-label="Como o esperado é calculado"
            className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-2"
          >
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

      <CartaoSecao titulo="Movimentos desta sessão">
        {caixa.movimentos.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Nenhuma sangria ou suprimento ainda. As vendas em dinheiro entram no
            esperado sozinhas.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-white/5">
            {caixa.movimentos.map((movimento) => (
              <li
                key={movimento.id}
                className="flex min-h-12 items-center justify-between gap-3 py-2"
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
                    <p className="truncate text-sm font-bold text-white">
                      {movimento.descricao}
                    </p>
                    <p className="text-[11px] text-zinc-500">
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
        <div className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          <Store aria-hidden="true" className="size-6 text-zinc-300" />
        </div>
        <div>
          <p className="text-lg font-black text-white">Caixa fechado</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-400">
            Abra o caixa no começo do dia contando o troco da gaveta. Durante o
            dia as vendas em dinheiro somam no esperado; no fim, você conta de
            novo e o app mostra se sobrou ou faltou.
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
    <li className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3">
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
      <p className="text-[11px] text-zinc-500">{sessao.contaNome}</p>
      <dl className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-zinc-500">Esperado</dt>
          <dd className="font-bold text-zinc-100">
            {sessao.esperado === null ? (
              "—"
            ) : (
              <Dinheiro valor={sessao.esperado} />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Contado</dt>
          <dd className="font-bold text-zinc-100">
            {sessao.contado === null ? (
              "—"
            ) : (
              <Dinheiro valor={sessao.contado} />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Diferença</dt>
          <dd
            className={cn(
              "font-bold",
              situacao === "quebra" && "text-red-300",
              situacao === "sobra" && "text-amber-200",
              situacao === "bateu" && "text-emerald-300",
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
  ativo,
  versao,
  abrirFolha,
}: {
  readonly ativo: boolean;
  readonly versao: number;
  readonly abrirFolha: AbrirFolha;
}) {
  const atual = useCaixaAtual(ativo, versao);
  const historico = useHistoricoDoCaixa(ativo, versao);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      {atual.erro && !atual.dados ? (
        <EstadoDeErro mensagem={atual.erro} aoTentarDeNovo={atual.recarregar} />
      ) : !atual.dados ? (
        <EsqueletoDeLista linhas={3} />
      ) : atual.dados.sessao ? (
        <CaixaAberto caixa={atual.dados.sessao} abrirFolha={abrirFolha} />
      ) : (
        <CaixaFechado abrirFolha={abrirFolha} />
      )}

      <CartaoSecao
        titulo="Histórico do caixa"
        subtitulo="As últimas 30 sessões"
        acao={<History aria-hidden="true" className="size-4 text-zinc-600" />}
      >
        {historico.erro && !historico.dados ? (
          <EstadoDeErro
            mensagem={historico.erro}
            aoTentarDeNovo={historico.recarregar}
          />
        ) : !historico.dados ? (
          <EsqueletoDeLista linhas={2} />
        ) : historico.dados.length === 0 ? (
          <p className="text-xs text-zinc-500">Nenhum caixa fechado ainda.</p>
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
