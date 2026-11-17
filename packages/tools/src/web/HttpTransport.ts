import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";

let initialized = false;

/** Initialize the CLI-owned default transport before starting requests.
 * Keep explicit proxy/custom dispatchers installed by the host. A stock Node
 * Agent must use our patched Undici rather than Node's vulnerable bundled copy.
 */
export function initializeHttpTransport(): void {
  if (initialized) return;
  initialized = true;
  const current = getGlobalDispatcher();
  if (current instanceof Agent || current.constructor.name !== "Agent") return;
  setGlobalDispatcher(new Agent());
}
