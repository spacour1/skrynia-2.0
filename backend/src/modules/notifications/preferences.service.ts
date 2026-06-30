import { pool } from "../../db/pool.js";

export type NotificationPreferences = {
  emailEnabled: boolean;
  telegramEnabled: boolean;
};

const DEFAULT_PREFERENCES: NotificationPreferences = { emailEnabled: true, telegramEnabled: true };

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const result = await pool.query<{ emailEnabled: boolean; telegramEnabled: boolean }>(
    `select email_enabled as "emailEnabled", telegram_enabled as "telegramEnabled"
     from notification_preferences where user_id = $1`,
    [userId]
  );
  return result.rows[0] ?? DEFAULT_PREFERENCES;
}

export async function updateNotificationPreferences(
  userId: string,
  input: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences(userId);
  const next = { ...current, ...input };
  const result = await pool.query<{ emailEnabled: boolean; telegramEnabled: boolean }>(
    `insert into notification_preferences(user_id, email_enabled, telegram_enabled)
     values ($1, $2, $3)
     on conflict (user_id) do update set
       email_enabled = excluded.email_enabled,
       telegram_enabled = excluded.telegram_enabled,
       updated_at = now()
     returning email_enabled as "emailEnabled", telegram_enabled as "telegramEnabled"`,
    [userId, next.emailEnabled, next.telegramEnabled]
  );
  return result.rows[0];
}
