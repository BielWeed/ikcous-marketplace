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
import { definirCargo, textoDoSucesso } from "@/lib/cargo-da-conta";
import type { CargoDaConta } from "@/lib/cargo-da-conta";
import type { Customer } from "@/utils/admin_cache";
import { type RefObject, useRef, useState } from "react";
import { toast } from "sonner";
import type { AcaoDeCargo } from "./PromoverAdminAcoes";

/**
 * A confirmação antes de dar ou tirar o acesso de administrador.
 *
 * Fica FORA da folha "Gestão de Cliente": a folha é um diálogo próprio (z-100)
 * e esta confirmação (z-50) ficaria escondida atrás dela. Por isso o cartão
 * fecha a folha primeiro e só então abre esta, uma camada por vez.
 *
 * O cartão sobe para z-[70] porque a barra inferior do painel é z-[60]: em
 * celular baixo (320x640) ela cobria o "Cancelar". O fundo escurecido (z-50)
 * vem do AlertDialogContent compartilhado e continua abaixo da barra de
 * propósito; a barra não recebe toque (o Radix tira o toque de tudo fora do
 * diálogo). `max-h` + rolagem interna: o "Cancelar" nunca fica fora da tela.
 *
 * O foco abre em "Cancelar" (o Radix já faz isso no AlertDialog) para que um
 * Enter distraído nunca dê acesso a ninguém; ao fechar, o foco volta ao botão
 * da folha (`retornoDoFoco`).
 */
export function PromoverAdminConfirmacao({
  acao,
  aberta,
  customer,
  aoFechar,
  aoConcluir,
  retornoDoFoco,
}: {
  readonly acao: AcaoDeCargo | null;
  readonly aberta: boolean;
  readonly customer: Customer;
  readonly aoFechar: () => void;
  readonly aoConcluir: (id: string, novoCargo: CargoDaConta) => void;
  readonly retornoDoFoco: RefObject<HTMLElement | null>;
}) {
  // Trava de duplo clique: a ref vale no mesmo instante (o estado só no
  // próximo render); o estado existe para desabilitar os botões na tela.
  const emVooRef = useRef(false);
  const [emVoo, setEmVoo] = useState(false);

  if (!acao) return null;
  const promover = acao === "promover";
  const nome = customer.full_name?.trim() || "esta pessoa";
  const contato = [customer.email, customer.phone]
    .map((c) => c?.trim())
    .filter(Boolean)
    .join(" · ");

  const confirmar = async (e: { preventDefault: () => void }) => {
    // O Action do Radix fecha sozinho ao clicar; quem fecha somos nós, depois
    // da resposta do banco.
    e.preventDefault();
    if (emVooRef.current) return;
    emVooRef.current = true;
    setEmVoo(true);
    try {
      const resultado = await definirCargo(
        customer.id,
        promover ? "admin" : "customer",
      );
      if (resultado.ok) {
        toast.success(textoDoSucesso(customer.full_name ?? "", resultado.para));
        aoConcluir(customer.id, resultado.para);
      } else {
        toast.error(resultado.mensagem);
      }
    } finally {
      emVooRef.current = false;
      setEmVoo(false);
      aoFechar();
    }
  };

  return (
    <AlertDialog
      open={aberta}
      onOpenChange={(abrir) => {
        // Esc e clique fora não fecham com a chamada em voo.
        if (!abrir && !emVooRef.current) aoFechar();
      }}
    >
      <AlertDialogContent
        className="z-[70] max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] gap-3 overflow-y-auto rounded-3xl border border-admin-border bg-admin-raised p-4 sm:max-w-md sm:gap-4 sm:p-6"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          retornoDoFoco.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold text-white">
            {promover
              ? `Dar acesso de administrador a ${nome}?`
              : `Tirar o acesso de administrador de ${nome}?`}
          </AlertDialogTitle>
          {contato && (
            <p
              data-testid="promover-quem"
              className="break-all text-xs text-zinc-400"
            >
              {contato}
            </p>
          )}
          <AlertDialogDescription className="text-sm text-zinc-300">
            {promover
              ? "Esta pessoa vai poder ver e mudar pedidos, produtos, clientes, custos e configurações da loja."
              : "A pessoa volta a ser cliente. O acesso ao painel pode levar até cerca de 1 hora para acabar por completo no aparelho dela."}
          </AlertDialogDescription>
          {promover && (
            <p className="text-sm text-zinc-300">
              Ela não poderá nomear outros administradores nem mexer em você.
              Você pode tirar esse acesso quando quiser.
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-2 gap-2">
          <AlertDialogCancel
            disabled={emVoo}
            className="min-h-11 rounded-xl border-0 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmar}
            disabled={emVoo}
            className={
              promover
                ? "min-h-11 rounded-xl border-0 bg-foreground px-4 py-2 text-xs font-bold text-background hover:opacity-90"
                : "min-h-11 rounded-xl border-0 bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
            }
          >
            {promover ? "Dar acesso de administrador" : "Tirar acesso"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
