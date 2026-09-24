/**
 * Pix: contorno vetorial da marca, obtido de Simple Icons (CC0).
 * O QR exibido no pagamento vem sempre da cobrança real do Mercado Pago.
 */
export function IconePix({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M5.283 18.36a3.505 3.505 0 0 0 2.493-1.032l3.6-3.6a.684.684 0 0 1 .946 0l3.613 3.613a3.504 3.504 0 0 0 2.493 1.032h.71l-4.56 4.56a3.647 3.647 0 0 1-5.156 0L4.85 18.36ZM18.428 5.627a3.505 3.505 0 0 0-2.493 1.032l-3.613 3.614a.67.67 0 0 1-.946 0l-3.6-3.6A3.505 3.505 0 0 0 5.283 5.64h-.434l4.573-4.572a3.646 3.646 0 0 1 5.156 0l4.559 4.559ZM1.068 9.422 3.79 6.699h1.492a2.483 2.483 0 0 1 1.744.722l3.6 3.6a1.73 1.73 0 0 0 2.443 0l3.614-3.613a2.482 2.482 0 0 1 1.744-.723h1.767l2.737 2.737a3.646 3.646 0 0 1 0 5.156l-2.736 2.736h-1.768a2.482 2.482 0 0 1-1.744-.722l-3.613-3.613a1.77 1.77 0 0 0-2.444 0l-3.6 3.6a2.483 2.483 0 0 1-1.744.722H3.791l-2.723-2.723a3.646 3.646 0 0 1 0-5.156" />
    </svg>
  );
}

export function IconeCartao({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="cartao-fundo" x1="5" y1="9" x2="44" y2="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#173453" /><stop offset=".55" stopColor="#385E82" /><stop offset="1" stopColor="#0D273D" />
        </linearGradient>
        <linearGradient id="cartao-chip" x1="14" y1="18" x2="25" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F7E8AE" /><stop offset="1" stopColor="#C8A45B" />
        </linearGradient>
      </defs>
      <rect x="3" y="7" width="42" height="34" rx="6" fill="url(#cartao-fundo)" stroke="#10253B" strokeWidth="1.5" />
      <path d="M5 14h38" stroke="white" strokeOpacity=".14" />
      <rect x="12" y="18" width="13" height="11" rx="2" fill="url(#cartao-chip)" stroke="#A5874C" strokeWidth=".8" />
      <path d="M16 18v11m5-11v11m-9-5.5h13" stroke="#A5874C" strokeWidth=".7" />
      <path d="M31 20c3 1 3 5 0 6m3-8c5 3 5 8 0 11" stroke="#DFEAF3" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="35" cy="34" r="3.2" fill="#E69D74" fillOpacity=".9" />
      <circle cx="39" cy="34" r="3.2" fill="#E6C66B" fillOpacity=".75" />
    </svg>
  );
}

export function IconeDinheiro({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="cedula-fundo" x1="6" y1="12" x2="42" y2="37" gradientUnits="userSpaceOnUse">
          <stop stopColor="#B8DBBD" /><stop offset=".55" stopColor="#83B891" /><stop offset="1" stopColor="#4C916F" />
        </linearGradient>
      </defs>
      <rect x="5" y="10" width="37" height="25" rx="3" fill="#A1C9A6" stroke="#3A765B" strokeWidth="1.2" transform="rotate(-8 5 10)" />
      <rect x="5" y="15" width="39" height="25" rx="3" fill="url(#cedula-fundo)" stroke="#3A765B" strokeWidth="1.3" />
      <rect x="8" y="18" width="33" height="19" rx="2" stroke="#377357" strokeWidth="1" strokeOpacity=".65" />
      <circle cx="24.5" cy="27.5" r="7" fill="#E8F5D9" fillOpacity=".72" stroke="#468A65" />
      <path d="M22 30.5c1.5 1.2 5 1 5-1.1 0-2-2.8-3.1-5-2-2.3 1-2.5 2.8-3.8 2.5m-1.7-7v15" stroke="#317656" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M11 22h3m21 11h3" stroke="#317656" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
