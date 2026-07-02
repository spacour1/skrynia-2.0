"use client";

import Link from "@/lib/navigation";
import { PhoneMissed } from "lucide-react";

/** Friendly replacement for the raw 403 phone_not_verified error (currently only thrown by wallet withdrawal). */
export function PhoneNotVerifiedNotice() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-400/40 bg-amber-100 p-4 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
      <div className="flex items-start gap-3">
        <PhoneMissed className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-bold">Подтвердите номер телефона</p>
          <p className="mt-1 leading-5">Для вывода средств нужно подтвердить номер телефона в настройках профиля.</p>
        </div>
      </div>
      <Link className="self-start font-bold underline underline-offset-2 transition hover:opacity-80" href="/settings">
        Открыть настройки
      </Link>
    </div>
  );
}
