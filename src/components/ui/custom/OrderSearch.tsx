import { useOrders } from "@/hooks/useOrders";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { mascaraWhatsappBr } from "@/lib/telefone-br";
import { cn } from "@/lib/utils";
import type { Order, View } from "@/types";
import { haptic } from "@/utils/haptic";
import {
  ArrowRight,
  ChevronRight,
  Hash,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * O número do pedido aparece como "#3884BE" no comprovante e no WhatsApp
 * (src/lib/numero-do-pedido.ts). Quem copia assim não pode ser recusado por
 * causa do "#" (nem de espaço): tira os dois ANTES de conferir e de enviar —
 * o servidor continua recebendo só letras e números do ID.
 */
const limparFragmentoDoPedido = (valor: string) =>
  valor.replaceAll(/[#\s]/g, "");

interface OrderSearchProps {
  onNavigate: (view: View) => void;
  title?: string;
  description?: string;
  onOrdersFound?: (orders: Order[]) => void;
  /**
   * WhatsApp da loja (`config.whatsappNumber`), para o aviso de quem comprou
   * sem conta. Opcional: sem ele (ou curto demais) o aviso vira só instrução.
   */
  whatsappDaLoja?: string | null;
}

export function OrderSearch({
  onNavigate,
  title = "Acesse sua conta",
  description = "Faça login para ver seu histórico completo automaticamente e gerenciar seus pedidos.",
  onOrdersFound,
  whatsappDaLoja,
}: OrderSearchProps) {
  const { generateOrderOtp, fetchOrdersByOtp } = useOrders(true, false);
  const [tab, setTab] = useState<"login" | "guest">("login");

  // Guest fields
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [orderFragment, setOrderFragment] = useState("");
  const [otp, setOtp] = useState("");

  // Loading/Wizard states
  const [step, setStep] = useState<"request" | "verify">("request");
  const [isLoading, setIsLoading] = useState(false);

  const handleWhatsappChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = mascaraWhatsappBr(e.target.value, whatsapp);
    setWhatsapp(formatted);
  };

  const lojaAtendePorWhatsapp = lojaTemWhatsapp(whatsappDaLoja);

  // Quem comprou SEM conta não tem e-mail gravado no pedido (a compra da
  // convidada nunca o coleta), então o rastreio abaixo nunca o acha — o aviso
  // diz isso antes de ela digitar e leva ao que funciona: a loja. Mesmo
  // mecanismo de CheckoutView/SuccessView (wa.me com DDI 55, sem opener).
  const handleFalarComALoja = () => {
    if (!lojaAtendePorWhatsapp) return;
    let numero = (whatsappDaLoja || "").replaceAll(/\D/g, "");
    if (numero.length === 10 || numero.length === 11) numero = `55${numero}`;
    const mensagem =
      "Olá! Fiz um pedido sem criar conta e quero acompanhar. O identificador do pedido é: ";
    globalThis.open(
      `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    haptic.light();

    if (!email.trim() || !email.includes("@")) {
      toast.error("Por favor, informe um e-mail válido.");
      return;
    }

    const cleanWhatsapp = whatsapp.replaceAll(/\D/g, "");
    if (cleanWhatsapp.length < 10) {
      toast.error("Por favor, informe um WhatsApp válido com DDD.");
      return;
    }

    // O ID do pedido deixou de ser opcional na AUTH-010 (#118). Enquanto ele
    // podia vir vazio, o `ILIKE '%' || fragmento` da RPC casava qualquer
    // pedido, e o código saía amarrado a nada. O mesmo mínimo de 6 e o mesmo
    // alfabeto de UUID são exigidos no banco — esta checagem é conveniência,
    // não a defesa.
    const fragmento = limparFragmentoDoPedido(orderFragment);
    if (!/^[0-9a-fA-F-]{6,}$/.test(fragmento)) {
      toast.error(
        "Informe ao menos os 6 últimos caracteres do ID do pedido, que estão no seu comprovante.",
      );
      return;
    }

    setIsLoading(true);
    try {
      const success = await generateOrderOtp(
        email.trim().toLowerCase(),
        cleanWhatsapp,
        fragmento,
      );
      if (success) {
        toast.success("Código de verificação enviado para seu e-mail!");
        setStep("verify");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    haptic.medium();

    if (otp.length < 6) {
      toast.error("O código de verificação deve conter 6 dígitos.");
      return;
    }

    setIsLoading(true);
    try {
      // O mesmo trio que pediu o código: a verificação só alcança o código
      // do pedido que confere com ele (get_orders_by_otp_v2).
      const foundOrders = await fetchOrdersByOtp(
        email.trim().toLowerCase(),
        otp.trim(),
        {
          whatsapp: whatsapp.replaceAll(/\D/g, ""),
          fragmento: limparFragmentoDoPedido(orderFragment),
        },
      );
      if (foundOrders && foundOrders.length > 0) {
        toast.success(`${foundOrders.length} pedido(s) encontrado(s)!`);
        // Store in session cache
        sessionStorage.setItem(
          "guest_tracked_orders",
          JSON.stringify(foundOrders),
        );
        if (onOrdersFound) {
          onOrdersFound(foundOrders);
        }
      }
      // Achado C da revisão de 22/08/2026, fechado pelo B2 da revisão de
      // A2-fix3 (22/08/2026): NENHUM toast fixo aqui quando `foundOrders`
      // vem vazio. `fetchOrdersByOtp` (useOrders.ts) mostra o toast certo
      // para TODA causa que devolve `[]` — código errado (com a contagem de
      // tentativas restantes), bloqueio por excesso de tentativas, falha em
      // CHEGAR à verificação (rede caiu, servidor fora do ar —
      // `mensagemAmigavelErroOtp`), e também o caso raro de a verificação
      // ter dado certo sem sobrar pedido (corrida dentro da própria RPC —
      // ver o comentário no ramo `data.ok === true` de fetchOrdersByOtp).
      // Um segundo toast fixo aqui, sempre "verifique o código", era
      // CONTRADITÓRIO na falha de rede: mandava conferir um código que
      // nunca chegou a ser verificado. Um terceiro caso — o ramo defensivo
      // de useOrders.ts (resposta em formato de array cru, sem o envelope
      // `{ ok, orders }`) — está MORTO contra o banco vivo hoje: nenhuma FK
      // nem contrato de schema garante isso para sempre, então "morto hoje"
      // não é "morto para sempre"; quem for reabrir essa possibilidade tem
      // de reabrir o toast junto.
      // Nenhum teste do par prova as duas metades juntas (que o hook toasta
      // E que a tela não duplica) na mesma execução —
      // order-search-nao-repete-toast-de-erro-que-ja-foi-avisado.test.tsx
      // mocka `fetchOrdersByOtp` inteiro, então o toast interno do hook
      // nunca roda ali; ele prova só a metade "não duplica".
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4 xs:space-y-6">
      <div className="group relative overflow-hidden rounded-3xl border border-zinc-100 bg-zinc-50/20 p-4 text-slate-800 xs:p-6">
        <div className="absolute right-0 top-0 size-32 -translate-y-1/2 translate-x-1/2 rounded-full bg-secondary/5 blur-2xl transition-all duration-1000 group-hover:bg-secondary/10" />

        <div className="relative z-10 flex h-full flex-col">
          {/* Mode selector tab header */}
          <div className="mb-4 flex rounded-2xl border border-zinc-100 bg-zinc-50/50 p-1.5 xs:mb-6">
            <button
              type="button"
              onClick={() => {
                haptic.light();
                setTab("login");
              }}
              className={cn(
                "flex-1 py-2 text-[10px] xs:text-[11px] font-black uppercase tracking-[0.1em] rounded-xl transition-all duration-300",
                tab === "login"
                  ? "bg-primary text-white shadow-md"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              Entrar na Conta
            </button>
            <button
              type="button"
              onClick={() => {
                haptic.light();
                setTab("guest");
              }}
              className={cn(
                "flex-1 py-2 text-[10px] xs:text-[11px] font-black uppercase tracking-[0.1em] rounded-xl transition-all duration-300",
                tab === "guest"
                  ? "bg-primary text-white shadow-md"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              Rastrear sem Conta
            </button>
          </div>

          {tab === "login" ? (
            <div className="space-y-4">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-secondary/10 text-primary xs:size-12">
                <User className="size-5 text-primary xs:size-6" />
              </div>
              <div>
                <h3 className="mb-1 text-base font-black uppercase italic tracking-tighter xs:mb-2 xs:text-xl">
                  {title}
                </h3>
                <p className="mb-4 text-[10px] font-bold uppercase leading-relaxed tracking-widest text-slate-500 xs:mb-6 xs:text-[12px]">
                  {description}
                </p>
              </div>
              <button
                onClick={() => onNavigate("auth")}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all hover:bg-primary/90 active:scale-[0.98] xs:py-4 xs:text-[11px]"
              >
                Entrar
                <ChevronRight className="size-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {step === "request" ? (
                <form onSubmit={handleSendOtp} className="space-y-4">
                  <div>
                    <h3 className="mb-1 text-base font-black uppercase italic tracking-tighter xs:mb-2 xs:text-xl">
                      Rastrear Pedido
                    </h3>
                    <p className="mb-4 text-[10px] font-bold uppercase leading-relaxed tracking-widest text-slate-500 xs:text-[11px]">
                      Preencha as informações do pedido para receber um código
                      de validação.
                    </p>
                  </div>

                  <div className="space-y-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-900">
                    <p className="text-[11px] font-black uppercase tracking-wide">
                      Comprou sem criar conta?
                    </p>
                    <p className="text-[11px] font-medium leading-relaxed">
                      Este rastreio só encontra pedidos feitos com e-mail. Se
                      você comprou sem conta, fale com a loja e informe o
                      identificador do pedido (aparece ao finalizar a compra).
                      {lojaAtendePorWhatsapp
                        ? ""
                        : " Use o contato da loja que você já tem."}
                    </p>
                    {lojaAtendePorWhatsapp && (
                      <button
                        type="button"
                        onClick={() => {
                          haptic.light();
                          handleFalarComALoja();
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-600/30 bg-white py-2.5 text-[10px] font-black uppercase tracking-[0.15em] text-amber-800 transition-all active:scale-[0.98]"
                      >
                        Falar com a loja no WhatsApp
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-primary" />
                      <input
                        type="email"
                        required
                        placeholder="SEU E-MAIL"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-2xl border border-zinc-100 bg-white py-3 pl-11 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-800 placeholder-zinc-400 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                      />
                    </div>

                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-primary" />
                      <input
                        type="tel"
                        required
                        placeholder="SEU WHATSAPP"
                        value={whatsapp}
                        onChange={handleWhatsappChange}
                        className="w-full rounded-2xl border border-zinc-100 bg-white py-3 pl-11 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-800 placeholder-zinc-400 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                      />
                    </div>

                    <div className="relative">
                      <Hash className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-primary" />
                      <input
                        type="text"
                        required
                        minLength={6}
                        placeholder="ÚLTIMOS 6 DÍGITOS DO ID DO PEDIDO"
                        value={orderFragment}
                        onChange={(e) => setOrderFragment(e.target.value)}
                        className="w-full rounded-2xl border border-zinc-100 bg-white py-3 pl-11 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-800 placeholder-zinc-400 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-55 xs:text-[11px]"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Gerando Código...
                      </>
                    ) : (
                      <>
                        Enviar Código
                        <ArrowRight className="size-4" />
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-800">
                    <KeyRound className="size-4 flex-shrink-0 text-amber-600" />
                    <span className="text-[9px] font-bold uppercase tracking-wide xs:text-[10px]">
                      Código enviado para {email}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      placeholder="DIGITE O CÓDIGO DE 6 DÍGITOS"
                      value={otp}
                      onChange={(e) =>
                        setOtp(e.target.value.replace(/\D/g, ""))
                      }
                      className="w-full rounded-2xl border border-zinc-100 bg-white py-4 text-center text-lg font-black tracking-[0.3em] text-slate-800 transition-colors focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        haptic.light();
                        setStep("request");
                        setOtp("");
                      }}
                      className="flex-1 rounded-2xl border border-zinc-100 py-3.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 transition-all hover:bg-zinc-50/50 hover:text-slate-800 active:scale-[0.98]"
                    >
                      Voltar
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-55"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Verificando...
                        </>
                      ) : (
                        <>
                          Verificar
                          <ChevronRight className="size-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
