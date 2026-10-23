/* A local, dependency-free detail viewer for the architecture map. */
(function () {
  'use strict';

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const STEP = 1.3;
  let dialog, viewport, world, zoomOut, zoomIn, zoomValue, closeButton;
  let opened = false;
  let previousFocus = null;
  let inertState = [];
  let cloneNumber = 0;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let sourceWidth = 1800;
  let sourceHeight = 720;
  let baseWidth = 0;
  let baseHeight = 0;
  const pointers = new Map();

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(label, text, action, className) {
    const node = element('button', className || 'map-tool', text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    node.title = label;
    node.addEventListener('click', action);
    return node;
  }

  function keepInBounds() {
    const maxX = Math.max(0, (baseWidth * zoom - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (baseHeight * zoom - viewport.clientHeight) / 2);
    panX = clamp(panX, -maxX, maxX);
    panY = clamp(panY, -maxY, maxY);
  }

  function paint() {
    if (!opened || !baseWidth) return;
    keepInBounds();
    const left = (viewport.clientWidth - baseWidth * zoom) / 2 + panX;
    const top = (viewport.clientHeight - baseHeight * zoom) / 2 + panY;
    world.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${zoom})`;
    const percent = Math.round(zoom * 100);
    zoomValue.textContent = percent + '%';
    zoomValue.setAttribute('aria-label', 'Масштаб ' + percent + ' процентов относительно вписывания');
    zoomOut.disabled = zoom <= MIN_ZOOM + .001;
    zoomIn.disabled = zoom >= MAX_ZOOM - .001;
    viewport.classList.toggle('can-pan', zoom > MIN_ZOOM + .001);
  }

  function measure() {
    if (!opened || !viewport.clientWidth || !viewport.clientHeight) return;
    const oldWidth = baseWidth;
    const roomX = Math.max(1, viewport.clientWidth - 36);
    const roomY = Math.max(1, viewport.clientHeight - 36);
    const fit = Math.min(roomX / sourceWidth, roomY / sourceHeight);
    baseWidth = sourceWidth * fit;
    baseHeight = sourceHeight * fit;
    if (oldWidth) {
      const ratio = baseWidth / oldWidth;
      panX *= ratio;
      panY *= ratio;
    }
    world.style.width = baseWidth + 'px';
    world.style.height = baseHeight + 'px';
    paint();
  }

  function setZoom(value, point) {
    if (!opened) return;
    const next = clamp(value, MIN_ZOOM, MAX_ZOOM);
    const anchor = point || { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    const dx = anchor.x - viewport.clientWidth / 2;
    const dy = anchor.y - viewport.clientHeight / 2;
    panX = dx - (dx - panX) * next / zoom;
    panY = dy - (dy - panY) * next / zoom;
    zoom = next;
    paint();
  }

  function fitMap() {
    zoom = 1;
    panX = 0;
    panY = 0;
    measure();
  }

  function localPoint(event) {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerPair() {
    const list = Array.from(pointers.values());
    if (list.length < 2) return null;
    return {
      x: (list[0].x + list[1].x) / 2,
      y: (list[0].y + list[1].y) / 2,
      distance: Math.max(1, Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y)),
    };
  }

  function releasePointers() {
    for (const id of pointers.keys()) {
      try { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); } catch (_) { /* A pointer may already have ended. */ }
    }
    pointers.clear();
    viewport.classList.remove('is-dragging');
  }

  function copyMap(source) {
    const copy = source.cloneNode(true);
    const prefix = 'map-detail-' + (++cloneNumber) + '-';
    const ids = new Map();
    const all = [copy, ...copy.querySelectorAll('*')];
    all.forEach(node => {
      if (!node.id) return;
      ids.set(node.id, prefix + node.id);
      node.id = prefix + node.id;
    });
    all.forEach(node => {
      for (const attribute of [...node.attributes]) {
        if (attribute.name === 'id') continue;
        let value = attribute.value.replace(/url\(\s*(['"]?)#([^'"\)\s]+)\1\s*\)/g, (match, quote, id) => ids.has(id) ? 'url(#' + ids.get(id) + ')' : match);
        if ((attribute.localName === 'href') && value[0] === '#' && ids.has(value.slice(1))) value = '#' + ids.get(value.slice(1));
        if (['aria-labelledby', 'aria-describedby'].includes(attribute.name)) value = value.split(/\s+/).map(id => ids.get(id) || id).join(' ');
        if (value !== attribute.value) node.setAttributeNS(attribute.namespaceURI, attribute.name, value);
      }
    });
    copy.querySelectorAll('style').forEach(style => {
      let text = style.textContent;
      for (const [oldId, newId] of ids) {
        const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp('#' + escaped + '(?=[\\s),.:{\\[]|$)', 'g'), '#' + newId);
      }
      style.textContent = text;
    });
    copy.removeAttribute('width');
    copy.removeAttribute('height');
    copy.removeAttribute('tabindex');
    copy.setAttribute('focusable', 'false');
    copy.setAttribute('aria-hidden', 'true');
    const box = (copy.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (box.length === 4 && box[2] > 0 && box[3] > 0) {
      sourceWidth = box[2];
      sourceHeight = box[3];
    } else {
      sourceWidth = 1800;
      sourceHeight = 720;
      copy.setAttribute('viewBox', '0 0 1800 720');
    }
    copy.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return copy;
  }

  function focusable() {
    return [...dialog.querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter(node => !node.hidden && node.getClientRects().length);
  }

  function onKey(event) {
    if (!opened) return;
    // The presentation owns these keys outside the viewer only.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom(zoom * STEP);
    } else if (event.key === '-' || event.key === '−') {
      event.preventDefault();
      setZoom(zoom / STEP);
    } else if (event.key === '0' || event.key === 'Home') {
      event.preventDefault();
      fitMap();
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const amount = event.shiftKey ? 90 : 40;
      if (event.key === 'ArrowLeft') panX += amount;
      if (event.key === 'ArrowRight') panX -= amount;
      if (event.key === 'ArrowUp') panY += amount;
      if (event.key === 'ArrowDown') panY -= amount;
      paint();
    }
  }

  function build() {
    if (dialog) return;
    dialog = element('div', 'architecture-viewer');
    dialog.id = 'architecture-viewer';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'architecture-viewer-title');
    const shell = element('div', 'map-shell');
    const header = element('div', 'map-header');
    const heading = element('h2', 'map-title', 'Карта архитектуры');
    heading.id = 'architecture-viewer-title';
    const toolbar = element('div', 'map-toolbar');
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Управление масштабом');
    zoomOut = button('Уменьшить масштаб', '−', () => setZoom(zoom / STEP));
    zoomValue = element('output', 'map-zoom-value', '100%');
    zoomIn = button('Увеличить масштаб', '+', () => setZoom(zoom * STEP));
    const fit = button('Вписать карту в окно', 'Вписать', fitMap, 'map-tool map-fit');
    closeButton = button('Закрыть карту архитектуры', '×', close, 'map-tool map-close');
    toolbar.append(zoomOut, zoomValue, zoomIn, fit, closeButton);
    header.append(heading, toolbar);
    viewport = element('div', 'map-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Карта архитектуры. Плюс и минус меняют масштаб, стрелки перемещают карту, ноль вписывает её в окно.');
    world = element('div', 'map-world e-figure');
    viewport.append(world);
    const footer = element('div', 'map-footer', 'Масштаб · перетаскивание');
    shell.append(header, viewport, footer);
    dialog.append(shell);
    document.body.append(dialog);
    dialog.addEventListener('keydown', onKey);
    dialog.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    viewport.addEventListener('wheel', event => {
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const delta = clamp(event.deltaY * unit, -160, 160);
      setZoom(zoom * Math.exp(-delta * .002), localPoint(event));
    }, { passive: false });
    viewport.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      viewport.focus({ preventScroll: true });
      pointers.set(event.pointerId, localPoint(event));
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
    });
    viewport.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      const previous = pointers.get(event.pointerId);
      const before = pointerPair();
      const now = localPoint(event);
      pointers.set(event.pointerId, now);
      const after = pointerPair();
      if (before && after) {
        panX += after.x - before.x;
        panY += after.y - before.y;
        setZoom(zoom * after.distance / before.distance, after);
      } else {
        panX += now.x - previous.x;
        panY += now.y - previous.y;
        paint();
      }
    });
    const finishPointer = event => {
      pointers.delete(event.pointerId);
      try { if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId); } catch (_) { /* Already released. */ }
      if (!pointers.size) viewport.classList.remove('is-dragging');
    };
    viewport.addEventListener('pointerup', finishPointer);
    viewport.addEventListener('pointercancel', finishPointer);
    viewport.addEventListener('lostpointercapture', finishPointer);
    if ('ResizeObserver' in window) new ResizeObserver(measure).observe(viewport);
    else window.addEventListener('resize', measure);
  }

  function open() {
    if (opened) return true;
    const candidate = document.querySelector('#ecosystem-map, svg.ecosystem-map, .ecosystem-map svg');
    const source = candidate?.tagName.toLowerCase() === 'svg' ? candidate : candidate?.querySelector('svg');
    if (!source) return false;
    build();
    previousFocus = document.activeElement;
    world.replaceChildren(copyMap(source));
    zoom = 1;
    panX = panY = 0;
    baseWidth = baseHeight = 0;
    opened = true;
    dialog.hidden = false;
    inertState = [...document.body.children].filter(node => node !== dialog && !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)).map(node => [node, node.inert]);
    inertState.forEach(([node]) => { node.inert = true; });
    document.getElementById('map-open')?.setAttribute('aria-expanded', 'true');
    measure();
    closeButton.focus({ preventScroll: true });
    return true;
  }

  function close() {
    if (!opened) return;
    releasePointers();
    opened = false;
    dialog.hidden = true;
    inertState.forEach(([node, wasInert]) => { if (node.isConnected) node.inert = wasInert; });
    inertState = [];
    document.getElementById('map-open')?.setAttribute('aria-expanded', 'false');
    if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest?.('#map-open');
    if (!trigger) return;
    event.preventDefault();
    open();
  });
  function prepareTrigger() {
    const trigger = document.getElementById('map-open');
    if (!trigger) return;
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'architecture-viewer');
    build();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepareTrigger, { once: true });
  else prepareTrigger();
  window.DesnitsaMapViewer = { open, close, get isOpen() { return opened; } };
}());
