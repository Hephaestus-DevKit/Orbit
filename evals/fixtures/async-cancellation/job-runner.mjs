export function runDelayedJob(task, delayMs, signal) {
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      resolve(await task());
    }, delayMs);
    signal?.addEventListener("abort", () => {
      const error = new Error("cancelled");
      error.name = "AbortError";
      reject(error);
    });
  });
}
