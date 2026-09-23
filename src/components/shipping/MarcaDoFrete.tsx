import {
  LOGO_SOBRE_FUNDO_ESCURO,
  logoDaTransportadora,
  logoDoAgregador,
} from "@/lib/marca-do-frete";
import { cn } from "@/lib/utils";
// MARCA DO FRETE (peça 3, tarefa "cart-frete-logos", 23/09/2026) — os dois
// componentes reutilizáveis que desenham o logo oficial da transportadora e
// o selo do agregador nos cartões de cotação. Puramente visual: recebem o
// que `marcaDoFrete` (src/lib/marca-do-frete.ts) já normalizou, não decidem
// nada sobre o frete em si. Quem integra nas telas (carrinho, checkout,
// painel admin) é outra peça — este arquivo só entrega os componentes.
import { Truck } from "lucide-react";
import { useState } from "react";

export interface LogoDaTransportadoraProps {
  /** Slug reconhecido (`LOGO_TRANSPORTADORA`), ou `null` para a desconhecida. */
  slug: string | null;
  /** Nome da transportadora — vira o `alt` da imagem. */
  nome: string;
  /** Altura do badge em pixels; a largura acompanha o `object-contain`. */
  tamanho?: number;
  className?: string;
}

/**
 * Logo oficial da transportadora, num badge de fundo claro (contraste
 * garantido no tema claro, no escuro e no cartão SELECIONADO, que usa fundo
 * `bg-primary`/texto branco). Sem asset (transportadora desconhecida) ou
 * falha de carregamento: cai num ícone de caminhão, decorativo — o nome já
 * aparece no texto do cartão (título vindo de `marcaDoFrete`).
 */
export function LogoDaTransportadora({
  slug,
  nome,
  tamanho = 32,
  className,
}: LogoDaTransportadoraProps) {
  const caminho = slug ? logoDaTransportadora(slug) : undefined;
  const [falhouAoCarregar, setFalhouAoCarregar] = useState(false);
  const mostrarFallback = !caminho || falhouAoCarregar;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-white px-1.5",
        className,
        // Depois do className: o fundo escuro do logo de texto branco vence
        // qualquer borda/fundo que a tela passe.
        !mostrarFallback &&
          slug &&
          LOGO_SOBRE_FUNDO_ESCURO.has(slug) &&
          "bg-zinc-900",
      )}
      style={{ height: tamanho, minWidth: Math.round(tamanho * 1.3) }}
    >
      {mostrarFallback ? (
        <Truck
          aria-hidden="true"
          className="text-muted-foreground"
          style={{ width: tamanho * 0.55, height: tamanho * 0.55 }}
        />
      ) : (
        <img
          src={caminho}
          alt={nome}
          loading="lazy"
          decoding="async"
          width={Math.round(tamanho * 1.6)}
          height={tamanho}
          className="h-full w-auto max-w-full object-contain"
          onError={() => setFalhouAoCarregar(true)}
        />
      )}
    </span>
  );
}

export interface SeloDoAgregadorProps {
  /** Slug reconhecido (`LOGO_AGREGADOR`). */
  slug: string;
  /** Nome do agregador — sempre aparece em texto ("via <nome>"). */
  nome: string;
  className?: string;
}

/**
 * Selo pequeno "via <Agregador>", com o logo do agregador ao lado quando
 * disponível. O logo é decorativo (`alt=""`): o texto já diz o nome, e um
 * `alt` repetindo o mesmo nome faria o leitor de tela ler duas vezes.
 */
export function SeloDoAgregador({
  slug,
  nome,
  className,
}: SeloDoAgregadorProps) {
  const caminho = logoDoAgregador(slug);
  const [falhouAoCarregar, setFalhouAoCarregar] = useState(false);
  const mostrarLogo = Boolean(caminho) && !falhouAoCarregar;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {mostrarLogo && (
        <img
          src={caminho}
          alt=""
          loading="lazy"
          decoding="async"
          width={14}
          height={14}
          className="size-3.5 shrink-0 object-contain"
          onError={() => setFalhouAoCarregar(true)}
        />
      )}
      <span>via {nome}</span>
    </span>
  );
}
