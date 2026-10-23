/* Desnitsa: illustrative provenance networks. All data stays in the browser. */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const palette = {
    blue: [69, 137, 255],
    ice: [157, 206, 255],
    cyan: [92, 208, 235],
  };
  const definitions = [
    { label: 'Источник', x: .14, y: .36, text: 'Источник — исходный файл сохраняется отдельно. Запись о загрузке не доказывает авторство.' },
    { label: 'ИИ', x: .36, y: .18, text: 'ИИ — предложение модели связано с цитатой и конкретным источником. Оно требует проверки человеком.' },
    { label: 'Правка', x: .59, y: .35, text: 'Правка — исправление человека сохраняется вместе с исходным предложением модели.' },
    { label: 'Версия', x: .82, y: .19, text: 'Версия — каждое изменение создаёт новую редакцию. Предыдущая остаётся доступна для сравнения.' },
    { label: 'Подтверждение', x: .80, y: .72, text: 'Подтверждение — проверка человека относится к определённой версии и не переносится на следующую автоматически.' },
    { label: 'Паспорт', x: .39, y: .77, text: 'Паспорт — связывает источник, версии и действия. Его цифровой отпечаток позволяет сверить зарегистрированную запись.' },
  ];
  const connections = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 5], [2, 5], [3, 5]];
  let instances = [];
  let activeIndex = 0;
  let manuallyPaused = false;
  let frameId = 0;
  let lastFrameTime = 0;
  let motionQuery;
  let reducedMotion = false;
  let cleanup = [];

  function rgba(color, opacity) {
    return `rgba(${color[0]},${color[1]},${color[2]},${opacity})`;
  }

  function random(seed) {
    let n = seed >>> 0;
    return function () {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      return n / 4294967296;
    };
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function active(item) {
    return item.index === activeIndex;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function glow(ctx, x, y, radius, color, opacity) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(color, opacity));
    gradient.addColorStop(.3, rgba(color, opacity * .35));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }

  function prepare(item) {
    const box = item.canvas.getBoundingClientRect();
    const w = Math.max(1, box.width);
    const h = Math.max(1, box.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(w * ratio);
    const ph = Math.round(h * ratio);
    if (item.canvas.width !== pw || item.canvas.height !== ph) {
      item.canvas.width = pw;
      item.canvas.height = ph;
    }
    item.w = w;
    item.h = h;
    item.ratio = ratio;
    item.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    item.drawn = false;
  }

  function point(item, n) {
    const narrow = item.w < 520;
    const inset = Math.min(44, item.w * .055);
    const x = inset + n.x * (item.w - inset * 2);
    const y = 14 + n.y * (item.h - 55);
    return { x, y, radius: narrow ? 13 : 18 };
  }

  function edge(ctx, from, to, opacity, color, arrow) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const sx = from.x + dx / length * (from.radius + 8);
    const sy = from.y + dy / length * (from.radius + 8);
    const ex = to.x - dx / length * (to.radius + 10);
    const ey = to.y - dy / length * (to.radius + 10);
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(color, opacity);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (arrow) {
      const angle = Math.atan2(dy, dx);
      ctx.fillStyle = rgba(color, opacity * 1.6);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(angle - .42) * 7, ey - Math.sin(angle - .42) * 7);
      ctx.lineTo(ex - Math.cos(angle + .42) * 7, ey - Math.sin(angle + .42) * 7);
      ctx.closePath();
      ctx.fill();
    }
    return { sx, sy, ex, ey };
  }

  function signal(ctx, line, progress, opacity) {
    const x = line.sx + (line.ex - line.sx) * progress;
    const y = line.sy + (line.ey - line.sy) * progress;
    glow(ctx, x, y, 13, palette.ice, opacity * .45);
    ctx.fillStyle = rgba(palette.ice, opacity);
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, TAU);
    ctx.fill();
  }

  function drawHero(item) {
    const { ctx, w, h, elapsed } = item;
    const t = reducedMotion ? 0 : elapsed / 1000;
    const cx = w * .53;
    const cy = h * .49;
    const scale = Math.min(w * .43, h * .43);
    glow(ctx, cx, cy, scale * 1.2, palette.blue, .10);
    const points = item.particles.map((p) => {
      const drift = reducedMotion ? 0 : Math.sin(t * .18 + p.seed) * .018;
      return {
        x: cx + Math.cos(p.angle + drift) * p.radius * scale,
        y: cy + Math.sin(p.angle + drift) * p.radius * scale * .87,
        radius: p.size,
      };
    });
    ctx.lineWidth = .7;
    item.links.forEach((pair, i) => {
      const a = points[pair[0]];
      const b = points[pair[1]];
      ctx.strokeStyle = rgba(palette.blue, .12 + (i % 3) * .025);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (!reducedMotion && i % 13 === 0) {
        const travel = (t * .13 + i * .17) % 1;
        signal(ctx, { sx: a.x, sy: a.y, ex: b.x, ey: b.y }, travel, .65);
      }
    });
    points.forEach((p, i) => {
      const near = item.pointer && Math.hypot(item.pointer.x - p.x, item.pointer.y - p.y) < 65;
      const pulse = reducedMotion ? .8 : .7 + Math.sin(t * .7 + i) * .15;
      if (p.radius > 2.8 || near) glow(ctx, p.x, p.y, p.radius * (near ? 10 : 7), palette.blue, near ? .48 : .26);
      ctx.fillStyle = rgba(i % 9 ? palette.blue : palette.ice, pulse + (near ? .2 : 0));
      ctx.beginPath();
      ctx.arc(p.x, p.y, near ? p.radius + 1 : p.radius, 0, TAU);
      ctx.fill();
    });
  }

  function drawProvenance(item) {
    const { ctx, w, h, elapsed } = item;
    const t = elapsed / 1000;
    const points = definitions.map((n) => point(item, n));
    // The first pass reveals a conceptual workflow; later motion is a subtle signal loop.
    const reveal = reducedMotion ? 7 : Math.min(7, t / 1.15);
    const fontSize = w < 420 ? 12 : w < 600 ? 15 : 18;
    const hovered = item.pointer ? points.findIndex((p) => Math.hypot(p.x - item.pointer.x, p.y - item.pointer.y) < 45) : -1;
    item.hovered = hovered;
    item.canvas.style.cursor = hovered >= 0 ? 'pointer' : 'default';
    glow(ctx, w * .5, h * .48, Math.min(w, h) * .58, palette.blue, .055);

    // Satellite points express relations without implying a measured corpus size.
    item.satellites.forEach((s, i) => {
      const host = points[s.host];
      const radius = (w < 520 ? 29 : 39) + s.distance * (w < 520 ? 20 : 31);
      const angle = s.angle + (reducedMotion ? 0 : Math.sin(t * .12 + i) * .025);
      const x = host.x + Math.cos(angle) * radius;
      const y = host.y + Math.sin(angle) * radius;
      ctx.strokeStyle = rgba(palette.blue, reveal > s.host ? .18 : .07);
      ctx.lineWidth = .7;
      ctx.beginPath();
      ctx.moveTo(host.x, host.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = rgba(palette.blue, reveal > s.host ? .55 : .16);
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + (i % 3) * .3, 0, TAU);
      ctx.fill();
    });

    connections.forEach((pair, i) => {
      const completed = reveal >= pair[1];
      const line = edge(ctx, points[pair[0]], points[pair[1]], completed ? .42 : .12, palette.blue, true);
      if (!reducedMotion && completed) {
        const p = (t * .16 + i * .23) % 1;
        signal(ctx, line, p, .7);
      }
    });

    item.hitTargets = points;
    points.forEach((p, i) => {
      const isOn = reveal >= i;
      const selected = item.selected === i;
      const highlighted = hovered === i || selected;
      const color = i === 4 ? palette.cyan : palette.blue;
      const activation = reducedMotion ? 1 : clamp(reveal - i, 0, 1);
      glow(ctx, p.x, p.y, p.radius * 4, color, isOn ? .20 + (highlighted ? .18 : 0) : .045);
      if (!reducedMotion && isOn && activation < 1) {
        ctx.strokeStyle = rgba(color, (1 - activation) * .7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius + activation * 28, 0, TAU);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + (highlighted ? 3 : 0), 0, TAU);
      ctx.fillStyle = isOn ? 'rgba(12, 30, 58, .96)' : 'rgba(9, 19, 35, .96)';
      ctx.strokeStyle = rgba(color, isOn ? .9 : .28);
      ctx.lineWidth = highlighted ? 2 : 1.2;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, TAU);
      ctx.fillStyle = rgba(isOn ? palette.ice : palette.blue, isOn ? .95 : .25);
      ctx.fill();
      ctx.font = `500 ${fontSize}px "Inter", "Segoe UI", Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const label = definitions[i].label;
      const labelWidth = ctx.measureText(label).width;
      const labelY = p.y + p.radius + 23;
      const labelX = clamp(p.x, labelWidth / 2 + 7, w - labelWidth / 2 - 7);
      roundedRect(ctx, labelX - labelWidth / 2 - 7, labelY - 14, labelWidth + 14, 28, 5);
      ctx.fillStyle = 'rgba(5, 13, 26, .93)';
      ctx.fill();
      ctx.fillStyle = isOn ? 'rgba(220, 236, 255, .97)' : 'rgba(111, 139, 174, .65)';
      ctx.fillText(label, labelX, labelY);
    });
    ctx.textAlign = 'start';
  }

  function draw(item) {
    if (item.w < 2 || item.h < 2) return;
    item.ctx.clearRect(0, 0, item.w, item.h);
    if (item.kind === 'hero') drawHero(item);
    else drawProvenance(item);
    item.drawn = true;
  }

  function render(time) {
    frameId = 0;
    if (document.hidden || manuallyPaused) {
      lastFrameTime = 0;
      return;
    }
    const dt = lastFrameTime ? Math.min(60, time - lastFrameTime) : 0;
    lastFrameTime = time;
    const visibleItems = instances.filter(active);
    visibleItems.forEach((item) => {
      item.elapsed += dt;
      if (!reducedMotion || !item.drawn) draw(item);
    });
    if (visibleItems.length && !reducedMotion) frameId = requestAnimationFrame(render);
  }

  function kick() {
    if (!frameId && !document.hidden && !manuallyPaused && instances.some(active)) {
      lastFrameTime = 0;
      frameId = requestAnimationFrame(render);
    }
  }

  function stop() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrameTime = 0;
  }

  function select(item, index) {
    if (index < 0 || index >= definitions.length) return;
    item.selected = index;
    const details = item.slide && item.slide.querySelector('[data-node-detail]');
    if (details) {
      details.textContent = definitions[index].text;
      details.setAttribute('aria-live', 'polite');
    }
    draw(item);
  }

  function setupCanvas(canvas, root) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const kind = canvas.dataset.network === 'provenance' ? 'provenance' : 'hero';
    const slide = canvas.closest('.slide');
    const slides = Array.from(root.querySelectorAll('.slide'));
    let index = slide ? slides.indexOf(slide) : -1;
    if (index < 0) index = kind === 'hero' ? 0 : 7;
    const rng = random(kind === 'hero' ? 4419 : 8202);
    const particles = Array.from({ length: 78 }, (_, i) => ({
      angle: rng() * TAU,
      radius: .10 + Math.sqrt(rng()) * .91,
      size: i % 9 === 0 ? 3.7 : .9 + rng() * 1.7,
      seed: rng() * 12,
    }));
    const links = [];
    particles.forEach((p, i) => {
      particles.forEach((q, j) => {
        if (j <= i) return;
        const d = Math.hypot(Math.cos(p.angle) * p.radius - Math.cos(q.angle) * q.radius, Math.sin(p.angle) * p.radius - Math.sin(q.angle) * q.radius);
        if (d < .31 && (i + j) % 3 !== 0) links.push([i, j]);
      });
    });
    const item = { canvas, ctx, kind, slide, index, particles, links, elapsed: 0, selected: -1, hovered: -1, pointer: null, drawn: false,
      satellites: Array.from({ length: 30 }, (_, i) => ({ host: i % 6, angle: rng() * TAU, distance: rng() })),
    };
    prepare(item);
    if (!canvas.getAttribute('aria-label')) {
      canvas.setAttribute('aria-label', kind === 'hero' ? 'Концептуальная сеть происхождения данных' : 'Источник, ИИ, правка, версия, подтверждение и паспорт: концептуальная схема связей');
    }
    canvas.setAttribute('role', kind === 'provenance' ? 'group' : 'img');
    if (kind === 'provenance') {
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-roledescription', 'интерактивная схема');
    }
    const move = (event) => {
      const box = canvas.getBoundingClientRect();
      item.pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
      if (reducedMotion) draw(item);
    };
    const leave = () => {
      item.pointer = null;
      item.canvas.style.cursor = 'default';
      if (reducedMotion) draw(item);
    };
    const click = (event) => {
      if (kind !== 'provenance') return;
      const box = canvas.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      const hit = (item.hitTargets || []).findIndex((p) => Math.hypot(x - p.x, y - p.y) < 43);
      select(item, hit);
    };
    const keyboard = (event) => {
      // Deck navigation keeps ownership of the arrow keys; node selection uses numbers.
      const number = Number(event.key);
      if (kind === 'provenance' && number >= 1 && number <= 6) {
        event.preventDefault();
        event.stopPropagation();
        select(item, number - 1);
      }
    };
    canvas.addEventListener('pointermove', move, { passive: true });
    canvas.addEventListener('pointerleave', leave, { passive: true });
    canvas.addEventListener('click', click);
    canvas.addEventListener('keydown', keyboard);
    cleanup.push(() => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('click', click);
      canvas.removeEventListener('keydown', keyboard);
    });
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => {
        prepare(item);
        if (active(item)) draw(item);
        kick();
      });
      observer.observe(canvas);
      cleanup.push(() => observer.disconnect());
    }
    return item;
  }

  window.DesnitsaVisuals = {
    init(root) {
      stop();
      cleanup.forEach((dispose) => dispose());
      cleanup = [];
      instances = [];
      const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
      motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion = motionQuery.matches;
      const onMotion = () => {
        reducedMotion = motionQuery.matches;
        instances.forEach((item) => { item.drawn = false; });
        stop();
        kick();
      };
      if (motionQuery.addEventListener) {
        motionQuery.addEventListener('change', onMotion);
        cleanup.push(() => motionQuery.removeEventListener('change', onMotion));
      }
      scope.querySelectorAll('canvas[data-network]').forEach((canvas) => {
        const item = setupCanvas(canvas, scope);
        if (item) instances.push(item);
      });
      const current = Array.from(scope.querySelectorAll('.slide')).findIndex((slide) => slide.classList.contains('is-active'));
      activeIndex = current >= 0 ? current : 0;
      const onVisibility = () => document.hidden ? stop() : kick();
      const onResize = () => {
        instances.forEach((item) => {
          prepare(item);
          if (active(item)) draw(item);
        });
        kick();
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('resize', onResize, { passive: true });
      cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility));
      cleanup.push(() => window.removeEventListener('resize', onResize));
      kick();
    },
    enter(index) {
      activeIndex = Number(index);
      instances.forEach((item) => {
        if (!active(item)) return;
        item.elapsed = 0;
        item.drawn = false;
        prepare(item);
        draw(item);
      });
      stop();
      kick();
    },
    leave(index) {
      instances.forEach((item) => {
        if (item.index === Number(index)) item.pointer = null;
      });
      if (activeIndex === Number(index)) {
        activeIndex = -1;
        stop();
      }
    },
    setPaused(paused) {
      manuallyPaused = Boolean(paused);
      if (manuallyPaused) stop();
      else kick();
    },
  };
}());
