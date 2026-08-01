# Chat and WebSocket module rules

These rules extend the repository and backend instructions for
`backend/src/modules/chat/**`.

## Invariants

- Treat WebSocket authentication, session handling, and shutdown changes as D4 high
  risk. Coordinate relevant changes with the scoped auth instructions.
- Preserve conversation authorization for every REST read/write and every room join;
  knowing a conversation ID never grants access.
- WebSocket tickets remain one-time and Redis-backed. Recheck session revocation,
  durable `session_version`, user status, and allowed Origin during the handshake.
- Keep connection, room, join, frame, message, buffered-byte, and concurrent-handler
  bounds enforced. Do not add an unbounded queue or broadcast loop.
- Install cleanup and shutdown admission guards before awaited handshake or frame work.
  Drained handlers must stop safely when shutdown closes their boundary.
- Keep client message IDs idempotent. A replay with different content must remain a
  conflict, not a second message.
- Persist messages and their domain-outbox event in the same transaction. Broadcast
  only committed state; do not emit a realtime success before persistence commits.
- Do not expose access tokens, session IDs, tickets, message contents, or attachment
  credentials in logs.

## Verification gate

Run the D4 backend gate and the affected frontend chat/realtime tests:

```powershell
cd backend
npx vitest run test/chat-service.test.ts test/ws-ticket.test.ts test/websocket-shutdown-races.test.ts test/realtime-distribution.test.ts

cd ../frontend
npx vitest run test/chat-panel.test.tsx test/realtime-client.test.ts test/realtime-provider.test.tsx
```

Run the relevant E2E flow for changes to browser authentication, message delivery, or
reconnect behavior.
