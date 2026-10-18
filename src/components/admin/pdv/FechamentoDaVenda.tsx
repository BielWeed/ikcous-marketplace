// Seção "fechamento" do caixa (tarefa C3.2, plano §5.3, decisões D3 e D4).
// Forma de pagamento, desconto EM REAIS com motivo obrigatório, o resumo da
// conta e o botão "Registrar venda".
//
// Este arquivo NÃO chama Supabase: `aoRegistrarVenda` é injetada pela VIEW.
// Em C3.2 ela era um DUBLÊ que sempre recusava; C3.4 trocou a implementação
// em `AdminPdvView` para a chamada de verdade de `registrar_venda_presencial`,
// sem mexer nesta seção — só o CATCH abaixo, que agora traduz o erro.
//
// `vendaPodeSerRegistrada`/`subtotalDaVenda`/`totalDaVenda` vêm de
// `useVendaPresencial` (C3.1) — a MESMA conta que o hook usa, para não haver
// duas contas divergentes (regra da própria tarefa C3.1).
//
// PASSO "Conferi o pagamento no app do banco" (decisão do dono, 08/10/2026,
// defeito D1 da investigação do balcão): PIX combinado e cartão na maquininha
// gravavam a venda como PAGA no clique, sem ninguém olhar se o dinheiro tinha
// entrado. Agora o botão só habilita depois da caixinha. É trava de TELA, não
// fato da venda: mora em estado local, não vai ao rascunho nem ao servidor.

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  type AcaoDaVenda,
  type EstadoDaVenda,
  type FormaDePagamentoDoBalcao,
  subtotalDaVenda,
  totalDaVenda,
  vendaPodeSerRegistrada,
} from "@/hooks/useVendaPresencial";
import {
  type FalhaDaVendaTraduzida,
  mensagemDaFalhaDaVenda,
} from "@/lib/erro-da-venda-presencial";
import {
  AlertTriangle,
  Banknote,
  Check,
  ChevronLeft,
  CreditCard,
  LockKeyhole,
  QrCode,
  ShoppingCart,
  Wallet,
  WifiOff,
} from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import "./pdv.css";

export interface PropsDoFechamentoDaVenda {
  readonly estado: EstadoDaVenda;
  readonly despachar: (acao: AcaoDaVenda) => void;
  readonly aoRegistrarVenda: () => Promise<void>;
  /** `useVendaPresencial().limparCupom` — gira a chave de idempotência E
   * apaga o rascunho. É o botão "Começar uma venda nova" abaixo (achado
   * "ANTES DE CRESCER" da revisão): quando `podeTentarDeNovo` é `false`
   * (chave já queimada em 23505, ou 42501), reenviar a MESMA chave só repete
   * a mesma recusa — a única saída é uma venda nova, com chave nova. */
  readonly limparCupom: () => void;
}

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const FORMAS_DE_PAGAMENTO: readonly {
  readonly valor: FormaDePagamentoDoBalcao;
  readonly rotulo: string;
  readonly Icone: typeof Banknote;
}[] = [
  { valor: "cash", rotulo: "Dinheiro", Icone: Banknote },
  { valor: "pix", rotulo: "PIX na hora", Icone: QrCode },
  { valor: "card", rotulo: "Cartão na maquininha", Icone: CreditCard },
];

// Só as formas em que o dinheiro NÃO passa pela mão da loja precisam da
// conferência: o dinheiro vivo se confere ao contar a nota.
const FORMAS_QUE_PEDEM_CONFERENCIA: readonly FormaDePagamentoDoBalcao[] = [
  "pix",
  "card",
];

const ROTULO_DA_CONFERENCIA = "Conferi o pagamento no app do banco";

export function FechamentoDaVenda({
  estado,
  despachar,
  aoRegistrarVenda,
  limparCupom,
}: PropsDoFechamentoDaVenda): ReactElement {
  // ⚠️ ARMADILHA DE NOME medida na tarefa: `useOnlineStatus` devolve `true`
  // quando está OFFLINE (`return isOffline`) — a variável se chama
  // `isOffline`, nunca "isOnline", para não ler o `if` ao contrário.
  const isOffline = useOnlineStatus();

  const [descontoStr, setDescontoStr] = useState(
    estado.desconto > 0 ? estado.desconto.toFixed(2) : "",
  );
  const [motivoStr, setMotivoStr] = useState(estado.motivoDoDesconto);

  // A ÚLTIMA falha traduzida (mensagem + `podeTentarDeNovo`) — achado "ANTES
  // DE CRESCER" da revisão: `podeTentarDeNovo` era calculado por
  // `mensagemDaFalhaDaVenda` e nunca lido em lugar nenhum. Fica em estado
  // LOCAL (não no reducer) porque é decisão de TELA sobre o que oferecer a
  // seguir, não fato da venda — `estado.erro` (o reducer) continua sendo só
  // a frase a mostrar.
  const [ultimaFalha, setUltimaFalha] = useState<FalhaDaVendaTraduzida | null>(
    null,
  );
  // Qualquer mudança de verdade no cupom (forma de pagamento, desconto,
  // motivo) invalida a última falha: é o balconista tentando de outro jeito,
  // não martelando o mesmo clique — por isso o botão volta a ficar
  // disponível sem precisar sair da tela e voltar.
  useEffect(() => {
    setUltimaFalha(null);
  }, [estado.pagamento, estado.desconto, estado.motivoDoDesconto]);

  const subtotal = subtotalDaVenda(estado.itens);
  const total = totalDaVenda(estado);
  const validacao = vendaPodeSerRegistrada(estado);

  // A conferência vale para UMA forma e UM total (o que foi conferido no app
  // foi aquele valor, por aquela forma). Guarda o par, e só conta como
  // marcada enquanto os dois ainda forem os da hora da marcação — assim
  // nunca existe um render em que a marca velha destrava o botão. O efeito
  // abaixo apaga o par ao mudar, para que VOLTAR à forma (ou ao total)
  // anterior não ressuscite a marca.
  const [conferido, setConferido] = useState<{
    readonly pagamento: FormaDePagamentoDoBalcao;
    readonly total: number;
  } | null>(null);
  useEffect(() => {
    setConferido(null);
  }, [estado.pagamento, total]);
  const pedeConferencia =
    estado.pagamento !== null &&
    FORMAS_QUE_PEDEM_CONFERENCIA.includes(estado.pagamento);
  const conferiu =
    conferido !== null &&
    conferido.pagamento === estado.pagamento &&
    conferido.total === total;
  // Com uma falha que NÃO convida a tentar de novo (23505: chave já
  // queimada; 42501: sem permissão), reenviar o MESMO clique só repete a
  // mesma recusa — o botão fica desabilitado e a saída passa a ser
  // "Começar uma venda nova" (chave nova) ou entrar de novo na conta.
  const podeTentarDeNovo = ultimaFalha?.podeTentarDeNovo ?? true;
  const faltaConferir = pedeConferencia && !conferiu;
  const desabilitado =
    !validacao.ok ||
    estado.enviando ||
    isOffline ||
    !podeTentarDeNovo ||
    faltaConferir;

  function atualizarDesconto(descontoTexto: string, motivo: string): void {
    const valor = descontoTexto.trim() === "" ? 0 : Number(descontoTexto);
    despachar({
      tipo: "desconto_alterado",
      valor: Number.isFinite(valor) ? valor : 0,
      motivo,
    });
  }

  async function aoClicarRegistrar(): Promise<void> {
    if (desabilitado) return;
    despachar({ tipo: "envio_iniciado" });
    try {
      await aoRegistrarVenda();
    } catch (erro) {
      // Rede caindo, 22023/23505/42501/PGRST202 do servidor — D3 é
      // explícita: RECUSAR, nunca enfileirar. O cupom (e o rascunho) ficam
      // intactos: só o `enviando`/`erro` mudam. `mensagemDaFalhaDaVenda`
      // (C3.4) é o ÚNICO lugar que traduz `erro` para português — nunca
      // `erro.message` cru aqui, que vazaria `DOMException`/stack na tela.
      const falha = mensagemDaFalhaDaVenda(erro);
      setUltimaFalha(falha);
      despachar({ tipo: "envio_falhou", mensagem: falha.mensagem });
    }
  }

  return (
    <section className="pdv-layer" aria-label="Cobrança da venda">
      <div className="pdv-layer-heading">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary size-11 shrink-0"
            aria-label="Voltar ao cupom"
            onClick={() => despachar({ tipo: "etapa_pedida", etapa: "cupom" })}
          >
            <ChevronLeft aria-hidden="true" className="pdv-blue size-5" />
            <span className="sr-only">Voltar ao cupom</span>
          </Button>
          <div>
            <h2>Fechar venda</h2>
            <p className="pdv-muted">2 · Cobrança</p>
          </div>
        </div>
      </div>

      {isOffline && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">
            <WifiOff aria-hidden="true" className="pdv-icon pdv-red" />
            Sem internet. Cupom salvo.
          </p>
          <p className="pdv-muted">
            Sem internet agora. O cupom fica salvo aqui; registre a venda quando
            a conexão voltar.
          </p>
        </div>
      )}

      <div className="pdv-discount">
        <div className="pdv-card">
          <label htmlFor="desconto-da-venda" className="pdv-muted">
            Desconto (R$)
          </label>
          <LocalBufferedInput
            id="desconto-da-venda"
            disabled={estado.enviando}
            value={descontoStr}
            mask="currency"
            onFlush={(valor) => {
              setDescontoStr(valor);
              atualizarDesconto(valor, motivoStr);
            }}
            className="pdv-field"
          />
          <p className="pdv-muted mt-2">Até R$ {reais(subtotal)}</p>
        </div>
        {estado.desconto > 0 && (
          <div className="pdv-card">
            <label htmlFor="motivo-do-desconto" className="pdv-muted">
              Motivo do desconto (obrigatório)
            </label>
            <LocalBufferedInput
              id="motivo-do-desconto"
              maxLength={2000}
              disabled={estado.enviando}
              value={motivoStr}
              onFlush={(valor) => {
                setMotivoStr(valor);
                atualizarDesconto(descontoStr, valor);
              }}
              placeholder="Ex.: cliente fidelidade, mostruário"
              className="pdv-field"
            />
            <p className="pdv-muted mt-2 flex items-center gap-1">
              <LockKeyhole aria-hidden="true" className="pdv-pink size-4" />
              Privado · {motivoStr.length}/2.000
            </p>
          </div>
        )}
      </div>

      <div className="pdv-stack">
        <h3 className="pdv-heading">
          <Wallet aria-hidden="true" className="pdv-icon pdv-teal" />
          Forma de pagamento
        </h3>
        <div className="pdv-payment-grid">
          {FORMAS_DE_PAGAMENTO.map(({ valor, rotulo, Icone }) => (
            <button
              key={valor}
              type="button"
              disabled={estado.enviando}
              aria-pressed={estado.pagamento === valor}
              onClick={() =>
                despachar({ tipo: "pagamento_escolhido", pagamento: valor })
              }
              className="pdv-payment"
            >
              <Icone
                aria-hidden="true"
                className={`pdv-icon ${valor === "cash" ? "pdv-green" : valor === "pix" ? "pdv-teal" : "pdv-purple"}`}
              />
              <span>{rotulo}</span>
            </button>
          ))}
        </div>
      </div>

      {pedeConferencia && estado.pagamento !== null && (
        <div className="pdv-stack">
          <div className="pdv-check">
            <input
              id="conferi-o-pagamento"
              type="checkbox"
              checked={conferiu}
              aria-describedby="conferi-o-pagamento-ajuda"
              onChange={(e) =>
                setConferido(
                  e.target.checked && estado.pagamento !== null
                    ? { pagamento: estado.pagamento, total }
                    : null,
                )
              }
            />
            <label htmlFor="conferi-o-pagamento">{ROTULO_DA_CONFERENCIA}</label>
          </div>
          <p id="conferi-o-pagamento-ajuda" className="pdv-muted">
            {estado.pagamento === "pix"
              ? "Abra o app do banco e veja o PIX de R$ "
              : "Abra o app do banco ou da maquininha e veja o pagamento de R$ "}
            {reais(total)} entrar antes de registrar.
          </p>
        </div>
      )}
      {!isOffline && !validacao.ok && (
        <p className="pdv-muted flex items-center gap-2">
          <AlertTriangle
            aria-hidden="true"
            className="pdv-orange size-4 shrink-0"
          />
          {validacao.motivo}
        </p>
      )}
      {!isOffline && validacao.ok && faltaConferir && (
        <p className="pdv-muted flex items-center gap-2">
          <AlertTriangle
            aria-hidden="true"
            className="pdv-orange size-4 shrink-0"
          />
          Marque &quot;{ROTULO_DA_CONFERENCIA}&quot; para registrar.
        </p>
      )}
      {estado.erro && (
        <div role="alert" className="pdv-notice">
          <p className="pdv-heading">
            <AlertTriangle aria-hidden="true" className="pdv-icon pdv-red" />
            Não foi possível registrar a venda
          </p>
          <p className="pdv-muted">
            {estado.erro}
            {ultimaFalha?.precisaEntrarDeNovo &&
              " Saia e entre de novo na conta."}
          </p>
        </div>
      )}
      {ultimaFalha && !ultimaFalha.podeTentarDeNovo && (
        <Button
          type="button"
          variant="outline"
          onClick={limparCupom}
          className="pdv-secondary"
        >
          <ShoppingCart aria-hidden="true" className="pdv-purple size-5" />
          Começar uma venda nova
        </Button>
      )}
      <AcaoDaBarra aria-label="Registrar a venda">
        <div className="pdv-footer">
          <div className="pdv-total pdv-muted">
            <span>Subtotal</span>
            <span>R$ {reais(subtotal)}</span>
          </div>
          {estado.desconto > 0 && (
            <div className="pdv-total pdv-muted">
              <span>Desconto</span>
              <span>- R$ {reais(estado.desconto)}</span>
            </div>
          )}
          <div className="pdv-total">
            <span className="pdv-muted">
              {estado.desconto > 0 ? "Total com desconto" : "Total"}
            </span>
            <strong>R$ {reais(total)}</strong>
          </div>
          <Button
            type="button"
            disabled={desabilitado}
            onClick={aoClicarRegistrar}
            className="pdv-primary admin-barra-principal bg-admin-gold text-black"
          >
            {desabilitado ? (
              <LockKeyhole aria-hidden="true" className="size-5" />
            ) : (
              <Check aria-hidden="true" className="size-5" />
            )}
            {estado.enviando ? "Registrando…" : "Registrar venda"}
          </Button>
          {isOffline && (
            <p className="pdv-muted">
              Indisponível enquanto estiver sem internet.
            </p>
          )}
        </div>
      </AcaoDaBarra>
    </section>
  );
}
