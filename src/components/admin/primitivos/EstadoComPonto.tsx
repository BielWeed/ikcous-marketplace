import {
  type Superficie,
  type TomDeEstado,
  classeDoPonto,
  classeDoTexto,
  tomDoValor,
} from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";

/** Estado em uma linha: pontinho (aria-hidden) + texto na cor do tom. Sem fundo nem borda. */
export function EstadoComPonto({
  tom,
  texto,
  superficie = "painel",
  className,
}: {
  readonly tom: TomDeEstado;
  readonly texto: string;
  readonly superficie?: Superficie;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold",
        classeDoTexto(tom, superficie),
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-[7px] shrink-0 rounded-full",
          classeDoPonto(tom, superficie),
        )}
      />
      {texto}
    </span>
  );
}

/** Variação com seta (aria-hidden) + texto; o tom vem do sinal do valor. */
export function VariacaoComSeta({
  valor,
  texto,
  superficie = "painel",
  className,
}: {
  readonly valor: number;
  readonly texto: string;
  readonly superficie?: Superficie;
  readonly className?: string;
}) {
  const tom = tomDoValor(valor);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold",
        classeDoTexto(tom, superficie),
        className,
      )}
    >
      {tom !== "neutro" && (
        <svg
          aria-hidden="true"
          viewBox="0 0 8 8"
          className="size-2 shrink-0 fill-current"
        >
          <path d={tom === "positivo" ? "M4 1 8 7H0z" : "M4 7 0 1h8z"} />
        </svg>
      )}
      {texto}
    </span>
  );
}
