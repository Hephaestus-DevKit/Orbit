/** Workflow stage editor validation, formatting, and feedback. */
export const WEB_UI_CLIENT_WORKFLOW_SCRIPT = String.raw`  function stageCopy(english, simplified, traditional) {
    return language === 'en' ? english : chinese(simplified, traditional);
  }
  function stageLabel(index) {
    return language === 'en'
      ? 'Stage ' + String(index + 1)
      : chinese('阶段 ' + String(index + 1), '階段 ' + String(index + 1));
  }
  function isSafeWorkflowArtifactPath(path) {
    if (
      typeof path !== 'string' ||
      !path ||
      path.length > 500 ||
      path.includes('\\') ||
      path.includes(':') ||
      /[<>"|?*\u0000-\u001f]/.test(path) ||
      path.startsWith('/')
    ) return false;
    return !path.split('/').some((part) =>
      !part ||
      part === '.' ||
      part === '..' ||
      /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
      ['.git', '.orbit', '.agents', '.codex'].includes(part.toLowerCase()),
    );
  }
  function validateWorkflowStages(stages) {
    if (!Array.isArray(stages) || !stages.length || stages.length > 12) {
      return stageCopy(
        'Stages must be a JSON array with 1–12 items.',
        '阶段必须是包含 1–12 项的 JSON 数组。',
        '階段必須是包含 1–12 項的 JSON 陣列。',
      );
    }
    const ids = new Set();
    const artifacts = new Set();
    const allowedKeys = new Set(['id', 'title', 'prompt', 'skills', 'verification', 'artifacts']);
    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index];
      const label = stageLabel(index);
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
        return label + stageCopy(' must be an object.', ' 必须是对象。', ' 必須是物件。');
      }
      const unknownKey = Object.keys(stage).find((key) => !allowedKeys.has(key));
      if (unknownKey !== undefined) {
        return label + stageCopy(
          ' contains an unsupported field: ',
          ' 包含不支持的字段：',
          ' 包含不支援的欄位：',
        ) + unknownKey.slice(0, 80);
      }
      if (typeof stage.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(stage.id)) {
        return label + stageCopy(
          ': id must be 1–48 lowercase letters, numbers, or hyphens.',
          '：id 必须是 1–48 个小写字母、数字或连字符。',
          '：id 必須是 1–48 個小寫字母、數字或連字號。',
        );
      }
      if (ids.has(stage.id)) {
        return label + stageCopy(': id must be unique.', '：id 不能重复。', '：id 不可重複。');
      }
      ids.add(stage.id);
      if (typeof stage.title !== 'string' || !stage.title.trim() || stage.title.trim().length > 120) {
        return label + stageCopy(
          ': title is required and must be at most 120 characters.',
          '：标题为必填项，且不能超过 120 个字符。',
          '：標題為必填項，且不能超過 120 個字元。',
        );
      }
      if (typeof stage.prompt !== 'string' || !stage.prompt.trim() || stage.prompt.trim().length > 12000) {
        return label + stageCopy(
          ': prompt is required and must be at most 12,000 characters.',
          '：提示词为必填项，且不能超过 12,000 个字符。',
          '：提示詞為必填項，且不能超過 12,000 個字元。',
        );
      }
      const skills = stage.skills === undefined ? [] : stage.skills;
      if (
        !Array.isArray(skills) ||
        skills.length > 8 ||
        skills.some((skill) => typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill))
      ) {
        return label + stageCopy(
          ': skills must contain at most 8 valid Skill names.',
          '：skills 最多包含 8 个有效的 Skill 名称。',
          '：skills 最多包含 8 個有效的 Skill 名稱。',
        );
      }
      if (stage.verification !== undefined && typeof stage.verification !== 'boolean') {
        return label + stageCopy(
          ': verification must be true or false.',
          '：verification 必须为 true 或 false。',
          '：verification 必須為 true 或 false。',
        );
      }
      const stageArtifacts = stage.artifacts === undefined ? [] : stage.artifacts;
      if (!Array.isArray(stageArtifacts) || stageArtifacts.length > 20) {
        return label + stageCopy(
          ': artifacts must be an array with at most 20 paths.',
          '：artifacts 必须是最多包含 20 个路径的数组。',
          '：artifacts 必須是最多包含 20 個路徑的陣列。',
        );
      }
      for (const path of stageArtifacts) {
        if (!isSafeWorkflowArtifactPath(path)) {
          return label + stageCopy(
            ': artifact paths must be safe workspace-relative files.',
            '：产物路径必须是安全的工作区相对文件路径。',
            '：產物路徑必須是安全的工作區相對檔案路徑。',
          );
        }
        const normalizedPath = path.toLowerCase();
        if (artifacts.has(normalizedPath)) {
          return label + stageCopy(
            ': artifact paths cannot be reused across stages.',
            '：产物路径不能在不同阶段重复使用。',
            '：產物路徑不能在不同階段重複使用。',
          );
        }
        artifacts.add(normalizedPath);
      }
      if (stage.verification !== true && stageArtifacts.length === 0) {
        return label + stageCopy(
          ': add an artifact or set verification to true.',
          '：请添加产物，或将 verification 设为 true。',
          '：請新增產物，或將 verification 設為 true。',
        );
      }
    }
    return '';
  }
  function updateWorkflowStageStatus() {
    const raw = elements.capabilityStages.value.trim();
    elements.formatCapabilityStages.disabled = !raw || state.busy || state.capabilityPending;
    elements.capabilityStagesStatus.className = '';
    if (!raw) {
      elements.capabilityStagesStatus.textContent = stageCopy(
        'No stages configured',
        '尚未配置阶段',
        '尚未設定階段',
      );
      return;
    }
    try {
      const stages = JSON.parse(raw);
      const problem = validateWorkflowStages(stages);
      if (problem) {
        elements.capabilityStagesStatus.className = 'is-invalid';
        elements.capabilityStagesStatus.textContent = problem;
        return;
      }
      elements.capabilityStagesStatus.className = 'is-valid';
      elements.capabilityStagesStatus.textContent = language === 'en'
        ? String(stages.length) + (stages.length === 1 ? ' stage ready' : ' stages ready')
        : String(stages.length) + chinese(' 个阶段已就绪', ' 個階段已就緒');
    } catch {
      elements.capabilityStagesStatus.className = 'is-invalid';
      elements.capabilityStagesStatus.textContent = stageCopy(
        'Invalid JSON',
        'JSON 格式无效',
        'JSON 格式無效',
      );
    }
  }
  function applyWorkflowStages(payload) {
    const raw = elements.capabilityStages.value.trim();
    if (!raw) return true;
    try {
      const stages = JSON.parse(raw);
      const problem = validateWorkflowStages(stages);
      if (problem) {
        showCapabilityError(problem, elements.capabilityStages);
        return false;
      }
      const knownSkills = new Set((state.skills && state.skills.skills || []).map((skill) => skill.name));
      for (let index = 0; index < stages.length; index += 1) {
        const missing = (stages[index].skills || []).filter((skill) => !knownSkills.has(skill));
        if (missing.length && state.skills && !state.skills.skillsTruncated) {
          showCapabilityError(stageLabel(index) + ': ' + copy.capabilitySkillsMissing + missing.join(', '), elements.capabilityStages);
          return false;
        }
      }
      payload.stages = stages;
      return true;
    } catch {
      const message = stageCopy(
        'Stages must be valid JSON.',
        '阶段必须是有效的 JSON。',
        '階段必須是有效的 JSON。',
      );
      showCapabilityError(message, elements.capabilityStages);
      return false;
    }
  }
  function formatWorkflowStages() {
    const raw = elements.capabilityStages.value.trim();
    if (!raw) {
      updateWorkflowStageStatus();
      elements.capabilityStages.focus();
      return;
    }
    try {
      const stages = JSON.parse(raw);
      elements.capabilityStages.value = JSON.stringify(stages, null, 2);
      updateWorkflowStageStatus();
      const problem = validateWorkflowStages(stages);
      if (problem) showCapabilityError(problem, elements.capabilityStages);
      else {
        clearCapabilityError();
        elements.capabilityStages.focus();
      }
    } catch {
      showCapabilityError(
        stageCopy('Stages must be valid JSON.', '阶段必须是有效的 JSON。', '階段必須是有效的 JSON。'),
        elements.capabilityStages,
      );
      updateWorkflowStageStatus();
    }
  }
`;
