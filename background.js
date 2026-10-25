/**
 * ============================================================================
 * TikTok Auto Unfollow - background.js
 * Service worker : fournit des minuteries non bridées aux onglets TikTok en
 * arrière-plan et empêche Chrome de décharger l'onglet pendant le travail.
 * ============================================================================
 */

const MAX_SLEEP_MS = 20000; // reste sous la limite d'inactivité (30 s) du service worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message && message.action) {
    case 'BG_SLEEP': {
      const ms = Math.min(Math.max(0, Number(message.ms) || 0), MAX_SLEEP_MS);
      setTimeout(() => sendResponse({ ok: true }), ms);
      return true; // réponse asynchrone
    }

    case 'KEEP_TAB': {
      if (sender.tab && sender.tab.id !== undefined) {
        try {
          const p = chrome.tabs.update(sender.tab.id, { autoDiscardable: message.keep === false });
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) {}
      }
      sendResponse({ ok: true });
      return false;
    }

    default:
      return false;
  }
});
