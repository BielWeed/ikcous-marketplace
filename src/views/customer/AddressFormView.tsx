import { CONTAINER_DO_COMPUTADOR } from "@/components/desktop/medidas";
import { AddressForm } from "@/components/ui/custom/AddressForm";
import { useStore } from "@/contexts/StoreContext";
import { useAddresses } from "@/hooks/useAddresses";
import { useTelaDeComputador } from "@/hooks/useTelaDeComputador";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { cn } from "@/lib/utils";
import type { Address, View } from "@/types";
import { MapPin, Sparkles } from "lucide-react";
import { Suspense, lazy, useEffect } from "react";

const MenuDaConta = lazy(() =>
  import("@/components/desktop/MenuDaConta").then((m) => ({
    default: m.MenuDaConta,
  })),
);

interface AddressFormViewProps {
  addressId?: string | null;
  onBack: () => void;
  onNavigate?: (view: View, id?: string) => void;
}

export function AddressFormView({
  addressId,
  onBack,
  onNavigate = () => {},
}: AddressFormViewProps) {
  const computador = useTelaDeComputador();
  const { config } = useStore();
  const { addresses, fetchAddresses, addAddress, updateAddress } =
    useAddresses();

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const editingAddress = addressId
    ? addresses.find((a) => a.id === addressId)
    : undefined;

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
    <div
      className={cn(
        "flex min-h-full flex-col bg-white",
        CONTAINER_DO_COMPUTADOR,
        "lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:content-start lg:items-start lg:gap-8 lg:py-8",
      )}
    >
      {computador && (
        <Suspense fallback={null}>
          {/* Os endereços moram em "Minha conta": o formulário marca esse item. */}
          <MenuDaConta atual="profile" onNavigate={onNavigate} />
        </Suspense>
      )}
      <div
        className={cn(
          "mx-auto max-w-md px-4 py-8",
          "lg:w-full lg:min-w-0 lg:max-w-2xl lg:px-0 lg:py-0",
        )}
      >
        {/* Visual Header */}
        <div className="group relative mb-8 overflow-hidden rounded-[2.5rem] bg-zinc-900 p-8 shadow-2xl">
          {/* Decorative elements */}
          <div className="absolute right-0 top-0 -mr-16 -mt-16 size-32 rounded-full bg-white/5 blur-2xl transition-colors group-hover:bg-white/10" />
          <div className="absolute bottom-0 left-0 -mb-12 -ml-12 size-24 rounded-full bg-white/5 blur-xl" />

          <div className="relative z-10 flex items-start gap-5">
            <div className="mt-1 flex size-12 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 backdrop-blur-md">
              <MapPin className="size-6 text-white" />
            </div>
            <div className="flex flex-col">
              <h2 className="mb-1 flex items-center gap-2 text-3xl font-black tracking-tighter text-white">
                {addressId ? "Editar Endereço" : "Novo Endereço"}
                <Sparkles className="size-5 animate-pulse text-amber-400" />
              </h2>
              <p className="text-[10px] font-black uppercase leading-tight tracking-[0.2em] text-zinc-400">
                {addressId
                  ? "Atualize os dados para entrega"
                  : `Onde entregaremos seu produto da ${nomeDaLoja(config)}?`}
              </p>
            </div>
          </div>
        </div>

        {/* Form Container */}
        <div className="rounded-[2.5rem] border border-zinc-100 bg-white p-6 shadow-sm duration-700 animate-in fade-in slide-in-from-bottom-4">
          <AddressForm
            initialData={editingAddress}
            onSubmit={handleSubmit}
            onCancel={onBack}
          />
        </div>

        {/* Hint/Footer info */}
        <div className="mt-8 px-6 text-center">
          <p className="text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-300">
            Seus dados estão seguros e serão usados apenas para a logística de
            entrega.
          </p>
        </div>
      </div>
    </div>
  );
}
