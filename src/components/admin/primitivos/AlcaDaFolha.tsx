import { useArrastarParaFechar } from "@/hooks/useArrastarParaFechar";
import { cn } from "@/lib/utils";

/**
 * A barrinha cinza no topo das folhas do painel que sobem de baixo. Era só
 * enfeite (`aria-hidden`, nada acontecia ao tocar ou puxar); agora é a alça de
 * verdade: puxar para baixo arrasta a folha junto e fecha ao soltar além do
 * limite, e um toque simples também fecha — o mesmo gesto das folhas da loja
 * (`useArrastarParaFechar`). Continua invisível para leitor de tela: quem não
 * enxerga fecha pelos botões "Fechar" que cada folha já tem.
 *
 * A área de toque é maior que o risco (32 px de altura): o desenho do risco é
 * o `barra`, dentro dela. `aoFechar` pode recusar (envio em andamento): a
 * folha então volta ao lugar sozinha.
 */
export function AlcaDaFolha({
  aoFechar,
  className,
  barra = "bg-zinc-500",
}: {
  readonly aoFechar: () => void;
  /** Espaçamento e visibilidade (ex.: `sm:hidden` quando vira janela no meio). */
  readonly className?: string;
  /** Cor do risco. */
  readonly barra?: string;
}) {
  const arrasto = useArrastarParaFechar(aoFechar);
  return (
    <div
      role="presentation"
      aria-hidden="true"
      data-testid="folha-alca"
      onPointerDown={arrasto.aoApertar}
      onClick={() => {
        if (!arrasto.engoliuClique()) aoFechar();
      }}
      className={cn(
        "-mt-3 flex h-8 shrink-0 cursor-pointer touch-none items-start justify-center",
        className,
      )}
    >
      <span className={cn("mt-3 h-1 w-10 rounded-full", barra)} />
    </div>
  );
}
