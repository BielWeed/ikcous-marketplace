import { Button } from "@/components/ui/button";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Acoes {
  /** Pede o pedaço de novo e volta a desenhá-lo no lugar do aviso. */
  readonly tentarDeNovo: () => void;
}

interface Props {
  readonly children: ReactNode;
  /** Os pedaços carregados sob demanda (`lazyRetentavel`) que este limite
   * protege: em "tentar de novo", cada um é pedido outra vez. Sem lista, só
   * se desenha de novo (serve a falha de desenho, não a de download). */
  readonly pedacos?: readonly { readonly tentarDeNovo: () => void }[];
  /** O que aparece no lugar do pedaço que falhou. Padrão: aviso curto do
   * painel com "Tentar de novo". */
  readonly fallback?: (acoes: Acoes) => ReactNode;
  /** Para pedaço que abre POR CIMA da tela (folha, leitor): o aviso padrão
   * ganha "Fechar", senão quem abriu ficaria preso atrás dele. */
  readonly aoFechar?: () => void;
  /** Quando este valor muda com o pedaço já falhado, tenta de novo sozinho
   * (ex.: a cliente tocou no link outra vez). */
  readonly resetKey?: unknown;
}

interface State {
  readonly hasError: boolean;
}

function AvisoPadrao({
  tentarDeNovo,
  aoFechar,
}: Acoes & { readonly aoFechar?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl border border-admin-border bg-admin-surface p-4 text-center"
    >
      <p className="max-w-xs text-sm leading-relaxed text-zinc-300">
        Esta parte não abriu. O resto da tela continua como estava.
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={tentarDeNovo}
        className="min-h-11 rounded-xl px-6 font-bold"
      >
        Tentar de novo
      </Button>
      {aoFechar && (
        <Button
          type="button"
          variant="ghost"
          onClick={aoFechar}
          className="min-h-11 rounded-xl px-6 font-bold"
        >
          Fechar
        </Button>
      )}
    </div>
  );
}

/**
 * Limite de erro de UM pedaço carregado sob demanda (folha, leitor, seção).
 *
 * Por que existe ao lado do `LocalErrorBoundary`: aquele é tela cheia
 * (ocupa o lugar de uma tela inteira, com recarga da página). Para um pedaço
 * pequeno — uma folha que abre por cima, uma seção de Configurações — a falha
 * de download não pode apagar o resto: o formulário sujo, o cadastro digitado
 * e a compra em andamento ficam exatamente como estavam, e só o pedaço que
 * não veio mostra um aviso curto. Nunca recarrega a página.
 */
export class LimiteDePedaco extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[LimiteDePedaco] pedaço não abriu:", error, info);
  }

  public componentDidUpdate(anterior: Props) {
    if (this.state.hasError && anterior.resetKey !== this.props.resetKey) {
      this.tentarDeNovo();
    }
  }

  private readonly tentarDeNovo = () => {
    for (const pedaco of this.props.pedacos ?? []) pedaco.tentarDeNovo();
    this.setState({ hasError: false });
  };

  public render() {
    if (!this.state.hasError) return this.props.children;
    const acoes: Acoes = { tentarDeNovo: this.tentarDeNovo };
    return this.props.fallback ? (
      this.props.fallback(acoes)
    ) : (
      <AvisoPadrao {...acoes} aoFechar={this.props.aoFechar} />
    );
  }
}
