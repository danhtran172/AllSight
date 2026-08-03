let draggedImageUrl = null;
let copyZone = null;
let saveZone = null;

function imageUrlFor(event) {
  const image = event.target.closest?.('img');
  return image?.currentSrc || image?.src || null;
}
function removeZones() {
  copyZone?.remove();
  saveZone?.remove();
  copyZone = null;
  saveZone = null;
  draggedImageUrl = null;
}
function dropUrl(event) { return draggedImageUrl || event.dataTransfer?.getData('text/uri-list'); }
function unsupported(url) { return !url || url.startsWith('blob:') || url.startsWith('data:'); }
function createZone(kind, icon, title, subtitle) {
  const zone = document.createElement('div');
  zone.id = `allsight-${kind}-zone`;
  zone.innerHTML = `<span>${icon}</span><strong>${title}</strong><small>${subtitle}</small>`;
  zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', async event => {
    event.preventDefault();
    const url = dropUrl(event);
    if (unsupported(url)) return showToast('Ảnh này không có URL web để xử lý.');
    zone.classList.add('is-saving');
    zone.querySelector('strong').textContent = kind === 'copy' ? 'Đang copy ảnh…' : 'Đang lưu vào AllSight…';
    const result = await chrome.runtime.sendMessage({ type: kind === 'copy' ? 'copy-image' : 'save-image', url });
    showToast(result.ok ? (kind === 'copy' ? 'Image Copied!' : 'Image Saved!') : result.error);
    removeZones();
  });
  return zone;
}
function showZones() {
  if (copyZone || saveZone) return;
  copyZone = createZone('copy', '⧉', 'Copy image', 'Clipboard');
  saveZone = createZone('save', '＋', 'Thả để lưu vào AllSight', 'Web Extention');
  document.documentElement.append(copyZone, saveZone);
}
function showToast(message) {
  const toast = document.createElement('div');
  toast.id = 'allsight-toast';
  toast.textContent = message;
  document.documentElement.append(toast);
  setTimeout(() => toast.remove(), 3500);
}

document.addEventListener('dragstart', event => {
  const url = imageUrlFor(event);
  if (!url) return;
  draggedImageUrl = url;
  showZones();
}, true);
document.addEventListener('dragend', removeZones, true);
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'web-extention-result') showToast(message.ok ? (message.action === 'copy-image-to-clipboard' ? 'Image Copied!' : 'Image Saved!') : message.error);
});
