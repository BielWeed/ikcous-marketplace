import { usarImagemOriginal } from "@/lib/imageUrl";
import { cn } from "@/lib/utils";
import { type ImgHTMLAttributes, type ReactNode, useState } from "react";

interface ImagemComFallbackProps extends ImgHTMLAttributes<HTMLImageElement> {
  original?: string | null;
  fallback?: ReactNode;
}

/** Cada fonte nova começa uma tentativa independente, inclusive da original. */
export function ImagemComFallback(props: ImagemComFallbackProps) {
  return (
    <TentativaDeImagem
      key={JSON.stringify([props.src, props.original])}
      {...props}
    />
  );
}

function TentativaDeImagem({
  src,
  original,
  alt,
  className,
  fallback,
  onError,
  width,
  height,
  style,
  ...props
}: ImagemComFallbackProps) {
  const [falhou, setFalhou] = useState(false);

  if (!src || falhou) {
    return (
      fallback ?? (
        <span
          className={cn(
            "flex items-center justify-center bg-muted text-center text-[10px] text-foreground/70",
            className,
          )}
          style={{ width, height, ...style }}
        >
          Sem foto
        </span>
      )
    );
  }

  return (
    <img
      {...props}
      src={src}
      alt={alt}
      className={className}
      width={width}
      height={height}
      style={style}
      onError={(event) => {
        onError?.(event);
        if (!usarImagemOriginal(event.currentTarget, original)) setFalhou(true);
      }}
    />
  );
}
