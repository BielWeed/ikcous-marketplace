import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ position, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position={position || "top-center"}
      duration={2500}
      icons={{
        success: <CircleCheckIcon className="size-4.5 text-emerald-400" />,
        info: <InfoIcon className="size-4.5 text-blue-400" />,
        warning: <TriangleAlertIcon className="size-4.5 text-amber-400" />,
        error: <OctagonXIcon className="size-4.5 text-rose-400" />,
        loading: (
          <Loader2Icon className="size-4.5 animate-spin text-zinc-400" />
        ),
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-gradient-to-r group-[.toaster]:from-zinc-950 group-[.toaster]:via-zinc-900 group-[.toaster]:to-zinc-950 group-[.toaster]:text-white group-[.toaster]:border-zinc-800 group-[.toaster]:shadow-[0_8px_25px_rgba(0,0,0,0.4)] group-[.toaster]:rounded-full group-[.toaster]:backdrop-blur-xl group-[.toaster]:border group-[.toaster]:py-2.5 group-[.toaster]:px-4 group-[.toaster]:gap-3 group-[.toaster]:text-xs group-[.toaster]:font-semibold group-[.toaster]:tracking-tight transition-all duration-200 ease-out",
          description: "group-[.toast]:text-zinc-400 text-xs font-normal",
          actionButton:
            "group-[.toast]:bg-emerald-500 group-[.toast]:text-zinc-950 font-bold text-xs rounded-full px-3 py-1.5",
          cancelButton:
            "group-[.toast]:bg-zinc-800 group-[.toast]:text-zinc-300 font-medium text-xs rounded-full px-3 py-1.5",
        },
      }}
      style={
        {
          "--offset": "calc(var(--safe-area-top, 0px) + 64px)",
          "--normal-bg": "#18181b",
          "--normal-text": "#ffffff",
          "--normal-border": "#27272a",
          "--border-radius": "9999px",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
