import {
  type Aba,
  NOMES_DO_PAINEL,
  NOME_DO_PAR_PERGUNTAS_E_AVALIACOES,
  PAR_PERGUNTAS_E_AVALIACOES,
  PORTAS_DO_PAINEL,
  type TelaDoPainel,
} from "@/config/nomes-do-painel";
import { ChevronRight } from "lucide-react";

/** Contador de um atalho: entra no nome acessível ("Avisar clientes, 3 novos"). */
export interface ContadorDoAtalho {
  readonly valor: number;
  /** Complemento falado depois do número ("sem resposta"). */
  readonly legenda?: string;
}

// Contador de uma porta: o da própria tela mais o das telas fundidas nela.
// A legenda é a da própria tela, ou a da primeira fundida que tiver uma.
function contadorDaPorta(
  contadores: Partial<Record<TelaDoPainel, ContadorDoAtalho>> | undefined,
  tela: TelaDoPainel,
  fundidas: readonly TelaDoPainel[],
): ContadorDoAtalho {
  const origens = [tela, ...fundidas].map(
    // eslint-disable-next-line security/detect-object-injection -- chave tipada, não entrada do usuário
    (t) => contadores?.[t],
  );
  return {
    valor: origens.reduce((soma, c) => soma + (c?.valor ?? 0), 0),
    legenda: origens.find((c) => c?.legenda)?.legenda,
  };
}

/**
 * As portas de uma aba, em cartões de toque de 44px (spec painel-simples §7).
 * Nomes e rotas vêm de NOMES_DO_PAINEL/PORTAS_DO_PAINEL: a tela não repete
 * nenhum dos dois, então não existe segunda porta nem segundo nome.
 *
 * Perguntas e Avaliações são duas telas atrás de UMA porta: aparece um só
 * atalho, "Perguntas e avaliações", que abre a primeira do par (o
 * AlternadorDeTelas, no topo das duas telas, leva à outra). O contador dessa
 * porta é a SOMA dos contadores das duas (ausente conta 0).
 *
 * Contador zero não aparece. O número visual é `aria-hidden` e o nome do
 * botão já o leva, para o leitor de tela não ler duas vezes.
 */
export function AtalhosDaAba({
  aba,
  onNavigate,
  contadores,
}: {
  readonly aba: Aba;
  readonly onNavigate: (view: TelaDoPainel) => void;
  readonly contadores?: Partial<Record<TelaDoPainel, ContadorDoAtalho>>;
}) {
  // eslint-disable-next-line security/detect-object-injection -- chave tipada, não entrada do usuário
  const portas = PORTAS_DO_PAINEL[aba] as readonly TelaDoPainel[];
  const [primeiraDoPar, segundaDoPar] = PAR_PERGUNTAS_E_AVALIACOES;
  // A segunda do par não ganha atalho próprio quando a primeira está na aba.
  const funde = portas.includes(primeiraDoPar);
  const visiveis = portas.filter((p) => !(funde && p === segundaDoPar));

  return (
    <div className="flex flex-col gap-2">
      {visiveis.map((tela) => {
        const nome =
          funde && tela === primeiraDoPar
            ? NOME_DO_PAR_PERGUNTAS_E_AVALIACOES
            : // eslint-disable-next-line security/detect-object-injection -- chave tipada, não entrada do usuário
              NOMES_DO_PAINEL[tela];
        const contador = contadorDaPorta(
          contadores,
          tela,
          funde && tela === primeiraDoPar ? [segundaDoPar] : [],
        );
        const mostraContador = contador.valor > 0;
        const nomeAcessivel = mostraContador
          ? `${nome}, ${contador.valor}${contador.legenda ? ` ${contador.legenda}` : ""}`
          : undefined;
        return (
          <button
            key={tela}
            type="button"
            aria-label={nomeAcessivel}
            onClick={() => onNavigate(tela)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-left text-sm font-bold text-zinc-100 transition-colors hover:border-admin-gold/40 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold"
          >
            <span className="min-w-0 truncate">{nome}</span>
            <span className="flex shrink-0 items-center gap-2">
              {mostraContador && (
                <span
                  aria-hidden="true"
                  className="min-w-6 rounded-full bg-admin-gold px-2 py-0.5 text-center text-xs font-black tabular-nums text-black"
                >
                  {contador.valor}
                </span>
              )}
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-zinc-400"
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
