import { CheckCircle2 } from "lucide-react";
import type { SettingsT } from "./types";

export function WorksCard({ t }: { t: SettingsT }) {
  return (
    <section className="app-card p-5">
      <h2 className="flex items-center gap-2 font-black text-ink">
        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        {t("settings.works.title")}
      </h2>
      <div className="mt-4 space-y-3 text-sm leading-6 text-muted">
        <p>{t("settings.works.item1")}</p>
        <p>{t("settings.works.item2")}</p>
        <p>{t("settings.works.item3")}</p>
      </div>
    </section>
  );
}
