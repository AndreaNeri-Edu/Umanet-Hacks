// Umanet Hacks — popup

const BG_KEY = 'uhBackground';
const MAX_SIDE = 1920;        // lato massimo dell'immagine salvata
const MAX_FILE_MB = 25;       // dimensione massima del file scelto

const preview = document.getElementById('preview');
const chooseBtn = document.getElementById('choose');
const removeBtn = document.getElementById('remove');
const fileInput = document.getElementById('file');
const statusEl = document.getElementById('status');

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function showPreview(dataUrl) {
  if (dataUrl) {
    preview.style.backgroundImage = `url("${dataUrl}")`;
    preview.classList.add('has-image');
    removeBtn.disabled = false;
    chooseBtn.textContent = 'Cambia immagine';
  } else {
    preview.style.backgroundImage = '';
    preview.classList.remove('has-image');
    removeBtn.disabled = true;
    chooseBtn.textContent = 'Carica immagine';
  }
}

// Ridimensiona e comprime l'immagine, così sta comodamente nello storage
function processImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/webp', 0.85));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Impossibile leggere l’immagine.'));
    };

    img.src = url;
  });
}

chooseBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = ''; // permette di scegliere di nuovo lo stesso file
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    setStatus('Scegli un file immagine.', true);
    return;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    setStatus(`L’immagine supera ${MAX_FILE_MB} MB.`, true);
    return;
  }

  setStatus('Carico l’immagine…');

  try {
    const dataUrl = await processImage(file);
    chrome.storage.local.set({ [BG_KEY]: dataUrl }, () => {
      if (chrome.runtime.lastError) {
        setStatus('Immagine troppo pesante, provane una più piccola.', true);
        return;
      }
      showPreview(dataUrl);
      setStatus('Sfondo impostato.');
    });
  } catch (err) {
    setStatus(err.message, true);
  }
});

removeBtn.addEventListener('click', () => {
  chrome.storage.local.remove(BG_KEY, () => {
    showPreview(null);
    setStatus('Sfondo rimosso.');
  });
});

chrome.storage.local.get([BG_KEY], result => {
  showPreview(result[BG_KEY] || null);
});