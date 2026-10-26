import { SecaoRecolhivel } from "@/components/admin/primitivos/SecaoRecolhivel";
import type { ComponentProps } from "react";

/**
 * Só a moldura: uma linha baixa, título em negrito e a seta à direita
 * (abertura, preservação dos campos e foco continuam no primitivo). O resumo,
 * com a linha fechada, segue o título na mesma linha — ver `formulario-produto.css`.
 */
export function SecaoDoProduto({
  aviso,
  ...props
}: ComponentProps<typeof SecaoRecolhivel> & {
  readonly aviso?: string;
}) {
  return (
    <div
      className={`produto-secao relative ${aviso ? "produto-secao-aviso" : ""}`}
    >
      <SecaoRecolhivel {...props} resumo={aviso || props.resumo} />
    </div>
  );
}
