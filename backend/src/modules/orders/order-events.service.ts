import { pool } from "../../db/pool.js";
import { defaultLocale } from "../../i18n/config.js";
import { t, type TranslateParams } from "../../i18n/t.js";

export async function recordOrderEvent(input: {
  orderId: string;
  actorId?: string | null;
  type: string;
  /**
   * i18n key under "orderEvents.*" — "<key>.title" / "<key>.body" are rendered into the
   * default locale for the stored columns, and the key + params are kept in metadata so
   * the timeline can be re-localized on read. Legacy callers may pass title/body directly
   * (e.g. when the body is user-generated content like a dispute reason).
   */
  templateKey?: string;
  params?: TranslateParams;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown>;
}) {
  const title = input.title ?? (input.templateKey ? t(defaultLocale, `${input.templateKey}.title`, input.params) : "");
  const body = input.body ?? (input.templateKey ? t(defaultLocale, `${input.templateKey}.body`, input.params) : null);
  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.templateKey ? { templateKey: input.templateKey } : {}),
    ...(input.params ? { params: input.params } : {})
  };
  const result = await pool.query(
    `insert into order_events(order_id, actor_id, type, title, body, metadata)
     values ($1, $2, $3, $4, $5, $6)
     returning id, order_id as "orderId", actor_id as "actorId", type, title, body, metadata, created_at as "createdAt"`,
    [input.orderId, input.actorId ?? null, input.type, title, body, JSON.stringify(metadata)]
  );
  return result.rows[0];
}
