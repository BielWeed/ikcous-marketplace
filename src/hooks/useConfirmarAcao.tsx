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
import { useCallback, useEffect, useRef, useState } from "react";

export interface PedidoDeConfirmacao {
  titulo: string;
  /** O mesmo texto que a caixa nativa do navegador mostrava. */
  texto: string;
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
 */
export function useConfirmarAcao() {
  const [pedido, setPedido] = useState<PedidoDeConfirmacao | null>(null);
  const [aberta, setAberta] = useState(false);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

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
        overlayClassName="z-[130]"
        className="z-[130] max-w-md rounded-3xl border border-admin-border bg-zinc-950"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-black tracking-tight text-white">
            {pedido?.titulo}
          </AlertDialogTitle>
          {pedido?.valor && (
            <p className="text-3xl font-black tabular-nums text-white">
              {pedido.valor}
            </p>
          )}
          <AlertDialogDescription className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">
            {pedido?.texto}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-2 gap-2">
          <AlertDialogCancel className="min-h-11 rounded-xl border border-admin-border bg-white/5 px-4 text-sm font-semibold text-white hover:bg-white/10">
            {pedido?.voltar ?? "Voltar"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => responder(true)}
            className="min-h-11 rounded-xl border border-red-900/60 bg-transparent px-4 text-sm font-semibold text-red-300 hover:bg-red-950/40"
          >
            {pedido?.verbo}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmar, dialogo };
}
