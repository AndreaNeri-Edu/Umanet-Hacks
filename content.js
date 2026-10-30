// Umanet Hacks — content script
// I colori dei task completati seguono in automatico il data-theme del sito (vedi content.css).

/* ---------------------------------------------------------------
   Sfondo personalizzato (impostato dal popup)
   --------------------------------------------------------------- */
const BG_KEY = 'uhBackground';
let currentBackground = null;

function applyBackground() {
  const root = document.documentElement;
  let layer = document.getElementById('uh-bg');

  if (!currentBackground) {
    if (layer) layer.remove();
    root.classList.remove('uh-has-bg');
    return;
  }

  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'uh-bg';
    // Lo mettiamo su <html>, così resiste agli scambi di contenuto di HTMX nel <body>
    root.appendChild(layer);
  }

  const css = `url("${currentBackground}")`;
  if (layer.style.backgroundImage !== css) layer.style.backgroundImage = css;
  root.classList.add('uh-has-bg');
}

chrome.storage.local.get([BG_KEY], result => {
  currentBackground = result[BG_KEY] || null;
  applyBackground();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[BG_KEY]) return;
  currentBackground = changes[BG_KEY].newValue || null;
  applyBackground();
});

let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (currentBackground && !document.getElementById('uh-bg')) applyBackground();
  });
}).observe(document.body, { childList: true, subtree: true });

/* ---------------------------------------------------------------
   Mostra risposta (card domanda completata / verde)
   Nasconde l'anteprima grezza e aggiunge una freccetta che apre la
   risposta formattata (paragrafi, elenchi, grassetto, ecc.).
   --------------------------------------------------------------- */

// Converte il testo "grezzo" (markdown semplice) in HTML sicuro
function uhEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uhInline(raw) {
  let s = uhEscape(raw);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_(?![\w])/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

function uhMarkdownToHtml(src) {
  let text = (src || '').replace(/\r/g, '').replace(/\t/g, '    ').trim();

  // Se l'anteprima è stata "appiattita" (niente a capo), ricostruiamo gli elenchi
  if (!text.includes('\n')) {
    text = text.replace(/\s+([*•])\s+(?=\S)/g, '\n$1 ');
  }

  const lines = text.split('\n');
  const UL = /^(\s*)[*\-•+◦▪‣]\s+(.*)$/;
  const OL = /^(\s*)\d+[.)]\s+(.*)$/;
  const isItem = l => UL.test(l) || OL.test(l);

  const out = [];
  let para = [];
  const stack = []; // liste aperte: { type: 'ul'|'ol', indent: n }; l'ultimo <li> resta aperto

  const flushPara = () => {
    if (para.length) out.push(`<p>${uhInline(para.join(' '))}</p>`);
    para = [];
  };
  const closeTop = () => {
    const t = stack.pop();
    out.push(`</li></${t.type}>`);
  };
  const closeAll = () => { while (stack.length) closeTop(); };

  const addItem = (type, indent, content) => {
    const li = `<li>${uhInline(content)}`;
    if (!stack.length) {
      out.push(`<${type}>`, li);
      stack.push({ type, indent });
      return;
    }
    // Più rientrato → sottoelenco dentro l'<li> ancora aperto
    if (indent > stack[stack.length - 1].indent) {
      out.push(`<${type}>`, li);
      stack.push({ type, indent });
      return;
    }
    // Meno rientrato → risali fino al livello giusto
    while (stack.length > 1 && indent < stack[stack.length - 1].indent) closeTop();
    const top = stack[stack.length - 1];
    if (top.type === type) {
      out.push('</li>', li);
    } else {
      // stesso livello ma tipo diverso (es. da puntato a numerato)
      const lvl = top.indent;
      closeTop();
      out.push(`<${type}>`, li);
      stack.push({ type, indent: lvl });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (!line.trim()) {
      // una riga vuota tra due voci non spezza l'elenco
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (!(stack.length && j < lines.length && isItem(lines[j]))) {
        flushPara(); closeAll();
      }
    } else if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) {
      flushPara(); closeAll();
      const lvl = Math.min(m[1].length + 2, 6); // h3..h6: non esageriamo dentro la card
      out.push(`<h${lvl}>${uhInline(m[2])}</h${lvl}>`);
    } else if ((m = line.match(UL))) {
      flushPara();
      addItem('ul', m[1].length, m[2]);
    } else if ((m = line.match(OL))) {
      flushPara();
      addItem('ol', m[1].length, m[2]);
    } else {
      closeAll();
      para.push(line.trim());
    }
  }
  flushPara(); closeAll();
  return out.join('');
}

// ---- Risposte scritte con l'editor ricco (HTML) ----
const UH_ALLOWED = new Set(['P','BR','UL','OL','LI','STRONG','B','EM','I','U','S','STRIKE','A',
  'H1','H2','H3','H4','H5','H6','BLOCKQUOTE','CODE','PRE','TABLE','THEAD','TBODY','TR','TH','TD',
  'SUB','SUP','HR','IMG']);
const UH_DROP = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON',
  'TEXTAREA','SELECT','LINK','META','SVG','NOSCRIPT']);

// Tiene solo tag e attributi innocui; span/div (es. ck-list-bogus-paragraph) vengono "scartati"
function uhSanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const clean = node => {
    Array.from(node.childNodes).forEach(ch => {
      if (ch.nodeType === 3) return;
      if (ch.nodeType !== 1) { ch.remove(); return; }
      const tag = ch.tagName;
      if (UH_DROP.has(tag)) { ch.remove(); return; }
      clean(ch);
      if (!UH_ALLOWED.has(tag)) { ch.replaceWith(...Array.from(ch.childNodes)); return; }
      Array.from(ch.attributes).forEach(a => {
        const n = a.name.toLowerCase(), v = a.value.trim();
        if (tag === 'A' && n === 'href' && /^(https?:|mailto:|\/(?!\/))/i.test(v)) return;
        if (tag === 'IMG' && n === 'src' && /^(https?:\/\/|\/(?!\/))/i.test(v)) return;
        if (tag === 'IMG' && n === 'alt') return;
        if ((tag === 'TD' || tag === 'TH') && (n === 'colspan' || n === 'rowspan')) return;
        ch.removeAttribute(a.name);
      });
      if (tag === 'A') { ch.target = '_blank'; ch.rel = 'noopener noreferrer'; }
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

// HTML → sanitizzato; testo semplice → markdown
function uhRenderAnswer(raw) {
  const s = (raw || '').trim();
  if (/<\/?(p|ul|ol|li|br|strong|em|b|i|u|h[1-6]|div|span|table|blockquote)\b[^>]*>/i.test(s)) {
    return uhSanitizeHtml(s);
  }
  return uhMarkdownToHtml(s);
}

const uhNorm = t => (t || '').toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, '');
const uhAnswerCache = new Map();

// Legge la risposta vera dalla pagina della domanda (stessa origine, stessi cookie)
function uhFetchAnswer(url, previewText) {
  if (uhAnswerCache.has(url)) return uhAnswerCache.get(url);
  const p = (async () => {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    let raw = '';
    for (const ta of doc.querySelectorAll('textarea.django_ckeditor_5')) {
      if (ta.value.trim()) { raw = ta.value; break; }
    }
    if (!raw) { const c = doc.querySelector('.ck-content'); raw = c ? c.innerHTML : ''; }
    if (!raw.trim()) return null;
    // Sicurezza: usiamo il testo scaricato solo se è la stessa risposta dell'anteprima
    const tmp = document.createElement('div');
    tmp.innerHTML = uhRenderAnswer(raw);
    const head = uhNorm(previewText).slice(0, 25);
    return uhNorm(tmp.textContent).includes(head) ? raw : null;
  })().catch(() => null);
  uhAnswerCache.set(url, p);
  return p;
}

/* ----- Card della pagina "Frasi" / risposte -----
   Struttura del sito:
   <article class="card ...">
     <span class="badge badge-success" title="Risposta inserita">#1</span>   <- verde = completata
     <h3><a href="/courses/content/response/task/...">Domanda</a></h3>
     <div class="text-sm text-base-content/60">testo grezzo della risposta</div>
   </article>
   Le domande ancora da fare hanno badge-warning e un <p> con la scadenza (niente <div>). */
function uhSyncAnswerButtons() {
  document.querySelectorAll('article.card').forEach(card => {
    if (card.querySelector('.uh-toggle')) return;
    if (!card.querySelector('.badge-success')) return;                      // non verde
    if (!card.querySelector('a[href*="/courses/content/response"]')) return; // non è una domanda

    const preview = card.querySelector('div.text-sm:not(.uh-answer-full)');
    if (!preview || !preview.textContent.trim()) return;

    // 1) L'anteprima grezza di default sparisce sempre
    const previewText = preview.textContent;
    const html = uhRenderAnswer(previewText);
    const qLink = card.querySelector('a[href*="/courses/content/response"]');
    let upgrade = null;
    preview.classList.add('uh-preview-hidden');

    // 2) Freccetta + etichetta
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'uh-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML =
      '<svg class="uh-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
      '<span class="uh-toggle-label">Mostra risposta</span>';

    // 3) Pannello con la risposta formattata (animato in apertura/chiusura)
    const wrap = document.createElement('div');
    wrap.className = 'uh-answer-wrap';
    wrap.setAttribute('inert', '');
    const inner = document.createElement('div');
    inner.className = 'uh-answer-inner';
    const body = document.createElement('div');
    body.className = 'uh-answer-full prose max-w-none';
    body.innerHTML = html;
    inner.appendChild(body);
    wrap.appendChild(inner);

    // Appena passi sopra (o clicchi) scarica la versione vera della risposta e, se coincide, la sostituisce
    const startUpgrade = () => {
      if (upgrade || !qLink) return;
      upgrade = uhFetchAnswer(qLink.href, previewText).then(raw => {
        if (raw) body.innerHTML = uhRenderAnswer(raw);
      });
    };
    toggle.addEventListener('pointerenter', startUpgrade, { once: true });
    toggle.addEventListener('focus', startUpgrade, { once: true });

    toggle.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      startUpgrade();
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('.uh-toggle-label').textContent = open ? 'Nascondi risposta' : 'Mostra risposta';
      wrap.classList.toggle('is-open', open);
      if (open) wrap.removeAttribute('inert'); else wrap.setAttribute('inert', '');
    });

    preview.insertAdjacentElement('afterend', toggle);
    toggle.insertAdjacentElement('afterend', wrap);
  });
}

/* ---------------------------------------------------------------
   Apri risorse → tendina: "Apri risorse" (nuova scheda) / "Affianca"
   --------------------------------------------------------------- */
function uhEnhanceResourceButton() {
  document.querySelectorAll('a.btn').forEach(a => {
    if (a.dataset.uhRes) return;
    if (!/^Apri risors[ae]$/i.test(a.textContent.trim())) return;
    a.dataset.uhRes = '1';

    const href = a.href;

    const wrap = document.createElement('div');
    wrap.className = 'uh-res';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-outline btn-sm uh-res-toggle';
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML =
      '<span>Apri risorse</span>' +
      '<svg class="uh-res-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

    const menu = document.createElement('ul');
    menu.className = 'menu uh-res-menu rounded-box border border-base-300 bg-base-100 p-2 shadow-lg';
    menu.hidden = true;

    const liTab = document.createElement('li');
    const linkTab = document.createElement('a');
    linkTab.href = href;
    linkTab.target = '_blank';
    linkTab.rel = 'noopener noreferrer';
    linkTab.innerHTML = '<span class="uh-res-item"><strong>Apri risorse</strong><small>In una nuova scheda</small></span>';
    liTab.appendChild(linkTab);

    const liSplit = document.createElement('li');
    const btnSplit = document.createElement('button');
    btnSplit.type = 'button';
    btnSplit.innerHTML = '<span class="uh-res-item"><strong>Affianca a Umanet</strong><small>Umanet a sinistra, risorsa a destra</small></span>';
    liSplit.appendChild(btnSplit);

    menu.append(liTab, liSplit);
    wrap.append(toggle, menu);

    const setOpen = open => {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };

    toggle.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    linkTab.addEventListener('click', () => setOpen(false));

    btnSplit.addEventListener('click', () => {
      setOpen(false);
      const s = window.screen;
      const area = {
        left: s.availLeft || 0,
        top: s.availTop || 0,
        width: s.availWidth,
        height: s.availHeight
      };
      const fallback = () => window.open(href, '_blank', 'noopener');
      try {
        chrome.runtime.sendMessage({ type: 'uh-split', url: href, area }, res => {
          if (chrome.runtime.lastError || !res || !res.ok) fallback();
        });
      } catch (err) {
        fallback(); // estensione ricaricata mentre la pagina era aperta
      }
    });

    document.addEventListener('click', e => { if (!wrap.contains(e.target)) setOpen(false); });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') { setOpen(false); toggle.focus(); }
    });

    // Il bottone originale resta nel DOM ma nascosto
    a.classList.add('uh-hidden');
    a.insertAdjacentElement('beforebegin', wrap);
  });
}

uhEnhanceResourceButton();

uhSyncAnswerButtons();

// Aggiornamenti dinamici del sito (stesso schema di initTaskTracker)
let uhScheduled = false;
new MutationObserver(() => {
  if (uhScheduled) return;
  uhScheduled = true;
  requestAnimationFrame(() => {
    uhScheduled = false;
    uhSyncAnswerButtons();
    uhEnhanceResourceButton();
  });
}).observe(document.body, { childList: true, subtree: true });
