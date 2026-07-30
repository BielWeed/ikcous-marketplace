import { usePushNotifications } from "@/hooks/usePushNotifications";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Heart, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface PushNotificationBannerProps {
  readonly currentView?: string;
  readonly isKeyboardOpen?: boolean;
}

const DISMISS_KEY = "ikcous_push_banner_dismissed_until";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias de cooldown se a cliente fechar

export function PushNotificationBanner({
  currentView = "",
  isKeyboardOpen = false,
}: PushNotificationBannerProps) {
  const { isSupported, permission, subscription, subscribe } =
    usePushNotifications();
  const [isVisible, setIsVisible] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);

  useEffect(() => {
    // 1. Suporte do navegador obrigatorio
    if (!isSupported) return;

    // 2. Nao exibir em telas administrativas ou sucesso de pedido
    if (currentView.startsWith("admin") || currentView === "order-success") {
      setIsVisible(false);
      return;
    }

    // 3. Se ja inscrito ou permissao negada/concedida no navegador
    if (subscription || permission === "denied" || permission === "granted") {
      setIsVisible(false);
      return;
    }

    // 4. Verificar se a cliente dispensou nos ultimos 7 dias
    try {
      const dismissedUntil = localStorage.getItem(DISMISS_KEY);
      if (dismissedUntil && Date.now() < Number.parseInt(dismissedUntil, 10)) {
        setIsVisible(false);
        return;
      }
    } catch {
      // Ignorar erros de localStorage/sandbox
    }

    // Delay de 2.5s para surgimento suave apos o carregamento inicial da pagina
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 2500);

    return () => clearTimeout(timer);
  }, [isSupported, permission, subscription, currentView]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    try {
      const nextDismiss = Date.now() + DISMISS_DURATION_MS;
      localStorage.setItem(DISMISS_KEY, nextDismiss.toString());
    } catch {
      // Ignorar erros de storage
    }
  }, []);

  const handleSubscribe = useCallback(async () => {
    setIsSubscribing(true);
    try {
      const result = await subscribe();
      if (result) {
        setIsVisible(false);
      }
    } catch (err) {
      console.error("[PushBanner] Erro ao se inscrever:", err);
    } finally {
      setIsSubscribing(false);
    }
  }, [subscribe]);

  if (!isVisible || isKeyboardOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 80, opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className={cn(
          "fixed left-4 right-4 z-[999] mx-auto max-w-md",
          "bottom-20 md:bottom-6", // Posicionado de forma elegante acima da BottomNav
        )}
      >
        <div className="relative overflow-hidden rounded-2xl border border-secondary/25 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-2xl text-white">
          {/* Linha superior com brilho gradiente secondary */}
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-secondary/70 to-transparent" />

          {/* Botao de fechar (X) */}
          <button
            onClick={handleDismiss}
            className="absolute right-3 top-3 rounded-full p-1 text-zinc-400 hover:bg-secondary/10 hover:text-secondary transition-colors"
            title="Fechar"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>

          <div className="flex items-start gap-3.5 pr-6">
            {/* Icone de sino animado com tema secondary e glow */}
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 animate-ping rounded-xl bg-secondary/20 blur-sm" />
              <div className="relative flex size-11 items-center justify-center rounded-xl border border-secondary/30 bg-secondary/10 text-secondary shadow-inner">
                <BellRing className="size-5 animate-bounce" />
              </div>
            </div>

            {/* Conteudo do banner de notificacoes da IKCOUS */}
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h4 className="text-xs font-black uppercase tracking-wider text-white">
                  IKCOUS Novidades 🔔
                </h4>
              </div>
              <p className="text-[11px] leading-snug text-zinc-300">
                Fique por dentro de{" "}
                <strong className="text-secondary font-semibold">
                  promoções
                </strong>
                ,{" "}
                <strong className="text-secondary font-semibold">
                  novidades
                </strong>{" "}
                e{" "}
                <strong className="text-secondary font-semibold">
                  ofertas exclusivas
                </strong>{" "}
                direto no seu celular!
              </p>

              {/* Botoes de Acao */}
              <div className="mt-3 flex items-center gap-2 pt-1">
                <button
                  onClick={handleSubscribe}
                  disabled={isSubscribing}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-[10px] font-black uppercase tracking-wider text-white shadow-lg shadow-black/25 hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50"
                >
                  {isSubscribing ? (
                    <span className="animate-pulse">Ativando...</span>
                  ) : (
                    <>
                      <Heart className="size-3.5 fill-white/80" />
                      Quero Receber!
                    </>
                  )}
                </button>

                <button
                  onClick={handleDismiss}
                  className="rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-[10px] font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                >
                  Agora Não
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
