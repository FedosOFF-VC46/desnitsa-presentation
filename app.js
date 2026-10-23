(function () {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const slides = $$('.slide');
  const speech = window.DESNITSA_SPEECH || [];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));
  let paused = false, autoplay = false, slideElapsed = 0, elapsed = 0, started = false;
  let lastTick = performance.now(), demoManual = false, integrityManual = false, testManual = false;
  let wheelSum = 0, wheelTime = 0, lastNav = 0, touchStart = null;
  let demoPhase = -1, integrityMode = '', selectedTest = -1, overviewReturnFocus = null;
  const graph = window.DesnitsaVisuals;
  const demoTimes = [0, 9000, 18500, 28500, 37500];
  const statusTexts = ['Источник зарегистрирован', 'Предложение ИИ · требует проверки', 'Цитата связана со страницей источника', 'Правка человека сохранена как V2', 'Версия V2 подтверждена · пакет готов'];
  const testTexts = [
    'Изменённые байты предъявляются под идентификатором прежней версии.',
    'Файл не меняется, но в паспорте подменены источник или сведения об авторе.',
    'Подтверждение прежней редакции пытаются применить к новому тексту.',
    'Версия подлинная, но не последняя: целостность и актуальность проверяются отдельно.',
    'Проверяются отсутствие дублей и корректный статус при потере ответа после отправки.'
  ];
  const knownHashes = {};
  // These are actual SHA-256 values of the two illustrative strings, generated at packaging time.
  const precomputed = window.DESNITSA_HASHES || {};

  function resize() {
    const mapMode = slides[current]?.classList.contains('ecosystem-slide');
    document.body.classList.toggle('ecosystem-mode', mapMode);
    const scale = mapMode ? Math.min((innerWidth - 72) / 1680, (innerHeight - 170) / 850, 1.8) : Math.min((innerWidth - 96) / 1400, (innerHeight - 192) / 740, 1.8);
    document.documentElement.style.setProperty('--scale', Math.max(.2, scale));
  }
  function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  function setDemoPhase(phase) {
    if (demoPhase === phase) return;
    demoPhase = phase;
    $('#product-demo').dataset.phase = String(phase);
    $('#demo-status span').textContent = statusTexts[phase];
    const confirm = $('.confirm-demo');
    confirm.disabled = phase !== 3;
    confirm.innerHTML = phase === 4 ? 'Версия V2 подтверждена <span>✓</span>' : 'Подтвердить версию V2 <span>✓</span>';
    $$('.demo-steps [data-demo-step]').forEach((b, i) => { b.classList.toggle('active', i === phase); b.setAttribute('aria-pressed', String(i === phase)); });
  }
  function shortHash(year) { const h = knownHashes[year] || precomputed[year]; return h ? h.slice(0, 12) + '…' + h.slice(-6) : 'Вычисление…'; }
  function setIntegrity(mode) {
    if (integrityMode === mode) return;
    integrityMode = mode;
    const tampered = mode === 'tampered', offline = mode === 'offline';
    $('.integrity-slide').classList.toggle('tampered', tampered);
    $('#integrity-year').textContent = tampered ? '1925' : '1926';
    $('#current-hash').textContent = shortHash(tampered ? 1925 : 1926);
    $('#anchor-hash').textContent = offline ? 'Запись недоступна' : shortHash(1926);
    $('#hash-symbol').textContent = offline ? '?' : tampered ? '≠' : '=';
    $('#hash-symbol').style.color = offline ? '#99afcf' : tampered ? '#edb97d' : '#86c5b3';
    const result = $('#integrity-result');
    result.className = 'integrity-result' + (offline ? ' unavailable' : tampered ? ' mismatch' : '');
    const title = offline ? 'Проверка недоступна' : tampered ? 'Обнаружено несоответствие' : 'Версия совпадает';
    const description = offline ? 'Недоступность не означает подделку или успех' : tampered ? 'Файл отличается от зарегистрированной версии' : 'Сверка с известной опорной записью';
    result.replaceChildren();
    const icon = document.createElement('span'); icon.textContent = offline ? '◷' : tampered ? '≠' : '✓';
    const label = document.createElement('div'); label.textContent = title;
    const sub = document.createElement('small'); sub.textContent = description;
    label.append(sub); result.append(icon, label);
  }
  async function computeHashes() {
    for (const year of [1926, 1925]) {
      try {
        const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('Школа открылась в ' + year + ' году'));
        knownHashes[year] = [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (_) { knownHashes[year] = precomputed[year]; }
    }
    const old = integrityMode || 'valid'; integrityMode = ''; setIntegrity(old);
  }
  function setTest(index) {
    if (selectedTest === index) return;
    selectedTest = index;
    $$('.test-chips button').forEach((b, i) => { b.classList.toggle('active', i === index); b.setAttribute('aria-pressed', String(i === index)); });
    $('#test-explanation').textContent = testTexts[index];
  }
  function updateNotes() {
    const item = speech[current];
    $('#notes-title').textContent = String(current + 1).padStart(2, '0') + ' / ' + (item?.title || slides[current].dataset.title);
    $('#notes-duration').textContent = 'Ориентир: ' + (item?.duration || 40) + ' секунд · переход после завершения мысли';
    const content = $('#notes-content'); content.replaceChildren();
    (item?.notes || 'Текст выступления недоступен.').split(/\n\s*\n/).forEach(text => { const p = document.createElement('p'); p.textContent = text; content.append(p); });
    $('#notes-panel').scrollTop = 0;
  }
  function closeOverview() {
    if ($('#overview').hidden) return;
    $('#overview').hidden = true; $('#overview-toggle').setAttribute('aria-expanded', 'false');
    overviewReturnFocus?.focus();
  }
  function toggleOverview() {
    if (!$('#overview').hidden) { closeOverview(); return; }
    overviewReturnFocus = document.activeElement;
    $('#overview').hidden = false; $('#overview-toggle').setAttribute('aria-expanded', 'true'); $('#overview-close').focus();
  }
  function toggleNotes() { $('#notes-panel').hidden = !$('#notes-panel').hidden; $('#notes-toggle').classList.toggle('active', !$('#notes-panel').hidden); $('#notes-toggle').setAttribute('aria-expanded', String(!$('#notes-panel').hidden)); }
  function show(index, options = {}) {
    const next = Math.max(0, Math.min(slides.length - 1, index));
    if (next === current && !options.force) return;
    graph?.leave(current); current = next; slideElapsed = 0; lastNav = performance.now();
    if (!options.initial) started = true;
    $('#keyboard-hint').classList.toggle('dismissed', current !== 0 || !options.initial);
    demoManual = false; integrityManual = false; testManual = false;
    slides.forEach((slide, i) => {
      const active = i === current;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', String(!active)); slide.inert = !active;
      if (active) slide.scrollTop = 0;
    });
    $$('#progress-nav button').forEach((b, i) => { b.classList.toggle('active', i === current); b.classList.toggle('past', i < current); b.setAttribute('aria-current', i === current ? 'step' : 'false'); });
    $$('#overview-grid button').forEach((b, i) => b.classList.toggle('current', i === current));
    $('#current-slide').textContent = String(current + 1).padStart(2, '0');
    $('#prev').disabled = current === 0; $('#next').disabled = current === slides.length - 1;
    history.replaceState(null, '', '#' + (current + 1));
    document.title = 'Десница · ' + (current + 1) + '/' + slides.length + ' · ' + slides[current].dataset.title;
    $('#announcement').textContent = 'Экран ' + (current + 1) + ' из ' + slides.length + '. ' + slides[current].dataset.title;
    resize(); updateNotes(); graph?.enter(current);
    if (current === 6) { demoPhase = -1; setDemoPhase(reduced.matches ? 4 : 0); }
    if (current === 9) { integrityMode = ''; setIntegrity('valid'); $$('.scenario-controls button').forEach(b => b.classList.toggle('selected', b.dataset.integrity === 'auto')); }
    if (current === 11) { selectedTest = -1; setTest(0); }
  }
  function togglePaused() {
    paused = !paused; document.body.classList.toggle('motion-paused', paused);
    $('#motion-toggle').textContent = paused ? '▶' : 'Ⅱ';
    $('#motion-toggle').classList.toggle('active', paused);
    $('#motion-toggle').setAttribute('aria-label', paused ? 'Продолжить анимации' : 'Пауза анимаций');
    graph?.setPaused(paused);
  }
  function toggleAutoplay() {
    autoplay = !autoplay; if (autoplay) { started = true; slideElapsed = 0; }
    $('#autoplay-toggle').classList.toggle('active', autoplay);
    $('#autoplay-toggle').textContent = autoplay ? '■' : '▷';
    $('#autoplay-toggle').setAttribute('aria-label', autoplay ? 'Выключить автопереход экранов' : 'Включить автопереход экранов');
  }
  async function fullscreen() {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); }
    catch (_) { $('#announcement').textContent = 'Полноэкранный режим недоступен в этом браузере. Используйте полноэкранный режим окна.'; }
  }

  slides.forEach((slide, index) => {
    const b = document.createElement('button'); b.title = (index + 1) + '. ' + slide.dataset.title; b.setAttribute('aria-label', 'Экран ' + (index + 1) + '. ' + slide.dataset.title); b.addEventListener('click', () => show(index)); $('#progress-nav').append(b);
    const thumb = document.createElement('button'); const n = document.createElement('span'); n.textContent = String(index + 1).padStart(2, '0'); thumb.append(n, document.createTextNode(slide.dataset.title)); thumb.addEventListener('click', () => { closeOverview(); show(index); }); $('#overview-grid').append(thumb);
  });
  for (let i = 0; i < 40; i++) { const dot = document.createElement('i'); dot.style.animationDelay = (i * .055) + 's'; $('.corpus-dots').append(dot); }
  $('#next').addEventListener('click', () => show(current + 1)); $('#prev').addEventListener('click', () => show(current - 1));
  $('.brand').addEventListener('click', e => { e.preventDefault(); show(0); });
  $('#notes-toggle').addEventListener('click', toggleNotes); $('#notes-close').addEventListener('click', toggleNotes);
  $('#overview-toggle').addEventListener('click', toggleOverview); $('#overview-close').addEventListener('click', closeOverview);
  $('#motion-toggle').addEventListener('click', togglePaused); $('#autoplay-toggle').addEventListener('click', toggleAutoplay); $('#fullscreen-toggle').addEventListener('click', fullscreen);
  $$('[data-demo-step]').forEach(b => b.addEventListener('click', () => { demoManual = true; setDemoPhase(Number(b.dataset.demoStep)); }));
  $('#replay-demo').addEventListener('click', () => { demoManual = false; slideElapsed = 0; demoPhase = -1; setDemoPhase(0); });
  $('.confirm-demo').addEventListener('click', () => { demoManual = true; setDemoPhase(4); });
  $$('[data-integrity]').forEach(b => b.addEventListener('click', () => {
    const mode = b.dataset.integrity; integrityManual = mode !== 'auto';
    $$('.scenario-controls button').forEach(btn => btn.classList.toggle('selected', btn === b));
    if (mode === 'auto') { slideElapsed = 0; setIntegrity('valid'); } else setIntegrity(mode);
  }));
  $$('[data-test]').forEach(b => b.addEventListener('click', () => { testManual = true; setTest(Number(b.dataset.test)); }));
  document.addEventListener('keydown', e => {
    if (window.DesnitsaMapViewer?.isOpen || e.defaultPrevented) return;
    if (e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { closeOverview(); if (!$('#notes-panel').hidden) toggleNotes(); return; }
    if (!$('#overview').hidden) {
      if (e.key === 'Tab') {
        const focusable = $$('#overview button'), first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'ArrowDown' || e.code === 'Space') {
      if (e.code === 'Space' && /BUTTON|A/.test(e.target.tagName)) return;
      e.preventDefault(); show(current + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); show(current - 1); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
    else if (['n', 'N', 'т', 'Т'].includes(e.key)) toggleNotes();
    else if (['o', 'O', 'щ', 'Щ'].includes(e.key)) toggleOverview();
    else if (['p', 'P', 'з', 'З'].includes(e.key)) togglePaused();
    else if (['f', 'F', 'а', 'А'].includes(e.key)) fullscreen();
    else if (['r', 'R', 'к', 'К'].includes(e.key)) { elapsed = 0; started = false; $('#elapsed').textContent = '00:00'; show(0, { force: true, initial: true }); }
  });
  document.addEventListener('wheel', e => {
    if (window.DesnitsaMapViewer?.isOpen) return;
    if (innerWidth <= 700 || e.target.closest('#notes-panel,#overview') || !$('#overview').hidden) return;
    e.preventDefault(); const now = performance.now();
    if (now - lastNav < 900) return;
    if (now - wheelTime > 250) wheelSum = 0;
    wheelTime = now; wheelSum += e.deltaY;
    if (Math.abs(wheelSum) > 65) { show(current + Math.sign(wheelSum)); wheelSum = 0; }
  }, { passive: false });
  $('#deck').addEventListener('touchstart', e => { if (e.touches.length === 1) touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  $('#deck').addEventListener('touchend', e => { if (!touchStart) return; const t = e.changedTouches[0]; const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y; if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5) show(current + (dx < 0 ? 1 : -1)); touchStart = null; }, { passive: true });
  window.addEventListener('resize', resize); window.addEventListener('hashchange', () => show((parseInt(location.hash.slice(1), 10) || 1) - 1));
  document.addEventListener('visibilitychange', () => { lastTick = performance.now(); });
  reduced.addEventListener('change', () => { if (current === 6 && reduced.matches) setDemoPhase(4); });
  resize(); graph?.init(document); show(current, { force: true, initial: true }); computeHashes();
  setInterval(() => {
    const now = performance.now(), delta = Math.min(1000, now - lastTick); lastTick = now;
    if (document.hidden || !$('#overview').hidden || window.DesnitsaMapViewer?.isOpen) return;
    if (started) { elapsed += delta; $('#elapsed').textContent = formatTime(elapsed); }
    if (paused) return;
    slideElapsed += delta;
    if (current === 6 && !demoManual && !reduced.matches) setDemoPhase(Math.max(0, demoTimes.findLastIndex(t => slideElapsed >= t)));
    if (current === 9 && !integrityManual && !reduced.matches) setIntegrity(slideElapsed < 11000 ? 'valid' : slideElapsed < 29000 ? 'tampered' : 'offline');
    if (current === 8) $$('[data-arch]').forEach((el, i) => el.classList.toggle('lit', reduced.matches || i === Math.min($$('[data-arch]').length - 1, Math.floor(slideElapsed / 4200))));
    if (current === 11 && !testManual && !reduced.matches) setTest(Math.min(4, Math.floor(slideElapsed / 6500)));
    if (autoplay && slideElapsed >= (speech[current]?.duration || 40) * 1000) {
      if (current < slides.length - 1) show(current + 1); else toggleAutoplay();
    }
  }, 100);
  window.DesnitsaDeck = { goTo: n => show(n - 1), get current() { return current + 1; }, get slideCount() { return slides.length; } };
})();
