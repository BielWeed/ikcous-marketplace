import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * A leitura da configuração da loja falhou e não há cópia no aparelho
 * (`configIndisponivel` do StoreContext): Ajustes e Minha loja abrem com a
 * configuração de fábrica, e campo vazio ali NÃO quer dizer "a lojista não
 * preencheu". O aviso diz isso e oferece ler de novo — sem ele a tela só
 * parece vazia e a lojista pode digitar tudo de novo por cima do que já existe.
 */
export function AvisoDaLojaSemDados({
  onTentarDeNovo,
}: Readonly<{ onTentarDeNovo: () => void }>) {
  return (
    <div
      role="alert"
      data-aviso-loja-sem-dados
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-admin-gold/20 bg-admin-gold/5 p-3"
    >
      <AlertTriangle
        className="size-5 shrink-0 text-admin-gold"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-white">
        <span className="font-bold">
          Não foi possível carregar os dados da loja.
        </span>{" "}
        Os campos abaixo podem aparecer vazios mesmo com a loja já cadastrada.
      </p>
      <button
        type="button"
        onClick={onTentarDeNovo}
        className="flex min-h-11 items-center gap-2 rounded-xl border border-admin-gold/30 bg-admin-bg px-4 text-sm font-bold text-admin-gold transition-colors hover:border-admin-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RefreshCw aria-hidden="true" className="size-4" />
        Tentar de novo
      </button>
    </div>
  );
}
