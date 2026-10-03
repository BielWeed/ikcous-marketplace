import { AddressForm } from "@/components/ui/custom/AddressForm";
import { useStore } from "@/contexts/StoreContext";
import { useAddresses } from "@/hooks/useAddresses";
import { useAuth } from "@/hooks/useAuth";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import type { Address } from "@/types";
import { useEffect } from "react";

interface AddressFormViewProps {
  addressId?: string | null;
  onBack: () => void;
}

export function AddressFormView({ addressId, onBack }: AddressFormViewProps) {
  const { config } = useStore();
  const { user, profile } = useAuth();
  const { addresses, fetchAddresses, addAddress, updateAddress } =
    useAddresses();

  useEffect(() => {
    fetchAddresses();
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

  return (
    <div className="pb-customer flex min-h-full flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-5">
        <div className="mb-5">
          {/* O nome da tela, como na prévia aprovada (barra "Novo endereço"):
              o app não tem título de tela no cabeçalho, e a jornada
              trocar-endereco-carrinho (e2e) procura este texto. */}
          {!addressId && (
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Novo endereço
            </p>
          )}
          <h2 className="text-2xl font-extrabold leading-[1.15] tracking-tight text-foreground">
            {addressId ? "Editar endereço" : "Para onde vamos entregar?"}
          </h2>
          <p className="mt-1.5 text-sm leading-snug text-muted-foreground">
            {addressId
              ? "Atualize os dados para entrega."
              : `Seu pedido da ${nomeDaLoja(config)}: comece pelo CEP e a gente completa o resto.`}
          </p>
        </div>

        <AddressForm
          initialData={editingAddress}
          onSubmit={handleSubmit}
          onCancel={onBack}
          nomeDaConta={nomeDaConta}
        />
      </div>
    </div>
  );
}
