import { HelpCircle, type LucideIcon } from "lucide-react";
import type React from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface AdminHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  icon?: LucideIcon;
}

export function AdminHelpModal({
  isOpen,
  onClose,
  title,
  children,
  icon: Icon = HelpCircle,
}: AdminHelpModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("admin-modal-open");
      return () => {
        document.body.classList.remove("admin-modal-open");
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 text-left backdrop-blur-md duration-300 animate-in fade-in sm:p-6">
      <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/95 p-5 text-sm text-zinc-300 shadow-[0_0_50px_rgba(0,0,0,0.8)] duration-300 animate-in zoom-in-95 sm:max-h-[85vh] sm:rounded-[2.5rem] sm:p-8">
        {/* Header */}
        <div className="mb-4 flex shrink-0 items-center justify-between border-b border-white/5 pb-4">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.2em] text-admin-gold">
            <Icon className="size-5 animate-pulse text-admin-gold" />
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/50 text-sm font-bold text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto pb-6 pr-1 text-sm text-zinc-300">
          {children}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end border-t border-white/5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-admin-gold px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:bg-admin-gold/90"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
