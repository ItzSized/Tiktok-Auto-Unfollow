/**
 * ============================================================================
 * TikTok Auto Unfollow - content.js
 * Script d'automatisation sur la page TikTok :
 * Détecte les boutons "Suivi(e)s" / "Following" dans la modale d'abonnements,
 * clique dessus, VÉRIFIE que TikTok a bien désabonné (le bouton repasse à
 * "Suivre" / "Follow"), fait défiler la liste et gère les délais anti-bot.
 * ============================================================================
 */

(() => {
  // Si une instance vivante existe déjà, ne rien faire. Si l'extension a été
  // rechargée, l'ancienne instance est morte (contexte invalidé) : on la remplace.
  const previous = window.__TIKTOK_AUTO_UNFOLLOW__;
  if (previous && typeof previous.isAlive === 'function' && previous.isAlive()) {
    return;
  }

  const isAlive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };
  window.__TIKTOK_AUTO_UNFOLLOW__ = { isAlive };

  // --- État de l'automatisation ---
  const state = {
    isRunning: false,
    isPaused: false,
    isStopped: false,
    runId: 0,
    count: 0,          // total cumulé (persisté)
    sessionCount: 0,   // compteur de la session en cours (pour la limite)
    sinceReload: 0,    // désabonnements depuis le dernier chargement de page
    reloadsWithoutProgress: 0,
    status: 'READY',
    settings: {
      minDelay: 2.5,
      maxDelay: 5.0,
      maxLimit: 0,     // 0 = Illimité
      reloadEvery: 50, // 0 = jamais de rechargement automatique
      autoScroll: true
    }
  };

  // --- Libellés (comparés après normalisation, voir normalizeLabel) ---
  const FOLLOWING_LABELS = new Set([
    'following', 'friends',
    'suivi', 'suivis', 'suivie', 'suivies', 'suivi(e)', 'suivi(e)s', 'suivi·e', 'suivi·e·s',
    'abonné', 'abonnée', 'abonnés', 'abonnées', 'abonné(e)', 'abonné(e)s', 'abonné·e',
    'amis', 'ami(e)s', 'ami·e·s'
  ]);

  const FOLLOW_LABELS = new Set([
    'follow', 'follow back', 'suivre', 'suivre en retour', "s'abonner", 'abonner'
  ]);

  const CONFIRM_LABELS = new Set([
    'se désabonner', 'désabonner', 'ne plus suivre', 'unfollow', 'confirmer', 'confirm'
  ]);

  const RATE_LIMIT_REGEX = /(too fast|too many|trop vite|trop fr[ée]quent|try again later|r[ée]essaye[rz]? plus tard|temporairement|temporarily)/i;

  const OPEN_LIST_LABELS = new Set([
    'following', 'abonnements', 'abonnement', 'suivis', 'suivi(e)s', 'suivi·e·s'
  ]);

  const MAX_CONSECUTIVE_FAILURES = 3;
  const MAX_EMPTY_SCROLLS = 6;
  const MAX_RELOADS_WITHOUT_PROGRESS = 2;
  const RESUME_MAX_AGE_MS = 120000;

  // --- Écouteur de Messages depuis la Popup ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'PING':
        sendResponse({ success: true });
        break;

      case 'START':
        if (message.settings) {
          state.settings = { ...state.settings, ...message.settings };
        }
        startProcess();
        sendResponse({ success: true, isRunning: true });
        break;

      case 'UPDATE_SETTINGS':
        // Changement de vitesse / limites en direct, même pendant l'exécution
        if (message.settings) {
          state.settings = { ...state.settings, ...message.settings };
        }
        sendResponse({ success: true });
        break;

      case 'PAUSE':
        pauseProcess();
        sendResponse({ success: true, isPaused: true });
        break;

      case 'RESUME':
        resumeProcess();
        sendResponse({ success: true, isPaused: false });
        break;

      case 'STOP':
        stopProcess();
        sendResponse({ success: true, isStopped: true });
        break;

      case 'GET_STATUS':
        sendResponse({
          isRunning: state.isRunning,
          isPaused: state.isPaused,
          count: state.count,
          sessionCount: state.sessionCount,
          status: state.status
        });
        break;

      case 'RESET_COUNTER':
        state.count = 0;
        state.sessionCount = 0;
        safeStorageSet({ unfollowedCount: 0, sessionCount: 0 });
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Action inconnue' });
    }
    return false;
  });

  // Charger le compteur existant
  try {
    chrome.storage.local.get(['unfollowedCount'], (res) => {
      if (res && res.unfollowedCount !== undefined) {
        state.count = res.unfollowedCount;
      }
    });
  } catch (_) {}

  // Reprise automatique après un rechargement déclenché par le script lui-même
  // (un rechargement manuel ne relance rien : pendingResume n'existe pas)
  try {
    chrome.storage.local.get(['pendingResume'], async (res) => {
      const resume = res && res.pendingResume;
      if (!resume) return;
      try {
        await chrome.storage.local.remove('pendingResume');
      } catch (_) {}
      if (Date.now() - (resume.at || 0) > RESUME_MAX_AGE_MS) return;
      resumeAfterReload(resume);
    });
  } catch (_) {}

  // --- Cœur du Processus ---

  async function startProcess(resume = null) {
    if (state.isRunning && !resume) return;

    state.runId++;
    const myRunId = state.runId;
    state.isRunning = true;
    state.isPaused = false;
    state.isStopped = false;
    state.sessionCount = resume ? resume.sessionCount || 0 : 0;
    state.reloadsWithoutProgress = resume ? resume.reloadsWithoutProgress || 0 : 0;
    state.sinceReload = 0;
    clearFailedMarks();
    keepTabAlive(true);

    await safeStorageSet({ sessionCount: state.sessionCount });
    await log(resume ? '▶️ Reprise automatique du désabonnement...' : '▶️ Démarrage du désabonnement...', 'info');
    await updateStorageState('RUNNING');

    const active = () => isAlive() && state.isRunning && !state.isStopped && state.runId === myRunId;

    // Liste pas encore ouverte : on l'ouvre nous-mêmes (en allant sur le profil si besoin)
    if (!isListOpen()) {
      const ready = await prepareFollowingList(resume, active);
      if (!ready) return;
    } else {
      rememberProfileUrlIfUnknown();
    }

    // Diagnostic utile pour comprendre ce que le script "voit"
    const scope = getScope();
    const visible = countFollowingButtons(scope.root);
    await log(
      `Liste ${scope.isModal ? 'détectée (modale)' : 'NON détectée, recherche dans la page'} · ${visible} bouton(s) "Suivi(e)s" visibles.`,
      visible > 0 ? 'info' : 'warn'
    );

    runLoop(myRunId);
  }

  async function pauseProcess() {
    if (!state.isRunning) return;
    state.isPaused = true;
    await log('⏸️ Automatisation en pause.', 'warn');
    await updateStorageState('PAUSED');
  }

  async function resumeProcess() {
    if (!state.isRunning) return;
    state.isPaused = false;
    clearFailedMarks();
    await log('▶️ Reprise de l’automatisation.', 'info');
    await updateStorageState('RUNNING');
  }

  async function stopProcess() {
    state.isRunning = false;
    state.isPaused = false;
    state.isStopped = true;
    try {
      await chrome.storage.local.remove('pendingResume');
    } catch (_) {}
    keepTabAlive(false);
    await log('⏹️ Automatisation arrêtée.', 'warn');
    await updateStorageState('STOPPED');
  }

  async function stopWithError(message) {
    state.isRunning = false;
    state.isPaused = false;
    keepTabAlive(false);
    await log(message, 'error');
    await updateStorageState('STOPPED');
  }

  // --- Rechargement automatique de la page ---

  function canReload() {
    return state.settings.reloadEvery > 0 &&
      (state.sinceReload > 0 || state.reloadsWithoutProgress < MAX_RELOADS_WITHOUT_PROGRESS);
  }

  /**
   * Quitte la page (rechargement ou navigation) en laissant une consigne de
   * reprise : la nouvelle page relancera le script toute seule.
   */
  async function leavePage(reason, resumeExtra, go) {
    await log(reason, 'info');
    await safeStorageSet({
      pendingResume: {
        at: Date.now(),
        settings: state.settings,
        sessionCount: state.sessionCount,
        reloadsWithoutProgress: state.reloadsWithoutProgress,
        navAttempts: 0,
        ...resumeExtra
      }
    });
    // isRunning reste vrai dans le stockage : la popup garde "Stop" actif pendant le chargement
    await updateStorageState('RELOADING');
    state.isRunning = false;
    state.isStopped = true;
    await logQueue;
    go();
  }

  function reloadPage(reason) {
    const noProgress = state.sinceReload > 0 ? 0 : state.reloadsWithoutProgress + 1;
    return leavePage(reason, { reloadsWithoutProgress: noProgress }, () => window.location.reload());
  }

  async function resumeAfterReload(resume) {
    state.settings = { ...state.settings, ...(resume.settings || {}) };
    await log('🔄 Page chargée, reprise automatique...', 'info');
    // Laisser TikTok finir d'afficher la page (navigation, profil)
    await sleep(2000);
    startProcess(resume);
  }

  // --- Ouverture automatique de la liste / navigation vers le profil ---

  function isListOpen() {
    return getScope().isModal || hasListInPage();
  }

  function hasListInPage() {
    for (const el of queryClickables(document)) {
      if (classify(el) === 'following' && isRendered(el) && !isExcluded(el, true) && looksLikeUserRow(el)) {
        return true;
      }
    }
    return false;
  }

  function profileUrlFrom(href) {
    try {
      const u = new URL(href, window.location.origin);
      const m = u.pathname.match(/^\/@[^/]+/);
      return m ? `${u.origin}${m[0]}` : null;
    } catch (_) {
      return null;
    }
  }

  function samePage(a, b) {
    const pa = profileUrlFrom(a);
    const pb = profileUrlFrom(b);
    return !!pa && !!pb && pa.toLowerCase() === pb.toLowerCase();
  }

  /**
   * URL de VOTRE profil : lien "Profil" de la barre de navigation, sinon la
   * dernière connue (enregistrée dans le stockage).
   */
  async function getOwnProfileUrl() {
    const link = document.querySelector(
      'a[data-e2e="nav-profile"][href*="/@"], [data-e2e="nav-profile"] a[href*="/@"], a[data-e2e="nav-profile-link"][href*="/@"]'
    );
    const fromNav = link ? profileUrlFrom(link.getAttribute('href')) : null;
    if (fromNav) {
      await safeStorageSet({ profileUrl: fromNav });
      return fromNav;
    }
    try {
      const { profileUrl } = await chrome.storage.local.get('profileUrl');
      return profileUrl || null;
    } catch (_) {
      return null;
    }
  }

  async function rememberProfileUrlIfUnknown() {
    const here = profileUrlFrom(window.location.href);
    if (!here) return;
    try {
      const { profileUrl } = await chrome.storage.local.get('profileUrl');
      if (!profileUrl) await safeStorageSet({ profileUrl: here });
    } catch (_) {}
  }

  /**
   * Ouvre la liste des abonnements, en naviguant vers le profil si on n'y est
   * pas. Retourne true si la liste est prête sur cette page.
   */
  async function prepareFollowingList(resume, active) {
    let ownProfile = await getOwnProfileUrl();
    // Tout bouton "Suivi(e)s" correspond à un compte que VOUS suivez : si votre
    // profil est inconnu, on peut sans risque tenter d'ouvrir la liste ici.
    const onOwnProfile = !ownProfile || samePage(ownProfile, window.location.href);

    if (onOwnProfile) {
      await log('Ouverture automatique de la liste des abonnements...', 'info');
      const opened = await openFollowingList(active, resume ? 25000 : 10000);
      if (!active()) return false;

      if (opened === 'opened') {
        rememberProfileUrlIfUnknown();
        await sleep(1500);
        return active();
      }
      if (opened === 'empty') {
        await log('✅ Plus aucun abonnement : tout est désabonné !', 'success');
        await finishProcess();
        return false;
      }
    }

    const navAttempts = resume ? resume.navAttempts || 0 : 0;
    if (navAttempts >= 2) {
      await stopWithError('❌ Impossible d’ouvrir votre liste d’abonnements. Ouvrez votre profil → Abonnements, puis relancez.');
      return false;
    }

    ownProfile = ownProfile || await getOwnProfileUrl();
    const target = ownProfile || 'https://www.tiktok.com/profile';
    await leavePage('➡️ Direction votre profil TikTok...', { navAttempts: navAttempts + 1 }, () => {
      window.location.href = target;
    });
    return false;
  }

  /**
   * Ouvre la modale "Abonnements" depuis la page profil.
   * Retourne 'opened', 'empty' (aucun abonnement restant) ou false.
   */
  async function openFollowingList(stillWanted, timeoutMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!stillWanted()) return false;
      if (isListOpen()) return 'opened';

      const count = document.querySelector('[data-e2e="following-count"]');
      if (count && normalizeLabel(count.textContent) === '0') return 'empty';

      const trigger = findFollowingTrigger();
      if (trigger) {
        await clickElement(trigger);
        const t = Date.now();
        while (Date.now() - t < 10000) {
          if (!stillWanted()) return false;
          await sleep(300);
          if (getScope().isModal) return 'opened';
        }
        // Une modale s'est ouverte mais ne contient aucun compte
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(isRendered);
        if (dialog) return 'empty';
      }
      await sleep(700);
    }
    return false;
  }

  function findFollowingTrigger() {
    const count = document.querySelector('[data-e2e="following-count"]');
    if (count && isRendered(count)) return count;

    // Repli : libellé "Abonnements" / "Following" à côté d'un nombre, hors navigation
    for (const el of document.querySelectorAll('strong, span, p, div')) {
      if (el.children.length > 0) continue;
      if (!OPEN_LIST_LABELS.has(normalizeLabel(el.textContent))) continue;
      if (el.closest('nav, [role="dialog"], [role="tablist"], [data-e2e^="nav"]')) continue;
      const parent = el.parentElement;
      if (parent && /\d/.test(parent.textContent || '') && isRendered(parent)) return parent;
    }
    return null;
  }

  /**
   * Boucle principale. `myRunId` empêche deux boucles de tourner en parallèle
   * (ex: Stop puis Lancer très vite).
   */
  async function runLoop(myRunId) {
    const active = () => isAlive() && state.isRunning && !state.isStopped && state.runId === myRunId;

    let emptyScrolls = 0;
    let consecutiveFailures = 0;

    while (active()) {
      if (state.isPaused) {
        await sleep(300);
        continue;
      }

      // Limite de sécurité par session (0 = illimité)
      if (state.settings.maxLimit > 0 && state.sessionCount >= state.settings.maxLimit) {
        await log(`🛑 Limite atteinte (${state.sessionCount} comptes cette session). Fin de session.`, 'success');
        await finishProcess();
        break;
      }

      if (detectRateLimit()) {
        await autoPause('🚫 TikTok signale une action trop fréquente. Pause automatique : attendez plusieurs heures avant de reprendre.');
        continue;
      }

      const scope = getScope();
      const target = findNextFollowingButton(scope);

      if (target) {
        emptyScrolls = 0;
        const username = extractUsernameNearButton(target);
        await log(`Désabonnement : ${username}...`, 'info');

        await clickElement(target);
        const result = await waitForUnfollow(target, active);
        if (!active()) break;

        if (result) {
          target.setAttribute('data-tau-done', 'true');
          consecutiveFailures = 0;
          state.count++;
          state.sessionCount++;
          state.sinceReload++;
          await safeStorageSet({ unfollowedCount: state.count, sessionCount: state.sessionCount });

          const delaySec = getRandomDelay(state.settings.minDelay, state.settings.maxDelay);
          await log(`✅ Désabonné de ${username} (#${state.count}). Attente ${delaySec.toFixed(1)}s`, 'success');

          const sleepOk = await sleepResponsive(delaySec * 1000, active);
          if (!sleepOk) break;

          const reloadEvery = state.settings.reloadEvery;
          const limitReached = state.settings.maxLimit > 0 && state.sessionCount >= state.settings.maxLimit;
          if (reloadEvery > 0 && state.sinceReload >= reloadEvery && !limitReached) {
            await reloadPage(`🔄 ${state.sinceReload} désabonnements sur cette page, rechargement de TikTok...`);
            return;
          }
        } else {
          // TikTok n'a pas réagi : on marque pour ne pas boucler dessus
          target.setAttribute('data-tau-failed', 'true');
          consecutiveFailures++;
          await log(`⚠️ ${username} : TikTok n'a pas confirmé le désabonnement (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}).`, 'warn');

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0;
            // Page TikTok "bloquée" : un rechargement suffit souvent. Si recharger
            // ne débloque rien, c'est une vraie limite de TikTok → pause.
            if (canReload()) {
              await reloadPage('🔄 TikTok ne réagit plus sur cette page, rechargement...');
              return;
            }
            await autoPause('🚫 TikTok ne répond plus aux clics (limite probable). Pause automatique : attendez avant de reprendre.');
            continue;
          }

          const sleepOk = await sleepResponsive(1500, active);
          if (!sleepOk) break;
        }
        continue;
      }

      // Aucun bouton visible : on fait défiler la liste
      if (!state.settings.autoScroll) {
        await log('Plus aucun compte visible. Fin du processus.', 'info');
        await finishProcess();
        break;
      }

      const grew = await scrollListAndWait(scope, active);
      if (!active()) break;

      if (grew) {
        emptyScrolls = 0;
      } else {
        emptyScrolls++;
        if (!scope.isModal && countListButtons(document) === 0) {
          await log('Veuillez ouvrir votre liste d’abonnements TikTok (Profil → Abonnements).', 'warn');
        } else {
          await log(`Chargement de la suite de la liste (${emptyScrolls}/${MAX_EMPTY_SCROLLS})...`, 'info');
        }

        if (emptyScrolls >= MAX_EMPTY_SCROLLS) {
          // La liste TikTok arrête souvent de charger après quelques dizaines de comptes
          if (scope.isModal && canReload()) {
            await reloadPage('🔄 La liste ne charge plus de comptes, rechargement de TikTok...');
            return;
          }
          await log('✅ Plus aucun compte à désabonner dans la liste.', 'success');
          await finishProcess();
          break;
        }
      }
    }
  }

  async function finishProcess() {
    state.isRunning = false;
    state.isPaused = false;
    keepTabAlive(false);
    await updateStorageState('DONE');
  }

  async function autoPause(message) {
    state.isPaused = true;
    await log(message, 'error');
    await updateStorageState('PAUSED');
  }

  // --- Détection dans la Modale TikTok ---

  function normalizeLabel(text) {
    return (text || '')
      .normalize('NFC')
      .replace(/[​-‍﻿]/g, '')
      .replace(/[’`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Renvoie 'following', 'follow', 'confirm' ou null selon le texte du bouton
   */
  function classify(el) {
    const label = normalizeLabel(el.innerText || el.textContent);
    if (!label || label.length > 30) return null;
    if (FOLLOWING_LABELS.has(label)) return 'following';
    if (FOLLOW_LABELS.has(label)) return 'follow';
    if (CONFIRM_LABELS.has(label)) return 'confirm';
    return null;
  }

  function isRendered(el) {
    return el.getClientRects().length > 0;
  }

  function isExcluded(el, strict) {
    if (el.closest('[role="tablist"], [role="tab"]')) return true;
    const aria = normalizeLabel(el.getAttribute('aria-label'));
    if (aria.includes('close') || aria.includes('fermer')) return true;
    // Hors modale, ne jamais toucher à la navigation / l'en-tête / des liens
    if (strict && el.closest('nav, header, a[href], [data-e2e^="nav"]')) return true;
    return false;
  }

  /**
   * Trouve la modale d'abonnements : un dialogue visible qui contient des
   * boutons de suivi. Sinon on se rabat sur la page entière (mode strict).
   */
  function getScope() {
    const modals = Array.from(document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], [class*="DivModalContainer"], [data-e2e*="follow"][data-e2e*="popup"]'
    )).filter(isRendered);

    // Le dernier dans l'ordre du document est le plus interne / au premier plan
    for (let i = modals.length - 1; i >= 0; i--) {
      if (countListButtons(modals[i]) > 0) {
        return { root: modals[i], isModal: true };
      }
    }
    return { root: document, isModal: false };
  }

  function queryClickables(root) {
    return root.querySelectorAll('button, [role="button"]');
  }

  function countListButtons(root) {
    let n = 0;
    for (const el of queryClickables(root)) {
      const kind = classify(el);
      if (kind === 'following' || kind === 'follow') n++;
    }
    return n;
  }

  function countFollowingButtons(root) {
    let n = 0;
    for (const el of queryClickables(root)) {
      if (classify(el) === 'following' && isRendered(el)) n++;
    }
    return n;
  }

  /**
   * Hors modale, on exige que le bouton soit dans une "ligne" contenant un
   * lien de profil /@pseudo (évite de cliquer n'importe où sur la page).
   */
  function looksLikeUserRow(el) {
    let row = el.parentElement;
    for (let i = 0; i < 6 && row && row !== document.body; i++) {
      const links = row.querySelectorAll('a[href*="/@"]');
      if (links.length > 0) {
        return links.length <= 2 && row.querySelectorAll('button, [role="button"]').length <= 3;
      }
      row = row.parentElement;
    }
    return false;
  }

  /**
   * Trouve le prochain bouton "Suivi(e)s" / "Following" à cliquer
   */
  function findNextFollowingButton(scope) {
    const strict = !scope.isModal;
    const selector = 'button:not([data-tau-done]):not([data-tau-failed]), [role="button"]:not([data-tau-done]):not([data-tau-failed])';

    for (const el of scope.root.querySelectorAll(selector)) {
      const kind = classify(el);
      if (kind === 'follow') {
        // Déjà désabonné : on ne le réexaminera plus (performance sur les grosses listes)
        el.setAttribute('data-tau-done', 'true');
        continue;
      }
      if (kind !== 'following') continue;
      if (!isRendered(el) || isExcluded(el, strict)) continue;
      if (strict && !looksLikeUserRow(el)) continue;
      return el;
    }

    // Repli : libellé dans un élément texte sans rôle de bouton (div cliquable)
    if (scope.isModal) {
      for (const el of scope.root.querySelectorAll('span, p, div')) {
        if (el.children.length > 0) continue;
        if (classify(el) !== 'following') continue;
        // Le clic sur l'élément texte remonte (bubbling) jusqu'au gestionnaire React du parent
        const target = el.closest('button, [role="button"]') || el;
        if (target.hasAttribute('data-tau-done') || target.hasAttribute('data-tau-failed')) continue;
        if (!isRendered(target) || isExcluded(target, false)) continue;
        return target;
      }
    }

    return null;
  }

  function clearFailedMarks() {
    document.querySelectorAll('[data-tau-failed]').forEach(el => el.removeAttribute('data-tau-failed'));
  }

  /**
   * Clic "humain" : séquence pointer/mouse complète au centre du bouton.
   * Couvre les composants React qui écoutent onPointerUp comme ceux sur onClick.
   */
  async function clickElement(el) {
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await sleep(150);

      const rect = el.getBoundingClientRect();
      const base = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0
      };
      const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      const PointerEvt = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;

      el.dispatchEvent(new PointerEvt('pointerover', pointer));
      el.dispatchEvent(new MouseEvent('mouseover', base));
      el.dispatchEvent(new PointerEvt('pointerdown', { ...pointer, buttons: 1 }));
      el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
      el.dispatchEvent(new PointerEvt('pointerup', pointer));
      el.dispatchEvent(new MouseEvent('mouseup', base));
      el.dispatchEvent(new MouseEvent('click', base));
      return true;
    } catch (err) {
      console.error('[TikTok-Unfollow] Erreur clic :', err);
      return false;
    }
  }

  /**
   * Attend que TikTok confirme le désabonnement : le bouton passe à
   * "Suivre"/"Follow" ou disparaît. Valide une popup de confirmation si besoin.
   */
  async function waitForUnfollow(el, active, timeoutMs = 3500) {
    const start = Date.now();
    let confirmed = false;

    while (Date.now() - start < timeoutMs) {
      if (!active()) return false;
      await sleep(150);

      if (!el.isConnected) return true;
      if (classify(el) === 'follow') return true;

      if (!confirmed && await handleConfirmationModal()) {
        confirmed = true;
      }
    }
    return false;
  }

  /**
   * Validation de confirmation si affichée ("Se désabonner de @pseudo ?")
   */
  async function handleConfirmationModal() {
    for (const btn of queryClickables(document)) {
      if (classify(btn) !== 'confirm' || !isRendered(btn)) continue;
      await log('Confirmation validée.', 'info');
      await clickElement(btn);
      await sleep(300);
      return true;
    }
    return false;
  }

  function detectRateLimit() {
    const nodes = document.querySelectorAll('[role="alert"], [aria-live], [class*="toast" i], [class*="Toast"]');
    for (const n of nodes) {
      if (!isRendered(n)) continue;
      const txt = n.innerText || n.textContent || '';
      if (txt.length < 200 && RATE_LIMIT_REGEX.test(txt)) return true;
    }
    return false;
  }

  // --- Défilement ---

  let cachedScroller = null;

  function isScrollable(el) {
    if (el.scrollHeight <= el.clientHeight + 10) return false;
    const oy = window.getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  /**
   * Trouve le conteneur scrollable de la liste en remontant depuis le dernier
   * bouton de la liste (bien plus rapide que de tester chaque div).
   */
  function findScrollContainer(scope) {
    if (cachedScroller && cachedScroller.isConnected && scope.root.contains(cachedScroller) && isScrollable(cachedScroller)) {
      return cachedScroller;
    }

    const listButtons = Array.from(queryClickables(scope.root)).filter(el => {
      const kind = classify(el);
      return kind === 'following' || kind === 'follow';
    });
    const anchor = listButtons[listButtons.length - 1];

    if (anchor) {
      let p = anchor.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        if (isScrollable(p)) {
          cachedScroller = p;
          return p;
        }
        if (p === scope.root) break;
        p = p.parentElement;
      }
    }

    if (scope.isModal) {
      let best = null;
      for (const c of scope.root.querySelectorAll('div, ul, section')) {
        if (c.clientHeight > 100 && isScrollable(c) && (!best || c.scrollHeight > best.scrollHeight)) {
          best = c;
        }
      }
      cachedScroller = best;
      return best;
    }

    // Hors modale uniquement : la page elle-même
    return anchor ? document.scrollingElement : null;
  }

  /**
   * Fait défiler jusqu'en bas et attend que TikTok charge de nouveaux comptes.
   * Retourne true si la liste a grandi ou si un nouveau bouton est apparu.
   */
  async function scrollListAndWait(scope, active) {
    const scroller = findScrollContainer(scope);
    if (!scroller) {
      await sleepResponsive(1500, active);
      return false;
    }

    const before = scroller.scrollHeight;
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));

    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (!active()) return false;
      await sleep(250);
      if (scroller.scrollHeight > before + 5) return true;
      if (findNextFollowingButton(getScope())) return true;
    }
    return false;
  }

  /**
   * Extrait le pseudo @ de la ligne du bouton
   */
  function extractUsernameNearButton(button) {
    try {
      let row = button.parentElement;
      for (let i = 0; i < 6 && row && row !== document.body; i++) {
        const link = row.querySelector('a[href*="/@"]');
        if (link) {
          const m = (link.getAttribute('href') || '').match(/@([a-zA-Z0-9._-]+)/);
          if (m && m[1]) return `@${m[1]}`;
        }
        row = row.parentElement;
      }
    } catch (_) {}
    return 'Compte';
  }

  function getRandomDelay(min, max) {
    const effectiveMin = Math.max(0.5, min);
    const effectiveMax = Math.max(effectiveMin, max);
    return effectiveMin + Math.random() * (effectiveMax - effectiveMin);
  }

  /**
   * Onglet en arrière-plan : Chrome bride fortement setTimeout (jusqu'à 1 fois
   * par minute). On délègue alors l'attente au service worker (background.js),
   * qui n'est pas bridé. Un setTimeout local sert de filet de sécurité.
   */
  function sleep(ms) {
    return new Promise(resolve => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      setTimeout(done, ms);

      if (document.hidden && ms > 0 && isAlive()) {
        try {
          chrome.runtime.sendMessage({ action: 'BG_SLEEP', ms }, () => {
            void chrome.runtime.lastError;
            done();
          });
        } catch (_) {}
      }
    });
  }

  // Empêche Chrome de décharger l'onglet pendant qu'il travaille en arrière-plan
  function keepTabAlive(keep) {
    if (!isAlive()) return;
    try {
      chrome.runtime.sendMessage({ action: 'KEEP_TAB', keep }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  }

  async function sleepResponsive(ms, active) {
    const step = 100;
    let elapsed = 0;

    while (elapsed < ms) {
      if (!active()) return false;

      while (state.isPaused) {
        if (!active()) return false;
        await sleep(200);
      }

      await sleep(step);
      elapsed += step;
    }

    return true;
  }

  // --- Stockage / Logs ---

  async function safeStorageSet(data) {
    if (!isAlive()) return;
    try {
      await chrome.storage.local.set(data);
    } catch (_) {}
  }

  // Les écritures de logs sont chaînées pour éviter d'en perdre (lecture/écriture concurrentes)
  let logQueue = Promise.resolve();

  function log(message, level = 'info') {
    const timeStr = new Date().toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const logItem = { text: `[${timeStr}] ${message}`, level };

    console.log(`[TikTok-Unfollow] ${message}`);

    logQueue = logQueue.then(async () => {
      if (!isAlive()) return;
      try {
        const data = await chrome.storage.local.get('logs');
        const logs = data.logs || [];
        logs.push(logItem);
        if (logs.length > 50) logs.splice(0, logs.length - 50);
        await chrome.storage.local.set({ logs });
      } catch (_) {}
    });
    return logQueue;
  }

  async function updateStorageState(statusState) {
    state.status = statusState;
    await safeStorageSet({
      isRunning: state.isRunning,
      isPaused: state.isPaused,
      statusState: statusState
    });
  }
})();
