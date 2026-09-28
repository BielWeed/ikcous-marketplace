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

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  type AcaoDaVenda,
  type EstadoDaVenda,
  type FormaEscolhidaNoBalcao,
  formaPedeConferencia,
  subtotalDaVenda,
  totalDaVenda,
  trocoDaVenda,
  vendaPodeSerRegistrada,
} from "@/hooks/useVendaPresencial";
import {
  type FalhaDaVendaTraduzida,
  mensagemDaFalhaDaVenda,
} from "@/lib/erro-da-venda-presencial";
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  KeyRound,
  QrCode,
  ShoppingCart,
  WifiOff,
} from "lucide-react";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";

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
  /** PIX com QR (Mercado Pago) ligado nesta loja — sem ele a opção nem
   * aparece (decisão da coordenação, 28/09). */
  readonly pixQrDisponivel?: boolean;
  /** "Gerar PIX": cria a venda à espera do PIX e abre o QR (a VIEW chama a
   * RPC e a edge). Obrigatória quando `pixQrDisponivel`. */
  readonly aoGerarPix?: () => Promise<void>;
  /** `true`/`false` quando a view já sabe se há caixa aberto; `null` quando
   * não sabe (sem aviso nenhum — nunca um palpite). Achado D8. */
  readonly caixaAberto?: boolean | null;
}

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const FORMAS_DE_PAGAMENTO: readonly {
  readonly valor: FormaEscolhidaNoBalcao;
  readonly rotulo: string;
  readonly Icone: typeof Banknote;
}[] = [
  { valor: "cash", rotulo: "Dinheiro", Icone: Banknote },
  { valor: "pix_qr", rotulo: "PIX com QR", Icone: QrCode },
  // D1 (28/09): "PIX na hora" gravava pago no clique, na confiança. O PIX
  // feito direto na chave da loja continua existindo — com o nome do que é e
  // com a conferência obrigatória (B14).
  { valor: "pix", rotulo: "PIX na chave da loja", Icone: KeyRound },
  { valor: "card", rotulo: "Cartão na maquininha", Icone: CreditCard },
];

/** "12,50" / "12.50" / "" → número em reais (ou `null`). */
function lerReais(texto: string): number | null {
  if (texto.trim() === "") return null;
  const valor = Number(texto);
  return Number.isFinite(valor) && valor >= 0 ? valor : null;
}

export function FechamentoDaVenda({
  estado,
  despachar,
  aoRegistrarVenda,
  limparCupom,
  pixQrDisponivel = false,
  aoGerarPix,
  caixaAberto = null,
}: PropsDoFechamentoDaVenda): ReactElement {
  // ⚠️ ARMADILHA DE NOME medida na tarefa: `useOnlineStatus` devolve `true`
  // quando está OFFLINE (`return isOffline`) — a variável se chama
  // `isOffline`, nunca "isOnline", para não ler o `if` ao contrário.
  const isOffline = useOnlineStatus();

  const [descontoStr, setDescontoStr] = useState(
    estado.desconto > 0 ? estado.desconto.toFixed(2) : "",
  );
  const [motivoStr, setMotivoStr] = useState(estado.motivoDoDesconto);
  // Troco (A8): só de TELA — o valor recebido não vai para a RPC nem para o
  // rascunho; o que a loja registra é a venda, não a nota que o cliente deu.
  const [recebidoStr, setRecebidoStr] = useState("");
  const idTitulo = useId();
  const idConferi = useId();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  // A7: ao abrir, a folha do fechamento vem para a vista e o leitor de tela
  // anuncia o título — no celular ela abria ABAIXO do cupom, fora da tela.
  useEffect(() => {
    tituloRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    tituloRef.current?.focus({ preventScroll: true });
  }, []);

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
  // Com uma falha que NÃO convida a tentar de novo (23505: chave já
  // queimada; 42501: sem permissão), reenviar o MESMO clique só repete a
  // mesma recusa — o botão fica desabilitado e a saída passa a ser
  // "Começar uma venda nova" (chave nova) ou entrar de novo na conta.
  const podeTentarDeNovo = ultimaFalha?.podeTentarDeNovo ?? true;
  const ehPixQr = estado.pagamento === "pix_qr";
  const desabilitado =
    !validacao.ok ||
    estado.enviando ||
    isOffline ||
    !podeTentarDeNovo ||
    (ehPixQr && !aoGerarPix);
  const formasVisiveis = FORMAS_DE_PAGAMENTO.filter(
    (f) => f.valor !== "pix_qr" || pixQrDisponivel,
  );
  const recebido = lerReais(recebidoStr);
  const troco =
    estado.pagamento === "cash" ? trocoDaVenda(total, recebido) : null;

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
    // PIX com QR: quem despacha `pix_preparado`/`pix_aberto` é a VIEW (ela
    // precisa da chave do PIX para chamar a RPC); o erro volta para cá do
    // mesmo jeito, traduzido pela mesma régua.
    if (!ehPixQr) despachar({ tipo: "envio_iniciado" });
    try {
      if (ehPixQr && aoGerarPix) await aoGerarPix();
      else await aoRegistrarVenda();
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

  const rotuloDoBotao = estado.enviando
    ? ehPixQr
      ? "Gerando o PIX…"
      : "Registrando…"
    : ehPixQr
      ? `Gerar PIX de R$ ${reais(total)}`
      : "Registrar venda";

  return (
    <section
      aria-labelledby={idTitulo}
      className="flex scroll-mt-4 flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id={idTitulo}
          ref={tituloRef}
          tabIndex={-1}
          className="text-sm font-bold text-white outline-none"
        >
          Fechar venda
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => despachar({ tipo: "etapa_pedida", etapa: "cupom" })}
        >
          Voltar ao cupom
        </Button>
      </div>

      <div
        role="radiogroup"
        aria-label="Forma de pagamento"
        className="grid grid-cols-2 gap-2"
      >
        {formasVisiveis.map(({ valor, rotulo, Icone }) => (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={estado.pagamento === valor}
            onClick={() =>
              despachar({ tipo: "pagamento_escolhido", pagamento: valor })
            }
            className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center text-xs font-semibold ${
              estado.pagamento === valor
                ? "border-admin-gold bg-admin-gold text-black"
                : "border-zinc-800 bg-zinc-900 text-zinc-300"
            }`}
          >
            <Icone aria-hidden="true" className="size-5" />
            {rotulo}
          </button>
        ))}
      </div>

      {ehPixQr && (
        <p className="text-xs text-zinc-400">
          O QR abre aqui na tela para o cliente pagar. A venda só é dada como
          paga quando o Mercado Pago confirmar; até lá o estoque fica reservado
          por 30 minutos.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label
          htmlFor="desconto-da-venda"
          className="text-xs font-semibold text-zinc-400"
        >
          Desconto (R$)
        </label>
        <LocalBufferedInput
          id="desconto-da-venda"
          value={descontoStr}
          mask="currency"
          inputMode="decimal"
          onFlush={(valor) => {
            setDescontoStr(valor);
            atualizarDesconto(valor, motivoStr);
          }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
        />
        {estado.desconto > 0 && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="motivo-do-desconto"
              className="text-xs font-semibold text-zinc-400"
            >
              Motivo do desconto (obrigatório)
            </label>
            <LocalBufferedInput
              id="motivo-do-desconto"
              value={motivoStr}
              onFlush={(valor) => {
                setMotivoStr(valor);
                atualizarDesconto(descontoStr, valor);
              }}
              placeholder="Ex.: cliente fidelidade, mostruário"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-zinc-800 pt-3 text-sm">
        <div className="flex justify-between text-zinc-400">
          <span>Subtotal</span>
          <span>R$ {reais(subtotal)}</span>
        </div>
        {estado.desconto > 0 && (
          <div className="flex justify-between text-zinc-400">
            <span>Desconto</span>
            <span>- R$ {reais(estado.desconto)}</span>
          </div>
        )}
        <div className="flex justify-between text-lg font-bold text-white">
          <span>Total</span>
          <span>R$ {reais(total)}</span>
        </div>
      </div>

      {estado.pagamento === "cash" && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="valor-recebido"
            className="text-xs font-semibold text-zinc-400"
          >
            Valor recebido (R$) — opcional, para o troco
          </label>
          <LocalBufferedInput
            id="valor-recebido"
            value={recebidoStr}
            mask="currency"
            inputMode="decimal"
            delay={150}
            onFlush={setRecebidoStr}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
          />
          <p aria-live="polite" className="text-sm">
            {troco === null ? null : troco >= 0 ? (
              <span className="font-bold text-emerald-400">
                Troco: R$ {reais(troco)}
              </span>
            ) : (
              <span className="font-bold text-amber-400">
                Faltam R$ {reais(-troco)}
              </span>
            )}
          </p>
          {caixaAberto === false && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-800/50 bg-amber-950/30 p-3 text-xs text-amber-200">
              <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />O
              caixa da loja está fechado: esta venda entra no Financeiro, mas
              não na conferência da gaveta. Abra o caixa em Financeiro › Caixa.
            </p>
          )}
        </div>
      )}

      {formaPedeConferencia(estado.pagamento) && (
        <label
          htmlFor={idConferi}
          className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-200"
        >
          <input
            id={idConferi}
            type="checkbox"
            checked={estado.pagamentoConferido}
            onChange={(e) =>
              despachar({
                tipo: "pagamento_conferido",
                conferido: e.target.checked,
              })
            }
            className="mt-0.5 size-5 shrink-0 accent-[var(--admin-gold,#d4a017)]"
          />
          <span>
            {estado.pagamento === "pix"
              ? `Conferi no app do banco: o PIX de R$ ${reais(total)} entrou na conta da loja.`
              : `Conferi o comprovante da maquininha: R$ ${reais(total)} aprovado.`}
          </span>
        </label>
      )}

      {isOffline && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-800/50 bg-red-950/30 p-3 text-xs text-red-200"
        >
          <WifiOff className="size-4 shrink-0" />
          Sem internet agora. O cupom fica salvo aqui; registre a venda quando a
          conexão voltar.
        </p>
      )}

      {!isOffline && !validacao.ok && (
        <p className="flex items-center gap-2 text-xs text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          {validacao.motivo}
        </p>
      )}

      {estado.erro && (
        <p role="alert" className="text-xs text-red-400">
          {estado.erro}
          {ultimaFalha?.precisaEntrarDeNovo &&
            " Saia e entre de novo na conta."}
        </p>
      )}

      {/* Achado "ANTES DE CRESCER" da revisão: sem isto, uma chave já
          queimada (23505) ficava presa para sempre — todo clique em
          "Registrar venda" reenviava a MESMA chave morta e repetia a mesma
          recusa, e não havia botão na tela que girasse a chave (só o "Nova
          venda" do recibo, fora de alcance enquanto não há recibo). */}
      {ultimaFalha && !ultimaFalha.podeTentarDeNovo && (
        <Button
          type="button"
          variant="outline"
          onClick={limparCupom}
          className="h-11"
        >
          <ShoppingCart className="mr-1.5 size-4" />
          Começar uma venda nova
        </Button>
      )}

      <Button
        type="button"
        disabled={desabilitado}
        onClick={aoClicarRegistrar}
        // Cor própria do admin (a mesma do botão Vender): o Button padrão
        // pinta com a cor do TEMA da loja — no tema escuro do molde era
        // preto sobre preto (relato do dono no celular, 19/09).
        className="h-12 bg-admin-gold text-base font-bold text-black hover:bg-admin-gold/90"
      >
        {rotuloDoBotao}
      </Button>
    </section>
  );
}
