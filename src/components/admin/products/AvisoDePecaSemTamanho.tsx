import { usePecasSemTamanho } from "@/hooks/usePecasSemTamanho";
import {
  mensagemDoErroAoResolver,
  textoDoAviso,
  textoDoDescarte,
  textoDoSucesso,
  textoJaResolvida,
} from "@/lib/pecas-sem-tamanho";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";

export interface TamanhoDaPeca {
  readonly id: string;
  readonly rotulo: string;
}

/**
 * Topo da tela do produto: a peça que voltou sem tamanho (pedido desfeito ou
 * devolução de um produto vendido antes da grade) espera a lojista dizer em
 * qual tamanho ela entra, ou que não tem a peça. Uma peça de cada vez; nada é
 * somado sem a confirmação dela (nem quando o produto tem um tamanho só).
 *
 * `tamanhos` são as variações LIGADAS já gravadas: a RPC só aceita essas.
 */
export function AvisoDePecaSemTamanho({
  produtoId,
  tamanhos,
}: {
  readonly produtoId: string | undefined;
  readonly tamanhos: readonly TamanhoDaPeca[];
}) {
  const { pecas, resolver } = usePecasSemTamanho(produtoId);
  const primeira = pecas[0];
  // A escolha vale só para a peça em que foi feita: a próxima começa limpa.
  const [escolha, setEscolha] = useState<{
    pecaId: string;
    variantId: string;
  } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ocupadoRef = useRef(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  if (!primeira && !feito) return null;

  const escolhida =
    primeira && escolha?.pecaId === primeira.id
      ? tamanhos.find((t) => t.id === escolha.variantId)
      : tamanhos.length === 1
        ? tamanhos[0]
        : undefined;

  const decidir = async (tamanho: TamanhoDaPeca | null) => {
    if (!primeira || ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupado(true);
    setErro(null);
    setFeito(null);
    try {
      const r = await resolver(primeira.id, tamanho?.id ?? null);
      setFeito(
        r.jaResolvida
          ? textoJaResolvida()
          : r.resolucao === "reposta" && tamanho
            ? textoDoSucesso(tamanho.rotulo)
            : textoDoDescarte(),
      );
    } catch (e) {
      setErro(mensagemDoErroAoResolver(e));
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  };

  const aviso = primeira ? textoDoAviso(pecas) : null;

  return (
    <section
      aria-label="Peças que voltaram sem tamanho"
      className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
    >
      <p role="status" className="font-bold text-emerald-300 empty:hidden">
        {feito ?? ""}
      </p>
      {aviso && (
        <>
          <div className="flex items-start gap-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-amber-400"
            />
            <p>{aviso.titulo}</p>
          </div>
          {tamanhos.length === 0 ? (
            <p className="font-bold">
              Ligue um tamanho para somar a peça a ele.
            </p>
          ) : (
            <>
              <p className="font-bold">{aviso.pergunta}</p>
              <div
                role="group"
                aria-label="Tamanhos"
                className="flex flex-wrap gap-2"
              >
                {tamanhos.map((t) => {
                  const marcado = escolhida?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={marcado}
                      disabled={ocupado}
                      onClick={() =>
                        setEscolha({ pecaId: primeira!.id, variantId: t.id })
                      }
                      className={cn(
                        "min-h-11 min-w-11 rounded-full border px-4 text-xs font-bold disabled:opacity-50",
                        marcado
                          ? "border-amber-400 bg-amber-400 text-black"
                          : "border-admin-border bg-admin-raised text-white",
                      )}
                    >
                      {t.rotulo}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {erro && (
            <p role="alert" className="font-bold text-red-300">
              {erro}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {tamanhos.length > 0 && (
              <button
                type="button"
                disabled={!escolhida || ocupado}
                onClick={() => void decidir(escolhida ?? null)}
                className="min-h-11 rounded-full bg-amber-400 px-4 text-xs font-bold text-black disabled:opacity-50"
              >
                {escolhida
                  ? `Somar ao tamanho ${escolhida.rotulo}`
                  : "Escolha o tamanho"}
              </button>
            )}
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void decidir(null)}
              className="min-h-11 rounded-full bg-admin-raised px-4 text-xs font-bold text-white disabled:opacity-50"
            >
              Não tenho essa peça
            </button>
          </div>
        </>
      )}
    </section>
  );
}
