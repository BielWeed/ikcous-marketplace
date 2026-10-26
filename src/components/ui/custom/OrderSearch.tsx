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

// Campo Tinta: 16 px (o iPhone dá zoom abaixo disso), 48 px de altura. O
// texto digitado fica em caixa normal; só o rótulo-exemplo vem em maiúsculas.
const campo =
  "h-12 w-full rounded-[14px] border border-input bg-muted/40 pl-11 pr-4 text-base text-foreground placeholder:text-sm placeholder:text-muted-foreground transition-colors focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20";

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
        // O cache é opcional: o código já foi validado no servidor.
        try {
          sessionStorage.setItem(
            "guest_tracked_orders",
            JSON.stringify(foundOrders),
          );
        } catch {
          console.warn("Não foi possível guardar os pedidos nesta sessão.");
        }
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
      <div className="rounded-[18px] border border-border bg-background p-4 text-foreground xs:p-6">
        <div className="flex h-full flex-col">
          {/* Mode selector tab header */}
          <div className="mb-5 flex rounded-2xl bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => {
                haptic.light();
                setTab("login");
              }}
              className={cn(
                "min-h-11 flex-1 rounded-xl text-sm font-semibold transition-colors",
                tab === "login"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
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
                "min-h-11 flex-1 rounded-xl text-sm font-semibold transition-colors",
                tab === "guest"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Rastrear sem Conta
            </button>
          </div>

          {tab === "login" ? (
            <div className="space-y-4">
              <div className="flex size-12 items-center justify-center rounded-[14px] bg-muted/40 text-foreground">
                <User className="size-6" />
              </div>
              <div>
                <h3 className="mb-2 text-xl font-bold tracking-tight">
                  {title}
                </h3>
                <p className="mb-4 text-base leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
              <button
                onClick={() => onNavigate("auth")}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-base font-semibold text-background transition-opacity hover:opacity-90 active:scale-[0.98]"
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
                    <h3 className="mb-2 text-xl font-bold tracking-tight">
                      Rastrear Pedido
                    </h3>
                    <p className="mb-4 text-base leading-relaxed text-muted-foreground">
                      Preencha as informações do pedido para receber um código
                      de validação.
                    </p>
                  </div>

                  <div className="space-y-2 rounded-[14px] border border-border p-3">
                    <p className="font-mono text-xs uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400">
                      Comprou sem criar conta?
                    </p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
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
                        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-solid border-border py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/40 active:scale-[0.98]"
                      >
                        Falar com a loja no WhatsApp
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="email"
                        required
                        aria-label="Seu e-mail"
                        autoComplete="email"
                        placeholder="SEU E-MAIL"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={campo}
                      />
                    </div>

                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="tel"
                        required
                        aria-label="Seu WhatsApp"
                        autoComplete="tel"
                        inputMode="tel"
                        placeholder="SEU WHATSAPP"
                        value={whatsapp}
                        onChange={handleWhatsappChange}
                        className={campo}
                      />
                    </div>

                    <div className="relative">
                      <Hash className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        required
                        minLength={6}
                        aria-label="Últimos 6 dígitos do ID do pedido"
                        placeholder="6 FINAIS DO ID DO PEDIDO"
                        value={orderFragment}
                        onChange={(e) => setOrderFragment(e.target.value)}
                        className={campo}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-base font-semibold text-background transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-55"
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
                  <div className="flex items-center gap-2 rounded-[14px] border border-border p-3 text-amber-700 dark:text-amber-400">
                    <KeyRound className="size-4 flex-shrink-0" />
                    <span className="min-w-0 break-words text-sm font-medium">
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
                      aria-label="Código de 6 dígitos"
                      placeholder="DIGITE O CÓDIGO DE 6 DÍGITOS"
                      value={otp}
                      onChange={(e) =>
                        setOtp(e.target.value.replace(/\D/g, ""))
                      }
                      className="h-14 w-full rounded-[14px] border border-input bg-muted/40 text-center text-lg font-bold tracking-[0.3em] text-foreground transition-colors placeholder:text-sm placeholder:font-medium placeholder:tracking-normal placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
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
                      className="h-[52px] flex-1 rounded-2xl border border-solid border-border text-base font-semibold text-foreground transition-colors hover:bg-muted/40 active:scale-[0.98]"
                    >
                      Voltar
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="flex h-[52px] flex-[2] items-center justify-center gap-2 rounded-2xl bg-foreground text-base font-semibold text-background transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-55"
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
