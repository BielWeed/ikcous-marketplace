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
        loading: <Loader2Icon className="size-4.5 animate-spin text-zinc-400" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-gradient-to-r group-[.toaster]:from-[#5C061E] group-[.toaster]:via-[#701A30] group-[.toaster]:to-[#400414] group-[.toaster]:text-white group-[.toaster]:border-[#C74156]/40 group-[.toaster]:shadow-[0_8px_25px_rgba(92,6,30,0.38)] group-[.toaster]:rounded-full group-[.toaster]:backdrop-blur-xl group-[.toaster]:border group-[.toaster]:py-2.5 group-[.toaster]:px-4 group-[.toaster]:gap-3 group-[.toaster]:text-xs group-[.toaster]:font-semibold group-[.toaster]:tracking-tight transition-all duration-200 ease-out",
          description: "group-[.toast]:text-rose-200/80 text-xs font-normal",
          actionButton:
            "group-[.toast]:bg-[#C74156] group-[.toast]:text-white font-bold text-xs rounded-full px-3 py-1.5",
          cancelButton:
            "group-[.toast]:bg-[#5C061E] group-[.toast]:text-rose-200 font-medium text-xs rounded-full px-3 py-1.5",
        },
      }}
      style={
        {
          "--offset": "calc(var(--safe-area-top, 0px) + 64px)",
          "--normal-bg": "#5C061E",
          "--normal-text": "#ffffff",
          "--normal-border": "rgba(199, 65, 86, 0.4)",
          "--border-radius": "9999px",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
