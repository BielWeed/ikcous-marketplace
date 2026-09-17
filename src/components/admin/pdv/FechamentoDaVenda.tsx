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
  CreditCard,
  QrCode,
  ShoppingCart,
  WifiOff,
} from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

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
  // Com uma falha que NÃO convida a tentar de novo (23505: chave já
  // queimada; 42501: sem permissão), reenviar o MESMO clique só repete a
  // mesma recusa — o botão fica desabilitado e a saída passa a ser
  // "Começar uma venda nova" (chave nova) ou entrar de novo na conta.
  const podeTentarDeNovo = ultimaFalha?.podeTentarDeNovo ?? true;
  const desabilitado =
    !validacao.ok || estado.enviando || isOffline || !podeTentarDeNovo;

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
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white">Fechar venda</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => despachar({ tipo: "etapa_pedida", etapa: "cupom" })}
        >
          Voltar ao cupom
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {FORMAS_DE_PAGAMENTO.map(({ valor, rotulo, Icone }) => (
          <button
            key={valor}
            type="button"
            onClick={() =>
              despachar({ tipo: "pagamento_escolhido", pagamento: valor })
            }
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-semibold ${
              estado.pagamento === valor
                ? "border-admin-gold bg-admin-gold text-black"
                : "border-zinc-800 bg-zinc-900 text-zinc-300"
            }`}
          >
            <Icone className="size-5" />
            {rotulo}
          </button>
        ))}
      </div>

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
        className="h-12 text-base font-bold"
      >
        {estado.enviando ? "Registrando…" : "Registrar venda"}
      </Button>
    </div>
  );
}
