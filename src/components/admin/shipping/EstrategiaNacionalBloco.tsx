import { CabecaDeSecao } from "@/components/admin/shipping/primitivas-direcao-d";
import {
  estrategiaTemAlcanceEditavel,
  precoComDescontoNacional,
  resumoDaEstrategiaNacional,
} from "@/lib/estrategias-de-frete";
import type { EstrategiaDeFreteNacional } from "@/types";
import { AlertCircle } from "lucide-react";
import { memo } from "react";

/**
 * Seção "Estratégia" da tela `AdminShippingNationalView` (T4, 23/09/2026) —
 * mesma gramática direção D de `FreteGratisBloco.tsx`: 5 pills radiogroup +
 * painel de edição fora da pill. O que muda daqui para lá:
 *
 * - a estratégia NACIONAL tem um quinto membro (`desconto_na_mais_barata`),
 *   que não existe no local;
 * - o ALCANCE (mais barata / todas) é campo próprio, só para as 3
 *   estratégias de GRÁTIS (`estrategiaTemAlcanceEditavel`) — o desconto é
 *   sempre "mais barata" por definição, então não mostra o painel;
 * - a PRÉVIA em reais só existe no desconto, e usa a MESMA conta em
 *   centavos da edge (`precoComDescontoNacional`, espelho de
 *   `aplicarEstrategiaNacional`).
 *
 * O componente é CONTROLADO: toda decisão sobre o que o clique SIGNIFICA
 * (ex.: pré-selecionar "mais_barata" ao sair de "desligado" pela primeira
 * vez) mora na view (`AdminShippingNationalView`), que já conhece o valor
 * anterior — aqui só desenha o que recebeu.
 */

const ESTRATEGIAS: readonly {
  readonly id: EstrategiaDeFreteNacional;
  readonly nome: string;
  readonly desc: string;
}[] = [
  {
    id: "desligado",
    nome: "Desligado",
    desc: "nenhuma regra nacional — a transportadora cobra o preço cheio",
  },
  {
    id: "acima_de_valor",
    nome: "Grátis acima de um valor",
    desc: "a compra que passa do mínimo não paga o frete da transportadora",
  },
  {
    id: "sempre",
    nome: "Sempre grátis",
    desc: "toda entrega por transportadora sai grátis, sem mínimo",
  },
  {
    id: "por_produto",
    nome: "Por produto marcado",
    desc: 'só o que você marcar como "frete grátis" no cadastro do produto',
  },
  {
    id: "desconto_na_mais_barata",
    nome: "Desconto na opção mais barata",
    desc: "um percentual ou valor fixo só na cotação mais barata",
  },
];

const PREVIEW_EXEMPLOS = [24.9, 41.3] as const;

/** Dinheiro como a pessoa escreve, sempre com centavos: "R$ 24,90". */
function reaisComCentavos(valor: number): string {
  const seguro = Number.isFinite(valor) ? valor : 0;
  return `R$ ${seguro.toFixed(2).replace(".", ",")}`;
}

export const EstrategiaNacionalBloco = memo(function EstrategiaNacionalBloco({
  estrategia,
  minimo,
  tipoDesconto,
  valorDesconto,
  alcance,
  onEscolherEstrategia,
  onMinimo,
  onTipoDesconto,
  onValorDesconto,
  onAlcance,
  desabilitado,
}: {
  readonly estrategia: EstrategiaDeFreteNacional;
  readonly minimo: number;
  readonly tipoDesconto: "percentual" | "fixo" | null;
  readonly valorDesconto: number;
  readonly alcance: "mais_barata" | "todas";
  readonly onEscolherEstrategia: (
    estrategia: EstrategiaDeFreteNacional,
  ) => void;
  readonly onMinimo: (valor: number) => void;
  readonly onTipoDesconto: (tipo: "percentual" | "fixo") => void;
  readonly onValorDesconto: (valor: number) => void;
  readonly onAlcance: (alcance: "mais_barata" | "todas") => void;
  readonly desabilitado?: boolean;
}) {
  const ehDesconto = estrategia === "desconto_na_mais_barata";
  const mostraMinimo = estrategia === "acima_de_valor" || ehDesconto;
  const mostraAlcance = estrategiaTemAlcanceEditavel(estrategia);

  // REVISÃO (correção 2): o cabeçalho descreve o RASCUNHO do formulário, não
  // o que está salvo no banco — "estado salvo:" mentia. Rótulo alinhado ao
  // irmão local (`FreteGratisBloco`, que já diz "estratégia:"). E com o
  // desconto escolhido mas o TIPO ainda não (percentual/fixo), a conta de
  // `resumoDaEstrategiaNacional` cairia no ramo "fixo" por padrão e mostraria
  // "R$ 0 na mais barata" — um valor que a lojista nunca escolheu.
  const estadoTexto =
    ehDesconto && tipoDesconto === null
      ? "desconto — escolha o tipo"
      : resumoDaEstrategiaNacional({
          nationalShippingStrategy: estrategia,
          nationalShippingMin: minimo,
          nationalDiscountType: tipoDesconto,
          nationalDiscountValue: valorDesconto,
          nationalBenefitScope: alcance,
        });

  return (
    <section
      id="bloco-estrategia-nacional"
      aria-label="Estratégia"
      className="scroll-mt-24"
    >
      <CabecaDeSecao
        titulo="Estratégia"
        estado={
          <>
            estratégia:{" "}
            <b className="font-semibold text-zinc-200">{estadoTexto}</b>
          </>
        }
      />

      <div
        role="radiogroup"
        aria-label="Estratégia de frete nacional"
        className="flex flex-col gap-2.5 py-5 md:flex-row md:flex-wrap md:pb-2"
      >
        {ESTRATEGIAS.map((e) => {
          const ativo = estrategia === e.id;
          return (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={ativo}
              disabled={desabilitado}
              onClick={() => onEscolherEstrategia(e.id)}
              className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-left transition-colors duration-200 disabled:pointer-events-none disabled:opacity-50 ${
                ativo
                  ? "border-admin-accent/70 bg-admin-accent/10"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex size-[17px] shrink-0 items-center justify-center rounded-full border text-[10px] font-black ${
                  ativo
                    ? "border-admin-accent bg-admin-accent text-zinc-950"
                    : "border-zinc-600 text-transparent"
                }`}
              >
                ✓
              </span>
              <span>
                <span
                  className={`block text-sm font-semibold ${
                    ativo ? "text-zinc-100" : "text-zinc-400"
                  }`}
                >
                  {e.nome}
                </span>
                <span
                  className={`mt-0.5 block text-[11.5px] leading-snug ${
                    ativo ? "text-admin-accent/80" : "text-zinc-600"
                  }`}
                >
                  {e.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Tipo do desconto — pills próprias, FORA do radiogroup da estratégia
          (dois grupos de radio distintos, cada um com sua semântica). */}
      {ehDesconto && (
        <div className="border-t border-white/5 pb-1 pt-4 duration-200 animate-in fade-in">
          <div
            role="radiogroup"
            aria-label="Tipo de desconto"
            className="flex flex-wrap gap-2"
          >
            {(["percentual", "fixo"] as const).map((tipo) => {
              const ativo = tipoDesconto === tipo;
              return (
                <button
                  key={tipo}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  disabled={desabilitado}
                  onClick={() => onTipoDesconto(tipo)}
                  className={`rounded-lg border px-3.5 py-2 text-[12.5px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    ativo
                      ? "border-admin-accent/70 bg-admin-accent/10 text-zinc-100"
                      : "border-white/10 text-zinc-400 hover:border-white/25"
                  }`}
                >
                  {tipo === "percentual" ? "Percentual" : "Valor fixo"}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-2">
              {tipoDesconto === "fixo" && (
                <span className="text-xs font-semibold text-zinc-500">R$</span>
              )}
              <input
                id="frete-nacional-valor-desconto"
                type="number"
                min="0"
                step={tipoDesconto === "percentual" ? "1" : "0.5"}
                inputMode="numeric"
                value={valorDesconto === 0 ? "" : valorDesconto}
                onChange={(ev) =>
                  onValorDesconto(
                    ev.target.value === "" ? 0 : Number(ev.target.value),
                  )
                }
                placeholder={tipoDesconto === "percentual" ? "15" : "5"}
                disabled={desabilitado || tipoDesconto === null}
                className="w-24 bg-transparent text-center text-xl font-bold tabular-nums text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-0 disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none"
              />
              {tipoDesconto === "percentual" && (
                <span className="text-xs font-semibold text-zinc-500">%</span>
              )}
            </div>
            <span className="text-[13px] text-zinc-500">
              o desconto que a cliente ganha na cotação mais barata
            </span>
          </div>

          {tipoDesconto !== null && valorDesconto > 0 && (
            <div className="mt-4 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                Prévia (exemplo)
              </p>
              <div className="mt-2 space-y-1">
                {PREVIEW_EXEMPLOS.map((exemplo) => (
                  <p key={exemplo} className="text-[13px] text-zinc-300">
                    <span className="text-zinc-500 line-through">
                      {reaisComCentavos(exemplo)}
                    </span>{" "}
                    →{" "}
                    <span className="font-bold text-admin-accent">
                      {reaisComCentavos(
                        precoComDescontoNacional(
                          exemplo,
                          tipoDesconto,
                          valorDesconto,
                        ),
                      )}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mínimo — "acima de X" obrigatório, mínimo do desconto opcional. */}
      {mostraMinimo && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 pb-1 pt-4 duration-200 animate-in fade-in">
          <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-2">
            <span className="text-xs font-semibold text-zinc-500">R$</span>
            <input
              id="frete-nacional-minimo"
              type="number"
              min={ehDesconto ? "0" : "0.01"}
              step="5"
              inputMode="numeric"
              value={minimo === 0 ? "" : minimo}
              onChange={(ev) =>
                onMinimo(ev.target.value === "" ? 0 : Number(ev.target.value))
              }
              placeholder={ehDesconto ? "sem mínimo" : "199"}
              disabled={desabilitado}
              className="w-28 bg-transparent text-center text-xl font-bold tabular-nums text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-0 disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <span className="text-[13px] text-zinc-500">
            {ehDesconto
              ? "mínimo de compra para o desconto valer — vazio é sem mínimo"
              : "a partir deste valor, o frete nacional sai grátis"}
          </span>
        </div>
      )}

      {/* Alcance — só para as estratégias de GRÁTIS; o desconto é sempre
          "mais barata" por definição. */}
      {mostraAlcance && (
        <div className="border-t border-white/5 pb-1 pt-4 duration-200 animate-in fade-in">
          <div
            role="radiogroup"
            aria-label="Alcance do frete grátis nacional"
            className="flex flex-wrap gap-2"
          >
            {[
              { id: "mais_barata" as const, nome: "Só a opção mais barata" },
              { id: "todas" as const, nome: "Todas as opções" },
            ].map((a) => {
              const ativo = alcance === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  disabled={desabilitado}
                  onClick={() => onAlcance(a.id)}
                  className={`rounded-lg border px-3.5 py-2 text-[12.5px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    ativo
                      ? "border-admin-accent/70 bg-admin-accent/10 text-zinc-100"
                      : "border-white/10 text-zinc-400 hover:border-white/25"
                  }`}
                >
                  {a.nome}
                </button>
              );
            })}
          </div>

          {alcance === "todas" && (
            <p className="mt-3 flex flex-wrap items-start gap-2 text-[12.5px] leading-snug text-amber-300">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Hoje a cliente pode escolher a entrega expressa e o frete dela
                fica por sua conta. Quer limitar o grátis à opção mais barata?
              </span>
              <button
                type="button"
                onClick={() => onAlcance("mais_barata")}
                disabled={desabilitado}
                className="shrink-0 rounded-lg border border-amber-500/30 px-2.5 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:border-amber-400/50 hover:text-amber-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              >
                Limitar à mais barata
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  );
});
