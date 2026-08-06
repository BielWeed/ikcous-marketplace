import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { Button } from "@/components/ui/button";
import { AddressForm } from "@/components/ui/custom/AddressForm";
import { AddressList } from "@/components/ui/custom/AddressList";
import { CouponInput } from "@/components/ui/custom/CouponInput";
import { useStore } from "@/contexts/StoreContext";
import { useAddresses } from "@/hooks/useAddresses";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { useCoupons } from "@/hooks/useCoupons";
import { useDeferredRender } from "@/hooks/useDeferredRender";
import { useOrders } from "@/hooks/useOrders";
import { PAGAMENTO_ONLINE_LIGADO } from "@/lib/flags";
import { cn } from "@/lib/utils";
import type { Address, CartItem, Customer, PaymentMethod, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { zodResolver } from "@hookform/resolvers/zod";
import confetti from "canvas-confetti";
import { AnimatePresence, motion, usePresence } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  FileText,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Smartphone,
  Sparkles,
  Tag,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

interface CheckoutFormValues {
  name: string;
  whatsapp: string;
  cep?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  complement?: string;
}

interface CheckoutViewProps {
  readonly cart?: CartItem[];
  readonly subtotal?: number;
  readonly shipping?: number;
  readonly total?: number;
  readonly onClearCart?: () => void;
  readonly onNavigate: (view: View, productId?: string) => void;
  readonly onSetBackOverride: (override: (() => void) | null) => void;
}

export function CheckoutView({
  cart: propCart,
  subtotal: propSubtotal,
  shipping: propShipping,
  total: propTotal,
  onClearCart: propOnClearCart,
  onNavigate,
  onSetBackOverride,
}: CheckoutViewProps) {
  const { config, isLoaded: storeConfigLoaded } = useStore();
  const [isSearchingCep, setIsSearchingCep] = useState(false);
  const [isPresent] = usePresence();
  const isReady = useDeferredRender(380);
  const {
    cart: ctxCart,
    cartTotal: ctxSubtotal,
    shippingFee: ctxShipping,
    clearCart: ctxClearCart,
    selectedShippingOption,
    shippingCep,
  } = useCart();

  const cart = propCart ?? ctxCart;
  const subtotal = propSubtotal ?? ctxSubtotal;
  const shipping = propShipping ?? ctxShipping;
  const total = propTotal ?? ctxSubtotal + ctxShipping;
  const onClearCart = propOnClearCart ?? ctxClearCart;
  const { createOrder } = useOrders(false, true);
  const { validateCoupon } = useCoupons();
  const { user, profile, loading: authLoading } = useAuth();
  const {
    addresses,
    fetchAddresses,
    addAddress,
    updateAddress,
    loading: addressesLoading,
  } = useAddresses();

  const formatWhatsApp = (value: string) => {
    const numbers = value.replaceAll(/\D/g, "");

    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 7)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 11)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
  };

  const getDefaultWhatsApp = () => {
    const whatsapp = profile?.whatsapp || user?.user_metadata?.whatsapp;
    return whatsapp ? formatWhatsApp(whatsapp) : "";
  };

  const dynamicSchema = useMemo(() => {
    return z
      .object({
        name: z.string().min(1, "Nome é obrigatório"),
        whatsapp: z.string().min(14, "WhatsApp inválido"),
        cep: z.string().optional(),
        street: z.string().optional(),
        number: z.string().optional(),
        neighborhood: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        complement: z.string().optional(),
      })
      .superRefine((data, ctx) => {
        if (!user) {
          if (!data.cep || data.cep.length < 8) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "CEP inválido",
              path: ["cep"],
            });
          }
          if (!data.street || data.street.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Rua é obrigatória",
              path: ["street"],
            });
          }
          if (!data.number || data.number.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Número é obrigatório",
              path: ["number"],
            });
          }
          if (!data.neighborhood || data.neighborhood.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Bairro é obrigatório",
              path: ["neighborhood"],
            });
          }
          if (!data.city || data.city.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Cidade é obrigatória",
              path: ["city"],
            });
          }
          if (!data.state || data.state.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Estado inválido",
              path: ["state"],
            });
          }
        }
      });
  }, [user]);

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(dynamicSchema),
    defaultValues: {
      name: profile?.full_name || user?.user_metadata?.name || "",
      whatsapp: getDefaultWhatsApp(),
      cep: localStorage.getItem("ikcous_last_shipping_cep") || "38500-000",
      city: "Monte Carmelo",
      state: "MG",
    },
    mode: "onChange",
  });

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (storeConfigLoaded && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      const isNational = config.shippingCoverage === "national";
      if (!form.formState.isDirty) {
        form.reset({
          name: profile?.full_name || user?.user_metadata?.name || "",
          whatsapp: getDefaultWhatsApp(),
          cep:
            localStorage.getItem("ikcous_last_shipping_cep") ||
            (isNational ? "" : config.originCep || "38500-000"),
          city: isNational ? "" : "Monte Carmelo",
          state: isNational ? "" : "MG",
        });
      }
    }
  }, [
    storeConfigLoaded,
    config.shippingCoverage,
    config.originCep,
    profile,
    user,
  ]);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [orderId, setOrderId] = useState("");
  // O prazo NÃO é estado daqui — chega do banco pela resposta da edge
  // function, dentro do PagamentoOnline (ver comentário lá).
  const [aguardandoPagamento, setAguardandoPagamento] = useState(false);
  // Congelado no momento do submit, como orderId — sem isso, o onClearCart()
  // duas linhas abaixo zera o carrinho, cartTotal/shippingFee caem para 0
  // (ou ficam negativos com cupom aplicado) e o Brick nasce cobrando um
  // valor que não bate com o total já gravado no pedido.
  const [valorDoPedido, setValorDoPedido] = useState(0);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string>("");
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null,
  );
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const hasPushedAddressModalState = useRef(false);

  // Solo-ninja: Reset scroll when internal views change (address form or success)
  useEffect(() => {
    if (isAddressModalOpen || showSuccess) {
      const mainContainer = document.querySelector("main");
      if (mainContainer) {
        mainContainer.scrollTop = 0;
      }
      globalThis.scrollTo(0, 0);
    }
  }, [isAddressModalOpen, showSuccess]);

  // Push virtual history state when modal opens to intercept browser back button
  useEffect(() => {
    if (isAddressModalOpen && !hasPushedAddressModalState.current) {
      console.log("[CheckoutView] Pushing virtual address state");
      globalThis.history.pushState(
        { modal: "address" },
        "",
        globalThis.location.pathname,
      );
      hasPushedAddressModalState.current = true;
    } else if (!isAddressModalOpen) {
      hasPushedAddressModalState.current = false;
    }
  }, [isAddressModalOpen]);

  // Handle back button override for address modal
  useEffect(() => {
    if (isAddressModalOpen) {
      onSetBackOverride(() => () => {
        setIsAddressModalOpen(false);
        setEditingAddressId(null);
      });
    } else if (showSuccess || aguardandoPagamento) {
      // Sucesso ou aguardando pagamento: o pedido já foi criado e o carrinho
      // já foi limpo — não existe formulário para o botão voltar recuperar.
      // Sem este ramo, o voltar do Android saía direto para o carrinho vazio,
      // sem aviso, com o pedido reservado e o prazo de 30 minutos correndo.
      onSetBackOverride(() => () => onNavigate("home"));
    } else {
      onSetBackOverride(null);
    }

    return () => onSetBackOverride(null);
  }, [
    isAddressModalOpen,
    showSuccess,
    aguardandoPagamento,
    onSetBackOverride,
    onNavigate,
  ]);

  // Guest checkout enabled - no redirect
  useEffect(() => {
    if (!authLoading && !user) {
      console.log("[CheckoutView] Guest mode active.");
    }
  }, [user, authLoading]);

  useEffect(() => {
    if (profile) {
      form.setValue("name", profile.full_name || "", { shouldValidate: true });
      form.setValue(
        "whatsapp",
        profile.whatsapp ? formatWhatsApp(profile.whatsapp) : "",
        { shouldValidate: true },
      );
      form.trigger();
    } else if (user) {
      form.trigger();
    }
  }, [profile, user, form]);

  useEffect(() => {
    if (user) {
      fetchAddresses();
    }
  }, [user, fetchAddresses]);

  const handleSelectAddress = useCallback((address: Address) => {
    setSelectedAddressId(address.id);
  }, []);

  useEffect(() => {
    if (addresses.length > 0 && !selectedAddressId) {
      const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
      handleSelectAddress(defaultAddr);
    }
  }, [addresses, selectedAddressId, handleSelectAddress]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="size-12 animate-spin rounded-full border-4 border-zinc-100 border-t-zinc-900" />
      </div>
    );
  }

  // Remove !user early return to allow guest checkout UI to render
  // if (!user) return null; // Wait for redirect

  // Values are now passed from props to ensure consistency
  const discount = appliedCoupon?.discount || 0;
  const finalTotal = total - discount;

  const isValid = form.formState.isValid;

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponError("");
  };

  const handleApplyCoupon = async (code: string) => {
    setCouponError("");
    try {
      const result = await validateCoupon(code, subtotal);

      if (result.valid) {
        setAppliedCoupon({ code, discount: result.discount });
      } else {
        setCouponError(result.message || "Cupom inválido");
      }
    } catch (error) {
      console.error("Error applying coupon:", error);
      setCouponError("Erro ao validar cupom");
    }
  };

  const handleNewAddressSubmit = async (
    data: Omit<Address, "id" | "user_id">,
  ): Promise<void> => {
    let result;
    if (editingAddressId) {
      const success = await updateAddress(editingAddressId, data);
      if (success) {
        result = addresses.find((a) => a.id === editingAddressId);
      }
    } else {
      result = await addAddress(data);
    }

    if (result) {
      // Use history.back() to close instead of direct state set
      // This ensures history is cleared and triggers our backOverride cleanup
      globalThis.history.back();
      handleSelectAddress(result);
      // Auto-scroll back to summary section if needed
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleEditAddress = (address: Address) => {
    setEditingAddressId(address.id);
    setIsAddressModalOpen(true);
  };

  const handleSubmitEvent = async () => {
    const isFormValid = await form.trigger();
    if (!isFormValid) {
      toast.error(
        "Por favor, preencha todos os campos obrigatórios corretamente.",
      );
      return;
    }

    const data = form.getValues();

    setIsSubmitting(true);

    if (user && !selectedAddressId) {
      toast.error("Por favor, adicione ou selecione um endereço de entrega.");
      setIsSubmitting(false);
      return;
    }

    const customerInfo = data as unknown as Customer;
    const observations = notes || undefined;

    const variantNotes = cart
      .filter((item) => item.variantNames)
      .map((item) => `${item.product.name}: ${item.variantNames}`)
      .join("\n");
    const shippingNotes = selectedShippingOption
      ? `Frete Escolhido: ${selectedShippingOption.name} (Prazo: ${selectedShippingOption.deliveryDays} dias)`
      : undefined;
    const noteParts = [observations, variantNotes, shippingNotes].filter(
      Boolean,
    );
    const finalNotes =
      noteParts.length > 0 ? noteParts.join("\n\n") : undefined;

    const orderData: any = {
      customer: customerInfo,
      items: cart.map((item) => ({
        product_id: item.product.id, // Fixed key name for RPC
        quantity: item.quantity,
        variant_id: item.variantId, // Fixed key name for RPC
      })),
      totalAmount: finalTotal,
      shippingCost: shipping,
      // Identificam a cotação que o servidor gravou; sem isso o banco cai na
      // taxa padrão da loja e o total não fecha.
      destinationCep: shippingCep,
      shippingOptionId: selectedShippingOption?.id ?? null,
      paymentMethod,
      addressId: user ? selectedAddressId : null,
      addressData: user
        ? null
        : {
            cep: data.cep,
            street: data.street,
            number: data.number,
            neighborhood: data.neighborhood,
            city: data.city || "Monte Carmelo",
            state: data.state || "MG",
            complement: data.complement,
          },

      couponCode: appliedCoupon?.code,
      notes: finalNotes,
      status: "pending",
    };

    try {
      const ehOnline = paymentMethod === "online";
      const order = await createOrder(orderData, {
        comPagamentoOnline: ehOnline,
      });
      setOrderId(order.id);
      setValorDoPedido(finalTotal);

      // 🤖 Automação Solo-Ninja: O disparo agora é 100% via Backend (Edge Function + Webhook)
      onClearCart();

      if (ehOnline) {
        // NÃO mostra sucesso e NÃO solta confete: o pedido só está reservado,
        // e quem confirma pagamento é o webhook (Fase 3). Chamar isso de
        // sucesso aqui é a mentira que a tela de hoje conta.
        setAguardandoPagamento(true);
        return;
      }

      setShowSuccess(true);

      // Trigger confetti celebration
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#000000", "#ffffff", "#10b981", "#fbbf24"],
      });
    } catch (error: any) {
      console.error("Error creating order:", error);
      const errorMessage =
        error.message || "Ocorreu um erro ao processar seu pedido.";
      toast.error(`Falha no Pedido: ${errorMessage}`);
      // Fallback alert if toast fails or for critical notice
      if (!error.message)
        globalThis.alert(
          "Ocorreu um erro ao criar o pedido. Por favor, tente novamente.",
        );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (aguardandoPagamento && orderId) {
    return (
      <div className="min-h-dvh space-y-4 bg-gray-50/10 px-3.5 pt-4">
        <h1 className="text-lg font-bold text-zinc-900">
          Finalize o pagamento
        </h1>
        <p className="text-xs text-zinc-500">
          Seu pedido está reservado. Se o pagamento não sair em 30 minutos, os
          itens voltam para o estoque e o pedido é cancelado.
        </p>
        <PagamentoOnline
          orderId={orderId}
          valor={valorDoPedido}
          onErro={(msg) => toast.error(msg)}
        />
      </div>
    );
  }

  if (showSuccess) {
    return (
      <SuccessView
        orderId={orderId}
        appliedCoupon={appliedCoupon}
        discount={discount}
        onNavigate={onNavigate}
      />
    );
  }

  if (isAddressModalOpen) {
    return (
      <AddressSelectionView
        editingAddressId={editingAddressId}
        addresses={addresses}
        onNewAddressSubmit={handleNewAddressSubmit}
        onCancel={() => globalThis.history.back()}
      />
    );
  }

  return (
    <div className="pb-customer-summary min-h-dvh bg-gray-50/10 pt-2">
      <div className="space-y-4 px-3.5">
        {/* Customer Info */}
        <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100/55 bg-zinc-50/40 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
              <User className="size-4" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Dados de Identificação
            </span>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="checkout-name"
                  className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                >
                  Nome Completo
                </label>
                <input
                  id="checkout-name"
                  type="text"
                  autoComplete="name"
                  {...form.register("name")}
                  placeholder="Como devemos te chamar?"
                  className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                />
                {form.formState.errors.name && (
                  <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="checkout-tel"
                  className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                >
                  WhatsApp para Contato
                </label>
                <div className="relative">
                  <Phone
                    className="absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-zinc-400"
                    aria-hidden="true"
                  />
                  <Controller
                    control={form.control}
                    name="whatsapp"
                    render={({ field }) => (
                      <input
                        id="checkout-tel"
                        type="tel"
                        autoComplete="tel"
                        value={field.value}
                        onChange={(e) =>
                          field.onChange(formatWhatsApp(e.target.value))
                        }
                        placeholder="(00) 00000-0000"
                        maxLength={15}
                        className="w-full rounded-xl border-2 border-transparent bg-zinc-50 py-3 pl-12 pr-4 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                      />
                    )}
                  />
                </div>
                {form.formState.errors.whatsapp && (
                  <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                    {form.formState.errors.whatsapp.message}
                  </p>
                )}
              </div>
            </div>

            {/* Guest Address Fields */}
            {!user && (
              <div className="space-y-4 border-t border-zinc-100/50 pt-4">
                <div className="mb-1 flex items-center gap-2">
                  <MapPin className="size-4 text-zinc-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Endereço de Entrega
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 md:col-span-1">
                    <label
                      htmlFor="guest-cep"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      CEP
                    </label>
                    <div className="relative">
                      <input
                        id="guest-cep"
                        {...form.register("cep")}
                        placeholder={
                          config.shippingCoverage === "national"
                            ? "00000-000"
                            : "38500-000"
                        }
                        disabled={isSearchingCep}
                        className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                        onChange={async (e) => {
                          const clean = e.target.value.replace(/\D/g, "");
                          let formatted = clean;
                          if (clean.length > 5) {
                            formatted = `${clean.slice(0, 5)}-${clean.slice(5, 8)}`;
                          }
                          form.setValue("cep", formatted, {
                            shouldValidate: true,
                          });
                          localStorage.setItem(
                            "ikcous_last_shipping_cep",
                            formatted,
                          );

                          const isNational =
                            config.shippingCoverage === "national";
                          if (clean.length === 8 && isNational) {
                            setIsSearchingCep(true);
                            try {
                              const res = await fetch(
                                `https://viacep.com.br/ws/${clean}/json/`,
                              );
                              const data = await res.json();
                              if (data && !data.erro) {
                                if (data.logradouro)
                                  form.setValue("street", data.logradouro, {
                                    shouldValidate: true,
                                  });
                                if (data.bairro)
                                  form.setValue("neighborhood", data.bairro, {
                                    shouldValidate: true,
                                  });
                                if (data.localidade)
                                  form.setValue("city", data.localidade, {
                                    shouldValidate: true,
                                  });
                                if (data.uf)
                                  form.setValue("state", data.uf, {
                                    shouldValidate: true,
                                  });
                                toast.success("CEP localizado!");
                              } else {
                                toast.error("CEP não encontrado");
                              }
                            } catch (err) {
                              console.error("Error fetching CEP:", err);
                            } finally {
                              setIsSearchingCep(false);
                            }
                          }
                        }}
                      />
                      {isSearchingCep && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 className="size-4 animate-spin text-zinc-400" />
                        </div>
                      )}
                    </div>
                    {form.formState.errors.cep && (
                      <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                        {form.formState.errors.cep.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label
                      htmlFor="guest-neighborhood"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Bairro
                    </label>
                    <input
                      id="guest-neighborhood"
                      {...form.register("neighborhood")}
                      placeholder="Seu bairro"
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                    {form.formState.errors.neighborhood && (
                      <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                        {form.formState.errors.neighborhood.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label
                      htmlFor="guest-street"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Rua
                    </label>
                    <input
                      id="guest-street"
                      {...form.register("street")}
                      placeholder="Nome da rua"
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                    {form.formState.errors.street && (
                      <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                        {form.formState.errors.street.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-1 md:col-span-1">
                    <label
                      htmlFor="guest-number"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Número
                    </label>
                    <input
                      id="guest-number"
                      {...form.register("number")}
                      placeholder="123"
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                    {form.formState.errors.number && (
                      <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                        {form.formState.errors.number.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-1 md:col-span-1">
                    <label
                      htmlFor="guest-city"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Cidade
                    </label>
                    <input
                      id="guest-city"
                      {...form.register("city")}
                      readOnly={
                        !config.shippingCoverage ||
                        config.shippingCoverage !== "national"
                      }
                      placeholder={
                        config.shippingCoverage === "national"
                          ? "Cidade"
                          : "Monte Carmelo"
                      }
                      className={cn(
                        "w-full rounded-xl border-2 border-transparent px-4 py-3 text-sm font-medium outline-none transition-all",
                        config.shippingCoverage === "national"
                          ? "bg-zinc-50 text-zinc-800 focus:border-zinc-900 focus:bg-white"
                          : "cursor-not-allowed bg-zinc-100 text-zinc-500",
                      )}
                    />
                  </div>
                  <div className="col-span-1 md:col-span-1">
                    <label
                      htmlFor="guest-state"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Estado
                    </label>
                    <input
                      id="guest-state"
                      {...form.register("state")}
                      readOnly={
                        !config.shippingCoverage ||
                        config.shippingCoverage !== "national"
                      }
                      maxLength={2}
                      placeholder={
                        config.shippingCoverage === "national" ? "UF" : "MG"
                      }
                      className={cn(
                        "w-full rounded-xl border-2 border-transparent px-4 py-3 text-sm font-medium outline-none transition-all",
                        config.shippingCoverage === "national"
                          ? "bg-zinc-50 text-zinc-800 focus:border-zinc-900 focus:bg-white"
                          : "cursor-not-allowed bg-zinc-100 text-zinc-500",
                      )}
                    />
                  </div>
                  <div className="col-span-2">
                    <label
                      htmlFor="guest-complement"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Complemento (Opcional)
                    </label>
                    <input
                      id="guest-complement"
                      {...form.register("complement")}
                      placeholder="Apto, Bloco, Fundos, etc."
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Saved Addresses (Logged In Only) */}
        {user && (
          <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
                  <MapPin className="size-4" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Seus Endereços
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingAddressId(null);
                  setIsAddressModalOpen(true);
                }}
                className="flex h-8 items-center gap-1 rounded-xl bg-primary px-3 text-[9px] font-bold uppercase tracking-wider text-white transition-all hover:opacity-90"
              >
                <Plus className="size-3" /> Novo
              </Button>
            </div>
            <div className="p-4 sm:p-5">
              {addressesLoading ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="border-3 mb-3 size-6 animate-spin rounded-full border-zinc-100 border-t-primary" />
                  <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                    Sincronizando endereços...
                  </p>
                </div>
              ) : (
                <AddressList
                  addresses={addresses}
                  selectable
                  selectedId={selectedAddressId || undefined}
                  onSelect={handleSelectAddress}
                  onEdit={handleEditAddress}
                />
              )}
            </div>
          </div>
        )}

        {/* Coupon */}
        {config.enableCoupons && (
          <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
              <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
                <Tag className="size-4" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Vantagem Exclusiva
              </span>
            </div>
            <div className="p-4">
              <CouponInput
                onApply={handleApplyCoupon}
                onRemove={handleRemoveCoupon}
                appliedCoupon={appliedCoupon}
                error={couponError}
              />
            </div>
          </div>
        )}

        {/* Payment Method */}
        <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
              <CreditCard className="size-4" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Meio de Pagamento
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 p-4">
            {[
              ...(PAGAMENTO_ONLINE_LIGADO
                ? [
                    {
                      value: "online" as PaymentMethod,
                      label: "Pagar agora (PIX ou cartão)",
                      icon: CreditCard,
                      color: "text-violet-500 bg-violet-50",
                    },
                  ]
                : []),
              {
                value: "pix" as PaymentMethod,
                label: "Pix na Entrega",
                icon: Smartphone,
                color: "text-emerald-500 bg-emerald-50",
              },
              {
                value: "card" as PaymentMethod,
                label: "Cartão na Entrega",
                icon: CreditCard,
                color: "text-blue-500 bg-blue-50",
              },
              {
                value: "cash" as PaymentMethod,
                label: "Dinheiro na Entrega",
                icon: Banknote,
                color: "text-amber-500 bg-amber-50",
              },
            ].map((option) => {
              const Icon = option.icon;
              const isSelected = paymentMethod === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => setPaymentMethod(option.value)}
                  className={`flex w-full items-center gap-4 rounded-2xl border-2 p-3.5 shadow-sm transition-all duration-300 active:scale-[0.99] ${
                    isSelected
                      ? "z-10 border-zinc-900 bg-white shadow-md"
                      : "border-zinc-50 bg-zinc-50/50 hover:border-zinc-100 hover:bg-white"
                  }`}
                >
                  <div
                    className={`flex size-10 items-center justify-center rounded-xl ${option.color} transition-all duration-300 ${isSelected ? "scale-105" : ""}`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <span
                    className={`text-xs font-bold uppercase tracking-wider ${isSelected ? "text-zinc-900" : "text-zinc-400"}`}
                  >
                    {option.label}
                  </span>
                  <div
                    className={`ml-auto flex size-5 items-center justify-center rounded-full border transition-all duration-300 ${isSelected ? "scale-105 border-primary bg-primary" : "border-zinc-200"}`}
                  >
                    {isSelected && <Check className="size-3 text-white" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
              <FileText className="size-4" />
            </div>
            <label
              htmlFor="order-notes"
              className="text-[10px] font-bold uppercase tracking-wider text-zinc-500"
            >
              Notas Adicionais (Opcional)
            </label>
          </div>
          <div className="p-4">
            <textarea
              id="order-notes"
              name="order_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Deixar na portaria, campainha estragada, etc..."
              rows={2}
              className="w-full resize-none rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-primary focus:bg-white"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Location Notice */}
        <div className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 p-5 text-slate-800 shadow-md">
          <div className="absolute right-0 top-0 rotate-12 p-4 opacity-5 transition-transform duration-700 group-hover:rotate-0">
            <MapPin className="size-16 text-zinc-500" />
          </div>
          <div className="relative z-10 flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              <AlertCircle className="size-5 text-zinc-500" />
            </div>
            <div>
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-900">
                Aviso de Região
              </h4>
              <p className="text-[10px] font-medium uppercase leading-relaxed tracking-tight text-slate-500">
                Nossos serviços de entrega premium estão ativos exclusivamente
                em{" "}
                <span className="font-black text-slate-900">
                  Monte Carmelo, MG
                </span>
                .
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Spacer to prevent overlap by the sticky footer and bottom nav */}
      <div
        className="hidden md:block"
        style={{ height: "140px" }}
        aria-hidden="true"
      />
      <div
        className="block md:hidden"
        style={{ height: "calc(160px + var(--safe-area-bottom, 0px))" }}
        aria-hidden="true"
      />

      {/* Order Summary - Fixed Bottom Bar */}
      {typeof document !== "undefined" &&
        document.body &&
        createPortal(
          <AnimatePresence>
            {isPresent && isReady && (
              <motion.div
                initial={{ y: "100%", opacity: 0.5 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "100%", opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="bottom-safe-navigation fixed inset-x-0 z-[110] rounded-t-2xl border-t border-zinc-100 bg-white/95 p-3 px-4 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl md:bottom-[104px] md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2 md:rounded-b-none md:rounded-t-2xl md:border-x md:border-b-0 md:border-t md:border-zinc-200/60"
              >
                <div className="mx-auto flex max-w-screen-md items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col">
                    <span className="mb-1 text-[9px] font-bold uppercase leading-none tracking-wider text-zinc-400">
                      Total a Pagar
                    </span>
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-lg font-black leading-none tracking-tight text-zinc-900">
                        R$ {finalTotal.toFixed(2).replace(".", ",")}
                      </span>
                      {discount > 0 && (
                        <span className="text-[9px] font-bold uppercase text-red-500">
                          (-R$ {discount.toFixed(2).replace(".", ",")} OFF)
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      haptic.medium();
                      handleSubmitEvent();
                    }}
                    disabled={!isValid || isSubmitting}
                    className={cn(
                      "h-12 px-6 transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-2 rounded-2xl uppercase tracking-wider font-bold text-xs shrink-0 shadow-lg",
                      !isValid || isSubmitting
                        ? "bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200 shadow-none"
                        : "bg-primary text-white hover:bg-primary/90 shadow-black/10",
                    )}
                  >
                    {isSubmitting ? (
                      <div className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                    ) : (
                      <>
                        <span>Finalizar Pedido</span>
                        <ArrowLeft className="size-4 rotate-180" />
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}

// Sub-components to reduce cognitive complexity

interface SuccessViewProps {
  orderId: string;
  appliedCoupon: { code: string; discount: number } | null;
  discount: number;
  onNavigate: (view: View, productId?: string) => void;
}

function SuccessView({
  orderId,
  appliedCoupon,
  discount,
  onNavigate,
}: Readonly<SuccessViewProps>) {
  return (
    <div className="pb-customer flex min-h-full flex-col items-center justify-center bg-white px-6 text-center">
      <div className="group relative mb-12">
        <div className="absolute inset-0 scale-[2.5] rounded-2xl bg-emerald-100 opacity-30 blur-3xl transition-opacity duration-1000 group-hover:opacity-50" />
        <div className="relative flex size-32 items-center justify-center rounded-2xl border-4 border-white bg-emerald-50 shadow-2xl transition-transform duration-700 group-hover:scale-110">
          <Check className="size-14 text-emerald-500" />
        </div>
        <div className="absolute -right-4 -top-4 size-8 animate-pulse rounded-full bg-amber-400 blur-xl" />
        <div className="absolute -bottom-2 -left-2 size-6 animate-pulse rounded-full bg-primary/30 blur-lg delay-500" />
      </div>

      <h2 className="mb-4 text-4xl font-black leading-tight tracking-tighter text-zinc-900 duration-700 animate-in slide-in-from-bottom-4">
        Pedido Celebrado!
      </h2>

      <div className="mb-12 space-y-4 duration-1000 animate-in fade-in slide-in-from-bottom-8">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">
          Identificador:{" "}
          <span className="text-zinc-900">
            #{orderId.slice(-6).toUpperCase()}
          </span>
        </p>
        <div className="mx-auto max-w-[300px]">
          <p className="text-sm font-medium leading-relaxed text-zinc-500">
            Sua escolha premium foi registrada. Agora, nossa equipe cuidará de
            cada detalhe da logística.
          </p>
        </div>
        {appliedCoupon && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-100/50 bg-emerald-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-600">
            Vantagem Ativa: R$ {discount.toFixed(2).replace(".", ",")} OFF
          </div>
        )}
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4 duration-1000 animate-in slide-in-from-bottom-12">
        <button
          onClick={() => onNavigate("home")}
          className="shadow-3xl flex h-16 items-center justify-center gap-3 rounded-2xl bg-primary text-[11px] font-black uppercase tracking-[0.3em] text-white shadow-black/10 transition-all hover:bg-primary/90 active:scale-95"
        >
          Retornar à Vitrine
          <ArrowLeft className="size-5 rotate-180" />
        </button>
        <button
          onClick={() => onNavigate("profile")}
          className="flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95"
        >
          Ver Meus Pedidos
        </button>
      </div>
    </div>
  );
}

interface AddressSelectionViewProps {
  editingAddressId: string | null;
  addresses: Address[];
  onNewAddressSubmit: (data: Omit<Address, "id" | "user_id">) => Promise<void>;
  onCancel: () => void;
}

function AddressSelectionView({
  editingAddressId,
  addresses,
  onNewAddressSubmit,
  onCancel,
}: Readonly<AddressSelectionViewProps>) {
  return (
    <div className="min-h-screen bg-white pb-16 duration-500 animate-in slide-in-from-right">
      <div className="mx-auto max-w-md p-4">
        <div className="group relative mb-5 overflow-hidden rounded-2xl bg-primary p-5 shadow-lg">
          <div className="absolute right-0 top-0 -mr-16 -mt-16 size-32 rounded-full bg-white/5 blur-2xl transition-colors group-hover:bg-white/10" />
          <div className="absolute bottom-0 left-0 -mb-12 -ml-12 size-24 rounded-full bg-white/5 blur-xl" />

          <div className="relative z-10 flex flex-col">
            <h2 className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
              {editingAddressId ? "Editar Endereço" : "Novo Endereço"}
              <Sparkles className="size-4.5 animate-pulse text-amber-400" />
            </h2>
            <p className="text-[10px] font-bold uppercase leading-tight tracking-wider text-white/80">
              {editingAddressId
                ? "Atualize os dados para entrega"
                : "Onde entregaremos seu produto?"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
          <AddressForm
            initialData={
              editingAddressId
                ? addresses.find((a) => a.id === editingAddressId)
                : undefined
            }
            onSubmit={onNewAddressSubmit}
            onCancel={onCancel}
          />
        </div>

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
