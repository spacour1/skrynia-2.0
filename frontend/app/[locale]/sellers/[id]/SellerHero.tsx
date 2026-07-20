"use client";

import { useRef } from "react";
import { BadgeCheck, Calendar, Clock, Heart, ImagePlus, Loader2, MessageCircle, Pencil, Star } from "lucide-react";
import { EmailNotVerifiedNotice } from "@/components/EmailNotVerifiedNotice";
import { isEmailNotVerifiedError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SellerStatsGrid } from "./SellerStatsGrid";

// Premium dark dungeon/gaming mood for sellers without a custom banner: gold glow
// left-center (chest), blue/purple crystal highlights right, deep warm-black base.
// Highlights are biased toward the upper third of the hero, since the avatar/text/
// stats UI occupies the bottom two-thirds and would otherwise hide them.
const FALLBACK_BANNER =
  "radial-gradient(ellipse 65% 70% at 68% 8%, rgba(139,92,246,0.55), transparent 65%)," +
  "radial-gradient(ellipse 55% 60% at 88% 22%, rgba(56,189,248,0.45), transparent 60%)," +
  "radial-gradient(ellipse 70% 75% at 22% 20%, rgba(250,204,21,0.48), transparent 65%)," +
  "radial-gradient(ellipse 100% 60% at 15% 75%, rgba(217,119,6,0.28), transparent 65%)," +
  "linear-gradient(135deg, #1c1509 0%, #120d08 45%, #0b0f1a 100%)";

// Legibility scrim: keeps the top of the banner vivid and only darkens toward the
// bottom third, where the avatar/name/buttons sit.
const LEGIBILITY_OVERLAY =
  "linear-gradient(to top, rgba(8,7,6,0.90) 0%, rgba(8,7,6,0.45) 26%, rgba(8,7,6,0.12) 48%, rgba(8,7,6,0) 68%)";

export function SellerHero({
  displayName,
  avatarUrl,
  online,
  createdAt,
  bannerUrl,
  rating,
  reviewCount,
  completedOrders,
  tagline,
  isOwn,
  isFavorite,
  favoritePending,
  onToggleFavorite,
  messagePending,
  messageError,
  onMessage,
  onEditProfile,
  onEditBanner,
  onAvatarPick,
  avatarUploadPending,
  stats
}: {
  displayName: string;
  avatarUrl?: string | null;
  online?: boolean | null;
  createdAt: string;
  bannerUrl?: string;
  rating: number;
  reviewCount: number;
  completedOrders: number;
  tagline: string;
  isOwn: boolean;
  isFavorite: boolean;
  favoritePending: boolean;
  onToggleFavorite: () => void;
  messagePending: boolean;
  messageError: unknown;
  onMessage: () => void;
  onEditProfile: () => void;
  onEditBanner: () => void;
  onAvatarPick: (file: File) => void;
  avatarUploadPending: boolean;
  stats: { activeListings: number; completedSales: number; successRate: number | null; favoriteCount: number };
}) {
  const { t, locale } = useI18n();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const memberSince = new Date(createdAt).toLocaleDateString(locale === "ua" ? "uk-UA" : locale === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  return (
    <section className="relative min-h-[290px] overflow-hidden rounded-2xl border border-line bg-card shadow-soft">
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: bannerUrl ? `url(${bannerUrl})` : FALLBACK_BANNER }} />
      <div className="absolute inset-0" style={{ backgroundImage: LEGIBILITY_OVERLAY }} />

      {isOwn ? (
        <button
          type="button"
          className="absolute left-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-lg bg-black/35 px-2.5 py-1.5 text-xs font-bold text-white/90 backdrop-blur-sm transition hover:bg-black/50 hover:text-white"
          onClick={onEditBanner}
        >
          <ImagePlus className="h-3.5 w-3.5" />
          {t("seller.editBanner")}
        </button>
      ) : null}
      {isOwn ? (
        <button
          type="button"
          className="absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-lg bg-black/35 px-2.5 py-1.5 text-xs font-bold text-white/90 backdrop-blur-sm transition hover:bg-black/50 hover:text-white"
          onClick={onEditProfile}
        >
          <Pencil className="h-3.5 w-3.5" />
          {t("seller.editProfile")}
        </button>
      ) : null}

      <div className="relative z-10 grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-end">
        <div className="flex items-end gap-4">
          <div className="relative shrink-0">
            <span className="grid h-32 w-32 place-items-center overflow-hidden rounded-2xl border border-line bg-panel text-4xl font-black text-brand shadow-lift lg:h-[150px] lg:w-[150px]">
              {avatarUrl ? <img className="h-full w-full object-cover" src={avatarUrl} alt={displayName} /> : displayName.slice(0, 1).toUpperCase()}
            </span>
            {isOwn ? (
              <>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  aria-label={t("seller.avatar")}
                  onChange={(event) => {
                    const picked = event.target.files?.[0];
                    if (picked) onAvatarPick(picked);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="absolute -bottom-1.5 -right-1.5 grid h-8 w-8 place-items-center rounded-full border border-line bg-card text-muted shadow-soft transition hover:text-brand disabled:opacity-60"
                  aria-label={t("seller.avatar")}
                  disabled={avatarUploadPending}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {avatarUploadPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                </button>
              </>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="truncate text-xl font-black text-ink lg:text-2xl">{displayName}</h1>
              <BadgeCheck className="h-5 w-5 shrink-0 fill-sky-500 text-card" aria-label={t("seller.verifiedSeller")} />
            </div>
            {tagline ? <p className="mt-1 max-w-xl truncate text-sm text-muted">{tagline}</p> : null}

            <div className="mt-2 flex flex-wrap items-center gap-2.5 text-sm font-bold text-muted">
              {reviewCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-ink">
                  <Star className="h-4 w-4 fill-action text-action" />
                  {rating.toFixed(1)} <span className="font-normal text-muted">({reviewCount})</span>
                </span>
              ) : (
                <span className="text-ink">{t("seller.newSeller")}</span>
              )}
              <span aria-hidden className="opacity-40">
                •
              </span>
              <span>{completedOrders} {t("seller.completedSales").toLowerCase()}</span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isOwn ? (
                <span className="text-xs font-bold text-muted">{t("seller.thisIsYourProfile")}</span>
              ) : (
                <>
                  <button type="button" className="app-button h-10 min-w-[130px] px-4 text-sm" disabled={messagePending} onClick={onMessage}>
                    <MessageCircle className="h-4 w-4" />
                    {messagePending ? t("seller.openingChat") : t("seller.messageUser")}
                  </button>
                  <button
                    type="button"
                    className={`h-10 min-w-[130px] px-4 text-sm ${isFavorite ? "app-button" : "app-button-secondary"}`}
                    disabled={favoritePending}
                    onClick={onToggleFavorite}
                  >
                    <Heart className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
                    {isFavorite ? t("seller.saved") : t("seller.saveUser")}
                  </button>
                </>
              )}
            </div>
            {messageError ? (
              isEmailNotVerifiedError(messageError) ? (
                <div className="mt-2 max-w-md">
                  <EmailNotVerifiedNotice />
                </div>
              ) : (
                <p className="mt-2 max-w-md rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">
                  {messageError instanceof Error ? messageError.message : t("common.somethingWentWrong")}
                </p>
              )
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-bold text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {t("seller.memberSince", { date: memberSince })}
              </span>
              <span aria-hidden className="opacity-40">
                •
              </span>
              <span className="inline-flex items-center gap-1.5">
                {online === true ? <span className="h-2 w-2 rounded-full bg-emerald-400" /> : <Clock className="h-3.5 w-3.5" />}
                {online == null
                  ? t("seller.presenceUnknown")
                  : online
                    ? t("seller.online")
                    : t("seller.offline")}
              </span>
            </div>
          </div>
        </div>

        <SellerStatsGrid {...stats} />
      </div>
    </section>
  );
}
