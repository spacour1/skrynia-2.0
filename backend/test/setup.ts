process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace_test";
// DB index 15 keeps email-verification/password-reset token tests off the dev Redis
// data (db 0) used by docker-compose.dev.yml. Tokens are random per test, so there's
// nothing to clean up between runs - they just sit until their TTL expires.
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
process.env.JWT_SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
process.env.TWO_FACTOR_ENCRYPTION_KEY = "11".repeat(32);
process.env.TWO_FACTOR_ENCRYPTION_KEY_VERSION = "1";
process.env.METRICS_PASSWORD = "test-metrics-password-aaaa";
// Pin this rather than inherit a developer's local .env: auth.test.ts asserts the
// refresh cookie's Max-Age is well over 60 days, which only holds at the code's own
// default (90) - a local .env tuned to a shorter session length (e.g. 30) would fail
// this test for reasons that have nothing to do with the code under test.
process.env.REFRESH_TOKEN_TTL_DAYS = "90";
// The whole suite shares one IP (supertest/localhost) and the auth limiter's 15-minute
// window survives in Redis (db 15) across runs - production-sized limits made full runs
// and quick re-runs fail with 429s unrelated to the code under test. No test asserts
// rate-limit behaviour, so raise the ceilings far above what the suite can generate.
process.env.AUTH_RATE_LIMIT_PER_15MIN = "100000";
process.env.API_RATE_LIMIT_PER_MIN = "100000";
process.env.WRITE_RATE_LIMIT_PER_MIN = "100000";
process.env.PUBLIC_READ_RATE_LIMIT_PER_MIN = "100000";
