/* TNO Event Maker — draws TNO GUI windows on a canvas using the game's own bitmap fonts and coordinates. */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');
const statusEl = $('#status');

/* ---------- assets ---------- */
const imgCache = {};
function loadImg(src) {
  if (!imgCache[src]) imgCache[src] = new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('无法加载 ' + src));
    im.src = src;
  });
  return imgCache[src];
}
const ASSET_VER = '6';   // bump when a texture in assets/ is regenerated
const A = n => loadImg('assets/' + n + '?v=' + ASSET_VER);

/* ---------- bitmap fonts ---------- */
const fontCache = {}, FONT_VER = '6';   // bump when an atlas is rebuilt so browsers do not keep the old one
function loadFont(name) {
  if (!fontCache[name]) fontCache[name] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'fonts/' + name + '.js?v=' + FONT_VER;
    s.onerror = () => rej(new Error('无法加载字体 ' + name));
    s.onload = () => {
      const d = window.TNOFONT[name];
      const bin = atob(d.data), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dv = new DataView(u8.buffer), map = new Map();
      for (let i = 0; i < d.n; i++) {
        const o = i * 16;
        map.set(dv.getUint16(o, true), [dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), dv.getUint16(o + 6, true), dv.getUint16(o + 8, true),
          dv.getInt16(o + 10, true), dv.getInt16(o + 12, true), dv.getInt16(o + 14, true)]);
      }
      const kern = new Map();
      d.kern.forEach(k => kern.set(k[0] * 65536 + k[1], k[2]));
      d.data = null;
      loadImg('fonts/' + d.img + '?v=' + FONT_VER).then(im => res({ name, lh: d.lh, base: d.base, map, kern, img: im }), rej);
    };
    document.head.appendChild(s);
  });
  return fontCache[name];
}
function loadChain(slot, lang) {
  return Promise.all(window.TNO_CHAINS[slot][lang].map(loadFont));
}

/* colour tables from interface/TNO_fonts.gfx and core.gfx */
const COL_ALD = { F: [178, 201, 194], L: [195, 176, 145], D: [89, 199, 194], M: [35, 206, 255], W: [255, 255, 255], B: [47, 138, 135], G: [133, 234, 142], R: [224, 130, 130], g: [176, 176, 176], Y: [220, 218, 80], H: [220, 218, 80], O: [234, 161, 14], C: [253, 100, 144], P: [169, 27, 79], r: [132, 50, 0], w: [211, 201, 0], e: [146, 0, 0], p: [204, 0, 204], j: [153, 102, 51], S: [255, 128, 114], x: [225, 0, 0], y: [0, 225, 0], z: [22, 88, 255], l: [147, 112, 219], n: [60, 180, 60], q: [65, 65, 65], Q: [0, 84, 142], I: [116, 71, 209], d: [225, 225, 225], m: [0, 174, 239], h: [161, 16, 107], s: [137, 137, 137], V: [213, 40, 20], E: [152, 40, 92], f: [255, 193, 12], i: [46, 60, 169], J: [213, 87, 57], K: [45, 152, 40], o: [129, 88, 56], U: [214, 138, 75], A: [0, 108, 114], u: [210, 119, 39], Z: [128, 48, 56], X: [188, 54, 68], a: [60, 114, 240], b: [100, 100, 100] };
const COL_BOMB = { W: [255, 255, 255], b: [0, 0, 0], G: [86, 172, 91], R: [222, 86, 70], Y: [238, 201, 35], O: [238, 123, 35], H: [238, 201, 35], T: [255, 255, 255], g: [175, 175, 175] };
const COL_TW = { G: [86, 172, 91], R: [222, 86, 70], Y: [238, 201, 35], H: [238, 201, 35], T: [255, 255, 255], W: [255, 255, 255], b: [0, 0, 0], g: [110, 110, 110], B: [47, 100, 160], O: [200, 110, 30] };
const STYLE = {
  ald: { def: [178, 201, 194], cols: COL_ALD },
  bomb: { def: [255, 255, 255], cols: COL_BOMB },
  tw: { def: [0, 0, 0], cols: COL_TW }
};
const styleOf = slot => slot.startsWith('aldrich') ? STYLE.ald : slot.startsWith('Bomb') ? STYLE.bomb : STYLE.tw;

const isCJK = c => (c >= 0x2E80 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFF00 && c <= 0xFFEF) || (c >= 0x3000 && c <= 0x303F);

/* PDX-style text layout: §-colour codes, \n, wrap on spaces (and between any CJK glyphs). */
function layout(text, chain, maxW, style, defOverride) {
  text = String(text == null ? '' : text).replace(/\r/g, '').replace(/\\n/g, '\n');
  const lh = chain[0].lh, def = defOverride || style.def;
  let color = def;
  const tokens = [];
  let word = null;
  const endWord = () => { if (word) { tokens.push(word); word = null; } };
  const glyphOf = code => {
    for (const f of chain) { const m = f.map.get(code); if (m) return { f, m, adv: m[6] }; }
    return { f: null, m: null, adv: Math.round(lh * (isCJK(code) ? 0.95 : 0.5)), ch: String.fromCodePoint(code) };
  };
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], code = ch.codePointAt(0);
    if (ch === '§') {
      const k = chars[++i];
      if (k === '!' || k === undefined) color = def; else color = style.cols[k] || def;
      continue;
    }
    if (ch === '\n') { endWord(); tokens.push({ nl: true }); continue; }
    const g = glyphOf(code); g.color = color; g.code = code;
    if (ch === ' ' || ch === '　') { endWord(); tokens.push({ space: true, glyphs: [g], w: g.adv }); continue; }
    if (isCJK(code)) { endWord(); tokens.push({ glyphs: [g], w: g.adv }); continue; }
    if (!word) word = { glyphs: [], w: 0 };
    const prev = word.glyphs[word.glyphs.length - 1];
    if (prev && prev.f && prev.f === g.f) { const kv = g.f.kern.get(prev.code * 65536 + code); if (kv) { prev.adv += kv; word.w += kv; } }
    word.glyphs.push(g); word.w += g.adv;
  }
  endWord();
  const lines = [];
  let cur = { glyphs: [], w: 0, tw: 0 };
  const push = () => { lines.push(cur); cur = { glyphs: [], w: 0, tw: 0 }; };
  const add = (tk) => { for (const g of tk.glyphs) { g.x = cur.w; cur.glyphs.push(g); cur.w += g.adv; } if (!tk.space) cur.tw = cur.w; };
  for (const tk of tokens) {
    if (tk.nl) { push(); continue; }
    if (tk.space) { if (cur.w + tk.w > maxW) { push(); continue; } add(tk); continue; }
    if (cur.w > 0 && cur.w + tk.w > maxW) push();
    if (tk.w > maxW && tk.glyphs.length > 1) {
      for (const g of tk.glyphs) { if (cur.w > 0 && cur.w + g.adv > maxW) push(); add({ glyphs: [g] }); }
    } else add(tk);
  }
  push();
  return { lines, lh, height: lines.length * lh, width: Math.max(0, ...lines.map(l => l.tw)) };
}

const scratchA = document.createElement('canvas'), scratchB = document.createElement('canvas');
const sa = scratchA.getContext('2d'), sb = scratchB.getContext('2d');
/* Draw a layout. Glyph textures are multiplied by the text colour exactly like the game's shader. */
function drawLayout(c, L, x, y, maxW, fmt) {
  const pad = 24, W = Math.ceil(Math.max(maxW, L.width)) + pad * 2, H = L.height + pad * 2;
  const groups = new Map();
  L.lines.forEach((ln, i) => {
    let off = 0;
    if (fmt === 'center') off = Math.floor((maxW - ln.tw) / 2); else if (fmt === 'right') off = Math.floor(maxW - ln.tw);
    for (const g of ln.glyphs) {
      const key = g.color.join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([g, pad + off + g.x, pad + Math.round(i * L.lh)]);
    }
  });
  for (const [key, list] of groups) {
    if (scratchA.width < W || scratchA.height < H) { scratchA.width = scratchB.width = Math.max(W, scratchA.width); scratchA.height = scratchB.height = Math.max(H, scratchA.height); }
    sa.globalCompositeOperation = 'source-over';
    sa.clearRect(0, 0, scratchA.width, scratchA.height);
    for (const [g, gx, gy] of list) {
      if (g.f) {
        const m = g.m;
        if (m[2] && m[3]) sa.drawImage(g.f.img, m[0], m[1], m[2], m[3], gx + m[4], gy + m[5], m[2], m[3]);
      } else {
        sa.fillStyle = '#fff'; sa.textBaseline = 'alphabetic';
        sa.font = Math.round(L.lh * 0.82) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
        sa.fillText(g.ch, gx, gy + Math.round(L.lh * 0.8));
      }
    }
    let src = scratchA;
    if (key !== '255,255,255') {
      sb.globalCompositeOperation = 'source-over';
      sb.clearRect(0, 0, scratchB.width, scratchB.height);
      sb.drawImage(scratchA, 0, 0);
      sb.globalCompositeOperation = 'multiply';
      sb.fillStyle = 'rgb(' + key + ')';
      sb.fillRect(0, 0, W, H);
      sb.globalCompositeOperation = 'destination-in';
      sb.drawImage(scratchA, 0, 0);
      src = scratchB;
    }
    c.drawImage(src, 0, 0, W, H, x - pad, y - pad, W, H);
  }
}
/* instantTextBox helper */
function textBox(c, text, chain, slot, o) {
  const st = styleOf(slot);
  const L = layout(text, chain, o.w, st, o.color);
  let y = o.y;
  if (o.vcenter && o.h) y += Math.floor((o.h - L.height) / 2);
  if (o.maxLines && L.lines.length > o.maxLines) { L.lines.length = o.maxLines; L.height = o.maxLines * L.lh; }
  drawLayout(c, L, o.x, y, o.w, o.fmt || 'left');
  return L;
}

/* corneredTileSprite: corners fixed, edges and centre tiled */
function cornered(c, im, x, y, w, h, bx, by, center) {
  const iw = im.width, ih = im.height;
  bx = Math.min(bx, Math.floor(iw / 2), Math.floor(w / 2)); by = Math.min(by, Math.floor(ih / 2), Math.floor(h / 2));
  const mw = iw - 2 * bx, mh = ih - 2 * by;
  const xs = [[0, bx, x, bx]], ys = [[0, by, y, by]];
  if (mw > 0) for (let px = x + bx; px < x + w - bx; px += mw) xs.push([bx, Math.min(mw, x + w - bx - px), px, 0]);
  xs.push([iw - bx, bx, x + w - bx, bx]);
  if (mh > 0) for (let py = y + by; py < y + h - by; py += mh) ys.push([by, Math.min(mh, y + h - by - py), py, 0]);
  ys.push([ih - by, by, y + h - by, by]);
  ys.forEach((ry, j) => xs.forEach((rx, i) => {
    const edgeX = i === 0 || i === xs.length - 1, edgeY = j === 0 || j === ys.length - 1;
    if (!edgeX && !edgeY && center === false) return;
    if (rx[1] > 0 && ry[1] > 0) c.drawImage(im, rx[0], ry[0], rx[1], ry[1], rx[2], ry[2], rx[1], ry[1]);
  }));
}

/* ---------- user pictures ---------- */
const userImg = {};           // key -> HTMLImageElement | null
function drawCover(c, im, x, y, w, h, p) {
  const z = (p && p.zoom) || 1, px = p ? p.px : 0.5, py = p ? p.py : 0.5;
  const s = Math.max(w / im.width, h / im.height) * z, dw = im.width * s, dh = im.height * s;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.imageSmoothingQuality = 'high';
  c.drawImage(im, x + (w - dw) * px, y + (h - dh) * py, dw, dh);
  c.restore();
}
const lerpLut = (xs, ys) => { const o = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) { let k = 1; while (k < xs.length - 1 && xs[k] < i) k++; const t = (i - xs[k - 1]) / (xs[k] - xs[k - 1]); o[i] = ys[k - 1] + (ys[k] - ys[k - 1]) * t; } return o; };
/* luma -> teal ramp measured from gfx/superevent_pictures/*.png */
const LX = [0, 45, 60, 120, 180, 210, 255];
const LR = lerpLut(LX, [4, 30, 49, 102, 170, 198, 255]), LG = lerpLut(LX, [16, 52, 65, 128, 185, 216, 255]), LB = lerpLut(LX, [18, 53, 68, 132, 185, 215, 255]);
function fxCanvas(im, w, h, p, mode, scan) {
  const t = document.createElement('canvas'); t.width = w; t.height = h;
  const tc = t.getContext('2d');
  tc.fillStyle = '#000'; tc.fillRect(0, 0, w, h);
  drawCover(tc, im, 0, 0, w, h, p);
  if (mode === 'raw' && !scan) return t;
  const d = tc.getImageData(0, 0, w, h), a = d.data;
  const rowF = [1 + 0.075 * scan, 1 - 0.055 * scan, 1 - 0.035 * scan];
  for (let yy = 0; yy < h; yy++) {
    const f = rowF[yy % 3];
    for (let xx = 0; xx < w; xx++) {
      const i = (yy * w + xx) * 4;
      let r = a[i], g = a[i + 1], b = a[i + 2];
      if (mode === 'teal') { let l = 0.299 * r + 0.587 * g + 0.114 * b; l = Math.max(0, Math.min(255, 26 + l * 0.88)) | 0; r = LR[l]; g = LG[l]; b = LB[l]; }
      else if (mode === 'gray') { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = l; }
      a[i] = r * f; a[i + 1] = g * f; a[i + 2] = b * f;
    }
  }
  tc.putImageData(d, 0, 0);
  return t;
}

/* ---------- templates ---------- */
const T = {};
const picFields = (key, label) => [
  { k: key, type: 'image', label },
  { k: key + '_zoom', type: 'range', label: '缩放 Zoom', min: 1, max: 4, step: 0.01, def: 1 },
  { k: key + '_px', type: 'range', label: '左右 X', min: 0, max: 1, step: 0.005, def: 0.5 },
  { k: key + '_py', type: 'range', label: '上下 Y', min: 0, max: 1, step: 0.005, def: 0.5 }
];
const pp = (s, key) => ({ zoom: +s[key + '_zoom'] || 1, px: +s[key + '_px'], py: +s[key + '_py'] });

/* === Super event (interface/TNO_SG_Super_Event.gui) === */
T.se = {
  name: '超事件', en: 'Super Event',
  fonts: ['aldrich_24_outline', 'Bomb_24'],
  groups: [
    { title: '文字 Text', fields: [
      { k: 'title', type: 'text', label: '标题 Title', zh: '德国内战', en: 'THE GERMAN CIVIL WAR' },
      { k: 'quote', type: 'textarea', label: '引言 Quote', rows: 5,
        zh: '因此，所有人都必须认识到这一点：\n与国家的存在相比，他的自我毫无意义。\n- 阿道夫·希特勒',
        en: 'It is thus necessary that the individual should finally come to realize that his own ego is of no importance in comparison with the existence of the nation.\n- Adolf Hitler' },
      { k: 'option', type: 'text', label: '按钮 Button', zh: '风云已起', en: 'So It Begins' }
    ] },
    { title: '图片 Picture', fields: [
      { k: 'preset', type: 'thumbs', label: '游戏原图 Game pictures', list: () => window.TNO_ASSETS.se.map(n => 'assets/se/' + n + '.png'), def: 'assets/se/german_civil_war.png' },
      ...picFields('pic', '上传自己的图片 Upload (573×455)'),
      { k: 'filter', type: 'select', label: '滤镜 Filter', def: 'teal', opts: [['teal', '青蓝 CRT 滤镜 + 扫描线（原版风格，自动转黑白）'], ['rawscan', '保留原色 + 扫描线'], ['raw', '保留原色，不加扫描线']] },
      { k: 'scan', type: 'range', label: '扫描线强度 Scanlines', min: 0, max: 2, step: 0.05, def: 1 },
      { k: 'underlay', type: 'check', label: '文字暗色衬底 Text underlay', def: true },
      { k: 'nuke', type: 'check', label: '核战版外框 Nuclear-war frame', def: false }
    ] },
    { title: '配乐 Music', fields: [{ k: 'music', type: 'audio' }] }
  ],
  async draw(s, lang) {
    const [fTitle, fBomb] = await Promise.all([loadChain('aldrich_24_outline', lang), loadChain('Bomb_24', lang)]);
    const [tile, border, under, btn] = await Promise.all([A('tiled_bg.png'), A('bigevent_border.png'), A('se_underlay.png'), A('button_221x34.png')]);
    const OX = 1, OY = 46;
    cv.width = 590; cv.height = 527; ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.translate(OX, OY);
    // title container at (7,-45) 570x128
    cornered(ctx, tile, 7, -45, 570, 128, 64, 64, true);
    if (s.nuke) ctx.drawImage(await A('nuke_super_title.png'), 7, -45);
    textBox(ctx, s.title, fTitle, 'aldrich_24_outline', { x: 7, y: -45 + 18, w: 580, fmt: 'center' });
    // picture at (6,7)
    const up = userImg['se.pic'];
    if (up) ctx.drawImage(fxCanvas(up, 573, 455, pp(s, 'pic'), s.filter === 'teal' ? 'teal' : 'raw', s.filter === 'raw' ? 0 : +s.scan), 6, 7);
    else ctx.drawImage(await loadImg(s.preset), 6, 7);
    // frame container 585x480
    cornered(ctx, border, 0, 0, 585, 480, 64, 71, false);
    if (s.nuke) ctx.drawImage(await A('nuke_super_frame.png'), 0, 0);
    const bx = 292 - 110, by = 240 + 183;
    ctx.drawImage(btn, bx, by);
    textBox(ctx, s.option, fBomb, 'Bomb_24', { x: bx, y: by, w: 221, h: 34, fmt: 'center', vcenter: true, maxLines: 1 });
    if (s.underlay && !s.nuke) ctx.drawImage(under, 26, 480 - 200);
    textBox(ctx, s.quote, fBomb, 'Bomb_24', { x: 120, y: 480 - 195, w: 455, fmt: 'right', maxLines: 7 });
    ctx.restore();
  }
};

/* === Report (pop-up) event: EventWindow === */
function polaroid(im, p, gray) {
  const t = document.createElement('canvas'); t.width = 176; t.height = 210;
  const c = t.getContext('2d');
  c.translate(88, 105); c.rotate(-0.035); c.translate(-80, -96);
  c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 5; c.shadowOffsetX = 1; c.shadowOffsetY = 2;
  c.fillStyle = '#e7e3d9'; c.fillRect(0, 0, 160, 192);
  c.shadowColor = 'transparent';
  c.drawImage(fxCanvas(im, 142, 148, p, gray ? 'gray' : 'raw', 0), 9, 9);
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.strokeRect(8.5, 8.5, 143, 149);
  return t;
}
T.report = {
  name: '弹窗事件', en: 'Pop-up Event',
  fonts: ['hoi4_typewriter22', 'hoi4_typewriter16'],
  groups: [
    { title: '文字 Text', fields: [
      { k: 'title', type: 'text', label: '标题 Title', zh: '元首的健康状况', en: 'The Führer\'s Health' },
      { k: 'desc', type: 'textarea', label: '正文 Description', rows: 9,
        zh: '今天清晨，一份标注“绝密”的报告被送到了办公桌上。报告的措辞一如既往地谨慎，但字里行间透露出的信息却再清楚不过：局势正在发生变化，而我们必须在别人之前做出决定。\n\n窗外的城市依然安静，仿佛什么都没有发生。',
        en: 'A report marked "TOP SECRET" arrived on the desk early this morning. Its wording was as careful as ever, but the meaning between the lines could not have been clearer: the situation is changing, and we must decide before others decide for us.\n\nOutside the window the city remained quiet, as if nothing had happened at all.' },
      { k: 'options', type: 'textarea', label: '选项（每行一个）Options, one per line', rows: 3, zh: '我们早有准备。\n再等等看。', en: 'We are prepared.\nLet us wait and see.' }
    ] },
    { title: '窗口长度 Window length', fields: [
      { k: 'size', type: 'select', label: '长度 Length', def: 'auto', opts: [['auto', '自动（跟随正文，游戏默认行为）'], ['short', '短 Short'], ['medium', '中 Medium'], ['long', '长 Long']] }
    ] },
    { title: '图片 Picture', fields: [
      ...picFields('pic', '上传图片 Upload'),
      { k: 'frame', type: 'select', label: '相片处理 Photo', def: 'polaroid', opts: [['polaroid', '自动加相纸边框（黑白）'], ['polaroidc', '自动加相纸边框（彩色）'], ['asis', '原样使用（已是游戏格式的 PNG）']] }
    ] }
  ],
  async draw(s, lang) {
    const [f22, f16] = await Promise.all([loadChain('hoi4_typewriter22', lang), loadChain('hoi4_typewriter16', lang)]);
    const [top, mid, bot, clip, opt, mini] = await Promise.all([A('report_top.png'), A('report_mid.png'), A('report_bottom.png'), A('pic_clip.png'), A('option_entry.png'), A('btn_minimize.png')]);
    const st = STYLE.tw;
    const L = layout(s.desc, f16, 460, st);
    const opts = String(s.options || '').split('\n').map(x => x.trim()).filter(Boolean);
    const extra = Math.max(0, opts.length - 3) * 52;
    const minH = { auto: 48, short: 111, medium: 270, long: 470 }[s.size] || 48;
    const Hm = Math.max(minH, L.height + 10) + extra;
    const OX = 4, OY = 0;
    cv.width = 563 + 10; cv.height = 193 + Hm + 244; ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.translate(OX, OY);
    ctx.drawImage(top, 0, 0);
    cornered(ctx, mid, 0, 193, 563, Hm, 290, 16, true);
    const by = 193 + Hm;
    ctx.drawImage(bot, 1, by);
    ctx.drawImage(mini, 50, 75);
    textBox(ctx, s.title, f22, 'hoi4_typewriter22', { x: 45, y: lang === 'zh' ? 138 : 130, w: 484, fmt: 'center', maxLines: 1 });
    drawLayout(ctx, L, 62, 193, 460, 'left');
    const up = userImg['report.pic'];
    if (up) ctx.drawImage(s.frame === 'asis' ? up : polaroid(up, pp(s, 'pic'), s.frame === 'polaroid'), 1 + 5, by);
    else ctx.drawImage(await A('samples/report_event2.png'), 1 + 5, by);
    ctx.drawImage(clip, 1 - 3, by + 35);
    opts.forEach((o, i) => {
      const ox = 1 + 215 - 10, oy = by - 10 - extra + i * 52;
      ctx.drawImage(opt, ox, oy);
      textBox(ctx, o, f16, 'hoi4_typewriter16', { x: ox + 5, y: oy + 4, w: 340, h: 40, fmt: 'center', vcenter: true, maxLines: 2 });
    });
    ctx.restore();
  }
};

/* === News event: EventWindow_News === */
T.news = {
  name: '新闻事件', en: 'News Event',
  fonts: ['hoi4_typewriter22', 'hoi4_typewriter16'],
  groups: [
    { title: '文字 Text', fields: [
      { k: 'title', type: 'text', label: '标题 Headline', zh: '德国内战爆发', en: 'Civil War in Germany' },
      { k: 'desc', type: 'textarea', label: '正文 Body', rows: 9,
        zh: '来自日耳曼尼亚的消息证实，元首去世后的权力真空终于演变为公开的武装冲突。数个派系各自宣称拥有合法继承权，国防军的部队已经在首都街头相互开火。\n\n世界各国政府正密切关注事态的发展。',
        en: 'Reports from Germania confirm that the power vacuum left by the Führer\'s death has finally erupted into open armed conflict. Several factions each claim to be the rightful successor, and units of the Wehrmacht are already exchanging fire in the streets of the capital.\n\nGovernments around the world are watching closely.' },
      { k: 'options', type: 'textarea', label: '选项（每行一个）Options', rows: 2, zh: '帝国的末日？', en: 'The end of the Reich?' }
    ] },
    { title: '报头 Newspaper header', fields: [
      { k: 'header', type: 'thumbs', wide: true, label: '游戏报头 Game headers', list: () => window.TNO_ASSETS.headers.map(n => 'assets/headers/' + n + '.png'), def: 'assets/headers/generic_news_header.png' },
      { k: 'hdr', type: 'image', label: '或上传报头 Upload header (约 460×64)' }
    ] },
    { title: '图片 Picture', fields: [
      ...picFields('pic', '上传图片 Upload (161×420 竖图)'),
      { k: 'gray', type: 'check', label: '转为黑白 Greyscale', def: true }
    ] }
  ],
  async draw(s, lang) {
    const [f22, f16] = await Promise.all([loadChain('hoi4_typewriter22', lang), loadChain('hoi4_typewriter16', lang)]);
    const [bg, ov, opt, mini] = await Promise.all([A('news_bg.png'), A('news_pic_overlay.png'), A('option_entry.png'), A('btn_minimize.png')]);
    const OX = 0, OY = 16;
    cv.width = 528; cv.height = 595 + OY + 4; ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.translate(OX, OY);
    ctx.drawImage(bg, 0, 0);
    const up = userImg['news.pic'];
    if (up) ctx.drawImage(fxCanvas(up, 161, 420, pp(s, 'pic'), s.gray ? 'gray' : 'raw', 0), 27, 140);
    else ctx.drawImage(await A('samples/news_event.png'), 27, 140);
    ctx.drawImage(ov, 27, 140);
    // title text is "\n£header\n\n\n\n" + title : header icon sits on line 1, title on line 5
    const ty = lang === 'zh' ? -9 : -12, lh = f22[0].lh;
    const hd = userImg['news.hdr'] || await loadImg(s.header);
    ctx.drawImage(hd, 31 + Math.floor((460 - hd.width) / 2), ty + lh);
    textBox(ctx, s.title, f22, 'hoi4_typewriter22', { x: 31, y: ty + lh * 5, w: 460, fmt: 'center', maxLines: 1 });
    ctx.drawImage(mini, 5, 40);
    textBox(ctx, s.desc, f16, 'hoi4_typewriter16', { x: 195, y: 121 + 27, w: 310, fmt: 'left' });
    const opts = String(s.options || '').split('\n').map(x => x.trim()).filter(Boolean);
    opts.forEach((o, i) => {
      const ox = 175 - 10, oy = 573 - opts.length * 52 + i * 52;
      ctx.drawImage(opt, ox, oy);
      textBox(ctx, o, f16, 'hoi4_typewriter16', { x: ox + 5, y: oy + 4, w: 340, h: 40, fmt: 'center', vcenter: true, maxLines: 2 });
    });
    ctx.restore();
  }
};

/* === In-game politics view (interface/countrypoliticsview.gui + TNO_SG_Politics.gui) === */
function parsePie(txt) {
  const out = [];
  String(txt || '').split('\n').forEach(line => {
    const m = line.match(/(-?\d+(?:\.\d+)?)/), c = line.match(/#[0-9a-fA-F]{3,8}\b/);
    if (m && +m[1] > 0) out.push({ v: +m[1], c: c ? c[0] : '#888888' });
  });
  return out;
}
function fitIn(c, im, x, y, w, h, maxScale) {
  const sc = Math.min(w / im.width, h / im.height, maxScale || 1), dw = im.width * sc, dh = im.height * sc;
  c.imageSmoothingQuality = 'high';
  c.drawImage(im, Math.round(x + (w - dw) / 2), Math.round(y + (h - dh) / 2), dw, dh);
}
T.pol = {
  name: '国家介绍', en: 'Politics View',
  groups: [
    { title: '领袖与政党 Leader & party', fields: [
      { k: 'leader', type: 'text', label: '领袖姓名 Leader', zh: '理查德·尼克松', en: 'Richard Nixon' },
      ...picFields('portrait', '领袖头像 Portrait (156×210)'),
      { k: 'party', type: 'text', label: '执政党 Ruling party', zh: '共和-民主联盟', en: 'R-D Coalition' },
      { k: 'subideo', type: 'text', label: '意识形态 Ideology', zh: '自由保守主义', en: 'Liberal Conservatism' },
      { k: 'faction', type: 'image', label: '阵营图标 Faction icon（可选）' },
      { k: 'flag', type: 'image', label: '国旗 Flag（可选，显示在标题栏左侧）' }
    ] },
    { title: '饼图 Pie chart', fields: [
      { k: 'pie', type: 'textarea', label: '每行一块：百分比 + 颜色（#十六进制），后面可写备注', rows: 6,
        zh: '38 #3a6fb5 自由保守主义\n27 #5aa0d8 自由主义\n14 #c9a227 进步主义\n9 #b03a3a 社会民主主义\n7 #6b4a8c 威权民主\n5 #4a4a4a 其他',
        en: '38 #3a6fb5 Liberal Conservatism\n27 #5aa0d8 Liberalism\n14 #c9a227 Progressivism\n9 #b03a3a Social Democracy\n7 #6b4a8c Authoritarian Democracy\n5 #4a4a4a Others' }
    ] },
    { title: '国策与国家精神 Focus & spirits', fields: [
      { k: 'goal', type: 'text', label: '当前国策 Active focus', zh: '重建美国', en: 'Rebuilding America' },
      { k: 'goalicon', type: 'image', label: '国策图标 Focus icon（可选）' },
      { k: 'progress', type: 'range', label: '国策进度 Progress', min: 0, max: 1, step: 0.01, def: 0.45 },
      { k: 'spirits', type: 'images', max: 6, label: '国家精神图标 Spirit icons（可多选，最多 6 个）' }
    ] },
    { title: '内阁 Cabinet', fields: [
      { k: 'cat1', type: 'text', label: '第一行标题', zh: '政府首脑', en: 'Head of Government' },
      { k: 'cat1imgs', type: 'images', max: 3, label: '第一行图标（最多 3 个）' },
      { k: 'cat2', type: 'text', label: '第二行标题', zh: '内阁', en: 'Cabinet' },
      { k: 'cat2imgs', type: 'images', max: 3, label: '第二行图标（最多 3 个）' }
    ] },
    { title: '界面文字 Interface labels', fields: [
      { k: 't_title', type: 'text', label: '窗口标题', zh: '政治', en: 'Political' },
      { k: 't_spirit', type: 'text', label: '国家精神标题', zh: '国家精神', en: 'National Spirit' },
      { k: 'b1', type: 'text', label: '按钮 1', zh: '        占领地区', en: 'Occupied territories' },
      { k: 'b2', type: 'text', label: '按钮 2', zh: '附属国', en: 'Manage subjects' },
      { k: 'b3', type: 'text', label: '按钮 3', zh: '外交事务', en: 'Foreign Affairs' }
    ] }
  ],
  async draw(s, lang) {
    const [b36, b18, b16, a22, a20, a18] = await Promise.all(['Bomb_36', 'Bomb_18', 'Bomb_16', 'aldrich_22_outline', 'aldrich_20_outline', 'aldrich_18_outline'].map(n => loadChain(n, lang)));
    const [win, hdr, bg, pov, lfr, gbg, gbtn, gfr, gfill, cath, cati, close, gunk, unk, btn, btnU] = await Promise.all(['pol_window.png', 'pol_header.png', 'pol_bg.png', 'pol_pie_overlay.png', 'pol_leader_frame.png', 'pol_goal_bg.png', 'pol_goal_button.png', 'pol_goal_progress_frame.png', 'pol_goal_progress.png', 'pol_cat_header.png', 'pol_cat_icons.png', 'pol_close.png', 'goal_unknown.png', 'leader_unknown.png', 'tno_button_148.png', 'tno_button_148_underlay.png'].map(A));
    cv.width = 550; cv.height = 526; ctx.clearRect(0, 0, cv.width, cv.height);
    cornered(ctx, win, 0, 0, 549, 526, 64, 64, true);
    ctx.drawImage(hdr, 5, 3);
    const fl = userImg['pol.flag'];
    if (fl) fitIn(ctx, fl, 10, 12, 30, 20, 4);
    textBox(ctx, s.t_title, b36, 'Bomb_36', { x: 45, y: 4, w: 400, maxLines: 1 });
    ctx.drawImage(bg, 0, 44);
    // pie chart (pieChartType size 71), then the glass overlay
    const pie = parsePie(s.pie), tot = pie.reduce((a, p) => a + p.v, 0);
    if (tot > 0) {
      const cx = 438, cy = 382.5, r = 71;
      let a0 = -Math.PI / 2;
      for (const p of pie) {
        const a1 = a0 + p.v / tot * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
        ctx.fillStyle = p.c; ctx.fill();
        a0 = a1;
      }
    }
    ctx.drawImage(pov, 356, 300);
    // leader
    const por = userImg['pol.portrait'];
    if (por) ctx.drawImage(fxCanvas(por, 156, 210, pp(s, 'portrait'), 'raw', 0), 9, 55); else ctx.drawImage(unk, 9, 55);
    ctx.drawImage(lfr, 1, 45);
    textBox(ctx, s.leader, b18, 'Bomb_18', { x: 10, y: 273, w: 155, h: 20, fmt: 'center', vcenter: true, maxLines: 1 });
    // active focus
    ctx.drawImage(gbg, 176, 54);
    ctx.drawImage(gbtn, 0, 0, 259, 83, 276, 61, 259, 83);
    const gi = userImg['pol.goalicon'] || gunk;
    fitIn(ctx, gi, 223 - 47, 102 - 38, 94, 76, 1);
    textBox(ctx, s.goal, a22, 'aldrich_22_outline', { x: 296, y: 92, w: 218, h: 20, fmt: 'center', vcenter: true, maxLines: 1 });
    const pw = Math.round(237 * Math.max(0, Math.min(1, +s.progress)));
    if (pw > 0) ctx.drawImage(gfill, 0, 6, pw, 6, 287, 127, pw, 6);
    ctx.drawImage(gfr, 286, 126);
    // national spirits
    textBox(ctx, s.t_spirit, b16, 'Bomb_16', { x: 180, y: 151, w: 200, maxLines: 1 });
    (userImg['pol.spirits'] || []).slice(0, 6).forEach((im, i) => fitIn(ctx, im, 178 + i * 60, 169, 60, 68, 1));
    // ruling party (TNO_SG_politics_faction_leader_container at 230,270)
    const fa = userImg['pol.faction'];
    if (fa) fitIn(ctx, fa, 200, 244, 49, 52, 1);
    textBox(ctx, s.party, a20, 'aldrich_20_outline', { x: 383, y: 253, w: 160, maxLines: 1 });
    textBox(ctx, s.subideo, a18, 'aldrich_18_outline', { x: 383, y: 270, w: 160, maxLines: 1 });
    // idea categories
    [['cat1', 'cat1imgs'], ['cat2', 'cat2imgs']].forEach(([tk, ik], i) => {
      const by = 275 + 14 + i * 90;
      ctx.drawImage(cath, 52 - 40, by + 12, 321, 22);
      ctx.drawImage(cati, i * 48, 0, 48, 35, 52 - 29, by + 15, 24, 17.5);
      textBox(ctx, s[tk], b16, 'Bomb_16', { x: 52, y: by + 13, w: 300, maxLines: 1 });
      (userImg['pol.' + ik] || []).slice(0, 3).forEach((im, j) => fitIn(ctx, im, 40 + j * 100, by + 34, 100, 64, 1));
    });
    // bottom buttons
    [37, 202, 367].forEach(x => { ctx.drawImage(btnU, x, 483); ctx.drawImage(btn, x, 483); });
    textBox(ctx, s.b1, b16, 'Bomb_16', { x: 48, y: 493, w: 200, maxLines: 1 });
    textBox(ctx, s.b2, b16, 'Bomb_16', { x: 176, y: 493, w: 200, fmt: 'center', maxLines: 1 });
    textBox(ctx, s.b3, b16, 'Bomb_16', { x: 367, y: 483, w: 148, h: 34, fmt: 'center', vcenter: true, maxLines: 1 });
    ctx.drawImage(close, 516, 11);
  }
};

/* === Country selection screen (frontendgamesetupview.gui: gamesetup_interesting_countries_window) === */
T.cs = {
  name: '选国界面', en: 'Country Select',
  fonts: ['aldrich_24_outline', 'aldrich_20_outline', 'aldrich_16_outline', 'Bomb_18', 'Bomb_16'],
  groups: [
    { title: '领袖与政党 Leader & party', fields: [
      { k: 'nation', type: 'text', label: '国名 Nation', zh: '美利坚合众国', en: 'UNITED STATES OF AMERICA' },
      { k: 'leader', type: 'text', label: '领袖 Leader', zh: '理查德·尼克松', en: 'Richard Nixon' },
      { k: 'ideology', type: 'text', label: '意识形态 Ideology', zh: '自由保守主义', en: 'Liberal Conservatism' },
      { k: 'party', type: 'text', label: '执政党 Ruling party', zh: '共和-民主联盟', en: 'Republican-Democratic Coalition' },
      { k: 'elections', type: 'text', label: '选举 Elections', zh: '1964年11月（每48个月）', en: 'November 1964 (every 48 months)' },
      ...picFields('portrait', '领袖头像 Portrait (156×210)')
    ] },
    { title: '历史简介 History', fields: [
      { k: 'history', type: 'textarea', label: '正文 Text', rows: 9,
        zh: '§W美国§!输掉了战争。珍珠港的硝烟散去二十年后，这个国家依然活在失败的阴影之中：海外的盟友所剩无几，国内的分歧却与日俱增。\n\n如今，§Y自由国家组织§!是抵御§R德国§!与§O日本§!的最后一道防线，而华盛顿必须证明，民主尚未走到尽头。',
        en: 'The §WUnited States§! lost the war. Twenty years after the smoke cleared over Pearl Harbor, the nation still lives in the shadow of defeat: few allies remain abroad, while divisions at home grow by the day.\n\nNow the §YOrganization of Free Nations§! stands as the last line of defence against §RGermany§! and §OJapan§!, and Washington must prove that democracy has not yet run its course.' }
    ] },
    { title: '界面文字 Interface labels', fields: [
      { k: 't_title', type: 'text', label: '顶部标题', zh: '选择国家', en: 'Select Country' },
      { k: 't_info', type: 'text', label: '左栏标题', zh: '信息', en: 'Information' },
      { k: 't_hist', type: 'text', label: '右栏标题', zh: '历史简介', en: 'Brief History' },
      { k: 'l_leader', type: 'text', label: '标签：领袖', zh: '领袖', en: 'Leader' },
      { k: 'l_ideology', type: 'text', label: '标签：意识形态', zh: '意识形态', en: 'Ideology' },
      { k: 'l_party', type: 'text', label: '标签：执政党', zh: '执政党', en: 'Ruling Party' },
      { k: 'l_elections', type: 'text', label: '标签：选举', zh: '选举', en: 'Elections' },
      { k: 'b_back', type: 'text', label: '按钮：返回', zh: '返回', en: 'Back' },
      { k: 'b_select', type: 'text', label: '按钮：选择', zh: '选择国家', en: 'Select Country' }
    ] },
    { title: '画面 Layout', fields: [
      { k: 'crop', type: 'select', label: '范围 Area', def: 'full', opts: [['full', '完整界面（含上方阵营旗帜墙）'], ['bottom', '只要下半部分信息面板']] },
      { k: 'valcol', type: 'select', label: '数值颜色 Value colour', def: 'Y', opts: [['Y', '黄色（游戏默认高亮）'], ['F', '与标签相同'], ['W', '白色']] },
      { k: 'idea1', type: 'image', label: '民族精神图标 1（可选）' },
      { k: 'idea2', type: 'image', label: '民族精神图标 2（可选）' },
      { k: 'idea3', type: 'image', label: '民族精神图标 3（可选）' }
    ] }
  ],
  async draw(s, lang) {
    const [f24, f20, f16, b18, b16] = await Promise.all(['aldrich_24_outline', 'aldrich_20_outline', 'aldrich_16_outline', 'Bomb_18', 'Bomb_16'].map(n => loadChain(n, lang)));
    const [bg, cover, pov, btn, btnU, unk] = await Promise.all([A('cs_bg.png'), A('cs_cover.png'), A('cs_portrait_overlay.png'), A('tno_button_148.png'), A('tno_button_148_underlay.png'), A('leader_unknown.png')]);
    const cropY = s.crop === 'bottom' ? 412 : 0;
    cv.width = 1237; cv.height = 717 - cropY; ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.translate(0, -cropY);
    ctx.drawImage(bg, 0, 0);
    ctx.drawImage(cover, 2, 44);
    textBox(ctx, s.t_title, f24, 'aldrich_24_outline', { x: 435, y: 17, w: 340, fmt: 'center', maxLines: 1 });
    textBox(ctx, s.t_info, f24, 'aldrich_24_outline', { x: 10, y: 450, w: 340, fmt: 'center', maxLines: 1 });
    const vc = COL_ALD[s.valcol] || COL_ALD.Y;
    const rows = [['l_leader', 'leader', -2, 15], ['l_ideology', 'ideology', 38, 55], ['l_party', 'party', 78, 95], ['l_elections', 'elections', 118, 135]];
    for (const [lk, vk, ly, vy] of rows) {
      textBox(ctx, s[lk], f20, 'aldrich_20_outline', { x: 35 + 7, y: 480 + ly, w: 340, maxLines: 1 });
      textBox(ctx, s[vk], f20, 'aldrich_20_outline', { x: 35 + 7, y: 480 + vy, w: 340, maxLines: 1, color: vc });
    }
    // portrait: scale 0.696, rotation -0.04 rad around its top-left like the engine
    const por = userImg['cs.portrait'];
    ctx.save(); ctx.translate(309, 427); ctx.rotate(0.04); ctx.imageSmoothingQuality = 'high';
    if (por) { const pc = fxCanvas(por, 156, 210, pp(s, 'portrait'), 'raw', 0); ctx.drawImage(pc, 0, 0, 156 * 0.696, 210 * 0.696); }
    else ctx.drawImage(unk, 0, 0, 156 * 0.696, 210 * 0.696);
    ctx.restore();
    ctx.drawImage(pov, 300, 416);
    textBox(ctx, s.nation, b18, 'Bomb_18', { x: 451, y: 428, w: 326, h: 30, fmt: 'center', vcenter: true, maxLines: 1 });
    ['idea1', 'idea2', 'idea3'].forEach((k, i) => {
      const im = userImg['cs.' + k]; if (!im) return;
      const sc = Math.min(60 / im.width, 66 / im.height, 1), w = im.width * sc, h = im.height * sc;
      ctx.drawImage(im, 451 + 90 + i * 60 + (60 - w) / 2, 475 - 3 + (66 - h) / 2, w, h);
    });
    const byy = 717 - 56;
    [[612 - 158, s.b_back], [612 + 10, s.b_select]].forEach(([bx, t]) => {
      ctx.drawImage(btnU, bx, byy); ctx.drawImage(btn, bx, byy);
      textBox(ctx, t, b16, 'Bomb_16', { x: bx, y: byy, w: 148, h: 34, fmt: 'center', vcenter: true, maxLines: 1 });
    });
    textBox(ctx, s.t_hist, f24, 'aldrich_24_outline', { x: 830, y: 449, w: 340, fmt: 'center', maxLines: 1 });
    const hl = f16[0].lh;
    textBox(ctx, s.history, f16, 'aldrich_16_outline', { x: 815, y: 475, w: 355, maxLines: Math.floor(210 / hl) });
    ctx.restore();
  }
};

/* === Country info screen (interface/TNO_Country_Info_Screen.gui) === */
T.ci = {
  name: '国家情报屏', en: 'Country Info Screen',
  fonts: ['aldrich_32_outline', 'aldrich_20_outline', 'aldrich_18_outline', 'Bomb_16'],
  groups: [
    { title: '正文 Content', fields: [
      { k: 'country', type: 'text', label: '左上国名 Country name', zh: '大日耳曼国', en: 'Greater Germanic Reich' },
      { k: 'ctitle', type: 'text', label: '中央标题 Title', zh: '==德国==', en: '==Germany==' },
      { k: 'cdesc', type: 'textarea', label: '中央正文 Text', rows: 10,
        zh: '§W德国§!赢得了战争，却正在输掉和平。§Y五十年代§!的经济崩溃掏空了帝国的国库，奴隶劳工支撑着摇摇欲坠的工业，而年迈的元首已经很久没有公开露面。\n\n* 平衡§R党§!、§g军队§!与§B改革派§!之间的权力\n* 在元首死后的继承危机中活下来\n* 维持对§O欧洲§!的统治',
        en: '§WGermany§! won the war, and is losing the peace. The economic collapse of the §Y1950s§! hollowed out the Reich\'s treasury, slave labour props up a failing industry, and the ageing Führer has not been seen in public for a long time.\n\n* Balance power between §Rthe Party§!, §gthe Army§! and §Bthe reformists§!\n* Survive the succession crisis after the Führer\'s death\n* Hold on to §OEurope§!' }
    ] },
    { title: '标签页与目录 Tabs & entries', fields: [
      { k: 'tabs', type: 'textarea', label: '顶部标签（每行一个，最多 4 个，行首 * 为选中）', rows: 4, zh: '*国家\n经济\n世界', en: '*Country\nEconomy\nWorld' },
      { k: 'entries', type: 'textarea', label: '左侧目录（每行一条；行首 - 为子条目，* 为选中）', rows: 7,
        zh: '德国\n-*概况\n-元首\n-党与军队\n欧洲\n-统一条约\n-帝国专员辖区', en: 'Germany\n-*Overview\n-The Führer\n-Party and Army\nEurope\n-Einheitspakt\n-Reichskommissariats' },
      { k: 'close', type: 'text', label: '关闭按钮 Close button', zh: '关闭', en: 'Close' }
    ] },
    { title: '图片 Pictures', fields: [
      ...picFields('poster', '右侧海报 Poster (189×426)'),
      { k: 'flag', type: 'image', label: '左上小国旗 Flag（可选）' }
    ] }
  ],
  async draw(s, lang) {
    const [f32, f20, f18, b16] = await Promise.all(['aldrich_32_outline', 'aldrich_20_outline', 'aldrich_18_outline', 'Bomb_16'].map(n => loadChain(n, lang)));
    const [bg, tabs, i1, i2, i3, fold, cont, glow, btn, pnone, fov] = await Promise.all(['ci_bg.png', 'ci_tabs.png', 'ci_tab_icon_1.png', 'ci_tab_icon_2.png', 'ci_tab_icon_3.png', 'ci_folder.png', 'ci_content.png', 'ci_content_glow.png', 'button_123x34.png', 'ci_poster_none.png', 'flag_small_overlay.png'].map(A));
    const OY = 40;
    cv.width = 943; cv.height = 442 + OY; ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.translate(0, OY);
    const pos = userImg['ci.poster'];
    if (pos) ctx.drawImage(fxCanvas(pos, 189, 426, pp(s, 'poster'), 'raw', 0), 749, 8); else ctx.drawImage(pnone, 749, 8);
    ctx.drawImage(bg, 0, 0);
    const icons = [i1, i2, i3, i2];
    String(s.tabs || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 4).forEach((t, i) => {
      const sel = t[0] === '*'; if (sel) t = t.slice(1);
      const x = 99 + i * 188, y = -39;
      ctx.drawImage(tabs, sel ? 188 : 0, 0, 188, 45, x, y, 188, 45);
      ctx.drawImage(icons[i], sel ? 33 : 0, 0, 33, 32, x + 9, y + 9, 33, 32);
      textBox(ctx, t, f18, 'aldrich_18_outline', { x: x + 42, y: y + 9, w: 137, h: 32, vcenter: true, maxLines: 1 });
    });
    const fl = userImg['ci.flag'];
    if (fl) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(fl, 10 + 3, 13 + 2, 20, 17); ctx.drawImage(fov, 10, 13); }
    textBox(ctx, s.country, b16, 'Bomb_16', { x: 43, y: 5, w: 150, h: 36, vcenter: true, maxLines: 2 });
    // entries, clipped to 177x379 at (14,49)
    ctx.save(); ctx.beginPath(); ctx.rect(14, 49, 177, 379); ctx.clip();
    String(s.entries || '').split('\n').map(x => x.replace(/\s+$/, '')).filter(Boolean).forEach((t, i) => {
      const y = 49 + i * 36;
      let child = false, sel = false;
      t = t.trim();
      if (t[0] === '-') { child = true; t = t.slice(1).trim(); }
      if (t[0] === '*') { sel = true; t = t.slice(1).trim(); }
      if (child) {
        ctx.drawImage(cont, sel ? 162 : 0, 0, 162, 32, 14 + 14, y - 1, 162, 32);
        if (sel) ctx.drawImage(glow, 162, 0, 162, 32, 14 + 14, y - 1, 162, 32);
        textBox(ctx, t, f18, 'aldrich_18_outline', { x: 14 + 20, y, w: 145, h: 30, vcenter: true, maxLines: 1 });
      } else {
        ctx.drawImage(fold, sel ? 169 : 0, 0, 169, 30, 14, y, 169, 30);
        textBox(ctx, t, f18, 'aldrich_18_outline', { x: 14 + 5, y, w: 150, h: 30, vcenter: true, maxLines: 1 });
      }
    });
    ctx.restore();
    textBox(ctx, s.ctitle, f32, 'aldrich_32_outline', { x: 195, y: 15, w: 545, fmt: 'center', color: COL_ALD.G, maxLines: 1 });
    textBox(ctx, s.cdesc, f20, 'aldrich_20_outline', { x: 195, y: 52, w: 545, maxLines: Math.floor(377 / f20[0].lh) });
    ctx.drawImage(btn, 782, 401);
    textBox(ctx, s.close, b16, 'Bomb_16', { x: 782, y: 401, w: 123, h: 34, fmt: 'center', vcenter: true, maxLines: 1 });
    ctx.restore();
  }
};

/* ---------- state + UI ---------- */
/* === The user's own "new UI" super event (凉的小模板100.ipv): cold-war frame, FZZJ-WHJZTJW text with a
       darkened lower half ("3D" look) and a soft halo. Drawn at 2x (frame is 602x454 at 1x). === */
function nuPicture(im, w, h, p, mode) {
  const t = fxCanvas(im, w, h, p, mode === 'raw' ? 'raw' : 'gray', 0);
  if (mode !== 'bwca') return t;
  const tc = t.getContext('2d'), d = tc.getImageData(0, 0, w, h), a = d.data, src = new Uint8ClampedArray(a), sh = 5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, xl = Math.max(0, x - sh), xr = Math.min(w - 1, x + sh);
    a[i] = src[(y * w + xr) * 4]; a[i + 2] = src[(y * w + xl) * 4 + 2];
  }
  tc.putImageData(d, 0, 0);
  return t;
}
const nuT = document.createElement('canvas'), nuTc = nuT.getContext('2d');
/* centred text block; `split` = where (in em from the line top) the lower half starts to be darkened */
function nuText(c, text, font, o) {
  const st = { def: [255, 255, 255], cols: COL_BOMB };
  const L = layout(text, [font], o.w, st);
  L.lh = o.pitch; L.height = L.lines.length * o.pitch;
  if (o.maxLines && L.lines.length > o.maxLines) { L.lines.length = o.maxLines; L.height = o.maxLines * o.pitch; }
  const pad = 30, W = o.w + pad * 2, H = L.height + o.em + pad * 2;
  if (nuT.width < W || nuT.height < H) { nuT.width = Math.max(W, nuT.width); nuT.height = Math.max(H, nuT.height); }
  nuTc.globalCompositeOperation = 'source-over';
  nuTc.clearRect(0, 0, nuT.width, nuT.height);
  drawLayout(nuTc, L, pad, pad, o.w, 'center');
  nuTc.globalCompositeOperation = 'source-atop';
  L.lines.forEach((ln, i) => {
    const y = pad + i * o.pitch + o.split * o.em;
    nuTc.fillStyle = 'rgba(0,0,0,0.11)'; nuTc.fillRect(0, y - 2, W, 2);
    nuTc.fillStyle = 'rgba(0,0,0,0.325)'; nuTc.fillRect(0, y, W, o.pitch - o.split * o.em + (i === L.lines.length - 1 ? o.em : 0));
  });
  nuTc.globalCompositeOperation = 'source-over';
  const x = Math.round(o.cx - o.w / 2) - pad, y = o.y - pad, OFF = 4000;
  c.save();
  c.shadowOffsetX = OFF; c.shadowOffsetY = 0;
  // black halo, weighted downwards (the "shadow under the letters" in the project file)
  c.shadowColor = 'rgba(0,0,0,1)';
  c.shadowBlur = 14; c.drawImage(nuT, 0, 0, W, H, x - OFF, y + 4, W, H);
  c.shadowBlur = 8; c.drawImage(nuT, 0, 0, W, H, x - OFF, y + 3, W, H);
  c.shadowBlur = 4; c.drawImage(nuT, 0, 0, W, H, x - OFF, y + 2, W, H);
  c.shadowBlur = 3; c.drawImage(nuT, 0, 0, W, H, x - OFF, y + 1, W, H);
  c.shadowColor = 'rgba(255,255,255,' + o.glow + ')'; c.shadowBlur = 14; c.drawImage(nuT, 0, 0, W, H, x - OFF, y, W, H);
  c.restore();
  c.drawImage(nuT, 0, 0, W, H, x, y, W, H);
}
T.nu = {
  name: '新 UI 超事件', en: 'New UI Super Event',
  groups: [
    { title: '文字 Text', fields: [
      { k: 'title', type: 'text', label: '标题 Title', zh: '黑色方案', en: 'CASE BLACK' },
      { k: 'quote', type: 'textarea', label: '引言 Quote（回车换行）', rows: 4,
        zh: '“叛乱就会遭到镇压，这是永恒不变的铁律\n阿道夫 希特勒”', en: '"Rebellion will be crushed. That is the eternal law."\nAdolf Hitler' },
      { k: 'option', type: 'text', label: '按钮 Button', zh: '亡羊补牢', en: 'Too Late' }
    ] },
    { title: '图片 Picture', fields: [
      { k: 'preset', type: 'thumbs', label: '示例图 Sample pictures', list: () => window.TNO_ASSETS.se.map(n => 'assets/se/' + n + '.png'), def: 'assets/se/great_asian_war.png' },
      ...picFields('pic', '上传自己的图片 Upload (558×326)'),
      { k: 'filter', type: 'select', label: '图片处理 Picture', def: 'bwca', opts: [['bwca', '黑白 + 红蓝色散（同工程文件里的效果）'], ['bw', '黑白'], ['raw', '保留原色']] }
    ] },
    { title: '配乐 Music', fields: [{ k: 'music', type: 'audio' }] }
  ],
  async draw(s, lang) {
    const [ft, fb] = await Promise.all(['nu_title', 'nu_button'].map(loadFont)), fq = fb;
    const [base, glass, frame] = await Promise.all(['nu_base.png', 'nu_glass.png', 'nu_frame.png'].map(A));
    cv.width = 1204; cv.height = 908; ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, 0, 0);
    const im = userImg['nu.pic'] || await loadImg(s.preset);
    ctx.save();
    ctx.beginPath();
    const x = 42, y = 140, w = 1116, h = 652, r = 24;
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.clip();
    ctx.drawImage(nuPicture(im, w, h, userImg['nu.pic'] ? pp(s, 'pic') : null, s.filter), x, y);
    ctx.restore();
    ctx.drawImage(glass, 0, 0);
    ctx.drawImage(frame, 0, 0);
    // 方正综艺简体 (FZZYJW--GB1-0), sizes fitted to the .ipv composite: 1x title 21px, quote and button 17px, no tracking
    nuText(ctx, s.title, ft, { cx: 600, y: 46, w: 1000, em: 42, pitch: 60, split: 0.624, glow: 0.3, maxLines: 1 });
    nuText(ctx, s.quote, fq, { cx: 587, y: 583, w: 1040, em: 34, pitch: 50, split: 0.53, glow: 0.25, maxLines: 4 });
    nuText(ctx, s.option, fb, { cx: 586, y: 816, w: 440, em: 34, pitch: 48, split: 0.585, glow: 0.25, maxLines: 1 });
  }
};

/* === Diplomacy panels from the user's two ibisPaint projects (凉的小模板93 = flat "new UI" with the layout,
       无标题554 = blank cold-war small panel). Same text effect as T.nu: 方正综艺 (Chinese) / Oxanium Bold (English),
       darkened lower half + black halo. Both are drawn at about 2x of the project size. === */
const fxT = document.createElement('canvas'), fxTc = fxT.getContext('2d');
const fxS = document.createElement('canvas'), fxSc = fxS.getContext('2d');
/* o: {x|cx, y, em, pitch, split, track, align:'left'|'center', dark, soft, glow, maxLines, w (wrap width), rot+cy (90° cw, centred on cx,cy)} */
function fxText(c, text, chain, o) {
  // fs: draw a bitmap font larger/smaller than its native size (the text is laid out natively, then scaled once)
  const fs = o.fontScale || 1;
  if (fs !== 1) {
    const nat = Object.assign({}, o, { fontScale: 1, w: (o.w || 4000) / fs, em: o.em / fs, pitch: Math.round(o.pitch / fs), track: (o.track || 0) / fs, glow: 0, _raw: true });
    const r = fxText(null, text, chain, nat);
    return fxFinish(c, r.canvas, r.W, r.H, r.bw, r.n, o, fs);
  }
  const L = layout(text, chain, o.w || 4000, { def: [255, 255, 255], cols: COL_BOMB });
  if (o.maxLines && L.lines.length > o.maxLines) L.lines.length = o.maxLines;
  const tr = o.track || 0, em = o.em, n = L.lines.length;
  L.lines.forEach(ln => {
    let x = 0, end = 0;
    ln.glyphs.forEach(g => { g.x = Math.round(x); x += g.adv + tr; if (g.code !== 32 && g.code !== 0x3000) end = g.x + g.adv; });
    ln.tw = end;
  });
  L.lh = o.pitch; L.height = n * o.pitch;
  const bw = Math.max(1, ...L.lines.map(l => l.tw)), pad = 8;
  const W = bw + pad * 2, H = Math.ceil((n - 1) * o.pitch + em * 1.4) + pad * 2;
  if (fxT.width < W || fxT.height < H) { fxT.width = Math.max(W, fxT.width); fxT.height = Math.max(H, fxT.height); }
  fxTc.globalCompositeOperation = 'source-over';
  fxTc.clearRect(0, 0, fxT.width, fxT.height);
  drawLayout(fxTc, L, pad, pad, bw, o.align === 'left' ? 'left' : 'center');
  // faux bold for thin bitmap fonts: stamp the text again, shifted sideways
  for (let i = 1; i <= (o.bold || 0); i++) fxTc.drawImage(fxT, 0, 0, W, H, 1, 0, W, H);
  fxTc.globalCompositeOperation = 'source-atop';
  const dark = o.dark == null ? 0.3 : o.dark, soft = o.soft == null ? 2 : o.soft;
  L.lines.forEach((ln, i) => {
    const top = pad + Math.round(i * o.pitch), yb = top + o.split * em;
    const next = i === n - 1 ? top + em * 1.4 : pad + Math.round((i + 1) * o.pitch);
    const g = fxTc.createLinearGradient(0, yb - soft, 0, yb + soft);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + dark + ')');
    fxTc.fillStyle = g; fxTc.fillRect(0, yb - soft, W, next - (yb - soft));
  });
  fxTc.globalCompositeOperation = 'source-over';
  if (o._raw) return { canvas: fxT, W, H, bw, n };
  return fxFinish(c, fxT, W, H, bw, n, o, 1);
}
const fxU = document.createElement('canvas'), fxUc = fxU.getContext('2d');
/* halo + glow + placement; src holds the finished white/grey text with an 8px pad (scaled by fs when fs != 1) */
function fxFinish(c, src, W, H, bw, n, o, fs) {
  const em = o.em, pad = Math.round(8 * fs);
  if (fs !== 1) {
    const W2 = Math.ceil(W * fs), H2 = Math.ceil(H * fs);
    if (fxU.width < W2 || fxU.height < H2) { fxU.width = Math.max(W2, fxU.width); fxU.height = Math.max(H2, fxU.height); }
    fxUc.clearRect(0, 0, fxU.width, fxU.height); fxUc.imageSmoothingEnabled = true; fxUc.imageSmoothingQuality = 'high';
    fxUc.drawImage(src, 0, 0, W, H, 0, 0, W2, H2);
    src = fxU; W = W2; H = H2; bw = Math.round(bw * fs);
  }
  const fxT = src;
  const m = 26, SW = W + m * 2, SH = H + m * 2, k = em / 38, OFF = 6000;
  if (fxS.width < SW || fxS.height < SH) { fxS.width = Math.max(SW, fxS.width); fxS.height = Math.max(SH, fxS.height); }
  fxSc.clearRect(0, 0, fxS.width, fxS.height);
  fxSc.save();
  fxSc.shadowOffsetX = OFF; fxSc.shadowOffsetY = 0; fxSc.shadowColor = 'rgba(0,0,0,1)';
  [[14, 4], [8, 3], [4, 2], [3, 1]].forEach(([b, dy]) => { fxSc.shadowBlur = b * k; fxSc.drawImage(fxT, 0, 0, W, H, m - OFF, m + Math.round(dy * k), W, H); });
  if (o.glow) { fxSc.shadowColor = 'rgba(255,255,255,' + o.glow + ')'; fxSc.shadowBlur = 14 * k; fxSc.drawImage(fxT, 0, 0, W, H, m - OFF, m, W, H); }
  fxSc.restore();
  fxSc.drawImage(fxT, 0, 0, W, H, m, m, W, H);
  const blockH = (n - 1) * o.pitch + em;
  if (o.rot) {
    c.save(); c.translate(Math.round(o.cx), Math.round(o.cy)); c.rotate(Math.PI / 2);
    c.drawImage(fxS, 0, 0, SW, SH, Math.round(-bw / 2) - pad - m, Math.round(-blockH / 2) - pad - m, SW, SH);
    c.restore();
  } else {
    const bx = o.align === 'left' ? Math.round(o.x) : Math.round(o.cx - bw / 2);
    c.drawImage(fxS, 0, 0, SW, SH, bx - pad - m, Math.round(o.y) - pad - m, SW, SH);
  }
}
/* icon into a slot: trim the transparent margin (soft glow excluded), then scale so the visible artwork fills the slot */
function fitSlot(c, im, cx, cy, w, h, mul) {
  if (!im._trim) {
    const t = document.createElement('canvas'); t.width = im.naturalWidth || im.width; t.height = im.naturalHeight || im.height;
    const tc = t.getContext('2d'); tc.drawImage(im, 0, 0);
    let x0 = t.width, y0 = t.height, x1 = -1, y1 = -1;
    try {
      const d = tc.getImageData(0, 0, t.width, t.height).data;
      for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) if (d[(y * t.width + x) * 4 + 3] > 96) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    } catch (e) {}
    im._trim = x1 < 0 ? [0, 0, t.width, t.height] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }
  const [tx, ty, tw, th] = im._trim, sc = Math.min(w / tw, h / th) * (mul || 1);
  c.imageSmoothingQuality = 'high';
  // draw the whole image (glow included) so that its trimmed box is centred on the slot
  c.drawImage(im, Math.round(cx - (tx + tw / 2) * sc), Math.round(cy - (ty + th / 2) * sc), (im.naturalWidth || im.width) * sc, (im.naturalHeight || im.height) * sc);
}
function rrPath(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
/* geometry: B measured in the project's final composite (x2), A from hoi4-panel-ui/build_intel.py (design px = 1.965x project px) */
const DP = {
  b: { W: 1264, H: 650, frame: 'dpB_frame.png', clean: 'dpB_frame_clean.png',
    flag: [116, 130, 152, 92, 0], portrait: [70, 254, 240, 322, 0], pie: [424.6, 387.4, 51],
    faction: [423, 228, 158, 125], emblem: [1066, 229, 120, 122], focus: [425, 539, 182, 135],   // icon slots = visible icon sizes in the project x2
    zh: { info: { x: 502, y: 182, pitch: 36, track: 1.33 }, party: { x: 568, y: 335, pitch: 44.4, track: 2 }, btn: { cx: 824, y: 512, track: 2 } },
    en: { info: { x: 512, y: 183, pitch: 36 }, party: { x: 567, y: 336, pitch: 45 }, btn: { cx: 835, y: 513 } },
    labels: { tab1: { cx: 536, y: 116 }, tab2: { cx: 943, y: 118 }, side: { cx: 1169, cy: 329 } } },
  a: { W: 1320, H: 660, frame: 'dpA_frame.png', base: 'dpA_base.png', glass: 'dpA_glass.png',
    flag: [110, 122, 180, 98, 12], portrait: [72, 256, 250, 342, 20], pie: [441.5, 394, 55],
    faction: [447, 235.5, 124, 98], emblem: [1117, 235.5, 94, 96], focus: [441.5, 547, 143, 106],   // = B's three slots x0.8 (one factor for all three, so the icons keep their relative sizes)   // icons fill their screens the way they do in B (about 95% of the screen height), never over the bezel
    fonts: { zi: 'zy_26', zp: 'zy_30', ei: 'ox_24', ep: 'ox_28' },
    zh: { info: { x: 524, y: 189, pitch: 32, track: 1 }, party: { x: 609, y: 351, pitch: 41, track: 1.5 }, btn: { cx: 835, y: 528, track: 1.5 } },
    en: { info: { x: 526, y: 191, pitch: 32 }, party: { x: 609, y: 351, pitch: 41 }, btn: { cx: 835, y: 530 } } }
};
const DP_LABELS = { tab1: 'Diplomacy', tab2: 'Intel Ledger', side: 'COLD WAR INTERFACE' };
function dpGroups(kind) {
  const g = [
    { title: '文字 Text', fields: [
      { k: 'info', type: 'textarea', rows: 3, label: '上栏三行：国名 / 阵营 / 领袖', zh: '神圣俄罗斯帝国\n欧洲公约\n芭芭拉·冯·塔博里茨基', en: 'People’s Republic of China\nNo Faction\nSong Puxuan' },
      { k: 'party', type: 'textarea', rows: 3, label: '下栏三行：执政党 / 意识形态 / 选举', zh: '王党\n威权发展主义\n事件选举', en: 'Chinese Communist Party\nAuthoritarian Developmentalism\nEvent Election' },
      { k: 'button', type: 'text', label: '按钮文字（国策名）', zh: '往日之影', en: 'Courage Operation' }
    ] },
    { title: '图片 Pictures', fields: [
      ...picFields('portrait', '领袖头像 Portrait'),
      { k: 'flag', type: 'image', label: '国旗 Flag' },
      { k: 'samples', type: 'check', label: '没上传头像时显示剪影', def: true },
      { k: 'pie', type: 'textarea', rows: 5, label: '饼图：每行「百分比 颜色」',
        zh: '8 #303030\n14 #7a261f\n14 #1f2f78\n22 #2a2a2a\n20 #333333\n22 #3b3b3b', en: '8 #303030\n14 #7a261f\n14 #1f2f78\n22 #2a2a2a\n20 #333333\n22 #3b3b3b' }
    ] }
  ];
  if (kind === 'b') g.splice(1, 0, { title: '界面标签 Labels（改了才重画，不改就用工程里的原样）', fields: [
    { k: 'tab1', type: 'text', label: '左标签', zh: DP_LABELS.tab1, en: DP_LABELS.tab1 },
    { k: 'tab2', type: 'text', label: '右标签', zh: DP_LABELS.tab2, en: DP_LABELS.tab2 },
    { k: 'side', type: 'text', label: '右侧竖排标题', zh: DP_LABELS.side, en: DP_LABELS.side }
  ] });
  return g;
}
async function drawPanel(kind, key, s, lang) {
  const P = DP[kind], zh = lang === 'zh', G = P[zh ? 'zh' : 'en'];
  // B keeps the project's sizes (28/32 and 26/30 px at 2x); A is one size smaller at the user's request (26/30 and 24/28)
  const F = P.fonts || { zi: 'zy_28', zp: 'zy_32', ei: 'ox_26', ep: 'ox_30' };
  const [zyI, zyP, oxI, oxP, zy28, ox29, ox30] = await Promise.all([F.zi, F.zp, F.ei, F.ep, 'zy_28', 'ox_29', 'ox_30'].map(loadFont));
  const edited = kind === 'b' && ['tab1', 'tab2', 'side'].some(k => String(s[k]).trim() !== DP_LABELS[k]);
  const [frame, base, glass, unk] = await Promise.all([A(edited ? P.clean : P.frame), P.base ? A(P.base) : null, P.glass ? A(P.glass) : null, A('leader_unknown.png')]);
  cv.width = P.W; cv.height = P.H; ctx.clearRect(0, 0, P.W, P.H);
  const img = k => userImg[key + '.' + k];
  // screens behind the cut-outs
  if (base) ctx.drawImage(base, 0, 0);
  else {
    ctx.fillStyle = '#0b0b0c';
    ctx.fillRect(P.flag[0], P.flag[1], P.flag[2], P.flag[3]); ctx.fillRect(P.portrait[0], P.portrait[1], P.portrait[2], P.portrait[3]);
    ctx.beginPath(); ctx.arc(P.pie[0], P.pie[1], P.pie[2], 0, Math.PI * 2); ctx.fill();
  }
  const inWindow = (R, fn) => { ctx.save(); rrPath(ctx, R[0], R[1], R[2], R[3], R[4]); ctx.clip(); fn(); ctx.restore(); };
  if (img('flag')) inWindow(P.flag, () => drawCover(ctx, img('flag'), P.flag[0], P.flag[1], P.flag[2], P.flag[3], null));
  const por = img('portrait') || (s.samples ? unk : null);
  if (por) inWindow(P.portrait, () => drawCover(ctx, por, P.portrait[0], P.portrait[1], P.portrait[2], P.portrait[3], img('portrait') ? pp(s, 'portrait') : null));
  const pie = parsePie(s.pie), tot = pie.reduce((a, p) => a + p.v, 0);
  if (tot > 0) {
    let a0 = -Math.PI / 2;
    for (const p of pie) {
      const a1 = a0 + p.v / tot * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(P.pie[0], P.pie[1]); ctx.arc(P.pie[0], P.pie[1], P.pie[2], a0, a1); ctx.closePath(); ctx.fillStyle = p.c; ctx.fill();
      a0 = a1;
    }
  }
  if (glass) ctx.drawImage(glass, 0, 0);
  ctx.drawImage(frame, 0, 0);
  // icon screens (faction / ideology emblem / focus) stay empty: the user pastes icons in themselves (2026-11-17)
  // text
  const cInfo = zh ? [zyI] : [oxI, zyI], cParty = zh ? [zyP] : [oxP, zyP];
  const eI = cInfo[0].lh, eP = cParty[0].lh, split = zh ? 0.55 : 0.61, dark = zh ? 0.3 : 0.28;
  fxText(ctx, s.info, cInfo, { x: G.info.x, y: G.info.y, em: eI, pitch: G.info.pitch, track: G.info.track, split, dark, align: 'left', glow: 0.2, maxLines: 3 });
  fxText(ctx, s.party, cParty, { x: G.party.x, y: G.party.y, em: eP, pitch: G.party.pitch, track: G.party.track, split, dark, align: 'left', glow: 0.2, maxLines: 3 });
  fxText(ctx, s.button, cParty, { cx: G.btn.cx, y: G.btn.y, em: eP, pitch: 44, track: G.btn.track, split, dark, align: 'center', glow: 0.2, maxLines: 1 });
  if (edited) {
    const Lb = P.labels, ch = [ox29, zy28];
    fxText(ctx, s.tab1, ch, { cx: Lb.tab1.cx, y: Lb.tab1.y, em: 29, pitch: 40, split: 0.56, dark: 0.3, align: 'center', glow: 0.2, maxLines: 1 });
    fxText(ctx, s.tab2, ch, { cx: Lb.tab2.cx, y: Lb.tab2.y, em: 29, pitch: 40, split: 0.56, dark: 0.3, align: 'center', glow: 0.2, maxLines: 1 });
    fxText(ctx, s.side, [ox30, zy28], { cx: Lb.side.cx, cy: Lb.side.cy, em: 30, pitch: 40, split: 0.5, dark: 0.34, align: 'center', glow: 0.15, maxLines: 1, rot: true });
  }
}
T.dpb = { name: '外交面板·新 UI', en: 'Diplomacy Panel (New UI)', scale: 2, groups: dpGroups('b'), draw(s, lang) { return drawPanel('b', 'dpb', s, lang); } };
T.dpa = { name: '外交面板·冷战风', en: 'Diplomacy Panel (Cold War)', scale: 2, groups: dpGroups('a'), draw(s, lang) { return drawPanel('a', 'dpa', s, lang); } };
T.nu.scale = 2;

/* === Cold-war news / event window: the user's frame (hoi4-panel-ui build_news, 581 wide, three heights, drawn at 2x)
       laid out like Red Dusk's EventWindow (also 581 wide): centred title at the top of the bay, description below it,
       picture bottom-left, one option on the bar. Chinese = 方正综艺; English = Red Dusk's event fonts
       (title hoi_36header, body Ubuntu Bold = hoi_18mbs, option Ubuntu = hoi_20bs). Same text effect as the panels. === */
T.cwn = {
  name: '冷战风新闻', en: 'Cold War News', scale: 2,
  groups: [
    { title: '文字 Text', fields: [
      { k: 'title', type: 'text', label: '标题 Title', zh: '柏林墙倒塌', en: 'The Wall Comes Down' },
      { k: 'desc', type: 'textarea', rows: 9, label: '正文 Description',
        zh: '今天凌晨，一封加急电报送抵外交部。电文不长，措辞却异常强硬：对方要求我们在四十八小时内给出明确答复，否则将自行采取行动。\n\n内阁已经连夜召开紧急会议，军方的将领们主张立即进入戒备，而外交官们则希望再争取一点时间。街头的报童还在叫卖昨天的旧闻，没有人知道明天的头版会写些什么。',
        en: 'An urgent telegram reached the Foreign Ministry before dawn. It is short and unusually blunt: we are to give a clear answer within forty-eight hours, or the other side will act on its own.\n\nThe cabinet has been in emergency session all night. The generals want the armed forces on alert at once; the diplomats ask for a little more time. On the street the newsboys are still shouting yesterday’s headlines, and nobody knows what tomorrow’s front page will say.' },
      { k: 'option', type: 'text', label: '选项 Option', zh: '历史的车轮滚滚向前。', en: 'History moves on.' }
    ] },
    { title: '窗口 Window', fields: [
      { k: 'h', type: 'select', label: '高度 Height', def: '676', opts: [['676', '短 676'], ['781', '中 781'], ['1096', '长 1096']] }
    ] },
    { title: '图片 Picture', fields: [
      ...picFields('pic', '左下图片 Picture (173×140)'),
      { k: 'gray', type: 'check', label: '转为黑白 Greyscale', def: false }
    ] }
  ],
  async draw(s, lang) {
    const zh = lang === 'zh', H = +s.h || 676;
    const [zt, zb, zo, et, eb, eo] = await Promise.all(['nu_title', 'zy_28', 'zy_30', 'hoi_36header', 'ub_28', 'um_30'].map(loadFont));
    const frame = await A('nw_' + H + '.png');
    cv.width = 1162; cv.height = H * 2; ctx.clearRect(0, 0, cv.width, cv.height);
    // picture window (28, H-192)-(201, H-52) at 1x, under the cut-out
    const px = 56, py = (H - 192) * 2, pw = 346, ph = 280;
    ctx.fillStyle = '#0b0b0c'; ctx.fillRect(px, py, pw, ph);
    const im = userImg['cwn.pic'];
    if (im) ctx.drawImage(fxCanvas(im, pw, ph, pp(s, 'pic'), s.gray ? 'gray' : 'raw', 0), px, py);
    ctx.drawImage(frame, 0, 0);
    const common = { split: zh ? 0.55 : 0.6, dark: 0.3, glow: 0.2 };
    // Red Dusk: Title at (14,115) width 551 centred; Description at (31,181) width 512; option centred on the bar
    if (zh) fxText(ctx, s.title, [zt], Object.assign({ cx: 579, y: 245, em: 42, pitch: 56, align: 'center', maxLines: 1 }, common));
    else fxText(ctx, s.title, [et, zt], Object.assign({ cx: 579, y: 243, em: 46, pitch: 56, align: 'center', maxLines: 1, fontScale: 46 / 36, bold: 1 }, common));
    const barTop = (H - 205) * 2, top = 340, pitch = zh ? 40 : 38;
    fxText(ctx, s.desc, zh ? [zb] : [eb, zb], Object.assign({ x: 62, y: top, w: 1030, em: 28, pitch, track: zh ? 1 : 0, align: 'left', maxLines: Math.max(1, Math.floor((barTop - 24 - top) / pitch)) }, common));
    const oem = 30, ocy = (H - 184.5) * 2;
    fxText(ctx, s.option, zh ? [zo] : [eo, zo], Object.assign({ cx: 772, y: Math.round(ocy - oem * (zh ? 0.54 : 0.56)), w: 560, em: oem, pitch: 40, track: zh ? 1 : 0, align: 'center', maxLines: 1 }, common));
  }
};

/* sound library tab: keeps showing the super event, lists the bundled sounds */
T.sfx = {
  name: '音效素材库', en: 'Sound Library',
  groups: [{ title: '免费音效素材 Free sounds', fields: [{ k: 'lib', type: 'sfxlib' }] }],
  draw(s, lang) { return T.se.draw(getState('se', lang), lang); }
};
const ORDER = ['se', 'nu', 'dpb', 'dpa', 'cwn', 'sfx', 'news', 'report', 'pol', 'cs', 'ci'];
let cur = 'se', lang = 'zh';
let store = {};
try { store = JSON.parse(localStorage.getItem('tno-maker-v1') || '{}') || {}; } catch (e) { store = {}; }
try { const m = JSON.parse(localStorage.getItem('tno-maker-ui') || '{}'); if (T[m.cur]) cur = m.cur; if (m.lang === 'en' || m.lang === 'zh') lang = m.lang; } catch (e) {}
if (T[location.hash.slice(1)]) cur = location.hash.slice(1);
const save = () => { try { localStorage.setItem('tno-maker-v1', JSON.stringify(store)); localStorage.setItem('tno-maker-ui', JSON.stringify({ cur, lang })); } catch (e) {} };

const fieldsOf = t => T[t].groups.flatMap(g => g.fields);
const isText = f => f.zh !== undefined;
function defVal(f, lg) { return isText(f) ? f[lg] : f.def; }
function getState(t, lg) {
  const s = {}, saved = store[t] || {};
  for (const f of fieldsOf(t)) {
    if (f.type === 'image' || f.type === 'images' || f.type === 'audio' || f.type === 'sfxlib') continue;
    const key = isText(f) ? f.k + '@' + lg : f.k;
    s[f.k] = saved[key] !== undefined ? saved[key] : defVal(f, lg);
  }
  return s;
}
function setVal(t, f, v) {
  store[t] = store[t] || {};
  store[t][isText(f) ? f.k + '@' + lang : f.k] = v;
  save();
}

let renderSeq = 0, pending = null;
function render() { clearTimeout(pending); pending = setTimeout(doRender, 30); }
async function doRender() {
  const seq = ++renderSeq, t = cur, lg = lang;
  statusEl.className = 'status'; statusEl.textContent = '正在绘制… Rendering';
  const off = document.createElement('canvas');
  try {
    await T[t].draw(getState(t, lg), lg);
    // keep the preview in proportion even if a stale cached page still has the old stylesheet
    if (!$('#stage').classList.contains('zoom1')) { cv.style.width = 'auto'; cv.style.height = 'auto'; cv.style.maxWidth = '100%'; cv.style.maxHeight = '78vh'; cv.style.flex = 'none'; cv.style.aspectRatio = cv.width + ' / ' + cv.height; }
    cv.parentNode.style.alignItems = 'flex-start';
    if (seq !== renderSeq) return render();
    const two = T[t].scale === 2;
    statusEl.textContent = cv.width + ' × ' + cv.height + ' px' + (two ? '（2 倍清晰度，工程原尺寸约 ' + Math.round(cv.width / 2) + ' × ' + Math.round(cv.height / 2) + '）' : '') + ' · ' + (lg === 'zh' ? '中文字体' : 'English fonts');
    $('#dl2').textContent = two ? '下载 1×（工程原尺寸）' : '下载 2×';
  } catch (e) {
    console.error(e);
    statusEl.className = 'status err'; statusEl.textContent = '出错了：' + e.message + '（请检查网络后刷新）';
  }
}

function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else if (k in e && k !== 'list') e[k] = attrs[k]; else e.setAttribute(k, attrs[k]); }
  (kids || []).forEach(c => e.appendChild(c));
  return e;
}
function readFile(file, key) {
  if (!file) return;
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => { userImg[key] = im; render(); };
  im.onerror = () => { statusEl.className = 'status err'; statusEl.textContent = '这个文件不是浏览器能打开的图片（DDS/TGA 请先转成 PNG）'; };
  im.src = url;
}
function buildForm() {
  const form = $('#form'); form.textContent = '';
  const s = getState(cur, lang);
  for (const g of T[cur].groups) {
    const fs = el('fieldset', {}, [el('legend', { text: g.title })]);
    for (const f of g.fields) {
      const id = 'f-' + cur + '-' + f.k;
      const lab = el('span', {}, [el('b', { text: f.label })]);
      if (f.type === 'text' || f.type === 'textarea') {
        const inp = f.type === 'text' ? el('input', { type: 'text', id, value: s[f.k] }) : el('textarea', { id, rows: f.rows || 4, value: s[f.k] });
        inp.addEventListener('input', () => { setVal(cur, f, inp.value); render(); });
        fs.appendChild(el('label', { className: 'f' }, [lab, inp]));
      } else if (f.type === 'select') {
        const sel = el('select', { id }, f.opts.map(o => el('option', { value: o[0], text: o[1] })));
        sel.value = s[f.k];
        sel.addEventListener('change', () => { setVal(cur, f, sel.value); render(); });
        fs.appendChild(el('label', { className: 'f' }, [lab, sel]));
      } else if (f.type === 'range') {
        const inp = el('input', { type: 'range', id, min: f.min, max: f.max, step: f.step });
        inp.value = s[f.k];
        inp.addEventListener('input', () => { setVal(cur, f, +inp.value); render(); });
        fs.appendChild(el('label', { className: 'f' }, [lab, inp]));
      } else if (f.type === 'check') {
        const inp = el('input', { type: 'checkbox', id, checked: !!s[f.k] });
        inp.addEventListener('change', () => { setVal(cur, f, inp.checked); render(); });
        fs.appendChild(el('label', { className: 'chk' }, [inp, el('span', { text: f.label })]));
      } else if (f.type === 'image') {
        const key = cur + '.' + f.k;
        const inp = el('input', { type: 'file', id, accept: 'image/*' });
        inp.addEventListener('change', () => readFile(inp.files[0], key));
        const clr = el('button', { type: 'button', className: 'btn', text: '清除 Clear' });
        clr.addEventListener('click', () => { userImg[key] = null; inp.value = ''; render(); });
        fs.appendChild(el('label', { className: 'f' }, [lab, el('div', { className: 'row' }, [inp, clr])]));
      } else if (f.type === 'images') {
        const key = cur + '.' + f.k;
        const inp = el('input', { type: 'file', id, accept: 'image/*', multiple: true });
        inp.addEventListener('change', async () => {
          const list = [];
          for (const file of Array.from(inp.files).slice(0, f.max || 6)) {
            const im = new Image(); im.src = URL.createObjectURL(file);
            try { await new Promise((r, j) => { im.onload = r; im.onerror = j; }); list.push(im); } catch (e) {}
          }
          userImg[key] = list; render();
        });
        const clr = el('button', { type: 'button', className: 'btn', text: '清除 Clear' });
        clr.addEventListener('click', () => { userImg[key] = null; inp.value = ''; render(); });
        fs.appendChild(el('label', { className: 'f' }, [lab, el('div', { className: 'row' }, [inp, clr])]));
      } else if (f.type === 'audio') {
        fs.appendChild(buildAudioUI());
      } else if (f.type === 'sfxlib') {
        fs.appendChild(buildSfxUI());
      } else if (f.type === 'thumbs') {
        const box = el('div', { className: 'thumbs' });
        f.list().forEach(src => {
          const b = el('button', { type: 'button', className: f.wide ? 'wide' : '', title: src.split('/').pop().replace('.png', '') }, [el('img', { src, loading: 'lazy', alt: '' })]);
          b.addEventListener('click', () => {
            setVal(cur, f, src);
            if (cur === 'se') userImg['se.pic'] = null;
            if (cur === 'nu') userImg['nu.pic'] = null;
            if (cur === 'news') userImg['news.hdr'] = null;
            render();
          });
          box.appendChild(b);
        });
        fs.appendChild(el('div', { className: 'f' }, [lab, box]));
      }
    }
    form.appendChild(fs);
  }
}
/* ---------- super event music: cut a clip out of any audio / video file ---------- */
const Au = { ctx: null, buf: null, name: '', start: 0, len: 30, fin: 0, fout: 2, node: null, peaks: null, rec: null };
const SE_LEN = 30;   // TNO ships 89 super event tracks, 10.7–72 s, mean 30.8 s
function auCtx() { if (!Au.ctx) Au.ctx = new (window.AudioContext || window.webkitAudioContext)(); return Au.ctx; }
/* sound-library layers mixed on top of the music: {id, name, buf, at (s into the clip), vol} */
const Layers = [];
const sfxBuf = {};
function loadSfx(id) {
  if (!sfxBuf[id]) sfxBuf[id] = fetch('sfx/' + id + '.mp3').then(r => { if (!r.ok) throw new Error('素材下载失败'); return r.arrayBuffer(); })
    .then(ab => new Promise((res, rej) => auCtx().decodeAudioData(ab, res, rej)));
  return sfxBuf[id];
}
function auClip() {
  const b = Au.buf, sr = b ? b.sampleRate : auCtx().sampleRate;
  const s0 = b ? Math.max(0, Math.floor(Au.start * sr)) : 0;
  const n = Math.max(1, b ? Math.min(b.length - s0, Math.floor(Au.len * sr)) : Math.floor(Au.len * sr));
  const out = auCtx().createBuffer(2, n, sr);
  const fi = Math.min(n, Math.floor(Au.fin * sr)), fo = Math.min(n, Math.floor(Au.fout * sr));
  for (let ch = 0; ch < 2; ch++) {
    const dst = out.getChannelData(ch);
    if (b) dst.set(b.getChannelData(Math.min(ch, b.numberOfChannels - 1)).subarray(s0, s0 + n));
    for (const L of Layers) {
      const src = L.buf.getChannelData(Math.min(ch, L.buf.numberOfChannels - 1));
      const o = Math.floor(L.at * sr), m = Math.min(src.length, n - o);
      for (let i = Math.max(0, -o); i < m; i++) dst[o + i] += src[i] * L.vol;
    }
    for (let i = 0; i < fi; i++) dst[i] *= i / fi;
    for (let i = 0; i < fo; i++) dst[n - 1 - i] *= i / fo;
    for (let i = 0; i < n; i++) { const v = dst[i]; if (v > 1) dst[i] = 1; else if (v < -1) dst[i] = -1; }
  }
  return out;
}
let layerBoxes = [];
function refreshLayers() {
  layerBoxes = layerBoxes.filter(b => b.isConnected);
  layerBoxes.forEach(box => {
    box.textContent = '';
    if (!Layers.length) { box.appendChild(el('p', { className: 'hint', text: '还没有加入素材。到「音效素材库」页签里点「加入配乐」。' })); return; }
    Layers.forEach((L, i) => {
      const at = el('input', { type: 'range', min: 0, max: Math.max(1, Au.len - 0.5), step: 0.1 }); at.value = L.at;
      const vol = el('input', { type: 'range', min: 0, max: 1.5, step: 0.05 }); vol.value = L.vol;
      const la = el('b', { text: '出现时间：第 ' + L.at.toFixed(1) + ' 秒' }), lv = el('b', { text: '音量：' + Math.round(L.vol * 100) + '%' });
      at.addEventListener('input', () => { L.at = +at.value; la.textContent = '出现时间：第 ' + L.at.toFixed(1) + ' 秒'; });
      vol.addEventListener('input', () => { L.vol = +vol.value; lv.textContent = '音量：' + Math.round(L.vol * 100) + '%'; });
      const rm = el('button', { type: 'button', className: 'btn', text: '移除' });
      rm.addEventListener('click', () => { Layers.splice(i, 1); refreshLayers(); });
      const row = el('div', { className: 'layer' }, [
        el('div', { className: 'row' }, [el('span', { className: 'chk', text: (i + 1) + '. ' + L.name + '（' + L.buf.duration.toFixed(1) + ' 秒）' }), el('span', { className: 'spacer' }), rm]),
        el('div', { className: 'row' }, [el('label', { className: 'f' }, [el('span', {}, [la]), at]), el('label', { className: 'f' }, [el('span', {}, [lv]), vol])])
      ]);
      box.appendChild(row);
    });
  });
}
function layerList() { const box = el('div', { className: 'layers' }); layerBoxes.push(box); setTimeout(refreshLayers, 0); return box; }
function mixButtons(info) {
  const play = el('button', { type: 'button', className: 'btn primary', text: '试听合成效果' });
  const stop = el('button', { type: 'button', className: 'btn', text: '停止' });
  const wav = el('button', { type: 'button', className: 'btn', text: '导出配乐 WAV' });
  play.addEventListener('click', () => {
    if (!Au.buf && !Layers.length) { info.textContent = '请先上传音乐，或从素材库加入至少一个素材。'; return; }
    auStop(); auCtx().resume();
    const n = auCtx().createBufferSource(); n.buffer = auClip(); n.connect(auCtx().destination); n.start(); Au.node = n;
  });
  stop.addEventListener('click', auStop);
  wav.addEventListener('click', () => {
    if (!Au.buf && !Layers.length) { info.textContent = '请先上传音乐，或从素材库加入至少一个素材。'; return; }
    saveBlob(wavBlob(auClip()), 'tno_se_' + (Au.name || 'mix') + '.wav');
  });
  return el('div', { className: 'row' }, [play, stop, wav]);
}
const SFX_CAT = { radio: '无线电 Radio', speech: '演讲 Speeches', war: '战争 War', crowd: '人群与环境 Crowd & ambience' };
function buildSfxUI() {
  const box = el('div', { className: 'f' });
  const info = el('p', { className: 'hint', text: '点「试听」先听一下，点「加入配乐」就会叠到超事件配乐里（没上传音乐也可以只用素材）。加入后在下面调出现时间和音量。' });
  box.appendChild(info);
  let prev = null;
  const list = window.TNO_SFX || [];
  Object.keys(SFX_CAT).forEach(cat => {
    const items = list.filter(x => x.cat === cat); if (!items.length) return;
    box.appendChild(el('div', { className: 'cat', text: SFX_CAT[cat] }));
    items.forEach(it => {
      const name = lang === 'zh' ? it.zh : it.en;
      const p = el('button', { type: 'button', className: 'btn', text: '试听' });
      const a = el('button', { type: 'button', className: 'btn primary', text: '加入配乐' });
      p.addEventListener('click', async () => {
        if (prev) { try { prev.stop(); } catch (e) {} prev = null; if (p.textContent === '停止') { p.textContent = '试听'; return; } }
        try {
          auCtx().resume(); p.textContent = '…';
          const buf = await loadSfx(it.id), n = auCtx().createBufferSource();
          n.buffer = buf; n.connect(auCtx().destination); n.start(); prev = n; p.textContent = '停止';
          n.onended = () => { p.textContent = '试听'; if (prev === n) prev = null; };
        } catch (e) { p.textContent = '试听'; info.textContent = '这个素材加载失败，请检查网络后再试。'; }
      });
      a.addEventListener('click', async () => {
        try {
          a.disabled = true; const buf = await loadSfx(it.id);
          Layers.push({ id: it.id, name, buf, at: 0, vol: 0.8 }); refreshLayers();
          info.textContent = '已加入：' + name + '。现在配乐里共有 ' + Layers.length + ' 个素材。';
        } catch (e) { info.textContent = '这个素材加载失败，请检查网络后再试。'; }
        a.disabled = false;
      });
      box.appendChild(el('div', { className: 'sfx' }, [
        el('div', { className: 'sfxn' }, [el('b', { text: name }), el('span', { text: it.dur + ' 秒 · ' + (it.lic === 'own' ? '本站合成' : it.lic === 'CC0' ? 'CC0' : '公有领域') })]),
        p, a]));
    });
  });
  box.appendChild(el('div', { className: 'cat', text: '已加入的素材 Layers' }));
  box.appendChild(layerList());
  box.appendChild(mixButtons(info));
  box.appendChild(el('p', { className: 'hint', text: '配乐的长度、起点、淡入淡出以及导出视频在「超事件」页签的「配乐」一栏。素材来自维基共享资源的公有领域 / CC0 录音，出处见 sfx/CREDITS.md。' }));
  return box;
}
function wavBlob(buf) {
  const ch = Math.min(2, buf.numberOfChannels), n = buf.length, sr = buf.sampleRate;
  const ab = new ArrayBuffer(44 + n * ch * 2), dv = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7FFF, true); o += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function auStop() {
  if (Au.node) { try { Au.node.stop(); } catch (e) {} Au.node = null; }
  if (Au.rec && Au.rec.state !== 'inactive') Au.rec.stop();
}
const fmtT = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
function buildAudioUI() {
  const box = el('div', { className: 'f' });
  const file = el('input', { type: 'file', id: 'au-file', accept: 'audio/*,video/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.mp4,.mkv,.webm,.mov' });
  const info = el('p', { className: 'hint', id: 'au-info', text: '上传音乐或视频（会自动取出其中的音轨）。默认截取 ' + SE_LEN + ' 秒——TNO 自带的 89 首超事件配乐长 10.7–72 秒，平均约 31 秒。' });
  const wave = el('canvas', { id: 'au-wave', width: 720, height: 90 });
  wave.style.cssText = 'width:100%;height:90px;background:#061011;border:1px solid var(--line);border-radius:3px;cursor:pointer;touch-action:none';
  const start = el('input', { type: 'range', id: 'au-start', min: 0, max: 0, step: 0.05 });
  const len = el('input', { type: 'range', id: 'au-len', min: 3, max: 120, step: 0.5 });
  const fin = el('input', { type: 'range', id: 'au-fin', min: 0, max: 5, step: 0.1 });
  const fout = el('input', { type: 'range', id: 'au-fout', min: 0, max: 8, step: 0.1 });
  const lStart = el('b'), lLen = el('b'), lFin = el('b'), lFout = el('b');
  const play = el('button', { type: 'button', className: 'btn primary', text: '试听 Play' });
  const stop = el('button', { type: 'button', className: 'btn', text: '停止 Stop' });
  const wav = el('button', { type: 'button', className: 'btn', text: '导出配乐 WAV' });
  const vid = el('button', { type: 'button', className: 'btn', text: '导出带配乐的视频' });
  const preset = el('div', { className: 'row' }, [10, 20, 30, 45, 60].map(v => { const b = el('button', { type: 'button', className: 'btn', text: v + ' 秒' + (v === SE_LEN ? '（标准）' : '') }); b.addEventListener('click', () => { Au.len = v; sync(); }); return b; }));
  const wc = wave.getContext('2d');
  function drawWave() {
    const W = wave.width, H = wave.height;
    wc.clearRect(0, 0, W, H);
    if (!Au.buf) { wc.fillStyle = '#7f9a96'; wc.font = '14px sans-serif'; wc.fillText('还没有上传音频 / No audio loaded', 14, H / 2 + 5); return; }
    const d = Au.buf.duration, x0 = Au.start / d * W, x1 = Math.min(W, (Au.start + Au.len) / d * W);
    wc.fillStyle = 'rgba(89,199,194,.22)'; wc.fillRect(x0, 0, Math.max(2, x1 - x0), H);
    for (let i = 0; i < W; i++) {
      const p = Au.peaks[Math.floor(i / W * Au.peaks.length)] || 0, h = Math.max(1, p * (H - 8));
      wc.fillStyle = (i >= x0 && i <= x1) ? '#8ff0e6' : '#2f5a5e';
      wc.fillRect(i, (H - h) / 2, 1, h);
    }
    wc.fillStyle = '#e08282'; wc.fillRect(x0, 0, 2, H); wc.fillRect(x1 - 2, 0, 2, H);
  }
  function sync() {
    const d = Au.buf ? Au.buf.duration : 0;
    Au.len = Math.max(1, d ? Math.min(Au.len, d) : Au.len);
    Au.start = Math.max(0, Math.min(Au.start, Math.max(0, d - Au.len)));
    start.max = Math.max(0, d - Au.len); start.value = Au.start;
    len.max = d ? Math.max(3, Math.min(180, Math.floor(d))) : 120; len.value = Au.len; fin.value = Au.fin; fout.value = Au.fout;
    lStart.textContent = '起点 Start：' + fmtT(Au.start) + ' → ' + fmtT(Au.start + Au.len);
    lLen.textContent = '长度 Length：' + Au.len.toFixed(1) + ' 秒';
    lFin.textContent = '淡入 Fade in：' + Au.fin.toFixed(1) + ' 秒'; lFout.textContent = '淡出 Fade out：' + Au.fout.toFixed(1) + ' 秒';
    drawWave(); refreshLayers();
  }
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    auStop();
    info.textContent = '正在读取并解码音轨… Decoding';
    try {
      const ab = await f.arrayBuffer();
      const buf = await new Promise((res, rej) => auCtx().decodeAudioData(ab, res, rej));
      Au.buf = buf; Au.name = f.name.replace(/\.[^.]+$/, '');
      const N = 1440, peaks = new Float32Array(N), c0 = buf.getChannelData(0), step = Math.max(1, Math.floor(c0.length / N));
      let mx = 0;
      for (let i = 0; i < N; i++) { let p = 0; const e = Math.min(c0.length, (i + 1) * step); for (let j = i * step; j < e; j += 16) { const v = Math.abs(c0[j]); if (v > p) p = v; } peaks[i] = p; if (p > mx) mx = p; }
      if (mx > 0) for (let i = 0; i < N; i++) peaks[i] /= mx;
      Au.peaks = peaks; Au.start = 0; Au.len = Math.min(SE_LEN, buf.duration);
      info.textContent = f.name + ' · 全长 ' + fmtT(buf.duration) + ' · ' + buf.sampleRate + ' Hz · ' + buf.numberOfChannels + ' 声道。在波形上点击或拖动来选起点。';
    } catch (e) {
      console.error(e);
      info.textContent = '这个文件的音轨浏览器解不出来（或文件里没有声音）。可以换成 MP3 / WAV / M4A / MP4 再试。';
    }
    sync();
  });
  const pick = ev => {
    if (!Au.buf) return;
    const r = wave.getBoundingClientRect(), t = (ev.clientX - r.left) / r.width * Au.buf.duration;
    Au.start = t - (ev.shiftKey ? Au.len : 0); sync();
  };
  let drag = false;
  wave.addEventListener('pointerdown', e => { drag = true; wave.setPointerCapture(e.pointerId); pick(e); });
  wave.addEventListener('pointermove', e => { if (drag) pick(e); });
  wave.addEventListener('pointerup', () => { drag = false; });
  start.addEventListener('input', () => { Au.start = +start.value; sync(); });
  len.addEventListener('input', () => { Au.len = +len.value; sync(); });
  fin.addEventListener('input', () => { Au.fin = +fin.value; sync(); });
  fout.addEventListener('input', () => { Au.fout = +fout.value; sync(); });
  const need = () => { if (!Au.buf && !Layers.length) { info.textContent = '请先上传一个音频或视频文件，或到「音效素材库」加入素材。'; return false; } return true; };
  play.addEventListener('click', () => {
    if (!need()) return;
    auStop(); auCtx().resume();
    const n = auCtx().createBufferSource(); n.buffer = auClip(); n.connect(auCtx().destination); n.start(); Au.node = n;
  });
  stop.addEventListener('click', auStop);
  wav.addEventListener('click', () => { if (need()) saveBlob(wavBlob(auClip()), 'tno_se_' + (Au.name || 'music') + '.wav'); });
  vid.addEventListener('click', () => {
    if (!need()) return;
    if (!window.MediaRecorder || !cv.captureStream) { info.textContent = '这个浏览器不支持录制视频，请用电脑版 Chrome / Edge。'; return; }
    auStop(); auCtx().resume();
    const rc = document.createElement('canvas'); rc.width = cv.width + (cv.width & 1); rc.height = cv.height + (cv.height & 1);
    const rx = rc.getContext('2d');
    const paint = () => { rx.fillStyle = '#000'; rx.fillRect(0, 0, rc.width, rc.height); rx.drawImage(cv, 0, 0); };
    paint();
    const dest = auCtx().createMediaStreamDestination(), n = auCtx().createBufferSource();
    n.buffer = auClip(); n.connect(dest); n.connect(auCtx().destination);
    const stream = new MediaStream([...rc.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined), chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    let timer = setInterval(paint, 33);
    rec.onstop = () => {
      clearInterval(timer); try { n.stop(); } catch (e) {}
      const ext = (rec.mimeType || mime).indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      saveBlob(new Blob(chunks, { type: rec.mimeType || mime }), 'tno_superevent_' + (Au.name || 'music') + '.' + ext);
      info.textContent = '视频已导出（' + ext.toUpperCase() + '）。'; vid.disabled = false;
    };
    Au.rec = rec; Au.node = n; vid.disabled = true;
    info.textContent = '正在录制 ' + Au.len.toFixed(1) + ' 秒，请保持这个页面在前台…';
    rec.start(); n.start();
    n.onended = () => setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 150);
  });
  [file, info, wave, el('label', { className: 'f' }, [el('span', {}, [lStart]), start]), el('label', { className: 'f' }, [el('span', {}, [lLen]), len]), preset,
    el('div', { className: 'row' }, [el('label', { className: 'f' }, [el('span', {}, [lFin]), fin]), el('label', { className: 'f' }, [el('span', {}, [lFout]), fout])]),
    el('div', { className: 'cat', text: '叠加的音效素材 Layers' }), layerList(),
    el('div', { className: 'row' }, [play, stop, wav, vid]),
    el('p', { className: 'hint', text: '导出的 WAV 可直接当超事件配乐用；放进 mod 的 music 文件夹前用任意工具转成 OGG 即可。视频会把当前超事件画面配上这段音乐录成一个文件。' })
  ].forEach(n => box.appendChild(n));
  sync();
  return box;
}

function buildTabs() {
  const nav = $('#tabs'); nav.textContent = '';
  ORDER.forEach(k => {
    const b = el('button', { type: 'button', role: 'tab' }, [document.createTextNode(T[k].name), el('span', { text: T[k].en })]);
    b.setAttribute('aria-selected', k === cur ? 'true' : 'false');
    b.addEventListener('click', () => { cur = k; save(); try { history.replaceState(null, '', '#' + k); } catch (e) {} buildTabs(); buildForm(); render(); });
    nav.appendChild(b);
  });
}
function setLang(l) {
  lang = l; save();
  $('#lang-zh').setAttribute('aria-pressed', l === 'zh'); $('#lang-en').setAttribute('aria-pressed', l === 'en');
  buildForm(); render();
}
$('#lang-zh').addEventListener('click', () => setLang('zh'));
$('#lang-en').addEventListener('click', () => setLang('en'));

function exportCanvas(scale) {
  if (scale === 1) return cv;
  const c = document.createElement('canvas'); c.width = Math.round(cv.width * scale); c.height = Math.round(cv.height * scale);
  const x = c.getContext('2d');
  if (scale < 1) { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; } else x.imageSmoothingEnabled = false;
  x.drawImage(cv, 0, 0, c.width, c.height);
  return c;
}
function download(scale) {
  exportCanvas(scale).toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'tno_' + cur + '_' + lang + (scale > 1 ? '@' + scale + 'x' : scale < 1 ? '@1x' : '') + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}
$('#dl').addEventListener('click', () => download(1));
$('#dl2').addEventListener('click', () => download(T[cur].scale === 2 ? 0.5 : 2));
/* phone save: a data: URL image often cannot be long-pressed/saved on phones (too big, or the in-app browser refuses it).
   Show a real blob: image at 1x, offer the system share sheet ("save image") where it exists, and an "open in new page" link. */
let outURL = null, outBlob = null;
function phoneCanvas() { return T[cur].scale === 2 ? exportCanvas(0.5) : cv; }
$('#show').addEventListener('click', () => {
  phoneCanvas().toBlob(b => {
    if (!b) return;
    if (outURL) URL.revokeObjectURL(outURL);
    outBlob = b; outURL = URL.createObjectURL(b);
    $('#outimg').src = outURL; $('#outopen').href = outURL;
    $('#outshare').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([b], 'x.png', { type: 'image/png' })] }));
    $('#out').hidden = false;
  }, 'image/png');
});
$('#outshare').addEventListener('click', async () => {
  if (!outBlob) return;
  try { await navigator.share({ files: [new File([outBlob], 'tno_' + cur + '_' + lang + '.png', { type: 'image/png' })] }); }
  catch (e) { if (e && e.name !== 'AbortError') $('#outhint').textContent = '这个浏览器不让分享图片，请长按图片或点「新页面打开」再保存。'; }
});
$('#outclose').addEventListener('click', () => { $('#out').hidden = true; });
$('#out').addEventListener('click', e => { if (e.target.id === 'out') $('#out').hidden = true; });
$('#zoom').addEventListener('click', () => { const on = $('#stage').classList.toggle('zoom1');
  if (on) { cv.style.maxWidth = 'none'; cv.style.maxHeight = 'none'; cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px'; } else render(); $('#zoom').textContent = on ? '适应宽度' : '原始像素 1:1'; });
$('#reset').addEventListener('click', () => {
  delete store[cur]; save();
  Object.keys(userImg).forEach(k => { if (k.startsWith(cur + '.')) userImg[k] = null; });
  buildForm(); render();
});

$('#lang-zh').setAttribute('aria-pressed', lang === 'zh'); $('#lang-en').setAttribute('aria-pressed', lang === 'en');
buildTabs(); buildForm(); render();
window.__tno = { T, render, userImg, getState: () => getState(cur, lang) };
})();
