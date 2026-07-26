/** DOM event bindings, accessibility shortcuts, and client bootstrap. */
export const WEB_UI_CLIENT_BINDINGS_SCRIPT = String.raw`  elements.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.busy) stopTurn();
    else submitTurn(elements.prompt.value);
  });
  elements.denyApprovalButton.addEventListener('click', () => void respondToApproval(false));
  elements.approveApprovalButton.addEventListener('click', () => void respondToApproval(true));
  elements.buildPlanButton.addEventListener('click', () => void startTaskAction(elements.buildPlanButton));
  elements.parallelImproveButton.addEventListener('click', () => void startTaskAction(elements.parallelImproveButton));

  elements.prompt.addEventListener('input', () => {
    autoSizePrompt();
    writeLocalStorage('orbit.webui.draft', elements.prompt.value);
    updateSendButtonState();
    slashCommandSelection = 0;
    renderSlashCommands();
  });

  elements.prompt.addEventListener('focus', renderSlashCommands);
  elements.prompt.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!elements.slashCommandMenu.contains(document.activeElement)) closeSlashCommands();
    }, 0);
  });

  elements.prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (state.busy) queuePrompt(elements.prompt.value);
      else elements.composer.requestSubmit();
    }
  });
  elements.attachmentButton.addEventListener('click', () => elements.attachmentInput.click());
  elements.attachmentInput.addEventListener('change', () => void addAttachmentFiles(elements.attachmentInput.files));
  elements.attachmentList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-attachment-remove]');
    if (button) void removeAttachment(button.dataset.attachmentRemove, true);
  });
  elements.prompt.addEventListener('paste', (event) => {
    const files = Array.from(event.clipboardData && event.clipboardData.files || [])
      .filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    void addAttachmentFiles(files);
  });
  elements.composer.addEventListener('dragover', (event) => {
    if (!Array.from(event.dataTransfer && event.dataTransfer.items || []).some((item) => item.type.startsWith('image/'))) return;
    event.preventDefault();
    elements.composer.classList.add('is-dragging');
  });
  elements.composer.addEventListener('dragleave', () => elements.composer.classList.remove('is-dragging'));
  elements.composer.addEventListener('drop', (event) => {
    elements.composer.classList.remove('is-dragging');
    const files = Array.from(event.dataTransfer && event.dataTransfer.files || [])
      .filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    void addAttachmentFiles(files);
  });
  elements.queueButton.addEventListener('click', () => queuePrompt(elements.prompt.value));
  elements.clearQueueButton.addEventListener('click', clearPromptQueue);
  elements.promptQueueList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-queue-remove]');
    if (!button) return;
    removeQueuedPrompt(Number(button.dataset.queueRemove));
  });

  elements.messageScroll.addEventListener('scroll', () => {
    state.stickToBottom = nearBottom();
    elements.jumpBottom.classList.toggle('is-visible', !state.stickToBottom);
  }, { passive: true });

  elements.jumpBottom.addEventListener('click', () => {
    state.stickToBottom = true;
    scrollToBottom(true);
  });

  elements.menuButton.addEventListener('click', () => {
    toggleNavigation();
  });
  elements.sidebarCollapseButton.addEventListener('click', () => setDesktopSidebarCollapsed(true));
  elements.sidebarBackdrop.addEventListener('click', closeSidebar);
  document.querySelectorAll('[data-close-sidebar]').forEach((button) => button.addEventListener('click', closeSidebar));
  if (typeof mobileSidebarQuery.addEventListener === 'function') {
    mobileSidebarQuery.addEventListener('change', syncSidebarInteractivity);
  } else {
    mobileSidebarQuery.addListener(syncSidebarInteractivity);
  }
  const syncSystemTheme = () => {
    if (readLocalStorage('orbit.webui.theme', 'system') === 'system') applyTheme('system');
  };
  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', syncSystemTheme);
  } else {
    systemThemeQuery.addListener(syncSystemTheme);
  }
  syncSidebarInteractivity();

  elements.inspectorButton.addEventListener('click', () => {
    setInspector(!elements.inspector.classList.contains('is-open'));
  });
  elements.tasksButton.addEventListener('click', () => {
    setInspector(true, 'tasks');
    closeSidebar();
  });
  elements.changesButton.addEventListener('click', () => {
    setInspector(true, 'changes');
    closeSidebar();
  });
  elements.contextMeter.addEventListener('click', () => setInspector(true, 'activity'));
  elements.inspectorClose.addEventListener('click', () => setInspector(false));
  elements.inspectorBackdrop.addEventListener('click', () => setInspector(false));
  elements.inspector.addEventListener('keydown', trapInspectorFocus);
  elements.connectionState.addEventListener('click', () => {
    if (!state.ready) void initialize();
  });
  byId('retryConnection').addEventListener('click', () => void initialize());
  elements.tasksTab.addEventListener('click', () => selectInspectorTab('tasks'));
  elements.activityTab.addEventListener('click', () => selectInspectorTab('activity'));
  elements.changesTab.addEventListener('click', () => selectInspectorTab('changes'));
  elements.settingsTab.addEventListener('click', () => selectInspectorTab('settings'));
  elements.tasksTab.addEventListener('keydown', handleInspectorTabKeydown);
  elements.activityTab.addEventListener('keydown', handleInspectorTabKeydown);
  elements.changesTab.addEventListener('keydown', handleInspectorTabKeydown);
  elements.settingsTab.addEventListener('keydown', handleInspectorTabKeydown);
  byId('clearActivity').addEventListener('click', clearActivity);
  elements.memoryReview.addEventListener('click', (event) => {
    const button = event.target.closest('[data-memory-remove]');
    if (!button || state.busy) return;
    void submitTurn('/memory remove ' + button.dataset.memoryRemove);
  });
  elements.reviewPresets.addEventListener('click', (event) => {
    const button = event.target.closest('[data-review-preset]');
    if (!button) return;
    const command = '/review ' + button.dataset.reviewPreset;
    setInspector(false);
    if (state.busy) {
      queuePrompt(command);
      return;
    }
    void submitTurn(command);
  });
  elements.agentRunList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-agent-abort]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await api('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'abort', agentId: button.dataset.agentAbort }),
      });
      showToast(copy.agentAborted, 'success');
      await loadStatus();
    } catch (error) {
      button.disabled = false;
      showToast(error.message || String(error), 'error');
    }
  });
  elements.changesList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rollback-file]');
    if (!button) return;
    void applyReviewAction({ action: 'rollback-file', path: button.dataset.rollbackFile }, button);
  });
  elements.checkpointList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rewind-checkpoint]');
    if (!button) return;
    void applyReviewAction({ action: 'rewind', checkpointId: button.dataset.rewindCheckpoint }, button);
  });
  elements.exportTraceButton.addEventListener('click', () => void exportDiagnostics());

  document.querySelectorAll('[data-suggestion]').forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = suggestionPrompts[Number(button.dataset.suggestion)] || '';
      setComposerValue(prompt);
    });
  });

  document.querySelectorAll('[data-fill]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.busy) return;
      setComposerValue(button.dataset.fill || '');
      closeSidebar();
    });
  });

  document.querySelectorAll('[data-open-context]').forEach((button) => {
    button.addEventListener('click', () => {
      openContextPicker();
      closeSidebar();
    });
  });

  elements.contextPickerClose.addEventListener('click', () => closeContextPicker());
  elements.clearContextButton.addEventListener('click', clearContextFiles);
  elements.contextSearch.addEventListener('input', queueContextPickerRefresh);
  elements.contextSearch.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveContextPickerSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveContextPickerSelection(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setContextPickerBoundary(false);
    } else if (event.key === 'End') {
      event.preventDefault();
      setContextPickerBoundary(true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      addContextFile(contextPickerSelection);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeContextPicker();
    }
  });

  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => {
      const command = button.dataset.command || '';
      if (command === '/doctor' || command === '/help') {
        setInspector(true, 'activity');
      }
      closeSidebar();
      submitTurn(command);
    });
  });

  elements.newTaskButton.addEventListener('click', () => {
    closeContextPicker({ skipRestore: true });
    void updateSession({ action: 'new' });
  });
  const closeProjectDialog = (restoreFocus = true) => {
    if (elements.projectDialog.hidden) return;
    elements.projectDialog.hidden = true;
    elements.projectDialog.setAttribute('aria-hidden', 'true');
    if (restoreFocus && state.projectDialogReturnFocus) state.projectDialogReturnFocus.focus();
    state.projectDialogReturnFocus = null;
  };
  const openManualProjectDialog = () => {
    if (state.busy) return;
    state.projectDialogReturnFocus = document.activeElement;
    elements.projectDialog.hidden = false;
    elements.projectDialog.setAttribute('aria-hidden', 'false');
    elements.projectPathInput.focus();
    elements.projectPathInput.select();
  };
  const switchToProject = (result) => {
    if (!result || typeof result.url !== 'string') {
      throw new Error(copy.projectSwitchFailed);
    }
    const target = new URL(result.url);
    const token = new URLSearchParams(target.hash.slice(1)).get('token');
    if (
      target.protocol !== 'http:' ||
      !['127.0.0.1', '::1', 'localhost'].includes(target.hostname) ||
      target.username ||
      target.password ||
      !token ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(token)
    ) {
      throw new Error(copy.projectSwitchFailed);
    }
    window.location.assign(target.href);
  };
  const launchProject = async (action, selectedPath) => {
    const path = String(selectedPath || elements.projectPathInput.value).trim();
    if (!path) {
      showToast(copy.projectPathRequired, 'error');
      elements.projectPathInput.focus();
      return;
    }
    elements.projectDialogOpen.disabled = true;
    elements.projectDialogCreate.disabled = true;
    showToast(copy.projectOpened);
    try {
      const result = await api('/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, path }),
      });
      closeProjectDialog(false);
      elements.projectPathInput.value = '';
      switchToProject(result);
    } catch (error) {
      showToast(error.message || String(error), 'error');
    } finally {
      elements.projectDialogOpen.disabled = false;
      elements.projectDialogCreate.disabled = false;
    }
  };
  const pickAndOpenProject = async () => {
    if (state.busy || state.projectPickerPending) return;
    state.projectPickerPending = true;
    elements.newProjectButton.disabled = true;
    try {
      const result = await api('/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pick' }),
      });
      if (result.cancelled || !result.path) return;
      await launchProject('open', result.path);
    } catch (error) {
      showToast(error.message || String(error), 'warning');
      openManualProjectDialog();
    } finally {
      state.projectPickerPending = false;
      elements.newProjectButton.disabled = false;
    }
  };
  const openProjectDialog = pickAndOpenProject;
  elements.newProjectButton.addEventListener('click', () => void pickAndOpenProject());
  elements.projectDialogBackdrop.addEventListener('click', () => closeProjectDialog());
  elements.projectDialogCancel.addEventListener('click', () => closeProjectDialog());
  elements.projectDialogOpen.addEventListener('click', () => void launchProject('open'));
  elements.projectDialogCreate.addEventListener('click', () => void launchProject('create'));
  elements.projectList.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-project-action="remove"]');
    if (remove && !state.busy) {
      if (remove.dataset.confirmRemove !== 'true') {
        remove.dataset.confirmRemove = 'true';
        remove.title = copy.confirmRemoveProject;
        remove.setAttribute('aria-label', copy.confirmRemoveProject);
        window.setTimeout(() => {
          remove.dataset.confirmRemove = 'false';
          remove.title = copy.removeProject;
          remove.setAttribute('aria-label', copy.removeProject);
        }, 3000);
        return;
      }
      state.busy = true;
      api('/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', projectId: remove.dataset.projectId || '' }),
      }).then(async () => {
        showToast(copy.projectRemoved, 'success');
        await loadStatus();
      }).catch((error) => showToast(error.message || String(error), 'error'))
        .finally(() => { state.busy = false; });
      return;
    }
    const button = event.target.closest('[data-project-path]');
    if (!button || button.disabled || state.busy) return;
    state.busy = true;
    button.classList.add('is-switching');
    button.setAttribute('aria-busy', 'true');
    showToast(copy.projectOpened);
    api('/api/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', path: button.dataset.projectPath || '' }),
    }).then(switchToProject)
      .catch((error) => showToast(error.message || String(error), 'error'))
      .finally(() => {
        state.busy = false;
        button.classList.remove('is-switching');
        button.removeAttribute('aria-busy');
      });
  });
  elements.projectPathInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void launchProject('open');
    }
  });
  elements.projectDialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [elements.projectPathInput, elements.projectDialogCancel, elements.projectDialogOpen, elements.projectDialogCreate];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  const closeSessionDeleteDialog = (restoreFocus = true) => {
    if (elements.sessionDeleteDialog.hidden) return;
    elements.sessionDeleteDialog.hidden = true;
    elements.sessionDeleteDialog.setAttribute('aria-hidden', 'true');
    state.pendingSessionDeleteId = null;
    if (restoreFocus && state.sessionDeleteReturnFocus) state.sessionDeleteReturnFocus.focus();
    state.sessionDeleteReturnFocus = null;
  };
  const openSessionDeleteDialog = (button, sessionId) => {
    const row = button.closest('.session-row');
    const title = row && row.querySelector('.recent-session-title');
    state.pendingSessionDeleteId = sessionId;
    state.sessionDeleteReturnFocus = button;
    elements.sessionDeleteName.textContent = title && title.textContent || copy.untitledTask;
    elements.sessionDeleteDialog.hidden = false;
    elements.sessionDeleteDialog.setAttribute('aria-hidden', 'false');
    elements.sessionDeleteConfirm.focus();
  };
  const handleSessionListClick = (event) => {
    const actionButton = event.target.closest('[data-session-action]');
    if (actionButton) {
      if (state.busy) return;
      const action = actionButton.dataset.sessionAction;
      const sessionId = actionButton.dataset.sessionId;
      if (!action || !sessionId) return;
      if (action === 'delete') {
        openSessionDeleteDialog(actionButton, sessionId);
        return;
      }
      void updateSession({ action, sessionId });
      return;
    }
    const button = event.target.closest('.recent-session[data-session-id]');
    if (!button || state.busy || button.closest('.is-archived') || button.closest('.is-active')) return;
    void updateSession({ action: 'resume', sessionId: button.dataset.sessionId });
  };
  elements.recentSessions.addEventListener('click', handleSessionListClick);
  elements.archivedSessions.addEventListener('click', handleSessionListClick);
  elements.sessionSearch.addEventListener('input', () => {
    state.sessionQuery = elements.sessionSearch.value;
    state.sessionLimit = 24;
    renderSessionNavigation(state.sessionData || {});
  });
  elements.sessionShowMore.addEventListener('click', () => {
    state.sessionLimit += 24;
    renderSessionNavigation(state.sessionData || {});
  });
  const setProjectExpanded = (expanded) => {
    elements.projectToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    elements.projectChatBody.hidden = !expanded;
    writeLocalStorage('orbit.webui.project', expanded ? 'expanded' : 'collapsed');
  };
  elements.projectToggle.addEventListener('click', () => {
    setProjectExpanded(elements.projectToggle.getAttribute('aria-expanded') !== 'true');
  });
  elements.archiveToggle.addEventListener('click', () => {
    const expanded = elements.archiveToggle.getAttribute('aria-expanded') === 'true';
    elements.archiveToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    elements.archivedPanel.hidden = expanded;
  });
  elements.sessionDeleteBackdrop.addEventListener('click', () => closeSessionDeleteDialog());
  elements.sessionDeleteCancel.addEventListener('click', () => closeSessionDeleteDialog());
  elements.sessionDeleteConfirm.addEventListener('click', () => {
    const sessionId = state.pendingSessionDeleteId;
    if (!sessionId || state.busy) return;
    closeSessionDeleteDialog(false);
    void updateSession({ action: 'delete', sessionId });
  });
  elements.sessionDeleteDialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const first = elements.sessionDeleteCancel;
    const last = elements.sessionDeleteConfirm;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  elements.commandsButton.addEventListener('click', openCommandPalette);
  elements.commandTrigger.addEventListener('click', openCommandPalette);
  elements.commandPaletteBackdrop.addEventListener('click', closeCommandPalette);
  elements.commandSearch.addEventListener('input', () => {
    paletteSelection = 0;
    renderCommandPalette();
  });
  elements.commandSearch.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePaletteSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      movePaletteSelection(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      paletteSelection = 0;
      syncPaletteSelection();
    } else if (event.key === 'End') {
      event.preventDefault();
      paletteSelection = Math.max(0, paletteActions.length - 1);
      syncPaletteSelection();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      executePaletteAction(paletteSelection);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandPalette();
    }
  });

  elements.providerSelect.addEventListener('change', () => {
    applySettings({ provider: elements.providerSelect.value }, true).catch(() => {});
  });

  elements.modelSelect.addEventListener('change', () => {
    applySettings({ model: elements.modelSelect.value }, true).catch(() => {});
  });

  byId('applyModel').addEventListener('click', () => {
    const model = elements.customModel.value.trim();
    if (!model) return;
    applySettings({ model }).then(() => { elements.customModel.value = ''; }).catch(() => {});
  });

  elements.permissionSelect.addEventListener('change', () => {
    applySettings({ permissionMode: elements.permissionSelect.value }, true).catch(() => {});
  });

  elements.languageOptions.querySelectorAll('[data-language-value]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextLanguage = button.dataset.languageValue;
      if (!nextLanguage || nextLanguage === language) return;
      try {
        await applySettings({ language: nextLanguage }, true);
        window.location.reload();
      } catch {}
    });
  });

  elements.permissionSegments.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => applySettings({ permissionMode: button.dataset.mode }).catch(() => {}));
  });

  elements.searchToggle.addEventListener('click', () => {
    const enabled = elements.searchToggle.getAttribute('aria-pressed') !== 'true';
    applySettings({ webSearchEnabled: enabled }, true).catch(() => {});
  });
  elements.searchEnabled.addEventListener('change', () => {
    applySettings({ webSearchEnabled: elements.searchEnabled.checked }, true).catch(() => {});
  });
  elements.searchProvider.addEventListener('change', () => {
    applySettings({ webSearchProvider: elements.searchProvider.value }, true).catch(() => {});
  });
  elements.searchMax.addEventListener('change', () => {
    applySettings({ webSearchMaxResults: Number(elements.searchMax.value) }, true).catch(() => {});
  });
  elements.skillsEnabled.addEventListener('change', () => {
    applySettings({ skillsEnabled: elements.skillsEnabled.checked }, true).catch(() => {});
  });
  const setCapabilityKind = (kind) => {
    state.capabilityKind = kind === 'workflow' ? 'workflow' : 'skill';
    elements.capabilityDescription.maxLength = state.capabilityKind === 'workflow' ? 240 : 2000;
    elements.capabilityKind.querySelectorAll('[data-capability-kind]').forEach((button) => {
      const active = button.dataset.capabilityKind === state.capabilityKind;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    elements.capabilityWorkflowFields.hidden = state.capabilityKind !== 'workflow';
  };
  const closeCapabilityCreator = () => {
    elements.capabilityCreator.hidden = true;
    elements.addCapabilityButton.setAttribute('aria-expanded', 'false');
    elements.capabilityCreator.reset();
    setCapabilityKind('skill');
  };
  elements.addCapabilityButton.addEventListener('click', () => {
    const opening = elements.capabilityCreator.hidden;
    elements.capabilityCreator.hidden = !opening;
    elements.addCapabilityButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) elements.capabilityName.focus();
  });
  elements.cancelCapabilityButton.addEventListener('click', closeCapabilityCreator);
  elements.capabilityKind.querySelectorAll('[data-capability-kind]').forEach((button) => {
    button.addEventListener('click', () => setCapabilityKind(button.dataset.capabilityKind));
  });
  elements.capabilityCreator.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = elements.capabilityName.value.trim().toLowerCase();
    const description = elements.capabilityDescription.value.trim();
    const instructions = elements.capabilityInstructions.value.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(name)) {
      elements.capabilityName.focus();
      return;
    }
    if (!description) {
      elements.capabilityDescription.focus();
      return;
    }
    if (!instructions) {
      elements.capabilityInstructions.focus();
      return;
    }
    const payload = { kind: state.capabilityKind, name, description, instructions };
    if (state.capabilityKind === 'workflow') {
      payload.skills = elements.capabilitySkills.value.split(',')
        .map((skill) => skill.trim().toLowerCase())
        .filter((skill, index, all) => /^[a-z0-9][a-z0-9-]{0,47}$/.test(skill) && all.indexOf(skill) === index)
        .slice(0, 8);
    }
    elements.createCapabilityButton.disabled = true;
    try {
      await api('/api/capability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      closeCapabilityCreator();
      await Promise.all([loadSkills(true), loadSlashCommands()]);
      showToast(copy.capabilityCreated, 'success');
    } catch (error) {
      showToast(error.message || String(error), 'error');
    } finally {
      elements.createCapabilityButton.disabled = false;
    }
  });
  elements.skillActivationSegments.querySelectorAll('[data-skill-activation]').forEach((button) => {
    button.addEventListener('click', () => {
      applySettings({ skillsActivation: button.dataset.skillActivation }).catch(() => {});
    });
  });
  elements.skillsMaxActive.addEventListener('change', () => {
    applySettings({ skillsMaxActive: Number(elements.skillsMaxActive.value) }, true).catch(() => {});
  });
  elements.refreshSkills.addEventListener('click', () => {
    loadSkills(true).catch((error) => showToast(error.message || String(error), 'error'));
  });

  document.querySelectorAll('[data-theme-value]').forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeValue));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!elements.projectDialog.hidden) {
        closeProjectDialog();
        return;
      }
      if (!elements.sessionDeleteDialog.hidden) {
        closeSessionDeleteDialog();
        return;
      }
      if (closeOpenSelectControls(true)) return;
      if (!elements.contextPicker.hidden) {
        closeContextPicker();
        return;
      }
      if (!elements.commandPalette.hidden) {
        closeCommandPalette();
        return;
      }
      setInspector(false);
      closeSidebar();
    }
    if ((event.ctrlKey || event.metaKey) && ['k', 'p'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (elements.commandPalette.hidden) openCommandPalette();
      else closeCommandPalette();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      if (!state.busy) void updateSession({ action: 'new' });
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      setInspector(true, 'settings');
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleNavigation();
    }
  });

  window.addEventListener('beforeunload', () => {
    state.shuttingDown = true;
    if (state.eventRetryTimer) window.clearTimeout(state.eventRetryTimer);
    if (state.connectionNoticeTimer) window.clearTimeout(state.connectionNoticeTimer);
    if (state.eventSource) state.eventSource.close();
    for (const attachment of state.attachments) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
  });

  async function initialize() {
    if (state.initializing) return;
    state.initializing = true;
    state.ready = false;
    state.useBearerTransport = false;
    setConnection('connecting', copy.reconnecting);
    elements.sendButton.disabled = true;
    applyTheme(readLocalStorage('orbit.webui.theme', 'system'));
    elements.appShell.classList.toggle(
      'sidebar-collapsed',
      readLocalStorage('orbit.webui.sidebar', 'expanded') === 'collapsed',
    );
    setProjectExpanded(readLocalStorage('orbit.webui.project', 'expanded') !== 'collapsed');
    restorePromptQueue();
    syncSidebarInteractivity();
    const draft = readLocalStorage('orbit.webui.draft', '');
    if (draft) {
      elements.prompt.value = draft;
      autoSizePrompt();
      updateSendButtonState();
    }
    try {
      await bootstrapSession();
      await Promise.all([renderMessages(), loadStatus(), loadSlashCommands()]);
      connectEvents();
      if (draft) showToast(copy.draftRestored);
      elements.prompt.focus();
    } catch (error) {
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
      }
      setConnection('disconnected', copy.disconnected);
      showToast(error.status === 401 ? copy.accessExpired : error.message || copy.accessExpired, 'error');
      updateSendButtonState();
    } finally {
      state.initializing = false;
    }
  }

  initialize();
`;
