export interface TuiTheme {
  readonly user: (text: string) => string;
  readonly userBold: (text: string) => string;
  readonly asst: (text: string) => string;
  readonly asstBold: (text: string) => string;
  readonly cyan: (text: string) => string;
  readonly accent: (text: string) => string;
  readonly completed: (text: string) => string;
  readonly failed: (text: string) => string;
  readonly warn: (text: string) => string;
  readonly white: (text: string) => string;
  readonly whiteBold: (text: string) => string;
  readonly gray: (text: string) => string;
  readonly dim: (text: string) => string;
}

export type TuiColorMode = "auto" | "always" | "never";
export type TuiThemeName = "morandi" | "high-contrast" | "plain";

/** A color-capable theme that leaves text untouched for accessible terminals. */
export const PLAIN: TuiTheme = {
  user: (text) => text,
  userBold: (text) => text,
  asst: (text) => text,
  asstBold: (text) => text,
  cyan: (text) => text,
  accent: (text) => text,
  completed: (text) => text,
  failed: (text) => text,
  warn: (text) => text,
  white: (text) => text,
  whiteBold: (text) => text,
  gray: (text) => text,
  dim: (text) => text,
};

/** Orbit's restrained terminal palette, shared by independent TUI views. */
export const MORANDI: TuiTheme = {
  user: (text) => `\x1b[38;2;158;184;196m${text}\x1b[0m`,
  userBold: (text) => `\x1b[1;38;2;158;184;196m${text}\x1b[0m`,
  asst: (text) => `\x1b[38;2;164;178;150m${text}\x1b[0m`,
  asstBold: (text) => `\x1b[1;38;2;164;178;150m${text}\x1b[0m`,
  cyan: (text) => `\x1b[38;2;158;184;196m${text}\x1b[0m`,
  accent: (text) => `\x1b[38;2;224;188;124m${text}\x1b[0m`,
  completed: (text) => `\x1b[38;2;152;188;146m${text}\x1b[0m`,
  failed: (text) => `\x1b[38;2;212;132;132m${text}\x1b[0m`,
  warn: (text) => `\x1b[38;2;226;178;98m${text}\x1b[0m`,
  white: (text) => `\x1b[38;2;236;233;224m${text}\x1b[0m`,
  whiteBold: (text) => `\x1b[1;38;2;245;242;232m${text}\x1b[0m`,
  gray: (text) => `\x1b[38;2;178;176;168m${text}\x1b[0m`,
  dim: (text) => `\x1b[38;2;148;146;138m${text}\x1b[0m`,
};

/** A bright semantic palette for low-contrast terminals and color impairment. */
export const HIGH_CONTRAST: TuiTheme = {
  user: (text) => `\x1b[36m${text}\x1b[0m`,
  userBold: (text) => `\x1b[1;36m${text}\x1b[0m`,
  asst: (text) => `\x1b[32m${text}\x1b[0m`,
  asstBold: (text) => `\x1b[1;32m${text}\x1b[0m`,
  cyan: (text) => `\x1b[96m${text}\x1b[0m`,
  accent: (text) => `\x1b[93m${text}\x1b[0m`,
  completed: (text) => `\x1b[92m${text}\x1b[0m`,
  failed: (text) => `\x1b[91m${text}\x1b[0m`,
  warn: (text) => `\x1b[93m${text}\x1b[0m`,
  white: (text) => `\x1b[97m${text}\x1b[0m`,
  whiteBold: (text) => `\x1b[1;97m${text}\x1b[0m`,
  gray: (text) => `\x1b[90m${text}\x1b[0m`,
  dim: (text) => `\x1b[90m${text}\x1b[0m`,
};

/**
 * Resolves the terminal theme without making color a hidden global side effect.
 * Explicit configuration wins; auto mode follows the standard NO_COLOR and
 * FORCE_COLOR conventions and treats dumb terminals as text-only.
 */
export function resolveTuiTheme(
  mode: TuiColorMode = "auto",
  environment: Readonly<Record<string, string | undefined>> = process.env,
  theme: TuiThemeName = "morandi",
): TuiTheme {
  if (mode === "never" || theme === "plain") return PLAIN;
  if (mode === "always")
    return theme === "high-contrast" ? HIGH_CONTRAST : MORANDI;
  const forceColor =
    environment.FORCE_COLOR !== undefined && environment.FORCE_COLOR !== "0";
  if (forceColor) return theme === "high-contrast" ? HIGH_CONTRAST : MORANDI;
  if ("NO_COLOR" in environment || environment.TERM === "dumb") return PLAIN;
  return theme === "high-contrast" ? HIGH_CONTRAST : MORANDI;
}
