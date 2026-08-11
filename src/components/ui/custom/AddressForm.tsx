import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useStore } from "@/contexts/StoreContext";
import { formatarCep, useBuscaCep } from "@/hooks/useBuscaCep";
import { cn } from "@/lib/utils";
import type { Address } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";

const addressSchema = z.object({
  name: z.string().min(1, "Nome/Apelido é obrigatório"),
  cep: z.string().min(8, "CEP inválido"),
  street: z.string().min(1, "Logradouro é obrigatório"),
  number: z.string().min(1, "Número é obrigatório"),
  complement: z.string().optional().or(z.literal("")),
  neighborhood: z.string().min(1, "Bairro é obrigatório"),
  city: z.string().min(1, "Cidade é obrigatória"),
  state: z.string().min(1, "Estado é obrigatório"),
  reference: z.string().optional().or(z.literal("")),
  recipient_name: z.string().min(1, "Nome do destinatário é obrigatório"),
  is_default: z.boolean(),
});

type AddressFormValues = z.infer<typeof addressSchema>;

interface AddressFormProps {
  initialData?: Address;
  onSubmit: (address: Omit<Address, "id" | "user_id">) => Promise<void>;
  onCancel: () => void;
}

export function AddressForm({
  initialData,
  onSubmit,
  onCancel,
}: AddressFormProps) {
  const { config, isLoaded } = useStore();
  const [loading, setLoading] = useState(false);

  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      name: initialData?.name || "",
      cep: initialData?.cep || "38500-000",
      street: initialData?.street || "",
      number: initialData?.number || "",
      complement: initialData?.complement || "",
      neighborhood: initialData?.neighborhood || "",
      city: initialData?.city || "Monte Carmelo",
      state: initialData?.state || "MG",
      reference: initialData?.reference || "",
      recipient_name: initialData?.recipient_name || "",
      is_default: !!initialData?.is_default,
    },
  });

  const hasInitializedRef = useRef(false);

  // Corrida, timeout e abort no desmonte ficam por conta do hook (#184,
  // #185, #186) — aqui só mapeia o endereço encontrado para os campos deste
  // formulário, escrevendo apenas o que o ViaCEP de fato devolveu.
  const { buscando: buscandoCep, buscar: buscarCep } = useBuscaCep(
    (endereco) => {
      if (endereco.logradouro)
        form.setValue("street", endereco.logradouro, {
          shouldValidate: true,
        });
      if (endereco.bairro)
        form.setValue("neighborhood", endereco.bairro, {
          shouldValidate: true,
        });
      if (endereco.localidade)
        form.setValue("city", endereco.localidade, { shouldValidate: true });
      if (endereco.uf)
        form.setValue("state", endereco.uf, { shouldValidate: true });
    },
  );

  useEffect(() => {
    if (isLoaded && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      if (initialData) {
        form.reset({
          name: initialData.name || "",
          cep: initialData.cep || "",
          street: initialData.street || "",
          number: initialData.number || "",
          complement: initialData.complement || "",
          neighborhood: initialData.neighborhood || "",
          city: initialData.city || "",
          state: initialData.state || "",
          reference: initialData.reference || "",
          recipient_name: initialData.recipient_name || "",
          is_default: !!initialData.is_default,
        });
      } else {
        const isNational = config.shippingCoverage === "national";
        form.reset({
          name: "",
          cep: isNational ? "" : config.originCep || "38500-000",
          street: "",
          number: "",
          complement: "",
          neighborhood: "",
          city: isNational ? "" : "Monte Carmelo",
          state: isNational ? "" : "MG",
          reference: "",
          recipient_name: "",
          is_default: false,
        });
      }
    }
  }, [isLoaded, initialData, config.shippingCoverage, config.originCep]);

  const handleSubmit = async (values: AddressFormValues) => {
    setLoading(true);
    try {
      const cleanData: Omit<Address, "id" | "user_id"> = {
        name: values.name,
        cep: values.cep,
        street: values.street,
        number: values.number,
        complement: values.complement || "",
        neighborhood: values.neighborhood,
        city: values.city,
        state: values.state,
        is_default: values.is_default,
        reference: values.reference || "",
        recipient_name: values.recipient_name,
      };
      await onSubmit(cleanData);
    } catch (error) {
      console.error("Submit error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <div className="space-y-4">
        {/* Nome/Apelido e CEP */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="name"
              className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
            >
              Apelido (Ex: Casa, Trabalho)
            </label>
            <input
              id="name"
              {...form.register("name")}
              placeholder="Apelido do endereço"
              disabled={loading}
              className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
            />
            {form.formState.errors.name && (
              <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="recipient_name"
              className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
            >
              Nome do Destinatário
            </label>
            <input
              id="recipient_name"
              {...form.register("recipient_name")}
              placeholder="Quem irá receber?"
              disabled={loading}
              className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
              autoComplete="name"
            />
            {form.formState.errors.recipient_name && (
              <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                {form.formState.errors.recipient_name.message}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="cep"
              className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
            >
              CEP
            </label>
            <Controller
              control={form.control}
              name="cep"
              render={({ field }) => {
                const isNational = config.shippingCoverage === "national";
                const handleCepChange = (
                  e: React.ChangeEvent<HTMLInputElement>,
                ) => {
                  const { limpo, formatado } = formatarCep(e.target.value);
                  field.onChange(formatado);

                  if (isNational) {
                    void buscarCep(limpo);
                  }
                };

                return (
                  <div className="relative">
                    <input
                      id="cep"
                      name="cep"
                      value={field.value}
                      onChange={handleCepChange}
                      readOnly={!isNational}
                      placeholder={isNational ? "00000-000" : "38500-000"}
                      maxLength={9}
                      disabled={loading || buscandoCep}
                      className={cn(
                        "w-full rounded-xl border-2 border-transparent px-4 py-3 text-sm font-medium outline-none transition-all",
                        isNational
                          ? "bg-zinc-50 text-zinc-800 focus:border-zinc-900 focus:bg-white"
                          : "cursor-not-allowed bg-zinc-100 text-zinc-500",
                      )}
                      autoComplete="postal-code"
                    />
                    {buscandoCep && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="size-4 animate-spin text-zinc-400" />
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {form.formState.errors.cep && (
              <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                {form.formState.errors.cep.message}
              </p>
            )}
          </div>
        </div>

        {/* Logradouro */}
        <div className="space-y-1.5">
          <label
            htmlFor="street"
            className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
          >
            Logradouro (Rua / Avenida)
          </label>
          <input
            id="street"
            {...form.register("street")}
            placeholder="Ex: Rua Tiradentes"
            disabled={loading}
            className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
            autoComplete="address-line1"
          />
          {form.formState.errors.street && (
            <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
              {form.formState.errors.street.message}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Número */}
          <div className="space-y-1.5">
            <label
              htmlFor="number"
              className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
            >
              Número
            </label>
            <input
              id="number"
              {...form.register("number")}
              placeholder="123"
              disabled={loading}
              className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
            />
            {form.formState.errors.number && (
              <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                {form.formState.errors.number.message}
              </p>
            )}
          </div>

          {/* Bairro */}
          <div className="space-y-1.5">
            <label
              htmlFor="neighborhood"
              className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
            >
              Bairro
            </label>
            <input
              id="neighborhood"
              {...form.register("neighborhood")}
              placeholder="Seu bairro"
              disabled={loading}
              className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
              autoComplete="address-level3"
            />
            {form.formState.errors.neighborhood && (
              <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                {form.formState.errors.neighborhood.message}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Cidade */}
          <div className="space-y-1.5">
            <label
              htmlFor="city"
              className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
            >
              Cidade
            </label>
            <input
              id="city"
              {...form.register("city")}
              placeholder="Cidade"
              readOnly={
                !config.shippingCoverage ||
                config.shippingCoverage !== "national"
              }
              disabled={loading}
              className={cn(
                "w-full rounded-xl border-2 border-transparent px-4 py-3 text-sm font-medium outline-none transition-all",
                config.shippingCoverage === "national"
                  ? "bg-zinc-50 text-zinc-800 focus:border-zinc-900 focus:bg-white"
                  : "cursor-not-allowed bg-zinc-100 text-zinc-500",
              )}
              autoComplete="address-level2"
            />
            {form.formState.errors.city && (
              <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                {form.formState.errors.city.message}
              </p>
            )}
          </div>

          {/* Estado */}
          <div className="space-y-1.5">
            <label
              htmlFor="state"
              className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
            >
              Estado
            </label>
            <input
              id="state"
              {...form.register("state")}
              placeholder="UF"
              readOnly={
                !config.shippingCoverage ||
                config.shippingCoverage !== "national"
              }
              disabled={loading}
              maxLength={2}
              className={cn(
                "w-full rounded-xl border-2 border-transparent px-4 py-3 text-sm font-medium outline-none transition-all",
                config.shippingCoverage === "national"
                  ? "bg-zinc-50 text-zinc-800 focus:border-zinc-900 focus:bg-white"
                  : "cursor-not-allowed bg-zinc-100 text-zinc-500",
              )}
              autoComplete="address-level1"
            />
            {form.formState.errors.state && (
              <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                {form.formState.errors.state.message}
              </p>
            )}
          </div>
        </div>

        {/* Complemento */}
        <div className="space-y-1.5">
          <label
            htmlFor="complement"
            className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
          >
            Complemento (Opcional)
          </label>
          <input
            id="complement"
            {...form.register("complement")}
            placeholder="Apto, Bloco, Fundos, etc."
            disabled={loading}
            className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
            autoComplete="address-line2"
          />
        </div>

        {/* Referência */}
        <div className="space-y-1.5">
          <label
            htmlFor="reference"
            className="ml-1 block text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400"
          >
            Ponto de Referência (Opcional)
          </label>
          <input
            id="reference"
            {...form.register("reference")}
            placeholder="Ex: Próximo ao mercado principal"
            disabled={loading}
            className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
            autoComplete="off"
          />
        </div>

        {/* Endereço Padrão */}
        <div className="flex items-center gap-3 px-2 pt-1.5">
          <div className="relative inline-flex cursor-pointer items-center">
            <Controller
              control={form.control}
              name="is_default"
              render={({ field }) => (
                <Checkbox
                  id="is_default"
                  name="is_default"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={loading}
                  className="size-5 rounded-md border-2 border-zinc-200 transition-all data-[state=checked]:border-zinc-900 data-[state=checked]:bg-zinc-900"
                />
              )}
            />
          </div>
          <label
            htmlFor="is_default"
            className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-zinc-500"
          >
            Definir como endereço padrão
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={loading}
          className="h-11 rounded-xl px-5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition-all hover:bg-zinc-50 hover:text-zinc-900"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          className="h-11 min-w-[130px] rounded-xl bg-zinc-900 px-6 text-[10px] font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-black active:scale-95"
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4.5 animate-spin" />
          ) : (
            "Salvar Endereço"
          )}
        </Button>
      </div>
    </form>
  );
}
