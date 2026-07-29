export interface PredefinedCover {
  id: string;
  label: string;
  start: string;
  end: string;
  patternType?: "waves" | "grid" | "dots" | "glass" | "none";
}

export const PREDEFINED_COVERS: PredefinedCover[] = [
  {
    id: "sunset",
    label: "Sunset Glow",
    start: "#FF512F",
    end: "#DD2476",
    patternType: "waves",
  },
  {
    id: "midnight",
    label: "Midnight Neon",
    start: "#090d1a",
    end: "#1e1b4b",
    patternType: "grid",
  },
  {
    id: "emerald",
    label: "Emerald Mint",
    start: "#064e3b",
    end: "#059669",
    patternType: "dots",
  },
  {
    id: "aurora",
    label: "Aurora Borealis",
    start: "#0f172a",
    end: "#0284c7",
    patternType: "waves",
  },
  {
    id: "cosmic",
    label: "Cosmic Violet",
    start: "#311042",
    end: "#701a75",
    patternType: "dots",
  },
  {
    id: "darkness",
    label: "Industrial Dark",
    start: "#09090b",
    end: "#27272a",
    patternType: "grid",
  },
  {
    id: "glassmorphic",
    label: "Glassmorphic Silk",
    start: "#1e1b4b",
    end: "#311042",
    patternType: "glass",
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk Dream",
    start: "#03001e",
    end: "#ec38bc",
    patternType: "glass",
  },
  {
    id: "golden",
    label: "Golden Hour",
    start: "#78350f",
    end: "#d97706",
    patternType: "waves",
  },
  {
    id: "pastel",
    label: "Aesthetic Pastel",
    start: "#e0e7ff",
    end: "#fce7f3",
    patternType: "glass",
  },
  {
    id: "abyss",
    label: "Deep Abyss",
    start: "#030712",
    end: "#111827",
    patternType: "grid",
  },
  {
    id: "forest",
    label: "Forest Mist",
    start: "#14532d",
    end: "#166534",
    patternType: "dots",
  },
];

export const getPredefinedCoverSvg = (
  start: string,
  end: string,
  patternType: "waves" | "grid" | "dots" | "glass" | "none" = "none",
) => {
  let patternSvg = "";
  let filterDefs = "";
  let meshGlows = "";

  if (patternType === "grid") {
    patternSvg = `
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255, 255, 255, 0.05)" stroke-width="1" />
        </pattern>
        <rect width="100%" height="100%" fill="url(#grid)" />
        `;
  } else if (patternType === "dots") {
    patternSvg = `
        <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="8" cy="8" r="1.2" fill="rgba(255, 255, 255, 0.12)" />
        </pattern>
        <rect width="100%" height="100%" fill="url(#dots)" />
        `;
  } else if (patternType === "waves") {
    patternSvg = `
        <path d="M0 100 Q 200 150 400 80 T 800 130 L 800 250 L 0 250 Z" fill="rgba(255, 255, 255, 0.06)" />
        <path d="M0 140 Q 300 200 600 90 T 800 110 L 800 250 L 0 250 Z" fill="rgba(255, 255, 255, 0.04)" />
        <path d="M0 180 Q 150 220 450 140 T 800 160 L 800 250 L 0 250 Z" fill="rgba(255, 255, 255, 0.02)" />
        `;
  } else if (patternType === "glass") {
    filterDefs = `
        <filter id="mesh-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="40" />
        </filter>
        `;
    // Draw 3 organic glowing blurred mesh spheres
    meshGlows = `
        <g filter="url(#mesh-blur)">
            <circle cx="150" cy="60" r="140" fill="${start}" opacity="0.65" />
            <circle cx="650" cy="190" r="170" fill="${end}" opacity="0.6" />
            <circle cx="420" cy="100" r="110" fill="${start === "#03001e" ? "#06b6d4" : "#ec4899"}" opacity="0.35" />
        </g>
        <rect width="100%" height="100%" fill="rgba(255, 255, 255, 0.03)" />
        `;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 250" width="800" height="250" preserveAspectRatio="none">
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${start};stop-opacity:1" />
                <stop offset="100%" style="stop-color:${end};stop-opacity:1" />
            </linearGradient>
            ${filterDefs}
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" />
        ${meshGlows}
        ${patternSvg}
    </svg>
    `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
};

export const compressCoverImage = (
  base64Str: string,
  maxWidth = 800,
  maxHeight = 300,
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;

      if (width / height > maxWidth / maxHeight) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85)); // 85% quality
    };
    img.onerror = () => {
      resolve(base64Str);
    };
  });
};
