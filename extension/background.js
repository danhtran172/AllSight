const BRIDGE_URL = 'http://127.0.0.1:41741/import';

function bytesToDataUrl(bytes, mime) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 0x8000) binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
async function fetchImageData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('The dropped item is not an image');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('Image is too large to copy');
    return { ok: true, dataUrl: bytesToDataUrl(bytes, response.headers.get('content-type').split(';')[0]) };
  } catch (error) { return { ok: false, error: error.message }; }
}

async function saveToAllSight(url) {
  try {
    const response = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'AllSight could not import this image');
    return { ok: true, name: result.asset.name };
  } catch (error) {
    return { ok: false, error: error.message.includes('fetch') ? 'Open the AllSight desktop app first.' : error.message };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'save-image' && message.url) saveToAllSight(message.url).then(sendResponse);
  else if (message?.type === 'get-image-data' && message.url) fetchImageData(message.url).then(sendResponse);
  else return false;
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'save-image-to-allsight', title: 'Save image to AllSight', contexts: ['image'] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'save-image-to-allsight') return;
  const result = await saveToAllSight(info.srcUrl);
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'web-extention-result', ...result });
});
