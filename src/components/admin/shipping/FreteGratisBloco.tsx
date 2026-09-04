import { CabecaDeSecao } from "@/components/admin/shipping/primitivas-direcao-d";
import type { PresetFreteGratis } from "@/lib/presets-de-frete-gratis";
import { memo } from "react";

/**
 * Seção "Frete grátis" da tela de Frete v2 — direção D aprovada pelo dono
 * (03/09): presets em PILLS com marca de seleção (o desenho novo; os cards
 * grandes da rodada anterior morreram com ele) e painel de edição do valor
 * abaixo, com o aviso do mockup.
 *
 * SEMÂNTICA EXCLUSIVA (decisão do dono via orquestradora): a estratégia
 * escolhida é a ÚNICA que vale — escolher uma pill desliga as outras. A
 * escrita no config passa por `valorDoPreset` e a leitura do ativo por
 * `presetDoConfig` (contrato único em src/lib/presets-de-frete-gratis.ts;
 * regra escrita em dois lugares diverge — lição #53).
 *
 * As pills são um grupo de radio de verdade (role="radiogroup" +
 * role="radio" aria-checked): um só pode ficar marcado, como o lojista
 * espera de "escolha uma". A edição do valor do preset "acima de" fica num
 * PAINEL PRÓPRIO fora da pill — interactive dentro de button é HTML
 * inválido e quebra leitor de tela (a pill é só a escolha; a edição é
 * outra coisa).
 */

const PRESETS: readonly {
  readonly id: PresetFreteGratis;
  readonly nome: string;
  readonly desc: string;
}[] = [
  {
    id: "desligado",
    nome: "Desligado",
    desc: "nenhuma regra de grátis — a entrega é cobrada como está acima",
  },
  {
    id: "acima_de_valor",
    nome: "Grátis acima de um valor",
    desc: "a compra que passa do mínimo não paga entrega",
  },
  {
    id: "sempre",
    nome: "Sempre grátis",
    desc: "todo pedido sai com entrega grátis, sem mínimo",
  },
  {
    id: "por_produto",
    nome: "Por produto marcado",
    desc: 'só o que você marcar como "frete grátis" no cadastro do produto',
  },
];

/** Estado à direita do cabeçalho — a estratégia que o formulário segura. */
// Map (não Record indexado por variável): indexação dinâmica dispara
// `security/detect-object-injection` do eslint e o teto do lint reprova
// warning novo — `.get()` devolve o mesmo rótulo para cada preset.
const ESTRATEGIA = new Map<PresetFreteGratis, string>([
  ["desligado", "desligado"],
  ["acima_de_valor", "acima de um valor"],
  ["sempre", "sempre grátis"],
  ["por_produto", "por produto"],
]);

export const FreteGratisBloco = memo(function FreteGratisBloco({
  preset,
  acimaDe,
  onEscolher,
  onAcimaDe,
  desabilitado,
}: {
  readonly preset: PresetFreteGratis;
  /** Valor do preset "acima de" (só faz sentido com o preset ativo dele). */
  readonly acimaDe: number;
  readonly onEscolher: (preset: PresetFreteGratis) => void;
  readonly onAcimaDe: (valor: number) => void;
  readonly desabilitado?: boolean;
}) {
  return (
    <section
      id="bloco-frete-gratis"
      aria-label="Frete grátis"
      className="scroll-mt-24"
    >
      <CabecaDeSecao
        titulo="Frete grátis"
        estado={
          <>
            estratégia:{" "}
            <b className="font-semibold text-zinc-200">
              {ESTRATEGIA.get(preset)}
            </b>
          </>
        }
      />

      <div
        role="radiogroup"
        aria-label="Estratégia de frete grátis"
        className="flex flex-col gap-2.5 py-5 md:flex-row md:flex-wrap md:pb-2"
      >
        {PRESETS.map((p) => {
          const ativo = preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={ativo}
              disabled={desabilitado}
              onClick={() => onEscolher(p.id)}
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
                  {p.nome}
                </span>
                <span
                  className={`mt-0.5 block text-[11.5px] leading-snug ${
                    ativo ? "text-admin-accent/80" : "text-zinc-600"
                  }`}
                >
                  {p.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Painel de edição do valor — só existe quando o preset "acima de"
          está ativo. FORA da pill de escolha (interactive dentro de button
          é HTML inválido). O aviso do mockup prende a consequência ANTES do
          salvar (REVISÃO A7): o campo limpo grava 0 — e 0 é "desligado" no
          contrato de presets —, então salvar vazio DESLIGAVA o grátis sem a
          pessoa perceber. O `min` bloqueia 0/negativo digitado. */}
      {preset === "acima_de_valor" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 pb-1 pt-4 duration-200 animate-in fade-in">
          <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-2">
            <span className="text-xs font-semibold text-zinc-500">R$</span>
            <input
              id="frete-gratis-acima-de"
              type="number"
              min="0.01"
              step="5"
              inputMode="numeric"
              value={acimaDe === 0 ? "" : acimaDe}
              onChange={(e) =>
                onAcimaDe(e.target.value === "" ? 0 : Number(e.target.value))
              }
              placeholder="100"
              disabled={desabilitado}
              className="w-24 bg-transparent text-center text-xl font-bold tabular-nums text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-0 disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <span className="text-[13px] text-zinc-500">
            o cliente ganha frete grátis a partir deste valor, no carrinho
          </span>
          <p className="w-full text-[11px] font-medium leading-snug text-amber-300/90">
            Atenção: valor vazio desliga o frete grátis ao salvar (o mínimo é R$
            0,01). Para desligar de propósito, escolha "Desligado" acima.
          </p>
        </div>
      )}
    </section>
  );
});
