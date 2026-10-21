import { cn } from "@/lib/utils";
import type { Banner } from "@/types";

export function PreviaImagemPropria({
  formData,
  comTexto,
}: { formData: Partial<Banner>; comTexto: boolean }) {
  return (
    <div className="relative aspect-[21/9] w-full select-none overflow-hidden rounded-xl border border-admin-border bg-zinc-900 shadow-inner motion-reduce:transition-none">
      {formData.imageUrl ? (
        <img
          src={formData.imageUrl}
          alt="Banner Preview"
          className="size-full object-cover"
        />
      ) : (
        <div
          data-tema-fixo=""
          className="flex size-full items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black p-4 text-center"
        >
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-zinc-600">
            {!comTexto
              ? "Insira uma imagem de banner para pré-visualizar"
              : "Envie uma imagem para pré-visualizar"}
          </span>
        </div>
      )}

      {comTexto && formData.showTextOverlay !== false && (
        <>
          <div
            className="absolute inset-0 motion-safe:transition-all"
            style={{
              backgroundColor: formData.overlayColor || "#000000",
              opacity: (formData.overlayOpacity ?? 40) / 100,
            }}
          />

          <div
            className={cn(
              "absolute inset-0 flex flex-col p-3.5 sm:p-5 motion-safe:transition-all",
              (formData.templateType || "default") === "split_center" &&
                "items-center justify-center text-center",
              formData.templateType === "split_right" &&
                "items-end justify-center text-right",
              formData.templateType === "split_left" &&
                "items-start justify-center text-left",
              formData.templateType === "glassmorphic" &&
                "items-center justify-center p-3 text-center",
              (formData.templateType || "default") === "default" &&
                "items-start justify-end text-left",
            )}
          >
            <div
              className={cn(
                "flex flex-col gap-1 max-w-[88%] motion-safe:transition-all",
                formData.templateType === "glassmorphic" &&
                  "rounded-xl border border-admin-border-strong bg-black/40 p-3 backdrop-blur-md shadow-xl",
              )}
            >
              {formData.badgeText && (
                <span
                  className="w-max rounded-md bg-admin-gold px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-black shadow-md self-start"
                  style={{
                    alignSelf:
                      formData.templateType === "split_center" ||
                      formData.templateType === "glassmorphic"
                        ? "center"
                        : formData.templateType === "split_right"
                          ? "flex-end"
                          : "flex-start",
                  }}
                >
                  {formData.badgeText}
                </span>
              )}

              <h2
                className={cn(
                  "text-xs sm:text-base md:text-lg font-black leading-tight tracking-wide transition-colors",
                  formData.fontFamily || "font-sans",
                )}
                style={{
                  color: formData.titleColor || "#FFFFFF",
                  textShadow:
                    formData.templateType === "neon_glow"
                      ? `0 0 12px ${formData.titleColor || "hsl(var(--admin-gold-fill, var(--admin-gold)))"}`
                      : "0 2px 4px rgba(0,0,0,0.6)",
                }}
              >
                {formData.title || "Título da Sua Campanha"}
              </h2>

              <p
                className={cn(
                  "text-[11px] sm:text-xs font-medium leading-snug opacity-90 transition-colors line-clamp-2",
                  formData.fontFamily || "font-sans",
                )}
                style={{
                  color: formData.subtitleColor || "#9CA3AF",
                  textShadow: "0 1px 3px rgba(0,0,0,0.7)",
                }}
              >
                {formData.subtitle ||
                  "Subtítulo atraente descrevendo sua oferta especial."}
              </p>

              {formData.buttonText && (
                <div className="mt-0.5">
                  <span
                    className={cn(
                      "inline-block rounded-lg px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider shadow-lg transition-transform motion-safe:hover:scale-105",
                      formData.fontFamily || "font-sans",
                    )}
                    style={{
                      backgroundColor:
                        formData.buttonBgColor ||
                        "hsl(var(--admin-gold-fill, var(--admin-gold)))",
                      color: formData.buttonTextColor || "#000000",
                      boxShadow:
                        formData.templateType === "neon_glow"
                          ? `0 0 10px ${formData.buttonBgColor || "hsl(var(--admin-gold-fill, var(--admin-gold)))"}`
                          : undefined,
                    }}
                  >
                    {formData.buttonText}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
