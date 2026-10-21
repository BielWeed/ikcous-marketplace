import { categoriasEmMemoria } from "@/hooks/useCategories";
import { DataVault } from "@/lib/dataVault";
import {
  IconeDaCategoria,
  formaDeIconeValida,
  iconeEscolhido,
} from "@/lib/icones-de-categoria";
import type { Category } from "@/types";
import { Tag } from "lucide-react";
import { useEffect, useState } from "react";

// Ícone da categoria na caixinha de busca do topo. Desenha o que a própria categoria guarda: a forma
// (`icone_forma`), depois a chave das 14, e cai na etiqueta de sempre. Lê a lista SÓ do que já está em
// memória ou no cofre do aparelho: nunca faz pedido ao servidor nem avisa erro (a busca não depende dele).
// Carregado sob demanda pela SearchBar (a caixinha só precisa dele quando há categoria na resposta).
export function IconeDaCategoriaBuscada({
  nome,
  className,
}: Readonly<{ nome: string; className?: string }>) {
  const [lista, setLista] = useState<Category[] | null>(categoriasEmMemoria);
  useEffect(() => {
    if (lista) return;
    let vivo = true;
    DataVault.init()
      .then((cofre) => cofre.getAll<Category>("categories"))
      .then((guardadas) => {
        if (vivo && guardadas.length > 0) setLista(guardadas);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [lista]);

  const categoria = lista?.find((item) => item.name === nome);
  const forma = formaDeIconeValida(categoria?.iconeForma)
    ? categoria?.iconeForma
    : null;
  const chave = categoria ? iconeEscolhido(categoria) : null;
  if (!forma && !chave) return <Tag className={className} />;
  return (
    <IconeDaCategoria
      icone={chave ?? "etiqueta"}
      forma={forma}
      className={className}
    />
  );
}
