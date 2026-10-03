import { FolhaInferior } from "./FolhaInferior";

/** Ideias de nome para quem não sabe por onde começar. */
const SUGESTOES_DE_NOME = [
  "Kits de Presente",
  "Mais Vendidos da Semana",
  "Linha Skincare",
  "Coleção Verão",
  "Recomendados para Você",
] as const;

/**
 * "Nova vitrine": só o nome — quantidade e produtos a lojista ajusta depois,
 * no painel de edição. O texto digitado mora na tela (não aqui), então uma
 * gravação que falha não apaga o que ela escreveu.
 */
export function FolhaNovaVitrine({
  titulo,
  aoMudarTitulo,
  aoCriar,
  aoFechar,
  criando,
}: {
  readonly titulo: string;
  readonly aoMudarTitulo: (titulo: string) => void;
  readonly aoCriar: () => void;
  readonly aoFechar: () => void;
  readonly criando: boolean;
}) {
  return (
    <FolhaInferior
      titulo="Nova vitrine"
      descricao="Entra no fim da lista, já visível."
      aoFechar={aoFechar}
      rodape={
        <>
          <button
            type="button"
            onClick={aoFechar}
            className="h-12 flex-1 rounded-[14px] bg-zinc-900 text-[15px] font-bold text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={aoCriar}
            disabled={criando}
            className="h-12 flex-1 rounded-[14px] bg-admin-gold text-[15px] font-extrabold text-zinc-950 transition-colors hover:bg-admin-gold/90 active:scale-[0.99] disabled:opacity-60"
          >
            Criar vitrine
          </button>
        </>
      }
    >
      <label
        htmlFor="titulo-da-nova-vitrine"
        className="mb-1.5 mt-3 block px-0.5 text-xs font-semibold text-zinc-400"
      >
        Nome que o cliente vê
      </label>
      <input
        id="titulo-da-nova-vitrine"
        type="text"
        value={titulo}
        onChange={(evento) => aoMudarTitulo(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key === "Enter") aoCriar();
        }}
        placeholder="Ex.: Kits de presente"
        className="h-12 w-full rounded-[14px] border border-white/10 bg-zinc-900 px-3.5 text-[15px] font-semibold text-white placeholder:text-zinc-600 focus:border-admin-gold focus:outline-none"
      />

      <p className="mb-2 mt-4 px-0.5 text-xs font-semibold text-zinc-400">
        Ideias rápidas
      </p>
      <div className="flex flex-wrap gap-2">
        {SUGESTOES_DE_NOME.map((sugestao) => (
          <button
            key={sugestao}
            type="button"
            onClick={() => aoMudarTitulo(sugestao)}
            className="h-8 rounded-[10px] border border-white/10 bg-zinc-900 px-3 text-[13px] font-semibold text-zinc-300 transition-colors hover:border-admin-gold/40 hover:text-admin-gold"
          >
            {sugestao}
          </button>
        ))}
      </div>
    </FolhaInferior>
  );
}
