import type { ChaveDeIcone } from "@/lib/icones-de-categoria";
import { useEffect, useState } from "react";

// Ícone que a categoria usa quando a lojista NÃO escolheu nenhum: o do catálogo do painel que combina com o
// NOME ("Bolsas femininas" -> Bolsa), com a mesma regra do botão "Sugerimos pelo nome". A vitrine e a lista do
// painel desenham o ícone SALVO primeiro (forma, depois chave); isto só cobre o que sobra.
//
// O catálogo (`public/icons/categorias.json`, ~22 kB) é um arquivo à parte, buscado só se ALGUMA categoria
// precisa dele, e o código que o lê é carregado junto (fora do pacote principal). Se não vier, o chamador segue
// com o ícone de sempre: nada aqui lança nem avisa erro para a tela.
export interface IconeSugerido {
  readonly icone: ChaveDeIcone | "etiqueta";
  readonly forma: string | null;
}

interface CategoriaParaSugerir {
  readonly name: string;
  readonly icone?: string | null;
  readonly iconeForma?: string | null;
}

export function useIconesPeloNome(
  categorias: readonly CategoriaParaSugerir[],
  habilitado = true,
): ReadonlyMap<string, IconeSugerido> {
  const [sugeridos, setSugeridos] = useState<
    ReadonlyMap<string, IconeSugerido>
  >(() => new Map());
  // Só os nomes das categorias sem escolha própria entram na conta (e na chave do efeito).
  const nomes = habilitado
    ? categorias
        .filter((c) => !c.icone && !c.iconeForma)
        .map((c) => c.name)
        .join("\u0000")
    : "";

  useEffect(() => {
    if (nomes === "") {
      setSugeridos((atual) => (atual.size === 0 ? atual : new Map()));
      return;
    }
    let vivo = true;
    import("@/lib/catalogo-de-icones")
      .then(async (m) => {
        const lista = await m.carregarCatalogo();
        const mapa = new Map<string, IconeSugerido>();
        for (const nome of nomes.split("\u0000")) {
          const s = m.sugerirPeloNome(lista, nome);
          if (!s) continue;
          mapa.set(
            nome,
            s.tipo === "catalogo"
              ? { icone: "etiqueta", forma: s.item.d }
              : { icone: s.chave, forma: null },
          );
        }
        if (vivo) setSugeridos(mapa);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [nomes]);

  return sugeridos;
}
