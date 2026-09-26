// Folha do leitor de código de barras do balcão (tarefa C2.3, plano seção
// 5.3 item 1). Componente BURRO de propósito: nenhum `history.pushState`,
// nenhum `onSetBackOverride`/`onSetDirty` (isso é da tela de C3), nenhum
// Supabase, nenhum toast de negócio — quem abre este componente é dono do
// resto. Ele só sabe mostrar a câmera, o estado do `useLeitorDeCodigo` e um
// campo manual, e devolver a leitura crua por `aoLer`.
//
// src/components/admin/pdv/ é pasta NOVA — hoje src/components/admin/ tem
// dashboard, orders, settings, shipping, users.

import { Button } from "@/components/ui/button";
import { useLeitorDeCodigo } from "@/hooks/useLeitorDeCodigo";
import type { Leitura } from "@/lib/leitor/decodificador";
import type { FormEvent, ReactElement } from "react";
import { useState } from "react";

export interface PropsDoLeitorDeCodigo {
  readonly aberto: boolean;
  readonly modo?: "continuo" | "unico";
  readonly aoLer: (leitura: Leitura) => void;
  readonly aoFechar: () => void;
  readonly titulo?: string;
  readonly dica?: string;
}

export function LeitorDeCodigo({
  aberto,
  modo,
  aoLer,
  aoFechar,
  titulo = "Ler código de barras",
  dica = "Aponte a câmera para o código de barras do produto",
}: PropsDoLeitorDeCodigo): ReactElement | null {
  const [mostrarCampoManual, setMostrarCampoManual] = useState(false);
  const [valorManual, setValorManual] = useState("");

  // O hook é chamado SEMPRE (regra dos Hooks) — `ativo: aberto` é quem
  // decide se a câmera liga. Quando `aberto` é `false`, o componente
  // devolve `null` mais abaixo e a câmera é solta pelo próprio hook.
  const {
    estado,
    erro,
    ultimaLeitura,
    refDoVideo,
    tentarDeNovo,
    lerCodigoDigitado,
  } = useLeitorDeCodigo({ ativo: aberto, modo, aoLer, lerTeclado: aberto });

  if (!aberto) {
    return null;
  }

  function aoSubmeterCodigoManual(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault();
    lerCodigoDigitado(valorManual);
    setValorManual("");
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-white">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white">{titulo}</h2>
          <p className="text-xs text-zinc-400">{dica}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={aoFechar}>
          Fechar
        </Button>
      </div>

      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video
          ref={refDoVideo}
          muted
          playsInline
          autoPlay
          className="size-full object-cover"
        />

        {/* Moldura decorativa — não é informação, só ajuda a mirar o código. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70"
        />

        {estado === "preparando" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
            Abrindo a câmera…
          </div>
        )}

        {estado === "pausado" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
            Leitura pausada
          </div>
        )}

        {estado === "erro" && erro && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-4 text-center text-sm text-white"
          >
            <p>{erro.mensagem}</p>
            <Button
              type="button"
              size="sm"
              className="bg-admin-gold text-black hover:bg-admin-gold/90"
              onClick={tentarDeNovo}
            >
              Tentar de novo
            </Button>
          </div>
        )}
      </div>

      {/* A região existe SEMPRE que o componente está aberto — criada
          junto com o texto que ela vai anunciar não é anunciada (padrão da
          casa: src/components/ui/custom/QuantitySelector.tsx:51,
          src/components/admin/orders/EstornoCard.tsx:334). */}
      <div aria-live="polite" className="text-xs font-semibold text-zinc-300">
        {ultimaLeitura ? `Código lido: ${ultimaLeitura.codigo}` : ""}
      </div>

      {mostrarCampoManual ? (
        <form
          onSubmit={aoSubmeterCodigoManual}
          className="flex items-end gap-2"
        >
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor="codigo-de-barras-manual"
              className="text-xs font-semibold text-zinc-400"
            >
              Código de barras
            </label>
            <input
              id="codigo-de-barras-manual"
              inputMode="numeric"
              autoComplete="off"
              value={valorManual}
              onChange={(evento) => setValorManual(evento.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            className="bg-admin-gold text-black hover:bg-admin-gold/90"
          >
            Usar este código
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMostrarCampoManual(true)}
        >
          Digitar o código
        </Button>
      )}
    </div>
  );
}
