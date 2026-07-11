import type { Game } from "./api";

export type GameCatalogSection = "mobile" | "platform" | "popular";

export type GameCatalogScene = "platform" | "shooter" | "fantasy" | "brawler" | "royal";

export type CategoryTile = {
  id: string;
  slug: string;
  name: string;
  publisher?: string | null;
  lotCount?: number;
  /** Admin-uploaded artwork from the catalog builder; overrides the static theme image. */
  image?: string | null;
};

export type GameTileThemeConfig = {
  gradient: string;
  panel: string;
  border: string;
  glow: string;
  logo: string;
  caption: string;
  scene: GameCatalogScene;
  image?: string;
};

export type GameCatalogEntry = CategoryTile & GameTileThemeConfig & { sections: GameCatalogSection[] };

const GLOW = {
  blue: "bg-sky-400/10 shadow-[inset_0_0_34px_rgba(56,189,248,0.24),0_0_26px_rgba(56,189,248,0.18)]",
  gold: "bg-amber-400/10 shadow-[inset_0_0_34px_rgba(251,191,36,0.22),0_0_26px_rgba(251,191,36,0.16)]",
  green: "bg-emerald-400/10 shadow-[inset_0_0_34px_rgba(74,222,128,0.22),0_0_26px_rgba(74,222,128,0.16)]",
  red: "bg-orange-400/10 shadow-[inset_0_0_34px_rgba(249,115,22,0.22),0_0_26px_rgba(249,115,22,0.16)]",
  steel: "bg-white/[0.06] shadow-[inset_0_0_34px_rgba(255,255,255,0.16),0_0_26px_rgba(148,163,184,0.12)]",
  violet: "bg-violet-400/10 shadow-[inset_0_0_34px_rgba(167,139,250,0.22),0_0_26px_rgba(167,139,250,0.14)]"
};

const DEFAULT_THEME: Omit<GameTileThemeConfig, "image"> = {
  gradient: "from-slate-800 via-slate-950 to-black",
  panel: "bg-white/15",
  border: "border-white/10 hover:border-white/25",
  glow: GLOW.steel,
  logo: "",
  caption: "Marketplace",
  scene: "platform"
};

const CARD_IMAGE_BASE = "/assets/home/category-cards";

/**
 * Single source of truth for homepage/sidebar game & category tiles: naming,
 * lot-count seed values, section placement, artwork and card theming all live
 * on one object per game so adding a game (e.g. a new PNG reference) only
 * requires one new entry here instead of edits across three parallel maps.
 */
export const GAME_CATALOG: GameCatalogEntry[] = [
  // --- mobile only ---
  {
    id: "pubg-mobile",
    slug: "pubg-mobile",
    name: "PUBG Mobile",
    publisher: "Mobile",
    lotCount: 248,
    sections: ["mobile"],
    image: `${CARD_IMAGE_BASE}/pubg-mobile.webp`,
    gradient: "from-[#090705] via-[#3a210c] to-[#0a0c10]",
    panel: "bg-amber-400/25",
    border: "border-amber-300/20 hover:border-amber-200/40",
    glow: GLOW.gold,
    logo: "PUBG MOBILE",
    caption: "Battle royale",
    scene: "shooter"
  },
  {
    id: "free-fire",
    slug: "free-fire",
    name: "Free Fire",
    publisher: "Garena",
    lotCount: 186,
    sections: ["mobile"],
    image: `${CARD_IMAGE_BASE}/free-fire.webp`,
    gradient: "from-[#070503] via-[#3b1908] to-[#100804]",
    panel: "bg-orange-400/30",
    border: "border-orange-300/20 hover:border-orange-200/40",
    glow: GLOW.red,
    logo: "FREE FIRE",
    caption: "Garena",
    scene: "shooter"
  },
  {
    id: "genshin-impact",
    slug: "genshin-impact",
    name: "Genshin Impact",
    publisher: "HoYoverse",
    lotCount: 122,
    sections: ["mobile"],
    image: `${CARD_IMAGE_BASE}/genshin-impact.webp`,
    gradient: "from-[#080604] via-[#4a3212] to-[#0d1015]",
    panel: "bg-amber-200/25",
    border: "border-amber-200/25 hover:border-amber-100/45",
    glow: GLOW.gold,
    logo: "GENSHIN",
    caption: "Impact",
    scene: "fantasy"
  },
  {
    id: "brawl-stars",
    slug: "brawl-stars",
    name: "Brawl Stars",
    publisher: "Supercell",
    lotCount: 94,
    sections: ["mobile"],
    image: `${CARD_IMAGE_BASE}/brawl-stars.webp`,
    gradient: "from-[#110605] via-[#5b1d08] to-[#1b0705]",
    panel: "bg-yellow-300/30",
    border: "border-orange-300/25 hover:border-yellow-200/50",
    glow: GLOW.red,
    logo: "BRAWL STARS",
    caption: "Supercell",
    scene: "brawler"
  },
  {
    id: "clash-of-clans",
    slug: "clash-of-clans",
    name: "Clash of Clans",
    publisher: "Supercell",
    lotCount: 81,
    sections: ["mobile"],
    gradient: "from-[#160705] via-[#5b2409] to-[#100804]",
    panel: "bg-amber-300/25",
    border: "border-amber-300/25 hover:border-yellow-200/45",
    glow: GLOW.gold,
    logo: "CLASH",
    caption: "of Clans",
    scene: "royal"
  },

  // --- mobile + popular ---
  {
    id: "clash-royale",
    slug: "clash-royale",
    name: "Clash Royale",
    publisher: "Supercell",
    lotCount: 73,
    sections: ["mobile", "popular"],
    image: `${CARD_IMAGE_BASE}/clash-royale.webp`,
    gradient: "from-[#110807] via-[#5a2a08] to-[#071225]",
    panel: "bg-amber-300/30",
    border: "border-amber-300/25 hover:border-yellow-200/45",
    glow: GLOW.gold,
    logo: "CLASH ROYALE",
    caption: "Arena cards",
    scene: "royal"
  },
  {
    id: "mobile-legends",
    slug: "mobile-legends",
    name: "Mobile Legends",
    publisher: "Moonton",
    lotCount: 112,
    sections: ["mobile", "popular"],
    image: `${CARD_IMAGE_BASE}/mobile-legends.webp`,
    gradient: "from-[#080605] via-[#54300b] to-[#071730]",
    panel: "bg-blue-300/25",
    border: "border-amber-200/25 hover:border-blue-200/45",
    glow: GLOW.blue,
    logo: "MOBILE LEGENDS",
    caption: "Moonton",
    scene: "fantasy"
  },
  {
    id: "league-wild-rift",
    slug: "league-wild-rift",
    name: "League of Legends: Wild Rift",
    publisher: "Riot Games",
    lotCount: 91,
    sections: ["mobile", "popular"],
    image: `${CARD_IMAGE_BASE}/league-wild-rift.webp`,
    gradient: "from-[#090605] via-[#54300d] to-[#06142a]",
    panel: "bg-cyan-300/25",
    border: "border-amber-200/25 hover:border-cyan-200/45",
    glow: GLOW.blue,
    logo: "WILD RIFT",
    caption: "League of Legends",
    scene: "fantasy"
  },
  {
    id: "roblox",
    slug: "roblox",
    name: "Roblox",
    publisher: "Roblox",
    lotCount: 143,
    sections: ["mobile", "popular"],
    image: `${CARD_IMAGE_BASE}/roblox.webp`,
    gradient: "from-[#0b0b0f] via-[#331015] to-[#0a0c12]",
    panel: "bg-red-400/25",
    border: "border-red-300/20 hover:border-red-200/40",
    glow: GLOW.red,
    logo: "ROBLOX",
    caption: "Accounts",
    scene: "brawler"
  },
  {
    id: "standoff-2",
    slug: "standoff-2",
    name: "Standoff 2",
    publisher: "AXLEBOLT",
    lotCount: 77,
    sections: ["mobile", "popular"],
    image: `${CARD_IMAGE_BASE}/standoff-2.webp`,
    gradient: "from-[#080604] via-[#3f1d07] to-[#090909]",
    panel: "bg-orange-300/25",
    border: "border-orange-300/25 hover:border-amber-200/45",
    glow: GLOW.red,
    logo: "STANDOFF 2",
    caption: "Shooter",
    scene: "shooter"
  },
  {
    id: "arena-breakout",
    slug: "arena-breakout",
    name: "Arena Breakout",
    publisher: "MoreFun",
    lotCount: 45,
    sections: ["mobile", "popular"],
    image: `${CARD_IMAGE_BASE}/arena-breakout.webp`,
    gradient: "from-[#080807] via-[#312719] to-[#090909]",
    panel: "bg-stone-300/20",
    border: "border-stone-300/20 hover:border-amber-100/35",
    glow: GLOW.steel,
    logo: "ARENA BREAKOUT",
    caption: "Tactical FPS",
    scene: "shooter"
  },
  {
    id: "call-of-duty-mobile",
    slug: "call-of-duty-mobile",
    name: "Call of Duty Mobile",
    publisher: "Activision",
    lotCount: 69,
    sections: ["mobile", "popular"],
    image: `${CARD_IMAGE_BASE}/call-of-duty-mobile.webp`,
    gradient: "from-[#090705] via-[#3b1e0a] to-[#0a0a0a]",
    panel: "bg-yellow-300/25",
    border: "border-amber-300/25 hover:border-yellow-200/45",
    glow: GLOW.gold,
    logo: "COD MOBILE",
    caption: "Activision",
    scene: "shooter"
  },

  // --- platform only ---
  {
    id: "steam",
    slug: "steam",
    name: "Steam",
    publisher: "PC",
    lotCount: 430,
    sections: ["platform"],
    image: `${CARD_IMAGE_BASE}/steam.webp`,
    gradient: "from-[#050b12] via-[#09233a] to-[#03070d]",
    panel: "bg-sky-300/20",
    border: "border-sky-300/25 hover:border-sky-200/50",
    glow: GLOW.blue,
    logo: "Steam",
    caption: "PC platform",
    scene: "platform"
  },
  {
    id: "epic-games",
    slug: "epic-games",
    name: "Epic Games Store",
    publisher: "PC",
    lotCount: 126,
    sections: ["platform"],
    image: `${CARD_IMAGE_BASE}/epic-games.webp`,
    gradient: "from-[#090909] via-[#24272d] to-[#030303]",
    panel: "bg-white/15",
    border: "border-white/20 hover:border-white/45",
    glow: GLOW.steel,
    logo: "Epic Games",
    caption: "Store",
    scene: "platform"
  },
  {
    id: "playstation",
    slug: "playstation",
    name: "PlayStation",
    publisher: "Console",
    lotCount: 170,
    sections: ["platform"],
    image: `${CARD_IMAGE_BASE}/playstation.webp`,
    gradient: "from-[#050912] via-[#0b2a63] to-[#030816]",
    panel: "bg-blue-300/25",
    border: "border-blue-300/25 hover:border-blue-200/55",
    glow: GLOW.blue,
    logo: "PlayStation",
    caption: "Console",
    scene: "platform"
  },
  {
    id: "xbox",
    slug: "xbox",
    name: "Xbox",
    publisher: "Console",
    lotCount: 98,
    sections: ["platform"],
    image: `${CARD_IMAGE_BASE}/xbox.webp`,
    gradient: "from-[#050b08] via-[#0f4a18] to-[#020805]",
    panel: "bg-green-300/25",
    border: "border-green-300/25 hover:border-green-200/55",
    glow: GLOW.green,
    logo: "Xbox",
    caption: "Console",
    scene: "platform"
  },
  {
    id: "battle-net",
    slug: "battle-net",
    name: "Battle.net",
    publisher: "PC",
    lotCount: 74,
    sections: ["platform"],
    image: `${CARD_IMAGE_BASE}/battle-net.webp`,
    gradient: "from-[#030812] via-[#082d55] to-[#02050a]",
    panel: "bg-sky-300/25",
    border: "border-sky-300/25 hover:border-sky-200/55",
    glow: GLOW.blue,
    logo: "BATTLE.NET",
    caption: "Blizzard",
    scene: "platform"
  },
  {
    id: "nintendo",
    slug: "nintendo",
    name: "Nintendo",
    publisher: "Console",
    lotCount: 63,
    sections: ["platform"],
    gradient: "from-[#130505] via-[#621212] to-[#070303]",
    panel: "bg-red-300/25",
    border: "border-red-300/25 hover:border-red-200/50",
    glow: GLOW.red,
    logo: "Nintendo",
    caption: "Console",
    scene: "platform"
  },
  {
    id: "ubisoft-connect",
    slug: "ubisoft-connect",
    name: "Ubisoft Connect",
    publisher: "PC",
    lotCount: 58,
    sections: ["platform"],
    gradient: "from-[#050913] via-[#0b3568] to-[#030812]",
    panel: "bg-cyan-300/20",
    border: "border-cyan-300/20 hover:border-cyan-200/45",
    glow: GLOW.blue,
    logo: "Ubisoft",
    caption: "Connect",
    scene: "platform"
  },
  {
    id: "ea-app",
    slug: "ea-app",
    name: "EA App",
    publisher: "PC",
    lotCount: 66,
    sections: ["platform"],
    gradient: "from-[#050913] via-[#073a58] to-[#030812]",
    panel: "bg-cyan-300/20",
    border: "border-cyan-300/20 hover:border-cyan-200/45",
    glow: GLOW.blue,
    logo: "EA App",
    caption: "PC platform",
    scene: "platform"
  },
  {
    id: "rockstar",
    slug: "rockstar",
    name: "Rockstar",
    publisher: "PC",
    lotCount: 101,
    sections: ["platform"],
    gradient: "from-[#100904] via-[#5f2b09] to-[#050505]",
    panel: "bg-yellow-300/25",
    border: "border-yellow-300/25 hover:border-yellow-200/50",
    glow: GLOW.gold,
    logo: "Rockstar",
    caption: "Launcher",
    scene: "platform"
  },
  {
    id: "gog",
    slug: "gog",
    name: "GOG",
    publisher: "PC",
    lotCount: 42,
    sections: ["platform"],
    gradient: "from-[#090718] via-[#2e1b65] to-[#05030d]",
    panel: "bg-violet-300/20",
    border: "border-violet-300/20 hover:border-violet-200/45",
    glow: GLOW.violet,
    logo: "GOG",
    caption: "DRM-free",
    scene: "platform"
  },

  // --- popular only ---
  {
    id: "cs2",
    slug: "cs2",
    name: "CS2",
    publisher: "Valve",
    lotCount: 315,
    sections: ["popular"],
    gradient: "from-[#090705] via-[#42210b] to-[#080a10]",
    panel: "bg-orange-300/25",
    border: "border-orange-300/25 hover:border-orange-200/45",
    glow: GLOW.red,
    logo: "CS2",
    caption: "Valve",
    scene: "shooter"
  },
  {
    id: "dota-2",
    slug: "dota-2",
    name: "Dota 2",
    publisher: "Valve",
    lotCount: 284,
    sections: ["popular"],
    gradient: "from-[#100506] via-[#3d0e10] to-[#050303]",
    panel: "bg-red-300/20",
    border: "border-red-300/20 hover:border-red-200/40",
    glow: GLOW.red,
    logo: "DOTA 2",
    caption: "Valve",
    scene: "fantasy"
  },
  {
    id: "valorant",
    slug: "valorant",
    name: "Valorant",
    publisher: "Riot Games",
    lotCount: 201,
    sections: ["popular"],
    gradient: "from-[#100507] via-[#52111e] to-[#07070d]",
    panel: "bg-rose-300/20",
    border: "border-rose-300/20 hover:border-rose-200/40",
    glow: GLOW.red,
    logo: "VALORANT",
    caption: "Riot Games",
    scene: "shooter"
  },
  {
    id: "rust",
    slug: "rust",
    name: "Rust",
    publisher: "Facepunch",
    lotCount: 93,
    sections: ["popular"],
    gradient: "from-[#0b0604] via-[#41200d] to-[#060505]",
    panel: "bg-orange-300/20",
    border: "border-orange-300/20 hover:border-orange-200/40",
    glow: GLOW.red,
    logo: "RUST",
    caption: "Survival",
    scene: "shooter"
  },
  {
    id: "call-of-duty",
    slug: "call-of-duty",
    name: "Call of Duty Warzone",
    publisher: "Activision",
    lotCount: 116,
    sections: ["popular"],
    image: `${CARD_IMAGE_BASE}/call-of-duty-mobile.webp`,
    gradient: "from-[#080706] via-[#3c2816] to-[#050505]",
    panel: "bg-stone-300/20",
    border: "border-stone-300/20 hover:border-amber-100/35",
    glow: GLOW.steel,
    logo: "WARZONE",
    caption: "Call of Duty",
    scene: "shooter"
  },
  {
    id: "fortnite",
    slug: "fortnite",
    name: "Fortnite",
    publisher: "Epic Games",
    lotCount: 156,
    sections: ["popular"],
    gradient: "from-[#071120] via-[#24327a] to-[#0a0615]",
    panel: "bg-sky-300/20",
    border: "border-sky-300/20 hover:border-sky-200/40",
    glow: GLOW.blue,
    logo: "FORTNITE",
    caption: "Epic Games",
    scene: "brawler"
  },
  {
    id: "gta-online",
    slug: "gta-online",
    name: "GTA V",
    publisher: "Rockstar",
    lotCount: 141,
    sections: ["popular"],
    gradient: "from-[#071005] via-[#285b17] to-[#040804]",
    panel: "bg-lime-300/20",
    border: "border-lime-300/20 hover:border-lime-200/40",
    glow: GLOW.green,
    logo: "GTA V",
    caption: "Rockstar",
    scene: "shooter"
  },
  {
    id: "apex-legends",
    slug: "apex-legends",
    name: "Apex Legends",
    publisher: "EA",
    lotCount: 87,
    sections: ["popular"],
    gradient: "from-[#120605] via-[#5c1812] to-[#050303]",
    panel: "bg-red-300/20",
    border: "border-red-300/20 hover:border-red-200/40",
    glow: GLOW.red,
    logo: "APEX",
    caption: "Legends",
    scene: "shooter"
  },
  {
    id: "minecraft",
    slug: "minecraft",
    name: "Minecraft",
    publisher: "Mojang",
    lotCount: 132,
    sections: ["popular"],
    gradient: "from-[#071005] via-[#1d5b22] to-[#080604]",
    panel: "bg-lime-300/20",
    border: "border-lime-300/20 hover:border-lime-200/40",
    glow: GLOW.green,
    logo: "MINECRAFT",
    caption: "Mojang",
    scene: "fantasy"
  },
  {
    id: "league-of-legends",
    slug: "league-of-legends",
    name: "League of Legends",
    publisher: "Riot Games",
    lotCount: 118,
    sections: ["popular"],
    gradient: "from-[#080604] via-[#4a2d0b] to-[#07132a]",
    panel: "bg-yellow-300/20",
    border: "border-amber-200/20 hover:border-yellow-100/40",
    glow: GLOW.gold,
    logo: "LEAGUE",
    caption: "of Legends",
    scene: "fantasy"
  }
];

/**
 * Some live-fetched games may arrive under a slightly different slug than the
 * one used for our static art/theme entries (e.g. a bare "pubg" instead of
 * "pubg-mobile"). Map those to the canonical catalog slug for theme/image lookup.
 */
const SLUG_ALIASES: Record<string, string> = {
  pubg: "pubg-mobile"
};

const CATALOG_BY_SLUG = new Map(GAME_CATALOG.map((entry) => [entry.slug, entry]));

/**
 * Naming patterns used to auto-include live games (from the backend) into a
 * homepage section even when they have no static catalog entry yet, and
 * shared with the sidebar mega-menu so both stay in sync on what counts as
 * "mobile" etc.
 */
export const SECTION_PATTERNS: Record<GameCatalogSection, RegExp> = {
  mobile: /pubg|free|genshin|brawl|clash|mobile|standoff|roblox|call-of-duty-mobile|arena|wild-rift/i,
  platform: /steam|epic|playstation|xbox|battle|nintendo|ubisoft|ea|rockstar|gog/i,
  popular: /cs2|counter|dota|valorant|rust|warzone|fortnite|gta|apex|minecraft|league|call-of-duty|roblox|standoff|arena|clash-royale|mobile-legends/i
};

export function buildSectionTiles(section: GameCatalogSection, liveGames: Game[]): CategoryTile[] {
  const liveBySlug = new Map(liveGames.map((game) => [game.slug, game]));
  const preferred = GAME_CATALOG.filter((entry) => entry.sections.includes(section));

  const tiles = preferred.map((entry) => {
    const live = liveBySlug.get(entry.slug);
    return {
      id: live?.id ?? entry.id,
      slug: entry.slug,
      name: live?.name ?? entry.name,
      publisher: live?.publisher ?? entry.publisher,
      // Only surface a lot count when it comes from a real live game (the backend's
      // per-game count). The static entry.lotCount values are seed/design placeholders,
      // not real inventory, so they must never be shown as if they were real counts.
      lotCount: live?.lotCount
    };
  });

  const used = new Set(tiles.map((tile) => tile.slug));
  const pattern = SECTION_PATTERNS[section];
  for (const game of liveGames) {
    if (used.has(game.slug) || !pattern.test(`${game.slug} ${game.name} ${game.publisher ?? ""}`)) continue;
    tiles.push({ id: game.id, slug: game.slug, name: game.name, publisher: game.publisher, lotCount: game.lotCount });
    used.add(game.slug);
  }

  return tiles;
}

export type CatalogGroupKey = "popular" | "platform" | "mobile" | "services" | "all";

export type CatalogGroup = {
  key: CatalogGroupKey;
  games: Game[];
};

// Store platforms and digital-service storefronts are seeded as "games" too (they have their
// own /games/:slug browse page), so the catalog groups them explicitly by slug rather than by
// the fuzzy name patterns used for actual game titles.
const CATALOG_PLATFORM_SLUGS = new Set([
  "steam", "epic-games", "playstation", "xbox", "battle-net", "nintendo", "riot-games", "ubisoft-connect", "ea-app", "rockstar", "gog"
]);
const CATALOG_SERVICE_SLUGS = new Set([
  "telegram", "discord", "spotify", "netflix", "youtube", "apple", "google-play", "amazon"
]);

/**
 * Classifies the live games list (from /marketplace/games) into the catalog panel's
 * top-level groups. Every entry is a real game/platform/service with a working
 * /games/:slug browse page, so the whole catalog stays clickable and data-driven.
 * Games are ordered by real inventory (lotCount), then popularity, then name; empty
 * groups are dropped so the panel never shows a section with nothing behind it.
 */
export function buildCatalogGroups(games: Game[]): CatalogGroup[] {
  const sorted = [...games].sort(
    (a, b) =>
      (b.lotCount ?? 0) - (a.lotCount ?? 0) ||
      (b.popularity ?? 0) - (a.popularity ?? 0) ||
      a.name.localeCompare(b.name)
  );
  const matches = (game: Game, pattern: RegExp) => pattern.test(`${game.slug} ${game.name} ${game.publisher ?? ""}`);
  // The admin-picked catalogType (catalog builder) is the source of truth; the slug sets /
  // name patterns only classify rows the API hasn't typed yet (older cached responses).
  const typeOf = (game: Game): "game" | "mobile" | "platform" | "service" => {
    if (game.catalogType) return game.catalogType;
    if (CATALOG_PLATFORM_SLUGS.has(game.slug)) return "platform";
    if (CATALOG_SERVICE_SLUGS.has(game.slug)) return "service";
    if (matches(game, SECTION_PATTERNS.mobile)) return "mobile";
    return "game";
  };

  // Admin-curated isPopular games are pinned first; the name-pattern match only fills in
  // behind them, so a freshly created game flagged as popular shows up here without having
  // to match any hardcoded title pattern.
  const isTitle = (game: Game) => typeOf(game) === "game" || typeOf(game) === "mobile";
  const curatedPopular = sorted.filter((game) => game.isPopular);
  const patternPopular = sorted.filter((game) => !game.isPopular && isTitle(game) && matches(game, SECTION_PATTERNS.popular));

  const groups: CatalogGroup[] = [
    { key: "popular", games: [...curatedPopular, ...patternPopular] },
    { key: "platform", games: sorted.filter((game) => typeOf(game) === "platform") },
    { key: "mobile", games: sorted.filter((game) => typeOf(game) === "mobile") },
    { key: "services", games: sorted.filter((game) => typeOf(game) === "service") },
    { key: "all", games: sorted }
  ];

  return groups.filter((group) => group.games.length > 0);
}

export function getGameTileTheme(slug: string, name: string): GameTileThemeConfig {
  const entry = CATALOG_BY_SLUG.get(slug) ?? CATALOG_BY_SLUG.get(SLUG_ALIASES[slug]);
  if (entry) {
    const { gradient, panel, border, glow, logo, caption, scene, image } = entry;
    return { gradient, panel, border, glow, logo, caption, scene, image };
  }
  return { ...DEFAULT_THEME, logo: name };
}
