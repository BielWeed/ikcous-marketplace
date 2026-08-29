import type { AcaoDeRecusa, RecusaDoPedido } from "@/lib/recusaDoPedido";
import { AlertTriangle, X } from "lucide-react";

/**
 * O painel que aparece quando o banco recusa o pedido no último clique.
 *
 * POR QUE ELE EXISTE: até 28/08/2026, as 11 recusas de
 * `create_marketplace_order_v23/v24` terminavam todas no mesmo lugar —
 * `CheckoutView.tsx` fazia `toast.error(...)` e acabou. O toast some sozinho e
 * não leva a lugar nenhum: a pessoa fica parada no último clique, com o dinheiro
 * na mão e sem saber o que fazer, e a loja perde a venda sem ficar sabendo.
 *
 * Este painel é a AÇÃO. O toast continua existindo e é o AVISO, para quem não
 * está olhando esta parte da tela — trocar um pelo outro trocaria um defeito por
 * outro.
 *
 * 🔴 A REGRA QUE NÃO É ESTÉTICA: `conferir_antes` NUNCA oferece "tentar de
 * novo". Esse é o caso em que não se sabe se o pedido nasceu — e repetir um
 * pedido que já existe debita estoque duas vezes e queima cupom de uso único.
 * Ali a saída é olhar os próprios pedidos primeiro. Está preso por teste.
 */

/**
 * Rótulo por ação, em TABELA e não em cadeia de `if`.
 *
 * `Record<AcaoDeRecusa, string>` é o que garante a exaustividade: no dia em que
 * `AcaoDeRecusa` ganhar um caso novo, isto aqui **para de compilar** em vez de
 * cair num `default` silencioso sem botão — que é exatamente o beco que este
 * componente existe para fechar.
 */
const ROTULO_DA_ACAO: Record<AcaoDeRecusa, string> = {
  reconferir_carrinho: "Atualizar o carrinho",
  recotar_frete: "Calcular o frete de novo",
  ajustar_estoque: "Deixar a quantidade disponível",
  remover_item: "Tirar do carrinho",
  escolher_variacao: "Escolher a opção",
  trocar_endereco: "Escolher outro endereço",
  trocar_entrega: "Ver outras formas de entrega",
  remover_cupom: "Tirar o cupom",
  tentar_de_novo: "Tentar de novo",
  conferir_antes: "Ver meus pedidos",
};

/**
 * O mesmo conteúdo como `Map`, gerado a partir do `Record` acima — não é uma
 * segunda fonte, é a mesma. Existe porque o `eslint-plugin-security` não
 * distingue um `Record` exaustivo de um dicionário arbitrário e acusa
 * `detect-object-injection` em toda indexação dinâmica, enquanto `Map.get` não
 * é indexação para ele. Mesmo padrão de `OrderStatusBadge.tsx` e
 * `CustomerPaymentBadge.tsx`.
 *
 * A exaustividade continua vindo do `Record`: o dia em que `AcaoDeRecusa`
 * ganhar um caso novo, é lá que para de compilar.
 */
const ROTULO_POR_ACAO = new Map(
  Object.entries(ROTULO_DA_ACAO) as [AcaoDeRecusa, string][],
);

interface SaidaDaRecusaProps {
  readonly recusa: RecusaDoPedido;
  readonly onAgir: (acao: AcaoDeRecusa) => void;
  readonly onFechar: () => void;
}

export function SaidaDaRecusa({
  recusa,
  onAgir,
  onFechar,
}: SaidaDaRecusaProps) {
  const { acao, mensagem, produto, disponivel } = recusa;

  // O detalhe do estoque só aparece quando o banco informou os dois: nome e
  // quantidade. Com `disponivel` ausente, escrever "ainda há undefined" seria
  // pior que não escrever nada.
  const detalheDoEstoque =
    acao === "ajustar_estoque" && produto && typeof disponivel === "number"
      ? `Ainda há ${disponivel} de "${produto}" disponível.`
      : null;

  return (
    <div
      role="alert"
      className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-5 shrink-0 text-amber-500"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-200">
            Não deu para fechar o pedido
          </p>

          {/*
            A frase do banco aparece LITERAL. Ela já está em português e é a
            única coisa na tela que explica o que houve — reescrevê-la aqui
            criaria um segundo texto para a mesma falha, que é o defeito que a
            revisão de 28/08 achou entre este caminho e o toast.
          */}
          <p className="mt-1 break-words text-sm text-amber-100/90">
            {mensagem}
          </p>

          {detalheDoEstoque && (
            <p className="mt-1 text-sm font-medium text-amber-100">
              {detalheDoEstoque}
            </p>
          )}

          <div className="mt-3">
            <button
              type="button"
              data-acao={acao}
              onClick={() => onAgir(acao)}
              className="inline-flex items-center justify-center rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              {ROTULO_POR_ACAO.get(acao)}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar o aviso"
          className="shrink-0 rounded p-1 text-amber-200/70 transition-colors hover:text-amber-100"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
