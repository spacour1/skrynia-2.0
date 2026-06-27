process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace_test";
delete process.env.REDIS_URL;
process.env.JWT_SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
process.env.METRICS_PASSWORD = "test-metrics-password-aaaa";
