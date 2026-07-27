import { ProjectIndex } from "@orbit-build/tools";
import type {
  ActiveSkill,
  SkillDiagnostic,
  SkillSummary,
} from "./skills/types.js";

export type { ActiveSkill, SkillSummary };

export interface ContextPack {
  projectInstructions: string;
  projectIndex: ProjectIndex;
  skillsIndex?: SkillSummary[];
  activeSkills?: ActiveSkill[];
  /** Discovery problems worth surfacing; empty when everything parsed. */
  skillDiagnostics?: SkillDiagnostic[];
  relevantFiles: Array<{
    path: string;
    reason: string;
    summary?: string;
    excerpt?: string;
    readOnly?: boolean;
  }>;
  recentChanges: string;
  currentDiff: string;
  previousErrors: string;
  codebaseContext?: string;
  tokenBudget: {
    max: number;
    usedEstimate: number;
  };
}
