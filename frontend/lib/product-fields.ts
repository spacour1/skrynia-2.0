const FIELD_LABELS: Record<string, string> = {
  rank: "Ранг",
  prime: "Prime статус",
  region: "Регион",
  platform: "Платформа",
  weapon: "Оружие",
  float: "Float",
  rarity: "Редкость",
  delivery: "Способ передачи",
  rank_from: "Ранг от",
  rank_to: "Ранг до",
  mode: "Режим",
  mmr: "MMR",
  behavior: "Порядочность",
  hero: "Герой",
  tradable: "Можно передавать",
  mmr_from: "MMR от",
  mmr_to: "MMR до",
  role: "Роль",
  skins: "Скины",
  email_access: "Родная почта",
  amount: "Количество",
  level: "Уровень",
  deadline: "Срок выполнения",
  edition: "Издание",
  faction: "Фракция",
  server: "Сервер",
  ar: "Adventure Rank",
  characters: "Персонажи",
  uid: "UID",
  activation: "Активация",
  from: "От",
  to: "До",
  requirements: "Требования",
  games_count: "Количество игр",
  plus: "Подписка / Plus",
  data_change: "Возможность смены данных",
  duration: "Длительность"
};

export const BOOLEAN_FIELD_KEYS = new Set(["email_access", "data_change", "tradable", "plus", "prime"]);

export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatFieldValue(key: string, value: unknown): string {
  if (BOOLEAN_FIELD_KEYS.has(key)) {
    if (value === "yes") return "Да";
    if (value === "no") return "Нет";
  }
  return typeof value === "string" ? value : String(value ?? "");
}
