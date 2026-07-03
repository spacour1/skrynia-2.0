import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "public", "assets", "game-cards");
mkdirSync(outDir, { recursive: true });

const cards = [
  ["pubg", "PUBG", "MOBILE", "#f59e0b", "#3b2108", "soldier"],
  ["free-fire", "FREE FIRE", "GARENA", "#fbbf24", "#3b1707", "fighter"],
  ["genshin-impact", "GENSHIN", "IMPACT", "#f8d891", "#2a1b09", "fantasy"],
  ["brawl-stars", "BRAWL STARS", "SUPERCELL", "#facc15", "#52180b", "brawler"],
  ["clash-of-clans", "CLASH", "OF CLANS", "#fbbf24", "#4a1a07", "royal"],
  ["clash-royale", "CLASH ROYALE", "ARENA", "#fbbf24", "#172554", "royal"],
  ["mobile-legends", "MOBILE LEGENDS", "MOONTON", "#60a5fa", "#172554", "fantasy"],
  ["league-wild-rift", "WILD RIFT", "LEAGUE OF LEGENDS", "#38bdf8", "#1e3a8a", "fantasy"],
  ["roblox", "ROBLOX", "ACCOUNTS", "#f87171", "#3b1115", "brawler"],
  ["standoff-2", "STANDOFF 2", "SHOOTER", "#fb923c", "#3b1b08", "soldier"],
  ["arena-breakout", "ARENA BREAKOUT", "TACTICAL FPS", "#d6d3d1", "#292524", "soldier"],
  ["call-of-duty-mobile", "CALL OF DUTY", "MOBILE", "#facc15", "#3b2a0a", "soldier"],
  ["steam", "Steam", "PC PLATFORM", "#93c5fd", "#0f2a44", "platform"],
  ["epic-games", "Epic Games", "STORE", "#e5e7eb", "#27272a", "platform"],
  ["playstation", "PlayStation", "CONSOLE", "#60a5fa", "#102a63", "platform"],
  ["xbox", "Xbox", "CONSOLE", "#4ade80", "#0f3d17", "platform"],
  ["battle-net", "BATTLE.NET", "BLIZZARD", "#38bdf8", "#0b3155", "platform"],
  ["nintendo", "Nintendo", "CONSOLE", "#f87171", "#5f1111", "platform"],
  ["ubisoft-connect", "Ubisoft", "CONNECT", "#67e8f9", "#0d3b66", "platform"],
  ["ea-app", "EA App", "PC PLATFORM", "#67e8f9", "#0b3a58", "platform"],
  ["rockstar", "Rockstar", "LAUNCHER", "#facc15", "#5f2b09", "platform"],
  ["gog", "GOG", "DRM-FREE", "#c4b5fd", "#2e1b65", "platform"],
  ["cs2", "CS2", "VALVE", "#fb923c", "#3a210c", "soldier"],
  ["dota-2", "DOTA 2", "VALVE", "#f87171", "#3d0e10", "fantasy"],
  ["valorant", "VALORANT", "RIOT GAMES", "#fb7185", "#4a111b", "soldier"],
  ["rust", "RUST", "SURVIVAL", "#fb923c", "#3b210c", "soldier"],
  ["call-of-duty", "WARZONE", "CALL OF DUTY", "#d6d3d1", "#30261c", "soldier"],
  ["fortnite", "FORTNITE", "EPIC GAMES", "#7dd3fc", "#27327a", "brawler"],
  ["gta-online", "GTA V", "ROCKSTAR", "#86efac", "#1d4d18", "soldier"],
  ["apex-legends", "APEX", "LEGENDS", "#fb7185", "#4b1212", "soldier"],
  ["minecraft", "MINECRAFT", "MOJANG", "#86efac", "#1f5b22", "fantasy"],
  ["league-of-legends", "LEAGUE", "OF LEGENDS", "#f8d891", "#3d290d", "fantasy"]
];

function scene(kind, color) {
  if (kind === "platform") {
    return `
      <g opacity=".62" transform="translate(690 48) skewX(-8)">
        <rect width="390" height="154" rx="18" fill="#06101c" stroke="${color}" stroke-opacity=".25"/>
        <rect x="24" y="24" width="88" height="56" rx="10" fill="${color}" opacity=".16"/>
        <rect x="126" y="24" width="88" height="56" rx="10" fill="#ffffff" opacity=".08"/>
        <rect x="228" y="24" width="88" height="56" rx="10" fill="${color}" opacity=".12"/>
        <rect x="24" y="96" width="132" height="34" rx="8" fill="#ffffff" opacity=".08"/>
        <rect x="172" y="96" width="74" height="34" rx="8" fill="${color}" opacity=".15"/>
        <rect x="262" y="96" width="92" height="34" rx="8" fill="#ffffff" opacity=".07"/>
      </g>
      <circle cx="1042" cy="112" r="52" fill="${color}" opacity=".12"/>
      <path d="M1008 112h68M1042 78v68" stroke="${color}" stroke-width="8" stroke-linecap="round" opacity=".34"/>`;
  }

  if (kind === "fantasy" || kind === "royal") {
    return `
      <path d="M805 210c8-68 46-126 108-148 68 31 92 92 94 148Z" fill="#0b0f17" opacity=".72"/>
      <circle cx="900" cy="76" r="39" fill="${color}" opacity=".34"/>
      <path d="M856 132c46-14 92-14 138 0" stroke="${color}" stroke-width="10" stroke-linecap="round" opacity=".42"/>
      <path d="M977 76l18 36 39 6-28 28 7 39-36-18-35 18 6-39-28-28 39-6Z" fill="${color}" opacity=".28"/>`;
  }

  if (kind === "brawler") {
    return `
      <path d="M818 210c0-76 42-136 110-136 62 0 106 54 106 136Z" fill="#0b0f17" opacity=".74"/>
      <circle cx="914" cy="78" r="43" fill="${color}" opacity=".38"/>
      <path d="M857 143c52-28 102-27 151 2" stroke="${color}" stroke-width="16" stroke-linecap="round" opacity=".36"/>
      <circle cx="875" cy="88" r="9" fill="#fff" opacity=".42"/>
      <circle cx="956" cy="88" r="9" fill="#fff" opacity=".42"/>`;
  }

  return `
    <path d="M828 210c3-72 34-132 96-148 62 16 92 76 96 148Z" fill="#111827" opacity=".78"/>
    <path d="M862 76h118l-16 48H878Z" fill="#020617" stroke="${color}" stroke-opacity=".32" stroke-width="4"/>
    <path d="M778 178l286-62" stroke="${color}" stroke-width="14" stroke-linecap="round" opacity=".28"/>
    <path d="M795 190l266-58" stroke="#f8fafc" stroke-width="4" stroke-linecap="round" opacity=".24"/>
    <circle cx="902" cy="92" r="34" fill="${color}" opacity=".18"/>`;
}

function svg([slug, title, subtitle, color, dark, kind]) {
  const isTwoLine = title.length > 10;
  const titleSize = isTwoLine ? 56 : 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="420" gradientUnits="userSpaceOnUse">
      <stop stop-color="#02060b"/>
      <stop offset=".42" stop-color="${dark}"/>
      <stop offset="1" stop-color="#020409"/>
    </linearGradient>
    <radialGradient id="flare" cx="72%" cy="76%" r="62%">
      <stop stop-color="${color}" stop-opacity=".46"/>
      <stop offset=".38" stop-color="${color}" stop-opacity=".16"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="12"/></filter>
    <filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity=".65"/></filter>
  </defs>
  <rect width="1200" height="420" rx="34" fill="url(#bg)"/>
  <rect x="10" y="10" width="1180" height="400" rx="28" fill="none" stroke="${color}" stroke-opacity=".42" stroke-width="3"/>
  <rect width="1200" height="420" rx="34" fill="url(#flare)"/>
  <g opacity=".24" filter="url(#soft)">
    <path d="M110 296c186-54 357-58 513-7 119 39 265 46 430-24" stroke="${color}" stroke-width="34" fill="none"/>
    <path d="M80 224c156-72 308-91 454-58" stroke="#fff" stroke-width="22" fill="none" opacity=".25"/>
  </g>
  ${scene(kind, color)}
  <g filter="url(#shadow)">
    <circle cx="174" cy="210" r="93" fill="#03101c" stroke="${color}" stroke-opacity=".36" stroke-width="3"/>
    <circle cx="174" cy="210" r="62" fill="${color}" opacity=".16"/>
    <text x="174" y="232" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-size="${title.length > 12 ? 30 : 42}" fill="#fff">${title.split(" ")[0]}</text>
  </g>
  <g filter="url(#shadow)">
    <text x="300" y="${isTwoLine ? 188 : 218}" font-family="Arial Black, Impact, sans-serif" font-size="${titleSize}" fill="#fff" letter-spacing="-1">${title}</text>
    <text x="304" y="${isTwoLine ? 246 : 266}" font-family="Arial, sans-serif" font-size="26" fill="${color}" font-weight="800" letter-spacing="4">${subtitle}</text>
  </g>
  <rect y="260" width="1200" height="160" fill="url(#bg)" opacity=".34"/>
</svg>`;
}

for (const card of cards) {
  writeFileSync(join(outDir, `${card[0]}.svg`), svg(card), "utf8");
}

console.log(`Generated ${cards.length} game card assets in ${outDir}`);
