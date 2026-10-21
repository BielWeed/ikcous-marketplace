import { LazyImage } from "@/components/LazyImage";
import {
  type ModeloDeBanner,
  dividirTitulo,
  modeloDoBanner,
  tintaSobre,
} from "@/lib/banner-modelos";
import { IMAGEM_DO_BANNER } from "@/lib/imagem-do-banner";
import type { Banner } from "@/types";
import "./banner-pronto.css";

interface BannerProntoPreviewProps {
  modelo: ModeloDeBanner;
  corHex: string;
  fotoUrl: string;
  titulo: string;
  subtitulo: string;
  botao: string;
  selo?: string;
  prioridade?: boolean;
}

export function BannerProntoPreview({
  modelo,
  corHex,
  fotoUrl,
  titulo,
  subtitulo,
  botao,
  selo,
  prioridade = false,
}: BannerProntoPreviewProps) {
  const tinta = modelo === "foto" ? "claro" : tintaSobre(corHex);
  const linhas = dividirTitulo(titulo);
  const foto = (
    <LazyImage
      src={fotoUrl}
      alt=""
      className="banner-pronto-foto"
      priority={prioridade}
      sizes={IMAGEM_DO_BANNER.sizes}
      quality={IMAGEM_DO_BANNER.quality}
    />
  );
  return (
    <div
      className="banner-pronto"
      data-modelo={modelo}
      data-tinta={tinta}
      style={{ backgroundColor: corHex }}
    >
      {modelo === "foto" && (
        <>
          {foto}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-black/70"
          />
        </>
      )}
      <div className="banner-pronto-conteudo">
        {modelo !== "foto" && foto}
        <div className="banner-pronto-texto">
          {selo?.trim() && (
            <span data-selo className="banner-pronto-selo">
              {selo}
            </span>
          )}
          {titulo.trim() && (
            <h2>
              {linhas[0]}
              {linhas[1] && <span> {linhas[1]}</span>}
            </h2>
          )}
          {subtitulo.trim() && <p>{subtitulo}</p>}
          {botao.trim() && (
            <span data-botao className="banner-pronto-botao">
              {botao}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function BannerPronto({
  banner,
  prioridade,
}: { banner: Banner; prioridade?: boolean }) {
  const modelo = modeloDoBanner(banner.templateType);
  if (!modelo) return null;
  return (
    <div className="banner-pronto-slide">
      <BannerProntoPreview
        modelo={modelo}
        corHex={banner.overlayColor || "#2A2A31"}
        fotoUrl={banner.imageUrl}
        titulo={banner.title || ""}
        subtitulo={banner.subtitle || ""}
        botao={banner.buttonText || ""}
        selo={banner.badgeText}
        prioridade={prioridade}
      />
    </div>
  );
}
