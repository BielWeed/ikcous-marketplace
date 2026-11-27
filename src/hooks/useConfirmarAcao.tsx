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
import { useVoltarFechaAFolha } from "@/hooks/useVoltarFechaAFolha";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface PedidoDeConfirmacao {
  titulo: string;
  /** O mesmo texto que a caixa nativa do navegador mostrava. */
  texto: string;
  /** Aviso opcional destacado dentro da descrição. */
  aviso?: string;
  /** O verbo da ação ("Devolver R$ 50,00"), nunca "OK". */
  verbo: string;
  /** Valor em destaque, já formatado em reais. */
  valor?: string;
  /** Texto do botão de desistir (padrão "Voltar"). */
  voltar?: string;
}

/**
 * A pergunta "tem certeza?" dos fluxos de dinheiro do painel: a janela do app
 * no lugar do `confirm()` do navegador (feio no celular, pode ser bloqueado,
 * não mostra o valor em destaque nem respeita o tema).
 *
 * Uso: `const { confirmar, dialogo } = useConfirmarAcao()`, renderize `dialogo`
 * na tela e troque `globalThis.confirm(t)` por `await confirmar({...})`.
 * Devolve `true` só no botão da ação. Voltar do aparelho, Esc, toque fora e o
 * botão de desistir devolvem `false`. Só a PRIMEIRA resposta vale (duplo toque
 * não confirma duas vezes) e uma pergunta já aberta recusa a segunda.
 *
 * `alvoDoFoco`: onde o foco cai ao fechar quando o botão que abriu a pergunta
 * ficou desligado ("Devolvendo…") ou saiu da tela — senão o foco iria ao body
 * e o leitor de tela ficaria sem lugar. Normalmente o título do cartão, com
 * `tabIndex={-1}`. Sem alvo (ou fora da tela), fica o padrão do Radix — que
 * NÃO devolve o foco a quem abriu: cancela a volta automática e tenta focar o
 * gatilho (`Trigger`) da janela. Esta pergunta não tem gatilho, então o foco
 * cai no body.
 */
export function useConfirmarAcao(
  opcoes: { readonly alvoDoFoco?: RefObject<HTMLElement | null> } = {},
) {
  const { alvoDoFoco } = opcoes;
  const [pedido, setPedido] = useState<PedidoDeConfirmacao | null>(null);
  const [aberta, setAberta] = useState(false);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);
  // Quem tinha o foco quando a pergunta abriu (o botão de origem).
  const origemRef = useRef<HTMLElement | null>(null);

  const responder = useCallback((ok: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setAberta(false);
    resolver?.(ok);
  }, []);

  const confirmar = useCallback(
    (novo: PedidoDeConfirmacao) =>
      new Promise<boolean>((resolver) => {
        if (resolverRef.current) return resolver(false);
        resolverRef.current = resolver;
        origemRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setPedido(novo);
        setAberta(true);
      }),
    [],
  );

  // Tela que some com a pergunta aberta: quem espera recebe "não".
  useEffect(() => () => resolverRef.current?.(false), []);
  useVoltarFechaAFolha(aberta, () => responder(false));

  const dialogo = (
    <AlertDialog open={aberta} onOpenChange={(o) => !o && responder(false)}>
      <AlertDialogContent
        data-testid="confirmar-acao"
        // Mesmo tratamento do AdminOrderCard: volta ao botão de origem se ele
        // ainda existe e está ligado; senão, ao alvo estável do chamador.
        onCloseAutoFocus={(evento) => {
          const origem = origemRef.current;
          origemRef.current = null;
          const alvo =
            origem?.isConnected && !origem.matches(":disabled")
              ? origem
              : alvoDoFoco?.current;
          if (!alvo?.isConnected) return;
          evento.preventDefault();
          alvo.focus();
        }}
        overlayClassName="z-[130]"
        className="z-[130] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-admin-border bg-zinc-950"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-black tracking-tight text-white [overflow-wrap:anywhere]">
            {pedido?.titulo}
          </AlertDialogTitle>
          {pedido?.valor && (
            <p className="text-3xl font-black tabular-nums text-white">
              {pedido.valor}
            </p>
          )}
          <AlertDialogDescription className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">
            {pedido?.texto}
            {pedido?.aviso ? (
              <span className="mt-3 block font-bold text-amber-400">
                {pedido.aviso}
              </span>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* Botões que quebram linha (`whitespace-normal h-auto`): com a fonte
            do celular em 130%, "Apagar e começar outra" numa linha só fazia a
            janela rolar de lado em 320 px e cortava a pergunta. */}
        <AlertDialogFooter className="mt-2 gap-2">
          <AlertDialogCancel className="h-auto min-h-11 whitespace-normal rounded-xl border border-admin-border bg-white/5 px-4 text-center text-sm font-semibold text-white [overflow-wrap:anywhere] hover:bg-white/10">
            {pedido?.voltar ?? "Voltar"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => responder(true)}
            className="h-auto min-h-11 whitespace-normal rounded-xl border border-red-900/60 bg-transparent px-4 text-center text-sm font-semibold text-red-300 [overflow-wrap:anywhere] hover:bg-red-950/40"
          >
            {pedido?.verbo}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // Fecha a pergunta por fora (a tela percebeu que o que ela afirma deixou de
  // ser verdade): quem espera recebe "não". Sem pergunta aberta, não faz nada.
  const fechar = useCallback(() => responder(false), [responder]);

  return { confirmar, dialogo, fechar };
}
