import { cn } from "@/lib/utils";
import { useCallback, useState } from "react";

interface AvisoDeAtualizacaoDiscretoProps {
  readonly show: boolean;
  readonly onUpdate: () => void;
  readonly onSnooze: () => void;
}

/**
 * O aviso de versão nova para a CLIENTE: uma linha só, colada em cima da
 * navegação inferior, sem fundo escuro, sem desfoque e sem animação.
 *
 * Antes a cliente via o mesmo cartão do painel (backdrop preto com desfoque,
 * foguete âmbar, "melhorias de desempenho") por cima da vitrine inteira. Quem
 * está comprando não precisa de um muro para saber que existe versão nova — o
 * painel do lojista segue com o cartão (`UpdateNotification`).
 *
 * Não é diálogo: `role="status"` anuncia sem roubar o foco, e nada fica
 * bloqueado atrás dele. Quem decide em que telas ele nasce é o
 * `PWAUpdateGate` (nunca no carrinho, no checkout, no login, na confirmação
 * do pedido nem na página do produto, onde a barra de compra já ocupa o fundo).
 */
export function AvisoDeAtualizacaoDiscreto({
  show,
  onUpdate,
  onSnooze,
}: AvisoDeAtualizacaoDiscretoProps) {
  const [atualizando, setAtualizando] = useState(false);

  const aoAtualizar = useCallback(() => {
    setAtualizando(true);
    onUpdate();
  }, [onUpdate]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "bottom-docked-navigation fixed inset-x-3 z-[100] mx-auto max-w-md",
        "flex items-center gap-2 rounded-xl border border-border bg-background",
        "px-3 py-1 text-xs text-foreground shadow-sm",
        "md:bottom-[104px]",
      )}
    >
      <p className="min-w-0 flex-1 truncate">
        {atualizando ? "Atualizando..." : "Há uma versão nova do app."}
      </p>
      {!atualizando && (
        <>
          <button
            type="button"
            onClick={aoAtualizar}
            className="min-h-10 shrink-0 cursor-pointer rounded-lg px-2 text-xs font-semibold text-foreground underline underline-offset-2"
          >
            Atualizar
          </button>
          <button
            type="button"
            onClick={onSnooze}
            className="min-h-10 shrink-0 cursor-pointer rounded-lg px-2 text-xs text-muted-foreground"
          >
            Depois
          </button>
        </>
      )}
    </div>
  );
}
