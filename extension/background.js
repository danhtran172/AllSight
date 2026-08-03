const BRIDGE_URL = 'http://127.0.0.1:41741/import';

async function ensureClipboardDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
  if (!contexts.length) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD'], justification: 'Copy a web image when the user drops it in the AllSight copy zone.' });
}
function bytesToDataUrl(bytes, mime) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 0x8000) binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
async function copyImage(url) {
  try {
    const response = await fetch(url);
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('The dropped item is not an image');
    await ensureClipboardDocument();
    const result = await chrome.runtime.sendMessage({ type: 'copy-image-to-clipboard', dataUrl: bytesToDataUrl(await response.arrayBuffer(), response.headers.get('content-type').split(';')[0]) });
    if (!result?.ok) throw new Error(result?.error || 'Could not copy image');
    return { ok: true };
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
  else if (message?.type === 'copy-image' && message.url) copyImage(message.url).then(sendResponse);
  else return false;
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'save-image-to-allsight', title: 'Save image to AllSight', contexts: ['image'] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'save-image-to-allsight') return;
  const result = await saveToAllSight(info.srcUrl);
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'allsight-result', ...result });
});
