/** Rich-text, message history, and streaming response rendering. */
export const WEB_UI_CLIENT_MESSAGES_SCRIPT = String.raw`  function appendInline(parent, text) {
    const pattern = /(\u0060[^\u0060\n]+\u0060|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\s][^*\n]*\*|(?<![A-Za-z0-9_])_[^_\n]+_(?![A-Za-z0-9_])|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith('\u0060')) {
        const code = document.createElement('code');
        code.textContent = token.slice(1, -1);
        parent.append(code);
      } else if (token.startsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        parent.append(strong);
      } else if (token.startsWith('~~')) {
        const removed = document.createElement('del');
        removed.textContent = token.slice(2, -2);
        parent.append(removed);
      } else if (token.startsWith('*') || token.startsWith('_')) {
        const emphasis = document.createElement('em');
        emphasis.textContent = token.slice(1, -1);
        parent.append(emphasis);
      } else {
        const split = token.lastIndexOf('](');
        const link = document.createElement('a');
        link.textContent = token.slice(1, split);
        link.href = token.slice(split + 2, -1);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        parent.append(link);
      }
      cursor = match.index + token.length;
    }
    if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
  }

  function splitMarkdownTableRow(line) {
    const normalized = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return normalized.split('|').map((cell) => cell.trim());
  }

  function isMarkdownTableDivider(line, expectedColumns) {
    const cells = splitMarkdownTableRow(line);
    return cells.length === expectedColumns
      && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function createMarkdownTable(headerCells, bodyRows) {
    const viewport = document.createElement('div');
    viewport.className = 'table-scroll';
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', copy.table);
    const table = document.createElement('table');
    table.className = 'rich-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const cellText of headerCells) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      appendInline(cell, cellText);
      headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement('tbody');
    for (const row of bodyRows) {
      const rowElement = document.createElement('tr');
      for (const cellText of row) {
        const cell = document.createElement('td');
        appendInline(cell, cellText);
        rowElement.append(cell);
      }
      body.append(rowElement);
    }
    table.append(head, body);
    viewport.append(table);
    return viewport;
  }

  function renderPlainBlocks(parent, text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let paragraph = [];
    let list = null;
    let listType = '';

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const node = document.createElement('p');
      paragraph.forEach((line, index) => {
        if (index) node.append(document.createElement('br'));
        appendInline(node, line);
      });
      parent.append(node);
      paragraph = [];
    };

    const flushList = () => {
      if (list) parent.append(list);
      list = null;
      listType = '';
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const tableHeader = line.includes('|') ? splitMarkdownTableRow(line) : [];
      if (
        tableHeader.length > 1
        && index + 1 < lines.length
        && isMarkdownTableDivider(lines[index + 1], tableHeader.length)
      ) {
        flushParagraph();
        flushList();
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
          const row = splitMarkdownTableRow(lines[index]);
          if (row.length !== tableHeader.length) break;
          rows.push(row);
          index += 1;
        }
        parent.append(createMarkdownTable(tableHeader, rows));
        index -= 1;
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      const quote = line.match(/^>\s?(.*)$/);
      if (!line.trim()) {
        flushParagraph();
        flushList();
      } else if (heading) {
        flushParagraph();
        flushList();
        const node = document.createElement('h' + heading[1].length);
        appendInline(node, heading[2]);
        parent.append(node);
      } else if (bullet || ordered) {
        flushParagraph();
        const nextType = bullet ? 'ul' : 'ol';
        if (!list || listType !== nextType) {
          flushList();
          list = document.createElement(nextType);
          listType = nextType;
        }
        const item = document.createElement('li');
        appendInline(item, (bullet || ordered)[1]);
        list.append(item);
      } else if (quote) {
        flushParagraph();
        flushList();
        const node = document.createElement('blockquote');
        appendInline(node, quote[1]);
        parent.append(node);
      } else {
        flushList();
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushList();
  }

  function createCodeBlock(languageName, codeText, streaming) {
    const info = String(languageName || '').trim().split(/\s+/).filter(Boolean);
    const language = info.shift() || 'text';
    const descriptor = info.join(' ');
    const source = String(codeText || '');
    const lines = source.split('\n');
    const isDiff = /^(diff|patch)$/i.test(language);
    const isCollapsible = !streaming && lines.length > 18;
    const root = document.createElement('div');
    root.className = 'code-block' + (isDiff ? ' is-diff' : '') + (isCollapsible ? ' is-collapsed' : '') + (streaming ? ' is-streaming' : '');
    root.dataset.language = language.toLowerCase();
    const header = document.createElement('div');
    header.className = 'code-header';
    const identity = document.createElement('div');
    identity.className = 'code-identity';
    const languageLabel = document.createElement('span');
    languageLabel.className = 'code-language';
    languageLabel.textContent = language;
    const metadata = document.createElement('span');
    metadata.className = 'code-metadata';
    metadata.textContent = (descriptor ? descriptor + ' · ' : '') + lines.length + ' ' + copy.codeLines;
    identity.append(languageLabel, metadata);
    const actions = document.createElement('div');
    actions.className = 'code-actions';
    if (isCollapsible) {
      const expandButton = document.createElement('button');
      expandButton.type = 'button';
      expandButton.className = 'expand-code';
      expandButton.textContent = copy.expandCode;
      expandButton.setAttribute('aria-expanded', 'false');
      expandButton.addEventListener('click', () => {
        const collapsed = root.classList.toggle('is-collapsed');
        expandButton.textContent = collapsed ? copy.expandCode : copy.collapseCode;
        expandButton.setAttribute('aria-expanded', String(!collapsed));
      });
      actions.append(expandButton);
    }
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-code';
    copyButton.textContent = copy.copy;
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source);
        copyButton.textContent = copy.copiedShort;
        showToast(copy.copied, 'success');
        window.setTimeout(() => { copyButton.textContent = copy.copy; }, 1600);
      } catch (error) {
        showToast(String(error), 'error');
      }
    });
    actions.append(copyButton);
    const frame = document.createElement('div');
    frame.className = 'code-frame';
    const viewport = document.createElement('div');
    viewport.className = 'code-viewport';
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', language + ' · ' + lines.length + ' ' + copy.codeLines);
    const code = document.createElement('code');
    code.className = 'code-lines';
    const highlightState = { blockCommentEnd: '' };
    lines.forEach((line, index) => {
      const row = document.createElement('span');
      row.className = 'code-line';
      row.dataset.line = String(index + 1);
      if (isDiff) {
        if (/^\+\+\+|^---/.test(line)) row.classList.add('is-diff-file');
        else if (/^\+/.test(line)) row.classList.add('is-addition');
        else if (/^-/.test(line)) row.classList.add('is-deletion');
        else if (/^@@/.test(line)) row.classList.add('is-hunk');
      }
      const lineText = document.createElement('span');
      lineText.className = 'code-line-text';
      if (isDiff) lineText.textContent = line || ' ';
      else appendHighlightedCodeLine(lineText, line, language, highlightState);
      row.append(lineText);
      code.append(row);
    });
    viewport.append(code);
    frame.append(viewport);
    header.append(identity, actions);
    root.append(header, frame);
    return root;
  }

  const codeKeywordGroups = {
    javascript: new Set([
      'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
      'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
      'for', 'from', 'function', 'get', 'if', 'import', 'in', 'instanceof', 'let',
      'new', 'of', 'return', 'set', 'static', 'switch', 'throw', 'try', 'typeof',
      'var', 'void', 'while', 'with', 'yield',
    ]),
    typescript: new Set([
      'abstract', 'any', 'as', 'asserts', 'async', 'await', 'boolean', 'break',
      'case', 'catch', 'class', 'const', 'constructor', 'continue', 'declare',
      'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally',
      'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'infer',
      'instanceof', 'interface', 'is', 'keyof', 'let', 'namespace', 'never', 'new',
      'number', 'object', 'of', 'private', 'protected', 'public', 'readonly', 'return',
      'satisfies', 'set', 'static', 'string', 'switch', 'symbol', 'throw', 'try',
      'type', 'typeof', 'unknown', 'var', 'void', 'while', 'with', 'yield',
    ]),
    python: new Set([
      'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
      'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if',
      'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
      'return', 'try', 'while', 'with', 'yield',
    ]),
    shell: new Set([
      'case', 'do', 'done', 'elif', 'else', 'esac', 'export', 'fi', 'for',
      'function', 'if', 'in', 'local', 'readonly', 'select', 'then', 'until',
      'while',
    ]),
    sql: new Set([
      'alter', 'and', 'as', 'asc', 'begin', 'between', 'by', 'case', 'create',
      'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'exists', 'from',
      'full', 'group', 'having', 'in', 'inner', 'insert', 'into', 'is', 'join',
      'left', 'like', 'limit', 'not', 'null', 'on', 'or', 'order', 'outer',
      'right', 'select', 'set', 'then', 'union', 'update', 'values', 'when',
      'where', 'with',
    ]),
  };

  const codeLiterals = new Set([
    'false', 'None', 'null', 'NULL', 'true', 'True', 'False', 'undefined',
  ]);

  function codeLanguageFamily(language) {
    const normalized = String(language || '').toLowerCase();
    if (/^(ts|tsx|typescript)$/.test(normalized)) return 'typescript';
    if (/^(js|jsx|javascript|mjs|cjs)$/.test(normalized)) return 'javascript';
    if (/^(py|python)$/.test(normalized)) return 'python';
    if (/^(sh|shell|bash|zsh|powershell|ps1)$/.test(normalized)) return 'shell';
    if (/^(sql|postgres|mysql|sqlite)$/.test(normalized)) return 'sql';
    return normalized;
  }

  function appendCodeToken(parent, text, type) {
    if (!text) return;
    if (!type) {
      parent.append(document.createTextNode(text));
      return;
    }
    const token = document.createElement('span');
    token.className = 'token-' + type;
    token.textContent = text;
    parent.append(token);
  }

  function readQuotedCodeToken(line, start, quote) {
    let cursor = start + 1;
    while (cursor < line.length) {
      if (line[cursor] === '\\') cursor += 2;
      else if (line[cursor] === quote) return cursor + 1;
      else cursor += 1;
    }
    return line.length;
  }

  function appendHighlightedCodeLine(parent, line, language, state) {
    const family = codeLanguageFamily(language);
    const keywords = codeKeywordGroups[family] || new Set();
    const supportsSlashComments = ['javascript', 'typescript', 'java', 'c', 'cpp', 'csharp', 'css', 'go', 'rust', 'swift', 'kotlin'].includes(family);
    const supportsHashComments = ['python', 'shell', 'yaml', 'yml', 'ruby', 'toml'].includes(family);
    const supportsSqlComments = family === 'sql';
    let cursor = 0;
    if (!line) {
      parent.textContent = ' ';
      return;
    }
    while (cursor < line.length) {
      if (state.blockCommentEnd) {
        const end = line.indexOf(state.blockCommentEnd, cursor);
        const finish = end === -1 ? line.length : end + state.blockCommentEnd.length;
        appendCodeToken(parent, line.slice(cursor, finish), 'comment');
        cursor = finish;
        if (end !== -1) state.blockCommentEnd = '';
        continue;
      }
      if (supportsSlashComments && line.startsWith('//', cursor)) {
        appendCodeToken(parent, line.slice(cursor), 'comment');
        break;
      }
      if (supportsHashComments && line[cursor] === '#') {
        appendCodeToken(parent, line.slice(cursor), 'comment');
        break;
      }
      if (supportsSqlComments && line.startsWith('--', cursor)) {
        appendCodeToken(parent, line.slice(cursor), 'comment');
        break;
      }
      if (supportsSlashComments && line.startsWith('/*', cursor)) {
        const end = line.indexOf('*/', cursor + 2);
        const finish = end === -1 ? line.length : end + 2;
        appendCodeToken(parent, line.slice(cursor, finish), 'comment');
        cursor = finish;
        if (end === -1) state.blockCommentEnd = '*/';
        continue;
      }
      if ((family === 'html' || family === 'xml') && line.startsWith('<!--', cursor)) {
        const end = line.indexOf('-->', cursor + 4);
        const finish = end === -1 ? line.length : end + 3;
        appendCodeToken(parent, line.slice(cursor, finish), 'comment');
        cursor = finish;
        if (end === -1) state.blockCommentEnd = '-->';
        continue;
      }
      const character = line[cursor];
      if (character === '"' || character === "'" || character === '\x60') {
        const finish = readQuotedCodeToken(line, cursor, character);
        const next = line.slice(finish).trimStart();
        const type = next.startsWith(':') ? 'property' : 'string';
        appendCodeToken(parent, line.slice(cursor, finish), type);
        cursor = finish;
        continue;
      }
      const number = line.slice(cursor).match(/^(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
      if (number) {
        appendCodeToken(parent, number[0], 'number');
        cursor += number[0].length;
        continue;
      }
      const identifier = line.slice(cursor).match(/^[A-Za-z_$][\w$]*/);
      if (identifier) {
        const value = identifier[0];
        const next = line.slice(cursor + value.length).trimStart();
        const lower = value.toLowerCase();
        const type = codeLiterals.has(value)
          ? 'literal'
          : keywords.has(value) || keywords.has(lower)
            ? 'keyword'
            : next.startsWith('(')
              ? 'function'
              : next.startsWith(':')
                ? 'property'
                : '';
        appendCodeToken(parent, value, type);
        cursor += value.length;
        continue;
      }
      let finish = cursor + 1;
      while (finish < line.length && !/[A-Za-z_$\d'"#]/.test(line[finish])) {
        if (line.startsWith('//', finish) || line.startsWith('/*', finish) || line.startsWith('--', finish)) break;
        finish += 1;
      }
      appendCodeToken(parent, line.slice(cursor, finish), '');
      cursor = finish;
    }
  }

  function repairStreamingInlineTail(text) {
    const lastBreak = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
    const prefix = text.slice(0, lastBreak + 1);
    const tail = text.slice(lastBreak + 1);
    const openMarkers = [];
    for (const marker of ['\u0060', '**', '~~']) {
      let cursor = 0;
      let count = 0;
      let lastMarker = -1;
      while (cursor < tail.length) {
        const markerIndex = tail.indexOf(marker, cursor);
        if (markerIndex === -1) break;
        count += 1;
        lastMarker = markerIndex;
        cursor = markerIndex + marker.length;
      }
      if (count % 2 === 1 && tail.slice(lastMarker + marker.length).trim()) {
        openMarkers.push({ marker, index: lastMarker });
      }
    }
    openMarkers.sort((left, right) => right.index - left.index);
    return prefix + tail + openMarkers.map((entry) => entry.marker).join('');
  }

  function renderRichText(container, value, streaming) {
    const text = String(value || '');
    const output = document.createDocumentFragment();
    const fence = /\u0060\u0060\u0060([^\n\u0060]*)\n?([\s\S]*?)\u0060\u0060\u0060/g;
    let cursor = 0;
    let match;
    while ((match = fence.exec(text)) !== null) {
      if (match.index > cursor) renderPlainBlocks(output, text.slice(cursor, match.index));
      output.append(createCodeBlock(match[1].trim(), match[2].replace(/\n$/, ''), streaming));
      cursor = match.index + match[0].length;
    }
    const tail = text.slice(cursor);
    const openFence = streaming
      ? tail.match(/\u0060\u0060\u0060([^\n\u0060]*)\n?([\s\S]*)$/)
      : null;
    if (openFence && openFence.index !== undefined) {
      if (openFence.index > 0) renderPlainBlocks(output, tail.slice(0, openFence.index));
      output.append(createCodeBlock(openFence[1].trim(), openFence[2], true));
    } else if (tail) {
      renderPlainBlocks(output, streaming ? repairStreamingInlineTail(tail) : tail);
    }
    container.replaceChildren(output);
  }

  function createThinkingBlock(text, open) {
    const details = document.createElement('details');
    details.className = 'thinking-block';
    details.open = Boolean(open);
    const summary = document.createElement('summary');
    summary.textContent = copy.reasoning;
    const body = document.createElement('div');
    body.className = 'thinking-body';
    body.textContent = text || copy.thinking;
    details.append(summary, body);
    return { root: details, body };
  }

  function displayToolName(name) {
    const normalized = String(name || copy.tool).trim();
    if (normalized === 'bash') return 'Shell';
    if (normalized === 'run_tests') return language === 'en' ? 'Verification' : '验证';
    return normalized.replace(/_/g, ' ');
  }

  function isBatchableTool(block) {
    return block
      && block.type === 'tool'
      && block.status === 'success'
      && !block.isError
      && ['read_file', 'grep', 'glob', 'bash', 'get_background_task_output'].includes(block.name);
  }

  function createToolBatch(blocks) {
    const root = document.createElement('details');
    root.className = 'tool-batch is-success';
    const summary = document.createElement('summary');
    summary.className = 'tool-batch-summary';
    const status = document.createElement('span');
    status.className = 'tool-status';
    const label = document.createElement('strong');
    label.textContent = copy.toolBatch;
    const names = [...new Set(blocks.map((block) => displayToolName(block.name)))];
    const context = document.createElement('span');
    context.className = 'tool-context';
    context.textContent = names.slice(0, 3).join(' · ');
    const count = document.createElement('span');
    count.className = 'tool-batch-count';
    count.textContent = '×' + blocks.length;
    const chevron = document.createElement('span');
    chevron.className = 'tool-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    summary.append(status, label, context, count, chevron);
    const body = document.createElement('div');
    body.className = 'tool-batch-body';
    blocks.forEach((block) => body.append(createToolCard(block)));
    root.append(summary, body);
    summary.setAttribute('aria-label', copy.toolBatch + ' · ' + blocks.length);
    summary.setAttribute('aria-expanded', 'false');
    root.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(root.open));
    });
    return root;
  }

  function createToolCard(block) {
    const root = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'tool-card-summary';
    summary.setAttribute('role', 'button');
    const status = document.createElement('span');
    status.className = 'tool-status';
    const label = document.createElement('strong');
    label.className = 'tool-name';
    const context = document.createElement('span');
    context.className = 'tool-context';
    const outcome = document.createElement('span');
    outcome.className = 'tool-outcome';
    const chevron = document.createElement('span');
    chevron.className = 'tool-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    const detail = document.createElement('pre');
    detail.className = 'tool-detail';
    summary.append(status, label, context, outcome, chevron);
    root.append(summary, detail);
    summary.addEventListener('click', (event) => {
      if (!root.classList.contains('has-detail')) event.preventDefault();
    });
    root.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(root.open));
    });
    updateToolCard(root, block);
    return root;
  }

  function updateToolCard(root, block) {
    const isError = Boolean(block.isError);
    const isDone = block.status === 'success' || block.type === 'tool_result';
    root.className = 'tool-card' + (isError ? ' is-error' : isDone ? ' is-success' : '');
    root.dataset.toolId = block.id || '';
    const label = root.querySelector('.tool-name');
    const context = root.querySelector('.tool-context');
    const outcome = root.querySelector('.tool-outcome');
    const detail = root.querySelector('.tool-detail');
    label.textContent = displayToolName(block.name);
    const summaryText = String(block.summary || '').trim();
    const detailText = String(block.detail || '').trim();
    context.textContent = summaryText || detailText.split('\n', 1)[0] || '';
    context.hidden = !context.textContent;
    outcome.textContent = isError ? copy.error : isDone ? copy.done : copy.running;
    detail.textContent = detailText;
    detail.hidden = !detailText;
    root.classList.toggle('has-detail', Boolean(detailText));
    root.open = Boolean(detailText) && (isError || !isDone);
    const summary = root.querySelector('summary');
    summary.setAttribute('aria-expanded', String(root.open));
    summary.setAttribute(
      'aria-label',
      (block.name || copy.tool) + ' · ' + outcome.textContent,
    );
  }

  function upsertStreamingTool(payload, status) {
    if (!state.streaming) return;
    const id = String(payload.toolCallId || payload.toolName || 'tool');
    const block = {
      type: 'tool',
      id,
      name: payload.toolName || copy.tool,
      status,
      detail: payload.error || payload.detail || payload.explanation || '',
      summary: payload.display || '',
      isError: status === 'error',
    };
    let card = state.streamingTools.get(id);
    if (card) {
      updateToolCard(card, block);
    } else {
      card = createToolCard(block);
      state.streamingTools.set(id, card);
      const textBody = state.streaming.textBody;
      if (textBody && textBody.parentNode === state.streaming.content) {
        state.streaming.content.insertBefore(card, textBody);
      } else {
        state.streaming.content.append(card);
      }
    }
    if (state.stickToBottom) scrollToBottom();
  }

  function appendStreamingDiff(payload) {
    if (!state.streaming || !payload || !payload.diff) return;
    const block = createCodeBlock('diff ' + (payload.filePath || ''), payload.diff, false);
    const textBody = state.streaming.textBody;
    if (textBody && textBody.parentNode === state.streaming.content) {
      state.streaming.content.insertBefore(block, textBody);
    } else {
      state.streaming.content.append(block);
    }
    if (state.stickToBottom) scrollToBottom();
  }

  function createMessage(message, streaming) {
    const role = message.role === 'user' ? 'user' : 'assistant';
    const root = document.createElement('article');
    root.className = 'message ' + role;
    root.dataset.messageId = message.id || '';
    let content;
    let progress = null;
    let progressLabel = null;
    let modelBadge = null;
    if (role === 'assistant') {
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      const avatarTemplate = document.getElementById('orbitAvatarTemplate');
      if (avatarTemplate && avatarTemplate.content) {
        avatar.append(avatarTemplate.content.cloneNode(true));
      }
      content = document.createElement('div');
      content.className = 'message-content';
      const roleLine = document.createElement('div');
      roleLine.className = 'message-role';
      const name = document.createElement('span');
      name.textContent = copy.assistant;
      const time = document.createElement('span');
      time.className = 'message-time';
      time.textContent = formatTime(message.createdAt);
      roleLine.append(name);
      if (message.model) {
        const model = document.createElement('span');
        model.className = 'message-model';
        model.textContent = message.model;
        model.title = message.model;
        modelBadge = model;
        roleLine.append(model);
      }
      roleLine.append(time);
      content.append(roleLine);
      if (streaming) {
        progress = document.createElement('div');
        progress.className = 'message-progress is-running';
        progress.setAttribute('role', 'status');
        progress.setAttribute('aria-live', 'polite');
        const indicator = document.createElement('span');
        indicator.className = 'message-progress-indicator';
        progressLabel = document.createElement('span');
        progressLabel.textContent = copy.thinking;
        progress.append(indicator, progressLabel);
        content.append(progress);
      }
      root.append(avatar, content);
    } else {
      content = document.createElement('div');
      content.className = 'message-content';
      root.append(content);
    }

    let textBody = null;
    let thinkingBody = null;
    const blocks = Array.isArray(message.blocks) && message.blocks.length
      ? message.blocks
      : [{ type: 'text', text: message.text || '' }];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex];
      if (!streaming && isBatchableTool(block)) {
        const sequence = [block];
        while (blockIndex + 1 < blocks.length && isBatchableTool(blocks[blockIndex + 1])) {
          sequence.push(blocks[blockIndex + 1]);
          blockIndex += 1;
        }
        if (sequence.length >= 3) {
          content.append(createToolBatch(sequence));
          continue;
        }
        sequence.forEach((item) => content.append(createToolCard(item)));
        continue;
      }
      if (block.type === 'text' && block.text) {
        const body = document.createElement('div');
        body.className = 'rich-text' + (streaming ? ' stream-caret' : '');
        renderRichText(body, block.text, streaming);
        content.append(body);
        textBody = body;
      } else if (block.type === 'thinking') {
        const thinking = createThinkingBlock(block.text || '', false);
        content.append(thinking.root);
        thinkingBody = thinking.body;
      } else if (block.type === 'image') {
        const attachment = document.createElement('span');
        attachment.className = 'message-attachment';
        attachment.textContent = '▧ ' + (block.name || 'image');
        attachment.title = block.mediaType || 'image';
        content.append(attachment);
      } else if (block.type === 'tool') {
        content.append(createToolCard(block));
      }
    }
    if (role === 'assistant' && !streaming) {
      const responseText = blocks
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('\n\n');
      if (responseText) {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        const copyResponse = document.createElement('button');
        copyResponse.type = 'button';
        copyResponse.className = 'message-action';
        copyResponse.setAttribute('aria-label', copy.copyResponse);
        copyResponse.title = copy.copyResponse;
        copyResponse.innerHTML = '<span aria-hidden="true">\u2398</span><span>' + copy.copy + '</span>';
        copyResponse.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(responseText);
            showToast(copy.copied, 'success');
          } catch (error) {
            showToast(String(error), 'error');
          }
        });
        actions.append(copyResponse);
        content.append(actions);
      }
    }
    if (!textBody && streaming) {
      textBody = document.createElement('div');
      textBody.className = 'rich-text stream-caret';
      textBody.hidden = true;
      content.append(textBody);
    }
    return { root, content, textBody, thinkingBody, progress, progressLabel, modelBadge };
  }

  function renderControlTurn(entry) {
    const root = document.createElement('article');
    root.className = 'control-turn is-' + entry.status;
    root.dataset.controlTurnId = entry.id;
    root.setAttribute('role', 'status');
    const indicator = document.createElement('span');
    indicator.className = 'control-turn-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    const command = document.createElement('code');
    command.textContent = entry.prompt;
    const label = document.createElement('span');
    label.className = 'control-turn-label';
    label.textContent = entry.status === 'running'
      ? copy.running
      : entry.status === 'failed'
        ? copy.error
        : entry.status === 'aborted'
          ? copy.stopped
          : copy.done;
    root.append(indicator, command, label);
    return root;
  }

  function upsertControlTurn(id, prompt, status, reveal) {
    const previous = state.controlTurns.get(id);
    const entry = {
      id,
      prompt,
      status,
      createdAt: previous ? previous.createdAt : new Date().toISOString(),
    };
    state.controlTurns.set(id, entry);
    const existing = elements.messages.querySelector('[data-control-turn-id="' + id + '"]');
    const next = renderControlTurn(entry);
    if (existing) existing.replaceWith(next);
    else elements.messages.append(next);
    setEmptyState();
    if (reveal) {
      state.stickToBottom = true;
      scrollToBottom(true);
    } else {
      updateMessageNavigation();
    }
  }

  function createStreamingTurn(prompt, turnId) {
    cancelScheduledStreamFlush();
    if (prompt) {
      elements.messages.append(createMessage({
        id: 'optimistic-user-' + turnId,
        role: 'user',
        text: prompt,
        createdAt: new Date().toISOString(),
      }, false).root);
    }
    const streaming = createMessage({
      id: 'streaming-' + turnId,
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      model: state.status && state.status.activeModel || '',
    }, true);
    elements.messages.append(streaming.root);
    state.streaming = streaming;
    state.streamingTurnId = turnId;
    state.streamingTools.clear();
    state.streamText = '';
    state.pendingDelta = '';
    state.pendingThinking = '';
    state.lastStreamRenderAt = 0;
    setEmptyState();
    state.stickToBottom = true;
    scrollToBottom(true);
  }

  function ensureStreamingTurn(turnId) {
    if (state.streaming && state.streamingTurnId === turnId) return;
    if (state.streaming) state.streaming.root.remove();
    createStreamingTurn('', turnId);
  }

  function completeStreamingTurnVisual() {
    cancelScheduledStreamFlush();
    flushStream();
    if (!state.streaming) return;
    if (state.streamText) {
      renderRichText(state.streaming.textBody, state.streamText, false);
    }
    if (state.streaming.progress) state.streaming.progress.hidden = true;
    state.streaming.root.querySelectorAll('.is-streaming').forEach((node) => {
      node.classList.remove('is-streaming');
    });
    state.streaming = null;
    state.streamingTurnId = null;
    state.streamingTools.clear();
    state.streamText = '';
    state.pendingDelta = '';
    state.pendingThinking = '';
  }

  function setStreamingProgress(label, kind) {
    if (!state.streaming || !state.streaming.progress || !state.streaming.progressLabel) return;
    state.streaming.progress.hidden = false;
    state.streaming.progress.className = 'message-progress is-' + (kind || 'running');
    state.streaming.progressLabel.textContent = label || copy.working;
    scrollToBottom(false);
  }

  function setStreamingModel(model) {
    if (!state.streaming || !state.streaming.modelBadge || !model) return;
    state.streaming.modelBadge.textContent = model;
    state.streaming.modelBadge.title = model;
  }

  function flushStream() {
    if (state.streamFlushTimer) clearTimeout(state.streamFlushTimer);
    state.streamFlushTimer = 0;
    state.animationFrame = 0;
    if (!state.streaming) return;
    if (state.pendingDelta) {
      state.streamText += state.pendingDelta;
      state.pendingDelta = '';
      state.streaming.textBody.hidden = false;
      state.streaming.progress.hidden = true;
      renderRichText(state.streaming.textBody, state.streamText, true);
      state.lastStreamRenderAt = performance.now();
    }
    if (state.pendingThinking) {
      if (!state.streaming.thinkingBody) {
        const thinking = createThinkingBlock('', false);
        state.streaming.content.insertBefore(thinking.root, state.streaming.textBody);
        state.streaming.thinkingBody = thinking.body;
      }
      state.streaming.thinkingBody.textContent += state.pendingThinking;
      state.pendingThinking = '';
    }
    scrollToBottom(false);
  }

  function streamRenderInterval() {
    const length = state.streamText.length + state.pendingDelta.length;
    if (length > 80000) return 100;
    if (length > 24000) return 64;
    return 32;
  }

  function cancelScheduledStreamFlush() {
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    if (state.streamFlushTimer) clearTimeout(state.streamFlushTimer);
    state.animationFrame = 0;
    state.streamFlushTimer = 0;
  }

  function scheduleStreamFlush() {
    if (state.pendingThinking && state.streamFlushTimer) {
      clearTimeout(state.streamFlushTimer);
      state.streamFlushTimer = 0;
    }
    if (state.animationFrame || state.streamFlushTimer) return;
    const elapsed = performance.now() - state.lastStreamRenderAt;
    const delay = state.lastStreamRenderAt ? Math.max(0, streamRenderInterval() - elapsed) : 0;
    if (delay && !state.pendingThinking) {
      state.streamFlushTimer = window.setTimeout(() => {
        state.streamFlushTimer = 0;
        state.animationFrame = requestAnimationFrame(flushStream);
      }, delay);
      return;
    }
    state.animationFrame = requestAnimationFrame(flushStream);
  }

`;
