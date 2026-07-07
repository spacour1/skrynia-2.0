"use client";

import { useRef } from "react";
import { BadgeCheck, Calendar, Camera, Check, Clock3, Heart, Loader2, MessageCircle, Pencil, Star } from "lucide-react";
import { EmailNotVerifiedNotice } from "@/components/EmailNotVerifiedNotice";
import { isEmailNotVerifiedError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SellerStatsGrid } from "./SellerStatsGrid";

const DEFAULT_BANNER_URL = "/images/default-seller-banner.svg";

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
  online?: boolean;
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
  stats: { activeListings: number; completedSales: number; successRate: number; favoriteCount: number };
}) {
  const { t, locale } = useI18n();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const memberSince = new Date(createdAt).toLocaleDateString(locale === "ua" ? "uk-UA" : locale === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  return (
    <section className="relative min-h-[680px] overflow-hidden rounded-2xl border border-line bg-card shadow-soft lg:h-[360px] lg:min-h-0">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bannerUrl || DEFAULT_BANNER_URL})` }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,13,0.34),rgba(2,6,13,0.05)_42%,rgba(2,6,13,0.42)),linear-gradient(180deg,rgba(2,6,13,0.04),rgba(2,6,13,0.18)_46%,rgba(2,6,13,0.92))]" />

      {isOwn ? (
        <button
          type="button"
          className="absolute left-5 top-5 z-20 inline-flex h-9 items-center gap-2 rounded-lg border border-line/80 bg-[#07101b]/80 px-4 text-xs font-bold text-white shadow-soft backdrop-blur-md transition hover:border-brand/60 hover:text-brand"
          onClick={onEditBanner}
        >
          <Camera className="h-4 w-4" />
          {t("seller.editBanner")}
        </button>
      ) : null}
      {isOwn ? (
        <button
          type="button"
          className="absolute right-5 top-5 z-20 inline-flex h-9 items-center gap-2 rounded-lg border border-line/80 bg-[#07101b]/80 px-4 text-xs font-bold text-white shadow-soft backdrop-blur-md transition hover:border-brand/60 hover:text-brand"
          onClick={onEditProfile}
        >
          <Pencil className="h-4 w-4" />
          {t("seller.editProfile")}
        </button>
      ) : null}

      <div className="relative z-10 grid h-full gap-8 p-6 pt-16 lg:grid-cols-[minmax(0,1fr)_550px] lg:p-8 xl:grid-cols-[minmax(0,1fr)_620px]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-8">
          <div className="relative shrink-0">
            <span className="grid h-[155px] w-[155px] place-items-center overflow-hidden rounded-2xl border border-line bg-[#07101b]/95 shadow-lift">
              {avatarUrl ? <img className="h-full w-full object-cover" src={avatarUrl} alt={displayName} /> : <SellerShieldAvatar />}
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
                  className="absolute -bottom-1.5 -right-1.5 grid h-10 w-10 place-items-center rounded-full border border-line bg-card/95 text-muted shadow-soft transition hover:border-brand/60 hover:text-brand disabled:opacity-60"
                  aria-label={t("seller.avatar")}
                  disabled={avatarUploadPending}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {avatarUploadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                </button>
              </>
            ) : null}
          </div>

          <div className="min-w-0 max-w-[520px]">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[28px] font-black leading-tight text-white">{displayName}</h1>
              <BadgeCheck className="h-5 w-5 shrink-0 fill-brand text-stone-950" aria-label={t("seller.verifiedSeller")} />
            </div>
            {tagline ? <p className="mt-3 max-w-[500px] truncate text-[15px] font-medium text-slate-200">{tagline}</p> : null}

            <div className="mt-8 flex flex-wrap items-center gap-6 text-[15px] font-bold text-slate-200">
              <span className="inline-flex items-center gap-2">
                <Star className="h-5 w-5 fill-action text-action" />
                {reviewCount > 0 ? (
                  <>
                    {rating.toFixed(1)} <span className="font-medium text-slate-300">({reviewCount.toLocaleString()} reviews)</span>
                  </>
                ) : (
                  <span>{t("seller.newSeller")}</span>
                )}
              </span>
              <span className="h-5 w-px bg-line" aria-hidden />
              <span>
                {completedOrders.toLocaleString()} <span className="font-medium text-slate-300">{t("seller.completedSales").toLowerCase()}</span>
              </span>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              {isOwn ? (
                <span className="text-sm font-bold text-muted">{t("seller.thisIsYourProfile")}</span>
              ) : (
                <>
                  <button type="button" className="app-button h-12 min-w-[160px] rounded-lg px-6 text-base" disabled={messagePending} onClick={onMessage}>
                    <MessageCircle className="h-5 w-5" />
                    {messagePending ? t("seller.openingChat") : t("seller.messageUser")}
                  </button>
                  <button
                    type="button"
                    className={`h-12 min-w-[185px] rounded-lg px-6 text-base ${isFavorite ? "app-button" : "app-button-secondary bg-[#07101b]/80"}`}
                    disabled={favoritePending}
                    onClick={onToggleFavorite}
                  >
                    <Heart className={`h-5 w-5 ${isFavorite ? "fill-current" : ""}`} />
                    {isFavorite ? t("seller.saved") : t("seller.saveUser")}
                  </button>
                </>
              )}
            </div>
            {messageError ? (
              isEmailNotVerifiedError(messageError) ? (
                <div className="mt-3 max-w-md">
                  <EmailNotVerifiedNotice />
                </div>
              ) : (
                <p className="mt-3 max-w-md rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">
                  {messageError instanceof Error ? messageError.message : t("common.somethingWentWrong")}
                </p>
              )
            ) : null}

            <div className="mt-8 flex flex-wrap items-center gap-6 text-sm font-medium text-slate-300">
              <span className="inline-flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t("seller.memberSince", { date: memberSince })}
              </span>
              <span className="h-4 w-px bg-line" aria-hidden />
              <span className="inline-flex items-center gap-2">
                {online ? <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> : <Clock3 className="h-4 w-4" />}
                {online ? t("seller.online") : t("seller.lastSeen", { time: "5 hours ago" })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end">
          <SellerStatsGrid {...stats} />
        </div>
      </div>
    </section>
  );
}

function SellerShieldAvatar() {
  return (
    <span className="relative grid h-full w-full place-items-center bg-[#06111d]">
      <span
        className="absolute h-[122px] w-[104px] bg-gradient-to-b from-yellow-300 via-yellow-500 to-emerald-900 shadow-[0_16px_42px_rgba(16,185,129,0.32)]"
        style={{ clipPath: "polygon(50% 0, 100% 20%, 88% 78%, 50% 100%, 12% 78%, 0 20%)" }}
      />
      <span
        className="absolute h-[92px] w-[78px] bg-gradient-to-b from-[#073b25] to-[#041912]"
        style={{ clipPath: "polygon(50% 0, 100% 20%, 88% 78%, 50% 100%, 12% 78%, 0 20%)" }}
      />
      <Check className="relative h-20 w-20 stroke-[4] text-emerald-400 drop-shadow-[0_0_18px_rgba(52,211,153,0.7)]" />
    </span>
  );
}
