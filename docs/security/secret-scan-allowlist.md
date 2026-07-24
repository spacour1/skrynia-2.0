# Secret-scan allowlist

Gitleaks scans the complete Git history with its default rules. The repository adds only two
finding-fingerprint exceptions for strings that were manually verified as documentation
placeholders on 2026-07-24.

| Path | Exact placeholder shape | Gitleaks rule | Reason |
| --- | --- | --- | --- |
| `.env.example` | `TWO_FACTOR_ENCRYPTION_KEY=replace-with-64-hexadecimal-characters` | `generic-api-key` | Instructional text that is not valid 64-character hexadecimal key material. |
| `docs/telegram-bot.md` | `TELEGRAM_BOT_TOKEN=123456:` followed by 35 `A` characters | `telegram-bot-api-token` | Telegram-format example with an intentionally synthetic repeated value. |

Each line of `.github/gitleaksignore` includes the exact introducing commit, repository path,
rule ID, and line number reported by Gitleaks. It does not exempt a commit, an entire file, a
rule, a token prefix, or another value in either file. Any changed example receives a different
fingerprint, is scanned normally, and must be reviewed again. Real credentials must never be
added as examples or allowlist entries.
