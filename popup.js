/**
 * ============================================================================
 * TikTok Auto Unfollow - popup.js
 * Logique de l'interface utilisateur, gestion de l'état et communication
 * avec le content script de TikTok.
 * Compatible Chrome (Manifest V3) et Firefox.
 * ============================================================================
 */

document.addEventListener('DOMContentLoaded', async () => {
  // --- Éléments du DOM ---
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const warningNotice = document.getElementById('warningNotice');
  const warningMessage = document.getElementById('warningMessage');

  const unfollowCounter = document.getElementById('unfollowCounter');
  const counterLimitText = document.getElementById('counterLimitText');
  const progressBar = document.getElementById('progressBar');

  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const pauseText = document.getElementById('pauseText');
  const btnStop = document.getElementById('btnStop');
  const btnResetCounter = document.getElementById('btnResetCounter');

  const settingsToggle = document.getElementById('settingsToggle');
  const settingsCard = settingsToggle.closest('.settings-card');
  const minDelayInput = document.getElementById('minDelay');
  const maxDelayInput = document.getElementById('maxDelay');
  const maxLimitInput = document.getElementById('maxLimit');
  const reloadEveryInput = document.getElementById('reloadEvery');
  const autoScrollInput = document.getElementById('autoScroll');

  const speedPresets = document.getElementById('speedPresets');
  const speedValue = document.getElementById('speedValue');

  const logsContainer = document.getElementById('logsContainer');
  const btnClearLogs = document.getElementById('btnClearLogs');

  // Onglet TikTok piloté : l'onglet actif s'il est sur TikTok, sinon l'onglet
  // de travail lancé précédemment (qui peut tourner en arrière-plan).
  let targetTabId = null;
  let totalCount = 0;
  let sessionCount = 0;

  const isTikTokUrl = (url) => /^https:\/\/(www\.)?tiktok\.com\//.test(url || '');

  // --- Initialisation : Détection de l'onglet à piloter ---
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { workerTabId } = await chrome.storage.local.get('workerTabId');

    let workerTab = null;
    if (workerTabId) {
      try {
        workerTab = await chrome.tabs.get(workerTabId);
      } catch (_) {
        workerTab = null; // onglet fermé
      }
    }

    if (workerTab && isTikTokUrl(workerTab.url) && (!activeTab || activeTab.id !== workerTab.id)) {
      targetTabId = workerTab.id;
      showNotice('ℹ️', 'Le désabonnement tourne dans un autre onglet TikTok (en arrière-plan). Vous pouvez le contrôler d’ici.');
    } else if (activeTab && isTikTokUrl(activeTab.url)) {
      targetTabId = activeTab.id;
    } else {
      showNotice('ℹ️', 'Pas besoin d’être sur TikTok : « Lancer » ouvrira votre profil dans un onglet en arrière-plan.');
    }
  } catch (err) {
    console.error("Erreur lors de la récupération de l'onglet :", err);
  }

  // --- Gestion du volet Paramètres (Accordéon) ---
  settingsToggle.addEventListener('click', () => {
    settingsCard.classList.toggle('collapsed');
  });

  // --- Chargement de la configuration et de l'état sauvegardé ---
  await loadStateAndSettings();

  // --- Interrogation directe du Content Script pour synchronisation ---
  if (targetTabId) {
    sendMessageToTab(targetTabId, { action: 'GET_STATUS' }, async (response) => {
      if (response && response.status) {
        updateUI(response);
      } else {
        // Onglet injoignable et aucune reprise en attente : l'état sauvegardé est périmé
        const { pendingResume } = await chrome.storage.local.get('pendingResume');
        if (!pendingResume) syncButtons(false, false);
      }
    });
  } else {
    syncButtons(false, false);
  }

  // --- Écouteur des changements dans chrome.storage (temps réel) ---
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.sessionCount !== undefined) {
        sessionCount = changes.sessionCount.newValue || 0;
        updateCounter(totalCount);
      }
      if (changes.unfollowedCount !== undefined) {
        updateCounter(changes.unfollowedCount.newValue || 0);
      }
      if (changes.statusState !== undefined) {
        updateStatusBadge(changes.statusState.newValue);
      }
      if (changes.logs !== undefined) {
        renderLogs(changes.logs.newValue || []);
      }
      if (changes.isRunning !== undefined || changes.isPaused !== undefined) {
        syncButtons(
          changes.isRunning ? changes.isRunning.newValue : undefined,
          changes.isPaused ? changes.isPaused.newValue : undefined
        );
      }
    }
  });

  // --- Événements : Clics sur les boutons de contrôle ---

  // Bouton Lancer
  btnStart.addEventListener('click', async () => {
    const settings = validateAndGetSettings();
    if (!settings) return;

    // Sauvegarde des préférences
    await chrome.storage.local.set({ settings });

    if (!targetTabId) {
      await launchInBackground(settings);
      return;
    }

    // Envoi direct du message au content script (les logs viennent de content.js).
    // Si la liste n'est pas ouverte, content.js va sur le profil et l'ouvre tout seul.
    const tabId = targetTabId;
    sendMessageToTab(tabId, { action: 'START', settings }, async (response) => {
      if (response && response.success) {
        await chrome.storage.local.set({ workerTabId: tabId });
        syncButtons(true, false);
        updateStatusBadge('RUNNING');
      } else {
        addLogEntry('Impossible de contacter la page TikTok. Rafraîchissez-la (F5), puis relancez.', 'warn');
      }
    });
  });

  /**
   * Aucun onglet TikTok sous la main : on en ouvre un en arrière-plan sur le
   * profil (ou l'accueil), et content.js démarre tout seul via pendingResume.
   */
  async function launchInBackground(settings) {
    const { profileUrl } = await chrome.storage.local.get('profileUrl');
    await chrome.storage.local.set({
      pendingResume: { at: Date.now(), settings, sessionCount: 0, reloadsWithoutProgress: 0, navAttempts: 0 },
      sessionCount: 0
    });

    const tab = await chrome.tabs.create({ url: profileUrl || 'https://www.tiktok.com/', active: false });
    targetTabId = tab.id;
    await chrome.storage.local.set({ workerTabId: tab.id, isRunning: true, isPaused: false, statusState: 'RELOADING' });
    showNotice('ℹ️', 'TikTok a été ouvert dans un onglet en arrière-plan. Restez connecté(e) à votre compte.');
    addLogEntry('Ouverture de TikTok en arrière-plan...', 'info');
  }

  // Bouton Pause / Reprendre
  btnPause.addEventListener('click', () => {
    if (!targetTabId) return;

    const isCurrentlyPaused = pauseText.textContent.trim().toLowerCase() === 'reprendre';
    const action = isCurrentlyPaused ? 'RESUME' : 'PAUSE';

    sendMessageToTab(targetTabId, { action }, (response) => {
      if (response && response.success) {
        if (isCurrentlyPaused) {
          pauseText.textContent = 'Pause';
          updateStatusBadge('RUNNING');
        } else {
          pauseText.textContent = 'Reprendre';
          updateStatusBadge('PAUSED');
        }
      }
    });
  });

  // Bouton Stop
  btnStop.addEventListener('click', async () => {
    // Annule aussi une reprise en attente si la page est en train de recharger
    await chrome.storage.local.remove('pendingResume');

    const done = async () => {
      await chrome.storage.local.set({ isRunning: false, isPaused: false, statusState: 'STOPPED' });
      syncButtons(false, false);
      updateStatusBadge('STOPPED');
    };

    if (!targetTabId) {
      await done();
      return;
    }
    sendMessageToTab(targetTabId, { action: 'STOP' }, done, false);
  });

  // Réinitialiser le compteur
  btnResetCounter.addEventListener('click', async () => {
    await chrome.storage.local.set({ unfollowedCount: 0, sessionCount: 0 });
    sessionCount = 0;
    updateCounter(0);
    if (targetTabId) {
      sendMessageToTab(targetTabId, { action: 'RESET_COUNTER' }, null, false);
    }
    addLogEntry('Compteur remis à zéro.', 'system');
  });

  // Effacer les logs
  btnClearLogs.addEventListener('click', async () => {
    await chrome.storage.local.set({ logs: [] });
    logsContainer.innerHTML = '';
  });

  // Écouteur en direct sur la modification de la limite
  maxLimitInput.addEventListener('input', () => {
    updateCounter(totalCount);
  });

  // Préréglages de vitesse : appliqués immédiatement, même en cours d'exécution
  speedPresets.addEventListener('click', (e) => {
    const chip = e.target.closest('.speed-chip');
    if (!chip) return;
    minDelayInput.value = chip.dataset.min;
    maxDelayInput.value = chip.dataset.max;
    applySettingsLive();
  });

  [minDelayInput, maxDelayInput, maxLimitInput, reloadEveryInput, autoScrollInput].forEach(input => {
    input.addEventListener('change', applySettingsLive);
  });

  // --- Fonctions Utilitaires et Logique Métier ---

  /**
   * Valide les paramètres saisis par l'utilisateur
   */
  function validateAndGetSettings() {
    let minDelay = parseFloat(minDelayInput.value);
    let maxDelay = parseFloat(maxDelayInput.value);
    let maxLimit = parseInt(maxLimitInput.value, 10);
    let reloadEvery = parseInt(reloadEveryInput.value, 10);
    const autoScroll = autoScrollInput.checked;

    if (isNaN(minDelay) || minDelay < 0.5) minDelay = 2.0;
    if (isNaN(maxDelay) || maxDelay < minDelay) maxDelay = minDelay + 2.0;
    if (isNaN(maxLimit) || maxLimit < 0) maxLimit = 0; // 0 = Illimité
    if (isNaN(reloadEvery)) reloadEvery = 50;
    if (reloadEvery < 0) reloadEvery = 0; // 0 = jamais

    minDelayInput.value = minDelay.toFixed(1);
    maxDelayInput.value = maxDelay.toFixed(1);
    maxLimitInput.value = maxLimit;
    reloadEveryInput.value = reloadEvery;
    refreshSpeedUI();

    return { minDelay, maxDelay, maxLimit, reloadEvery, autoScroll };
  }

  /**
   * Sauvegarde les réglages et les transmet au content script en direct
   */
  async function applySettingsLive() {
    const settings = validateAndGetSettings();
    updateCounter(totalCount);
    await chrome.storage.local.set({ settings });
    if (targetTabId) {
      sendMessageToTab(targetTabId, { action: 'UPDATE_SETTINGS', settings }, null, false);
    }
  }

  /**
   * Affiche la plage de délai et surligne le préréglage correspondant
   */
  function refreshSpeedUI() {
    const min = parseFloat(minDelayInput.value);
    const max = parseFloat(maxDelayInput.value);
    speedValue.textContent = `${min.toFixed(1)} – ${max.toFixed(1)} s / compte`;
    speedPresets.querySelectorAll('.speed-chip').forEach(chip => {
      const match = parseFloat(chip.dataset.min) === min && parseFloat(chip.dataset.max) === max;
      chip.classList.toggle('active', match);
    });
  }

  /**
   * Charge la configuration et l'historique depuis chrome.storage.local
   */
  async function loadStateAndSettings() {
    const data = await chrome.storage.local.get([
      'unfollowedCount',
      'sessionCount',
      'settings',
      'logs',
      'isRunning',
      'isPaused',
      'statusState'
    ]);

    // Paramètres
    if (data.settings) {
      if (data.settings.minDelay !== undefined) minDelayInput.value = data.settings.minDelay;
      if (data.settings.maxDelay !== undefined) maxDelayInput.value = data.settings.maxDelay;
      if (data.settings.maxLimit === 50 || data.settings.maxLimit === undefined) {
        maxLimitInput.value = 0;
      } else {
        maxLimitInput.value = data.settings.maxLimit;
      }
      if (data.settings.reloadEvery !== undefined) reloadEveryInput.value = data.settings.reloadEvery;
      if (data.settings.autoScroll !== undefined) autoScrollInput.checked = data.settings.autoScroll;
    } else {
      maxLimitInput.value = 0;
    }
    refreshSpeedUI();

    // Compteur
    sessionCount = data.sessionCount || 0;
    updateCounter(data.unfollowedCount || 0);

    // Logs
    if (data.logs && Array.isArray(data.logs)) {
      renderLogs(data.logs);
    }

    // État des boutons et badge
    syncButtons(data.isRunning || false, data.isPaused || false);
    updateStatusBadge(data.statusState || (data.isRunning ? 'RUNNING' : 'READY'));
  }

  /**
   * Met à jour l'affichage du compteur (total) et de la jauge (session / limite)
   */
  function updateCounter(count) {
    totalCount = count;
    unfollowCounter.textContent = count;
    const limit = parseInt(maxLimitInput.value, 10);

    if (limit > 0) {
      counterLimitText.textContent = `· session ${sessionCount} / ${limit}`;
      const percentage = Math.min(100, Math.round((sessionCount / limit) * 100));
      progressBar.style.width = `${percentage}%`;
    } else {
      counterLimitText.textContent = '/ Illimité';
      progressBar.style.width = '100%';
    }
  }

  /**
   * Met à jour le badge de statut
   */
  function updateStatusBadge(state) {
    statusBadge.className = 'status-badge';

    switch (state) {
      case 'RUNNING':
        statusBadge.classList.add('status-running');
        statusText.textContent = 'En cours';
        break;
      case 'RELOADING':
        statusBadge.classList.add('status-running');
        statusText.textContent = 'Rechargement…';
        break;
      case 'PAUSED':
        statusBadge.classList.add('status-paused');
        statusText.textContent = 'En pause';
        break;
      case 'STOPPED':
        statusBadge.classList.add('status-stopped');
        statusText.textContent = 'Arrêté';
        break;
      case 'DONE':
        statusBadge.classList.add('status-ready');
        statusText.textContent = 'Terminé';
        break;
      case 'READY':
      default:
        statusBadge.classList.add('status-ready');
        statusText.textContent = 'Prêt';
        break;
    }
  }

  /**
   * Active/Désactive les boutons selon l'état d'exécution
   */
  function syncButtons(isRunning, isPaused) {
    if (isRunning !== undefined) {
      btnStart.disabled = isRunning;
      btnStop.disabled = !isRunning;
      btnPause.disabled = !isRunning;
    }

    if (isPaused !== undefined) {
      pauseText.textContent = isPaused ? 'Reprendre' : 'Pause';
    }
  }

  /**
   * Synchronise l'UI complète avec l'état renvoyé par le content script
   */
  function updateUI(state) {
    if (state.sessionCount !== undefined) sessionCount = state.sessionCount;
    if (state.count !== undefined) updateCounter(state.count);
    if (state.isRunning !== undefined) syncButtons(state.isRunning, state.isPaused);
    if (state.status) updateStatusBadge(state.status);
  }

  /**
   * Envoi d'un message à l'onglet actif. Si le content script n'est pas
   * présent (extension rechargée, onglet ouvert avant l'installation),
   * il est injecté puis le message est renvoyé une fois.
   */
  function sendMessageToTab(tabId, message, callback, canInject = true) {
    try {
      chrome.tabs.sendMessage(tabId, message, async (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          if (canInject && chrome.scripting) {
            try {
              await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
              sendMessageToTab(tabId, message, callback, false);
              return;
            } catch (injectErr) {
              console.warn("Injection du content script impossible :", injectErr);
            }
          }
          console.warn("Communication onglet :", lastError.message);
          if (callback) callback({ success: false, error: lastError.message });
          return;
        }
        if (callback) callback(response || { success: true });
      });
    } catch (err) {
      console.warn("Erreur tabs.sendMessage :", err);
      if (callback) callback({ success: false, error: err.message });
    }
  }

  function showNotice(icon, text) {
    warningNotice.classList.remove('hidden');
    warningNotice.querySelector('.warning-icon').textContent = icon;
    warningMessage.textContent = text;
  }

  /**
   * Affiche la liste des logs dans l'encadré
   */
  function renderLogs(logs) {
    logsContainer.innerHTML = '';
    logs.forEach(log => {
      const div = document.createElement('div');
      div.className = `log-entry ${log.level || 'info'}`;
      div.textContent = log.text;
      logsContainer.appendChild(div);
    });
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  /**
   * Ajoute une entrée de log locale et la sauvegarde
   */
  async function addLogEntry(text, level = 'info') {
    const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = { text: `[${timeStr}] ${text}`, level };

    const div = document.createElement('div');
    div.className = `log-entry ${level}`;
    div.textContent = entry.text;
    logsContainer.appendChild(div);
    logsContainer.scrollTop = logsContainer.scrollHeight;

    const { logs = [] } = await chrome.storage.local.get('logs');
    logs.push(entry);
    if (logs.length > 50) logs.shift();
    await chrome.storage.local.set({ logs });
  }
});
