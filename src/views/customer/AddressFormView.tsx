import { AddressForm } from "@/components/ui/custom/AddressForm";
import { useStore } from "@/contexts/StoreContext";
import { useAddresses } from "@/hooks/useAddresses";
import { useAuth } from "@/hooks/useAuth";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { cn } from "@/lib/utils";
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
