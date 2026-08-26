import { StarRating } from "@/components/ui/custom/StarRating";
import { useStore } from "@/contexts/StoreContext";
import type { Product, View } from "@/types";
import { ArrowLeft, Check, Package, Truck, X } from "lucide-react";

interface CompareViewProps {
  products: Product[];
  onNavigate: (view: View) => void;
  onRemoveProduct: (productId: string) => void;
  onClearAll: () => void;
  onProductClick: (productId: string) => void;
}

export function CompareView({
  products,
  onNavigate,
  onRemoveProduct,
  onClearAll,
  onProductClick,
}: CompareViewProps) {
  // ADMIN-091 (#202): hook chamado antes de qualquer `return` cedo -- regra
  // dos hooks do React.
  const { config } = useStore();

  if (products.length === 0) {
    return (
      <div className="pb-customer flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="mb-4 flex size-24 items-center justify-center rounded-full bg-gray-100">
          <Package className="size-10 text-gray-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-gray-900">
          Nenhum produto para comparar
        </h2>
        <p className="mb-6 text-center text-sm text-gray-500">
          Adicione produtos à lista de comparação para ver as diferenças
        </p>
        <button
          onClick={() => onNavigate("home")}
          className="rounded-xl bg-black px-6 py-3 font-medium text-white transition-colors hover:bg-gray-900"
        >
          Explorar Produtos
        </button>
      </div>
    );
  }

  const features = [
    {
      key: "price",
      label: "Preço",
      format: (p: Product) => `R$ ${p.price.toFixed(2).replace(".", ",")}`,
    },
    // ADMIN-091 (#202): com o interruptor de Avaliações desligado, a linha
    // inteira some -- não só a estrela. Deixar só o ícone e manter o texto
    // "4.5/5" continuaria publicando a nota, e a tabela é uma lista de
    // linhas, então tirar a linha não deixa buraco (as outras só sobem).
    //
    // LOJA-01 (auditoria 26/08/2026): o formato checava `p.rating` (truthy),
    // mas `produtos.rating` nasce com DEFAULT 5 e nunca é recalculado -- essa
    // checagem nunca caía no ramo "Sem avaliações". Só `reviewCount > 0` diz
    // se existe avaliação de verdade por trás do número.
    ...(config.enableReviews
      ? [
          {
            key: "rating",
            label: "Avaliação",
            format: (p: Product) =>
              p.reviewCount && p.reviewCount > 0
                ? `${(p.rating ?? 0).toFixed(1)}/5`
                : "Sem avaliações",
          },
        ]
      : []),
    {
      key: "stock",
      label: "Estoque",
      format: (p: Product) => `${p.stock} unidades`,
    },
    { key: "sold", label: "Vendidos", format: (p: Product) => `${p.sold}` },
    { key: "category", label: "Categoria", format: (p: Product) => p.category },
    {
      key: "shipping",
      label: "Frete Grátis",
      format: (p: Product) => (p.freeShipping ? "Sim" : "Não"),
    },
  ];

  const getBestValue = (key: string) => {
    if (products.length < 2) return null;

    switch (key) {
      case "price":
        return products.reduce(
          (min, p) => (p.price < min.price ? p : min),
          products[0],
        ).id;
      case "rating": {
        // LOJA-01: mesmo motivo do `format` acima -- `p.rating` é sempre
        // verdadeiro (DEFAULT 5), então o filtro precisa ser por
        // `reviewCount`, não por `rating`.
        const ratedProducts = products.filter(
          (p) => p.reviewCount && p.reviewCount > 0,
        );
        if (ratedProducts.length === 0) return null;
        return ratedProducts.reduce(
          (max, p) => ((p.rating || 0) > (max.rating || 0) ? p : max),
          ratedProducts[0],
        ).id;
      }
      case "stock":
        return products.reduce(
          (max, p) => (p.stock > max.stock ? p : max),
          products[0],
        ).id;
      case "sold":
        return products.reduce(
          (max, p) => (p.sold > max.sold ? p : max),
          products[0],
        ).id;
      default:
        return null;
    }
  };

  return (
    <div className="pb-customer min-h-dvh">
      {/* Header */}
      <div className="sticky top-[-2px] z-10 border-b border-gray-100 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate("home")}
              className="-ml-2 rounded-full p-2 transition-colors hover:bg-gray-100"
            >
              <ArrowLeft className="size-5" />
            </button>
            <h1 className="text-xl font-bold">Comparar Produtos</h1>
          </div>
          <button
            onClick={onClearAll}
            className="text-sm font-medium text-red-500 hover:text-red-600"
          >
            Limpar tudo
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {products.length} produto(s) na comparação
        </p>
      </div>

      {/* Products Grid */}
      <div className="p-4">
        <div
          className={`grid gap-4 ${
            products.length === 2
              ? "grid-cols-2"
              : products.length === 3
                ? "grid-cols-3"
                : "grid-cols-2 md:grid-cols-4"
          }`}
        >
          {products.map((product) => (
            <div
              key={product.id}
              className="overflow-hidden rounded-xl border border-gray-100 bg-white"
            >
              {/* Image */}
              <div className="relative aspect-square bg-gray-50">
                <img
                  src={product.images[0]}
                  alt={product.name}
                  className="size-full object-cover"
                />
                <button
                  onClick={() => onRemoveProduct(product.id)}
                  className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur-sm transition-colors hover:bg-red-50"
                >
                  <X className="size-4 text-gray-600" />
                </button>
              </div>

              {/* Info */}
              <div className="p-3">
                <h3 className="mb-2 line-clamp-2 text-sm font-medium text-gray-900">
                  <button
                    type="button"
                    onClick={() => onProductClick(product.id)}
                    className="text-left hover:text-black hover:underline focus:outline-none"
                  >
                    {product.name}
                  </button>
                </h3>
                <button
                  onClick={() => onProductClick(product.id)}
                  className="w-full rounded-lg bg-black py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900"
                >
                  Ver produto
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Comparison Table */}
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-100 bg-white">
          <div className="border-b border-gray-100 bg-gray-50 p-4">
            <h2 className="font-bold">Comparação de Especificações</h2>
          </div>

          <div className="divide-y divide-gray-100">
            {features.map((feature) => {
              const bestId = getBestValue(feature.key);

              return (
                <div
                  key={feature.key}
                  className="grid divide-x divide-gray-100"
                >
                  <div
                    className={`grid ${
                      products.length === 2
                        ? "grid-cols-3"
                        : products.length === 3
                          ? "grid-cols-4"
                          : "grid-cols-2 md:grid-cols-5"
                    }`}
                  >
                    <div className="flex items-center bg-gray-50 p-3 text-xs font-medium text-gray-600">
                      {feature.label}
                    </div>
                    {products.map((product) => {
                      const isBest = bestId === product.id;
                      const value = feature.format(product);

                      return (
                        <div
                          key={product.id}
                          className={`flex items-center justify-center p-3 text-sm ${
                            isBest
                              ? "bg-green-50 font-medium text-green-700"
                              : ""
                          }`}
                        >
                          {feature.key === "rating" &&
                          product.reviewCount &&
                          product.reviewCount > 0 ? (
                            <div className="flex flex-col items-center">
                              <StarRating
                                rating={product.rating ?? 0}
                                size={14}
                              />
                              <span className="mt-1 text-xs">{value}</span>
                            </div>
                          ) : feature.key === "shipping" ? (
                            <div className="flex items-center gap-1">
                              {product.freeShipping ? (
                                <>
                                  <Check className="size-4 text-green-500" />
                                  <Truck className="size-4 text-green-500" />
                                </>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              {isBest && (
                                <Check className="size-4 text-green-500" />
                              )}
                              {value}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <div className="size-4 rounded border border-green-200 bg-green-50" />
            <span>Melhor opção</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Check className="size-4 text-green-500" />
            <span>Destaque</span>
          </div>
        </div>
      </div>
    </div>
  );
}
