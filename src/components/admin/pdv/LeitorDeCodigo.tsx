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
import { Keyboard, RefreshCcw, ScanBarcode, X } from "lucide-react";
import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import "./pdv.css";

export interface PropsDoLeitorDeCodigo {
  readonly aberto: boolean;
  /** Escuta USB/Bluetooth independente da câmera; por padrão segue `aberto`. */
  readonly lerTeclado?: boolean;
  readonly modo?: "continuo" | "unico";
  readonly aoLer: (leitura: Leitura) => void;
  readonly aoFechar?: () => void;
  readonly titulo?: string;
  readonly dica?: string;
}

export function LeitorDeCodigo({
  aberto,
  lerTeclado = aberto,
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
  // `lerTeclado` pode continuar ligado: a pistola independe da câmera.
  const {
    estado,
    erro,
    ultimaLeitura,
    refDoVideo,
    tentarDeNovo,
    lerCodigoDigitado,
  } = useLeitorDeCodigo({ ativo: aberto, modo, aoLer, lerTeclado });

  if (!aberto) {
    return null;
  }

  function aoSubmeterCodigoManual(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault();
    lerCodigoDigitado(valorManual);
    setValorManual("");
  }

  return (
    <div className="pdv-stack">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="pdv-heading">
            <ScanBarcode aria-hidden="true" className="pdv-icon pdv-cyan" />
            {titulo}
          </h2>
        </div>
        {aoFechar && (
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={aoFechar}
          >
            <X aria-hidden="true" className="pdv-blue size-5" />
            Fechar
          </Button>
        )}
      </div>

      <div className="pdv-reader-preview">
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
          className="pointer-events-none absolute inset-x-8 inset-y-4 rounded-xl border border-sky-300/60"
        />

        {estado === "preparando" && (
          <div role="status" className="pdv-reader-overlay">
            Abrindo a câmera…
          </div>
        )}

        {estado === "pausado" && (
          <div role="status" className="pdv-reader-overlay">
            Leitura pausada
          </div>
        )}
      </div>
      <p className="pdv-muted">{dica}</p>
      {estado === "erro" && erro && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">Não foi possível abrir a câmera</p>
          <p>{erro.mensagem}</p>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={tentarDeNovo}
          >
            <RefreshCcw aria-hidden="true" className="pdv-blue size-5" />
            Tentar de novo
          </Button>
        </div>
      )}

      {/* A região existe SEMPRE que o componente está aberto — criada
          junto com o texto que ela vai anunciar não é anunciada (padrão da
          casa: src/components/ui/custom/QuantitySelector.tsx:51,
          src/components/admin/orders/EstornoCard.tsx:334). */}
      <div aria-live="polite" className="pdv-muted">
        {ultimaLeitura ? `Código lido: ${ultimaLeitura.codigo}` : ""}
      </div>

      {mostrarCampoManual ? (
        <form onSubmit={aoSubmeterCodigoManual} className="pdv-stack">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="codigo-de-barras-manual" className="pdv-muted">
              Código de barras
            </label>
            <input
              id="codigo-de-barras-manual"
              inputMode="numeric"
              autoComplete="off"
              value={valorManual}
              onChange={(evento) => setValorManual(evento.target.value)}
              className="pdv-field"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            className="pdv-secondary pdv-confirm"
          >
            <ScanBarcode aria-hidden="true" className="pdv-cyan size-5" />
            Usar este código
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="pdv-secondary"
          onClick={() => setMostrarCampoManual(true)}
        >
          <Keyboard aria-hidden="true" className="pdv-purple size-5" />
          Digitar o código
        </Button>
      )}
    </div>
  );
}
