const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let store, allAssets = [], currentView = 'all', currentFilter = 'all', selectedId = null, selectedIds = new Set(), searchTerm = '', hoverTimer = null, hoverTargetId = null, dragId = null, dragGroupId = null, autoScrollFrame = null, autoScrollVelocity = 0, masonryFrame = null, tagManagerKind = 'theme', copiedTagGroup = null, lightboxAssets = [], lightboxIndex = -1, sourceRefreshTimer = null, sourceRefreshInProgress = false, ungroupedDuringDrag = false, discardOriginGalleryId = null, lockedGalleryId = null;
const unlockedGalleryIds = new Set();
const pendingSourcePaths = new Set();
const colors = ['#a78bfa','#f6a86f','#65c7c7','#e9cd63','#e98daa','#83b96b'];
const languages={vi:{allMedia:'Tất cả media',images:'Hình ảnh',videos:'Video',untagged:'Chưa gắn tag',manageTags:'Quản lý tag',language:'Ngôn ngữ',security:'Bảo mật ứng dụng',lock:'Khóa ứng dụng',addFolder:'Thêm thư mục',emptyTitle:'Không gian hình ảnh của bạn',emptyText:'Thêm một thư mục để bắt đầu sắp xếp ảnh và video theo cách của riêng bạn.',emptyAdd:'Thêm thư mục đầu tiên',search:'Tìm kiếm ảnh, tag, nhân vật...',library:'THƯ VIỆN',privateFolder:'GALLERY',source:'NGUỒN ẢNH'},en:{allMedia:'All media',images:'Images',videos:'Videos',untagged:'Untagged',manageTags:'Manage tags',language:'Language',security:'App security',lock:'Lock app',addFolder:'Add folder',emptyTitle:'Your visual space',emptyText:'Add a folder to start organizing your images and videos your way.',emptyAdd:'Add your first folder',search:'Search media, tags, characters...',library:'LIBRARY',privateFolder:'GALLERY',source:'MEDIA SOURCE'}};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
const escapeHTML = value => String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
const fileURL = p => `file:///${encodeURI(p.replace(/\\/g, '/'))}`;
const meta = id => (store.assetMeta[id] ||= { tags: [], persons: [], note: '', favorite: false, order: Date.now() });
const currentCollection = () => currentView.startsWith('collection:') ? store.collections.find(c => c.id === currentView.slice(11)) : null;
const currentSource = () => currentView.startsWith('source:') ? store.sources.find(s => s.id === currentView.slice(7)) : null;
const activeGroups = () => currentCollection()?.groups || store.libraryGroups;
const t = key => languages[store?.language || 'vi'][key] || key;
const selectedTargetIds = () => selectedIds.size ? [...selectedIds] : selectedId ? [selectedId] : [];
function unlockedGalleryAssetIds() { const ids=new Set();const extensionSource=store.sources.find(source=>source.id==='allsight-web-imports'||/^(web extention|web imports?)$/i.test(source.name||''));(extensionSource?.assets||[]).forEach(asset=>ids.add(asset.id));store.collections.filter(gallery=>!gallery.locked).forEach(gallery=>(gallery.items||[]).forEach(id=>{if(!(gallery.discardedIds||[]).includes(id))ids.add(id);}));return ids; }
function allTags() { return [...new Set(Object.values(store.assetMeta).flatMap(m => m.tags || []).concat(store.tagDefinitions?.map(t => t.name) || []))]; }
function tagDefinition(name) { return store.tagDefinitions.find(tag => tag.name === name) || { name, color:'#687384' }; }
function save() { return window.vision.writeStore(store); }
function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.remove('hidden'); clearTimeout(node.timer); node.timer = setTimeout(() => node.classList.add('hidden'), 2400); }

async function init() {
  store = await window.vision.readStore();
  store.sources ||= []; store.collections ||= []; store.discardedGalleries ||= []; store.assetMeta ||= {}; store.tagDefinitions ||= []; store.personDefinitions ||= []; store.libraryGroups ||= []; store.collections.forEach(collection=>{collection.defaultTags ||= [];collection.defaultPersons ||= [];collection.sourceIds ||= [];collection.discardedIds ||= [];});Object.entries(store.assetMeta).forEach(([id,item])=>{if(item.hidden){store.collections.filter(gallery=>gallery.items.includes(id)).forEach(gallery=>{if(!gallery.discardedIds.includes(id))gallery.discardedIds.push(id);});delete item.hidden;}}); store.language ||= 'vi'; store.sourcesCollapsed ||= false; store.zoom ||= 155; applyLanguage(); applyZoom();
  await collectAssets();
  syncGallerySourceAssets();
  await syncSourceWatchers();
  bindEvents();
  if (store.passwordHash && sessionStorage.getItem('master-vision-unlocked') !== store.passwordHash) showUnlock(); else render();
}
async function syncSourceWatchers() { await window.vision.watchSources(store.sources.map(source => source.path)); }
async function reloadImportedMedia() {
  const selected = selectedId;
  store = await window.vision.readStore();
  store.sources ||= []; store.collections ||= []; store.discardedGalleries ||= []; store.assetMeta ||= {}; store.tagDefinitions ||= []; store.personDefinitions ||= []; store.libraryGroups ||= []; store.collections.forEach(collection=>{collection.defaultTags ||= [];collection.defaultPersons ||= [];collection.sourceIds ||= [];collection.discardedIds ||= [];});
  await collectAssets();
  syncGallerySourceAssets();
  await syncSourceWatchers();
  if (selected && allAssets.some(asset => asset.id === selected)) selectedId = selected;
  render();
  toast('Image Saved!');
}
function scheduleSourceRefresh(folder) {
  if (!store.sources.some(source => source.path === folder)) return;
  pendingSourcePaths.add(folder);
  clearTimeout(sourceRefreshTimer);
  sourceRefreshTimer = setTimeout(flushSourceRefresh, 650);
}
async function flushSourceRefresh() {
  if (sourceRefreshInProgress) return;
  const paths = [...pendingSourcePaths];
  pendingSourcePaths.clear();
  if (!paths.length) return;
  sourceRefreshInProgress = true;
  try {
    await Promise.all(store.sources.filter(source => paths.includes(source.path)).map(async source => {
      source.assets = await window.vision.scanFolder(source.path);
    }));
    await collectAssets();
    syncGallerySourceAssets();
    const availableIds = new Set(allAssets.map(asset => asset.id));
    store.collections.forEach(collection => {
      collection.items = collection.items.filter(id => availableIds.has(id));
      (collection.groups || []).forEach(group => group.assets = group.assets.filter(id => availableIds.has(id)));
      collection.groups = (collection.groups || []).filter(group => group.assets.length);
    });
    store.libraryGroups = (store.libraryGroups || []).map(group => ({ ...group, assets: group.assets.filter(id => availableIds.has(id)) })).filter(group => group.assets.length);
    selectedIds = new Set([...selectedIds].filter(id => availableIds.has(id)));
    if (selectedId && !availableIds.has(selectedId)) selectedId = [...selectedIds][0] || null;
    await save();
    render();
    toast('Đã tự động cập nhật media');
  } finally {
    sourceRefreshInProgress = false;
    if (pendingSourcePaths.size) {
      clearTimeout(sourceRefreshTimer);
      sourceRefreshTimer = setTimeout(flushSourceRefresh, 650);
    }
  }
}
async function collectAssets() {
  allAssets = store.sources.flatMap(source => (source.assets || []).map(asset => ({ ...asset, sourceId: source.id })));
  allAssets.forEach(asset => meta(asset.id));
}
function syncGallerySourceAssets() {
  const availableIds=new Set(allAssets.map(asset=>asset.id));
  store.collections.forEach(gallery=>{
    gallery.sourceIds ||= [];
    const sourceAssetIds=allAssets.filter(asset=>gallery.sourceIds.includes(asset.sourceId)).map(asset=>asset.id);
    sourceAssetIds.forEach(id=>{(gallery.defaultTags||[]).forEach(tag=>{if(!meta(id).tags.includes(tag))meta(id).tags.push(tag);});(gallery.defaultPersons||[]).forEach(tag=>{if(!meta(id).persons.includes(tag))meta(id).persons.push(tag);});});
    gallery.items=[...new Set([...(gallery.items||[]).filter(id=>availableIds.has(id)),...sourceAssetIds])];
    (gallery.groups||[]).forEach(group=>group.assets=group.assets.filter(id=>gallery.items.includes(id)));
    gallery.groups=(gallery.groups||[]).filter(group=>group.assets.length);
  });
}
function visibleAssets() {
  let output = [...allAssets]; const collection = currentCollection(), source = currentSource();
  const galleryIds=unlockedGalleryAssetIds();
  output = output.filter(asset=>collection ? collection.items.includes(asset.id)&&!(collection.discardedIds||[]).includes(asset.id) : galleryIds.has(asset.id));
  if (source) output = output.filter(asset => asset.sourceId === source.id);
  if (currentView === 'images') output = output.filter(asset => asset.type === 'image');
  if (currentView === 'videos') output = output.filter(asset => asset.type === 'video');
  if (currentView === 'untagged') output = output.filter(asset => !meta(asset.id).tags.length && !meta(asset.id).persons.length);
  if (currentFilter === 'favorites') output = output.filter(asset => meta(asset.id).favorite);
  if (currentFilter === 'images') output = output.filter(asset => asset.type === 'image');
  if (currentFilter === 'videos') output = output.filter(asset => asset.type === 'video');
  const collectionGroups = collection?.groups || [];
  if (currentFilter === 'grouped') output = output.filter(asset => collectionGroups.some(group => group.assets.includes(asset.id)));
  const needle = searchTerm.trim().toLowerCase();
  if (needle) output = output.filter(asset => [asset.name, ...meta(asset.id).tags, ...meta(asset.id).persons].join(' ').toLowerCase().includes(needle));
  return output.sort((a,b) => (meta(b.id).order || b.modified) - (meta(a.id).order || a.modified));
}
function activeLabel() {
  if (currentView === 'tag-manager') return 'Manage tags';
  if (currentView === 'library-folders') return 'Library';
  if (currentView === 'settings') return 'Settings';
  if (currentView === 'discard-pile') return 'Discard Pile';
  if (currentView === 'locked-gallery') return 'Locked Gallery';
  if (currentCollection()) return currentCollection().name;
  if (currentSource()) return currentSource().name;
  return ({all:t('allMedia'), images:t('images'), videos:t('videos'), untagged:t('untagged')})[currentView] || t('library');
}
function applyLanguage() { document.documentElement.lang=store.language; $$('[data-i18n]').forEach(node=>node.textContent=t(node.dataset.i18n)); $('#searchInput').placeholder=t('search'); $('#viewOverline').textContent=t('library'); }
function applyZoom() { document.documentElement.style.setProperty('--thumb-height',`${store.zoom||155}px`); const label=$('#zoomValue');if(label)label.textContent=store.zoom||155; }
function updateSelectionUI() { const count=selectedIds.size, bulk=$('#bulkActions'), all=visibleAssets(); bulk.classList.toggle('hidden',count===0); $('#selectAll').textContent=count&&count===all.length?'☑':'□'; const group= count ? groupOf([...selectedIds][0]) : null; const sameGroup=group&&[...selectedIds].every(id=>group.assets.includes(id)); $('#dissolveGroup').classList.toggle('hidden',!sameGroup); }
function confirmAction(message) { return window.confirm(message); }
function render() {
  $('#viewTitle').textContent = activeLabel(); $('#viewOverline').textContent = currentView==='settings' ? 'SETTINGS' : currentCollection() ? t('privateFolder') : currentSource() ? t('source') : t('library');
  $('#editCollection').classList.toggle('hidden', !currentCollection());
  $('#assetCount').textContent = unlockedGalleryAssetIds().size;
  renderSidebars();
  if(currentView==='tag-manager'){ $('.toolbar').classList.add('hidden'); $('#inspector').classList.add('hidden'); renderTagScreen(); return; }
  if(currentView==='library-folders'){ $('.toolbar').classList.add('hidden'); $('#inspector').classList.add('hidden'); renderLibraryFolders(); return; }
  if(currentView==='settings'){ $('.toolbar').classList.add('hidden'); $('#inspector').classList.add('hidden'); renderSettings(); return; }
  if(currentView==='discard-pile'){ $('.toolbar').classList.add('hidden'); renderDiscardPile(); renderInspector(); return; }
  if(currentView==='locked-gallery'){ $('.toolbar').classList.add('hidden'); $('#inspector').classList.add('hidden'); renderLockedGallery(); return; }
  $('.toolbar').classList.remove('hidden'); renderCanvas(); renderInspector();
}
function openGallery(galleryId) {
  const gallery=store.collections.find(item=>item.id===galleryId);
  if(!gallery)return;
  if(gallery.locked&&!unlockedGalleryIds.has(gallery.id)){lockedGalleryId=gallery.id;currentView='locked-gallery';selectedId=null;selectedIds.clear();render();return;}
  currentView=`collection:${gallery.id}`;selectedId=null;selectedIds.clear();render();
}
function requestGalleryPassword(gallery, action) {
  if(!store.passwordHash)return toast('Set an app password before locking a Gallery');
  openModal(`<h2>Locked Gallery</h2><p>Enter the app password for “${escapeHTML(gallery.name)}”.</p><input id="galleryUnlockInput" type="password" autofocus placeholder="Password"><div class="modal-footer"><button class="secondary-button" data-close>Cancel</button><button id="galleryUnlockButton" class="primary-button">Continue</button></div>`);
  const input=$('#galleryUnlockInput'),verify=async()=>{if(await hash(input.value)===store.passwordHash){closeModal();action();}else{input.select();input.focus();toast('Incorrect password');}};
  $('#galleryUnlockButton').onclick=verify;input.onkeydown=event=>{if(event.key==='Enter')verify();};requestAnimationFrame(()=>input.focus());
}
function showGalleryUnlock(gallery) { requestGalleryPassword(gallery,()=>{unlockedGalleryIds.add(gallery.id);openGallery(gallery.id);}); }
function renderSidebars() {
  $$('.nav-item[data-view]').forEach(node => node.classList.toggle('active', node.dataset.view === currentView));
  $('#manageTags').classList.toggle('active',currentView==='tag-manager');
  $('#collectionsList').innerHTML = store.collections.map(collection => {const cover=allAssets.find(asset=>asset.id===(collection.coverId||collection.items[0]));return `<button class="collection-item ${currentView === 'collection:'+collection.id ? 'active':''}" data-collection="${collection.id}">${collection.locked?'<span class="gallery-icon">🔒</span>':cover&&cover.type==='image'?`<img class="folder-cover-mini" src="${fileURL(cover.path)}">`:'<span class="gallery-icon">▧</span>'}<span class="item-text">${escapeHTML(collection.name)}</span><span class="collection-count">${collection.items.length}</span></button>`;}).join('') || '<p class="side-empty">Create your first Gallery</p>';
  $$('.collection-item').forEach(button => {button.addEventListener('click', () => openGallery(button.dataset.collection));button.addEventListener('contextmenu',event=>{event.preventDefault();openFolderContextMenu(event,button.dataset.collection);});});
}
function renderSettings() {
  const canvas=$('#canvas'),empty=$('#emptyState');empty.classList.add('hidden');canvas.className='settings-screen';canvas.classList.remove('hidden');
  const discardedCount=store.collections.reduce((count,gallery)=>count+(gallery.discardedIds||[]).length,0)+(store.discardedGalleries||[]).length;
  canvas.innerHTML=`<h2>Settings</h2><p>Manage access and language for this InDeck library.</p><div class="settings-list"><article class="settings-card"><div><h3>Password</h3><p>${store.passwordHash?'A password is configured for this app.':'Protect this app with a password.'}</p></div><button id="settingsPassword" class="secondary-button">${store.passwordHash?'Change password':'Set password'}</button></article><article class="settings-card"><div><h3>Lock app</h3><p>Hide all InDeck media until the password is entered.</p></div><button id="settingsLock" class="secondary-button" ${store.passwordHash?'':'disabled'}>Lock app</button></article><article class="settings-card"><div><h3>Discard Pile</h3><p>${discardedCount} discarded Gallery item${discardedCount===1?'':'s'}.</p></div><button id="settingsDiscardPile" class="secondary-button">Open</button></article><article class="settings-card"><div><h3>Language</h3><p>${store.language==='vi'?'Tiếng Việt':'English'}</p></div><button id="settingsLanguage" class="secondary-button">Change language</button></article></div>`;
  $('#settingsPassword').onclick=openPasswordModal;
  $('#settingsLock').onclick=lockApp;
  $('#settingsDiscardPile').onclick=()=>{currentView='discard-pile';selectedId=null;selectedIds.clear();render();};
  $('#settingsLanguage').onclick=openLanguageModal;
}
function renderLockedGallery() {
  const canvas=$('#canvas'),empty=$('#emptyState'),gallery=store.collections.find(item=>item.id===lockedGalleryId);empty.classList.add('hidden');canvas.className='locked-gallery-screen';canvas.classList.remove('hidden');
  canvas.innerHTML=`<div class="gallery-lock-card"><div class="gallery-lock-icon">🔒</div><h2>Unlock to view contents</h2><p>${gallery?escapeHTML(gallery.name):'Locked Gallery'}</p><input id="lockedGalleryPassword" type="password" autofocus placeholder="Enter Password"><small id="lockedGalleryError"></small></div>`;
  const input=$('#lockedGalleryPassword'),unlock=async()=>{if(!gallery)return;if(await hash(input.value)===store.passwordHash){unlockedGalleryIds.add(gallery.id);lockedGalleryId=null;openGallery(gallery.id);}else{$('#lockedGalleryError').textContent='Incorrect password';input.select();input.focus();}};
  input.onkeydown=event=>{if(event.key==='Enter')unlock();};requestAnimationFrame(()=>input.focus());
}
function discardEntries() { return store.collections.flatMap(gallery=>(gallery.discardedIds||[]).map(assetId=>({gallery,asset:allAssets.find(asset=>asset.id===assetId)})).filter(entry=>entry.asset)); }
async function restoreDiscardedGallery(galleryId) { const gallery=(store.discardedGalleries||[]).find(item=>item.id===galleryId);if(!gallery)return;store.collections.push(gallery);store.discardedGalleries=store.discardedGalleries.filter(item=>item.id!==galleryId);await save();render(); }
async function permanentlyDeleteDiscardedGallery(galleryId) { const gallery=(store.discardedGalleries||[]).find(item=>item.id===galleryId);if(!gallery||!confirmAction(`Permanently delete Gallery “${gallery.name}” from Discard Pile? Media files will be kept.`))return;store.discardedGalleries=store.discardedGalleries.filter(item=>item.id!==galleryId);await save();render(); }
async function restoreDiscardEntry(gallery,assetId) { gallery.discardedIds=(gallery.discardedIds||[]).filter(id=>id!==assetId);await save();selectedId=null;selectedIds.clear();discardOriginGalleryId=null;render(); }
async function permanentlyDeleteDiscardEntry(gallery,assetId) { const asset=allAssets.find(item=>item.id===assetId);if(!asset||!confirmAction(`Permanently delete “${asset.name}” from disk? This cannot be undone.`))return;const removed=await window.vision.permanentDelete(asset.path);if(!removed)return toast('Unable to permanently delete this file');for(const source of store.sources)source.assets=await window.vision.scanFolder(source.path);await collectAssets();[...store.collections,...(store.discardedGalleries||[])].forEach(item=>{item.items=(item.items||[]).filter(id=>id!==assetId);item.discardedIds=(item.discardedIds||[]).filter(id=>id!==assetId);item.groups=(item.groups||[]).map(group=>({...group,assets:group.assets.filter(id=>id!==assetId)})).filter(group=>group.assets.length);});await save();selectedId=null;selectedIds.clear();discardOriginGalleryId=null;render(); }
function renderDiscardPile() {
  const canvas=$('#canvas'),empty=$('#emptyState'),entries=discardEntries(),galleries=store.discardedGalleries||[];empty.classList.add('hidden');canvas.className='discard-pile';canvas.classList.remove('hidden');
  const galleryCards=galleries.map(gallery=>`<article class="discard-card discard-gallery-card" data-discard-gallery-record="${gallery.id}"><div class="discard-preview discard-gallery-preview">▧</div><div class="discard-meta"><b>Gallery: ${escapeHTML(gallery.name)}</b><small>${(gallery.items||[]).length} media</small><div><button data-discard-gallery-restore>Restore Gallery</button><button data-discard-gallery-delete class="context-danger">Permanent Delete</button></div></div></article>`).join('');
  const mediaCards=entries.map(({gallery,asset})=>`<article class="discard-card" data-discard-asset="${asset.id}" data-discard-gallery="${gallery.id}"><div class="discard-preview">${asset.type==='image'?`<img src="${fileURL(asset.path)}">`:`<video src="${fileURL(asset.path)}"></video>`}</div><div class="discard-meta"><b>${escapeHTML(asset.name)}</b><small>Gallery: ${escapeHTML(gallery.name)}</small><div><button data-discard-restore>Restore</button><button data-discard-delete class="context-danger">Permanent Delete</button></div></div></article>`).join('');
  canvas.innerHTML=galleryCards||mediaCards?galleryCards+mediaCards:'<div class="canvas-empty">Discard Pile is empty.</div>';
  $$('[data-discard-asset]').forEach(card=>card.onclick=()=>{selectedId=card.dataset.discardAsset;selectedIds=new Set([selectedId]);discardOriginGalleryId=card.dataset.discardGallery;$('#inspector').classList.remove('hidden');renderInspector();});
  $$('[data-discard-restore]').forEach(button=>button.onclick=event=>{event.stopPropagation();const card=button.closest('[data-discard-asset]'),gallery=store.collections.find(item=>item.id===card.dataset.discardGallery);restoreDiscardEntry(gallery,card.dataset.discardAsset);});
  $$('[data-discard-delete]').forEach(button=>button.onclick=event=>{event.stopPropagation();const card=button.closest('[data-discard-asset]'),gallery=store.collections.find(item=>item.id===card.dataset.discardGallery);permanentlyDeleteDiscardEntry(gallery,card.dataset.discardAsset);});
  $$('[data-discard-gallery-restore]').forEach(button=>button.onclick=event=>{event.stopPropagation();restoreDiscardedGallery(button.closest('[data-discard-gallery-record]').dataset.discardGalleryRecord);});
  $$('[data-discard-gallery-delete]').forEach(button=>button.onclick=event=>{event.stopPropagation();permanentlyDeleteDiscardedGallery(button.closest('[data-discard-gallery-record]').dataset.discardGalleryRecord);});
}
function renderTagScreen() {
  const canvas=$('#canvas'), empty=$('#emptyState'), isTheme=tagManagerKind==='theme', field=isTheme?'tags':'persons', definitions=isTheme?store.tagDefinitions:store.personDefinitions;
  empty.classList.add('hidden'); canvas.className='tag-screen'; canvas.classList.remove('hidden');
  const groups={};definitions.forEach(definition=>{const letter=(definition.name[0]||'#').toUpperCase();(groups[letter]||=[]).push(definition);});
  canvas.innerHTML=`<aside class="tag-screen-tabs"><button data-screen-kind="theme" class="${isTheme?'active':''}">Theme <span>${store.tagDefinitions.length}</span></button><button data-screen-kind="character" class="${!isTheme?'active':''}">Character <span>${store.personDefinitions.length}</span></button></aside><section class="tag-screen-main"><div class="tag-screen-title"><div><p class="eyebrow">PROPERTY</p><h2>${isTheme?'Theme':'Character'}</h2></div><div class="new-tag-row"><input id="screenNewTag" placeholder="Create ${isTheme?'Theme':'Character'}"><button id="screenCreateTag" class="primary-button">Create</button></div></div><div class="tag-directory">${Object.keys(groups).sort().map(letter=>`<section><h3>${letter}</h3>${groups[letter].sort((a,b)=>a.name.localeCompare(b.name)).map(definition=>`<div class="tag-directory-row"><input class="tag-name-input" data-edit-name="${escapeHTML(definition.name)}" value="${escapeHTML(definition.name)}"><span>${allAssets.filter(asset=>meta(asset.id)[field].includes(definition.name)).length} media</span><button data-delete-definition="${escapeHTML(definition.name)}">×</button></div>`).join('')}</section>`).join('')||'<div class="tag-directory-empty">No values yet. Create your first one above.</div>'}</div></section>`;
  $$('[data-screen-kind]').forEach(button=>button.onclick=()=>{tagManagerKind=button.dataset.screenKind;renderTagScreen();});
  $('#screenCreateTag').onclick=async()=>{const name=$('#screenNewTag').value.trim();if(!name||definitions.some(item=>item.name.toLowerCase()===name.toLowerCase()))return;definitions.push({name});await save();renderTagScreen();};
  $$('[data-delete-definition]').forEach(button=>button.onclick=async()=>{const name=button.dataset.deleteDefinition;if(!confirmAction(`Xóa tag “${name}”?`))return;const index=definitions.findIndex(item=>item.name===name);if(index>=0)definitions.splice(index,1);replacePropertyEverywhere(field,name,null);await save();renderTagScreen();});
  $$('[data-edit-name]').forEach(input=>input.onchange=async()=>{const old=input.dataset.editName,next=input.value.trim();if(!next||old===next)return;const definition=definitions.find(item=>item.name===old);if(definition)definition.name=next;replacePropertyEverywhere(field,old,next);await save();renderTagScreen();});
}
function renderLibraryFolders() { const canvas=$('#canvas'),empty=$('#emptyState');empty.classList.add('hidden');canvas.className='folder-gallery';canvas.classList.remove('hidden');canvas.innerHTML=store.collections.map(collection=>{const cover=allAssets.find(asset=>asset.id===(collection.coverId||collection.items[0]));return `<button class="folder-gallery-card" data-library-folder="${collection.id}">${collection.locked?'<span>🔒</span>':cover&&cover.type==='image'?`<img src="${fileURL(cover.path)}">`:'<span>▧</span>'}<div><b>${collection.locked?'🔒 ':''}${escapeHTML(collection.name)}</b><small>${collection.items.length} media</small></div></button>`;}).join('')||'<div class="canvas-empty">No Galleries yet.</div>';$$('[data-library-folder]').forEach(button=>{button.onclick=()=>openGallery(button.dataset.libraryFolder);button.oncontextmenu=event=>{event.preventDefault();openFolderContextMenu(event,button.dataset.libraryFolder);};}); }
function cardHTML(asset, groupCard = false) {
  const isVideo = asset.type === 'video';
  return `<article class="asset-card ${groupCard ? 'group-card':''} ${selectedIds.has(asset.id) ? 'selected':''}" draggable="true" data-id="${asset.id}" ${groupCard ? '' : `data-layout-key="asset:${asset.id}"`}>${isVideo ? `<video src="${fileURL(asset.path)}" muted preload="metadata"></video>` : `<img src="${fileURL(asset.path)}" loading="lazy" alt="${escapeHTML(asset.name)}" />`}${isVideo ? '<span class="type-badge video-badge" title="Video">▷</span>' : ''}${meta(asset.id).favorite ? '<span class="fav-badge">★</span>' : ''}</article>`;
}
function renderCanvas() {
  const assets = visibleAssets(), canvas = $('#canvas'), empty = $('#emptyState');
  canvas.className='asset-canvas';
  empty.classList.toggle('hidden', allAssets.length > 0); canvas.classList.toggle('hidden', allAssets.length === 0);
  if (!allAssets.length) return;
  const groups=activeGroups(), visibleIds=new Set(assets.map(asset=>asset.id)), grouped=new Set(groups.flatMap(group=>group.assets));
  const groupColumns=Math.max(1,Math.floor((canvas.clientWidth-85)/168));
  const layout=[...groups.map(group=>({kind:'group',group,members:group.assets.map(id=>allAssets.find(asset=>asset.id===id)).filter(asset=>asset&&visibleIds.has(asset.id)),rank:group.order||0})).filter(item=>item.members.length),...assets.filter(asset=>!grouped.has(asset.id)).map(asset=>({kind:'asset',asset,rank:meta(asset.id).order||asset.modified}))].sort((a,b)=>b.rank-a.rank);
  let html=layout.map(item=>item.kind==='asset' ? cardHTML(item.asset) : `<section class="group-shell ${item.group.collapsed?'collapsed':''}" style="--group-rows:${Math.ceil(item.members.length/groupColumns)}" data-group="${item.group.id}" data-layout-key="group:${item.group.id}"><button class="group-drag-handle" draggable="true" title="Kéo cả nhóm">⠿</button><div class="group-members">${(item.group.collapsed?item.members.filter(asset=>asset.id===(item.group.coverId||item.members[0]?.id)):item.members).map(asset=>cardHTML(asset,true)).join('')}</div><span class="group-count">${item.members.length}</span></section>`).join('');
  if (!html) html = '<div class="canvas-empty">Không có media phù hợp với bộ lọc này.</div>';
  canvas.innerHTML = html;
  $$('.group-shell.collapsed').forEach(group=>{group.draggable=true;});
  canvas.addEventListener('dragover',event=>{if(event.target===canvas&&dragId&&groupOf(dragId)){event.preventDefault();scheduleUngroup(dragId,null);}});
  $$('.asset-card').forEach(card => {
    card.addEventListener('click', event => { event.stopPropagation(); discardOriginGalleryId=null; const id=card.dataset.id; if(event.ctrlKey||event.metaKey){selectedIds.has(id)?selectedIds.delete(id):selectedIds.add(id);}else {selectedIds=new Set([id]);} selectedId=selectedIds.has(id)?id:[...selectedIds].at(-1)||null; $$('.asset-card').forEach(item=>item.classList.toggle('selected',selectedIds.has(item.dataset.id))); $('#inspector').classList.toggle('hidden',selectedIds.size!==1); updateSelectionUI(); renderInspector(); });
    card.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); openLightbox(card.dataset.id); });
    card.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); const id=card.dataset.id;if(!selectedIds.has(id)){selectedIds=new Set([id]);selectedId=id;$$('.asset-card').forEach(item=>item.classList.toggle('selected',item.dataset.id===id));renderInspector();updateSelectionUI();}openContextMenu(event,id); });
    card.addEventListener('dragstart', event => { dragGroupId=null; dragId = card.dataset.id; card.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); clearHover(); stopAutoScroll(); dragId = null; dragGroupId=null; if(ungroupedDuringDrag){ungroupedDuringDrag=false;render();} });
    card.addEventListener('dragenter', event => { if ((!dragId&&!dragGroupId) || dragId === card.dataset.id) return; event.preventDefault(); });
    card.addEventListener('dragover', event => { event.preventDefault(); const collapsedGroup=card.closest('.group-shell.collapsed'); if (!card.classList.contains('group-card') || collapsedGroup) dragGroupId ? setGroupDropTarget(card,event) : setDropTarget(card,event); });
    card.addEventListener('dragleave', event => { if (!card.contains(event.relatedTarget)) { clearHover(); clearDropMarkers(); } });
    card.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); const intent=card.dataset.dropIntent,collapsedGroup=card.closest('.group-shell.collapsed'); clearHover(); clearDropMarkers(); if (dragGroupId && collapsedGroup) { if (dragGroupId !== collapsedGroup.dataset.group) return reorderLayout(`group:${dragGroupId}`,`group:${collapsedGroup.dataset.group}`,intent === 'after'||intent === 'below'); return; } if (dragGroupId && !card.classList.contains('group-card')) return reorderLayout(`group:${dragGroupId}`,`asset:${card.dataset.id}`,intent === 'after'||intent === 'below'); if (!dragId || dragId === card.dataset.id) return; if (card.classList.contains('group-card')) addToGroup(dragId,card.closest('.group-shell').dataset.group); else if (intent === 'group') createGroup(dragId,card.dataset.id); else reorder(dragId,card.dataset.id,intent === 'after'); });
  });
  $$('.group-shell').forEach(group => {
    group.addEventListener('dragover', event => { event.preventDefault(); group.classList.add('drag-over'); });
    group.addEventListener('dragleave', () => group.classList.remove('drag-over'));
    group.addEventListener('drop', event => { event.preventDefault(); group.classList.remove('drag-over'); if(dragId)addToGroup(dragId, group.dataset.group); });
    group.addEventListener('contextmenu',event=>{if(event.target.closest('.asset-card')&&!group.classList.contains('collapsed'))return;event.preventDefault();openGroupContextMenu(event,group.dataset.group);});
  });
  $$('.group-shell.collapsed').forEach(group=>{
    group.addEventListener('dragstart',event=>{event.stopPropagation();dragId=null;dragGroupId=group.dataset.group;group.classList.add('dragging');event.dataTransfer.effectAllowed='move';},true);
    group.addEventListener('dragend',event=>{event.stopPropagation();group.classList.remove('dragging');dragGroupId=null;clearDropMarkers();stopAutoScroll();},true);
  });
  $$('.group-drag-handle').forEach(handle=>{handle.addEventListener('dragstart',event=>{dragId=null;dragGroupId=handle.closest('.group-shell').dataset.group;handle.closest('.group-shell').classList.add('dragging');event.dataTransfer.effectAllowed='move';});handle.addEventListener('dragend',()=>{handle.closest('.group-shell').classList.remove('dragging');dragGroupId=null;clearDropMarkers();stopAutoScroll();});});
  $$('.asset-card img,.asset-card video').forEach(media=>{media.addEventListener('load',scheduleMasonry);media.addEventListener('loadedmetadata',scheduleMasonry);}); scheduleMasonry();
  enableMarqueeSelection(canvas);
  updateSelectionUI();
}
function scheduleMasonry() { if(masonryFrame)return; masonryFrame=requestAnimationFrame(()=>{masonryFrame=null;const row=8,gap=15;$$('.asset-canvas > .asset-card,.asset-canvas > .group-shell').forEach(item=>item.style.setProperty('--masonry-span',Math.max(1,Math.ceil((item.getBoundingClientRect().height+gap)/(row+gap)))));}); }
function enableMarqueeSelection(canvas) { canvas.onpointerdown=event=>{if(event.button!==0||event.target!==canvas)return;const origin={x:event.clientX,y:event.clientY};const box=document.createElement('div');box.className='selection-marquee';document.body.append(box);const update=move=>{const left=Math.min(origin.x,move.clientX),top=Math.min(origin.y,move.clientY),right=Math.max(origin.x,move.clientX),bottom=Math.max(origin.y,move.clientY);Object.assign(box.style,{left:`${left}px`,top:`${top}px`,width:`${right-left}px`,height:`${bottom-top}px`});selectedIds=new Set($$('.asset-card').filter(card=>{const r=card.getBoundingClientRect();return r.left<right&&r.right>left&&r.top<bottom&&r.bottom>top;}).map(card=>card.dataset.id));selectedId=[...selectedIds].at(-1)||null;$$('.asset-card').forEach(card=>card.classList.toggle('selected',selectedIds.has(card.dataset.id)));};const end=()=>{box.remove();window.removeEventListener('pointermove',update);window.removeEventListener('pointerup',end);$('#inspector').classList.toggle('hidden',selectedIds.size!==1);updateSelectionUI();renderInspector();};window.addEventListener('pointermove',update);window.addEventListener('pointerup',end,{once:true});}; }
function updateAutoScroll(event) { const content=$('#content'), rect=content.getBoundingClientRect(), edge=92; const topDistance=event.clientY-rect.top, bottomDistance=rect.bottom-event.clientY; if(topDistance<edge)autoScrollVelocity=-Math.max(4,Math.round((edge-topDistance)/edge*22)); else if(bottomDistance<edge)autoScrollVelocity=Math.max(4,Math.round((edge-bottomDistance)/edge*22)); else { stopAutoScroll(); return; } if(autoScrollFrame)return; const step=()=>{const before=content.scrollTop;content.scrollTop+=autoScrollVelocity;if(content.scrollTop===before){stopAutoScroll();return;}autoScrollFrame=requestAnimationFrame(step);};autoScrollFrame=requestAnimationFrame(step); }
function stopAutoScroll() { autoScrollVelocity=0;if(autoScrollFrame){cancelAnimationFrame(autoScrollFrame);autoScrollFrame=null;} }
function clearHover() { clearTimeout(hoverTimer); hoverTimer = null; hoverTargetId = null; document.body.classList.remove('drag-holding'); $$('.hold-progress').forEach(item=>item.remove()); $$('.asset-card').forEach(card => card.classList.remove('group-target','ungroup-target')); }
function clearDropMarkers() { $$('.asset-card').forEach(card => { card.classList.remove('drop-before','drop-after','drop-above','drop-below'); delete card.dataset.dropIntent; }); }
function setGroupDropTarget(card,event) { clearDropMarkers(); const rect=card.getBoundingClientRect(); const x=(event.clientX-rect.left)/rect.width, y=(event.clientY-rect.top)/rect.height; let intent='before'; if(y<.24)intent='above'; else if(y>.76)intent='below'; else if(x>.5)intent='after'; card.classList.add({before:'drop-before',after:'drop-after',above:'drop-above',below:'drop-below'}[intent]); card.dataset.dropIntent=intent; }
function setDropTarget(card,event) { clearDropMarkers(); const rect=card.getBoundingClientRect(),localX=event.clientX-rect.left,localY=event.clientY-rect.top; const center=localX>20&&localX<rect.width-20&&localY>20&&localY<rect.height-20; if (center) { card.dataset.dropIntent='group'; card.classList.add('group-target'); scheduleGrouping(dragId,card.dataset.id); return; } const after=localX>rect.width/2; card.classList.add(after?'drop-after':'drop-before'); card.dataset.dropIntent=after?'after':'before'; if(groupOf(dragId))scheduleUngroup(dragId,card.dataset.id);else clearHover(); }
function scheduleGrouping(first, second) {
  if (dragGroupId || (hoverTimer && hoverTargetId === second)) return;
  clearHover(); hoverTargetId=second;
  const target = $(`.asset-card[data-id="${second}"]`); target?.classList.add('group-target');target?.insertAdjacentHTML('beforeend','<span class="hold-progress"></span>');
  const deadline=performance.now()+3000; document.body.classList.add('drag-holding'); hoverTimer=setTimeout(()=>{if(performance.now()>=deadline)createGroup(first,second);clearHover();},Math.max(0,deadline-performance.now()));
}
async function createGroup(first, second) {
  const groups=activeGroups(); if (first === second) return;
  const existing = groups.find(group => group.assets.includes(first) || group.assets.includes(second));
  if (existing) { [first,second].forEach(id => { if (!existing.assets.includes(id)) existing.assets.push(id); }); }
  else groups.push({ id:uid(), title:'Nhóm mới', assets:[first,second], order:Math.max(meta(first).order||0,meta(second).order||0) });
  await save(); toast('Đã tạo nhóm ảnh'); render();
}
async function addToGroup(assetId, groupId) {
  const groups=activeGroups(), group = groups.find(item => item.id === groupId); if (!assetId || !group) return;
  groups.forEach(item => item.assets = item.assets.filter(id => id !== assetId)); if (!group.assets.includes(assetId)) group.assets.push(assetId);
  await save(); toast('Đã thêm vào nhóm'); render();
}
function groupOf(assetId) { return activeGroups().find(group=>group.assets.includes(assetId)); }
function scheduleUngroup(assetId,targetId) { clearHover();if(!groupOf(assetId))return;removeFromGroup(assetId,targetId,true); }
async function removeFromGroup(assetId,targetId,deferRender=false) { const group=groupOf(assetId);if(!group)return;group.assets=group.assets.filter(id=>id!==assetId);if(!group.assets.length){const groups=activeGroups(),index=groups.indexOf(group);groups.splice(index,1);}if(targetId)meta(assetId).order=(meta(targetId).order||Date.now())+.5;else meta(assetId).order=Math.min(...visibleAssets().map(asset=>meta(asset.id).order||asset.modified),Date.now())-1;if(deferRender)ungroupedDuringDrag=true;await save();if(deferRender)return;toast('Đã tách ảnh khỏi nhóm');render(); }
async function removeFromGroupAfterCurrent(assetId) { const group=groupOf(assetId);if(!group)return;group.assets=group.assets.filter(id=>id!==assetId);if(!group.assets.length)activeGroups().splice(activeGroups().indexOf(group),1);meta(assetId).order=(group.order||Date.now())-.1;await save();toast('Đã tách ảnh khỏi nhóm');render(); }
async function createSingleGroup(assetId) { if(groupOf(assetId))return;activeGroups().push({id:uid(),title:'',assets:[assetId],order:meta(assetId).order||Date.now()});await save();render(); }
async function duplicateAsset(assetId) { const asset=allAssets.find(item=>item.id===assetId),source=store.sources.find(item=>item.id===asset?.sourceId);if(!asset||!source)return;const copy={...asset,id:uid(),name:`${asset.name} (copy)`};source.assets.push(copy);store.assetMeta[copy.id]=JSON.parse(JSON.stringify(meta(assetId)));store.assetMeta[copy.id].order=(meta(assetId).order||Date.now())-.01;await save();await collectAssets();render(); }
async function reorder(moved, target, after=false) { return reorderLayout(`asset:${moved}`,`asset:${target}`,after); }
async function reorderLayout(moved,target,after=false) { const keys=$$('[data-layout-key]').map(node=>node.dataset.layoutKey); const oldIndex=keys.indexOf(moved), targetIndex=keys.indexOf(target); if(oldIndex<0||targetIndex<0)return; keys.splice(oldIndex,1); keys.splice(keys.indexOf(target)+(after?1:0),0,moved); const baseline=Date.now(); keys.forEach((key,index)=>{const [kind,id]=key.split(':');if(kind==='asset')meta(id).order=baseline-index;else {const group=activeGroups().find(item=>item.id===id);if(group)group.order=baseline-index;}}); clearDropMarkers(); await save(); renderCanvas(); }
function openLightbox(id) { lightboxAssets=visibleAssets(); lightboxIndex=lightboxAssets.findIndex(asset=>asset.id===id); if(lightboxIndex<0)return; renderLightbox(); $('#lightbox').classList.remove('hidden'); }
function renderLightbox() { const asset=lightboxAssets[lightboxIndex]; if(!asset)return; $('#lightboxIndex').textContent=`${lightboxIndex+1} / ${lightboxAssets.length}`; $('#lightboxName').textContent=asset.name; $('#lightboxMedia').innerHTML=asset.type==='image' ? `<img src="${fileURL(asset.path)}" alt="${escapeHTML(asset.name)}">` : `<video src="${fileURL(asset.path)}" controls autoplay></video>`; $('#previousAsset').disabled=lightboxIndex===0; $('#nextAsset').disabled=lightboxIndex===lightboxAssets.length-1; }
function moveLightbox(step) { const next=lightboxIndex+step; if(next<0||next>=lightboxAssets.length)return; lightboxIndex=next; renderLightbox(); }
function closeLightbox() { $('#lightboxMedia').innerHTML=''; $('#lightbox').classList.add('hidden'); lightboxAssets=[]; lightboxIndex=-1; }
function renderInspector() {
  if (selectedIds.size > 1) { $('#inspector').classList.add('hidden'); return; }
  const asset = allAssets.find(item => item.id === selectedId), gallery = currentCollection();
  $('#inspectorOverline').textContent = gallery && !asset ? 'GALLERY' : 'CHI TIẾT';
  $('#inspectorTitle').textContent = gallery && !asset ? 'Gallery details' : 'Đối tượng đã chọn';
  $('#galleryInspector').classList.toggle('hidden', !(gallery && !asset));
  $('#inspectorEmpty').classList.toggle('hidden', !!asset || !!gallery); $('#inspectorBody').classList.toggle('hidden', !asset);
  if (gallery && !asset) return renderGalleryInspector(gallery);
  if (!asset) return;
  const item = meta(asset.id), parentSource=store.sources.find(source=>source.id===asset.sourceId); $('#detailName').textContent = asset.name; $('#detailPath').textContent = parentSource?.name||'Library'; $('#sourceFolderInfo').innerHTML = parentSource?`<strong>${escapeHTML(parentSource.name)}</strong><small>${escapeHTML(parentSource.path)}</small>`:'<span class="muted-small">No source folder</span>'; $('#previewWrap').innerHTML = asset.type === 'image' ? `<img src="${fileURL(asset.path)}">` : `<video src="${fileURL(asset.path)}" controls></video>`;
  $('#favoriteToggle').checked = !!item.favorite; pills('#tagPills',item.tags,'tags'); pills('#personPills',item.persons,'persons'); $('#assetNote').value = item.note || '';
  const memberships=store.collections.filter(collection=>collection.items.includes(asset.id)); $('#folderMembership').innerHTML=memberships.map(collection=>`<span class="pill"><span class="gallery-icon">▧</span>${escapeHTML(collection.name)}<button data-remove-folder="${collection.id}">×</button></span>`).join('') || '<span class="muted-small">Chưa thuộc Gallery nào</span>';
  const discardOrigin=store.collections.find(gallery=>gallery.id===discardOriginGalleryId);$('#discardOriginSection').classList.toggle('hidden',!discardOrigin);$('#discardOriginInfo').textContent=discardOrigin?discardOrigin.name:'';
  $('#removeFromCollection').classList.toggle('hidden', !currentCollection());
}
function renderGalleryInspector(gallery) {
  $('#inspector').classList.remove('hidden');
  $('#galleryNameInput').value = gallery.name || '';
  const autoTags = (selector, values, empty) => $(selector).innerHTML = values.length ? values.map(value => `<span class="pill">${escapeHTML(value)}</span>`).join('') : `<span class="muted-small">${empty}</span>`;
  autoTags('#galleryThemeTags', gallery.defaultTags || [], 'No Theme auto tags');
  autoTags('#galleryCharacterTags', gallery.defaultPersons || [], 'No Character auto tags');
  const sourceCounts=new Map();(gallery.items||[]).filter(id=>!(gallery.discardedIds||[]).includes(id)).forEach(id=>{const asset=allAssets.find(item=>item.id===id),source=asset&&store.sources.find(item=>item.id===asset.sourceId);const name=source&&(gallery.sourceIds||[]).includes(source.id)?source.name:'Khác';sourceCounts.set(name,(sourceCounts.get(name)||0)+1);});$('#galleryMediaSources').innerHTML=sourceCounts.size?[...sourceCounts].map(([name,count])=>`<div class="gallery-source-row"><span>${escapeHTML(name)}</span><b>${count}</b></div>`).join(''):'<span class="muted-small">No media</span>';
  $('#saveGalleryName').onclick = async () => {
    const name = $('#galleryNameInput').value.trim();
    if (!name) return toast('Gallery needs a name');
    gallery.name = name;
    await save();
    renderSidebars();
    toast('Gallery updated');
  };
  $$('[data-gallery-auto-kind]').forEach(button=>button.onclick=()=>openGalleryAutoTagPicker(gallery,button.dataset.galleryAutoKind));
}
function openGalleryAutoTagPicker(gallery, initialField='tags') {
  const fields={tags:{title:'Theme auto tags',definitions:store.tagDefinitions},persons:{title:'Character auto tags',definitions:store.personDefinitions}};
  openModal(`<h2>Gallery auto tags</h2><p>Choose from the existing tag groups. These tags are applied when media is added to this Gallery.</p><div class="property-tabs"><button data-gallery-tag-field="tags" class="${initialField==='tags'?'selected':''}">Theme</button><button data-gallery-tag-field="persons" class="${initialField==='persons'?'selected':''}">Character</button></div><div id="galleryAutoTagValues"></div><div class="modal-footer"><button class="secondary-button" data-close>Close</button></div>`);
  const renderValues=field=>{
    const config=fields[field],selected=field==='tags'?(gallery.defaultTags||[]):(gallery.defaultPersons||[]);
    $('#galleryAutoTagValues').innerHTML=config.definitions.length?config.definitions.map(definition=>`<button class="bulk-tag-value ${selected.includes(definition.name)?'selected':''}" data-gallery-auto-value="${escapeHTML(definition.name)}">${selected.includes(definition.name)?'✓ ':'＋ '}${escapeHTML(definition.name)}</button>`).join(''):'<p class="muted-small">No existing values in this tag group.</p>';
    $$('[data-gallery-auto-value]').forEach(button=>button.onclick=async()=>{const value=button.dataset.galleryAutoValue,key=field==='tags'?'defaultTags':'defaultPersons';gallery[key] ||= [];gallery[key]=gallery[key].includes(value)?gallery[key].filter(item=>item!==value):[...gallery[key],value];await save();renderValues(field);if(currentCollection()?.id===gallery.id)renderGalleryInspector(gallery);});
  };
  renderValues(initialField);
  $$('[data-gallery-tag-field]').forEach(button=>button.onclick=()=>{const field=button.dataset.galleryTagField;$$('[data-gallery-tag-field]').forEach(item=>item.classList.toggle('selected',item===button));renderValues(field);});
}
function pills(selector, values, field) { $(selector).innerHTML = values.map(value => `<span class="pill">${escapeHTML(value)}<button data-pill-field="${field}" data-pill-value="${escapeHTML(value)}">×</button></span>`).join(''); }
async function addValue(input, field) { const value = input.value.trim(),ids=selectedTargetIds(); if (!value || !ids.length) return; ids.forEach(id=>{const list=meta(id)[field];if(!list.some(item=>item.toLowerCase()===value.toLowerCase()))list.push(value);}); const definitions=field==='tags'?store.tagDefinitions:store.personDefinitions; if (!definitions.some(tag => tag.name.toLowerCase() === value.toLowerCase())) definitions.push({ name:value }); input.value=''; await save(); renderInspector(); }
async function removeValue(field,value) { selectedTargetIds().forEach(id=>{const data=meta(id);data[field]=data[field].filter(item=>item!==value);}); await save(); renderInspector(); }
async function addSource() {
  const folder = await window.vision.pickFolder(); if (!folder) return; if (store.sources.some(source => source.path === folder)) return toast('Thư mục này đã được thêm');
  toast('Đang đọc media trong thư mục…'); const assets = await window.vision.scanFolder(folder); store.sources.push({id:uid(),path:folder,name:folder.split(/\\|\//).pop(),assets}); await collectAssets(); await syncSourceWatchers(); await save(); render(); toast(`Đã thêm ${assets.length} media`);
}
async function refreshSources() { toast('Đang quét lại các nguồn…'); for (const source of store.sources) source.assets = await window.vision.scanFolder(source.path); await collectAssets(); syncGallerySourceAssets(); await save(); render(); toast('Thư viện đã được cập nhật'); }
async function removeSource(id) { const source=store.sources.find(item=>item.id===id); if (!source || !confirm(`Xóa nguồn “${source.name}” khỏi Master Vision? File gốc vẫn được giữ nguyên.`)) return; store.sources=store.sources.filter(item=>item.id!==id); store.collections.forEach(collection=>{collection.items=collection.items.filter(assetId=>allAssets.some(asset=>asset.id===assetId && asset.sourceId!==id));collection.sourceIds=(collection.sourceIds||[]).filter(sourceId=>sourceId!==id);}); if(currentView===`source:${id}`) currentView='all'; await collectAssets(); await syncSourceWatchers(); await save(); render(); }
function openCollectionModal(collection) {
  const title = collection ? 'Edit Gallery' : 'Create Gallery',data=collection || {name:'',note:'',defaultTags:[],defaultPersons:[],sourceIds:[],color:colors[0]},selectedSourceIds=new Set(data.sourceIds||[]);
  openModal(`<h2>${title}</h2><p>A Gallery organizes media without moving the original files on your computer.</p><label>Gallery name</label><input id="collectionName" value="${escapeHTML(data.name)}" placeholder="Example: Summer moodboard"><label>Notes</label><textarea id="collectionNote" placeholder="Description or ideas">${escapeHTML(data.note)}</textarea><label>Media sources</label><div id="collectionSources" class="collection-source-list"></div><button id="addCollectionSource" class="secondary-button">＋ Add source folder</button><label>Theme auto tag <small>(comma separated)</small></label><input id="collectionTags" value="${escapeHTML(data.defaultTags.join(', '))}" placeholder="portrait, light, campaign"><label>Character auto tag <small>(comma separated)</small></label><input id="collectionPersons" value="${escapeHTML((data.defaultPersons||[]).join(', '))}" placeholder="person, character"><label>Màu nhận diện</label><div class="color-row">${colors.map(color=>`<button class="color-pick ${data.color===color?'selected':''}" data-color="${color}" style="background:${color}"></button>`).join('')}</div><div class="modal-footer"><button class="secondary-button" data-close>Hủy</button><button class="primary-button" id="saveCollection">${collection?'Save changes':'Create Gallery'}</button></div>`);
  const renderSources=()=>{$('#collectionSources').innerHTML=selectedSourceIds.size?[...selectedSourceIds].map(id=>{const source=store.sources.find(item=>item.id===id);return source?`<div class="folder-choice"><span>${escapeHTML(source.name)}</span><small>${(source.assets||[]).length} media</small><button type="button" data-remove-gallery-source="${source.id}">×</button></div>`:'';}).join(''):'<span class="muted-small">No source folders selected.</span>';$$('[data-remove-gallery-source]').forEach(button=>button.onclick=()=>{selectedSourceIds.delete(button.dataset.removeGallerySource);renderSources();});};
  renderSources();
  $('#addCollectionSource').onclick=async()=>{const folder=await window.vision.pickFolder();if(!folder)return;let source=store.sources.find(item=>item.path===folder);if(!source){const assets=await window.vision.scanFolder(folder);source={id:uid(),path:folder,name:folder.split(/\\|\//).pop(),assets};store.sources.push(source);await collectAssets();await syncSourceWatchers();}selectedSourceIds.add(source.id);renderSources();};
  let picked=data.color; $$('.color-pick').forEach(button=>button.addEventListener('click',()=>{$$('.color-pick.selected')?.classList.remove('selected');button.classList.add('selected');picked=button.dataset.color;}));
  $('#saveCollection').addEventListener('click',async()=>{const sourceIds=[...selectedSourceIds];let name=$('#collectionName').value.trim();if(!name)name=sourceIds.length===1?store.sources.find(source=>source.id===sourceIds[0])?.name||'Untitled Gallery':'Untitled Gallery';const details={name,note:$('#collectionNote').value.trim(),defaultTags:$('#collectionTags').value.split(',').map(x=>x.trim()).filter(Boolean),defaultPersons:$('#collectionPersons').value.split(',').map(x=>x.trim()).filter(Boolean),sourceIds,color:picked};if(collection){const removed=(collection.sourceIds||[]).filter(id=>!sourceIds.includes(id));if(removed.length){collection.items=collection.items.filter(id=>!removed.includes(allAssets.find(asset=>asset.id===id)?.sourceId));collection.groups=(collection.groups||[]).map(group=>({...group,assets:group.assets.filter(id=>collection.items.includes(id))})).filter(group=>group.assets.length);}Object.assign(collection,details);}else{const fresh={id:uid(),items:[],groups:[],discardedIds:[],...details};store.collections.push(fresh);currentView=`collection:${fresh.id}`;}syncGallerySourceAssets();await save();closeModal();render();});
}
function addSelectedToCollection() { if (!selectedId) return toast('Hãy chọn một media trước'); if (!store.collections.length) return openCollectionModal(); const choices=store.collections.map(c=>`<option value="${c.id}">${escapeHTML(c.name)}</option>`).join(''); openModal(`<h2>Add to Gallery</h2><p>Gallery auto tags will be assigned to this media.</p><select id="targetCollection">${choices}</select><div class="modal-footer"><button class="secondary-button" data-close>Hủy</button><button class="primary-button" id="confirmAdd">Add</button></div>`); $('#confirmAdd').addEventListener('click',async()=>{const c=store.collections.find(x=>x.id===$('#targetCollection').value);if(!c.items.includes(selectedId))c.items.push(selectedId);c.defaultTags.forEach(tag=>{if(!meta(selectedId).tags.includes(tag))meta(selectedId).tags.push(tag)});(c.defaultPersons||[]).forEach(tag=>{if(!meta(selectedId).persons.includes(tag))meta(selectedId).persons.push(tag)});await save();closeModal();toast('Added to Gallery');render();}); }
function openBulkFolderPicker() { const ids=[...selectedIds];if(!ids.length)return;if(!store.collections.length)return openCollectionModal();openModal(`<h2>Add ${ids.length} images to Gallery</h2><select id="bulkTargetFolder">${store.collections.map(collection=>`<option value="${collection.id}">${escapeHTML(collection.name)}</option>`).join('')}</select><div class="modal-footer"><button data-close class="secondary-button">Hủy</button><button id="bulkFolderSave" class="primary-button">Add</button></div>`);$('#bulkFolderSave').onclick=async()=>{const collection=store.collections.find(item=>item.id===$('#bulkTargetFolder').value);ids.forEach(id=>{if(!collection.items.includes(id))collection.items.push(id);collection.defaultTags.forEach(tag=>{if(!meta(id).tags.includes(tag))meta(id).tags.push(tag);});(collection.defaultPersons||[]).forEach(tag=>{if(!meta(id).persons.includes(tag))meta(id).persons.push(tag);});});const group=groupOf(ids[0]);if(group&&ids.every(id=>group.assets.includes(id))&&!collection.groups.some(item=>item.id===group.id))collection.groups.push({...group,assets:[...ids]});await save();closeModal();render();}; }
async function bulkCreateGroup() { const ids=[...selectedIds];if(!ids.length)return;const groups=activeGroups();if(!confirmAction(`Tạo nhóm với ${ids.length} ảnh đã chọn?`))return;groups.push({id:uid(),title:'',assets:ids,order:Math.max(...ids.map(id=>meta(id).order||0))});await save();render(); }
async function discardAssets(ids) { const galleries=currentCollection()?[currentCollection()]:store.collections.filter(gallery=>!gallery.locked);ids.forEach(id=>galleries.filter(gallery=>gallery.items.includes(id)).forEach(gallery=>{gallery.discardedIds ||= [];if(!gallery.discardedIds.includes(id))gallery.discardedIds.push(id);}));await save();selectedId=null;selectedIds.clear();render(); }
async function removeSelectedFromGroup() { const ids=[...selectedIds],group=ids.length?groupOf(ids[0]):null;if(!group||!ids.every(id=>group.assets.includes(id)))return;if(!confirmAction(`Remove ${ids.length} image(s) from this group?`))return;group.assets=group.assets.filter(id=>!ids.includes(id));if(!group.assets.length)activeGroups().splice(activeGroups().indexOf(group),1);ids.forEach((id,index)=>meta(id).order=(group.order||Date.now())-(index*.01));await save();render(); }
function openBulkTagPicker() { const ids=[...selectedIds];if(!ids.length)return;openModal(`<h2>Thêm tag cho ${ids.length} ảnh</h2><div class="property-tabs"><button data-bulk-tag-kind="tags" class="selected">Theme</button><button data-bulk-tag-kind="persons">Character</button></div><div id="bulkTagValues"></div><div class="modal-footer"><button data-close class="secondary-button">Đóng</button></div>`);const renderValues=field=>{$('#bulkTagValues').innerHTML=(field==='tags'?store.tagDefinitions:store.personDefinitions).map(definition=>`<button class="bulk-tag-value" data-bulk-tag-value="${escapeHTML(definition.name)}">＋ ${escapeHTML(definition.name)}</button>`).join('')||'<p class="muted-small">Chưa có tag</p>';$$('[data-bulk-tag-value]').forEach(button=>button.onclick=async()=>{ids.forEach(id=>{if(!meta(id)[field].includes(button.dataset.bulkTagValue))meta(id)[field].push(button.dataset.bulkTagValue);});await save();closeModal();renderInspector();});};renderValues('tags');$$('[data-bulk-tag-kind]').forEach(button=>button.onclick=()=>{ $$('[data-bulk-tag-kind]').forEach(item=>item.classList.toggle('selected',item===button));renderValues(button.dataset.bulkTagKind);}); }
async function dissolveSelectedGroup() { const ids=[...selectedIds],group=ids.length&&groupOf(ids[0]);if(!group||!ids.every(id=>group.assets.includes(id)))return;if(!confirmAction('Rã nhóm này?'))return;activeGroups().splice(activeGroups().indexOf(group),1);await save();render(); }
function removeCollectionTags(assetId, collection) { const item=meta(assetId); const placedElsewhere=store.collections.some(other=>other.id!==collection.id && other.items.includes(assetId)); if (!placedElsewhere) { item.tags=item.tags.filter(tag=>!collection.defaultTags.includes(tag)); item.persons=item.persons.filter(tag=>!(collection.defaultPersons||[]).includes(tag)); } }
async function removeFromCollection() {const collection=currentCollection(),ids=selectedTargetIds();if(!collection||!ids.length)return; collection.items=collection.items.filter(id=>!ids.includes(id));collection.groups.forEach(group=>group.assets=group.assets.filter(id=>!ids.includes(id)));ids.forEach(id=>removeCollectionTags(id,collection));await save();selectedId=null;selectedIds.clear();toast('Đã gỡ khỏi thư mục');render();}
async function toggleAssetFolder(collectionId,checked) { const collection=store.collections.find(item=>item.id===collectionId),ids=selectedTargetIds();if(!collection||!ids.length)return;ids.forEach(id=>{if(checked){if(!collection.items.includes(id))collection.items.push(id);collection.defaultTags.forEach(tag=>{if(!meta(id).tags.includes(tag))meta(id).tags.push(tag);});(collection.defaultPersons||[]).forEach(tag=>{if(!meta(id).persons.includes(tag))meta(id).persons.push(tag);});}else{collection.items=collection.items.filter(item=>item!==id);collection.groups.forEach(group=>group.assets=group.assets.filter(item=>item!==id));removeCollectionTags(id,collection);}});await save();renderInspector();renderSidebars(); }
function openContextMenu(event,assetId) {
  const menu=$('#contextMenu'),asset=allAssets.find(item=>item.id===assetId),group=groupOf(assetId),collection=currentCollection(),ids=selectedTargetIds();
  if(!asset)return;
  menu.style.left=`${Math.min(event.clientX,window.innerWidth-245)}px`;menu.style.top=`${Math.min(event.clientY,window.innerHeight-250)}px`;menu.classList.remove('hidden');
  if(ids.length>=2) {
    const sharedGroup=groupOf(ids[0]),allInSharedGroup=sharedGroup&&ids.every(id=>sharedGroup.assets.includes(id)),allUngrouped=ids.every(id=>!groupOf(id));
    menu.innerHTML=`${allInSharedGroup||allUngrouped?`<button data-context-bulk-group>${allInSharedGroup?'Remove from group':'Create group'}</button>`:''}<button data-context-bulk-hide>Hide image</button><button data-context-bulk-gallery>Add to Gallery</button><button data-context-bulk-tag>Add tag</button>`;
    menu.querySelector('[data-context-bulk-group]')?.addEventListener('click',()=>{closeContextMenu();if(allInSharedGroup)removeSelectedFromGroup();else bulkCreateGroup();});
    menu.querySelector('[data-context-bulk-hide]').onclick=async()=>{if(!confirmAction(`Move ${ids.length} selected images to Discard Pile?`))return;closeContextMenu();await discardAssets(ids);};
    menu.querySelector('[data-context-bulk-gallery]').onclick=()=>{closeContextMenu();openBulkFolderPicker();};
    menu.querySelector('[data-context-bulk-tag]').onclick=()=>{closeContextMenu();openBulkTagPicker();};
    return;
  }
  const galleryItems=store.collections.map(gallery=>`<button data-context-gallery="${gallery.id}">${gallery.items.includes(assetId)?'✓ ':''}${escapeHTML(gallery.name)}</button>`).join('')||'<span class="context-empty">Create a Gallery first</span>';
  const paste=copiedTagGroup?`<button data-context-paste>Paste ${copiedTagGroup.kind}</button>`:'';
  menu.innerHTML=`<button data-context-open>Open</button><button data-context-show-folder>Open in Folder</button><button data-context-copy ${asset.type!=='image'?'disabled':''}>Copy image to clipboard</button><button data-context-copy-theme>Copy Theme</button><button data-context-copy-character>Copy Character</button>${paste}<div class="context-divider"></div>${group?'<button data-context-remove-group>Remove image from group</button>':'<button data-context-create-group>Create group with this image</button>'}<button data-context-duplicate>Duplicate image</button><button data-context-hide>Hide image</button>${collection?'<button data-context-cover>Set as Gallery cover</button>':''}<div class="context-divider"></div><div class="context-label">Add to Gallery</div>${galleryItems}`;
  menu.querySelector('[data-context-open]').onclick=()=>{closeContextMenu();openLightbox(assetId);};menu.querySelector('[data-context-show-folder]').onclick=()=>{window.vision.showInFolder(asset.path);closeContextMenu();};menu.querySelector('[data-context-copy]')?.addEventListener('click',async()=>{if(asset.type!=='image')return;const ok=await window.vision.copyImage(asset.path);closeContextMenu();toast(ok?'Copied image to clipboard':'Unable to copy image');});menu.querySelector('[data-context-copy-theme]').onclick=()=>{copiedTagGroup={kind:'Theme',field:'tags',values:[...meta(assetId).tags]};closeContextMenu();toast('Theme copied');};menu.querySelector('[data-context-copy-character]').onclick=()=>{copiedTagGroup={kind:'Character',field:'persons',values:[...meta(assetId).persons]};closeContextMenu();toast('Character copied');};menu.querySelector('[data-context-paste]')?.addEventListener('click',async()=>{meta(assetId)[copiedTagGroup.field]=[...new Set([...meta(assetId)[copiedTagGroup.field],...copiedTagGroup.values])];await save();closeContextMenu();renderInspector();});menu.querySelector('[data-context-create-group]')?.addEventListener('click',()=>{closeContextMenu();createSingleGroup(assetId);});menu.querySelector('[data-context-remove-group]')?.addEventListener('click',()=>{closeContextMenu();removeFromGroupAfterCurrent(assetId);});menu.querySelector('[data-context-duplicate]').onclick=()=>{closeContextMenu();duplicateAsset(assetId);};menu.querySelector('[data-context-hide]').onclick=async()=>{if(!confirmAction('Move image to Discard Pile?'))return;closeContextMenu();await discardAssets([assetId]);};menu.querySelector('[data-context-cover]')?.addEventListener('click',async()=>{collection.coverId=assetId;await save();closeContextMenu();renderSidebars();});$$('[data-context-gallery]').forEach(button=>button.onclick=async()=>{selectedId=assetId;selectedIds=new Set([assetId]);await toggleAssetFolder(button.dataset.contextGallery,!store.collections.find(c=>c.id===button.dataset.contextGallery).items.includes(assetId));closeContextMenu();});
}
function closeContextMenu() { $('#contextMenu').classList.add('hidden'); }
async function importFolderIntoCollection(collection) { const folder=await window.vision.pickFolder();if(!folder)return;let source=store.sources.find(item=>item.path===folder);if(!source){const assets=await window.vision.scanFolder(folder);source={id:uid(),path:folder,name:folder.split(/\\|\//).pop(),assets};store.sources.push(source);await collectAssets();await syncSourceWatchers();}collection.sourceIds ||= [];if(!collection.sourceIds.includes(source.id))collection.sourceIds.push(source.id);syncGallerySourceAssets();await save();render(); }
function openFolderContextMenu(event,collectionId) {
  const collection=store.collections.find(item=>item.id===collectionId),menu=$('#contextMenu');
  if(!collection)return;
  const temporarilyUnlocked=collection.locked&&unlockedGalleryIds.has(collection.id);
  const lockControls=collection.locked
    ? temporarilyUnlocked?'<button data-folder-lock-now>Lock now</button><button data-folder-unlock-permanently>Gỡ khóa vĩnh viễn</button>':'<button data-folder-unlock>Unlock Gallery</button>'
    :'<button data-folder-lock>Lock Gallery</button>';
  menu.innerHTML=`<button data-folder-rename>Rename Gallery</button><button data-folder-autotag>Auto tag</button>${lockControls}<button data-folder-import>Import images from folder</button><button data-folder-import-personal>Import from Gallery</button><div class="context-divider"></div><button class="context-danger" data-folder-delete>Delete Gallery</button>`;
  menu.style.left=`${Math.min(event.clientX,window.innerWidth-245)}px`;menu.style.top=`${Math.min(event.clientY,window.innerHeight-290)}px`;menu.classList.remove('hidden');
  menu.querySelector('[data-folder-rename]').onclick=()=>{closeContextMenu();openCollectionModal(collection);};
  menu.querySelector('[data-folder-autotag]').onclick=()=>{closeContextMenu();openGalleryAutoTagPicker(collection);};
  $('[data-folder-unlock]')?.addEventListener('click',()=>{closeContextMenu();requestGalleryPassword(collection,()=>{unlockedGalleryIds.add(collection.id);openGallery(collection.id);});});
  $('[data-folder-lock]')?.addEventListener('click',async()=>{if(!store.passwordHash){closeContextMenu();return toast('Set an app password before locking a Gallery');}collection.locked=true;unlockedGalleryIds.delete(collection.id);await save();closeContextMenu();if(currentView===`collection:${collection.id}`){currentView='library-folders';selectedId=null;selectedIds.clear();render();}else renderSidebars();});
  $('[data-folder-lock-now]')?.addEventListener('click',()=>{unlockedGalleryIds.delete(collection.id);closeContextMenu();if(currentView===`collection:${collection.id}`){lockedGalleryId=collection.id;selectedId=null;selectedIds.clear();render();}else renderSidebars();});
  $('[data-folder-unlock-permanently]')?.addEventListener('click',async()=>{if(!confirmAction(`Remove the lock permanently from Gallery “${collection.name}”?`))return;collection.locked=false;unlockedGalleryIds.add(collection.id);await save();closeContextMenu();render();});
  menu.querySelector('[data-folder-import]').onclick=()=>{closeContextMenu();importFolderIntoCollection(collection);};
  menu.querySelector('[data-folder-import-personal]').onclick=()=>{const other=store.collections.filter(item=>item.id!==collection.id);if(!other.length)return;menu.innerHTML=other.map(item=>`<button data-import-personal="${item.id}">${escapeHTML(item.name)}</button>`).join('');$$('[data-import-personal]').forEach(button=>button.onclick=async()=>{const source=store.collections.find(item=>item.id===button.dataset.importPersonal);source.items.forEach(id=>{if(!collection.items.includes(id))collection.items.push(id);});await save();closeContextMenu();render();});};
  menu.querySelector('[data-folder-delete]').onclick=async()=>{if(!confirmAction(`Move Gallery “${collection.name}” to Discard Pile?`))return;store.discardedGalleries ||= [];store.discardedGalleries.push({...collection,items:[...(collection.items||[])],sourceIds:[...(collection.sourceIds||[])],discardedIds:[...(collection.discardedIds||[])],groups:JSON.parse(JSON.stringify(collection.groups||[])),deletedAt:Date.now()});store.collections=store.collections.filter(item=>item.id!==collection.id);unlockedGalleryIds.delete(collection.id);if(currentView===`collection:${collection.id}`)currentView='all';await save();closeContextMenu();render();};
}
function openGroupContextMenu(event,groupId) { const group=activeGroups().find(item=>item.id===groupId),menu=$('#contextMenu');if(!group)return;menu.innerHTML=`<button data-group-select>Select all images in group</button><button data-group-folder>Add group to Folder</button><button data-group-collapse>${group.collapsed?'Expand group':'Collapse group'}</button>${currentCollection()?'<button data-group-cover>Set group cover</button>':''}`;menu.style.left=`${Math.min(event.clientX,window.innerWidth-245)}px`;menu.style.top=`${Math.min(event.clientY,window.innerHeight-210)}px`;menu.classList.remove('hidden');menu.querySelector('[data-group-select]').onclick=()=>{selectedIds=new Set(group.assets);selectedId=group.assets[0]||null;closeContextMenu();render();};menu.querySelector('[data-group-folder]').onclick=()=>{selectedIds=new Set(group.assets);selectedId=group.assets[0]||null;closeContextMenu();openBulkFolderPicker();};menu.querySelector('[data-group-collapse]').onclick=async()=>{group.collapsed=!group.collapsed;await save();closeContextMenu();renderCanvas();};menu.querySelector('[data-group-cover]')?.addEventListener('click',async()=>{currentCollection().coverId=group.coverId||group.assets[0];await save();closeContextMenu();renderSidebars();}); }
function openPropertyPicker(kind,anchor) {
  const ids=selectedTargetIds(); if(!ids.length)return;
  const picker=$('#propertyPicker'),isFolder=kind==='folder',field=kind==='theme'?'tags':'persons',definitions=isFolder?store.collections:(kind==='theme'?store.tagDefinitions:store.personDefinitions),rect=anchor.getBoundingClientRect();
  picker.style.left=`${Math.max(10,rect.left-195)}px`;picker.style.top=`${Math.min(window.innerHeight-270,rect.bottom+6)}px`;
  const renderOptions=needle=>{const term=needle.toLowerCase(),values=definitions.filter(item=>(item.name||'').toLowerCase().includes(term)),exact=definitions.some(item=>(item.name||'').toLowerCase()===term);picker.innerHTML=`<div class="picker-search"><span>⌕</span><input id="pickerSearch" placeholder="Search..." value="${escapeHTML(needle)}"></div><div class="picker-list">${values.map(item=>{const name=item.name;const selected=isFolder?ids.every(id=>item.items.includes(id)):ids.every(id=>meta(id)[field].includes(name));return `<button data-picker-value="${escapeHTML(isFolder?item.id:name)}">${selected?'✓ ':''}${escapeHTML(name)}</button>`;}).join('')||'<span class="picker-empty">No matching values</span>'}${!isFolder&&needle.trim()&&!exact?`<button class="picker-create" data-picker-create="${escapeHTML(needle.trim())}">＋ Create &quot;${escapeHTML(needle.trim())}&quot;</button>`:''}</div>`;const search=$('#pickerSearch');search.oninput=event=>renderOptions(event.target.value);search.focus();search.setSelectionRange(needle.length,needle.length);$('[data-picker-create]')?.addEventListener('click',async event=>{const name=event.currentTarget.dataset.pickerCreate,target=kind==='theme'?store.tagDefinitions:store.personDefinitions;target.push({name});ids.forEach(id=>{if(!meta(id)[field].includes(name))meta(id)[field].push(name);});await save();closePropertyPicker();renderInspector();});$$('[data-picker-value]').forEach(button=>button.onclick=async()=>{const value=button.dataset.pickerValue;if(isFolder){const collection=store.collections.find(item=>item.id===value);await toggleAssetFolder(value,!ids.every(id=>collection.items.includes(id)));}else{ids.forEach(id=>{if(!meta(id)[field].includes(value))meta(id)[field].push(value);});await save();renderInspector();}closePropertyPicker();});};renderOptions('');picker.classList.remove('hidden');
}
function closePropertyPicker() { $('#propertyPicker').classList.add('hidden'); }
function openTagManager(kind='theme') {
  const isTheme=kind==='theme', definitions=isTheme?store.tagDefinitions:store.personDefinitions, field=isTheme?'tags':'persons', title=isTheme?'Theme':'Character';
  const rows=definitions.map(tag=>{const count=allAssets.filter(asset=>meta(asset.id)[field].includes(tag.name)).length;return `<div class="tag-row" data-original="${escapeHTML(tag.name)}"><input class="tag-color" type="color" value="${tag.color}"><input class="tag-name-input" value="${escapeHTML(tag.name)}"><span class="tag-count">${count} media</span><button class="delete-tag">×</button></div>`;}).join('')||'<div class="tag-row empty-tag-row">No items yet</div>';
  openModal(`<div class="tag-manager property-manager"><div class="property-tabs"><button data-tag-kind="theme" class="${isTheme?'selected':''}">Theme</button><button data-tag-kind="character" class="${!isTheme?'selected':''}">Character</button></div><h2>${title}</h2><p>Manage reusable ${title.toLowerCase()} values for your library.</p><div class="tag-table">${rows}</div><div class="new-tag-row"><input id="newTagName" placeholder="Create ${title}"><input id="newTagColor" class="tag-color" type="color" value="${isTheme?'#a78bfa':'#74b996'}"><button id="createTag" class="primary-button">Create</button></div><div class="modal-footer"><button class="secondary-button" data-close>Close</button><button id="saveTagManager" class="primary-button">Save changes</button></div></div>`);
  $$('[data-tag-kind]').forEach(button=>button.onclick=()=>openTagManager(button.dataset.tagKind));
  $('#createTag').onclick=async()=>{const name=$('#newTagName').value.trim();if(!name||definitions.some(tag=>tag.name.toLowerCase()===name.toLowerCase()))return;definitions.push({name,color:$('#newTagColor').value});await save();openTagManager(kind);};
  $$('.delete-tag').forEach(button=>button.onclick=event=>event.currentTarget.closest('.tag-row').remove());
  $('#saveTagManager').onclick=async()=>{const next=[];$$('.tag-row[data-original]').forEach(row=>{const oldName=row.dataset.original,name=row.querySelector('.tag-name-input').value.trim();if(!name){replacePropertyEverywhere(field,oldName,null);return;}replacePropertyEverywhere(field,oldName,name);next.push({name,color:row.querySelector('.tag-color').value});});if(isTheme)store.tagDefinitions=next;else store.personDefinitions=next;await save();closeModal();render();};
}
function replacePropertyEverywhere(field,oldName,newName) { Object.values(store.assetMeta).forEach(item=>item[field]=(item[field]||[]).map(value=>value===oldName?newName:value).filter(Boolean)); if(field==='tags')store.collections.forEach(collection=>collection.defaultTags=collection.defaultTags.map(tag=>tag===oldName?newName:tag).filter(Boolean)); }
function openPasswordModal() { openModal(`<h2>Bảo mật ứng dụng</h2><p>${store.passwordHash?'Thay đổi hoặc xóa mật khẩu để quản lý quyền truy cập.':'Đặt mật khẩu khi mở Master Vision trên máy này.'}</p><label>Mật khẩu mới</label><input id="passwordOne" type="password" autocomplete="new-password" placeholder="Ít nhất 4 ký tự"><label>Xác nhận mật khẩu</label><input id="passwordTwo" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu"><div class="modal-footer">${store.passwordHash?'<button class="secondary-button" id="removePassword">Gỡ mật khẩu</button>':''}<button class="secondary-button" data-close>Hủy</button><button class="primary-button" id="savePassword">Lưu mật khẩu</button></div>`); $('#savePassword').addEventListener('click',async()=>{const a=$('#passwordOne').value,b=$('#passwordTwo').value;if(a.length<4)return toast('Mật khẩu cần ít nhất 4 ký tự');if(a!==b)return toast('Mật khẩu xác nhận chưa khớp');store.passwordHash=await hash(a);await save();closeModal();toast('Đã cập nhật mật khẩu');});$('#removePassword')?.addEventListener('click',async()=>{store.passwordHash=null;await save();closeModal();toast('Đã gỡ mật khẩu');}); }
function openLanguageModal() { openModal(`<h2>${t('language')}</h2><p>${store.language==='vi'?'Chọn ngôn ngữ hiển thị cho Master Vision.':'Choose the display language for Master Vision.'}</p><div class="language-options"><button data-language="vi" class="language-choice ${store.language==='vi'?'selected':''}"><b>Tiếng Việt</b><small>Vietnamese</small></button><button data-language="en" class="language-choice ${store.language==='en'?'selected':''}"><b>English</b><small>English</small></button></div><div class="modal-footer"><button class="secondary-button" data-close>${store.language==='vi'?'Đóng':'Close'}</button></div>`);$$('[data-language]').forEach(button=>button.onclick=async()=>{store.language=button.dataset.language;await save();closeModal();applyLanguage();render();}); }
async function hash(value) { const bytes=new TextEncoder().encode(value); const out=await crypto.subtle.digest('SHA-256',bytes); return [...new Uint8Array(out)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function lockApp() { if(!store.passwordHash)return toast('Set a password first');sessionStorage.removeItem('master-vision-unlocked');showUnlock(); }
function showUnlock() { document.body.innerHTML=`<div class="unlock-screen"><div class="unlock-card"><div class="brand"><span class="brand-mark">I</span><span>InDeck</span></div><h1>Không gian riêng tư</h1><p>Nhập mật khẩu để mở thư viện của bạn.</p><input type="password" id="unlockInput" autofocus placeholder="Mật khẩu"><button id="unlockButton" class="primary-button">Mở khóa</button><small id="unlockError"></small></div></div>`; const input=$('#unlockInput'),go=async()=>{if(await hash(input.value)===store.passwordHash){sessionStorage.setItem('master-vision-unlocked', store.passwordHash);location.reload()}else{$('#unlockError').textContent='Mật khẩu chưa chính xác';input.select();input.focus();}};$('#unlockButton').onclick=go;input.onkeydown=e=>{if(e.key==='Enter')go();};requestAnimationFrame(()=>input.focus()); }
function openModal(content) { $('#modal').innerHTML=content;$('#modalLayer').classList.remove('hidden');$$('[data-close]').forEach(b=>b.onclick=closeModal); } function closeModal(){$('#modalLayer').classList.add('hidden');}
function bindEvents() {
  window.vision.onFolderChanged(scheduleSourceRefresh);
  window.vision.onMediaImported(reloadImportedMedia);
  $('#emptyAdd').onclick=()=>openCollectionModal();$('#libraryHome').onclick=()=>{currentView='library-folders';selectedId=null;selectedIds.clear();render();};$('#addCollection').onclick=()=>openCollectionModal();$('#manageTags').onclick=()=>{currentView='tag-manager';selectedId=null;selectedIds.clear();render();};$('#settingsButton').onclick=()=>{currentView='settings';selectedId=null;selectedIds.clear();render();};$('#toggleInspector').onclick=()=>$('#inspector').classList.toggle('hidden');$('#closeInspector').onclick=()=>$('#inspector').classList.add('hidden');
  $$('.nav-item[data-view]').forEach(button=>button.onclick=()=>{currentView=button.dataset.view;selectedId=null;render();}); $$('.filter-chip').forEach(button=>button.onclick=()=>{currentFilter=button.dataset.filter;$$('.filter-chip').forEach(x=>x.classList.toggle('selected',x===button));renderCanvas();});
  $('#searchInput').oninput=event=>{searchTerm=event.target.value;renderCanvas();}; $('#sortButton').onclick=()=>{allAssets.reverse();renderCanvas();}; $('#clearLayout').onclick=async()=>{allAssets.forEach((asset,index)=>meta(asset.id).order=Date.now()-index);await save();renderCanvas();};$('#editCollection').onclick=()=>openCollectionModal(currentCollection());
  $('#selectAll').onclick=()=>{const ids=visibleAssets().map(asset=>asset.id);selectedIds=selectedIds.size===ids.length?new Set():new Set(ids);selectedId=[...selectedIds][0]||null;render();}; $('#zoomIn').onclick=async()=>{store.zoom=Math.min(280,(store.zoom||155)+15);applyZoom();await save();renderCanvas();};$('#zoomOut').onclick=async()=>{store.zoom=Math.max(80,(store.zoom||155)-15);applyZoom();await save();renderCanvas();};$$('[data-bulk]').forEach(button=>button.onclick=()=>({folder:openBulkFolderPicker,group:bulkCreateGroup,tag:openBulkTagPicker,hide:async()=>{const ids=[...selectedIds];if(ids.length&&confirmAction(`Move ${ids.length} selected images to Discard Pile?`))await discardAssets(ids);},copy:async()=>{const first=allAssets.find(asset=>selectedIds.has(asset.id)&&asset.type==='image');if(first)await window.vision.copyImage(first.path);toast(`Copied ${selectedIds.size} selected image(s)`);},dissolve:dissolveSelectedGroup}[button.dataset.bulk]()));
  $('#favoriteToggle').onchange=async event=>{selectedTargetIds().forEach(id=>meta(id).favorite=event.target.checked);await save();renderCanvas();}; $('#assetNote').onchange=async event=>{selectedTargetIds().forEach(id=>meta(id).note=event.target.value);await save();};$('#removeFromCollection').onclick=removeFromCollection;
  $$('.property-add').forEach(button=>button.onclick=event=>{event.stopPropagation();openPropertyPicker(button.dataset.picker,button);}); $('#inspector').addEventListener('click',event=>{const button=event.target.closest('[data-pill-field]');if(button)removeValue(button.dataset.pillField,button.dataset.pillValue);const folder=event.target.closest('[data-remove-folder]');if(folder)toggleAssetFolder(folder.dataset.removeFolder,false);}); $('#modalLayer').onclick=event=>{if(event.target===$('#modalLayer'))closeModal();}; document.addEventListener('click',event=>{if(!event.target.closest('#contextMenu'))closeContextMenu();if(!event.target.closest('#propertyPicker')&&!event.target.closest('.property-add'))closePropertyPicker();});
  $('#content').addEventListener('scroll',event=>$('#scrollTop').classList.toggle('hidden', event.currentTarget.scrollTop < 260)); $('#content').addEventListener('dragover',event=>{if(dragId||dragGroupId){event.preventDefault();updateAutoScroll(event);}}); $('#content').addEventListener('dragleave',event=>{if(!$('#content').contains(event.relatedTarget))stopAutoScroll();}); $('#scrollTop').onclick=()=>$('#content').scrollTo({top:0,behavior:'smooth'});
  $('#closeLightbox').onclick=closeLightbox; $('#previousAsset').onclick=()=>moveLightbox(-1); $('#nextAsset').onclick=()=>moveLightbox(1); $('#lightbox').addEventListener('click',event=>{if(event.target===$('#lightbox'))closeLightbox();}); document.addEventListener('keydown',event=>{if($('#lightbox').classList.contains('hidden'))return; if(event.key==='Escape')closeLightbox(); if(event.key==='ArrowLeft'){event.preventDefault();moveLightbox(-1);} if(event.key==='ArrowRight'){event.preventDefault();moveLightbox(1);}});
}
init();
