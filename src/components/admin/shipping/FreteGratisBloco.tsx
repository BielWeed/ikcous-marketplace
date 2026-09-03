import {
  Check,
  Gift,
  Infinity as InfinityIcon,
  Power,
  Tag,
  TrendingUp,
} from "lucide-react";
import { memo } from "react";
import type { PresetFreteGratis } from "@/lib/presets-de-frete-gratis";

/**
 * Bloco "Frete grátis" da tela de Frete v2 — seletor de PRESETS (ordem do
 * dono: "várias estratégias que lojistas usam, o lojista seleciona o preset
 * e edita do jeito que quer").
 *
 * SEMÂNTICA EXCLUSIVA (decisão do dono via orquestradora): a estratégia
 * escolhida é a ÚNICA que vale — escolher um card desliga os outros. A
 * escrita no config passa por `valorDoPreset` e a leitura do ativo por
 * `presetDoConfig` (contrato único em src/lib/presets-de-frete-gratis.ts;
 * regra escrita em dois lugares diverge — lição #53).
 *
 * Os cards são um grupo de radio de verdade (role="radiogroup" +
 * role="radio" aria-checked): um só pode ficar marcado, como o lojista
 * espera de "escolha uma". A edição do valor do preset "acima de" fica num
 * PAINEL PRÓPRIO fora do card — interactive dentro de button é HTML
 * inválido e quebra leitor de tela (o card é só a escolha; a edição é
 * outra coisa).
 */
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
  const cartaoAtivo =
    "border-emerald-500/50 bg-emerald-500/[0.08] shadow-[0_4px_24px_rgba(16,185,129,0.12)]";
  const cartaoInativo =
    "border-white/10 bg-black/40 hover:border-white/20 hover:bg-black/60";
  const iconeAtivo =
    "border-emerald-500/30 bg-emerald-500/15 text-emerald-300";
  const iconeInativo = "border-white/10 bg-zinc-800/80 text-zinc-400";

  return (
    <section
      id="bloco-frete-gratis"
      aria-label="Frete grátis"
      className="relative scroll-mt-24 overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/40 p-5 shadow-xl backdrop-blur-md sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <Gift className="size-5" strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-white">Frete grátis</h2>
            <p className="mt-0.5 max-w-[26ch] text-[11px] leading-snug text-zinc-400 sm:max-w-none">
              Escolha UMA estratégia — a escolhida é a única que vale.
            </p>
          </div>
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Estratégia de frete grátis"
        className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {/* ── 1. Desligado ── */}
        <button
          type="button"
          role="radio"
          aria-checked={preset === "desligado"}
          disabled={desabilitado}
          onClick={() => onEscolher("desligado")}
          className={`relative flex flex-col gap-2 rounded-2xl border p-4 text-left transition-all duration-300 active:scale-[0.99] disabled:pointer-events-none ${
            preset === "desligado" ? cartaoAtivo : cartaoInativo
          }`}
        >
          <div className="flex items-center justify-between">
            <div
              className={`flex size-8 items-center justify-center rounded-xl border ${
                preset === "desligado" ? iconeAtivo : iconeInativo
              }`}
            >
              <Power className="size-4" strokeWidth={2.2} />
            </div>
            <IndicadorDeSelecao ativo={preset === "desligado"} />
          </div>
          <div>
            <p className="text-xs font-extrabold text-white">Desligado</p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
              Nenhuma regra de frete grátis. A entrega é cobrada como está
              configurado nos blocos acima.
            </p>
          </div>
        </button>

        {/* ── 2. Acima de um valor ── */}
        <button
          type="button"
          role="radio"
          aria-checked={preset === "acima_de_valor"}
          disabled={desabilitado}
          onClick={() => onEscolher("acima_de_valor")}
          className={`relative flex flex-col gap-2 rounded-2xl border p-4 text-left transition-all duration-300 active:scale-[0.99] disabled:pointer-events-none ${
            preset === "acima_de_valor" ? cartaoAtivo : cartaoInativo
          }`}
        >
          <div className="flex items-center justify-between">
            <div
              className={`flex size-8 items-center justify-center rounded-xl border ${
                preset === "acima_de_valor" ? iconeAtivo : iconeInativo
              }`}
            >
              <TrendingUp className="size-4" strokeWidth={2.2} />
            </div>
            <IndicadorDeSelecao ativo={preset === "acima_de_valor"} />
          </div>
          <div>
            <p className="text-xs font-extrabold text-white">
              Grátis acima de um valor
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
              A compra que passa do mínimo sai com a entrega de graça. Você
              escolhe o valor logo abaixo.
            </p>
          </div>
        </button>

        {/* ── 3. Sempre grátis ── */}
        <button
          type="button"
          role="radio"
          aria-checked={preset === "sempre"}
          disabled={desabilitado}
          onClick={() => onEscolher("sempre")}
          className={`relative flex flex-col gap-2 rounded-2xl border p-4 text-left transition-all duration-300 active:scale-[0.99] disabled:pointer-events-none ${
            preset === "sempre" ? cartaoAtivo : cartaoInativo
          }`}
        >
          <div className="flex items-center justify-between">
            <div
              className={`flex size-8 items-center justify-center rounded-xl border ${
                preset === "sempre" ? iconeAtivo : iconeInativo
              }`}
            >
              <InfinityIcon className="size-4" strokeWidth={2.2} />
            </div>
            <IndicadorDeSelecao ativo={preset === "sempre"} />
          </div>
          <div>
            <p className="text-xs font-extrabold text-white">Sempre grátis</p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
              Todo pedido sai com a entrega de graça, sem mínimo — para todo
              cliente.
            </p>
          </div>
        </button>

        {/* ── 4. Por produto marcado ── */}
        <button
          type="button"
          role="radio"
          aria-checked={preset === "por_produto"}
          disabled={desabilitado}
          onClick={() => onEscolher("por_produto")}
          className={`relative flex flex-col gap-2 rounded-2xl border p-4 text-left transition-all duration-300 active:scale-[0.99] disabled:pointer-events-none ${
            preset === "por_produto" ? cartaoAtivo : cartaoInativo
          }`}
        >
          <div className="flex items-center justify-between">
            <div
              className={`flex size-8 items-center justify-center rounded-xl border ${
                preset === "por_produto" ? iconeAtivo : iconeInativo
              }`}
            >
              <Tag className="size-4" strokeWidth={2.2} />
            </div>
            <IndicadorDeSelecao ativo={preset === "por_produto"} />
          </div>
          <div>
            <p className="text-xs font-extrabold text-white">
              Por produto marcado
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
              Só os produtos que você marcar como "frete grátis" no cadastro
              saem sem custo de entrega. Marque em Produtos &gt; editar
              produto.
            </p>
          </div>
        </button>
      </div>

      {/* Painel de edição do valor — só existe quando o preset "acima de"
          está ativo. FORA do card de escolha (interactive dentro de button
          é HTML inválido). */}
      {preset === "acima_de_valor" && (
        <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-black/50 p-4 duration-200 animate-in fade-in">
          <label
            htmlFor="frete-gratis-acima-de"
            className="block text-xs font-bold text-zinc-200"
          >
            Valor mínimo da compra para sair grátis
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-black/60 px-3 py-2">
              <span className="text-xs font-black text-emerald-400">R$</span>
              {/* REVISÃO A7 (frete v2, 03/09): o campo limpo grava 0 — e 0 é
                  "desligado" no contrato de presets —, então salvar com o
                  campo vazio DESLIGAVA o frete grátis sem a pessoa perceber
                  (reabria como "Desligado"). O `min` bloqueia 0/negativo
                  digitado e o aviso abaixo diz a consequência ANTES do salvar. */}
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
                className="w-24 border-0 bg-transparent text-center text-xl font-black text-white placeholder-zinc-600 focus:outline-none focus:ring-0 [&::-webkit-inner-spin-button]:appearance-none"
                disabled={desabilitado}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[50, 100, 150, 200, 250].map((sugestao) => (
                <button
                  key={sugestao}
                  type="button"
                  disabled={desabilitado}
                  onClick={() => onAcimaDe(sugestao)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-all ${
                    acimaDe === sugestao
                      ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                      : "border-white/10 bg-zinc-800/60 text-zinc-400 hover:border-white/20 hover:text-white"
                  }`}
                >
                  R$ {sugestao}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[10.5px] leading-snug text-zinc-500">
            Atenção: valor vazio desliga o frete grátis ao salvar (o mínimo é
            R$ 0,01). Para desligar de propósito, escolha "Desligado" acima.
          </p>
        </div>
      )}
    </section>
  );
});

function IndicadorDeSelecao({ ativo }: { ativo: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
        ativo
          ? "border-emerald-400 bg-emerald-500 text-black"
          : "border-zinc-600 bg-transparent"
      }`}
    >
      {ativo && <Check className="size-3" strokeWidth={3.5} />}
    </span>
  );
}
