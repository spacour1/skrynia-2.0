process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace_test";
// DB index 15 keeps email-verification/password-reset token tests off the dev Redis
// data (db 0) used by docker-compose.dev.yml. Tokens are random per test, so there's
// nothing to clean up between runs - they just sit until their TTL expires.
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
process.env.JWT_SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
process.env.METRICS_PASSWORD = "test-metrics-password-aaaa";
