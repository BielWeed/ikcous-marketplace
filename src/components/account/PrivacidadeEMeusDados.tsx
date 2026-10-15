import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TEXTOS_DA_CLIENTE,
  fraseDecisaoDaLoja,
  frasePedidoEnviado,
} from "@/config/textos-de-privacidade";
import { usePedidosDePrivacidade } from "@/hooks/usePedidosDePrivacidade";
import {
  type FalhaDoPedido,
  type PedidoDePrivacidade,
  type TipoDoPedidoDePrivacidade,
  formatarDataDoPedido,
  ultimoPedidoDoTipo,
  validarEmailNovo,
} from "@/lib/pedidos-de-privacidade";
import { Loader2, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

// ⚠️ Os TEXTOS desta área moram em src/config/textos-de-privacidade.ts e
// PRECISAM de revisão do dono (e de quem entende de LGPD) antes de valerem
// como definitivos.

const TEXTO_DA_FALHA: Record<FalhaDoPedido, string> = {
  ja_existe: TEXTOS_DA_CLIENTE.falhaJaExiste,
  sem_sessao: TEXTOS_DA_CLIENTE.falhaSemSessao,
  sem_rede: TEXTOS_DA_CLIENTE.falhaDeRede,
  outra: TEXTOS_DA_CLIENTE.falhaGenerica,
};

const TEXTO_DO_ERRO_DO_EMAIL = {
  vazio: TEXTOS_DA_CLIENTE.emailVazio,
  formato: TEXTOS_DA_CLIENTE.emailInvalido,
  igual: TEXTOS_DA_CLIENTE.emailIgual,
} as const;

type Dialogo = TipoDoPedidoDePrivacidade | null;

/**
 * Estado de UM tipo de pedido, como a cliente vê: esperando resposta (com a data
 * e o prazo), respondido (com a resposta da loja) ou nada ainda.
 */
function SituacaoDoPedido({ pedido }: { pedido: PedidoDePrivacidade | null }) {
  if (!pedido) return null;
  const data = formatarDataDoPedido(
    pedido.situacao === "aberto" ? pedido.criado_em : pedido.atendido_em,
  );
  if (pedido.situacao === "aberto") {
    return (
      <div
        role="status"
        className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
      >
        <p className="font-semibold">{frasePedidoEnviado(data)}</p>
        {pedido.email_novo && (
          <p>
            E-mail pedido:{" "}
            <span className="break-all">{pedido.email_novo}</span>
          </p>
        )}
      </div>
    );
  }
  return (
    <div
      role="status"
      className="space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800"
    >
      <p className="font-semibold">
        {fraseDecisaoDaLoja(pedido.situacao, data)}
      </p>
      {pedido.observacao && (
        <p>
          Resposta da loja:{" "}
          <span className="whitespace-pre-line">{pedido.observacao}</span>
        </p>
      )}
    </div>
  );
}

interface PrivacidadeEMeusDadosProps {
  readonly userId: string;
  /** O e-mail de entrada de hoje (para recusar "corrigir" para o mesmo e-mail). */
  readonly emailAtual: string;
}

export function PrivacidadeEMeusDados({
  userId,
  emailAtual,
}: PrivacidadeEMeusDadosProps) {
  const { carga, pedidos, enviando, recarregar, pedir } =
    usePedidosDePrivacidade(userId);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [emailDigitado, setEmailDigitado] = useState("");
  const [erroDoEmail, setErroDoEmail] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const campoDoEmail = useRef<HTMLInputElement>(null);

  const pedidoDeExclusao = ultimoPedidoDoTipo(pedidos, "excluir_conta");
  const pedidoDeEmail = ultimoPedidoDoTipo(pedidos, "corrigir_email");
  const pronta = carga === "pronta";
  const ocupada = enviando !== null;

  // Pode pedir de novo se nunca pediu, ou se o último foi recusado. Pedido
  // aberto já espera resposta; exclusão atendida encerra a conta.
  const podePedirExclusao =
    pronta &&
    (pedidoDeExclusao === null || pedidoDeExclusao.situacao === "recusado");
  const podePedirEmail =
    pronta && (pedidoDeEmail === null || pedidoDeEmail.situacao !== "aberto");

  function abrir(tipo: TipoDoPedidoDePrivacidade) {
    setFalha(null);
    setErroDoEmail(null);
    setEmailDigitado("");
    setDialogo(tipo);
  }

  function fechar() {
    if (ocupada) return;
    setDialogo(null);
    setFalha(null);
    setErroDoEmail(null);
  }

  async function confirmarExclusao() {
    setFalha(null);
    const resultado = await pedir("excluir_conta");
    if (resultado.ok) {
      setDialogo(null);
      return;
    }
    setFalha(TEXTO_DA_FALHA[resultado.falha]);
    // Já havia um aberto: a lista foi relida e a tela já o mostra.
    if (resultado.falha === "ja_existe") setDialogo(null);
  }

  async function confirmarEmail() {
    setFalha(null);
    const conferido = validarEmailNovo(emailDigitado, emailAtual);
    if (!conferido.ok) {
      setErroDoEmail(TEXTO_DO_ERRO_DO_EMAIL[conferido.motivo]);
      campoDoEmail.current?.focus();
      return;
    }
    setErroDoEmail(null);
    const resultado = await pedir("corrigir_email", conferido.email);
    if (resultado.ok) {
      setDialogo(null);
      return;
    }
    setFalha(TEXTO_DA_FALHA[resultado.falha]);
    if (resultado.falha === "ja_existe") setDialogo(null);
  }

  return (
    <section
      aria-labelledby="privacidade-titulo"
      className="space-y-4 rounded-2xl border border-zinc-200/50 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 shadow-sm">
          <ShieldCheck className="size-4 text-white" aria-hidden="true" />
        </div>
        <h2
          id="privacidade-titulo"
          className="text-base font-bold text-zinc-900"
        >
          {TEXTOS_DA_CLIENTE.titulo}
        </h2>
      </div>

      <p className="text-sm text-zinc-700">{TEXTOS_DA_CLIENTE.abertura}</p>

      <div className="space-y-3 text-sm text-zinc-700">
        <div>
          <h3 className="font-semibold text-zinc-900">
            {TEXTOS_DA_CLIENTE.guardaTitulo}
          </h3>
          <p>{TEXTOS_DA_CLIENTE.guarda}</p>
        </div>
        <div>
          <h3 className="font-semibold text-zinc-900">
            {TEXTOS_DA_CLIENTE.apagaTitulo}
          </h3>
          <ul className="list-disc pl-5">
            {TEXTOS_DA_CLIENTE.apaga.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-zinc-900">
            {TEXTOS_DA_CLIENTE.ficaTitulo}
          </h3>
          <p>{TEXTOS_DA_CLIENTE.fica}</p>
        </div>
        <p className="font-semibold text-zinc-900">{TEXTOS_DA_CLIENTE.prazo}</p>
      </div>

      {carga === "carregando" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-zinc-600"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {TEXTOS_DA_CLIENTE.carregando}
        </p>
      )}

      {carga === "erro" && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <p className="font-semibold">{TEXTOS_DA_CLIENTE.falhaAoCarregar}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void recarregar()}
            className="min-h-11 rounded-xl"
          >
            {TEXTOS_DA_CLIENTE.recarregar}
          </Button>
        </div>
      )}

      {falha && dialogo === null && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"
        >
          {falha}
        </p>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <SituacaoDoPedido pedido={pedidoDeEmail} />
          {podePedirEmail && (
            <Button
              type="button"
              variant="outline"
              disabled={ocupada}
              onClick={() => abrir("corrigir_email")}
              className="min-h-11 w-full rounded-xl"
            >
              <Mail aria-hidden="true" />
              {TEXTOS_DA_CLIENTE.botaoCorrigirEmail}
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <SituacaoDoPedido pedido={pedidoDeExclusao} />
          {podePedirExclusao && (
            <Button
              type="button"
              variant="outline"
              disabled={ocupada}
              onClick={() => abrir("excluir_conta")}
              className="min-h-11 w-full rounded-xl border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            >
              <Trash2 aria-hidden="true" />
              {TEXTOS_DA_CLIENTE.botaoExcluir}
            </Button>
          )}
        </div>
      </div>

      <AlertDialog
        open={dialogo === "excluir_conta"}
        onOpenChange={(aberto) => {
          if (!aberto) fechar();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {TEXTOS_DA_CLIENTE.confirmaExcluirTitulo}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {TEXTOS_DA_CLIENTE.confirmaExcluirTexto}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {falha && (
            <p role="alert" className="text-sm font-semibold text-red-700">
              {falha}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupada} className="min-h-11">
              {TEXTOS_DA_CLIENTE.confirmaVoltar}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={ocupada}
              className="min-h-11"
              onClick={(evento) => {
                // O diálogo só fecha quando o pedido foi gravado (ou já existia).
                evento.preventDefault();
                void confirmarExclusao();
              }}
            >
              {enviando === "excluir_conta"
                ? TEXTOS_DA_CLIENTE.enviando
                : TEXTOS_DA_CLIENTE.confirmaExcluirAcao}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialogo === "corrigir_email"}
        onOpenChange={(aberto) => {
          if (!aberto) fechar();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {TEXTOS_DA_CLIENTE.confirmaEmailTitulo}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {TEXTOS_DA_CLIENTE.confirmaEmailTexto}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <label
              htmlFor="privacidade-email-novo"
              className="text-sm font-semibold text-zinc-900"
            >
              {TEXTOS_DA_CLIENTE.campoEmailRotulo}
            </label>
            <Input
              id="privacidade-email-novo"
              ref={campoDoEmail}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={emailDigitado}
              disabled={ocupada}
              placeholder={TEXTOS_DA_CLIENTE.campoEmailDica}
              aria-invalid={erroDoEmail !== null}
              aria-describedby={
                erroDoEmail
                  ? "privacidade-email-erro"
                  : "privacidade-email-dica"
              }
              onChange={(evento) => {
                setEmailDigitado(evento.target.value);
                if (erroDoEmail) setErroDoEmail(null);
              }}
              className="h-11 rounded-xl"
            />
            {erroDoEmail ? (
              <p
                id="privacidade-email-erro"
                role="alert"
                className="text-sm font-semibold text-red-700"
              >
                {erroDoEmail}
              </p>
            ) : (
              <p id="privacidade-email-dica" className="text-xs text-zinc-600">
                {TEXTOS_DA_CLIENTE.campoEmailDica}
              </p>
            )}
          </div>
          {falha && (
            <p role="alert" className="text-sm font-semibold text-red-700">
              {falha}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupada} className="min-h-11">
              {TEXTOS_DA_CLIENTE.confirmaVoltar}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={ocupada}
              className="min-h-11"
              onClick={(evento) => {
                evento.preventDefault();
                void confirmarEmail();
              }}
            >
              {enviando === "corrigir_email"
                ? TEXTOS_DA_CLIENTE.enviando
                : TEXTOS_DA_CLIENTE.confirmaEmailAcao}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
