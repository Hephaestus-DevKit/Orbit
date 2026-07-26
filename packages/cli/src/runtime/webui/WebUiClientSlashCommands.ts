import {
  BUILTIN_SLASH_COMMANDS,
  SLASH_COMMAND_DEFINITIONS,
} from "../SlashCommandCatalog.js";

const WEB_UI_SLASH_COMMANDS = JSON.stringify(
  SLASH_COMMAND_DEFINITIONS.filter(({ webSuggested }) => webSuggested).map(
    ({ command, usage, description, category, suggestions }) => ({
      command,
      usage,
      description,
      category,
      suggestions,
    }),
  ),
);
const WEB_UI_RESERVED_SLASH_COMMANDS = JSON.stringify(BUILTIN_SLASH_COMMANDS);

/** Composer-local slash discovery, including validated custom commands. */
export const WEB_UI_CLIENT_SLASH_COMMANDS_SCRIPT = String.raw`  const builtInSlashCommands = ${WEB_UI_SLASH_COMMANDS};
  const reservedSlashCommands = new Set(${WEB_UI_RESERVED_SLASH_COMMANDS});
  let slashCommands = builtInSlashCommands.map((definition) => ({
    command: definition.command,
    usage: definition.usage,
    description: definition.description[language] || definition.description.zh,
    category: definition.category,
    suggestions: definition.suggestions || [],
    custom: false,
  }));
  let slashCommandMatches = [];
  let slashCommandSelection = 0;

  function slashCommandQuery() {
    const value = elements.prompt.value.trimStart();
    if (/^\/[a-z0-9_-]*$/i.test(value)) {
      return { kind: 'command', value: value.toLowerCase() };
    }
    const argumentMatch = value.match(/^(\/[a-z0-9_-]+)\s+(.*)$/i);
    return argumentMatch
      ? { kind: 'argument', command: argumentMatch[1].toLowerCase(), value: argumentMatch[2].toLowerCase() }
      : null;
  }

  function closeSlashCommands() {
    elements.slashCommandMenu.hidden = true;
    elements.slashCommandMenu.setAttribute('aria-hidden', 'true');
    elements.prompt.setAttribute('aria-expanded', 'false');
    elements.prompt.removeAttribute('aria-activedescendant');
  }

  function syncSlashCommandSelection() {
    let activeId = '';
    elements.slashCommandResults.querySelectorAll('.slash-command-option').forEach((button, index) => {
      const selected = index === slashCommandSelection;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) {
        activeId = button.id;
        button.scrollIntoView({ block: 'nearest' });
      }
    });
    if (activeId) elements.prompt.setAttribute('aria-activedescendant', activeId);
  }

  function chooseSlashCommand(index) {
    const definition = slashCommandMatches[index];
    if (!definition) return;
    elements.prompt.value = definition.insertValue || (definition.command + (definition.usage ? ' ' : ''));
    writeLocalStorage('orbit.webui.draft', elements.prompt.value);
    autoSizePrompt();
    updateSendButtonState();
    closeSlashCommands();
    elements.prompt.focus();
  }

  function renderSlashCommands() {
    const query = slashCommandQuery();
    if (query === null || state.busy) {
      closeSlashCommands();
      return;
    }
    if (query.kind === 'argument') {
      const definition = slashCommands.find((candidate) => candidate.command === query.command);
      slashCommandMatches = definition
        ? (definition.suggestions || [])
            .filter((suggestion) => suggestion.value.toLowerCase().startsWith(query.value))
            .map((suggestion) => ({
              command: definition.command + ' ' + suggestion.value.trimEnd(),
              usage: '',
              description: suggestion.description[language] || suggestion.description.zh,
              insertValue: definition.command + ' ' + suggestion.value,
              custom: false,
            }))
            .slice(0, 10)
        : [];
    } else {
      slashCommandMatches = slashCommands
        .filter((definition) => definition.command.startsWith(query.value))
        .sort((left, right) => {
          const leftExact = left.command === query.value ? 0 : 1;
          const rightExact = right.command === query.value ? 0 : 1;
          return leftExact - rightExact || left.command.localeCompare(right.command);
        })
        .slice(0, 50);
    }
    slashCommandSelection = Math.max(0, Math.min(slashCommandSelection, slashCommandMatches.length - 1));
    elements.slashCommandResults.replaceChildren();
    slashCommandMatches.forEach((definition, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'slash-command-option-' + index;
      button.className = 'slash-command-option';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === slashCommandSelection ? 'true' : 'false');
      const invocation = document.createElement('span');
      invocation.className = 'slash-command-invocation';
      const command = document.createElement('strong');
      command.textContent = definition.command;
      const usage = document.createElement('small');
      usage.textContent = definition.usage || '';
      invocation.append(command, usage);
      const description = document.createElement('span');
      description.className = 'slash-command-description';
      description.textContent = definition.description;
      button.append(invocation, description);
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('mouseenter', () => {
        slashCommandSelection = index;
        syncSlashCommandSelection();
      });
      button.addEventListener('click', () => chooseSlashCommand(index));
      elements.slashCommandResults.append(button);
    });
    elements.slashCommandEmpty.hidden = slashCommandMatches.length !== 0;
    elements.slashCommandMenu.hidden = false;
    elements.slashCommandMenu.setAttribute('aria-hidden', 'false');
    elements.prompt.setAttribute('aria-expanded', 'true');
    syncSlashCommandSelection();
  }

  async function loadSlashCommands() {
    try {
      const result = await api('/api/completions?query=');
      const available = new Set(Array.isArray(result.commands) ? result.commands : []);
      const customDetails = new Map(
        (Array.isArray(result.commandDetails) ? result.commandDetails : [])
          .filter((detail) => detail && typeof detail.command === 'string')
          .map((detail) => [detail.command, detail]),
      );
      const custom = Array.from(available)
        .filter((command) => /^\/[a-z0-9][a-z0-9_-]{0,47}$/i.test(command))
        .filter((command) => !reservedSlashCommands.has(command))
        .map((command) => {
          const detail = customDetails.get(command) || {};
          return {
            command,
            usage: typeof detail.argumentHint === 'string' && detail.argumentHint.trim()
              ? detail.argumentHint.trim()
              : '[arguments]',
            description: typeof detail.description === 'string' && detail.description.trim()
              ? detail.description.trim()
              : language !== 'en' ? chinese('自定义提示词命令', '自訂提示詞命令') : 'Custom prompt command',
            category: 'workflow',
            suggestions: [],
            custom: true,
          };
        });
      slashCommands = [
        ...builtInSlashCommands.map((definition) => ({
          command: definition.command,
          usage: definition.usage,
          description: definition.description[language] || definition.description.zh,
          category: definition.category,
          suggestions: definition.suggestions || [],
          custom: false,
        })),
        ...custom,
      ];
    } catch {
      // Built-ins remain available when optional workspace discovery fails.
    }
  }

  elements.prompt.addEventListener('keydown', (event) => {
    if (elements.slashCommandMenu.hidden) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && slashCommandMatches.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      slashCommandSelection = (slashCommandSelection + delta + slashCommandMatches.length) % slashCommandMatches.length;
      syncSlashCommandSelection();
    } else if ((event.key === 'Enter' || event.key === 'Tab') && slashCommandMatches.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      chooseSlashCommand(slashCommandSelection);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSlashCommands();
    }
  });
`;
