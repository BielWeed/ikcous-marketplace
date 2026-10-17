import { SecaoRecolhivel } from "@/components/admin/primitivos/SecaoRecolhivel";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

/** Só a moldura: abertura, preservação dos campos e foco continuam no primitivo. */
export function SecaoDoProduto({
  icone: Icone,
  cor,
  aviso,
  ...props
}: ComponentProps<typeof SecaoRecolhivel> & {
  readonly icone: LucideIcon;
  readonly cor: string;
  readonly aviso?: string;
}) {
  return (
    <div
      className={`produto-secao relative ${aviso ? "produto-secao-aviso" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-3 top-4 flex size-9 items-center justify-center rounded-xl border ${cor}`}
      >
        <Icone className="size-5" />
      </span>
      <SecaoRecolhivel {...props} resumo={aviso || props.resumo} />
    </div>
  );
}
