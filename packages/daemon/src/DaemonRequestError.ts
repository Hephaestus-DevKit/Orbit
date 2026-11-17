/** Classify request failures without sending internal paths, stack traces, or provider payloads. */
export function daemonRequestError(error: unknown): {
  status: number;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) {
    return { status: 404, message: "Requested daemon resource was not found." };
  }
  if (/invalid|cannot|requires|not queued|already/i.test(message)) {
    return {
      status: 409,
      message: "Daemon request conflicts with the current task state.",
    };
  }
  return { status: 400, message: "Invalid daemon request." };
}
