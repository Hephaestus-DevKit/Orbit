/**
 * Prevent console-subsystem child processes from creating visible windows.
 *
 * Node ignores this option on non-Windows platforms, so every runtime child
 * process can apply it consistently without platform branches.
 */
export const HIDDEN_CHILD_PROCESS_OPTIONS = Object.freeze({
  windowsHide: true,
});
