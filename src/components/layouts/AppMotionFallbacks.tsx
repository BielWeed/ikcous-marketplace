import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * F1 "loja abre mais rápido" (frente glm-perf-1paint-0309, equipe
 * loja-rapida-0409, 04/09/2026).
 *
 * Este módulo concentra os TRÊS únicos usos de framer-motion que viviam
 * direto no App.tsx (nível do entry). Ele é carregado EXCLUSIVAMENTE por
 * `React.lazy`/`lazyWithPreload` a partir do App — o import estático de
 * framer-motion no entry puxava o chunk `vendor-motion` (~123 KB brutos /
 * ~40 KB gzip) para o pacote do primeiro paint de toda loja.
 *
 * As animações são AS MESMAS de antes (mesmos props, mesmos tempos, mesmos
 * variants — movidos verbatim); só mudou o ENDEREÇO do código. Os fallbacks
 * de cada uso estão no App.tsx:
 *  - MainTabsMotionShell: div absoluta vazia (mesma geometria do wrapper);
 *  - SecondaryViewMotionShell e RouteLoadingProgress: null (nada na tela
 *    até o chunk chegar — ambos só entram em cena durante navegação ou em
 *    navegadores sem View Transitions, onde o chunk já veio no boot).
 *
 * Este módulo NÃO pode passar a ser importado estaticamente por nada que
 * esteja no gráfico do entry — o teste
 * tests/front/perf-entrada-sem-animacao-no-1o-paint.test.ts cavalca a regra.
 */

const pageVariants = {
  initial: (custom: any) => {
    const direction =
      typeof custom === "string" ? custom : custom?.direction || "forward";
    if (direction === "none") return { opacity: 0 };
    return {
      x: direction === "forward" ? "100%" : "-30%",
      opacity: direction === "forward" ? 1 : 0.5,
      y: 0,
      willChange: "transform, opacity",
    };
  },
  animate: {
    x: 0,
    opacity: 1,
    y: 0,
    transitionEnd: {
      willChange: "auto",
    },
  },
  exit: (custom: any) => {
    const direction =
      typeof custom === "string" ? custom : custom?.direction || "forward";
    const oldScroll = typeof custom === "string" ? 0 : custom?.oldScroll || 0;
    const newScroll = typeof custom === "string" ? 0 : custom?.newScroll || 0;
    if (direction === "none") return { opacity: 0 };
    const offset = newScroll - oldScroll;
    return {
      x: direction === "forward" ? "-30%" : "100%",
      opacity: direction === "forward" ? 0.5 : 0,
      y: offset,
      position: "absolute" as const,
      width: "100%",
      top: 0,
      left: 0,
      willChange: "transform, opacity",
    };
  },
};

interface MainTabsMotionShellProps {
  readonly isMainTab: boolean;
  readonly duration: number;
  readonly children: ReactNode;
}

/**
 * Fallback (navegadores sem View Transitions) do container das abas
 * principais. Era um `<motion.div>` direto no App.tsx.
 */
export function MainTabsMotionShell({
  isMainTab,
  duration,
  children,
}: MainTabsMotionShellProps) {
  return (
    <motion.div
      className="absolute left-0 top-0 size-full overflow-hidden"
      initial={false}
      animate={
        isMainTab
          ? {
              opacity: 1,
              y: 0,
              pointerEvents: "auto",
              visibility: "visible",
            }
          : {
              opacity: 0,
              y: -8,
              pointerEvents: "none",
              transitionEnd: { visibility: "hidden" },
            }
      }
      transition={{
        duration,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

interface SecondaryViewMotionShellProps {
  readonly active: boolean;
  readonly viewKey: string;
  readonly direction: "forward" | "back" | "none";
  readonly transitionScroll: { oldScroll: number; newScroll: number };
  readonly duration: number;
  readonly children: ReactNode;
}

/**
 * Fallback (navegadores sem View Transitions) da troca de views
 * secundárias. Era o `<AnimatePresence>` + `<motion.div>` direto no
 * App.tsx — inclusive o `custom` no AnimatePresence, para o exit receber
 * a direção/scroll mais recentes.
 */
export function SecondaryViewMotionShell({
  active,
  viewKey,
  direction,
  transitionScroll,
  duration,
  children,
}: SecondaryViewMotionShellProps) {
  return (
    <AnimatePresence
      mode="popLayout"
      custom={{ direction, ...transitionScroll }}
    >
      {active && (
        <motion.div
          key={viewKey}
          custom={{ direction, ...transitionScroll }}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{
            type: "tween",
            ease: [0.16, 1, 0.3, 1],
            duration,
            y: { duration: 0 },
          }}
          className="flex min-h-full w-full flex-1 flex-col !outline-none focus:!outline-none"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface RouteLoadingProgressProps {
  readonly active: boolean;
}

/**
 * Barra de progresso dourada no topo durante carregamento de rota. Era o
 * `<AnimatePresence>` + `<motion.div>` do topo do return do App.tsx.
 */
export function RouteLoadingProgress({ active }: RouteLoadingProgressProps) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ width: "0%", opacity: 1 }}
          animate={{
            width: ["0%", "35%", "70%", "90%"],
            transition: {
              times: [0, 0.2, 0.6, 0.9],
              duration: 1.5,
              ease: "easeOut",
            },
          }}
          exit={{
            width: "100%",
            opacity: 0,
            transition: { duration: 0.25, ease: "easeOut" },
          }}
          className="fixed left-0 top-0 z-[99999] h-[3px] bg-gradient-to-r from-admin-gold via-amber-400 to-yellow-300 shadow-[0_1px_10px_rgba(212,175,55,0.6)]"
        />
      )}
    </AnimatePresence>
  );
}
