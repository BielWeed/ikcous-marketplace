import { useStore } from "@/contexts/StoreContext";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { cn } from "@/lib/utils";
import { nucleoSemver } from "@/lib/versao-do-servidor";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Rocket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface UpdateNotificationProps {
  readonly show: boolean;
  readonly onUpdate: () => void;
  // UpdateNotification-138: sem isto o cartão era um modal sem saída —
  // "Depois" é o botão de escape (e o alvo do Escape do teclado, abaixo).
  readonly onSnooze: () => void;
  readonly currentVersion?: string;
  readonly newVersion?: string | null;
}

const TITULO_ID = "update-notification-titulo";

declare const __APP_VERSION__: string;
// Mesmo padrão de useUpdateCheck/recuperacao-chunk: o `define` mora no build;
// fora dele (runner de teste), o componente segue de pé.
const VERSAO_DO_APP =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

export function UpdateNotification({
  show,
  onUpdate,
  onSnooze,
  currentVersion,
  newVersion,
}: UpdateNotificationProps) {
  // Nome da loja em runtime: banco (config.storeName) com fallback no branding do build
  const { config } = useStore();
  // Mesma regra das outras quatro telas (revisao 20260825-1015, achado 2):
  // string VAZIA tambem e "sem nome" — `??` devolveria "" e a frase
  // sairia com buraco (" Novidades..."). `?.trim() ||` cai no fallback.
  const appName = nomeDaLoja(config);
  const [isUpdating, setIsUpdating] = useState(false);

  // O selo de→para mostra o NÚCLEO semver limpo ("1.31.0 → 1.32.0"). Era
  // `v.slice(-6)`: como a versão de build é "1.32.0-sha.2526bdd", o lojista
  // via o fragmento do hash ("526bdd") — o "código estranho" da peça de
  // 14/09. Sem núcleo legível de algum lado — ou com os DOIS núcleos IGUAIS
  // (build novo da mesma semver, peça 22/09), que viraria a seta mentirosa
  // "1.5.1 → 1.5.1" — o selo NÃO nasce (nada de inventar código na tela).
  const fromVer = nucleoSemver(currentVersion || VERSAO_DO_APP);
  const toVer = nucleoSemver(newVersion);

  // Peça 22/09: acionamento ÚNICO e IMEDIATO — fora o atraso artificial de
  // 1200ms e a barra de progresso simulada (0→100% inventados; o número
  // chegava a 100% antes de qualquer evidência de instalação). O apply real
  // (aplicarAtualizacaoPendenteERecarregar) tem o próprio prazo de
  // segurança e recarrega UMA vez; enquanto isso, este estado de espera é
  // honesto — sem porcentagem e sem afirmar sucesso.
  const handleUpdate = useCallback(() => {
    setIsUpdating(true);
    onUpdate();
  }, [onUpdate]);

  // Diálogo de verdade (UpdateNotification-138): foco preso nos dois botões
  // e Escape == "Depois". O foco inicial vai para "Depois" (não para a ação
  // que já dispara o reload) — um Enter batido sem querer assim que o
  // cartão nasce não pode destruir o formulário que o lojista estava
  // preenchendo.
  const botaoDepoisRef = useRef<HTMLButtonElement>(null);
  const botaoAtualizarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!show || isUpdating) return;
    botaoDepoisRef.current?.focus();
  }, [show, isUpdating]);

  useEffect(() => {
    if (!show) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Enquanto instala (isUpdating), não há mais "depois" possível —
        // o reload já está a caminho e cancelar no meio deixaria o SW
        // preso em estado incerto.
        if (isUpdating) return;
        e.preventDefault();
        onSnooze();
        return;
      }
      if (e.key !== "Tab" || isUpdating) return;
      // Só dois elementos focáveis e o foco nunca escapa para trás do
      // backdrop. A DOM ordem é [Atualizar, Depois]: as transições NATIVAS
      // são Atualizar→Depois (Tab) e Depois→Atualizar (Shift+Tab) — as que
      // FUGEM do diálogo são Tab@Depois (último elemento: o navegador mandaria
      // o foco para fora do cartão) e Shift+Tab@Atualizar (primeiro: fugiria
      // para trás). São exatamente as duas que o preventDefault segura.
      const foco = document.activeElement;
      if (!e.shiftKey && foco === botaoDepoisRef.current) {
        e.preventDefault();
        botaoAtualizarRef.current?.focus();
      } else if (e.shiftKey && foco === botaoAtualizarRef.current) {
        e.preventDefault();
        botaoDepoisRef.current?.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [show, isUpdating, onSnooze]);

  return (
    <AnimatePresence>
      {show && (
        <div className="pointer-events-none fixed inset-0 z-[10000] flex items-center justify-center p-4">
          {/* Mandatory backdrop for all updates now */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto absolute inset-0 bg-black/60 backdrop-blur-md"
          />

          {/* Notification Card */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={TITULO_ID}
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className={cn(
              "relative pointer-events-auto mx-4 overflow-hidden",
              "backdrop-blur-2xl border shadow-2xl",
              "w-full max-w-[340px] rounded-[2rem] p-6 bg-zinc-950/95 border-amber-500/30 text-white",
            )}
          >
            {/* Top shine */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

            <div className="flex flex-col items-center space-y-5 text-center">
              <div className="relative">
                <div className="absolute inset-0 animate-pulse rounded-full bg-amber-500/20 blur-2xl" />
                <div className="relative rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <Rocket className="size-8 text-amber-400 animate-bounce" />
                </div>
              </div>

              <div className="space-y-1.5 px-2">
                <h3
                  id={TITULO_ID}
                  className="text-lg font-black tracking-tight text-white"
                >
                  Nova Versão Disponível
                </h3>
                <p className="text-xs leading-relaxed text-zinc-300">
                  Uma nova atualização do {appName} está pronta para ser
                  instalada com melhorias de desempenho.
                </p>
              </div>

              {/* Version De→Para: só com AMBOS os núcleos legíveis e DIFERENTES */}
              {toVer && fromVer && toVer !== fromVer && (
                <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 font-mono text-xs">
                  <span className="text-zinc-400">{fromVer}</span>
                  <ArrowRight className="size-3 text-amber-400" />
                  <span className="font-black text-amber-300">{toVer}</span>
                </div>
              )}

              {/* Action Button & Progress */}
              <div className="w-full space-y-3 pt-2">
                {isUpdating ? (
                  <>
                    {/* Espera HONESTA (peça 22/09): barra indeterminada —
                        nenhuma porcentagem inventada, nenhum "100%" antes da
                        evidência. O anúncio vive em região aria-live para o
                        leitor de tela saber que a instalação começou. */}
                    <div className="h-2 w-full overflow-hidden rounded-full border border-amber-500/20 bg-zinc-900">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-amber-500 to-yellow-400" />
                    </div>
                    <div className="flex items-center justify-center px-1">
                      <p
                        aria-live="polite"
                        className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80"
                      >
                        Instalando atualização...
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      ref={botaoAtualizarRef}
                      type="button"
                      onClick={handleUpdate}
                      className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 text-zinc-950 font-black text-xs uppercase tracking-wider transition-all duration-200 hover:brightness-110 active:scale-[0.98] shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 cursor-pointer border border-amber-300/40"
                    >
                      <Rocket className="size-4 text-zinc-950" />
                      Atualizar Agora
                    </button>
                    {/* UpdateNotification-138: a saída do modal. Adia 1h em
                        vez de fechar de vez — needRefresh (useUpdateCheck)
                        nunca volta a false sozinho, então "fechar sem
                        adiar" reabriria o mesmo cartão no próximo render. */}
                    <button
                      ref={botaoDepoisRef}
                      type="button"
                      onClick={onSnooze}
                      className="h-9 w-full cursor-pointer rounded-xl bg-transparent text-xs font-bold uppercase tracking-wider text-zinc-400 transition-colors duration-200 hover:text-zinc-200"
                    >
                      Depois
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Bottom shine */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
