"use client";

import type { ComponentProps } from "react";
import { ShieldCheck } from "lucide-react";
import { SectionHeader } from "./settings-ui";
import { PasswordPanel } from "./PasswordCard";
import { TwoFactorPanel } from "./TwoFactorCard";
import type { SettingsT } from "./types";

export function SecurityCard({
  password,
  twoFactor,
  t
}: {
  password: Omit<ComponentProps<typeof PasswordPanel>, "t">;
  twoFactor: Omit<ComponentProps<typeof TwoFactorPanel>, "t">;
  t: SettingsT;
}) {
  return (
    <section className="app-card overflow-hidden">
      <SectionHeader icon={ShieldCheck} title={t("settings.security.title")} text={t("settings.security.text")} />
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <PasswordPanel {...password} t={t} />
        <div className="border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <TwoFactorPanel {...twoFactor} t={t} />
        </div>
      </div>
    </section>
  );
}
