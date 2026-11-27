import { cn } from "@/lib/utils";
import { AlertCircle, ChevronDown } from "lucide-react";
import { ListaDeEscolha } from "./ListaDeEscolha";
import type { PropsDoCampoDeEscolha } from "./tipos";

/** A mensagem de `erro={true}`. */
export const ERRO_PADRAO = "Escolha uma opção";

/**
 * O campo de escolha do painel, no lugar do `<select>`: o MESMO desenho do
 * `Campo` do Financeiro (`financeiro/partes.tsx`) — 72px, rótulo flutuante em
 * cima, ajuda e erro embaixo — com chevron. Aberto, borda, rótulo e chevron
 * ficam dourados; com erro, borda e rótulo vermelhos e a mensagem em
 * `${id}-erro` (`role=alert`).
 *
 * O nome do botão para o leitor de tela é rótulo + valor
 * (`aria-labelledby="{id}-rotulo {id}-valor"`), e o `<label for>` mantém o
 * campo achável pelo rótulo.
 */
export function CampoDeEscolha<V extends string>({
  erro,
  ajuda,
  className,
  ...props
}: PropsDoCampoDeEscolha<V>) {
  const { id } = props;
  const mensagem = erro === true ? ERRO_PADRAO : erro || null;
  const idDoRotulo = `${id}-rotulo`;
  const idDoValor = `${id}-valor`;
  const idDoErro = `${id}-erro`;
  const idDaAjuda = `${id}-ajuda`;
  const descricao = mensagem ? idDoErro : ajuda ? idDaAjuda : undefined;

  return (
    <div className={cn("relative flex min-w-0 flex-col gap-2", className)}>
      <ListaDeEscolha
        {...props}
        gatilho={({ botao, aberta, escolhida, textoMostrado }) => {
          const Icone = escolhida?.icone;
          return (
            <>
              <label
                id={idDoRotulo}
                htmlFor={id}
                className={cn(
                  "pointer-events-none absolute inset-x-3 top-3 z-10 truncate pr-8 text-xs font-medium leading-tight",
                  aberta
                    ? "lista-de-escolha-ouro"
                    : mensagem
                      ? "text-red-400"
                      : "text-zinc-400",
                )}
              >
                {props.rotulo}
              </label>
              {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- o botão faz o papel do <select>: o erro de "escolha uma opção" precisa chegar como inválido (plano 0.6) */}
              <button
                {...botao}
                aria-labelledby={`${idDoRotulo} ${idDoValor}`}
                aria-describedby={descricao}
                aria-invalid={mensagem ? true : undefined}
                className={cn(
                  "lista-de-escolha-anel flex min-h-[72px] w-full min-w-0 items-center gap-2 rounded-2xl border border-admin-border-strong bg-admin-raised px-3 pb-2 pt-7 text-left text-base outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  aberta
                    ? "lista-de-escolha-aberta"
                    : mensagem
                      ? "border-red-400"
                      : undefined,
                )}
              >
                {Icone ? (
                  <Icone
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                ) : null}
                {escolhida?.sigla ? (
                  <span
                    aria-hidden="true"
                    className="inline-flex h-6 min-w-8 shrink-0 items-center justify-center rounded-md bg-admin-hover px-1.5 text-[11px] font-bold text-muted-foreground"
                  >
                    {escolhida.sigla}
                  </span>
                ) : null}
                <span
                  id={idDoValor}
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    escolhida ? "lista-de-escolha-texto" : "text-zinc-400",
                  )}
                >
                  {textoMostrado}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-5 shrink-0 -translate-y-2.5 transition-transform",
                    aberta
                      ? "lista-de-escolha-ouro rotate-180"
                      : "text-zinc-400",
                  )}
                />
              </button>
            </>
          );
        }}
      />
      {ajuda && !mensagem ? (
        <p id={idDaAjuda} className="text-xs leading-relaxed text-zinc-400">
          {ajuda}
        </p>
      ) : null}
      {mensagem ? (
        <p
          id={idDoErro}
          role="alert"
          className="flex items-start gap-1 text-xs font-medium text-red-400"
        >
          <AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />
          {mensagem}
        </p>
      ) : null}
    </div>
  );
}
