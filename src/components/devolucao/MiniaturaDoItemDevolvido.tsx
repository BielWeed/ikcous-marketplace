import { useState } from "react";

export function MiniaturaDoItemDevolvido({
  url,
  className,
}: Readonly<{ url: string; className: string }>) {
  const [falhou, setFalhou] = useState(false);
  return falhou ? (
    <span
      role="img"
      aria-label="Foto indisponível"
      className="flex size-full items-center justify-center text-center text-[10px] text-zinc-500"
    >
      Sem foto
    </span>
  ) : (
    <img
      src={url}
      alt=""
      className={className}
      onError={() => setFalhou(true)}
    />
  );
}
