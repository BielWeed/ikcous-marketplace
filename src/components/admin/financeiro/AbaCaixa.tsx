import { type ReactNode, useEffect, useRef } from "react";

import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { Plus } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useCaixaAtual, useHistoricoDoCaixa } from "@/hooks/useFinanceiro";
import {
  diferencaDoFechamento,
  paraCentavos,
  rotuloDaOrigem,
} from "@/lib/financeiro";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type {
  CaixaAtual,
  MovimentoDoCaixa,
  SessaoDeCaixa,
} from "@/types/financeiro";
import type { AbrirFolha } from "./navegacao";
import {
  CLASSE_BOTAO_PRIMARIO,
  CartaoSecao,
  Dinheiro,
  EsqueletoDeLista,
  EstadoDeErro,
  useValoresEstaoOcultos,
} from "./partes";
import {
  CLASSE_BOTAO_DA_GAVETA,
  CLASSE_BOTAO_PRINCIPAL_DA_GAVETA,
  CLASSE_CARTAO_DO_CAIXA,
  CLASSE_ROTULO_CAIXA_ALTA,
  LinhaDaConta,
  Pilula,
  classeDoValorDaLinha,
  classeDoValorDoHeroi,
  classeDoValorNaColuna,
  periodoDaSessao,
  quandoCurto,
} from "./partesDoCaixa";
import { esquecerTentativasDeSessoesFechadas } from "./tentativasDoCaixa";

/** Nome da conta de sistema: nas sessões dela a conta não precisa ser repetida. */
const NOME_DA_CONTA_DO_CAIXA = "Caixa da loja";

/**
 * "Sangria · Pagamento de frete": o tipo do movimento e o que o lojista
 * escreveu. Sem prefixo quando não diz nada ("Lançamento manual") e sem
 * repetir quando a descrição já é o próprio nome do tipo.
 */
function textoDoMovimento(movimento: MovimentoDoCaixa): string {
  const origem = movimento.origem;
  if (!origem || origem === "manual") return movimento.descricao;
  const rotulo = rotuloDaOrigem(origem);
  return movimento.descricao.trim().toLowerCase() === rotulo.toLowerCase()
    ? rotulo
    : `${rotulo} · ${movimento.descricao}`;
}

function BotaoNovoLancamento({ aoClicar }: { readonly aoClicar: () => void }) {
  return (
    <button
      type="button"
      aria-label="Novo lançamento"
      onClick={aoClicar}
      className={CLASSE_BOTAO_DA_GAVETA}
    >
      Novo lançamento
    </button>
  );
}

function CaixaAberto({
  caixa,
  abrirFolha,
  aoNovoLancamento,
}: {
  readonly caixa: CaixaAtual;
  readonly abrirFolha: AbrirFolha;
  readonly aoNovoLancamento?: () => void;
}) {
  const ocultos = useValoresEstaoOcultos();
  const esperadoNegativo = paraCentavos(caixa.esperado) < 0;
  const movimentar = (movimento: "sangria" | "suprimento") =>
    abrirFolha({
      tipo: "caixa-movimentar",
      sessaoId: caixa.id,
      movimento,
      esperado: caixa.esperado,
      contaDoCaixa: caixa.contaId,
    });
  return (
    <>
      <section
        aria-label="Esperado na gaveta"
        data-estado-do-caixa="aberto"
        className={cn(CLASSE_CARTAO_DO_CAIXA, "flex flex-col gap-5")}
      >
        <div className="flex flex-col items-start gap-2">
          <div className="flex w-full items-center justify-between gap-3">
            <h2 className={CLASSE_ROTULO_CAIXA_ALTA}>
              Esperado na gaveta agora
            </h2>
            <Pilula tom="positivo">Aberto</Pilula>
          </div>
          <Dinheiro
            valor={caixa.esperado}
            className={cn(
              classeDoValorDoHeroi(caixa.esperado, ocultos),
              esperadoNegativo ? classeDoTexto("negativo") : "text-white",
            )}
          />
          <p className="break-words text-sm text-zinc-400">
            desde {quandoCurto(caixa.abertoEm)} · {caixa.contaNome}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => movimentar("sangria")}
            className={CLASSE_BOTAO_DA_GAVETA}
          >
            Sangria
          </button>
          <button
            type="button"
            onClick={() => movimentar("suprimento")}
            className={CLASSE_BOTAO_DA_GAVETA}
          >
            Suprimento
          </button>
          {aoNovoLancamento ? (
            <BotaoNovoLancamento aoClicar={aoNovoLancamento} />
          ) : null}
          <button
            type="button"
            onClick={() => abrirFolha({ tipo: "caixa-fechar", caixa })}
            className={cn(
              CLASSE_BOTAO_PRINCIPAL_DA_GAVETA,
              !aoNovoLancamento && "col-span-2",
            )}
          >
            Fechar caixa
          </button>
        </div>
      </section>

      <CartaoSecao
        id="fin-composicao-do-caixa"
        titulo="Como o esperado é calculado"
      >
        <dl>
          <LinhaDaConta rotulo="Abertura (troco)" valor={caixa.valorAbertura} />
          <LinhaDaConta
            rotulo="Vendas em dinheiro"
            valor={caixa.vendasDinheiro}
            sentido={1}
          />
          <LinhaDaConta
            rotulo="Suprimentos e entradas"
            valor={caixa.entradasManuais}
            sentido={1}
          />
          <LinhaDaConta
            rotulo="Devoluções em dinheiro"
            valor={caixa.devolucoesDinheiro}
            sentido={-1}
          />
          <LinhaDaConta
            rotulo="Estornos em dinheiro"
            valor={caixa.estornosExternosDinheiro}
            sentido={-1}
          />
          <LinhaDaConta
            rotulo="Sangrias e saídas"
            valor={caixa.saidasManuais}
            sentido={-1}
          />
          <LinhaDaConta rotulo="Esperado" valor={caixa.esperado} total />
        </dl>
      </CartaoSecao>

      <CartaoSecao titulo="Movimentos desta sessão">
        {caixa.movimentos.length === 0 ? (
          <p className="text-xs text-zinc-400">
            Nenhuma sangria ou suprimento. As vendas em dinheiro somam no
            esperado.
          </p>
        ) : (
          <ul className="flex flex-col">
            {caixa.movimentos.map((movimento) => {
              const entrada = movimento.tipo === "entrada";
              return (
                <li
                  key={movimento.id}
                  className="flex min-h-14 items-start justify-between gap-3 border-t border-admin-border py-3 first:border-t-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm text-white">
                      {textoDoMovimento(movimento)}
                    </p>
                    {movimento.em ? (
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {quandoCurto(movimento.em)}
                      </p>
                    ) : null}
                  </div>
                  <Dinheiro
                    valor={movimento.valor}
                    sentido={entrada ? 1 : -1}
                    className={cn(
                      classeDoValorDaLinha(movimento.valor, true, ocultos),
                      classeDoTexto(entrada ? "positivo" : "negativo"),
                    )}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CartaoSecao>
    </>
  );
}

function CaixaFechado({
  abrirFolha,
  aoNovoLancamento,
}: {
  readonly abrirFolha: AbrirFolha;
  readonly aoNovoLancamento?: () => void;
}) {
  return (
    <section
      aria-label="Caixa"
      data-estado-do-caixa="fechado"
      className={cn(CLASSE_CARTAO_DO_CAIXA, "flex flex-col gap-5")}
    >
      <div className="flex flex-col items-start gap-2">
        <div className="flex w-full items-center justify-between gap-3">
          <h2 className={CLASSE_ROTULO_CAIXA_ALTA}>Gaveta da loja</h2>
          <Pilula>Fechado</Pilula>
        </div>
        <p className="text-2xl font-bold leading-tight text-white">
          Caixa fechado
        </p>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          Abra contando o troco. As vendas em dinheiro somam no esperado. No fim
          do dia, conte de novo: o app mostra se sobrou ou faltou.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {aoNovoLancamento ? (
          <BotaoNovoLancamento aoClicar={aoNovoLancamento} />
        ) : null}
        <button
          type="button"
          onClick={() => abrirFolha({ tipo: "caixa-abrir" })}
          className={cn(
            CLASSE_BOTAO_PRINCIPAL_DA_GAVETA,
            !aoNovoLancamento && "col-span-2",
          )}
        >
          Abrir caixa
        </button>
      </div>
    </section>
  );
}

/** Esqueleto com a pegada dos blocos reais (sem salto de layout). */
function EsqueletoDoCaixa() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <Skeleton className="h-52 rounded-3xl bg-white/5" />
      <Skeleton className="h-64 rounded-3xl bg-white/5" />
    </div>
  );
}

function ColunaDaSessao({
  rotulo,
  children,
  className,
}: {
  readonly rotulo: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-400">{rotulo}</dt>
      <dd className={cn("mt-1", className)}>{children}</dd>
    </div>
  );
}

function SessaoDoHistorico({ sessao }: { readonly sessao: SessaoDeCaixa }) {
  const ocultos = useValoresEstaoOcultos();
  const calculo =
    sessao.esperado !== null && sessao.contado !== null
      ? diferencaDoFechamento(sessao.esperado, sessao.contado)
      : null;
  const situacao = calculo?.situacao ?? null;
  const diferenca = sessao.diferenca ?? calculo?.diferenca ?? null;
  const tomDaDiferenca =
    situacao === "quebra"
      ? "negativo"
      : situacao === "sobra"
        ? "atencao"
        : "neutro";
  return (
    <li
      data-situacao-da-sessao={situacao ?? "sem-fechamento"}
      className="flex flex-col gap-3 border-t border-admin-border py-4 first:border-t-0 first:pt-0 last:pb-0"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-medium text-white">
          {periodoDaSessao(sessao.abertoEm, sessao.fechadoEm)}
        </p>
        {situacao === "quebra" ? (
          <Pilula tom="negativo">
            Quebra{" "}
            {diferenca !== null ? (
              <Dinheiro
                valor={diferenca}
                comSinal
                className="whitespace-nowrap"
              />
            ) : null}
          </Pilula>
        ) : situacao === "sobra" ? (
          <Pilula tom="atencao">
            Sobra{" "}
            {diferenca !== null ? (
              <Dinheiro
                valor={diferenca}
                comSinal
                className="whitespace-nowrap"
              />
            ) : null}
          </Pilula>
        ) : situacao === "bateu" ? (
          <Pilula tom="positivo">Bateu</Pilula>
        ) : (
          <Pilula>{sessao.fechadoEm ? "Fechado" : "Aberto"}</Pilula>
        )}
      </div>
      {sessao.contaNome !== NOME_DA_CONTA_DO_CAIXA ? (
        <p className="-mt-2 break-words text-xs text-zinc-400">
          {sessao.contaNome}
        </p>
      ) : null}
      <dl className="grid grid-cols-3 gap-2">
        <ColunaDaSessao
          rotulo="Esperado"
          className={
            sessao.esperado === null
              ? "text-base font-bold text-white"
              : cn(
                  classeDoValorNaColuna(sessao.esperado, false, ocultos),
                  "text-white",
                )
          }
        >
          {sessao.esperado === null ? (
            "—"
          ) : (
            <Dinheiro valor={sessao.esperado} className="whitespace-nowrap" />
          )}
        </ColunaDaSessao>
        <ColunaDaSessao
          rotulo="Contado"
          className={
            sessao.contado === null
              ? "text-base font-bold text-white"
              : cn(
                  classeDoValorNaColuna(sessao.contado, false, ocultos),
                  "text-white",
                )
          }
        >
          {sessao.contado === null ? (
            "—"
          ) : (
            <Dinheiro valor={sessao.contado} className="whitespace-nowrap" />
          )}
        </ColunaDaSessao>
        <ColunaDaSessao
          rotulo="Diferença"
          className={cn(
            diferenca === null
              ? "text-base font-bold"
              : classeDoValorNaColuna(diferenca, true, ocultos),
            classeDoTexto(tomDaDiferenca),
          )}
        >
          {diferenca === null ? (
            "—"
          ) : (
            <Dinheiro
              valor={diferenca}
              comSinal
              className="whitespace-nowrap"
            />
          )}
        </ColunaDaSessao>
      </dl>
    </li>
  );
}

/**
 * Aba "Caixa": a gaveta da loja física. Fechado → abrir contando o troco;
 * aberto → esperado ao vivo (abertura + vendas em dinheiro − devoluções em
 * dinheiro + entradas − saídas), sangria, suprimento e fechamento com
 * esperado × contado × diferença; embaixo, o histórico das sessões.
 *
 * Desenho de 22/10/2026: o esperado e as quatro ações num cartão só, a conta
 * do esperado e os movimentos em linhas, o histórico em três colunas.
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
  /** Só vale enquanto o caixa carrega ou falha: sem cartão, "Novo lançamento" vai na barra. */
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
    <div className="flex flex-col gap-4">
      {atual.erro && !atual.dados ? (
        <EstadoDeErro mensagem={atual.erro} aoTentarDeNovo={atual.recarregar} />
      ) : !atual.dados ? (
        <EsqueletoDoCaixa />
      ) : atual.dados.sessao ? (
        <CaixaAberto
          caixa={atual.dados.sessao}
          abrirFolha={abrirFolha}
          aoNovoLancamento={aoNovoLancamento}
        />
      ) : (
        <CaixaFechado
          abrirFolha={abrirFolha}
          aoNovoLancamento={aoNovoLancamento}
        />
      )}

      {!atual.dados && aoNovoLancamento ? (
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

      <CartaoSecao titulo="Histórico do caixa" subtitulo="Últimas 30 sessões">
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
          <ul className="flex flex-col">
            {historico.dados.map((sessao) => (
              <SessaoDoHistorico key={sessao.id} sessao={sessao} />
            ))}
          </ul>
        )}
      </CartaoSecao>
    </div>
  );
}
