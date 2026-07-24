// Backward-compatible path for existing development commands and deployments. The
// actual API entrypoint never starts BullMQ processors or the outbox polling loop.
import "./entrypoints/api.js";
