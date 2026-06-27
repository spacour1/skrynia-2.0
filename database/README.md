# Database Schema

The PostgreSQL schema is managed as versioned migrations (via `node-pg-migrate`) at:

`backend/migrations/`

Apply pending migrations:

```bash
cd backend
npm run migrate
```

Create a new migration:

```bash
cd backend
npm run migrate:create -- some-change-name
```

The Docker backend container also runs pending migrations on startup. Demo/test data is
seeded separately via `npm run seed` (`backend/src/db/seed.ts`) and is not part of the
migration history.
