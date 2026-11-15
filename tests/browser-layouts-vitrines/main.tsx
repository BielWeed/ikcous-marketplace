import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Product } from "../../src/types";
import { HomeView } from "../../src/views/customer/HomeView";
import "../../src/index.css";

const params = new URLSearchParams(location.search);
const qtd = params.get("qtd") === "1" ? 1 : 2;
// Imagem inventada, embutida: não faz pedido de rede para foto de cliente.
const desenho = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="420" viewBox="0 0 320 420"><rect width="320" height="420" fill="#e8e2d8"/><path d="M100 65L55 140l40 30v190h130V170l40-30-45-75-38 20h-44z" fill="#49626c"/><path d="M138 85q22 36 44 0" fill="none" stroke="#e8e2d8" stroke-width="8"/></svg>`;
const products: Product[] = Array.from({ length: qtd }, (_, i) => ({
  id: `fixture-${i}`,
  name:
    i === 0
      ? "Camiseta de algodão — azul petróleo"
      : "Camiseta básica de algodão",
  price: i === 0 ? 129.9 : 89.9,
  images: [`data:image/svg+xml,${encodeURIComponent(desenho)}`],
  description: "",
  category: "Camisetas",
  stock: 20,
  sold: 0,
  isActive: true,
  isBestseller: true,
  freeShipping: false,
  createdAt: "2026-11-15T00:00:00Z",
  createdTime: 2 - i,
}));
const nada = () => {};
// É a HomeView e são os cartões REAIS. Somente os hooks de dados são fictícios.
function Ensaio() {
  const [carregou, carregar] = useState(params.get("atraso") !== "1");
  useEffect(() => {
    const timer = setTimeout(() => carregar(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main style={{ maxWidth: 480, margin: "0 auto" }}>
      <HomeView
        products={carregou ? products : []}
        isLoading={!carregou}
        favorites={[]}
        onToggleFavorite={nada}
        onProductClick={nada}
        onNavigate={nada}
        searchQuery=""
        selectedCategory="Todas"
        onCategoryChange={nada}
        sortBy="default"
        onSortByChange={nada}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Ensaio />);
