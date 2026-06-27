"use client";

import {
  Aperture,
  Blocks,
  Bot,
  Castle,
  Crosshair,
  Flame,
  Gamepad2,
  Gem,
  Ghost,
  Globe2,
  Hammer,
  Hexagon,
  Joystick,
  Landmark,
  Monitor,
  Music2,
  Plane,
  Play,
  Radio,
  Rocket,
  Shield,
  Swords,
  Trophy,
  Tv,
  WandSparkles,
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type IconPreset = {
  icon: LucideIcon;
  bg: string;
  glow: string;
  accent?: string;
};

const presets: Record<string, IconPreset> = {
  cs2: { icon: Crosshair, bg: "from-orange-400 via-amber-500 to-zinc-950", glow: "bg-orange-300/35", accent: "bg-orange-200/25" },
  "dota-2": { icon: Swords, bg: "from-red-500 via-rose-700 to-stone-950", glow: "bg-red-300/35", accent: "bg-red-200/20" },
  fortnite: { icon: Castle, bg: "from-sky-300 via-blue-500 to-indigo-950", glow: "bg-sky-200/35", accent: "bg-blue-200/25" },
  valorant: { icon: Zap, bg: "from-rose-400 via-red-500 to-slate-950", glow: "bg-rose-200/35", accent: "bg-red-200/20" },
  steam: { icon: Monitor, bg: "from-slate-300 via-slate-600 to-slate-950", glow: "bg-white/25", accent: "bg-slate-100/20" },
  "genshin-impact": { icon: WandSparkles, bg: "from-cyan-200 via-teal-400 to-emerald-950", glow: "bg-cyan-100/45", accent: "bg-teal-100/25" },
  minecraft: { icon: Blocks, bg: "from-lime-300 via-emerald-500 to-stone-950", glow: "bg-lime-200/40", accent: "bg-emerald-100/25" },
  roblox: { icon: Hexagon, bg: "from-red-400 via-orange-500 to-stone-950", glow: "bg-orange-200/40", accent: "bg-red-100/25" },
  "league-of-legends": { icon: Trophy, bg: "from-blue-300 via-blue-700 to-yellow-950", glow: "bg-blue-100/35", accent: "bg-yellow-200/25" },
  "apex-legends": { icon: Flame, bg: "from-red-400 via-rose-600 to-zinc-950", glow: "bg-red-200/35", accent: "bg-rose-100/20" },
  pubg: { icon: Shield, bg: "from-yellow-300 via-orange-500 to-stone-950", glow: "bg-yellow-100/40", accent: "bg-orange-200/25" },
  warface: { icon: Crosshair, bg: "from-emerald-300 via-teal-600 to-slate-950", glow: "bg-emerald-200/35", accent: "bg-teal-100/25" },
  "war-thunder": { icon: Plane, bg: "from-green-300 via-emerald-600 to-stone-950", glow: "bg-green-200/35", accent: "bg-emerald-100/20" },
  "world-of-tanks": { icon: Shield, bg: "from-amber-300 via-orange-600 to-stone-950", glow: "bg-amber-200/40", accent: "bg-orange-100/25" },
  "escape-from-tarkov": { icon: Crosshair, bg: "from-zinc-300 via-zinc-600 to-stone-950", glow: "bg-zinc-100/25", accent: "bg-white/15" },
  "rainbow-six-siege": { icon: Shield, bg: "from-slate-200 via-blue-600 to-slate-950", glow: "bg-blue-100/35", accent: "bg-white/20" },
  "overwatch-2": { icon: Aperture, bg: "from-orange-300 via-yellow-500 to-slate-950", glow: "bg-yellow-100/40", accent: "bg-orange-100/25" },
  "rocket-league": { icon: Rocket, bg: "from-sky-300 via-indigo-600 to-slate-950", glow: "bg-sky-100/40", accent: "bg-indigo-100/20" },
  fifa: { icon: Trophy, bg: "from-emerald-300 via-green-600 to-slate-950", glow: "bg-green-100/35", accent: "bg-emerald-100/20" },
  "gta-online": { icon: Landmark, bg: "from-lime-300 via-green-600 to-stone-950", glow: "bg-lime-100/35", accent: "bg-green-100/20" },
  rust: { icon: Hammer, bg: "from-orange-300 via-red-700 to-stone-950", glow: "bg-orange-100/35", accent: "bg-red-100/20" },
  "albion-online": { icon: Swords, bg: "from-amber-200 via-yellow-700 to-stone-950", glow: "bg-yellow-100/35", accent: "bg-amber-100/20" },
  "lost-ark": { icon: Gem, bg: "from-violet-300 via-purple-700 to-slate-950", glow: "bg-violet-100/35", accent: "bg-purple-100/20" },
  "black-desert": { icon: Ghost, bg: "from-zinc-200 via-zinc-800 to-black", glow: "bg-white/20", accent: "bg-zinc-100/15" },
  "final-fantasy-xiv": { icon: WandSparkles, bg: "from-fuchsia-200 via-indigo-600 to-slate-950", glow: "bg-fuchsia-100/35", accent: "bg-indigo-100/20" },
  "destiny-2": { icon: Aperture, bg: "from-slate-100 via-blue-500 to-slate-950", glow: "bg-white/30", accent: "bg-blue-100/20" },
  "diablo-iv": { icon: Flame, bg: "from-red-500 via-red-800 to-black", glow: "bg-red-200/25", accent: "bg-red-100/15" },
  "path-of-exile": { icon: Gem, bg: "from-amber-200 via-stone-700 to-black", glow: "bg-amber-100/30", accent: "bg-stone-100/15" },
  "honkai-star-rail": { icon: Rocket, bg: "from-blue-200 via-indigo-600 to-violet-950", glow: "bg-blue-100/35", accent: "bg-indigo-100/20" },
  "zenless-zone-zero": { icon: Radio, bg: "from-lime-200 via-zinc-700 to-black", glow: "bg-lime-100/30", accent: "bg-white/15" },
  "clash-of-clans": { icon: Shield, bg: "from-yellow-300 via-red-600 to-stone-950", glow: "bg-yellow-100/35", accent: "bg-red-100/20" },
  "clash-royale": { icon: Trophy, bg: "from-blue-300 via-indigo-600 to-yellow-950", glow: "bg-blue-100/35", accent: "bg-yellow-100/20" },
  "brawl-stars": { icon: Flame, bg: "from-yellow-300 via-orange-500 to-red-950", glow: "bg-yellow-100/35", accent: "bg-orange-100/20" },
  "mobile-legends": { icon: Swords, bg: "from-sky-200 via-blue-700 to-indigo-950", glow: "bg-sky-100/35", accent: "bg-blue-100/20" },
  "free-fire": { icon: Flame, bg: "from-amber-300 via-orange-600 to-stone-950", glow: "bg-amber-100/35", accent: "bg-orange-100/20" },
  "call-of-duty": { icon: Crosshair, bg: "from-green-300 via-zinc-700 to-black", glow: "bg-green-100/25", accent: "bg-zinc-100/15" },
  "call-of-duty-mobile": { icon: Crosshair, bg: "from-yellow-300 via-zinc-700 to-black", glow: "bg-yellow-100/30", accent: "bg-zinc-100/15" },
  hearthstone: { icon: Gem, bg: "from-blue-200 via-cyan-600 to-amber-950", glow: "bg-cyan-100/35", accent: "bg-amber-100/20" },
  "team-fortress-2": { icon: Crosshair, bg: "from-orange-300 via-red-600 to-stone-950", glow: "bg-orange-100/35", accent: "bg-red-100/20" },
  terraria: { icon: Blocks, bg: "from-lime-200 via-green-700 to-sky-950", glow: "bg-lime-100/35", accent: "bg-green-100/20" },
  "standoff-2": { icon: Crosshair, bg: "from-amber-300 via-zinc-700 to-black", glow: "bg-amber-100/30", accent: "bg-white/15" },
  palworld: { icon: Ghost, bg: "from-cyan-200 via-sky-600 to-emerald-950", glow: "bg-cyan-100/35", accent: "bg-sky-100/20" },
  "helldivers-2": { icon: Shield, bg: "from-yellow-300 via-zinc-700 to-black", glow: "bg-yellow-100/35", accent: "bg-zinc-100/15" },
  "the-finals": { icon: Trophy, bg: "from-yellow-300 via-orange-500 to-red-950", glow: "bg-yellow-100/35", accent: "bg-orange-100/20" },
  deadlock: { icon: Aperture, bg: "from-purple-300 via-indigo-700 to-slate-950", glow: "bg-purple-100/35", accent: "bg-indigo-100/20" },
  nintendo: { icon: Joystick, bg: "from-red-300 via-red-600 to-stone-950", glow: "bg-red-100/35", accent: "bg-white/20" },
  playstation: { icon: Gamepad2, bg: "from-blue-300 via-blue-700 to-slate-950", glow: "bg-blue-100/35", accent: "bg-white/20" },
  xbox: { icon: Gamepad2, bg: "from-green-300 via-emerald-700 to-slate-950", glow: "bg-green-100/35", accent: "bg-white/20" },
  "epic-games": { icon: Gamepad2, bg: "from-zinc-200 via-zinc-700 to-black", glow: "bg-white/20", accent: "bg-zinc-100/15" },
  "battle-net": { icon: Aperture, bg: "from-sky-200 via-blue-600 to-slate-950", glow: "bg-sky-100/35", accent: "bg-blue-100/20" },
  "riot-games": { icon: Flame, bg: "from-red-300 via-red-700 to-stone-950", glow: "bg-red-100/35", accent: "bg-white/15" },
  telegram: { icon: Radio, bg: "from-sky-300 via-blue-500 to-slate-950", glow: "bg-sky-100/35", accent: "bg-white/20" },
  discord: { icon: Bot, bg: "from-indigo-300 via-violet-600 to-slate-950", glow: "bg-indigo-100/35", accent: "bg-violet-100/20" },
  spotify: { icon: Music2, bg: "from-lime-300 via-green-600 to-stone-950", glow: "bg-lime-100/35", accent: "bg-green-100/20" },
  netflix: { icon: Play, bg: "from-red-500 via-red-800 to-black", glow: "bg-red-100/25", accent: "bg-red-100/15" },
  youtube: { icon: Play, bg: "from-red-400 via-red-600 to-stone-950", glow: "bg-red-100/35", accent: "bg-white/20" },
  apple: { icon: Monitor, bg: "from-zinc-100 via-zinc-500 to-slate-950", glow: "bg-white/25", accent: "bg-zinc-100/15" },
  "google-play": { icon: Play, bg: "from-emerald-300 via-sky-500 to-indigo-950", glow: "bg-emerald-100/35", accent: "bg-sky-100/20" },
  amazon: { icon: Globe2, bg: "from-amber-300 via-orange-500 to-slate-950", glow: "bg-amber-100/35", accent: "bg-orange-100/20" }
};

const fallbackPalette = [
  "from-sky-400 via-blue-600 to-slate-950",
  "from-rose-400 via-red-600 to-slate-950",
  "from-amber-300 via-orange-600 to-slate-950",
  "from-emerald-300 via-teal-600 to-slate-950",
  "from-violet-400 via-indigo-700 to-slate-950",
  "from-slate-300 via-slate-600 to-slate-950"
];

export function GameIcon({ name, slug, className = "" }: { name: string; slug?: string; className?: string }) {
  const key = slug ?? name.toLowerCase().replace(/\s+/g, "-");
  const preset = presets[key];
  const index = Array.from(key).reduce((sum, char) => sum + char.charCodeAt(0), 0) % fallbackPalette.length;
  const Icon = preset?.icon ?? Gamepad2;
  const bg = preset?.bg ?? fallbackPalette[index];
  const glow = preset?.glow ?? "bg-white/25";
  const accent = preset?.accent ?? "bg-white/15";

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[22%] bg-gradient-to-br ${bg} text-white shadow-soft ring-1 ring-white/20 ${className}`}
      title={name}
      aria-label={name}
    >
      <span className={`absolute -left-1 -top-2 h-1/2 w-[72%] rounded-full ${glow} blur-[1px]`} />
      <span className={`absolute -bottom-4 -right-4 h-2/3 w-2/3 rounded-full ${accent}`} />
      <span className="absolute inset-x-[14%] top-[10%] h-[18%] rounded-full bg-white/20" />
      <span className="relative z-10 grid h-[58%] w-[58%] place-items-center rounded-[30%] bg-black/12 backdrop-blur-[1px]">
        <Icon className="h-[68%] w-[68%] stroke-[2.4]" />
      </span>
    </span>
  );
}
