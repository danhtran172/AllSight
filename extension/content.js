let draggedImageUrl = null;
let zone = null;

function imageUrlFor(event) {
  const image = event.target.closest?.('img');
  return image?.currentSrc || image?.src || null;
}
function removeZone() {
  zone?.remove();
  zone = null;
  draggedImageUrl = null;
}
function showZone() {
  if (zone) return;
  zone = document.createElement('div');
  zone.id = 'allsight-drop-zone';
  zone.innerHTML = '<span>＋</span><strong>Thả để lưu vào AllSight</strong><small>Web Imports</small>';
  zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', async event => {
    event.preventDefault();
    const url = draggedImageUrl || event.dataTransfer?.getData('text/uri-list');
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return showToast('Ảnh này không có URL web để lưu.');
    zone.classList.add('is-saving');
    zone.querySelector('strong').textContent = 'Đang lưu vào AllSight…';
    const result = await chrome.runtime.sendMessage({ type: 'save-image', url });
    showToast(result.ok ? `Đã lưu “${result.name}” vào AllSight` : result.error);
    removeZone();
  });
  document.documentElement.append(zone);
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
  showZone();
}, true);
document.addEventListener('dragend', removeZone, true);
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'allsight-result') showToast(message.ok ? `Đã lưu “${message.name}” vào AllSight` : message.error);
});
