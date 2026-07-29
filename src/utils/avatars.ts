export interface PredefinedAvatar {
  id: string;
  emoji: string;
  label: string;
  start: string;
  end: string;
}

export const PREDEFINED_AVATARS: PredefinedAvatar[] = [
  { id: "fox", emoji: "🦊", label: "Raposa", start: "#FF512F", end: "#DD2476" }, // Sunset Orange/Pink
  { id: "lion", emoji: "🦁", label: "Leão", start: "#F5AF19", end: "#E14D2A" }, // Golden Orange
  {
    id: "koala",
    emoji: "🐨",
    label: "Coala",
    start: "#11998e",
    end: "#38ef7d",
  }, // Emerald Mint
  {
    id: "panda",
    emoji: "🐼",
    label: "Panda",
    start: "#3a7bd5",
    end: "#3a6073",
  }, // Slate Blue
  { id: "robot", emoji: "🤖", label: "Robô", start: "#7F00FF", end: "#E100FF" }, // Cosmic Violet
  {
    id: "unicorn",
    emoji: "🦄",
    label: "Unicórnio",
    start: "#ff007f",
    end: "#7f00ff",
  }, // Dreamy Magenta
  {
    id: "rocket",
    emoji: "🚀",
    label: "Foguete",
    start: "#00c6ff",
    end: "#0072ff",
  }, // Neon Azure
  {
    id: "avocado",
    emoji: "🥑",
    label: "Abacate",
    start: "#a8ff78",
    end: "#78ffd6",
  }, // Fresh Lime
  {
    id: "puppy",
    emoji: "🐶",
    label: "Cachorro",
    start: "#a1c4fd",
    end: "#c2e9fb",
  }, // Sky Pastel Blue
  { id: "cat", emoji: "🐱", label: "Gato", start: "#FF9A9E", end: "#FECFEF" }, // Warm Peach
  {
    id: "tiger",
    emoji: "🐯",
    label: "Tigre",
    start: "#f12711",
    end: "#f5af19",
  }, // Fire Flame
  { id: "frog", emoji: "🐸", label: "Sapo", start: "#11998e", end: "#93F9B9" }, // Moss Green
  {
    id: "penguin",
    emoji: "🐧",
    label: "Pinguim",
    start: "#83a4d4",
    end: "#b6fbff",
  }, // Winter Ice
  {
    id: "monkey",
    emoji: "🐵",
    label: "Macaco",
    start: "#8A5082",
    end: "#6F5F90",
  }, // Soft Violet
  {
    id: "ghost",
    emoji: "👻",
    label: "Fantasma",
    start: "#30cfd0",
    end: "#330867",
  }, // Deep Indigo
  {
    id: "alien",
    emoji: "👾",
    label: "Alien",
    start: "#f77062",
    end: "#fe5196",
  }, // Cyberpunk Pink
  {
    id: "dragon",
    emoji: "🐉",
    label: "Dragão",
    start: "#130CB7",
    end: "#52E5E7",
  }, // Mystic Teal
  {
    id: "crown",
    emoji: "👑",
    label: "Coroa",
    start: "#FFE000",
    end: "#799F0C",
  }, // Royal Gold
  {
    id: "controller",
    emoji: "🎮",
    label: "Controle",
    start: "#f6d365",
    end: "#fda085",
  }, // Retro Synth
  { id: "owl", emoji: "🦉", label: "Coruja", start: "#0f2027", end: "#203a43" }, // Midnight Indigo
];

export const getPredefinedAvatarSvg = (
  emoji: string,
  gradientStart: string,
  gradientEnd: string,
) => {
  // Generate a beautiful SVG gradient avatar
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${gradientStart};stop-opacity:1" />
                <stop offset="100%" style="stop-color:${gradientEnd};stop-opacity:1" />
            </linearGradient>
        </defs>
        <rect width="100" height="100" rx="24" fill="url(#grad)" />
        <text x="50" y="62" font-size="48" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
    </svg>
    `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
};

export const compressImage = (
  base64Str: string,
  maxWidth = 200,
  maxHeight = 200,
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;

      if (width > height) {
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
      resolve(canvas.toDataURL("image/jpeg", 0.8)); // 80% quality
    };
    img.onerror = () => {
      resolve(base64Str);
    };
  });
};
