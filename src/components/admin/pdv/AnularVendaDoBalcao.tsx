// "Anular venda do balcão" — só no mesmo dia e com motivo obrigatório (decisão
// do dono, 08/10/2026). Quem decide de verdade é a RPC `anular_venda_presencial`
// (migration 20261204000000): esta peça só pergunta, pede o motivo, chama
// `aoAnular` e conta o que aconteceu. Usada no recibo da tela Vender e na
// ficha do pedido.
//
// Não chama Supabase: o chamador entrega `aoAnular` (hook
// `useAnularVendaDoBalcao`). A confirmação é um passo à parte: o primeiro
// botão só ABRE a pergunta ("Anular esta venda de R$ X?" com o que acontece);
// a venda só é anulada no segundo, "Confirmar anulação", com o motivo escrito.

import { Button } from "@/components/ui/button";
import type { ResultadoDaAnulacao } from "@/hooks/useAnularVendaDoBalcao";
import {
  FRASE_MOTIVO_OBRIGATORIO,
  MOTIVO_MAXIMO_DA_ANULACAO,
  mensagemDaFalhaDaAnulacao,
  motivoTemTexto,
  orientacaoDeDevolucao,
} from "@/lib/anulacao-do-balcao";
import { formatCurrency } from "@/lib/utils";
import { Ban, CheckCircle2 } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import "./pdv.css";

interface PropsDoAnularVendaDoBalcao {
  readonly total: number;
  /** `cash` | `pix` | `card`: decide a frase de "como devolver". */
  readonly forma: string;
  /** Venda ligada a uma conta de cliente: ela pode ver o motivo no app. */
  readonly clienteComConta?: boolean;
  /** Chama a RPC; lança o erro CRU em caso de recusa (a tela traduz). */
  readonly aoAnular: (motivo: string) => Promise<ResultadoDaAnulacao>;
  readonly aoConcluir?: (resultado: ResultadoDaAnulacao) => void;
}

export function AnularVendaDoBalcao({
  total,
  forma,
  clienteComConta = false,
  aoAnular,
  aoConcluir,
}: PropsDoAnularVendaDoBalcao): ReactElement {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDaAnulacao | null>(null);
  // O estado `enviando` só vale no próximo render: dois cliques rápidos
  // passariam os dois. O ref fecha a porta no mesmo instante.
  const emVoo = useRef(false);
  const idMotivo = useId();
  // Foco: ao abrir a pergunta o botão some e o foco cairia no corpo da página;
  // vai para o campo do motivo e, ao fechar, volta para o botão.
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  useEffect(() => {
    if (aberto) {
      campoRef.current?.focus();
    } else if (devolverFoco.current) {
      devolverFoco.current = false;
      botaoRef.current?.focus();
    }
  }, [aberto]);

  if (resultado) {
    return (
      <p role="status" className="pdv-notice">
        <CheckCircle2 aria-hidden="true" className="pdv-icon pdv-green" />
        {resultado.jaAnulada ? (
          <span>
            Esta venda já estava anulada. Nada foi mexido de novo. O app não
            devolve o dinheiro. {orientacaoDeDevolucao(forma, total, true)}
          </span>
        ) : (
          <span>
            Venda anulada: o estoque voltou e o Financeiro já descontou. O app
            não devolve o dinheiro. {orientacaoDeDevolucao(forma, total)}
          </span>
        )}
      </p>
    );
  }

  if (!aberto) {
    return (
      <Button
        ref={botaoRef}
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        className="pdv-secondary pdv-annul-trigger"
      >
        <Ban aria-hidden="true" className="pdv-red size-5" />
        Anular venda
      </Button>
    );
  }

  function fechar(): void {
    devolverFoco.current = true;
    setAberto(false);
    setErro(null);
  }

  // Esc fecha a pergunta, menos com a anulação em andamento (ela segue).
  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>): void {
    if (evento.key === "Escape" && !emVoo.current) {
      evento.stopPropagation();
      fechar();
    }
  }

  async function confirmar(): Promise<void> {
    const texto = motivo.trim();
    if (texto === "" || emVoo.current) return;
    // Só invisíveis (ex.: espaço de largura zero) não é motivo; o banco também recusa.
    if (!motivoTemTexto(texto)) {
      setErro(FRASE_MOTIVO_OBRIGATORIO);
      return;
    }
    emVoo.current = true;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await aoAnular(texto);
      setResultado(resposta);
      aoConcluir?.(resposta);
    } catch (e) {
      setErro(mensagemDaFalhaDaAnulacao(e, clienteComConta));
    } finally {
      emVoo.current = false;
      setEnviando(false);
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- o Esc vem da bolha das teclas do campo e dos botões filhos; o grupo em si não é um controle.
    <div
      role="group"
      aria-label="Anular venda"
      onKeyDown={aoTeclar}
      className="pdv-notice"
    >
      <p className="pdv-heading">
        <Ban aria-hidden="true" className="pdv-icon pdv-red" />
        Anular venda
      </p>
      <p className="text-xl font-bold">
        Anular esta venda de {formatCurrency(total)}?
      </p>
      <p className="pdv-muted">
        Só vale no mesmo dia. O estoque volta e o Financeiro e o caixa descontam
        o valor. O app não devolve o dinheiro ao cliente: isso você faz na mão.
        Use para engano no caixa ou desistência na hora.
      </p>
      <label htmlFor={idMotivo} className="pdv-muted">
        Motivo (obrigatório)
      </label>
      <textarea
        ref={campoRef}
        id={idMotivo}
        value={motivo}
        maxLength={MOTIVO_MAXIMO_DA_ANULACAO}
        rows={2}
        disabled={enviando}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: forma de pagamento errada, cliente desistiu"
        className="pdv-field"
      />
      <p className="pdv-muted">
        {motivo.length}/500 caracteres · obrigatório para anular
      </p>
      {clienteComConta && (
        <p className="pdv-muted">
          Esta venda está na conta de um cliente: ele pode ler o motivo no
          histórico do pedido. Escreva algo que possa ser lido por ele.
        </p>
      )}
      {erro && (
        <p role="alert" className="text-xs text-red-400">
          {erro}
        </p>
      )}
      <div className="pdv-annul-actions">
        <Button
          type="button"
          variant="outline"
          className="pdv-secondary"
          disabled={enviando}
          onClick={fechar}
        >
          Voltar
        </Button>
        <Button
          type="button"
          className="pdv-danger"
          disabled={motivo.trim() === "" || enviando}
          onClick={() => void confirmar()}
        >
          {enviando ? "Anulando…" : "Confirmar anulação"}
        </Button>
      </div>
      <p className="pdv-muted">Esc também fecha esta confirmação.</p>
    </div>
  );
}
