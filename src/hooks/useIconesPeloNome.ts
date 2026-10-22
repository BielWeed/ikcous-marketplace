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

type Modulo = typeof import("@/lib/catalogo-de-icones");
// Guardado depois da 1ª carga: quem monta depois já nasce com o ícone certo, sem trocar o desenho.
let carregado: {
  m: Modulo;
  lista: Awaited<ReturnType<Modulo["carregarCatalogo"]>>;
} | null = null;

const SEPARADOR = String.fromCharCode(0);

/** Só para os testes. */
export function esquecerOsIconesPeloNome() {
  carregado = null;
}

function montarMapa(nomes: string): ReadonlyMap<string, IconeSugerido> {
  const mapa = new Map<string, IconeSugerido>();
  if (!carregado || nomes === "") return mapa;
  for (const nome of nomes.split(SEPARADOR)) {
    const s = carregado.m.sugerirPeloNome(carregado.lista, nome);
    if (!s) continue;
    mapa.set(
      nome,
      s.tipo === "catalogo"
        ? { icone: "etiqueta", forma: s.item.d }
        : { icone: s.chave, forma: null },
    );
  }
  return mapa;
}

export function useIconesPeloNome(
  categorias: readonly CategoriaParaSugerir[],
  habilitado = true,
): ReadonlyMap<string, IconeSugerido> {
  // Só os nomes das categorias sem escolha própria entram na conta (e na chave do efeito).
  const nomes = habilitado
    ? categorias
        .filter((c) => !c.icone && !c.iconeForma)
        .map((c) => c.name)
        .join(SEPARADOR)
    : "";

  const [sugeridos, setSugeridos] = useState<
    ReadonlyMap<string, IconeSugerido>
  >(() => montarMapa(nomes));

  useEffect(() => {
    if (nomes === "") {
      setSugeridos((atual) => (atual.size === 0 ? atual : new Map()));
      return;
    }
    let vivo = true;
    import("@/lib/catalogo-de-icones")
      .then(async (m) => {
        carregado = { m, lista: await m.carregarCatalogo() };
        const mapa = montarMapa(nomes);
        if (vivo) setSugeridos(mapa);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [nomes]);

  return sugeridos;
}
