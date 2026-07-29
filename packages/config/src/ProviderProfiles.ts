import { homedir } from "os";
import { join } from "path";
import { z } from "zod";
import {
  ensurePrivateDirectory,
  readBoundedRegularFile,
  replacePrivateFileAtomically,
} from "@orbit-build/shared";
import { ProviderConfigSchema } from "./schema.js";

const ProviderProfileIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const MAX_PROVIDER_PROFILES_BYTES = 1024 * 1024;

export const ProviderProfileSchema = z.object({
  id: ProviderProfileIdSchema,
  name: z.string().trim().min(1).max(120),
  config: ProviderConfigSchema.omit({ apiKey: true }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const ProviderProfilesFileSchema = z.object({
  version: z.literal(1).default(1),
  activeProvider: ProviderProfileIdSchema.optional(),
  profiles: z.array(ProviderProfileSchema).max(100),
});

export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
export type ProviderProfilesSnapshot = z.infer<
  typeof ProviderProfilesFileSchema
>;

export interface ProviderProfileStoreOptions {
  orbitDir?: string;
  platform?: NodeJS.Platform;
}

const EMPTY_SNAPSHOT: ProviderProfilesSnapshot = {
  version: 1,
  profiles: [],
};

/** Persist non-secret provider metadata separately from encrypted credentials. */
export class ProviderProfileStore {
  private readonly orbitDir: string;
  private readonly profilePath: string;
  private readonly isWindows: boolean;

  constructor(options: ProviderProfileStoreOptions = {}) {
    this.orbitDir = options.orbitDir ?? join(homedir(), ".orbit");
    this.profilePath = join(this.orbitDir, "providers.json");
    this.isWindows = (options.platform ?? process.platform) === "win32";
  }

  public read(): ProviderProfilesSnapshot {
    for (const candidate of [this.profilePath, `${this.profilePath}.bak`]) {
      try {
        const raw = readBoundedRegularFile(
          candidate,
          MAX_PROVIDER_PROFILES_BYTES,
        );
        if (raw === undefined) continue;
        const parsed = ProviderProfilesFileSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
      } catch {
        // Fall back to the last known-good provider profile snapshot.
      }
    }
    return structuredClone(EMPTY_SNAPSHOT);
  }

  public list(): ProviderProfile[] {
    return this.read().profiles;
  }

  public get(id: string): ProviderProfile | undefined {
    const parsedId = ProviderProfileIdSchema.safeParse(id);
    if (!parsedId.success) return undefined;
    return this.read().profiles.find((profile) => profile.id === parsedId.data);
  }

  public upsert(
    profile: Omit<ProviderProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): ProviderProfile {
    const snapshot = this.read();
    const existing = snapshot.profiles.find(
      (candidate) => candidate.id === profile.id,
    );
    const now = new Date().toISOString();
    const validated = ProviderProfileSchema.parse({
      ...profile,
      createdAt: profile.createdAt ?? existing?.createdAt ?? now,
      updatedAt: profile.updatedAt ?? now,
    });
    snapshot.profiles = [
      validated,
      ...snapshot.profiles.filter((candidate) => candidate.id !== validated.id),
    ];
    this.write(snapshot);
    return validated;
  }

  public delete(id: string): ProviderProfile | undefined {
    const snapshot = this.read();
    const profile = snapshot.profiles.find((candidate) => candidate.id === id);
    if (!profile) return undefined;
    snapshot.profiles = snapshot.profiles.filter(
      (candidate) => candidate.id !== id,
    );
    if (snapshot.activeProvider === id) delete snapshot.activeProvider;
    this.write(snapshot);
    return profile;
  }

  public setActive(id: string | undefined): void {
    const snapshot = this.read();
    if (id !== undefined) {
      const validatedId = ProviderProfileIdSchema.parse(id);
      if (!snapshot.profiles.some((profile) => profile.id === validatedId)) {
        throw new Error(`Provider profile not found: ${validatedId}`);
      }
      snapshot.activeProvider = validatedId;
    } else {
      delete snapshot.activeProvider;
    }
    this.write(snapshot);
  }

  private write(snapshot: ProviderProfilesSnapshot): void {
    const validated = ProviderProfilesFileSchema.parse(snapshot);
    ensurePrivateDirectory(this.orbitDir, {
      platform: this.isWindows ? "win32" : "linux",
      windowsAcl: false,
    });
    const current = readBoundedRegularFile(
      this.profilePath,
      MAX_PROVIDER_PROFILES_BYTES,
    );
    if (current !== undefined) {
      let previous: ProviderProfilesSnapshot | undefined;
      try {
        const parsed = ProviderProfilesFileSchema.safeParse(
          JSON.parse(current),
        );
        if (parsed.success) previous = parsed.data;
      } catch {
        // Preserve an existing last-known-good backup if the primary is corrupt.
      }
      if (previous) {
        replacePrivateFileAtomically(
          `${this.profilePath}.bak`,
          `${JSON.stringify(previous, null, 2)}\n`,
        );
      }
    }
    replacePrivateFileAtomically(
      this.profilePath,
      `${JSON.stringify(validated, null, 2)}\n`,
    );
  }
}
