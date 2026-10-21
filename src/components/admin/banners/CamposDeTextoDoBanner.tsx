import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Label } from "@/components/ui/label";
import type { Banner } from "@/types";
import type { Dispatch, SetStateAction } from "react";

export function CamposDeTextoDoBanner({
  formData,
  aoMudar,
}: {
  formData: Partial<Banner>;
  aoMudar: Dispatch<SetStateAction<Partial<Banner>>>;
}) {
  return (
    <section className="space-y-3" aria-label="Textos do banner">
      {(
        [
          ["title", "banner-title", "Título", 60],
          ["subtitle", "banner-subtitle", "Subtítulo", 80],
          ["buttonText", "banner-btn-text", "Texto do botão", 24],
          ["badgeText", "banner-badge", "Selo (opcional)", 20],
        ] as const
      ).map(([campo, id, rotulo, limite]) => (
        <div key={campo} className="space-y-1.5">
          <Label htmlFor={id} className="text-sm text-zinc-400">
            {rotulo}
          </Label>
          <LocalBufferedInput
            id={id}
            name={campo}
            // eslint-disable-next-line security/detect-object-injection -- campo vem só da lista literal acima.
            value={formData[campo] || ""}
            maxLength={limite}
            useShadcn
            className="min-h-12 rounded-2xl border-admin-border bg-admin-surface text-white"
            onFlush={(valor) =>
              aoMudar((prev) => ({ ...prev, [campo]: valor.slice(0, limite) }))
            }
          />
        </div>
      ))}
    </section>
  );
}
