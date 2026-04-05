import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, CreditCard, Banknote, Smartphone, Check, MapPin, User, Phone, FileText, Tag, Plus, AlertCircle, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { CartItem, PaymentMethod, View, Customer, Address } from '@/types';
import { useOrders } from '@/hooks/useOrders';
import { useCoupons } from '@/hooks/useCoupons';
import { useAuth } from '@/hooks/useAuth';
import { useAddresses } from '@/hooks/useAddresses';
import { haptic } from '@/utils/haptic';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { CouponInput } from '@/components/ui/custom/CouponInput';
import { AddressList } from '@/components/ui/custom/AddressList';
import { AddressForm } from '@/components/ui/custom/AddressForm';
import { Button } from '@/components/ui/button';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const checkoutSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  whatsapp: z.string().min(14, 'WhatsApp inválido'),
  // Address fields for guests
  cep: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  complement: z.string().optional(),
});

type CheckoutFormValues = z.infer<typeof checkoutSchema>;

interface CheckoutViewProps {
  readonly cart: CartItem[];
  readonly subtotal: number;
  readonly shipping: number;
  readonly total: number;
  readonly onClearCart: () => void;
  readonly onNavigate: (view: View, productId?: string) => void;
  readonly onSetBackOverride: (override: (() => void) | null) => void;
}

export function CheckoutView({ cart, subtotal, shipping, total, onClearCart, onNavigate, onSetBackOverride }: CheckoutViewProps) {
  const { createOrder } = useOrders();
  const { validateCoupon } = useCoupons();
  const { user, profile, loading: authLoading } = useAuth();
  const { addresses, fetchAddresses, addAddress, updateAddress, loading: addressesLoading } = useAddresses();

  const formatWhatsApp = (value: string) => {
    const numbers = value.replaceAll(/\D/g, '');

    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 11) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
  };

  const getDefaultWhatsApp = () => {
    const whatsapp = profile?.whatsapp || user?.user_metadata?.whatsapp;
    return whatsapp ? formatWhatsApp(whatsapp) : '';
  };

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      name: profile?.full_name || user?.user_metadata?.name || '',
      whatsapp: getDefaultWhatsApp(),
    },
    mode: 'onChange'
  });

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponError, setCouponError] = useState<string>('');
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const hasPushedAddressModalState = useRef(false);

  // Solo-ninja: Reset scroll when internal views change (address form or success)
  useEffect(() => {
    if (isAddressModalOpen || showSuccess) {
      const mainContainer = document.querySelector('main');
      if (mainContainer) {
        mainContainer.scrollTop = 0;
      }
      globalThis.scrollTo(0, 0);
    }
  }, [isAddressModalOpen, showSuccess]);

  // Push virtual history state when modal opens to intercept browser back button
  useEffect(() => {
    if (isAddressModalOpen && !hasPushedAddressModalState.current) {
      console.log('[CheckoutView] Pushing virtual address state');
      globalThis.history.pushState({ modal: 'address' }, '', globalThis.location.pathname);
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
    } else if (showSuccess) {
      // On success, back button should go to home
      onSetBackOverride(() => () => onNavigate('home'));
    } else {
      onSetBackOverride(null);
    }

    return () => onSetBackOverride(null);
  }, [isAddressModalOpen, showSuccess, onSetBackOverride, onNavigate]);

  // Guest checkout enabled - no redirect
  useEffect(() => {
    if (!authLoading && !user) {
      console.log('[CheckoutView] Guest mode active.');
    }
  }, [user, authLoading]);

  useEffect(() => {
    if (profile) {
      form.setValue('name', profile.full_name || '');
      form.setValue('whatsapp', profile.whatsapp ? formatWhatsApp(profile.whatsapp) : '');
    }
  }, [profile, form]);

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
      const defaultAddr = addresses.find(a => a.is_default) || addresses[0];
      handleSelectAddress(defaultAddr);
    }
  }, [addresses, selectedAddressId, handleSelectAddress]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-12 h-12 border-4 border-zinc-100 border-t-zinc-900 rounded-full animate-spin" />
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
    setCouponError('');
  };

  const handleApplyCoupon = async (code: string) => {
    setCouponError('');
    try {
      const result = await validateCoupon(code, subtotal);

      if (result.valid) {
        setAppliedCoupon({ code, discount: result.discount });
      } else {
        setCouponError(result.message || 'Cupom inválido');
      }
    } catch (error) {
      console.error('Error applying coupon:', error);
      setCouponError('Erro ao validar cupom');
    }
  };

  const handleNewAddressSubmit = async (data: Omit<Address, 'id' | 'user_id'>): Promise<void> => {
    let result;
    if (editingAddressId) {
      const success = await updateAddress(editingAddressId, data);
      if (success) {
        result = addresses.find(a => a.id === editingAddressId);
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
      globalThis.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleEditAddress = (address: Address) => {
    setEditingAddressId(address.id);
    setIsAddressModalOpen(true);
  };

  const handleSubmitEvent = async () => {
    const data = form.getValues();
    if (!isValid) {
      form.trigger();
      return;
    }

    setIsSubmitting(true);

    const customerInfo = data as unknown as Customer;
    const observations = notes || undefined;

    if (!user) {
      if (!data.cep || !data.street || !data.number || !data.neighborhood) {
        toast.error('Por favor, preencha todos os campos obrigatórios do endereço.');
        setIsSubmitting(false);
        return;
      }
    }

    const orderData: any = {
      customer: customerInfo,
      items: cart.map(item => ({
        product_id: item.product.id, // Fixed key name for RPC
        quantity: item.quantity,
        variant_id: item.variantId // Fixed key name for RPC
      })),
      totalAmount: finalTotal,
      shippingCost: shipping,
      paymentMethod,
      addressId: user ? selectedAddressId : null,
      addressData: user ? null : {
        cep: data.cep,
        street: data.street,
        number: data.number,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        complement: data.complement
      },

      couponCode: appliedCoupon?.code,
      notes: observations,
      status: 'pending'
    };

    try {
      const order = await createOrder(orderData);
      setOrderId(order.id);

      // 🤖 Automação Solo-Ninja: O disparo agora é 100% via Backend (Edge Function + Webhook)
      onClearCart();
      setShowSuccess(true);

      // Trigger confetti celebration
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#000000', '#ffffff', '#10b981', '#fbbf24']
      });
    } catch (error: any) {
      console.error('Error creating order:', error);
      const errorMessage = error.message || 'Ocorreu um erro ao processar seu pedido.';
      toast.error(`Falha no Pedido: ${errorMessage}`);
      // Fallback alert if toast fails or for critical notice
      if (!error.message) globalThis.alert('Ocorreu um erro ao criar o pedido. Por favor, tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
    <div className="min-h-screen pb-56 md:pb-56 bg-gray-50/10 pt-4">

      <div className="px-6 space-y-8">

        {/* Customer Info */}
        <div className="bg-white rounded-[2.5rem] border border-zinc-100 overflow-hidden premium-shadow">
          <div className="px-6 py-5 bg-zinc-50/50 border-b border-zinc-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shadow-sm">
              <User className="w-5 h-5 text-zinc-900" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Dados de Identificação</span>
          </div>
          <div className="p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="checkout-name" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 mb-3 ml-1">
                  Nome Completo
                </label>
                <input
                  id="checkout-name"
                  type="text"
                  autoComplete="name"
                  {...form.register('name')}
                  placeholder="Como devemos te chamar?"
                  className="w-full px-6 py-5 bg-zinc-50 rounded-3xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none"
                />
                {form.formState.errors.name && <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.name.message}</p>}
              </div>

              <div>
                <label htmlFor="checkout-tel" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 mb-3 ml-1">
                  WhatsApp para Contato
                </label>
                <div className="relative">
                  <Phone className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-300" aria-hidden="true" />
                  <Controller
                    control={form.control}
                    name="whatsapp"
                    render={({ field }) => (
                      <input
                        id="checkout-tel"
                        type="tel"
                        autoComplete="tel"
                        value={field.value}
                        onChange={(e) => field.onChange(formatWhatsApp(e.target.value))}
                        placeholder="(00) 00000-0000"
                        maxLength={15}
                        className="w-full pl-14 pr-6 py-5 bg-zinc-50 rounded-3xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none"
                      />
                    )}
                  />
                </div>
                {form.formState.errors.whatsapp && <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.whatsapp.message}</p>}
              </div>
            </div>

            {/* Guest Address Fields */}
            {!user && (
              <div className="pt-6 border-t border-zinc-50 space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <MapPin className="w-4 h-4 text-zinc-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Endereço de Entrega</span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 md:col-span-1">
                    <label htmlFor="guest-cep" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 mb-2 ml-1">CEP</label>
                    <input id="guest-cep" {...form.register('cep')} placeholder="00000-000" className="w-full px-6 py-4 bg-zinc-50 rounded-2xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white transition-all outline-none" />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label htmlFor="guest-neighborhood" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 mb-2 ml-1">Bairro</label>
                    <input id="guest-neighborhood" {...form.register('neighborhood')} placeholder="Seu bairro" className="w-full px-6 py-4 bg-zinc-50 rounded-2xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white transition-all outline-none" />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label htmlFor="guest-street" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 mb-2 ml-1">Rua</label>
                    <input id="guest-street" {...form.register('street')} placeholder="Nome da rua" className="w-full px-6 py-4 bg-zinc-50 rounded-2xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white transition-all outline-none" />
                  </div>
                  <div className="col-span-1 md:col-span-1">
                    <label htmlFor="guest-number" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 mb-2 ml-1">Número</label>
                    <input id="guest-number" {...form.register('number')} placeholder="123" className="w-full px-6 py-4 bg-zinc-50 rounded-2xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white transition-all outline-none" />
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Saved Addresses (Logged In Only) */}
        {user && (
          <div className="bg-white rounded-[2.5rem] border border-zinc-100 overflow-hidden premium-shadow">
            <div className="px-6 py-5 bg-zinc-50/50 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shadow-sm">
                  <MapPin className="w-5 h-5 text-zinc-900" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Seus Endereços</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingAddressId(null);
                  setIsAddressModalOpen(true);
                }}
                className="h-10 px-4 text-[10px] font-black uppercase tracking-widest rounded-2xl bg-zinc-900 text-white hover:bg-black transition-all"
              >
                <Plus className="w-3.5 h-3.5 mr-2" /> Novo
              </Button>
            </div>
            <div className="p-6">
              {addressesLoading ? (
                <div className="py-12 flex flex-col items-center justify-center">
                  <div className="w-8 h-8 border-4 border-zinc-100 border-t-zinc-900 rounded-full animate-spin mb-4" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sincronizando endereços...</p>
                </div>
              ) : (
                <AddressList
                  addresses={addresses}
                  selectable
                  selectedId={selectedAddressId || undefined}
                  onSelect={handleSelectAddress}
                  onEdit={handleEditAddress}
                  onDelete={() => { }}
                />
              )}
            </div>
          </div>
        )}



        {/* Coupon */}
        <div className="bg-white rounded-[2.5rem] border border-zinc-100 overflow-hidden premium-shadow">
          <div className="px-6 py-5 bg-zinc-50/50 border-b border-zinc-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shadow-sm">
              <Tag className="w-5 h-5 text-zinc-900" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Vantagem Exclusiva</span>
          </div>
          <div className="p-8">
            <CouponInput
              onApply={handleApplyCoupon}
              onRemove={handleRemoveCoupon}
              appliedCoupon={appliedCoupon}
              error={couponError}
            />
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white rounded-[2.5rem] border border-zinc-100 overflow-hidden premium-shadow">
          <div className="px-6 py-5 bg-zinc-50/50 border-b border-zinc-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shadow-sm">
              <CreditCard className="w-5 h-5 text-zinc-900" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Meio de Pagamento</span>
          </div>
          <div className="p-8 grid grid-cols-1 gap-4">
            {[
              { value: 'pix' as PaymentMethod, label: 'Pix Instantâneo', icon: Smartphone, color: 'text-emerald-500 bg-emerald-50' },
              { value: 'card' as PaymentMethod, label: 'Cartão de Crédito', icon: CreditCard, color: 'text-blue-500 bg-blue-50' },
              { value: 'cash' as PaymentMethod, label: 'Dinheiro em Mãos', icon: Banknote, color: 'text-amber-500 bg-amber-50' },
            ].map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => setPaymentMethod(option.value)}
                  className={`w-full flex items-center gap-5 p-6 rounded-[2rem] border-2 transition-all duration-500 active:scale-[0.97] shadow-sm ${paymentMethod === option.value
                    ? 'border-zinc-900 bg-white shadow-2xl shadow-zinc-200 z-10'
                    : 'border-zinc-50 bg-zinc-50 hover:border-zinc-100 hover:bg-white'
                    }`}
                >
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${option.color} transition-all duration-500 ${paymentMethod === option.value ? 'scale-110 rotate-3' : ''}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className={`text-sm font-black uppercase tracking-widest ${paymentMethod === option.value ? 'text-zinc-900' : 'text-zinc-400'}`}>
                    {option.label}
                  </span>
                  <div className={`ml-auto w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${paymentMethod === option.value ? 'bg-zinc-900 border-zinc-900 scale-110' : 'border-zinc-200'}`}>
                    {paymentMethod === option.value && <Check className="w-4 h-4 text-white" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-[2.5rem] border border-zinc-100 overflow-hidden premium-shadow">
          <div className="px-6 py-5 bg-zinc-50/50 border-b border-zinc-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shadow-sm">
              <FileText className="w-5 h-5 text-zinc-900" />
            </div>
            <label htmlFor="order-notes" className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Notas Adicionais (Opcional)</label>
          </div>
          <div className="p-8">
            <textarea
              id="order-notes"
              name="order_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Deixar na portaria, campainha estragada, etc..."
              rows={4}
              className="w-full px-6 py-5 bg-zinc-50 rounded-3xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none resize-none"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Location Notice */}
        <div className="bg-zinc-900 text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12 group-hover:rotate-0 transition-transform duration-1000">
            <MapPin className="w-24 h-24" />
          </div>
          <div className="relative z-10 flex items-start gap-4">
            <div className="mt-1">
              <AlertCircle className="w-6 h-6 text-zinc-400" />
            </div>
            <div>
              <h4 className="text-sm font-black uppercase tracking-[0.2em] mb-2">Aviso de Região</h4>
              <p className="text-xs font-medium text-zinc-400 leading-relaxed uppercase tracking-tighter">
                Nossos serviços de entrega premium estão ativos exclusivamente em <span className="text-white font-black">Monte Carmelo, MG</span>.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Spacer to prevent overlap by the sticky footer on mobile */}
      <div className="h-24 lg:hidden" aria-hidden="true" />

      {/* Order Summary - Fixed Bottom Bar */}
      <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom,0px))] left-0 right-0 bg-white/95 backdrop-blur-3xl border-t border-zinc-100 p-4 pb-8 md:bottom-24 md:max-w-screen-md md:mx-auto md:rounded-[2.5rem] md:border md:pb-12 z-[55] shadow-[0_-20px_50px_rgba(0,0,0,0.1)] rounded-t-[2.5rem]">
        <div className="max-w-screen-md mx-auto">
          <div className="flex items-center justify-between mb-4 px-1">
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 leading-none mb-1">Total a Pagar</span>
              <span className="text-2xl font-black tracking-tighter text-zinc-900 leading-none">
                R$ {finalTotal.toFixed(2).replace('.', ',')}
              </span>
            </div>
            {discount > 0 && (
              <div className="px-3 py-1 bg-red-500 text-white text-[10px] font-black rounded-full uppercase tracking-wider">
                -R$ {discount.toFixed(2).replace('.', ',')} OFF
              </div>
            )}
          </div>

          <button
            onClick={() => {
              haptic.medium();
              handleSubmitEvent();
            }}
            disabled={!isValid || isSubmitting}
            className={cn(
              "w-full h-14 transition-all duration-500 active:scale-[0.98] shadow-2xl flex items-center justify-center gap-2 rounded-3xl uppercase tracking-[0.2em] font-black text-xs",
              (!isValid || isSubmitting)
                ? "bg-zinc-200 text-zinc-500 cursor-not-allowed border border-zinc-300 shadow-none opacity-100"
                : "bg-zinc-900 text-white hover:bg-black shadow-zinc-200"
            )}
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Finalizar Pedido
                <ArrowLeft className="w-5 h-5 rotate-180" />
              </>
            )}
          </button>
        </div>
      </div>
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

function SuccessView({ orderId, appliedCoupon, discount, onNavigate }: Readonly<SuccessViewProps>) {

  return (
    <div className="min-h-full bg-white flex flex-col pb-44">
      <div className="relative mb-12 group">
        <div className="absolute inset-0 bg-emerald-100 rounded-2xl scale-[2.5] blur-3xl opacity-30 group-hover:opacity-50 transition-opacity duration-1000" />
        <div className="relative w-32 h-32 bg-emerald-50 rounded-2xl flex items-center justify-center border-4 border-white shadow-2xl group-hover:scale-110 transition-transform duration-700">
          <Check className="w-14 h-14 text-emerald-500" />
        </div>
        <div className="absolute -top-4 -right-4 w-8 h-8 bg-amber-400 rounded-full blur-xl animate-pulse" />
        <div className="absolute -bottom-2 -left-2 w-6 h-6 bg-primary/30 rounded-full blur-lg animate-pulse delay-500" />
      </div>

      <h2 className="text-4xl font-black text-zinc-900 mb-4 tracking-tighter leading-tight animate-in slide-in-from-bottom-4 duration-700">
        Pedido Celebreado!
      </h2>

      <div className="space-y-4 mb-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">
          Identificador: <span className="text-zinc-900">#{orderId.slice(-6).toUpperCase()}</span>
        </p>
        <div className="max-w-[300px] mx-auto">
          <p className="text-sm text-zinc-500 font-medium leading-relaxed">
            Sua escolha premium foi registrada. Agora, nossa equipe cuidará de cada detalhe da logística.
          </p>
        </div>
        {appliedCoupon && (
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-lg border border-emerald-100/50">
            Vantagem Ativa: R$ {discount.toFixed(2).replace('.', ',')} OFF
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 w-full max-w-xs animate-in slide-in-from-bottom-12 duration-1000">
        <button
          onClick={() => onNavigate('home')}
          className="h-16 bg-zinc-900 text-white text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-black transition-all shadow-3xl shadow-zinc-200 active:scale-95 flex items-center justify-center gap-3"
        >
          Retornar à Vitrine
          <ArrowLeft className="w-5 h-5 rotate-180" />
        </button>
        <button
          onClick={() => onNavigate('profile')}
          className="h-16 bg-white text-zinc-900 text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl border-2 border-zinc-100 hover:border-zinc-900 transition-all active:scale-95 flex items-center justify-center gap-3"
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
  onNewAddressSubmit: (data: Omit<Address, 'id' | 'user_id'>) => Promise<void>;
  onCancel: () => void;
}

function AddressSelectionView({ editingAddressId, addresses, onNewAddressSubmit, onCancel }: Readonly<AddressSelectionViewProps>) {

  return (
    <div className="min-h-screen bg-white pb-32 animate-in slide-in-from-right duration-500">
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="mb-8 overflow-hidden rounded-[2.5rem] bg-zinc-900 p-8 shadow-2xl relative group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-white/10 transition-colors" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full -ml-12 -mb-12 blur-xl" />

          <div className="relative z-10 flex flex-col">
            <h2 className="text-3xl font-black text-white tracking-tighter mb-1 flex items-center gap-2">
              {editingAddressId ? 'Editar Endereço' : 'Novo Endereço'}
              <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
            </h2>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 leading-tight">
              {editingAddressId ? 'Atualize os dados para entrega' : 'Onde entregaremos seu produto?'}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-[2.5rem] border border-zinc-100 p-6 shadow-sm">
          <AddressForm
            initialData={editingAddressId ? addresses.find(a => a.id === editingAddressId) : undefined}
            onSubmit={onNewAddressSubmit}
            onCancel={onCancel}
          />
        </div>

        <div className="mt-8 px-6 text-center">
          <p className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest leading-relaxed">
            Seus dados estão seguros e serão usados apenas para a logística de entrega.
          </p>
        </div>
      </div>
    </div>
  );
}
