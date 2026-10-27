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
  fraseDeItens,
  fraseDecisaoDaLoja,
  frasePedidoEnviado,
} from "@/config/textos-de-privacidade";
import { usePedidosDePrivacidade } from "@/hooks/usePedidosDePrivacidade";
import { useVoltarFechaAFolha } from "@/hooks/useVoltarFechaAFolha";
import {
  type FalhaDoPedido,
  type PedidoDePrivacidade,
  type TipoDoPedidoDePrivacidade,
  formatarDataDoPedido,
  ultimoPedidoDoTipo,
  validarEmailNovo,
} from "@/lib/pedidos-de-privacidade";
import { cn } from "@/lib/utils";
import { ChevronDown, Loader2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

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
 * Cartão de linha fina com um ponto colorido na frente (Tinta: cor só com
 * significado, nunca bloco pintado). O ponto é decorativo; quem informa é o texto.
 */
function CartaoComPonto({
  ponto,
  alerta = false,
  children,
}: {
  ponto: string;
  alerta?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role={alerta ? "alert" : "status"}
      className="flex items-start gap-2.5 rounded-2xl border border-border p-3.5 text-sm text-foreground"
    >
      <span
        aria-hidden="true"
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", ponto)}
      />
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
    </div>
  );
}

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
      <CartaoComPonto ponto="bg-emerald-500">
        <p className="font-semibold">{frasePedidoEnviado(data)}</p>
        {pedido.email_novo && (
          <p>
            E-mail pedido:{" "}
            <span className="break-all">{pedido.email_novo}</span>
          </p>
        )}
      </CartaoComPonto>
    );
  }
  return (
    <CartaoComPonto
      ponto={pedido.situacao === "atendido" ? "bg-emerald-500" : "bg-amber-500"}
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
    </CartaoComPonto>
  );
}

type LinhaDaSanfona = "guarda" | "apaga" | "fica";

/**
 * Uma linha da lista em sanfona: o botão (título, resumo e seta) e o painel que
 * ele abre. O painel fica SEMPRE no DOM, com `hidden` quando fechado: assim o
 * `aria-controls` aponta para algo que existe e o leitor de tela só lê o painel
 * aberto. O resumo recortado em 2 linhas é o próprio texto (o recorte é só CSS) e
 * some quando a linha abre, para o texto não aparecer duas vezes.
 */
function LinhaDaSanfona({
  id,
  titulo,
  resumo,
  recortarResumo,
  resumoComAberta,
  aberta,
  aoAlternar,
  primeira,
  children,
}: {
  id: string;
  titulo: string;
  resumo: string;
  recortarResumo: boolean;
  /** `true` mantém o resumo à vista com a linha aberta (ex.: "7 itens"). */
  resumoComAberta: boolean;
  aberta: boolean;
  aoAlternar: () => void;
  primeira: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        !primeira && "border-t border-border",
        aberta && "bg-muted/30",
      )}
    >
      <h3>
        <button
          type="button"
          id={`${id}-botao`}
          aria-expanded={aberta}
          aria-controls={`${id}-painel`}
          onClick={aoAlternar}
          className="flex min-h-11 w-full items-start gap-3 px-4 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-5 text-foreground">
              {titulo}
            </span>
            {(!aberta || resumoComAberta) && (
              <span
                className={cn(
                  "mt-0.5 text-xs leading-4 text-muted-foreground",
                  recortarResumo ? "line-clamp-2" : "block",
                )}
              >
                {resumo}
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
              aberta && "rotate-180",
            )}
          />
        </button>
      </h3>
      <div id={`${id}-painel`} hidden={!aberta} className="px-4 pb-4">
        {children}
      </div>
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
  // Só "o que a exclusão apaga" abre sozinha: é a pergunta que a cliente mais traz.
  const [abertas, setAbertas] = useState<Record<LinhaDaSanfona, boolean>>({
    guarda: false,
    apaga: true,
    fica: false,
  });

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

  function alternar(linha: LinhaDaSanfona) {
    setAbertas((antes) => ({
      guarda: linha === "guarda" ? !antes.guarda : antes.guarda,
      apaga: linha === "apaga" ? !antes.apaga : antes.apaga,
      fica: linha === "fica" ? !antes.fica : antes.fica,
    }));
  }

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

  // O Voltar do aparelho fecha só a pergunta (a conta e o e-mail já digitado
  // ficam). Com o pedido sendo gravado `fechar` não faz nada: `false` devolve a
  // entrada que o Voltar consumiu, e a pergunta segue na tela.
  useVoltarFechaAFolha(dialogo !== null, () => {
    if (ocupada) return false;
    fechar();
    return true;
  });

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
    <section aria-labelledby="privacidade-titulo" className="space-y-5">
      <header className="space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {TEXTOS_DA_CLIENTE.rotuloDaTela}
        </p>
        <h2
          id="privacidade-titulo"
          className="text-[28px] font-bold leading-8 tracking-tight text-foreground"
        >
          {TEXTOS_DA_CLIENTE.titulo}
        </h2>
        <p className="text-sm text-muted-foreground">
          {TEXTOS_DA_CLIENTE.abertura}
        </p>
      </header>

      <div className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-border bg-muted/30 px-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {TEXTOS_DA_CLIENTE.rotuloDoPrazo}
        </span>
        <p className="text-[15px] font-semibold text-foreground">
          {TEXTOS_DA_CLIENTE.prazo}
        </p>
      </div>

      <div className="overflow-hidden rounded-[18px] border border-input">
        <LinhaDaSanfona
          id="privacidade-guarda"
          titulo={TEXTOS_DA_CLIENTE.guardaTitulo}
          resumo={TEXTOS_DA_CLIENTE.guarda}
          recortarResumo
          resumoComAberta={false}
          aberta={abertas.guarda}
          aoAlternar={() => alternar("guarda")}
          primeira
        >
          <p className="text-[13px] leading-[18px] text-foreground">
            {TEXTOS_DA_CLIENTE.guarda}
          </p>
        </LinhaDaSanfona>
        <LinhaDaSanfona
          id="privacidade-apaga"
          titulo={TEXTOS_DA_CLIENTE.apagaTitulo}
          resumo={fraseDeItens(TEXTOS_DA_CLIENTE.apaga.length)}
          recortarResumo={false}
          resumoComAberta
          aberta={abertas.apaga}
          aoAlternar={() => alternar("apaga")}
          primeira={false}
        >
          <ul className="space-y-2.5 pt-1">
            {TEXTOS_DA_CLIENTE.apaga.map((item) => (
              <li
                key={item}
                className="flex gap-2 text-[13px] leading-[18px] text-foreground"
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground"
                >
                  —
                </span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        </LinhaDaSanfona>
        <LinhaDaSanfona
          id="privacidade-fica"
          titulo={TEXTOS_DA_CLIENTE.ficaTitulo}
          resumo={TEXTOS_DA_CLIENTE.fica}
          recortarResumo
          resumoComAberta={false}
          aberta={abertas.fica}
          aoAlternar={() => alternar("fica")}
          primeira={false}
        >
          <p className="text-[13px] leading-[18px] text-foreground">
            {TEXTOS_DA_CLIENTE.fica}
          </p>
        </LinhaDaSanfona>
      </div>

      {carga === "carregando" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {TEXTOS_DA_CLIENTE.carregando}
        </p>
      )}

      {carga === "erro" && (
        <CartaoComPonto ponto="bg-red-500" alerta>
          <p className="font-semibold">{TEXTOS_DA_CLIENTE.falhaAoCarregar}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void recarregar()}
            className="mt-2 min-h-11 rounded-xl border-solid"
          >
            {TEXTOS_DA_CLIENTE.recarregar}
          </Button>
        </CartaoComPonto>
      )}

      {falha && dialogo === null && (
        <CartaoComPonto ponto="bg-red-500" alerta>
          <p className="font-semibold">{falha}</p>
        </CartaoComPonto>
      )}

      <div className="space-y-3">
        <SituacaoDoPedido pedido={pedidoDeEmail} />
        {podePedirEmail && (
          <Button
            type="button"
            variant="outline"
            disabled={ocupada}
            onClick={() => abrir("corrigir_email")}
            className="h-[52px] min-h-11 w-full rounded-2xl border-[1.5px] border-solid border-foreground bg-background text-[15px] font-semibold text-foreground shadow-none hover:bg-muted/40 hover:text-foreground dark:border-foreground dark:bg-background dark:hover:bg-muted/40"
          >
            {TEXTOS_DA_CLIENTE.botaoCorrigirEmail}
          </Button>
        )}

        <SituacaoDoPedido pedido={pedidoDeExclusao} />
        {podePedirExclusao && (
          <Button
            type="button"
            variant="outline"
            disabled={ocupada}
            onClick={() => abrir("excluir_conta")}
            className="h-[52px] min-h-11 w-full rounded-2xl border-[1.5px] border-solid border-red-300 bg-background text-[15px] font-semibold text-red-600 shadow-none hover:bg-muted/40 hover:text-red-600 dark:border-red-300 dark:bg-background dark:text-red-400 dark:hover:bg-muted/40 dark:hover:text-red-400"
          >
            {TEXTOS_DA_CLIENTE.botaoExcluir}
          </Button>
        )}
      </div>

      <AlertDialog
        open={dialogo === "excluir_conta"}
        onOpenChange={(aberto) => {
          if (!aberto) fechar();
        }}
      >
        <AlertDialogContent
          overlayClassName="z-[130]"
          className="z-[130] max-h-[85dvh] overflow-y-auto"
        >
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
        <AlertDialogContent
          overlayClassName="z-[130]"
          className="z-[130] max-h-[85dvh] overflow-y-auto"
        >
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
