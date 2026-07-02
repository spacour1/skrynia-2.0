"use client";

import Link from "@/lib/navigation";
import { usePathname } from "@/lib/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";

export function RequireAuth({
  children,
  roles
}: {
  children: React.ReactNode;
  roles?: Array<"user" | "moderator" | "admin">;
}) {
  const { user, hydrated, hydrate } = useAuth();
  const { t } = useI18n();
  const pathname = usePathname();

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrate, hydrated]);

  if (!hydrated) return <div className="app-card p-6">{t("common.loading")}</div>;
  if (!user) {
    return (
      <div className="app-card p-6">
        <h1 className="text-xl font-bold">{t("auth.loginRequired")}</h1>
        <p className="mt-2 text-sm text-muted">{t("auth.loginRequiredText")}</p>
        <Link className="app-button mt-4" href={`/login?next=${encodeURIComponent(pathname)}`}>
          {t("nav.login")}
        </Link>
      </div>
    );
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="app-card p-6 text-sm text-rose-700 dark:text-rose-300">
        {t("auth.roleDenied")}
      </div>
    );
  }
  return <>{children}</>;
}
