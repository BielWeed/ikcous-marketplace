import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";

export const CARTAO_AJUSTES =
  "rounded-3xl border border-white/10 bg-[#101013] p-4";
export const CARTAO_DESTAQUE_AJUSTES =
  "rounded-3xl border border-white/15 bg-gradient-to-br from-[#24242e] to-[#101013] p-4 shadow-xl";

export type MatizDeAjustes =
  | "azul"
  | "roxo"
  | "verde"
  | "laranja"
  | "rosa"
  | "ciano";
const MATIZES_AJUSTES = new Map<MatizDeAjustes, string>([
  ["azul", "border-blue-400/30 bg-blue-400/15 text-blue-300"],
  ["roxo", "border-violet-400/30 bg-violet-400/15 text-violet-300"],
  ["verde", "border-teal-400/30 bg-teal-400/15 text-teal-300"],
  ["laranja", "border-orange-400/30 bg-orange-400/15 text-orange-300"],
  ["rosa", "border-pink-400/30 bg-pink-400/15 text-pink-300"],
  ["ciano", "border-sky-400/30 bg-sky-400/15 text-sky-300"],
]);

export function IconeDeAjustes({
  icone: Icone,
  matiz = "azul",
}: {
  readonly icone: ComponentType<Pick<LucideProps, "className" | "strokeWidth">>;
  readonly matiz?: MatizDeAjustes;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${MATIZES_AJUSTES.get(matiz)}`}
    >
      <Icone className="size-5" strokeWidth={1.9} />
    </span>
  );
}
