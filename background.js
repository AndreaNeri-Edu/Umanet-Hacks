// Umanet Hacks — service worker
// "Affianca": Umanet nella metà sinistra dello schermo, la risorsa in una finestra a destra.
// Quando si chiude la finestra della risorsa, Umanet torna com'era.

const STATE_KEY = 'uhSplit';

async function getState() {
  const r = await chrome.storage.session.get(STATE_KEY);
  return r[STATE_KEY] || null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'uh-split') return;
  openSplit(msg, sender).then(
    () => sendResponse({ ok: true }),
    err => sendResponse({ ok: false, error: String(err) })
  );
  return true; // risposta asincrona
});

async function openSplit({ url, area }, sender) {
  if (!/^https?:\/\//i.test(url)) throw new Error('URL non valido');
  const mainId = sender.tab.windowId;
  const st = await getState();

  // Se la finestra della risorsa è già aperta, la riusiamo
  if (st && st.resId) {
    try {
      const w = await chrome.windows.get(st.resId, { populate: true });
      await chrome.tabs.update(w.tabs[0].id, { url });
      await chrome.windows.update(st.resId, { focused: true });
      return;
    } catch (e) {
      // la finestra non esiste più: ripartiamo da zero
    }
  }

  const half = Math.floor(area.width / 2);
  const main = await chrome.windows.get(mainId);
  const orig = { left: main.left, top: main.top, width: main.width, height: main.height, state: main.state };

  if (main.state !== 'normal') await chrome.windows.update(mainId, { state: 'normal' });
  await chrome.windows.update(mainId, { left: area.left, top: area.top, width: half, height: area.height });

  const res = await chrome.windows.create({
    url,
    type: 'popup',
    left: area.left + half,
    top: area.top,
    width: area.width - half,
    height: area.height
  });

  await chrome.storage.session.set({ [STATE_KEY]: { mainId, resId: res.id, orig } });
}

// Chiusa la risorsa → Umanet torna alle dimensioni di prima
chrome.windows.onRemoved.addListener(async windowId => {
  const st = await getState();
  if (!st) return;

  if (windowId === st.mainId) {
    await chrome.storage.session.remove(STATE_KEY);
    return;
  }
  if (windowId !== st.resId) return;

  await chrome.storage.session.remove(STATE_KEY);
  try {
    const o = st.orig;
    if (o.state === 'maximized' || o.state === 'fullscreen') {
      await chrome.windows.update(st.mainId, { state: o.state });
    } else {
      await chrome.windows.update(st.mainId, { left: o.left, top: o.top, width: o.width, height: o.height });
    }
  } catch (e) {
    // la finestra principale non esiste più: niente da ripristinare
  }
});
