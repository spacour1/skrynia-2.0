export type LocaleFormattingViolationKind = "hardcoded-regional-locale" | "locale-less-to-locale" | "locale-less-intl";

export type LocaleFormattingViolation = {
  kind: LocaleFormattingViolationKind;
  line: number;
  excerpt: string;
};

const RULES: Array<{ kind: LocaleFormattingViolationKind; expression: RegExp }> = [
  { kind: "hardcoded-regional-locale", expression: /\b[a-z]{2,3}-[A-Z]{2}\b/g },
  { kind: "locale-less-to-locale", expression: /\.toLocale(?:String|DateString|TimeString)\(\s*(?:\)|undefined\s*(?:,|\)))/g },
  {
    kind: "locale-less-intl",
    expression: /\b(?:new\s+)?Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat|Collator|PluralRules)\(\s*(?:\)|undefined\s*(?:,|\)))/g
  }
];

export function findLocaleFormattingViolations(source: string): LocaleFormattingViolation[] {
  const violations: LocaleFormattingViolation[] = [];
  for (const { kind, expression } of RULES) {
    expression.lastIndex = 0;
    for (const match of source.matchAll(expression)) {
      const index = match.index ?? 0;
      violations.push({
        kind,
        line: source.slice(0, index).split("\n").length,
        excerpt: match[0]
      });
    }
  }
  return violations.sort((left, right) => left.line - right.line || left.kind.localeCompare(right.kind));
}
