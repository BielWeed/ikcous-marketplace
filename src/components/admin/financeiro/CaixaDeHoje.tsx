// Cartão-herói "Caixa de hoje", no topo da Visão (desenho aprovado de
// 24/10/2026): o caixa fica na frente, com o botão certo já ao alcance.
//
// SÓ APRESENTAÇÃO: o estado (aberto/fechado), o "esperado na gaveta" e as
// folhas de abrir e fechar são os da aba Caixa — o cartão lê a MESMA consulta
// (`fin_caixa_atual`, uma só por tela) e abre as folhas que já existem. Ele
// nunca grava nada: quem grava é a folha, depois do toque de confirmar.
//
// Bloco em tinta (`bg-foreground text-background`: escuro no tema Claro, claro
// nos outros dois). A cor do estado SIGNIFICA algo e vem sempre com texto
// ("Aberto"); como o fundo inverte de um tema para o outro, o verde e o
// vermelho têm um tom para o bloco claro e outro, via `data-admin-tema`, para o
// bloco escuro do tema Claro.

import { Skeleton } from "@/components/ui/skeleton";
import type { ConsultaFinanceira } from "@/hooks/useFinanceiro";
import { paraCentavos } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type { CaixaAtual } from "@/types/financeiro";
import type { AbaDoFinanceiro, AbrirFolha } from "./navegacao";
import { Dinheiro, EstadoDeErro, useValoresEstaoOcultos } from "./partes";
import { classeDoValorDoHeroi, quandoCurto } from "./partesDoCaixa";

// Classes escritas por inteiro (o Tailwind só gera o que lê literal no fonte).
/** Verde de "aberto" sobre o bloco em tinta (escuro no bloco claro; claro no bloco escuro do tema Claro). */
const TEXTO_VERDE =
  "text-emerald-800 [html[data-admin-tema=claro]_&]:text-emerald-400";
const PONTO_VERDE =
  "bg-emerald-700 [html[data-admin-tema=claro]_&]:bg-emerald-400";
/** Esperado negativo (sangria maior que o dinheiro que entrou): o sinal já vem escrito. */
const TEXTO_VERMELHO =
  "text-red-700 [html[data-admin-tema=claro]_&]:text-red-400";

const CLASSE_FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground active:scale-[0.98]";
/** `border-solid` explícito: o index.css zera a borda de todo `<button>`. */
const CLASSE_BOTAO_PRINCIPAL = cn(
  "inline-flex h-[52px] min-w-0 flex-1 items-center justify-center rounded-2xl bg-background px-4 text-[15px] font-semibold text-foreground transition-opacity hover:opacity-90",
  CLASSE_FOCO,
);
const CLASSE_BOTAO_SECUNDARIO = cn(
  "inline-flex h-[52px] shrink-0 items-center justify-center rounded-2xl border border-solid border-background/40 px-4 text-[15px] font-semibold text-background transition-colors hover:bg-background/10",
  CLASSE_FOCO,
);

export function CaixaDeHoje({
  consulta,
  abrirFolha,
  irParaAba,
}: {
  readonly consulta: ConsultaFinanceira<{
    readonly sessao: CaixaAtual | null;
  }>;
  readonly abrirFolha: AbrirFolha;
  readonly irParaAba: (aba: AbaDoFinanceiro) => void;
}) {
  const ocultos = useValoresEstaoOcultos();
  const { dados, erro, recarregar } = consulta;

  // Sem saber o estado, o cartão NÃO afirma "fechado" nem oferece "Abrir caixa":
  // o caixa pode estar aberto.
  if (!dados) {
    return erro ? (
      <EstadoDeErro mensagem={erro} aoTentarDeNovo={recarregar} />
    ) : (
      <div data-caixa-lendo="" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando…</span>
        <Skeleton className="h-[12.8rem] rounded-[20px] bg-white/5" />
      </div>
    );
  }

  const caixa = dados.sessao;
  const esperadoNegativo = caixa ? paraCentavos(caixa.esperado) < 0 : false;

  return (
    <section
      aria-label="Caixa"
      data-faixa-do-caixa={caixa ? "aberto" : "fechado"}
      className="flex min-w-0 flex-col gap-4 rounded-[20px] bg-foreground p-5 text-background"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-background/70">
          Caixa de hoje
        </h2>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold",
            caixa ? TEXTO_VERDE : "text-background/70",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              caixa ? PONTO_VERDE : "bg-background/60",
            )}
          />
          {caixa ? "Aberto" : "Fechado"}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        {caixa ? (
          <>
            <Dinheiro
              valor={caixa.esperado}
              className={cn(
                classeDoValorDoHeroi(caixa.esperado, ocultos),
                esperadoNegativo && TEXTO_VERMELHO,
              )}
            />
            <p className="text-sm text-background/70">
              esperado na gaveta agora
            </p>
            <p className="break-words text-sm text-background/70">
              desde {quandoCurto(caixa.abertoEm)} ·{" "}
              <span className="whitespace-nowrap">
                troco{" "}
                <Dinheiro
                  valor={caixa.valorAbertura}
                  className="whitespace-nowrap"
                />
              </span>
            </p>
          </>
        ) : (
          <>
            <p className="text-[28px] font-bold leading-tight tracking-tight">
              Caixa fechado
            </p>
            <p className="text-sm text-background/70">
              Abra contando o troco da gaveta.
            </p>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            abrirFolha(
              caixa ? { tipo: "caixa-fechar", caixa } : { tipo: "caixa-abrir" },
            )
          }
          className={CLASSE_BOTAO_PRINCIPAL}
        >
          {caixa ? "Fechar caixa" : "Abrir caixa"}
        </button>
        <button
          type="button"
          onClick={() => irParaAba("caixa")}
          className={CLASSE_BOTAO_SECUNDARIO}
        >
          Ver caixa
        </button>
      </div>
    </section>
  );
}
