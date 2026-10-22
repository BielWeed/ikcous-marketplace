import { Check } from "lucide-react";
import { type ReactNode, useId } from "react";

/**
 * Uma chave de liga/desliga do formulário de produto: a LINHA inteira é o
 * botão (alvo de toque grande), com o nome em cima e a explicação embaixo.
 *
 * Ligado = neutro e forte (trilho na cor do texto do painel + um "visto" no
 * pino), nunca uma cor de marca: o estado não depende só da cor. As cores
 * moram em `formulario-produto.css` (`.produto-interruptor*`), com os tokens
 * `admin-*` dos três temas.
 */
export function InterruptorDoProduto({
  rotulo,
  descricao,
  ligado,
  onAlternar,
  desabilitado,
  children,
}: {
  /** Também é o nome acessível da chave. */
  readonly rotulo: string;
  readonly descricao: string;
  readonly ligado: boolean;
  readonly onAlternar: () => void;
  readonly desabilitado?: boolean;
  /** Algo que aparece logo abaixo da linha (aviso, código gerado…). */
  readonly children?: ReactNode;
}) {
  const idDaDescricao = useId();
  return (
    <div className="produto-interruptor">
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        aria-describedby={idDaDescricao}
        disabled={desabilitado}
        onClick={onAlternar}
        className="produto-interruptor-botao"
      >
        <span className="produto-interruptor-texto">
          <span className="produto-interruptor-titulo">{rotulo}</span>
          <span id={idDaDescricao} className="produto-interruptor-descricao">
            {descricao}
          </span>
        </span>
        <span aria-hidden="true" className="produto-interruptor-trilho">
          <span className="produto-interruptor-pino">
            {ligado ? <Check className="size-3.5" strokeWidth={3} /> : null}
          </span>
        </span>
      </button>
      {children}
    </div>
  );
}
