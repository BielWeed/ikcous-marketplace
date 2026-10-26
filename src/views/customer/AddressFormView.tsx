import { AddressForm } from "@/components/ui/custom/AddressForm";
import { useStore } from "@/contexts/StoreContext";
import { useAddresses } from "@/hooks/useAddresses";
import { useAuth } from "@/hooks/useAuth";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { cn } from "@/lib/utils";
import type { Address } from "@/types";
import { useEffect, useState } from "react";

interface AddressFormViewProps {
  addressId?: string | null;
  onBack: () => void;
}

export function AddressFormView({ addressId, onBack }: AddressFormViewProps) {
  const { config } = useStore();
  const { user, profile } = useAuth();
  const {
    addresses,
    erroAoCarregar,
    fetchAddresses,
    addAddress,
    updateAddress,
  } = useAddresses();
  // A busca já terminou (com ou sem sucesso)? Só então "não achei" é verdade.
  const [buscou, setBuscou] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.resolve(fetchAddresses()).finally(() => vivo && setBuscou(true));
    return () => {
      vivo = false;
    };
  }, [fetchAddresses]);

  const editingAddress = addressId
    ? addresses.find((a) => a.id === addressId)
    : undefined;

  // "Quem vai receber" já nasce com o nome da conta (mesma fonte que o
  // checkout usa para o nome do comprador).
  const nomeDaConta = profile?.full_name || user?.user_metadata?.name || "";

  const handleSubmit = async (data: Omit<Address, "id" | "user_id">) => {
    let success;
    if (addressId) {
      success = await updateAddress(addressId, data);
    } else {
      const newAddr = await addAddress(data);
      success = !!newAddr;
    }

    if (success) {
      onBack();
    }
  };

  // Editar um endereço que não está na lista (apagado em outro aparelho ou
  // link antigo) não abre formulário em branco com título "Editar endereço".
  if (addressId && !editingAddress) {
    return (
      <div className="pb-customer flex min-h-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {!buscou
            ? "Carregando…"
            : erroAoCarregar
              ? "Não conseguimos carregar este endereço."
              : "Este endereço não existe mais."}
        </p>
        {buscou && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-solid border-border px-6 py-3 text-xs font-bold uppercase tracking-wider text-foreground"
          >
            Voltar
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="pb-customer flex min-h-full flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-5">
        <AddressForm
          initialData={editingAddress}
          onSubmit={handleSubmit}
          onCancel={onBack}
          nomeDaConta={nomeDaConta}
          cabecalho={(passos) => (
            <div className="mb-1">
              {/* Barra de 3 passos (redesenho "Tinta"): decorativa, o texto
                  "N de 3" já informa. Em tinta o que está feito, em linha
                  fina o que falta. */}
              <div
                data-testid="barra-de-passos"
                aria-hidden="true"
                className="mb-5 flex gap-1.5"
              >
                {passos.segmentos.map((segmento) => (
                  <span
                    key={segmento.id}
                    data-cheio={segmento.cheio}
                    className={cn(
                      "h-[3px] flex-1 rounded-full",
                      segmento.cheio ? "bg-foreground" : "bg-border",
                    )}
                  />
                ))}
              </div>
              {/* O nome da tela, como na prévia aprovada ("Novo endereço"): o
                  app não tem título de tela no cabeçalho, e a jornada
                  trocar-endereco-carrinho (e2e) procura este texto — por isso
                  ele fica num elemento só dele, e o "· N de 3" noutro. */}
              {!addressId && (
                <p
                  data-testid="rotulo-do-passo"
                  className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
                >
                  <span>Novo endereço</span>
                  <span> · {passos.atual} de 3</span>
                </p>
              )}
              <h2 className="text-[28px] font-bold leading-8 tracking-tight text-foreground">
                {addressId ? "Editar endereço" : "Para onde vamos entregar?"}
              </h2>
              <p className="mt-2 text-[15px] leading-snug text-muted-foreground">
                {addressId
                  ? "Atualize os dados para entrega."
                  : `Seu pedido da ${nomeDaLoja(config)}: comece pelo CEP e a gente completa o resto.`}
              </p>
            </div>
          )}
        />
      </div>
    </div>
  );
}
