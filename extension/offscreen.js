async function copyDataUrl(dataUrl) {
  const source = await fetch(dataUrl);
  const blob = await source.blob();
  const image = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'copy-image-to-clipboard') return;
  copyDataUrl(message.dataUrl).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message || 'Could not copy image' }));
  return true;
});
