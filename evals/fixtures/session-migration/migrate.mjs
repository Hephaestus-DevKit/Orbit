export function migrateSession(session) {
  if (session.version === 2) return session;
  session.version = 2;
  session.turns = session.messages;
  delete session.messages;
  return session;
}
