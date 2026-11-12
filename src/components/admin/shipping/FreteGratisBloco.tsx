import { GrupoDeOpcoes } from "@/components/admin/GrupoDeOpcoes";
import { CabecaDeSecao } from "@/components/admin/shipping/primitivas-direcao-d";
import { parseValorBR } from "@/lib/financeiro";
import type { PresetFreteGratis } from "@/lib/presets-de-frete-gratis";
import { memo, useEffect, useState } from "react";

/**
 * O valor é digitado como TEXTO: o campo `type="number"` devolvia vazio ao
 * Safari do iPhone para o que ele não entendia como número ("99,90"), e vazio
 * virava 0 — o campo apagava o que ela escreveu e pedia o valor de novo. Aqui
 * "99,90", "99.90" e "1.234,50" valem (helper de moeda do app); vazio é 0 (a
 * tela pede o valor); o que não é dinheiro vira NaN — o pai recusa o Salvar em
 * vez de gravar 0.
 */
function valorDoTexto(texto: string): number {
  if (texto.trim() === "") return 0;
  return parseValorBR(texto) ?? Number.NaN;
}

function textoDoValor(valor: number): string {
  if (!Number.isFinite(valor) || valor === 0) return "";
  return Number.isInteger(valor)
    ? String(valor)
    : valor.toFixed(2).replace(".", ",");
}

/** Os valores continuam em presets-de-frete-gratis; aqui só se escolhe. */
const PRESETS: readonly {
  readonly id: PresetFreteGratis;
  readonly nome: string;
  readonly desc: string;
}[] = [
  {
    id: "desligado",
    nome: "Não dar frete grátis",
    desc: "O cliente paga o valor da entrega.",
  },
  {
    id: "acima_de_valor",
    nome: "Grátis acima de um valor",
    desc: "Pedidos a partir do valor não pagam a entrega.",
  },
  {
    id: "sempre",
    nome: "Sempre grátis",
    desc: "Nenhum pedido paga a entrega.",
  },
  {
    id: "por_produto",
    nome: "Só produtos marcados",
    desc: "Grátis quando o carrinho tem um produto marcado com “frete grátis” no cadastro.",
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
  mostrarCabecalho = true,
}: {
  readonly preset: PresetFreteGratis;
  /** Valor do preset "acima de" (só faz sentido com o preset ativo dele). */
  readonly acimaDe: number;
  readonly onEscolher: (preset: PresetFreteGratis) => void;
  readonly onAcimaDe: (valor: number) => void;
  readonly desabilitado?: boolean;
  /** `false` quando um `PainelRecolhivel` externo já mostra o título e o
   * estado (tela de Frete unificada, 23/09/2026) — evita cabeçalho em
   * dobro. Default `true` preserva o uso isolado (e os testes). */
  readonly mostrarCabecalho?: boolean;
}) {
  // O que está escrito no campo. Só é reescrito quando o valor muda POR FORA
  // (config chegou, salvou) e o texto já não o produz — "99," digitado não vira
  // "99" sob o dedo.
  const [texto, setTexto] = useState(() => textoDoValor(acimaDe));
  useEffect(() => {
    setTexto((atual) =>
      Object.is(valorDoTexto(atual), acimaDe) ? atual : textoDoValor(acimaDe),
    );
  }, [acimaDe]);
  const textoInvalido = Number.isNaN(valorDoTexto(texto));
  const semValor = acimaDe <= 0 || textoInvalido;

  return (
    <section
      id="bloco-frete-local-estrategias"
      aria-label="Estratégias do frete local"
      className="scroll-mt-24"
    >
      {mostrarCabecalho && (
        <CabecaDeSecao
          titulo="Estratégias do frete local"
          estado={
            <>
              estratégia:{" "}
              <b className="font-semibold text-zinc-200">
                {ESTRATEGIA.get(preset)}
              </b>
            </>
          }
        />
      )}
      <p className="pt-3.5 text-[12.5px] leading-snug text-zinc-500">
        Vale para a sua entrega e para a retirada na loja.
      </p>

      <GrupoDeOpcoes
        aria-label="Estratégia de frete local"
        className="flex flex-col gap-2.5 py-5 "
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
              className={`flex min-h-11 items-start gap-2.5 rounded-xl border px-4 py-3 text-left transition-colors duration-200 disabled:pointer-events-none disabled:opacity-50 ${
                ativo
                  ? "border-admin-accent/70 bg-admin-accent/10"
                  : "border-admin-border hover:border-white/25"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-black ${
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
                    ativo ? "text-zinc-400" : "text-zinc-500"
                  }`}
                >
                  {p.desc}
                </span>
              </span>
            </button>
          );
        })}
      </GrupoDeOpcoes>

      {preset === "acima_de_valor" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-admin-border pb-1 pt-4 duration-200 animate-in fade-in">
          <label
            htmlFor="frete-gratis-acima-de"
            className="w-full text-xs font-bold text-zinc-300"
          >
            A partir de
          </label>
          <div
            className={`flex min-h-12 items-center gap-1.5 rounded-xl border bg-admin-raised px-4 py-2 ${semValor ? "border-red-400" : "border-admin-border"}`}
          >
            <span className="text-xs font-semibold text-zinc-500">R$</span>
            <input
              aria-invalid={semValor}
              aria-describedby={semValor ? "erro-gratis-local" : undefined}
              id="frete-gratis-acima-de"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                onAcimaDe(valorDoTexto(e.target.value));
              }}
              placeholder="100"
              disabled={desabilitado}
              className="w-24 bg-transparent text-center text-xl font-bold tabular-nums text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-0 disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          {semValor && (
            <p
              id="erro-gratis-local"
              role="alert"
              className="w-full text-[12.5px] leading-snug text-red-300"
            >
              {textoInvalido
                ? "Escreva o valor em reais, como 99,90."
                : "Escreva o valor. Para não dar frete grátis, escolha a primeira opção."}
            </p>
          )}
        </div>
      )}
    </section>
  );
});
