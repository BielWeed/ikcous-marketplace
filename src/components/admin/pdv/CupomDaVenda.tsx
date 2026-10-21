// Seção "cupom" do caixa (tarefa C3.2, plano §5.3). É a camada DE BASE da
// tela — sempre visível enquanto a etapa não é "recibo" — e também é quem
// desenha a folha de "qual combinação?" (etapa "escolha_de_variacao"),
// porque a máquina de C3.1 trata a folha como um dado do CUPOM
// (`estado.escolhaDeVariacao`), não como uma seção separada.
//
// REGRA DE OURO (contexto da tarefa): este arquivo NÃO chama Supabase. Quem
// resolve um código de barras é a VIEW (`AdminPdvView`). A busca manual fica
// no painel de `BuscaDeProduto`; ambos usam as mesmas guardas da máquina
// (useVendaPresencial.ts).

import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { Button } from "@/components/ui/button";
import type { AcaoDaVenda, EstadoDaVenda } from "@/hooks/useVendaPresencial";
import {
  type FeedbackDoLeitor,
  criarFeedbackDoLeitor,
} from "@/lib/feedback-do-leitor";
import type { View } from "@/types";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  LockKeyhole,
  Minus,
  PackagePlus,
  PackageX,
  Plus,
  ShoppingCart,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import "./pdv.css";

export interface PropsDoCupomDaVenda {
  readonly estado: EstadoDaVenda;
  readonly despachar: (acao: AcaoDaVenda) => void;
  readonly subtotal: number;
  readonly onNavigate: (view: View) => void;
  /** `useVendaPresencial().limparCupom`: volta o caixa ao zero (itens,
   * desconto, cliente, forma de pagamento e rascunho). Ausente = sem o botão
   * "Cancelar venda" (testes que montam só a lista). */
  readonly limparCupom?: () => void;
  /** Injeção de teste — padrão `criarFeedbackDoLeitor()`. `null` desliga
   * bip/vibração (mesmo padrão de `useLeitorDeCodigo`, opções). */
  readonly feedback?: FeedbackDoLeitor | null;
  /** Injeção de teste do relógio — padrão `Date.now`. */
  readonly agora?: () => number;
}

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function CupomDaVenda({
  estado,
  despachar,
  subtotal,
  onNavigate,
  limparCupom,
  feedback: feedbackProp,
  agora = () => Date.now(),
}: PropsDoCupomDaVenda): ReactElement {
  // O AudioContext NASCE PREGUIÇOSO dentro de `criarFeedbackDoLeitor` — não
  // tem custo criar a instância aqui mesmo sem gesto do usuário ainda.
  // Injeção de teste no molde de `useLeitorDeCodigo`: `feedback === null`
  // desliga de propósito; `undefined` cai no padrão de verdade.
  const [feedback] = useState<FeedbackDoLeitor | null>(() =>
    feedbackProp === null ? null : (feedbackProp ?? criarFeedbackDoLeitor()),
  );
  useEffect(() => {
    return () => {
      feedback?.encerrar();
    };
  }, [feedback]);

  // O leitor (C2) não conhece produto, preço nem estoque — os TRÊS avisos
  // que ele não sabe dar ("não cadastrado", "inativo", "esgotado") são desta
  // tela (divergências da tarefa). `estado.aviso` é um objeto NOVO a cada
  // vez que o reducer acende um aviso (mesmo tipo repetido inclui), então a
  // lista de dependências `[estado.aviso]` dispara de novo mesmo para dois
  // avisos iguais em seguida.
  useEffect(() => {
    if (!estado.aviso) return;
    if (
      estado.aviso.tipo === "nao_cadastrado" ||
      estado.aviso.tipo === "inativo" ||
      estado.aviso.tipo === "esgotado"
    ) {
      feedback?.recusar();
    }
  }, [estado.aviso, feedback]);

  const escolha = estado.escolhaDeVariacao;

  // "Cancelar venda": só há o que cancelar quando o cupom guarda ALGUMA coisa
  // da venda (item, desconto, cliente ou forma de pagamento — os dois últimos
  // sobreviviam à desistência e iam para a venda seguinte).
  const temVendaParaCancelar =
    estado.itens.length > 0 ||
    estado.desconto > 0 ||
    estado.cliente.tipo !== "sem_cliente" ||
    estado.pagamento !== null;
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  // O cupom esvaziou por outro caminho (tirou o último item, por exemplo)
  // com a pergunta aberta: ela some junto — senão voltaria sozinha na venda
  // seguinte, perguntando por uma venda que não existe mais.
  // O mesmo vale se a venda começa a ser GRAVADA com a pergunta aberta
  // (foi a "Fechar venda" e "Registrar venda"): o "Sim" zeraria a tela com a
  // venda no ar.
  if (confirmandoCancelamento && (!temVendaParaCancelar || estado.enviando)) {
    setConfirmandoCancelamento(false);
  }
  // O foco cai no "Voltar": o gesto automático de quem toca duas vezes por
  // reflexo não pode apagar a venda — a ação padrão é a segura.
  const voltarDoCancelamentoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmandoCancelamento) voltarDoCancelamentoRef.current?.focus();
  }, [confirmandoCancelamento]);

  return (
    <div className="pdv-flow" data-etapa={estado.etapa}>
      {escolha && (
        <section className="pdv-card pdv-stack" aria-label="Escolher variação">
          <h3 className="pdv-heading">
            <PackagePlus aria-hidden="true" className="pdv-icon pdv-pink" />
            Escolher variação
          </h3>
          <p className="font-bold">
            Qual combinação de "{escolha.produtoNome}"?
          </p>
          {escolha.opcoes.map((opcao) => (
            <button
              key={opcao.variant_id}
              type="button"
              disabled={opcao.estoque <= 0}
              onClick={() =>
                despachar({ tipo: "variacao_escolhida", opcao, em: agora() })
              }
              className="pdv-result"
            >
              <span>
                <strong>
                  {opcao.nome} {opcao.valor}
                </strong>
                <span className="pdv-muted">
                  {opcao.estoque <= 0
                    ? "Esgotado"
                    : `R$ ${reais(opcao.preco)} · ${opcao.estoque} em estoque`}
                </span>
              </span>
              <Plus aria-hidden="true" className="pdv-icon pdv-teal" />
            </button>
          ))}
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => despachar({ tipo: "variacao_cancelada" })}
          >
            Cancelar
          </Button>
        </section>
      )}

      {estado.aviso?.tipo === "nao_cadastrado" && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">
            <AlertTriangle aria-hidden="true" className="pdv-icon pdv-orange" />
            Código não encontrado
          </p>
          <p className="pdv-muted">
            Código {estado.aviso.codigo} não está cadastrado. Confira o código
            ou cadastre o produto.
          </p>
          <p className="pdv-muted">
            O atalho abaixo só abre o cadastro — digitar o código lá é manual
            por enquanto.
          </p>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => onNavigate("admin-product-form")}
          >
            <PackagePlus aria-hidden="true" className="pdv-cyan size-5" />
            Cadastrar produto
          </Button>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => despachar({ tipo: "aviso_limpo" })}
          >
            Fechar
          </Button>
        </div>
      )}
      {estado.aviso?.tipo === "inativo" && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">
            <AlertTriangle aria-hidden="true" className="pdv-icon pdv-muted" />
            Produto inativo
          </p>
          <p className="pdv-muted">
            "{estado.aviso.nome}" está inativo no catálogo. Não foi adicionado à
            venda.
          </p>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => despachar({ tipo: "aviso_limpo" })}
          >
            Fechar
          </Button>
        </div>
      )}
      {estado.aviso?.tipo === "esgotado" && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">
            <PackageX aria-hidden="true" className="pdv-icon pdv-red" />
            Produto esgotado
          </p>
          <p className="pdv-muted">
            "{estado.aviso.nome}" está esgotado. Nenhuma unidade adicionada.
          </p>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary"
            onClick={() => despachar({ tipo: "aviso_limpo" })}
          >
            Fechar
          </Button>
        </div>
      )}
      {estado.aviso?.tipo === "ignorado_repetido" && (
        <div role="status" className="pdv-notice">
          <p className="pdv-heading">
            <AlertTriangle aria-hidden="true" className="pdv-icon pdv-orange" />
            Leitura repetida
          </p>
          <p className="pdv-muted">
            Já bipei o código {estado.aviso.codigo} há pouco — bipe de novo se
            for mesmo outra unidade.
          </p>
        </div>
      )}

      <section
        className="pdv-cupom pdv-stack"
        aria-label="Itens da venda"
        data-resumo={
          estado.etapa === "cliente" || estado.etapa === "fechamento"
        }
      >
        <div className="pdv-heading">
          <ShoppingCart aria-hidden="true" className="pdv-icon pdv-purple" />
          <h3 className="flex-1">Venda atual</h3>
          <span className="pdv-muted">
            {estado.itens.length} {estado.itens.length === 1 ? "item" : "itens"}
          </span>
          {(estado.etapa === "cliente" || estado.etapa === "fechamento") && (
            <strong className="text-sm">R$ {reais(subtotal)}</strong>
          )}
        </div>
        {estado.itens.length === 0 ? (
          <div className="pdv-card pdv-stack pdv-empty">
            <p className="pdv-heading">Bipe o primeiro produto</p>
            <p className="pdv-muted">Nenhum item na venda ainda.</p>
          </div>
        ) : (
          <ul>
            {estado.itens.map((item) => {
              const destacado = estado.ultimaEntrada?.chave === item.chave;
              return (
                <li
                  key={item.chave}
                  data-destacado={destacado ? "true" : "false"}
                  className="pdv-item"
                >
                  {item.imagem ? (
                    <img
                      src={item.imagem}
                      alt={item.nome}
                      className="pdv-item-image"
                    />
                  ) : (
                    <div className="pdv-item-image flex items-center justify-center bg-violet-400/15">
                      <PackagePlus
                        aria-hidden="true"
                        className="pdv-purple size-5"
                      />
                    </div>
                  )}
                  <div className="pdv-item-info">
                    <strong>
                      <span className="pdv-resumo-qtd">
                        {item.quantidade} ×{" "}
                      </span>
                      {item.nome}
                    </strong>
                    {item.variacao && (
                      <span className="pdv-muted">{item.variacao} · </span>
                    )}
                    <span className="pdv-muted pdv-unit-price">
                      R$ {reais(item.preco)} / un.
                    </span>
                  </div>
                  <div className="pdv-item-controls">
                    {destacado && (
                      <span className="pdv-added">
                        <Check aria-hidden="true" className="inline size-3" />{" "}
                        Adicionado
                      </span>
                    )}
                    <div className="pdv-quantity">
                      <button
                        type="button"
                        aria-label={`Diminuir quantidade de ${item.nome}`}
                        disabled={estado.enviando}
                        onClick={() =>
                          despachar({
                            tipo: "quantidade_alterada",
                            chave: item.chave,
                            delta: -1,
                          })
                        }
                        className="pdv-touch"
                      >
                        <Minus aria-hidden="true" className="size-5" />
                      </button>
                      <span>{item.quantidade}</span>
                      <button
                        type="button"
                        aria-label={`Aumentar quantidade de ${item.nome}`}
                        disabled={
                          estado.enviando || item.quantidade >= item.estoque
                        }
                        onClick={() =>
                          despachar({
                            tipo: "quantidade_alterada",
                            chave: item.chave,
                            delta: 1,
                          })
                        }
                        className="pdv-touch pdv-teal"
                      >
                        <Plus aria-hidden="true" className="size-5" />
                      </button>
                    </div>
                    <span className="pdv-line-total">
                      R$ {reais(item.preco * item.quantidade)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remover ${item.nome} da venda`}
                      disabled={estado.enviando}
                      onClick={() =>
                        despachar({ tipo: "item_removido", chave: item.chave })
                      }
                      className="pdv-touch pdv-pink"
                    >
                      <Trash2 aria-hidden="true" className="size-5" />
                    </button>
                    {item.quantidade >= item.estoque && (
                      <p className="pdv-muted pdv-stock-limit w-full">
                        Limite do estoque · {item.estoque} un.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="pdv-actions">
        <Button
          type="button"
          variant="outline"
          className="pdv-secondary"
          onClick={() => despachar({ tipo: "etapa_pedida", etapa: "cliente" })}
        >
          <UserRound aria-hidden="true" className="pdv-blue size-5" />
          {estado.cliente.tipo === "sem_cliente"
            ? "Cliente (opcional)"
            : `Cliente: ${estado.cliente.nome}`}
        </Button>
        {limparCupom && temVendaParaCancelar && !confirmandoCancelamento && (
          <Button
            type="button"
            variant="outline"
            disabled={estado.enviando}
            className="pdv-secondary"
            onClick={() => setConfirmandoCancelamento(true)}
          >
            <XCircle aria-hidden="true" className="pdv-red size-5" />
            Cancelar venda
          </Button>
        )}
      </div>
      {limparCupom && temVendaParaCancelar && confirmandoCancelamento && (
        <div role="group" aria-label="Cancelar venda" className="pdv-notice">
          <p className="pdv-heading">
            <XCircle aria-hidden="true" className="pdv-icon pdv-red" />
            Cancelar venda
          </p>
          <p className="text-xl font-bold">Descartar esta venda?</p>
          <p className="pdv-muted">
            Os itens e o cliente escolhido serão limpos, e o caixa volta ao
            começo.{" "}
            {estado.erro
              ? "Se a venda chegou a ser gravada, ela está em Pedidos."
              : "Nada é registrado."}
          </p>
          <div className="pdv-annul-actions">
            <Button
              ref={voltarDoCancelamentoRef}
              type="button"
              variant="outline"
              className="pdv-secondary"
              onClick={() => setConfirmandoCancelamento(false)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              disabled={estado.enviando}
              className="pdv-danger"
              onClick={() => {
                setConfirmandoCancelamento(false);
                limparCupom();
              }}
            >
              Sim, cancelar venda
            </Button>
          </div>
        </div>
      )}
      <AcaoDaBarra
        ativa={estado.etapa !== "fechamento"}
        aria-label="Fechamento da venda"
      >
        <div className="pdv-footer">
          <div className="pdv-total">
            <span className="pdv-muted">Subtotal</span>
            <strong>R$ {reais(subtotal)}</strong>
          </div>
          <Button
            type="button"
            className="pdv-primary admin-barra-principal bg-admin-gold text-black"
            disabled={estado.itens.length === 0}
            onClick={() =>
              despachar({ tipo: "etapa_pedida", etapa: "fechamento" })
            }
          >
            {estado.itens.length === 0 ? (
              <LockKeyhole aria-hidden="true" className="size-5" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-5" />
            )}
            Fechar venda{estado.itens.length > 0 && ` · R$ ${reais(subtotal)}`}
          </Button>
          {estado.itens.length === 0 && (
            <p className="pdv-muted">
              Indisponível: adicione pelo menos um item.
            </p>
          )}
        </div>
      </AcaoDaBarra>
    </div>
  );
}
