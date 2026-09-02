/* v16 — stable application controller. */
window.BOBRUISK_APP_VERSION = "21";
// Set this once to the email address that should receive error reports.
// FormSubmit sends the form directly from the static site; no backend is required.
const REPORT_EMAIL = window.BOBRUISK_REPORT_EMAIL || "YOUR_EMAIL@example.com";
let map = null;
let markerLayer = null;
let baseLayer = null;
let fallbackMap = null;
let currentData = [];
let currentObject = null;
let currentLang = 'ru';
let translations = {};
let currentFilter = 'all';
let catalogFilter = 'all';
let catalogSearch = '';
let currentView = 'home';
let detailOrigin = null;
let mapImageIndex = 0;
let detailImageIndex = 0;
let catalogScrollTop = 0;
let mapStateBeforeDetail = null;

const categoryIcons = {
  landscape: 'icons/landscape.svg',
  botanical: 'icons/botanical.svg',
  hydrological: 'icons/hydrological.svg'
};
const categoryFallback = {
  landscape: 'Ландшафтный', botanical: 'Ботанический', hydrological: 'Гидрологический'
};
const categoryColors = {
  landscape: '#c38b2e', botanical: '#2b9b70', hydrological: '#4d8fca'
};
const tileLayers = {
  osm: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  hybrid: () => L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' }),
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; CARTO' })
  ])
};

function escapeHtml(v='') { return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function categoryName(obj) { return String(obj?.categoryName || categoryFallback[obj?.category] || 'Природный объект').replace(/\s+местного значения$/i,''); }
function setText(id, value) { const el=document.getElementById(id); if(el) el.replaceChildren(document.createTextNode(String(value ?? '').replace(/<br\s*\/?\s*>/gi,'\n'))); }
function setHTML(id, value) { const el=document.getElementById(id); if(el) el.innerHTML=value ?? ''; }
function setPlaceholder(id, value) { const el=document.getElementById(id); if(el) el.placeholder=value ?? ''; }
function setActionText(textId, labelId, textValue, arrowValue) { const textEl=document.getElementById(textId); if(textEl) textEl.replaceChildren(document.createTextNode(String(textValue ?? ''))); const arrowEl=document.getElementById(labelId); if(arrowEl) arrowEl.replaceChildren(document.createTextNode(String(arrowValue ?? ''))); }
function iconFor(category) { return categoryIcons[category] || categoryIcons.botanical; }
function noPhotoText() { return translations.no_photo || 'Фото пока нет'; }
function getCurrentObjById(id) { return currentData.find(o => o.id === id) || null; }

function getVideoId(value='') {
  try {
    const s=String(value).trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    const u=new URL(s);
    if (u.hostname === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || '';
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v') || '';
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || '';
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
    }
  } catch (_) {}
  return '';
}
function youtubeEmbed(value='') {
  const id=getVideoId(value); if(!id) return '';
  let start='';
  try { const u=new URL(String(value)); const t=u.searchParams.get('t'); if(/^\d+$/.test(t||'')) start=`&start=${t}`; } catch(_){}
  return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1${start}`;
}
function formatDescription(text='') {
  return String(text).split(/\n/).map(line=>{
    const t=line.trim(); if(!t) return '<div class="desc-gap"></div>';
    const heading=/^(?:📍|📌|🌿|🌳|💧|🏞|🌍|🔬|🛡️|[А-ЯЁA-Z][А-ЯЁA-Z\s«»—–-]{2,}:)/u.test(t);
    return heading ? `<h3 class="desc-heading">${escapeHtml(t)}</h3>` : `<p>${escapeHtml(t)}</p>`;
  }).join('');
}

async function loadLocale(lang) {
  // Use the bundled locale immediately. This makes the app deterministic when
  // opened from file:// or when a static host/CDN is slow. The JSON file is
  // only an optional refresh.
  const bundled = window.EMBEDDED_LOCALES?.[lang];
  if (bundled && typeof bundled === 'object') translations = bundled;
  else if (lang !== 'ru' && window.EMBEDDED_LOCALES?.ru) translations = window.EMBEDDED_LOCALES.ru;
  else translations = {};

  currentLang = lang;
  applyTranslations();
  const current=document.querySelector('.lang-current');
  if(current) current.textContent=lang.toUpperCase();
  document.querySelectorAll('.lang-option').forEach(b=>b.classList.toggle('active',b.dataset.lang===lang));

  // Refresh from JSON when possible, without making the UI wait for it.
  try {
    const r=await fetch(`locales/${lang}.json?v=${window.BOBRUISK_APP_VERSION}`);
    if(r.ok){
      const fresh=await r.json();
      if(fresh && typeof fresh==='object'){
        translations=fresh;
        applyTranslations();
      }
    }
  } catch (_) {}
  return true;
}

async function loadData(lang) {
  // Bundled data is the source of truth for initial boot. This prevents the
  // catalogue from becoming "0" because fetch() is unavailable on file://.
  const bundled = window.EMBEDDED_DATA?.[lang];
  if(Array.isArray(bundled)) currentData=normalizeData(bundled);
  else if(lang!=='ru' && Array.isArray(window.EMBEDDED_DATA?.ru)) currentData=normalizeData(window.EMBEDDED_DATA.ru);
  else currentData=[];

  // JSON is optional and can update the bundled copy when hosted normally.
  try {
    const r=await fetch(`locales/${lang}-data.json?v=${window.BOBRUISK_APP_VERSION}`);
    if(r.ok){
      const fresh=await r.json();
      if(Array.isArray(fresh) && fresh.length) currentData=normalizeData(fresh);
    }
  } catch (_) {}
  return true;
}

function normalizeData(data){
  return (Array.isArray(data)?data:[]).map((o,i)=>({
    ...o,
    id:String(o?.id ?? `object-${i+1}`),
    category:String(o?.category||'botanical'),
    categoryName:String(o?.categoryName||''),
    coords:Array.isArray(o?.coords) && o.coords.length===2
      ? [Number(o.coords[0]),Number(o.coords[1])] : null,
    images:Array.isArray(o?.images)?o.images.filter(Boolean):[],
    sources:Array.isArray(o?.sources)?o.sources:[],
    details:o?.details && typeof o.details==='object'?o.details:{}
  }));
}

function dedupeId(id){ const els=[...document.querySelectorAll('#'+CSS.escape(id))]; if(els.length>1) els.slice(1).forEach(el=>el.remove()); return els[0]||null; }
function applyTranslations() {
  ['hero-map-text','hero-map-label','hero-objects-text','hero-objects-label','catalog-map-label','about-open-map','about-open-objects','ai-btn','report-error-btn'].forEach(dedupeId);
  setText('hero-eyebrow',translations.hero_eyebrow||'ПРИРОДА · ИСТОРИЯ · НАСЛЕДИЕ');
  setText('app-title',translations.app_title||'Заповедная Бобруйщина');
  setText('app-subtitle',translations.app_subtitle||'Интерактивный атлас природных уголков');
  setText('nav-home',translations.nav_home||'Главная'); setText('nav-map',translations.nav_map||'Карта'); setText('nav-objects',translations.nav_objects||'Объекты'); setText('about-btn-text',translations.about_button||'О проекте');
  setHTML('hero-title',translations.hero_title_html||'Заповедная<br><em>Бобруйщина</em>'); setText('hero-subtitle',translations.hero_subtitle||'Интерактивный атлас природных уголков Бобруйского края'); setText('hero-lead',translations.hero_lead||'Исследуйте охраняемые ландшафты, древние деревья, озёра и болотные комплексы — в одном цифровом путешествии.');
  setActionText('hero-map-text','hero-map-label',translations.hero_map||'Открыть карту','→'); setActionText('hero-objects-text','hero-objects-label',translations.hero_objects||'Исследовать объекты','↗');
  setHTML('intro-title',translations.intro_title_html||'Природа Бобруйщины —<br><em>ближе, чем кажется.</em>'); setText('intro-text',translations.intro_text||'Откройте места, которые легко проехать мимо.'); setText('intro-link-label',translations.intro_link||'→');
  setText('stat-objects-label',translations.stat_objects||'природных\nобъектов'); setText('stat-categories-label',translations.stat_categories||'категории\nохраны'); setText('stat-photos-label',translations.stat_photos||'фотографий\nв атласе');
  setText('catalog-kicker',translations.catalog_kicker||'АТЛАС ПРИРОДНЫХ МЕСТ'); setText('catalog-title',translations.object_list_title||'Природные объекты'); setText('catalog-subtitle',translations.catalog_subtitle||'Исследуйте охраняемые территории и природные комплексы Бобруйщины.');
  setPlaceholder('catalog-search-input',translations.search_placeholder||'Поиск объекта...'); setText('catalog-count-label',translations.catalog_count_label||'объектов в атласе'); setText('catalog-map-label',translations.catalog_map||'Открыть карту');
  setText('map-title-text',translations.map_title||'Интерактивная карта'); setPlaceholder('search-input',translations.search_placeholder||'Поиск объекта...'); setText('filter-title',translations.filter_title||'Категории'); setText('filter-all',translations.filter_all||'Все'); setText('filter-landscape',translations.filter_landscape||'Ландшафтные'); setText('filter-botanical',translations.filter_botanical||'Ботанические'); setText('filter-hydrological',translations.filter_hydrological||'Гидрологические'); setText('map-style-title',translations.map_style_title||'Вид карты'); setText('map-style-hybrid',translations.map_style_hybrid||'Спутник + Гибрид'); setText('map-style-osm',translations.map_style_osm||'Схема (OSM)'); setText('object-list-title',translations.object_list_title||'Природные объекты'); setText('fit-all-label',translations.fit_all||'Все объекты'); setText('legend-botanical',translations.legend_botanical||'Ботанические'); setText('legend-landscape',translations.legend_landscape||'Ландшафтные'); setText('legend-hydrological',translations.legend_hydrological||'Гидрологические'); setText('mobile-object-panel-label',translations.mobile_objects||'Объекты');
  setText('expand-sidebar-label',translations.more_info||'Подробнее'); setText('object-detail-back-label',translations.back||'Назад'); setText('object-detail-description-title',translations.full_description||'Подробное описание'); setText('object-detail-sources-title',translations.sources_title||'Источники'); setText('object-detail-qr-label',translations.qr_links||'Ссылка'); setText('object-detail-video-title',translations.video_title||'Видеоэкскурсия'); setText('object-detail-gallery-title',translations.gallery_title||'Фотогалерея'); setText('youtube-open-text',translations.watch_on_youtube||'Открыть видео на YouTube'); setText('object-detail-no-video',translations.no_video||'Видео для этого объекта пока не добавлено');
  setText('about-kicker',translations.about_kicker||'О ПРОЕКТЕ');
  setText('about-open-map',translations.open_map||'Открыть карту'); setText('about-open-objects',translations.nav_objects||'Перейти к объектам');
  setText('about-card-label',translations.about_card_label||'ИДЕЯ');
  setText('about-feature-title1',translations.about_feature_title1||'Исследуйте'); setText('about-feature-title2',translations.about_feature_title2||'Смотрите'); setText('about-feature-title3',translations.about_feature_title3||'Узнавайте'); setText('about-title',translations.about_page_title||'Путеводитель по заповедной природе'); setText('about-text1',translations.about_page_text1||'Цифровое путешествие по природным уголкам Бобруйского края.'); setText('about-text2',translations.about_page_text2||'Проект объединяет карту, каталог, фотографии и видеоматериалы.'); setHTML('about-feature1',translations.about_page_feature1||'Исследуйте — находите объекты и переходите от каталога к карте.'); setHTML('about-feature2',translations.about_page_feature2||'Смотрите — изучайте фотографии и доступные видеоматериалы.'); setHTML('about-feature3',translations.about_page_feature3||'Узнавайте — знакомьтесь со сведениями из исходных материалов.'); setText('about-author-kicker',translations.about_author_kicker||'ОБ АВТОРЕ'); setText('about-author-name',translations.about_author_name||'Автор проекта'); setText('about-author-nick',translations.about_author_nick||'Indigo'); setText('about-author-age',translations.about_author_age||''); setHTML('about-author-description',translations.about_author_description||''); setText('about-details-kicker',translations.details_kicker||'ТЕХНОЛОГИИ'); setText('about-details-title',translations.about_details_title||'Подробнее о сайте'); setHTML('about-details-text',translations.about_details_text||'Сайт создан на HTML5, CSS3 и JavaScript.'); setText('about-footer',translations.about_page_footer||'Сохраним природное наследие Бобруйщины вместе!');
  const aiLabel=translations.ai_label||'AI'; const aiTitle=translations.ai_title||'AI — в разработке';
  const aiBtn=document.getElementById('ai-btn'); if(aiBtn){ aiBtn.querySelector('span')?.replaceChildren(document.createTextNode(aiLabel)); aiBtn.title=aiTitle; aiBtn.setAttribute('aria-label',aiTitle); }
  setText('report-error-label',translations.report_error_label||'Ошибка'); setText('report-error-kicker',translations.report_error_kicker||'ОБРАТНАЯ СВЯЗЬ'); setText('report-error-title',translations.report_error_title||'Сообщить об ошибке'); setText('report-error-intro',translations.report_error_intro||'Опишите, что работает неправильно. Страница и выбранный объект подставятся автоматически.'); setText('report-error-message-label',translations.report_error_message_label||'Что произошло?'); setPlaceholder('report-error-message',translations.report_error_message_placeholder||'Например: кнопка «Подробнее» не открывает объект...'); setText('report-error-email-label',translations.report_error_email_label||'Ваш e-mail (необязательно)'); setPlaceholder('report-error-email',translations.report_error_email_placeholder||'Чтобы можно было ответить вам'); setText('report-error-cancel-label',translations.report_error_cancel||'Отмена'); setText('report-error-submit-label',translations.report_error_submit||'Отправить отчёт');
  renderCatalogFilters(); renderLegendLabels(); updateStats();
  if(currentView==='objects') renderCatalog();
  if(currentView==='map') renderMapUI();
  if(currentView==='about') {};
  if(currentView==='object-detail') renderObjectDetail();
}
function renderLegendLabels(){ setText('legend-botanical',translations.legend_botanical||'Ботанические'); setText('legend-landscape',translations.legend_landscape||'Ландшафтные'); setText('legend-hydrological',translations.legend_hydrological||'Гидрологические'); }
function updateStats(){ setText('stat-objects',String(currentData.length)); setText('stat-categories',String(new Set(currentData.map(o=>o.category).filter(Boolean)).size||3)); setText('stat-photos',String(currentData.reduce((n,o)=>n+(Array.isArray(o.images)?o.images.length:0),0))); setText('total-count',String(currentData.length)); }

function showView(view) {
  const ids={home:'home-view',map:'explorer-view',objects:'objects-catalog-view',about:'about-view','object-detail':'object-detail-view'};
  if(!ids[view]) return;
  if(currentView==='objects' && view!=='objects') catalogScrollTop=document.getElementById('objects-catalog-view')?.scrollTop||catalogScrollTop;
  currentView=view;
  Object.values(ids).forEach(id=>document.getElementById(id)?.classList.add('hidden'));
  const el=document.getElementById(ids[view]); el?.classList.remove('hidden');
  document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===view || (view==='object-detail'&&b.dataset.view==='objects')));
  document.querySelector('.main-nav')?.classList.remove('open');
  requestAnimationFrame(()=>{
    el?.classList.remove('page-enter'); void el?.offsetWidth; el?.classList.add('page-enter');
    if(view==='map'){ setTimeout(()=>{ map?.invalidateSize(); if(!currentObject) fitAllObjects(); },80); }
    if(view==='objects'){ renderCatalog(); const sc=document.getElementById('objects-catalog-view'); requestAnimationFrame(()=>{if(sc) sc.scrollTop=catalogScrollTop;}); }
    if(view==='object-detail'){ const sc=document.getElementById('object-detail-view'); if(sc) sc.scrollTop=0; }
  });
}

function visibleMapObjects(){ return currentFilter==='all'?currentData:currentData.filter(o=>o.category===currentFilter); }
function renderObjects(items=visibleMapObjects()) {
  const list=document.getElementById('object-list');
  if(!list) return;
  list.innerHTML='';

  // The object list must work even if the Leaflet library is unavailable.
  if (markerLayer) markerLayer.clearLayers();
  document.getElementById('fallback-marker-layer')?.replaceChildren();

  items.forEach((obj,i)=>{
    if(map && markerLayer && Array.isArray(obj.coords) && obj.coords.length===2 && obj.coords.every(Number.isFinite)){
      const c=categoryColors[obj.category]||categoryColors.botanical;
      const marker=L.circleMarker(obj.coords,{radius:18,color:'#fff',weight:4,fillColor:c,fillOpacity:1,opacity:1,className:'map-point'});
      marker.bindTooltip(`${escapeHtml(obj.name||'')}${obj.coordsAccuracy==='approximate'?` · ${escapeHtml(translations.approximate||'Точка ориентировочная')}`:''}`,{direction:'top',offset:[0,-18],className:'custom-map-tooltip'});
      marker.on('click',()=>selectObject(obj,false,true));
      marker.addTo(markerLayer);
    }
    else if(fallbackMap && Array.isArray(obj.coords) && obj.coords.length===2 && obj.coords.every(Number.isFinite)){
      const layer=document.getElementById('fallback-marker-layer'); if(layer){ const pos=fallbackPoint(obj.coords); const dot=document.createElement('button'); dot.type='button'; dot.className=`fallback-map-point ${obj.category}`; dot.style.left=pos.x+'%'; dot.style.top=pos.y+'%'; dot.title=obj.name||''; dot.setAttribute('aria-label',obj.name||''); dot.addEventListener('click',()=>selectObject(obj,false,true)); layer.appendChild(dot); }
    }
    const li=document.createElement('li');
    li.className=`object-list-item category-${obj.category||'botanical'} ${currentObject?.id===obj.id?'active':''}`;
    li.dataset.id=obj.id;
    li.style.setProperty('--item-index',i);
    li.innerHTML=`<div class="item-topline"><span class="item-name">${escapeHtml(obj.name||'')}</span><span class="item-category-dot" title="${escapeHtml(categoryName(obj))}"></span></div><span class="item-meta">${escapeHtml(categoryName(obj))}</span>`;
    li.addEventListener('click',()=>selectObject(obj,false,true));
    list.appendChild(li);
  });
  updateStats();
}
function renderMapUI(){ renderObjects(); if(currentObject) refreshSidebar(); }
function fitAllObjects(){ const pts=currentData.filter(o=>Array.isArray(o.coords)&&o.coords.length===2&&o.coords.every(Number.isFinite)).map(o=>o.coords); if(map&&window.L&&pts.length) map.fitBounds(L.latLngBounds(pts),{padding:[75,75],maxZoom:12}); }

function selectObject(obj,fromCatalog=false,focus=true){
  if(!obj) return;
  currentObject=obj; mapImageIndex=0;
  const sidebar=document.getElementById('sidebar-right'); sidebar?.classList.add('active'); document.getElementById('explorer-view')?.classList.add('has-object-panel');
  refreshSidebar();
  if(fromCatalog) showView('map');
  if(focus&&map&&window.L&&Array.isArray(obj.coords)&&obj.coords.length===2){
    setTimeout(()=>focusMapOnObject(obj),90);
  }
}
function focusMapOnObject(obj){
  if(fallbackMap && obj?.coords){ focusFallbackMap(obj); return; }
  if(!map||!obj?.coords) return;
  map.invalidateSize();
  const target=L.latLng(obj.coords);
  const panelWidth=window.innerWidth>800?(document.getElementById('sidebar-right')?.offsetWidth||425):0;
  const targetPoint=map.project(target,map.getZoom());
  const visibleCenter=window.innerWidth>800 ? L.point(window.innerWidth/2-panelWidth/2,window.innerHeight/2) : L.point(window.innerWidth/2,window.innerHeight*.38);
  const mapPoint=L.point(window.innerWidth/2,window.innerHeight/2);
  const offset=visibleCenter.subtract(mapPoint);
  const destination=map.unproject(targetPoint.subtract(offset),map.getZoom());
  map.flyTo(destination,Math.max(map.getZoom(),13),{duration:.65,easeLinearity:.2});
}
function refreshSidebar(){
  if(!currentObject) return;
  const obj=currentObject;
  setText('detail-category',categoryName(obj)); setCategoryIcon(document.getElementById('detail-category-icon'),obj.category); setText('detail-title',obj.name||''); setText('detail-short-desc',shortDescription(obj,220));
  const extra=document.getElementById('detail-extra'); const d=obj.details||{}; const labels={area:translations.area||'Площадь',year:translations.year||'Год',status:translations.status||'Статус'}; extra.innerHTML='';
  ['area','year','status'].forEach(k=>{if(d[k]) extra.insertAdjacentHTML('beforeend',`<div class="detail-item"><b>${escapeHtml(labels[k])}</b><span>${escapeHtml(String(d[k]).replace(/\s+местного значения$/i,''))}</span></div>`);}); extra.style.display=extra.children.length?'grid':'none';
  updateSidebarGallery();
  document.querySelectorAll('#object-list li').forEach(li=>li.classList.toggle('active',li.dataset.id===obj.id));
}
function setCategoryIcon(el,category){ if(el) el.src=iconFor(category); }
function setImage(el,src){ if(!el)return; if(src){el.src=src;el.classList.remove('empty-image');el.alt='';}else{el.removeAttribute('src');el.classList.add('empty-image');el.alt=noPhotoText();} }
function updateSidebarGallery(){ const imgs=Array.isArray(currentObject?.images)?currentObject.images:[]; setImage(document.getElementById('detail-image'),imgs[mapImageIndex]||''); setText('gallery-counter',imgs.length?`${mapImageIndex+1} / ${imgs.length}`:noPhotoText()); document.querySelectorAll('.gallery-arrow').forEach(b=>b.style.display=imgs.length>1?'grid':'none'); }
function switchSidebarImage(dir){ const imgs=currentObject?.images||[]; if(imgs.length<2)return; mapImageIndex=(mapImageIndex+dir+imgs.length)%imgs.length; updateSidebarGallery(); }
function closeSidebar(){ currentObject=null; document.getElementById('sidebar-right')?.classList.remove('active'); document.getElementById('explorer-view')?.classList.remove('has-object-panel'); renderObjects(); }
function shortDescription(obj,max=220){ const t=String(obj?.shortDesc||'').replace(/\s+/g,' ').trim(); if(!t)return translations.no_description||''; return t.length<=max?t:t.slice(0,max).replace(/\s+\S*$/,'')+'…'; }

function getCatalogObjects(){ let items=catalogFilter==='all'?currentData:currentData.filter(o=>o.category===catalogFilter); if(catalogSearch){ const q=catalogSearch.toLowerCase(); items=items.filter(o=>`${o.name} ${o.categoryName} ${o.shortDesc}`.toLowerCase().includes(q)); } return items; }
function renderCatalogFilters(){
  const wrap=document.getElementById('catalog-filters'); if(!wrap)return;
  const labels={all:translations.filter_all||'Все',landscape:translations.filter_landscape||'Ландшафтные',botanical:translations.filter_botanical||'Ботанические',hydrological:translations.filter_hydrological||'Гидрологические'};
  wrap.innerHTML=Object.entries(labels).map(([key,label])=>`<button type="button" class="catalog-filter-btn ${catalogFilter===key?'active':''}" data-catalog-filter="${key}">${key==='all'?'<span class="filter-all-mark">◎</span>':`<img class="filter-icon" src="${iconFor(key)}" alt="">`}<span>${escapeHtml(label)}</span></button>`).join('');
  wrap.querySelectorAll('[data-catalog-filter]').forEach(b=>b.addEventListener('click',()=>{catalogFilter=b.dataset.catalogFilter; renderCatalogFilters(); renderCatalog();}));
}
function renderCatalog(){
  const grid=document.getElementById('catalog-grid'); if(!grid)return; const items=getCatalogObjects(); setText('catalog-count',String(items.length)); grid.innerHTML=''; grid.classList.remove('is-empty');
  if(!items.length){grid.classList.add('is-empty');grid.innerHTML=`<div class="catalog-empty">${escapeHtml(translations.no_results||'Ничего не найдено')}</div>`;return;}
  items.forEach((obj,i)=>{
    const image=Array.isArray(obj.images)&&obj.images.length?obj.images[0]:''; const cat=categoryName(obj);
    const card=document.createElement('article'); card.className=`catalog-card category-${obj.category||'botanical'}`; card.dataset.id=obj.id; card.style.setProperty('--card-index',i);
    card.innerHTML=`<div class="catalog-card-media ${image?'':'no-image'}">${image?`<img src="${escapeHtml(image)}" alt="${escapeHtml(obj.name||'')}" loading="lazy">`:`<div class="catalog-no-image"><img class="inline-icon" src="${iconFor(obj.category)}" alt=""><span>${escapeHtml(noPhotoText())}</span></div>`}<div class="catalog-card-shade"></div><span class="catalog-category"><i class="category-dot"></i>${escapeHtml(cat)}</span></div><div class="catalog-card-body"><h3>${escapeHtml(obj.name||'')}</h3><p>${escapeHtml(shortDescription(obj,145))}</p><div class="catalog-card-actions"><button class="catalog-details-btn" type="button"><span>${escapeHtml(translations.more_info||'Подробнее')}</span><img class="button-icon" src="icons/arrow-right.svg" alt=""></button><button class="catalog-map-link" type="button" title="${escapeHtml(translations.show_on_map||'Показать на карте')}" aria-label="${escapeHtml(translations.show_on_map||'Показать на карте')}"><img class="button-icon" src="icons/map-pin.svg" alt=""></button></div></div>`;
    card.querySelector('.catalog-details-btn').addEventListener('click',()=>openObjectDetail(obj,'objects'));
    card.querySelector('.catalog-map-link').addEventListener('click',()=>{catalogScrollTop=document.getElementById('objects-catalog-view')?.scrollTop||0; selectObject(obj,true,true);});
    grid.appendChild(card);
  });
}
function openObjectDetail(obj,origin){
  if(!obj)return;
  currentObject=obj; detailImageIndex=0;
  if(origin==='objects') catalogScrollTop=document.getElementById('objects-catalog-view')?.scrollTop||catalogScrollTop;
  if(origin==='map') mapStateBeforeDetail={center:map?.getCenter()?.clone(),zoom:map?.getZoom()};
  detailOrigin={view:origin,mapFilter:currentFilter,catalogFilter,catalogSearch,mapScroll:catalogScrollTop,mapState:mapStateBeforeDetail};
  renderObjectDetail(); showView('object-detail');
}
function renderObjectDetail(){
  if(!currentObject)return;
  const o=currentObject; setText('object-detail-title',o.name||''); setText('object-detail-category',categoryName(o)); setCategoryIcon(document.getElementById('object-detail-category-icon'),o.category);
  const imgs=Array.isArray(o.images)?o.images:[]; setImage(document.getElementById('object-detail-image'),imgs[detailImageIndex]||''); setText('object-detail-counter',imgs.length?`${detailImageIndex+1} / ${imgs.length}`:noPhotoText()); document.querySelectorAll('.object-detail-gallery-arrow').forEach(b=>b.style.display=imgs.length>1?'grid':'none');
  const facts=document.getElementById('object-detail-facts'); facts.innerHTML=''; const d=o.details||{}; [['area',translations.area||'Площадь'],['year',translations.year||'Год'],['status',translations.status||'Статус']].forEach(([k,label])=>{if(d[k])facts.insertAdjacentHTML('beforeend',`<div class="detail-fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(d[k]).replace(/\s+местного значения$/i,''))}</strong></div>`);});
  const iframe=document.getElementById('object-detail-video'),placeholder=document.getElementById('object-detail-video-placeholder'),yt=document.getElementById('object-detail-youtube-link'); const embed=youtubeEmbed(o.videoUrl||'');
  if(embed){iframe.src=embed;iframe.classList.remove('hidden');placeholder.classList.add('hidden');yt.href=o.videoUrl;yt.classList.remove('hidden');}else{iframe.removeAttribute('src');iframe.classList.add('hidden');placeholder.classList.remove('hidden');yt.classList.add('hidden');}
  setHTML('object-detail-full-desc',formatDescription(o.fullDesc||''));
  const src=document.getElementById('object-detail-sources'); src.innerHTML=''; (o.sources||[]).forEach(s=>{const li=document.createElement('li');if(s.url){const a=document.createElement('a');a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=s.title||s.url;li.appendChild(a);}else li.textContent=s.title||'';src.appendChild(li);}); if(!src.children.length)src.innerHTML=`<li>${escapeHtml(translations.no_sources||'Нет указанных источников')}</li>`;
  const qrCol=document.getElementById('object-detail-qr-col'); const qrLinks=Array.isArray(o.qrLinks)&&o.qrLinks.length?o.qrLinks:(o.qrUrl?[o.qrUrl]:[]); qrCol.classList.toggle('hidden',!qrLinks.length); if(qrLinks.length){const img=document.getElementById('object-detail-qr-code');img.src=qrPath(qrLinks[0],o.id,1);img.dataset.url=qrLinks[0];const link=document.getElementById('object-detail-source-link');link.href=qrLinks[0];link.textContent=qrLinks[0]; let extra=qrCol.querySelector('.qr-extra-links'); if(!extra){extra=document.createElement('div');extra.className='qr-extra-links';qrCol.appendChild(extra);} extra.innerHTML=''; qrLinks.slice(1).forEach((url,i)=>{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=url;a.className='qr-extra-link';extra.appendChild(a);});} else {const extra=qrCol.querySelector('.qr-extra-links');if(extra)extra.remove();}
  setText('object-detail-origin',detailOrigin?.view==='map'?(translations.back_to_map||'Из карты'):(translations.back_to_objects||'Из объектов'));
}
function qrPath(url,id='',index=1){ const safe=id||String(url).replace(/[^a-z0-9]+/gi,'-'); return `images/qr/${safe}-${index}.png`; }
function switchDetailImage(dir){ const imgs=currentObject?.images||[]; if(imgs.length<2)return; detailImageIndex=(detailImageIndex+dir+imgs.length)%imgs.length; setImage(document.getElementById('object-detail-image'),imgs[detailImageIndex]); setText('object-detail-counter',`${detailImageIndex+1} / ${imgs.length}`); }
function backFromDetail(){
  const o=detailOrigin||{view:'objects'}; const obj=currentObject; detailOrigin=null;
  if(o.view==='map'){
    currentFilter=o.mapFilter||'all'; document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter===currentFilter)); showView('map');
    requestAnimationFrame(()=>{if(map&&o.mapState?.center&&o.mapState?.zoom) map.setView(o.mapState.center,o.mapState.zoom,{animate:false}); renderObjects(); if(obj)selectObject(obj,false,false);});
  } else {
    catalogFilter=o.catalogFilter||'all'; catalogSearch=o.catalogSearch||''; catalogScrollTop=o.mapScroll||0; const inp=document.getElementById('catalog-search-input');if(inp)inp.value=catalogSearch; renderCatalogFilters(); showView('objects');
  }
}

function initHeroSlideshow(){
  const el=document.querySelector('.hero-photo'); if(!el)return;
  const photos=['images/luk.jpg','images/dub.jpg','images/dub2.jpg','images/dub3.jpg','images/dubkas.jpg','images/veksos.jpg','images/poydubr.jpeg','images/lipnyaki.jpg','images/velikoe.jpg','images/moh.jpeg']; let i=0;
  photos.forEach(src=>{const im=new Image();im.src=src;});
  setInterval(()=>{el.classList.add('is-changing');setTimeout(()=>{i=(i+1)%photos.length;el.style.backgroundImage=`url("${photos[i]}")`;el.classList.remove('is-changing');},700);},30000);
}
function initCatalogSearch(){ const input=document.getElementById('catalog-search-input'),clear=document.getElementById('catalog-search-clear'); if(!input)return; input.addEventListener('input',()=>{catalogSearch=input.value.trim();clear?.classList.toggle('hidden',!catalogSearch);renderCatalog();}); clear?.addEventListener('click',()=>{input.value='';catalogSearch='';clear.classList.add('hidden');renderCatalog();input.focus();}); }
function initMapSearch(){ const input=document.getElementById('search-input'),results=document.getElementById('search-results'),clear=document.getElementById('clear-search'); if(!input)return; input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();clear?.classList.toggle('hidden',!q);results.innerHTML='';if(!q){results.classList.add('hidden');return;}const m=currentData.filter(o=>`${o.name} ${o.categoryName} ${o.shortDesc}`.toLowerCase().includes(q)).slice(0,8);m.forEach(o=>{const item=document.createElement('button');item.type='button';item.className='search-item';item.textContent=o.name;item.addEventListener('click',()=>{input.value='';clear.classList.add('hidden');results.classList.add('hidden');selectObject(o,false,true);});results.appendChild(item);});if(!m.length)results.innerHTML=`<div class="search-item">${escapeHtml(translations.no_results||'Ничего не найдено')}</div>`;results.classList.remove('hidden');}); clear?.addEventListener('click',()=>{input.value='';clear.classList.add('hidden');results.classList.add('hidden');input.focus();}); }
function initGalleryViewer(){ const a=document.getElementById('detail-image'),b=document.getElementById('object-detail-image'); a?.addEventListener('click',()=>openImageViewer(a.src));b?.addEventListener('click',()=>openImageViewer(b.src)); }
function openImageViewer(src){if(!src)return;const v=document.getElementById('image-viewer');document.getElementById('image-viewer-img').src=src;v.classList.remove('hidden');requestAnimationFrame(()=>v.classList.add('is-open'));}
function closeImageViewer(){const v=document.getElementById('image-viewer');v.classList.remove('is-open');setTimeout(()=>v.classList.add('hidden'),220);}

// QR viewer controls. These functions are intentionally defined before init(),
// because init wires their click handlers during startup.
function openQrViewer(){
  const viewer=document.getElementById('qr-viewer');
  const img=document.getElementById('object-detail-qr-code');
  const target=document.getElementById('qr-viewer-img');
  const list=document.getElementById('qr-viewer-sources');
  if(!viewer || !img || !target || !img.src) return;
  target.src=img.src;
  if(list){
    list.innerHTML='';
    const url=img.dataset.url || currentObject?.qrUrl || '';
    if(url){
      const li=document.createElement('li');
      const a=document.createElement('a');
      a.href=url; a.target='_blank'; a.rel='noopener noreferrer';
      a.textContent=url; li.appendChild(a); list.appendChild(li);
    }
  }
  viewer.classList.remove('hidden');
  requestAnimationFrame(()=>viewer.classList.add('is-open'));
}
function closeQrViewer(){
  const v=document.getElementById('qr-viewer');
  if(!v) return;
  v.classList.remove('is-open');
  setTimeout(()=>v.classList.add('hidden'),220);
}

async function changeLanguage(lang){
  const saved={view:currentView,id:currentObject?.id||null,origin:detailOrigin?{...detailOrigin}:null,mapFilter:currentFilter,catalogFilter,catalogSearch,catalogScrollTop,mapCenter:map?.getCenter()?.clone(),mapZoom:map?.getZoom()};
  await loadData(lang); await loadLocale(lang); currentFilter=saved.mapFilter;catalogFilter=saved.catalogFilter;catalogSearch=saved.catalogSearch;catalogScrollTop=saved.catalogScrollTop; currentObject=saved.id?getCurrentObjById(saved.id):null; detailOrigin=saved.origin;
  renderCatalogFilters();renderCatalog();renderObjects();
  if(saved.view==='map'&&currentObject)refreshSidebar();
  if(saved.view==='object-detail')renderObjectDetail();
  showView(saved.view);
  requestAnimationFrame(()=>{if(saved.view==='map'&&map&&saved.mapCenter&&saved.mapZoom)map.setView(saved.mapCenter,saved.mapZoom,{animate:false});if(saved.view==='objects'){const sc=document.getElementById('objects-catalog-view');if(sc)sc.scrollTop=saved.catalogScrollTop;}});
}


/* v14 safety net: critical controls use one capture-phase delegate. */
document.addEventListener('click', (e) => {
  const langBtn = e.target.closest?.('#lang-btn');
  if (langBtn) {
    e.preventDefault(); e.stopImmediatePropagation();
    document.getElementById('lang-dropdown')?.classList.toggle('hidden');
    return;
  }
  const langOption = e.target.closest?.('.lang-option');
  if (langOption) {
    e.preventDefault(); e.stopImmediatePropagation();
    const lang = langOption.dataset.lang;
    document.getElementById('lang-dropdown')?.classList.add('hidden');
    if (lang && lang !== currentLang) changeLanguage(lang);
    return;
  }
  const detailsBtn = e.target.closest?.('.catalog-details-btn');
  if (detailsBtn) {
    e.preventDefault(); e.stopImmediatePropagation();
    const card = detailsBtn.closest('.catalog-card');
    const id = card?.dataset?.id;
    const obj = id ? getCurrentObjById(id) : null;
    if (obj) openObjectDetail(obj, 'objects');
    return;
  }
  const expandBtn = e.target.closest?.('#expand-sidebar-btn');
  if (expandBtn) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (currentObject) openObjectDetail(currentObject, 'map');
    return;
  }
  const catalogMapBtn = e.target.closest?.('.catalog-map-link');
  if (catalogMapBtn) {
    e.preventDefault(); e.stopImmediatePropagation();
    const card = catalogMapBtn.closest('.catalog-card');
    const id = card?.dataset?.id;
    const obj = id ? getCurrentObjById(id) : null;
    if (obj) {
      catalogScrollTop=document.getElementById('objects-catalog-view')?.scrollTop||catalogScrollTop;
      selectObject(obj,true,true);
    }
    return;
  }
  const viewBtn = e.target.closest?.('[data-view]');
  if (viewBtn) {
    e.preventDefault(); e.stopImmediatePropagation();
    showView(viewBtn.dataset.view);
  }
}, true);

let aiToastTimer=null;
function showAiToast(){
  const toast=document.getElementById('ai-toast'); if(!toast)return;
  const text=document.getElementById('ai-toast-text'); if(text)text.textContent=translations.under_development||'В разработке';
  toast.classList.remove('hidden'); toast.classList.remove('is-hiding');
  clearTimeout(aiToastTimer);
  aiToastTimer=setTimeout(()=>{toast.classList.add('is-hiding'); setTimeout(()=>toast.classList.add('hidden'),260);},1900);
}

function reportPageName(){
  const labels={home:'Главная',map:'Карта',objects:'Объекты',about:'О проекте','object-detail':'Объект'};
  return labels[currentView]||currentView;
}
function openReportModal(){
  const modal=document.getElementById('report-error-modal'); if(!modal)return;
  const pageField=document.getElementById('report-error-page'); if(pageField)pageField.value=reportPageName();
  const obj=currentObject?.name||''; const objectField=document.getElementById('report-error-object'); if(objectField)objectField.value=obj;
  const urlField=document.getElementById('report-error-url'); if(urlField)urlField.value=location.href;
  const status=document.getElementById('report-error-status'); if(status){status.textContent='';status.className='report-error-status';}
  const message=document.getElementById('report-error-message'); if(message)message.value='';
  modal.classList.remove('hidden'); document.body.classList.add('report-modal-open');
  requestAnimationFrame(()=>message?.focus());
}
function closeReportModal(){
  const modal=document.getElementById('report-error-modal'); if(!modal)return;
  modal.classList.add('hidden'); document.body.classList.remove('report-modal-open');
}
async function submitErrorReport(e){
  e.preventDefault();
  const form=document.getElementById('report-error-form'); if(!form)return;
  const status=document.getElementById('report-error-status'); const submit=document.getElementById('report-error-submit');
  const message=document.getElementById('report-error-message')?.value.trim();
  if(!message){ status.textContent='Опишите ошибку, пожалуйста.'; status.className='report-error-status is-error'; return; }
  if(!REPORT_EMAIL || REPORT_EMAIL.includes('YOUR_EMAIL@')){
    status.textContent='Сначала укажи почту получателя в report-config.js.';
    status.className='report-error-status is-error'; return;
  }
  submit.disabled=true;
  status.textContent='Отправляем отчёт…'; status.className='report-error-status';
  const data={
    page:document.getElementById('report-error-page')?.value||'',
    object:document.getElementById('report-error-object')?.value||'',
    url:document.getElementById('report-error-url')?.value||location.href,
    message,
    email:document.getElementById('report-error-email')?.value.trim()||'',
    _subject:`Ошибка на сайте «Заповедная Бобруйщина» — ${reportPageName()}`,
    _template:'table',
    _captcha:'true'
  };
  try{
    const r=await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(REPORT_EMAIL)}`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(data)});
    const result=await r.json().catch(()=>({}));
    if(!r.ok || result.success===false) throw new Error(result.message||'Не удалось отправить отчёт');
    status.textContent='Отчёт отправлен. Спасибо!'; status.className='report-error-status is-ok';
    form.reset();
    setTimeout(closeReportModal,1200);
  }catch(err){
    console.error('Error report submission failed:',err);
    status.textContent='Не удалось отправить автоматически. Проверь соединение или почту получателя.';
    status.className='report-error-status is-error';
  }finally{ submit.disabled=false; }
}

function init(){
  const theme=localStorage.getItem('bobruisk-theme')||'light';
  document.documentElement.dataset.theme=theme;
  const ti=document.querySelector('.theme-icon');
  if(ti)ti.src=theme==='dark'?'icons/moon.svg':'icons/sun.svg';

  // IMPORTANT: wire the application UI before touching Leaflet.
  // If a CDN/library fails, navigation and the catalogue must still work.
  document.addEventListener('click',e=>{
    const viewBtn=e.target.closest('[data-view]');
    if(viewBtn){e.preventDefault();showView(viewBtn.dataset.view);return;}
    if(!e.target.closest('.search-box'))document.getElementById('search-results')?.classList.add('hidden');
  });
  document.getElementById('brand-home')?.addEventListener('click',e=>{e.preventDefault();detailOrigin=null;currentObject=null;closeSidebar();showView('home');});
  document.getElementById('fit-all-btn')?.addEventListener('click',fitAllObjects);
  document.getElementById('ai-btn')?.addEventListener('click',showAiToast);
  document.getElementById('mobile-object-panel-btn')?.addEventListener('click',()=>document.querySelector('.sidebar-left')?.classList.toggle('mobile-open'));
  document.getElementById('theme-toggle')?.addEventListener('click',()=>{
    const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
    document.documentElement.dataset.theme=next;
    localStorage.setItem('bobruisk-theme',next);
    const icon=document.querySelector('.theme-icon');
    if(icon)icon.src=next==='dark'?'icons/moon.svg':'icons/sun.svg';
  });
  document.getElementById('map-layer-select')?.addEventListener('change',e=>{
    if(!map||!window.L)return;
    const factory=tileLayers[e.target.value];if(!factory)return;
    if(baseLayer)map.removeLayer(baseLayer);baseLayer=factory().addTo(map);
  });
  document.querySelectorAll('.filter-btn').forEach(b=>b.addEventListener('click',()=>{
    currentFilter=b.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(x=>x.classList.toggle('active',x===b));
    renderObjects();
  }));
  document.querySelector('.gallery-arrow.prev')?.addEventListener('click',()=>switchSidebarImage(-1));
  document.querySelector('.gallery-arrow.next')?.addEventListener('click',()=>switchSidebarImage(1));
  document.getElementById('expand-sidebar-btn')?.addEventListener('click',()=>openObjectDetail(currentObject,'map'));
  document.getElementById('close-right-sidebar')?.addEventListener('click',closeSidebar);
  document.getElementById('object-detail-back')?.addEventListener('click',backFromDetail);
  document.getElementById('object-detail-close')?.addEventListener('click',backFromDetail);
  document.getElementById('object-detail-gallery-prev')?.addEventListener('click',()=>switchDetailImage(-1));
  document.getElementById('object-detail-gallery-next')?.addEventListener('click',()=>switchDetailImage(1));
  document.getElementById('lang-btn')?.addEventListener('click',e=>{e.stopPropagation();document.getElementById('lang-dropdown')?.classList.toggle('hidden');});
  document.querySelectorAll('.lang-option').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();document.getElementById('lang-dropdown')?.classList.add('hidden');if(b.dataset.lang!==currentLang)changeLanguage(b.dataset.lang);}));
  document.addEventListener('click',e=>{if(!e.target.closest('.lang-switcher'))document.getElementById('lang-dropdown')?.classList.add('hidden');});
  document.getElementById('close-image-viewer')?.addEventListener('click',closeImageViewer);
  document.getElementById('image-viewer')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeImageViewer();});
  document.getElementById('object-detail-qr-expand')?.addEventListener('click',()=>openQrViewer());
  document.getElementById('close-qr-viewer')?.addEventListener('click',closeQrViewer);
  document.getElementById('qr-viewer')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeQrViewer();});
  document.getElementById('report-error-btn')?.addEventListener('click',openReportModal); document.getElementById('report-error-close')?.addEventListener('click',closeReportModal); document.getElementById('report-error-cancel')?.addEventListener('click',closeReportModal); document.getElementById('report-error-form')?.addEventListener('submit',submitErrorReport); document.getElementById('report-error-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeReportModal();});
  initCatalogSearch();initMapSearch();initGalleryViewer();initHeroSlideshow();


  function fallbackPoint(coords){
    const bounds={south:52.88,north:53.30,west:28.95,east:29.55};
    const lat=Number(coords[0]),lng=Number(coords[1]);
    return {x:Math.max(2,Math.min(98,(lng-bounds.west)/(bounds.east-bounds.west)*100)),y:Math.max(2,Math.min(98,(bounds.north-lat)/(bounds.north-bounds.south)*100))};
  }
  function initFallbackMap(){
    if(map || fallbackMap) return !!fallbackMap;
    const mapEl=document.getElementById('map'); if(!mapEl) return false;
    fallbackMap={bounds:{south:52.88,north:53.30,west:28.95,east:29.55}};
    mapEl.classList.add('fallback-map');
    mapEl.innerHTML='<iframe class="fallback-map-frame" title="Карта Бобруйщины" src="https://www.openstreetmap.org/export/embed.html?bbox=28.95%2C52.88%2C29.55%2C53.30&amp;layer=mapnik" loading="lazy"></iframe><div id="fallback-marker-layer" class="fallback-marker-layer"></div><div class="fallback-map-note">OpenStreetMap</div>';
    renderObjects();
    return true;
  }
  function focusFallbackMap(obj){
    const frame=document.querySelector('.fallback-map-frame'); if(!frame||!obj?.coords) return;
    const [lat,lng]=obj.coords;
    frame.src=`https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.06}%2C${lat-0.04}%2C${lng+0.06}%2C${lat+0.04}&layer=mapnik&marker=${lat}%2C${lng}`;
  }

  function initLeafletMap(){
    if(map || !window.L) return !!map;
    const mapEl=document.getElementById('map');
    if(!mapEl) return false;
    try{
      map=L.map(mapEl,{zoomControl:false,preferCanvas:true,attributionControl:true});
      map.setView([53.1384,29.2223],11);
      L.control.zoom({position:'bottomleft'}).addTo(map);

      // OSM is the reliable default; the hybrid layer remains available from
      // the selector. A failed tile source must never prevent markers from
      // rendering.
      const initialStyle=document.getElementById('map-layer-select')?.value||'hybrid';
      baseLayer=(tileLayers[initialStyle]||tileLayers.hybrid)();
      baseLayer.addTo(map);
      markerLayer=L.layerGroup().addTo(map);
      mapEl.classList.remove('map-unavailable');
      requestAnimationFrame(()=>{map.invalidateSize();renderObjects();});
      return true;
    }catch(err){
      console.error('Leaflet initialization failed:',err);
      map=null;markerLayer=null;
      mapEl.classList.add('map-unavailable');
      return false;
    }
  }

  // Boot data first, then create the map. This removes the race that previously
  // produced an empty list/zero count and a marker layer rendered before data existed.
  (async()=>{
    try{ await loadLocale('ru'); await loadData('ru'); }
    catch(err){ console.error('Application data initialization failed:',err); currentData=normalizeData(window.EMBEDDED_DATA?.ru||[]); }
    renderCatalogFilters(); renderCatalog(); updateStats();
    if(!initLeafletMap()) initFallbackMap(); renderObjects(); showView('home');
    window.addEventListener('load',()=>{ if(initLeafletMap()){ renderObjects(); map?.invalidateSize(); } else { initFallbackMap(); renderObjects(); } },{once:true});
    setTimeout(()=>{ if(initLeafletMap()){ renderObjects(); map?.invalidateSize(); } else { initFallbackMap(); renderObjects(); } },900);
  })();

  window.addEventListener('resize',()=>map?.invalidateSize());
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(!document.getElementById('report-error-modal')?.classList.contains('hidden'))closeReportModal();
      else if(!document.getElementById('image-viewer')?.classList.contains('hidden'))closeImageViewer();
      else if(!document.getElementById('qr-viewer')?.classList.contains('hidden'))closeQrViewer();
      else if(currentView==='object-detail')backFromDetail();
      else if(currentView==='map')closeSidebar();
    }
  });
}
document.addEventListener('DOMContentLoaded',init);
