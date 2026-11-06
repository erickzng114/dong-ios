"use strict";
/* موتور ربات دنگ — ترجمه مستقیم core.py / db.py / report.py / bot.py به جاوااسکریپت برای محیط تست وب */
var Dong = (function () {
  // ============================================================ core
  const FA = "۰۱۲۳۴۵۶۷۸۹", AR = "٠١٢٣٤٥٦٧٨٩";
  const UNIT = "unit", FIXED = "fixed", EXPENSE = "expense", INCOME = "income";
  const toEn = (s) => String(s).replace(/[۰-۹]/g, (c) => FA.indexOf(c)).replace(/[٠-٩]/g, (c) => AR.indexOf(c)).replace(/٫/g, ".");
  const faDigits = (s) => String(s).replace(/\d/g, (d) => FA[d]);
  const squash = (s) => String(s).split(/\s+/).filter(Boolean).join(" ");
  function fmt(n) {
    n = Math.trunc(n);
    const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
    return (n < 0 ? "−" : "") + faDigits(s);
  }
  const fmtSigned = (n) => (n > 0 ? "+" + fmt(n) : fmt(n));
  const fmtNum = (x) => faDigits(Number.isInteger(x) ? x : +(+x).toFixed(4));
  function pyRound(x) {
    const f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }
  function parseNumber(text) {
    const s = toEn(text).replace(/[\s,٬،٪%]/g, "");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    return parseFloat(s);
  }
  function parseAmount(text) {
    let s = toEn(text).toLowerCase();
    for (const w of ["تومان", "تومن", "toman"]) s = s.split(w).join("");
    s = s.replace(/[\s,٬،_‌]/g, "");
    let mult = 1;
    for (const [suf, m] of [["میلیون", 1e6], ["هزار", 1e3], ["m", 1e6], ["k", 1e3]]) {
      if (s.endsWith(suf)) { s = s.slice(0, -suf.length); mult = m; break; }
    }
    if (mult === 1 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const a = Math.round(parseFloat(s) * mult);
    return a > 0 ? a : null;
  }
  function normalizePhone(text) {
    const s = toEn(text).replace(/[\s\-()]/g, "");
    const m = /^(?:\+98|0098|98|0)?(9\d{9})$/.exec(s);
    return m ? "0" + m[1] : null;
  }
  function splitNamePhone(text) {
    const t = toEn(text).replace(/(\d)[\s\-](?=\d)/g, "$1");
    const m = /(?:\+98|0098|98|0)?9\d{9}/.exec(t);
    if (!m) return [squash(text), null];
    const name = squash((t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/-/g, " "));
    return [name, normalizePhone(m[0])];
  }
  function splitAmount(amount, weights) {               // weights: Map(id -> w)
    const ent = [...weights].filter(([, w]) => w > 0);
    const total = ent.reduce((a, [, w]) => a + w, 0);
    const out = new Map();
    if (total <= 0) return out;
    const raw = new Map();
    for (const [k, w] of ent) { raw.set(k, amount * w / total); out.set(k, Math.floor(amount * w / total)); }
    let rem = amount - [...out.values()].reduce((a, b) => a + b, 0);
    const order = ent.map(([k]) => k).sort((a, b) => (raw.get(b) - out.get(b)) - (raw.get(a) - out.get(a)));
    for (const k of order.slice(0, rem)) out.set(k, out.get(k) + 1);
    return out;
  }
  // قلم: {name, kind, price, alloc: [[personId, qty], ...]}
  const allocOf = (it) => it.alloc.filter(([, q]) => q > 0);
  function itemAmounts(it) {
    if (it.kind === UNIT) return new Map(allocOf(it).map(([p, q]) => [p, it.price * q]));
    return splitAmount(it.price, new Map(allocOf(it).map(([p]) => [p, 1])));
  }
  const itemQty = (it) => (it.kind === FIXED ? allocOf(it).length : allocOf(it).reduce((a, [, q]) => a + q, 0));
  const itemTotal = (it) => (it.kind === UNIT ? it.price * itemQty(it) : it.price);
  const itemLabel = (it) => (it.kind === UNIT ? `${it.name} (${fmt(itemQty(it))} × ${fmt(it.price)})` : `${it.name} (${fmt(it.price)} ÷ ${fmt(itemQty(it))})`);

  function breakdown(tx) {
    if (tx.kind === INCOME) return { itemAmounts: [], discBy: new Map(), vatBy: new Map(), diffBy: new Map(), shares: new Map(), subtotal: 0, discount: 0, vat: 0, invoice: 0, diff: 0 };
    const ia = tx.items.map(itemAmounts);
    const sub = new Map();
    for (const a of ia) for (const [p, v] of a) sub.set(p, (sub.get(p) || 0) + v);
    const subtotal = [...sub.values()].reduce((a, b) => a + b, 0);
    const discount = Math.min(tx.discount || 0, subtotal);
    const discBy = discount ? splitAmount(discount, new Map([...sub.keys()].map((p) => [p, 1]))) : new Map();
    const after = new Map([...sub].map(([p, v]) => [p, v - (discBy.get(p) || 0)]));   // پس از تخفیف
    const base = subtotal - discount;
    const vat = base > 0 ? pyRound(base * (tx.vat || 0) / 100) : 0;                     // مالیات روی مبلغ پس از تخفیف
    const vatBy = vat ? splitAmount(vat, after) : new Map();
    const before = new Map([...after].map(([p, v]) => [p, v + (vatBy.get(p) || 0)]));
    const invoice = base + vat, diff = tx.paid - invoice;
    const shares = diff === 0 ? new Map(before) : splitAmount(tx.paid, before);
    const diffBy = diff ? new Map([...before].map(([p, v]) => [p, (shares.get(p) || 0) - v])) : new Map();
    return { itemAmounts: ia, discBy, vatBy, diffBy, shares, subtotal, discount, vat, invoice, diff };
  }
  function breakdownRows(tx, bd) {
    const rows = tx.items.map((it, i) => [itemLabel(it), bd.itemAmounts[i]]);
    if (bd.discount) rows.push(["تخفیف", new Map([...bd.discBy].map(([p, v]) => [p, -v]))]);
    if (bd.vat) rows.push([`ارزش افزوده ${fmtNum(tx.vat)}٪`, bd.vatBy]);
    if (bd.diff) rows.push(["اختلاف با مبلغ پرداختی", bd.diffBy]);
    return rows;
  }
  const net = (b) => b.spent + b.deposited - b.received - b.share;
  function balances(txs, members) {
    const b = new Map(members.map((m) => [m, { spent: 0, deposited: 0, received: 0, share: 0 }]));
    const g = (m) => { if (!b.has(m)) b.set(m, { spent: 0, deposited: 0, received: 0, share: 0 }); return b.get(m); };
    for (const tx of txs) {
      if (tx.kind === INCOME) { g(tx.payer).deposited += tx.paid; g(tx.receiver).received += tx.paid; continue; }
      g(tx.payer).spent += tx.paid;
      for (const [p, v] of breakdown(tx).shares) g(p).share += v;
    }
    return b;
  }
  const nets = (txs, members) => new Map([...balances(txs, members)].map(([m, b]) => [m, net(b)]));
  function settle(n) {
    const cred = [...n].filter(([, v]) => v > 0).map(([m, v]) => [m, v]).sort((a, b) => b[1] - a[1]);
    const debt = [...n].filter(([, v]) => v < 0).map(([m, v]) => [m, -v]).sort((a, b) => b[1] - a[1]);
    const out = []; let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const amt = Math.min(debt[i][1], cred[j][1]);
      out.push([debt[i][0], cred[j][0], amt]);
      debt[i][1] -= amt; cred[j][1] -= amt;
      if (debt[i][1] === 0) i++;
      if (cred[j][1] === 0) j++;
    }
    return out;
  }
  function settleViaHub(n, hub) {
    const out = [];
    for (const [m, v] of n) { if (m === hub || v === 0) continue; out.push(v < 0 ? [m, hub, -v] : [hub, m, v]); }
    return out;
  }
  function netPairwise(debts) {
    const acc = new Map();
    for (const [a, b, x] of debts) {
      if (a === b || !x) continue;
      const [k, s] = a < b ? [a + "," + b, x] : [b + "," + a, -x];
      acc.set(k, (acc.get(k) || 0) + s);
    }
    const out = [];
    for (const [k, v] of acc) { const [a, b] = k.split(",").map(Number); if (v > 0) out.push([a, b, v]); else if (v < 0) out.push([b, a, -v]); }
    return out.sort((x, y) => y[2] - x[2]);
  }
  function g2j(gy, gm, gd) {
    const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const gy2 = gm > 2 ? gy + 1 : gy;
    let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
    let jy = -1595 + 33 * Math.floor(days / 12053); days %= 12053;
    jy += 4 * Math.floor(days / 1461); days %= 1461;
    if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    const jd = days < 186 ? 1 + (days % 31) : 1 + ((days - 186) % 30);
    return [jy, jm, jd];
  }
  const pad = (n) => String(n).padStart(2, "0");
  function jFromTs(ms) {
    const d = new Date(ms + 3.5 * 3600 * 1000);
    return g2j(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const todayJ = () => { const [y, m, d] = jFromTs(Date.now()); return `${y}/${pad(m)}/${pad(d)}`; };
  const jdate = (sec) => { const [y, m, d] = jFromTs(sec * 1000); return faDigits(`${y}/${pad(m)}/${pad(d)}`); };
  const showJ = (s) => (s ? faDigits(s) : "—");
  const JMONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
  function parseJdate(text) {
    const t = squash(toEn(text).replace(/ي/g, "ی"));
    const year = +todayJ().slice(0, 4);
    let y = null, m = null, d = null;
    for (let i = 0; i < 12; i++) {
      const mm = new RegExp(`^(\\d{1,2})\\s*${JMONTHS[i]}(?:\\s*(?:ماه)?\\s*(\\d{2,4}))?$`).exec(t);
      if (mm) { d = +mm[1]; m = i + 1; y = mm[2] ? +mm[2] : year; break; }
    }
    if (m === null) {
      const parts = t.split(/[\/\-.\s]+/).filter(Boolean);
      if (!parts.every((p) => /^\d+$/.test(p))) return null;
      if (parts.length === 3) [y, m, d] = parts.map(Number);
      else if (parts.length === 2) { y = year; [m, d] = parts.map(Number); }
      else return null;
    }
    if (y < 100) y += 1400;
    if (!(y >= 1300 && y <= 1500 && m >= 1 && m <= 12 && d >= 1 && d <= (m <= 6 ? 31 : 30))) return null;
    return `${y}/${pad(m)}/${pad(d)}`;
  }
  const now = () => Math.floor(Date.now() / 1000);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ============================================================ store (معادل db.py)
  const norm = (name) => squash(String(name).replace(/ي/g, "ی").replace(/ك/g, "ک"));
  class Store {
    constructor(state) { this.s = state || { seq: { person: 0, program: 0, tx: 0 }, users: {}, persons: [], programs: [], members: [], txs: [], userData: {} }; }
    touchUser(id, name) { const u = this.s.users[id] || { phone: null }; u.name = name; this.s.users[id] = u; }
    botUser(id) { return this.s.users[id] || null; }
    isBotUser(id) { return !!id && !!this.s.users[id]; }
    setUserPhone(id, phone) {
      if (this.s.users[id]) this.s.users[id].phone = phone;
      for (const p of this.s.persons) if (p.tg === id && !p.phone) p.phone = phone;
      let n = 0;
      for (const p of this.s.persons) if (p.phone === phone && !p.tg) { p.tg = id; n++; }
      return n;
    }
    person(id) { return this.s.persons.find((p) => p.id === id) || null; }
    persons(owner) { return this.s.persons.filter((p) => p.owner === owner); }
    selfPerson(owner, name) {
      let p = this.s.persons.find((x) => x.owner === owner && x.isSelf);
      if (p) return p;
      const u = this.botUser(owner);
      p = { id: ++this.s.seq.person, owner, name: norm(name), phone: u ? u.phone : null, tg: owner, isSelf: true };
      this.s.persons.push(p);
      return p;
    }
    addPerson(owner, name, phone = null, tg = null) {
      name = name ? norm(name) : phone || "";
      if (phone && !tg) { const id = Object.keys(this.s.users).find((k) => this.s.users[k].phone === phone); if (id) tg = +id; }
      const mine = this.persons(owner);
      let p = (tg && mine.find((x) => x.tg === tg)) || (phone && mine.find((x) => x.phone === phone)) || (name && mine.find((x) => x.name === name)) || null;
      if (p) {
        if (phone && !p.phone) p.phone = phone;
        if (tg && !p.tg) p.tg = tg;
        if (name && p.phone && p.name === p.phone && name !== p.phone) p.name = name;
        return p;
      }
      p = { id: ++this.s.seq.person, owner, name, phone, tg, isSelf: false };
      this.s.persons.push(p);
      return p;
    }
    renamePerson(id, name) { this.person(id).name = norm(name); }
    createProgram(owner, ownerName, title, date = null) {
      const me = this.selfPerson(owner, ownerName);
      const p = { id: ++this.s.seq.program, owner, title, date, treasurer: me.id, status: "open", settled: null, created: now() };
      this.s.programs.push(p);
      this.addMember(p.id, me.id);
      return p.id;
    }
    program(id) { return this.s.programs.find((p) => p.id === id) || null; }
    programs(owner) { return this.s.programs.filter((p) => p.owner === owner).sort((a, b) => b.id - a.id); }
    programsAsMember(tg, phone) {
      return this.s.programs.filter((pr) => pr.owner !== tg && this.members(pr.id).some((pe) => pe.tg === tg || (phone && pe.phone === phone))).sort((a, b) => b.id - a.id);
    }
    memberPerson(prog, tg, phone) { return this.members(prog).find((pe) => pe.tg === tg || (phone && pe.phone === phone)) || null; }
    updateProgram(id, fields) { Object.assign(this.program(id), fields); }
    members(prog) {
      return this.s.members.filter((m) => m.prog === prog).sort((a, b) => a.pos - b.pos).map((m) => this.person(m.person));
    }
    addMember(prog, person) {
      if (this.s.members.some((m) => m.prog === prog && m.person === person)) return false;
      const pos = Math.max(0, ...this.s.members.filter((m) => m.prog === prog).map((m) => m.pos)) + 1;
      this.s.members.push({ prog, person, pos });
      return true;
    }
    memberUsed(prog, person) {
      return this.s.txs.some((t) => t.prog === prog && (t.payer === person || t.receiver === person || t.items.some((i) => allocOf(i).some(([p]) => p === person))));
    }
    removeMember(prog, person) {
      if (this.memberUsed(prog, person)) return false;
      this.s.members = this.s.members.filter((m) => !(m.prog === prog && m.person === person));
      return true;
    }
    saveTx(prog, tx) {
      const no = Math.max(0, ...this.s.txs.filter((t) => t.prog === prog).map((t) => t.no)) + 1;
      this.s.txs.push(Object.assign(clone(tx), { id: ++this.s.seq.tx, prog, no, created: now() }));
      return no;
    }
    updateTx(prog, no, tx) {
      const t = this.s.txs.find((x) => x.prog === prog && x.no === no);
      if (!t) return false;
      const keep = { id: t.id, prog, no, created: t.created };
      Object.keys(t).forEach((k) => delete t[k]);
      Object.assign(t, clone(tx), keep, { updated: now() });
      return true;
    }
    txs(prog) {
      return clone(this.s.txs.filter((t) => t.prog === prog)).sort((a, b) => ((a.date || "") < (b.date || "") ? -1 : (a.date || "") > (b.date || "") ? 1 : a.no - b.no));
    }
    tx(prog, no) { return this.txs(prog).find((t) => t.no === no) || null; }
    deleteProgram(id) {
      const ids = new Set(this.s.txs.filter((t) => t.prog === id).map((t) => t.id));
      this.s.txs = this.s.txs.filter((t) => !ids.has(t.id));
      this.s.members = this.s.members.filter((m) => m.prog !== id);
      this.s.programs = this.s.programs.filter((p) => p.id !== id);
    }
    deleteTx(prog, no) { const n = this.s.txs.length; this.s.txs = this.s.txs.filter((t) => !(t.prog === prog && t.no === no)); return this.s.txs.length < n; }
  }

  // ============================================================ report
  const h = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const SEP = "━━━━━━━━━━━━";
  const nm = (names, id) => h(names.get(id) || "?");
  function statusLine(n) {
    if (n > 0) return `✅ طلبکار: <b>${fmt(n)}</b>`;
    if (n < 0) return `🔻 بدهکار: <b>${fmt(-n)}</b>`;
    return "⚪️ تسویه";
  }
  function txLine(t, names) {
    if (t.kind === INCOME) return `💵 <b>#${fmt(t.no)}</b> ${showJ(t.date)} — ${h(t.title)} — ${fmt(t.paid)}\n     ${nm(names, t.payer)} ← به → ${nm(names, t.receiver)}`;
    return `🧾 <b>#${fmt(t.no)}</b> ${showJ(t.date)} — ${h(t.title)} — ${fmt(t.paid)}${t.photos.length ? " 📷" : ""}\n     👤 ${nm(names, t.payer)}`;
  }
  const itemPeople = (it, names) => allocOf(it).map(([p, q]) => nm(names, p) + (it.kind === UNIT && q > 1 ? ` ×${fmt(q)}` : "")).join("، ");
  function txDetailText(tx, names) {
    if (tx.kind === INCOME) {
      return [`💵 <b>#${fmt(tx.no)} ${h(tx.title)}</b>`, `📅 ${showJ(tx.date)}`, `👤 از: ${nm(names, tx.payer)}  ←  به: ${nm(names, tx.receiver)}`,
        `💰 مبلغ: <b>${fmt(tx.paid)}</b> تومان`, tx.photos.length ? `📷 عکس رسید: ${fmt(tx.photos.length)}` : ""].join("\n").trim();
    }
    const bd = breakdown(tx);
    const lines = [`🧾 <b>#${fmt(tx.no)} ${h(tx.title)}</b>`, `📅 ${showJ(tx.date)} | 👤 پرداخت: ${nm(names, tx.payer)} | 💰 ${fmt(tx.paid)}`];
    const extras = [];
    if (tx.discount) extras.push(`🏷 تخفیف ${fmt(tx.discount)}`);
    if (tx.vat) extras.push(`💯 ارزش افزوده ${fmtNum(tx.vat)}٪`);
    if (tx.photos.length) extras.push(`📷 ${fmt(tx.photos.length)} عکس فاکتور`);
    if (extras.length) lines.push(extras.join(" | "));
    lines.push("");
    for (const it of tx.items) {
      const calc = it.kind === UNIT ? `فی ${fmt(it.price)} × ${fmt(itemQty(it))}` : `مبلغ کل ${fmt(it.price)} ÷ ${fmt(itemQty(it))} نفر`;
      lines.push(`• ${h(it.name)} — ${calc} = ${fmt(itemTotal(it))}`, `   ↳ ${itemPeople(it, names)}`);
    }
    lines.push("");
    if (tx.items.length > 1 || tx.vat || bd.diff || bd.discount) {
      lines.push(`جمع اقلام: ${fmt(bd.subtotal)}`);
      if (bd.discount) lines.push(`تخفیف: −${fmt(bd.discount)} (بین ${fmt(bd.discBy.size)} نفر مساوی)`);
      if (bd.vat) lines.push(`ارزش افزوده: ${fmt(bd.vat)}`);
      lines.push(`جمع فاکتور: ${fmt(bd.invoice)}`);
      if (bd.diff) lines.push(`⚠️ اختلاف با پرداختی: ${fmtSigned(bd.diff)} (به نسبت سهم‌ها پخش شد)`);
      lines.push("");
    }
    lines.push("<b>سهم هر نفر:</b>");
    for (const [p, v] of bd.shares) lines.push(`• ${nm(names, p)}: ${fmt(v)}`);
    return lines.join("\n");
  }
  function invoicePreviewText(tx, names) {
    const bd = breakdown(tx);
    const lines = [`🧾 <b>پیش‌نمایش «${h(tx.title)}»</b> — ${showJ(tx.date)}`, `جمع اقلام: ${fmt(bd.subtotal)}`];
    if (bd.discount) lines.push(`🏷 تخفیف: −${fmt(bd.discount)} (بین ${fmt(bd.discBy.size)} نفر مساوی)`, `پس از تخفیف: ${fmt(bd.subtotal - bd.discount)}`);
    if (bd.vat) lines.push(`ارزش افزوده ${fmtNum(tx.vat)}٪ (روی مبلغ پس از تخفیف): ${fmt(bd.vat)}`);
    lines.push(`جمع فاکتور: <b>${fmt(bd.invoice)}</b>`, `مبلغ پرداختی: <b>${fmt(tx.paid)}</b>`);
    if (bd.diff === 0) lines.push("✅ جمع فاکتور با مبلغ پرداختی یکی است.");
    else lines.push(`⚠️ پرداختی ${fmt(Math.abs(bd.diff))} تومان ${bd.diff < 0 ? "کمتر" : "بیشتر"} از جمع فاکتور است. اگر ثبت کنید، این اختلاف به نسبت سهم هر نفر پخش می‌شود. اگر اشتباه تایپی است، مبلغ یا اقلام را اصلاح کنید.`);
    lines.push("\n<b>سهم هر نفر:</b>");
    for (const [p, v] of bd.shares) lines.push(`• ${nm(names, p)}: ${fmt(v)}`);
    return lines.join("\n");
  }
  function programCalcText(p, mids, txs, names) {
    const bal = balances(txs, mids);
    const exp = txs.filter((t) => t.kind !== INCOME), dep = txs.filter((t) => t.kind === INCOME);
    const lines = [`🧮 <b>دنگ «${h(p.title)}»</b>${p.status !== "open" ? " 🔒" : ""}`, `👑 مادرخرج: ${nm(names, p.treasurer)}`,
      `جمع هزینه‌ها: <b>${fmt(exp.reduce((a, t) => a + t.paid, 0))}</b> تومان (${fmt(exp.length)} تراکنش)`];
    if (dep.length) lines.push(`💵 واریزی اعضا: ${fmt(dep.reduce((a, t) => a + t.paid, 0))} تومان (${fmt(dep.length)} مورد)`);
    lines.push("");
    for (const [m, b] of bal) {
      lines.push(`👤 <b>${nm(names, m)}</b>${m === p.treasurer ? " 👑" : ""}`);
      const parts = [`سهم: ${fmt(b.share)}`];
      if (b.spent) parts.push(`خرج کرده: ${fmt(b.spent)}`);
      if (b.deposited) parts.push(`واریز کرده: ${fmt(b.deposited)}`);
      if (b.received) parts.push(`دریافت کرده: ${fmt(b.received)}`);
      lines.push("   " + parts.join(" | "), "   " + statusLine(net(b)));
    }
    const tr = settleViaHub(new Map([...bal].map(([m, b]) => [m, net(b)])), p.treasurer);
    lines.push("", "💸 <b>تسویه با مادرخرج</b>");
    if (!tr.length) lines.push("همه تسویه‌اند 🎉");
    for (const [a, b, x] of tr) lines.push(`• ${nm(names, a)} به ${nm(names, b)}: <b>${fmt(x)}</b>`);
    return lines.join("\n");
  }
  function personInvoiceText(pid, p, txs, names) {
    const lines = [`🧾 <b>صورت‌حساب ${nm(names, pid)}</b>`, `📌 برنامه: ${h(p.title)}`, SEP];
    const b = balances(txs, [pid]).get(pid);
    for (const tx of txs) {
      if (tx.kind === INCOME) continue;
      const bd = breakdown(tx), s = bd.shares.get(pid) || 0;
      if (!s) continue;
      lines.push(`<b>${h(tx.title)}</b> (${showJ(tx.date)}): ${fmt(s)}`);
      tx.items.forEach((it, i) => {
        const v = bd.itemAmounts[i].get(pid);
        if (!v) return;
        const q = (it.alloc.find(([x]) => x === pid) || [0, 0])[1];
        lines.push(it.kind === UNIT ? `   • ${h(it.name)} ${fmt(q)} × ${fmt(it.price)} = ${fmt(v)}` : `   • ${h(it.name)} (سهم از ${fmt(it.price)}): ${fmt(v)}`);
      });
      if (bd.discBy.get(pid)) lines.push(`   • سهم تخفیف: −${fmt(bd.discBy.get(pid))}`);
      if (bd.vatBy.get(pid)) lines.push(`   • ارزش افزوده ${fmtNum(tx.vat)}٪: ${fmt(bd.vatBy.get(pid))}`);
      if (bd.diffBy.get(pid)) lines.push(`   • تعدیل با مبلغ پرداختی: ${fmtSigned(bd.diffBy.get(pid))}`);
    }
    if (!(b.share || b.spent || b.deposited || b.received)) return null;
    lines.push(SEP, `جمع سهم شما: <b>${fmt(b.share)}</b>`);
    if (b.spent) lines.push(`خرج‌هایی که شما پرداخت کردید: ${fmt(b.spent)}`);
    for (const tx of txs) {
      if (tx.kind === INCOME && tx.payer === pid) lines.push(`💵 واریزی شما به ${nm(names, tx.receiver)} (${showJ(tx.date)}): ${fmt(tx.paid)}`);
      if (tx.kind === INCOME && tx.receiver === pid) lines.push(`💵 دریافتی شما از ${nm(names, tx.payer)} (${showJ(tx.date)}): ${fmt(tx.paid)}`);
    }
    const tn = nm(names, p.treasurer), n = net(b);
    if (pid === p.treasurer) lines.push(`👑 شما مادرخرج هستید. ${statusLine(n)}`);
    else if (n < 0) lines.push(`➡️ مبلغ قابل پرداخت به ${tn} (مادرخرج): <b>${fmt(-n)}</b> تومان`);
    else if (n > 0) lines.push(`⬅️ ${tn} (مادرخرج) به شما می‌پردازد: <b>${fmt(n)}</b> تومان`);
    else lines.push("⚪️ حساب شما تسویه است.");
    return lines.join("\n");
  }
  function globalText(progs, names, mode) {
    const per = new Map(), total = new Map(); let debts = [];
    for (const [p, mids, txs] of progs) {
      const n = nets(txs, mids);
      for (const [m, v] of n) { if (!per.has(m)) per.set(m, new Map()); per.get(m).set(p.id, v); total.set(m, (total.get(m) || 0) + v); }
      debts = debts.concat(settleViaHub(n, p.treasurer));
    }
    const tr = mode === "pair" ? netPairwise(debts) : settle(total);
    const titles = new Map(progs.map(([p]) => [p.id, p.title]));
    const lines = [`⚖️ <b>تسویه حساب کلی — ${fmt(progs.length)} برنامه</b>`];
    for (const [p, , txs] of progs) lines.push(`• ${h(p.title)} (👑 ${nm(names, p.treasurer)}) — ${fmt(txs.filter((t) => t.kind !== INCOME).reduce((a, t) => a + t.paid, 0))}`);
    lines.push("", "<b>مانده هر نفر:</b>");
    for (const [m, by] of per) {
      const parts = [...by].filter(([, v]) => v).map(([pid, v]) => `${h(titles.get(pid))} ${fmtSigned(v)}`).join(" | ");
      if (!parts && total.get(m) === 0) continue;
      lines.push(`👤 <b>${nm(names, m)}</b>: ${statusLine(total.get(m))}`);
      if (parts && by.size > 1) lines.push("   " + parts);
    }
    lines.push("", mode === "pair" ? "💸 <b>پرداخت‌ها</b> (طبق مادرخرج هر برنامه، دوبه‌دو خالص‌شده):" : "💸 <b>پرداخت‌ها</b> (کمترین تعداد انتقال):");
    if (!tr.length) lines.push("همه تسویه‌اند 🎉");
    for (const [a, b, x] of tr) lines.push(`• ${nm(names, a)} به ${nm(names, b)}: <b>${fmt(x)}</b>`);
    return lines.join("\n");
  }
  // جدول اکسل (در محیط تست به‌صورت جدول نمایش داده می‌شود)
  // داده جدول: اعضا در ستون‌ها، مخارج در سطرها (برای نمایش، عکس و CSV)
  function tableData(p, mids, txs, names, summary = true, heading = null) {
    const head = ["شرح", ...mids.map((m) => (names.get(m) || "?") + (m === p.treasurer ? " 👑" : "")), "جمع"];
    const rows = [];
    const row = (label, vals, cls = "", total = null) =>
      rows.push({ cls, cells: [label, ...mids.map((m) => vals.get(m) || 0), total ?? mids.reduce((a, m) => a + (vals.get(m) || 0), 0)] });
    for (const tx of txs) {
      if (tx.kind === INCOME) continue;
      const bd = breakdown(tx);
      rows.push({ cls: "t", title: `#${faDigits(tx.no)} ${tx.title} — ${showJ(tx.date)} — پرداخت: ${names.get(tx.payer) || "?"}` });
      for (const [label, vals] of breakdownRows(tx, bd)) row(label, vals);
      row(`جمع «${tx.title}»`, bd.shares, "s");
    }
    const dep = txs.filter((t) => t.kind === INCOME);
    if (summary && dep.length) {
      rows.push({ cls: "i", title: "💵 واریزی‌ها (+ واریزکننده / − گیرنده)" });
      for (const t of dep) row(`#${faDigits(t.no)} ${showJ(t.date)} ${names.get(t.payer)} ← به ${names.get(t.receiver)}`, new Map([[t.payer, t.paid], [t.receiver, -t.paid]]), "", t.paid);
    }
    if (summary) {
      const bal = balances(txs, mids);
      const pick = (f) => new Map([...bal].map(([m, b]) => [m, f(b)]));
      row("سهم کل", pick((b) => b.share), "g");
      row("خرج پرداخت‌کرده", pick((b) => b.spent), "g");
      if (dep.length) row("واریز − دریافت", pick((b) => b.deposited - b.received), "g");
      row("مانده (+ طلبکار / − بدهکار)", pick(net), "g");
    }
    return { title: heading || `جدول دنگ «${p.title}»`, head, rows };
  }
  function programTable(p, mids, txs, names, summary = true, heading = null) {
    const { title, head, rows } = tableData(p, mids, txs, names, summary, heading);
    const cell = (v) => (typeof v === "number" ? `<td class="n${v < 0 ? " neg" : ""}">${v ? fmt(v) : "—"}</td>` : `<td>${h(v)}</td>`);
    let html = `<div class="sheet-title">📊 ${h(title)}</div><div class="sheet"><table><thead><tr>${head.map((x) => `<th>${h(x)}</th>`).join("")}</tr></thead><tbody>`;
    for (const r of rows) html += r.title ? `<tr class="${r.cls}"><td colspan="${head.length}">${h(r.title)}</td></tr>` : `<tr class="${r.cls}">${r.cells.map(cell).join("")}</tr>`;
    return html + "</tbody></table></div>";
  }

  // ============================================================ bot (معادل bot.py)
  const MAX_QTY = 5;
  const SELF_WORDS = new Set(["خودم", "من", "مادرخرج", "خود"]);
  const LOCK_MSG = "🔒 این برنامه پایان یافته و ویرایش آن قفل است. برای تغییر، اول برنامه را بازگشایی کنید.";
  const kb = (...rows) => rows.filter((r) => r && r.length);
  const pairs = (b, n = 2) => { const o = []; for (let i = 0; i < b.length; i += n) o.push(b.slice(i, i + n)); return o; };
  const namesOf = (rows) => new Map(rows.map((r) => [r.id, r.name]));
  const isOpen = (p) => p.status === "open";
  const progDate = (p) => (p.date ? showJ(p.date) : jdate(p.created));

  class Bot {
    constructor(store, emit) { this.db = store; this.emit = emit; }
    ud(uid) { return (this.db.s.userData[uid] = this.db.s.userData[uid] || {}); }
    // ---- ابزار خروجی
    say(c, text, markup = null, edit = false) {
      if (edit && c.msgId) this.emit({ type: "edit", to: c.uid, id: c.msgId, html: text, kb: markup });
      else this.emit({ type: "send", to: c.uid, html: text, kb: markup });
    }
    alert(c, text) { c.answered = true; this.emit({ type: "alert", to: c.uid, text }); }
    dropReplyKb(c) { if (c.ud.rk) { delete c.ud.rk; this.emit({ type: "send", to: c.uid, html: "✔️", reply: null }); } }
    owned(c, pid) { const p = this.db.program(pid); return p && p.owner === c.uid ? p : null; }
    data(pid) { const ms = this.db.members(pid); return [ms, ms.map((m) => m.id), this.db.txs(pid), namesOf(ms)]; }
    myPhone(uid) { const u = this.db.botUser(uid); return u ? u.phone : null; }
    sendPhotos(c, tx) { for (const [fid] of tx.photos) this.emit({ type: "photo", to: c.uid, fid }); }

    // ---- ورودی‌ها
    ctx(user, msgId) { return { uid: user.id, user, msgId, ud: this.ud(user.id) }; }
    start(user) { const c = this.ctx(user); this.db.touchUser(user.id, user.first_name); this.db.selfPerson(user.id, user.first_name); this.mainMenu(c); }
    cancel(user) { this.mainMenu(this.ctx(user)); }

    mainMenu(c, edit = false) {
      delete c.ud.flow; this.dropReplyKb(c);
      const mine = this.db.programsAsMember(c.uid, this.myPhone(c.uid));
      const rows = [[["➕ ثبت برنامه جدید", "m:new"]], [["📂 مرور برنامه‌ها", "m:progs"]], [["⚖️ تسویه حساب کلی", "m:global"]]];
      if (mine.length && !this.offline) rows.push([[`👤 برنامه‌هایی که عضوشان هستم (${faDigits(mine.length)})`, "m:mine"]]);
      if (!this.myPhone(c.uid) && !this.offline) rows.push([["📱 اتصال شماره موبایل من", "m:phone"]]);
      this.say(c, "🧮 <b>ربات دنگ</b>\nحساب‌وکتاب خرج‌های سفر و ماموریت با مادرخرج.\nچه کاری انجام بدهیم؟", kb(...rows), edit);
    }
    askPhone(c) {
      c.ud.await_phone = true; c.ud.rk = true;
      this.emit({ type: "send", to: c.uid, html: "📱 اگر کسی شما را با شماره موبایل در برنامه‌اش ثبت کرده باشد، با ارسال شماره‌تان آن برنامه‌ها را می‌بینید.\nدکمه پایین صفحه را بزنید:", reply: [{ text: "📱 ارسال شماره من", kind: "contact" }] });
    }
    newProgram(c) { c.ud.flow = { kind: "newprog", step: "title" }; this.say(c, "📝 <b>ثبت برنامه جدید</b>\nنام برنامه را بنویسید.\nمثال: <code>برنامه شما تابستان ۱۴۰۵</code>", kb([["❌ انصراف", "m:main"]]), true); }
    askProgDate(c, edit = false) {
      this.say(c, "📅 <b>تاریخ برنامه؟</b>\nدکمه امروز را بزنید یا تاریخ شروع را بنویسید: <code>۱۴۰۵/۰۵/۱۰</code> یا <code>۱۰ مرداد</code>",
        kb([[`📅 امروز ${showJ(todayJ())}`, "m:pdt"]], [["❌ انصراف", "m:main"]]), edit);
    }
    programsList(c) {
      delete c.ud.flow;
      const progs = this.db.programs(c.uid);
      if (!progs.length) return this.say(c, "هنوز برنامه‌ای ثبت نکرده‌اید.", kb([["➕ ثبت برنامه جدید", "m:new"]], [["🔙 منوی اصلی", "m:main"]]), true);
      const rows = progs.slice(0, 40).map((p) => [[`${p.settled ? "✔️" : isOpen(p) ? "🟢" : "🔒"} ${p.title} · ${progDate(p)}`, `p:${p.id}`]]);
      rows.push([["🔙 منوی اصلی", "m:main"]]);
      this.say(c, "📂 <b>برنامه‌های شما</b>\n🟢 باز  🔒 پایان‌یافته (قفل)  ✔️ تسویه‌شده", kb(...rows), true);
    }
    programMenu(c, pid, edit = true, note = "") {
      delete c.ud.flow; this.dropReplyKb(c);
      const p = this.owned(c, pid);
      if (!p) return this.mainMenu(c, edit);
      const [ms, , txs, names] = this.data(pid);
      const exp = txs.filter((t) => t.kind !== INCOME), inc = txs.filter((t) => t.kind === INCOME);
      let status = isOpen(p) ? "🟢 باز" : "🔒 پایان‌یافته (قفل)";
      if (p.settled) status += " | ✔️ تسویه‌شده";
      const text = (note ? note + "\n\n" : "") + `📌 <b>${h(p.title)}</b>\n📅 ${progDate(p)} | ${status}\n👑 مادرخرج: ${nm(names, p.treasurer)}\n` +
        `👥 اعضا: ${faDigits(ms.length)} نفر | 🧾 هزینه: ${faDigits(exp.length)} | 💰 جمع: ${fmt(exp.reduce((a, t) => a + t.paid, 0))}` +
        (inc.length ? `\n💵 دریافتی از اعضا: ${fmt(inc.reduce((a, t) => a + t.paid, 0))}` : "");
      const rows = isOpen(p)
        ? [[["👥 اعضا", `pm:${pid}`], ["👑 تغییر مادرخرج", `pk:${pid}`]], [["🧾 ثبت هزینه", `pte:${pid}`], ["💵 ثبت دریافتی از عضو", `pti:${pid}`]],
          [["📋 مرور و ویرایش تراکنش‌ها", `pl:${pid}`]], [["🧮 محاسبه دنگ‌ها", `pc:${pid}`], ["📤 ارسال صورت‌حساب", `ps:${pid}`]], [["📝 نام و تاریخ برنامه", `pnd:${pid}`], ["🏁 پایان برنامه (قفل)", `pst:${pid}`]]]
        : [[["👥 اعضا", `pm:${pid}`], ["📋 مرور تراکنش‌ها", `pl:${pid}`]], [["🧮 محاسبه دنگ‌ها", `pc:${pid}`], ["📤 ارسال صورت‌حساب", `ps:${pid}`]], [["🔓 بازگشایی برنامه", `pst:${pid}`]]];
      rows.push([["🔙 برنامه‌ها", "m:progs"], ["🏠 منوی اصلی", "m:main"]]);
      this.say(c, text, kb(...rows), edit);
    }
    finishNewProgram(c, date) {
      const f = c.ud.flow;
      this.db.touchUser(c.uid, c.user.first_name);
      const pid = this.db.createProgram(c.uid, c.user.first_name, f.title, date);
      return this.membersScreen(c, pid, false, `✅ برنامه «${h(f.title)}» (${showJ(date)}) ساخته شد و شما مادرخرج آن هستید.\nحالا اعضا را ثبت کنید.`);
    }
    // ---- اعضا
    membersLines(p, ms) {
      return ms.map((m, i) => {
        const tags = [];
        if (m.id === p.treasurer) tags.push("👑");
        if (m.isSelf) tags.push("(شما)");
        if (m.phone && m.phone !== m.name) tags.push("📱" + faDigits(m.phone));
        if (m.tg && !m.isSelf) tags.push("✈️");
        return `${faDigits(i + 1)}. ${h(m.name)} ${tags.join(" ")}`;
      });
    }
    membersScreen(c, pid, edit = false, note = "") {
      const p = this.owned(c, pid);
      if (!p) return;
      const ms = this.db.members(pid);
      if (!isOpen(p)) return this.say(c, `👥 <b>اعضای «${h(p.title)}»</b> 🔒\n` + this.membersLines(p, ms).join("\n"), kb([["🔙 برگشت", `p:${pid}`]]), edit);
      c.ud.flow = { kind: "members", pid };
      if (!c.ud.rk) {
        this.emit({ type: "send", to: c.uid, html: "👇 برای انتخاب همسفرها از مخاطبین، دکمه پایین صفحه را بزنید.", reply: [{ text: "📇 انتخاب از مخاطبین", kind: "users" }] });
        c.ud.rk = true; edit = false;
      }
      const lines = note ? [note, ""] : [];
      lines.push(`👥 <b>اعضای «${h(p.title)}»</b>`, ...this.membersLines(p, ms), "", "<b>افزودن عضو:</b>",
        "• نام‌ها را بنویسید (با «،» یا خط جدید جدا کنید)", "  مثال: <code>علی، محمد، عارف، بهروز ۰۹۱۲۳۴۵۶۷۸۹</code>",
        "• یا دکمه «📇 انتخاب از مخاطبین» پایین صفحه (جستجو و انتخاب چندتایی)",
        "اعضا لازم نیست ربات را داشته باشند. اگر داشته باشند، برنامه و صورت‌حسابشان را در ربات می‌بینند.");
      this.say(c, lines.join("\n"), kb([["✏️ تغییر نام", `pmr:${pid}`], ["➖ حذف عضو", `pmd:${pid}`]], [["✅ پایان ثبت اعضا", `p:${pid}`]]), edit);
    }
    addNote(added, existed) {
      const parts = [];
      if (added.length) parts.push("➕ اضافه شد: " + added.map(h).join("، "));
      if (existed.length) parts.push("ℹ️ از قبل عضو بود: " + existed.map(h).join("، "));
      return parts.join("\n");
    }
    membersAddText(c, pid, text) {
      const added = [], existed = [];
      for (let chunk of text.split(/[،,\n؛;]+/)) {
        chunk = chunk.trim();
        if (!chunk) continue;
        const [name, phone] = splitNamePhone(chunk);
        let person;
        if (SELF_WORDS.has(name) && !phone) person = this.db.selfPerson(c.uid, c.user.first_name);
        else if (!name && !phone) continue;
        else person = this.db.addPerson(c.uid, name || phone, phone);
        (this.db.addMember(pid, person.id) ? added : existed).push(person.name);
      }
      this.membersScreen(c, pid, false, this.addNote(added, existed) || "چیزی اضافه نشد.");
    }
    contact(user, ct) {
      const c = this.ctx(user);
      const phone = normalizePhone(ct.phone || "") || ct.phone || null;
      if (ct.user_id === c.uid) {
        this.db.touchUser(c.uid, user.first_name);
        this.db.setUserPhone(c.uid, phone);
        delete c.ud.await_phone; delete c.ud.rk;
        const n = this.db.programsAsMember(c.uid, phone).length;
        this.emit({ type: "send", to: c.uid, html: `✅ شماره شما ثبت شد. ${faDigits(n)} برنامه که در آن عضو هستید پیدا شد.`, reply: null });
        return this.mainMenu(c);
      }
      const flow = c.ud.flow || {};
      if (flow.kind !== "members") return this.say(c, "برای افزودن مخاطب، اول از منوی برنامه «👥 اعضا» را باز کنید.");
      const person = this.db.addPerson(c.uid, ct.name, phone, ct.user_id || null);
      const isNew = this.db.addMember(flow.pid, person.id);
      this.membersScreen(c, flow.pid, false, this.addNote(isNew ? [person.name] : [], isNew ? [] : [person.name]));
    }
    contactsBulk(user, list) {                         // چند مخاطب از دفترچه تلفن گوشی
      const c = this.ctx(user);
      const flow = c.ud.flow || {};
      if (flow.kind !== "members") return this.say(c, "برای افزودن مخاطب، اول از منوی برنامه «👥 اعضا» را باز کنید.");
      const added = [], existed = [];
      for (const ct of list) {
        const phone = normalizePhone(ct.phone || "") || (ct.phone || null);
        const person = this.db.addPerson(c.uid, ct.name || phone, phone, null);
        (this.db.addMember(flow.pid, person.id) ? added : existed).push(person.name);
      }
      this.membersScreen(c, flow.pid, false, this.addNote(added, existed) || "چیزی اضافه نشد.");
    }
    usersShared(user, users) {
      const c = this.ctx(user);
      const flow = c.ud.flow || {};
      if (flow.kind !== "members") return this.say(c, "برای افزودن عضو، اول از منوی برنامه «👥 اعضا» را باز کنید.");
      const added = [], existed = [];
      for (const u of users) {
        const person = this.db.addPerson(c.uid, u.name, null, u.user_id);
        (this.db.addMember(flow.pid, person.id) ? added : existed).push(person.name);
      }
      this.membersScreen(c, flow.pid, false, this.addNote(added, existed));
    }
    membersPick(c, pid, action) {
      const p = this.owned(c, pid), ms = this.db.members(pid);
      const [cands, title, prefix] = action === "pmd"
        ? [ms.filter((m) => m.id !== p.treasurer), "➖ کدام عضو حذف شود؟ (مادرخرج و اعضایی که در تراکنشی هستند حذف نمی‌شوند)", "pmx"]
        : [ms, "✏️ نام کدام عضو را تغییر می‌دهید؟", "pmn"];
      const rows = pairs(cands.map((m) => [m.name, `${prefix}:${pid}:${m.id}`]));
      rows.push([["🔙 برگشت", `pm:${pid}`]]);
      this.say(c, title, kb(...rows), true);
    }
    treasurerPick(c, pid) {
      const p = this.owned(c, pid);
      const rows = pairs(this.db.members(pid).map((m) => [(m.id === p.treasurer ? "👑 " : "") + m.name, `pkk:${pid}:${m.id}`]));
      rows.push([["🔙 برگشت", `p:${pid}`]]);
      this.say(c, "👑 مادرخرج این برنامه کیست؟", kb(...rows), true);
    }
    // ---- مرور
    txList(c, pid, memberView = false) {
      const [, , txs, names] = this.data(pid);
      const back = memberView ? `v:${pid}` : `p:${pid}`;
      if (!txs.length) return this.say(c, "هنوز تراکنشی ثبت نشده.", kb([["🔙 برگشت", back]]), true);
      const lines = ["📋 <b>تراکنش‌ها</b>", ...txs.map((t) => txLine(t, names)), `\n<b>جمع هزینه‌ها: ${fmt(txs.filter((t) => t.kind !== INCOME).reduce((a, t) => a + t.paid, 0))} تومان</b>`];
      const pre = memberView ? "vt" : "pv";
      const rows = pairs(txs.map((t) => [`${t.kind === INCOME ? "💵" : "🔍"} #${faDigits(t.no)} ${t.title}`, `${pre}:${pid}:${t.no}`])).slice(0, 40);
      rows.push([["🔙 برگشت", back]]);
      this.say(c, lines.join("\n"), kb(...rows), true);
    }
    txView(c, pid, no) {
      const p = this.owned(c, pid), tx = this.db.tx(pid, no);
      if (!tx) return this.txList(c, pid);
      let text = txDetailText(tx, namesOf(this.db.members(pid)));
      const rows = [];
      if (isOpen(p)) rows.push([["✏️ ویرایش", `pe:${pid}:${no}`], ["🗑 حذف", `pdel:${pid}:${no}`]]);
      else text += "\n\n🔒 برنامه پایان یافته؛ ویرایش قفل است.";
      const extra = [];
      if (tx.kind !== INCOME) extra.push(["📊 جدول این تراکنش", `ptb:${pid}:${no}`]);
      if (tx.photos.length) extra.push([`📷 عکس‌ها (${faDigits(tx.photos.length)})`, `pph:${pid}:${no}`]);
      if (extra.length) rows.push(extra);
      rows.push([["🔙 فهرست تراکنش‌ها", `pl:${pid}`]]);
      this.say(c, text, kb(...rows), true);
    }
    // ---- محاسبه و صورت‌حساب
    calcScreen(c, pid) {
      const p = this.owned(c, pid), [, mids, txs, names] = this.data(pid);
      if (!txs.length) return this.alert(c, "هنوز تراکنشی ثبت نشده.");
      this.say(c, programCalcText(p, mids, txs, names), kb([["📊 جدول اکسل (اعضا در ستون، مخارج در سطر)", `pxl:${pid}`]], [["📤 ارسال صورت‌حساب", `ps:${pid}`]], [["🔙 منوی برنامه", `p:${pid}`]]), true);
    }
    sendTable(c, pid) {
      const p = this.db.program(pid), [, mids, txs, names] = this.data(pid);
      if (!txs.length) return this.alert(c, "هنوز تراکنشی ثبت نشده.");
      this.emit({ type: "table", to: c.uid, html: programTable(p, mids, txs, names) });
    }
    sendTxTable(c, pid, no) {
      const p = this.db.program(pid), tx = this.db.tx(pid, no);
      if (!tx || tx.kind === INCOME) return this.alert(c, "برای این تراکنش جدولی وجود ندارد.");
      const names = namesOf(this.db.members(pid));
      this.emit({ type: "table", to: c.uid, html: programTable(p, [...breakdown(tx).shares.keys()], [tx], names, false, `تراکنش #${faDigits(tx.no)} «${tx.title}» — ${showJ(tx.date)}`) });
    }
    invoiceTargets(pid) {
      const p = this.db.program(pid), [ms, , txs, names] = this.data(pid);
      const direct = [], forward = [];
      for (const m of ms) {
        if (m.isSelf) continue;
        const text = personInvoiceText(m.id, p, txs, names);
        if (!text) continue;
        (this.db.isBotUser(m.tg) ? direct : forward).push([m, text]);
      }
      return [p, direct, forward];
    }
    sendInvoicesScreen(c, pid) {
      const [p, direct, forward] = this.invoiceTargets(pid);
      if (!direct.length && !forward.length) return this.alert(c, "هنوز صورت‌حسابی برای ارسال نیست.");
      const lines = [`📤 <b>ارسال صورت‌حساب «${h(p.title)}»</b>`, ""];
      if (forward.length) lines.push(`✉️ متن صورت‌حساب برای شما فرستاده می‌شود تا فوروارد کنید (${faDigits(forward.length)} نفر): ` + forward.map(([m]) => h(m.name)).join("، "));
      if (direct.length) lines.push(`🤖 این افراد ربات را دارند و مستقیم هم دریافت می‌کنند (${faDigits(direct.length)} نفر): ` + direct.map(([m]) => h(m.name)).join("، "));
      this.say(c, lines.join("\n"), kb([["✅ ارسال", `psy:${pid}`]], [["🔙 برگشت", `p:${pid}`]]), true);
    }
    sendInvoices(c, pid) {
      const [, direct, forward] = this.invoiceTargets(pid);
      for (const [m, text] of direct) this.emit({ type: "send", to: m.tg, html: text });
      if (forward.length) {
        this.emit({ type: "send", to: c.uid, html: "👇 صورت‌حساب‌های زیر را برای هر نفر فوروارد کنید:" });
        for (const [, text] of forward) this.emit({ type: "send", to: c.uid, html: text });
      }
      const parts = [];
      if (direct.length) parts.push(`${faDigits(direct.length)} صورت‌حساب مستقیم ارسال شد`);
      if (forward.length) parts.push(`${faDigits(forward.length)} صورت‌حساب برای فوروارد آمد`);
      this.programMenu(c, pid, false, "✅ " + parts.join(" و ") + ".");
    }
    // ---- تراکنش
    flowTx(c) { const f = c.ud.flow; return f && f.kind === "tx" ? f : null; }
    flowToTx(f) {
      if (f.type === "income") {
        const names = namesOf(this.db.members(f.pid));
        return { title: `واریز ${names.get(f.payer) || ""}`, payer: f.payer, paid: f.paid, vat: 0, items: [], kind: INCOME, receiver: f.receiver, date: f.date, photos: clone(f.photos) };
      }
      return { title: f.title, payer: f.payer, paid: f.paid || 0, vat: f.vat || 0, discount: f.discount || 0, items: clone(f.items), kind: EXPENSE, receiver: null, date: f.date, photos: clone(f.photos) };
    }
    flowInvoice(f) { const tx = this.flowToTx(f); tx.paid = 0; return breakdown(tx); }
    txToFlow(pid, tx) {
      return { kind: "tx", pid, type: tx.kind === INCOME ? "income" : "expense", edit_no: tx.no, title: tx.title, date: tx.date || null, paid: tx.paid,
        payer: tx.payer, receiver: tx.receiver, vat: tx.vat, discount: tx.discount || 0, photos: clone(tx.photos), items: clone(tx.items) };
    }
    txStart(c, pid, kind) {
      const p = this.owned(c, pid);
      if (!isOpen(p)) return this.alert(c, LOCK_MSG);
      if (this.db.members(pid).length < 2) return this.alert(c, "اول اعضای برنامه را ثبت کنید.");
      c.ud.flow = { kind: "tx", pid, type: kind, edit_no: null, items: [], photos: [], vat: 0 };
      if (kind === "income") c.ud.flow.receiver = p.treasurer;
      this.advance(c, c.ud.flow, true);
    }
    advance(c, f, edit = false) {
      // هزینه: اول مشخصات و اقلام؛ مبلغ پرداختی در پایان پرسیده و با جمع فاکتور مقایسه می‌شود
      const order = f.type === "expense" ? ["title", "date", "payer"] : ["payer", "paid", "receiver", "date"];
      for (const field of order) if (f[field] === undefined || f[field] === null || f[field] === "") return this.ask(field, c, f, edit);
      return f.type === "expense" ? this.showHub(c, f, edit) : this.showIncome(c, f, edit);
    }
    ask(field, c, f, edit) {
      const cancel = [["❌ انصراف", "f:cancel"]];
      f.step = field;
      if (field === "title") return this.say(c, "🧾 <b>عنوان هزینه؟</b>\nمثال: <code>شام شب اول</code>", kb(cancel), edit);
      if (field === "date") return this.say(c, "📅 <b>تاریخ؟</b>\nدکمه امروز را بزنید یا تاریخ را بنویسید: <code>۱۴۰۵/۰۴/۱۰</code> یا <code>۱۰ تیر</code>", kb([[`📅 امروز ${showJ(todayJ())}`, "f:dt"]], cancel), edit);
      if (field === "paid") return this.say(c, (f.type === "expense" ? "💰 <b>مبلغ کل پرداختی؟</b>" : "💰 <b>مبلغ واریزی؟</b>") + "\nمثال: <code>۴۸۵۰۵۰۰</code> یا <code>۶۰۰ هزار</code>", kb(cancel), edit);
      const p = this.db.program(f.pid);
      let ms = this.db.members(f.pid).sort((a, b) => (a.id !== p.treasurer) - (b.id !== p.treasurer));
      let q;
      if (f.type === "income" && field === "payer") { const x = ms.filter((m) => m.id !== f.receiver); if (x.length) ms = x; q = "👤 <b>چه کسی پول داد؟</b>"; }
      else if (field === "receiver") q = "👤 <b>پول به چه کسی داده شد؟</b>";
      else q = "👤 <b>چه کسی پرداخت کرد؟</b>";
      const rows = pairs(ms.map((m) => [(m.id === p.treasurer ? "👑 " : "") + m.name, `f:${field.slice(0, 3)}:${m.id}`]));
      rows.push(cancel);
      this.say(c, q, kb(...rows), edit);
    }
    takeAmount(c, f, text, field, then) {
      const a = parseAmount(text);
      if (!a) return this.say(c, "عدد را متوجه نشدم. فقط مبلغ را بفرستید، مثلاً <code>۴۸۵۰۵۰۰</code> یا <code>۲۰۰ هزار</code>");
      if (a < 10000) { f.pending = [field, a, then]; return this.say(c, "منظورتان کدام است؟", kb([[`${fmt(a * 1000)} تومان`, "f:k:1"], [`${fmt(a)} تومان`, "f:k:0"]])); }
      f[field] = a;
      this.afterAmount(then, c, f);
    }
    afterAmount(then, c, f) {
      if (then === "paid") return f.type === "expense" ? this.showPreview(c, f, false) : this.advance(c, f);
      if (then === "discount") return this.showHub(c, f, false);
      const price = f.iprice; delete f.iprice;
      if (f.step === "iprice_e" && f.cur !== undefined && f.cur !== null) f.items[f.cur].price = price;
      else {
        const ni = f.newitem; delete f.newitem;
        f.items.push({ name: ni.name, kind: ni.kind, price, alloc: this.defaultAlloc(f, ni.kind) });
        f.cur = f.items.length - 1;
      }
      this.showEditor(c, f, false);
    }
    txHead(f, names) {
      const title = f.edit_no ? "✏️ ویرایش هزینه" : "🧾 هزینه جدید";
      let s = `${title}\n<b>${h(f.title)}</b>\n📅 ${showJ(f.date)} | 👤 ${nm(names, f.payer)}` + (f.paid ? ` | 💰 پرداختی: ${fmt(f.paid)}` : "");
      const ex = [];
      if (f.vat) ex.push(`💯 ارزش افزوده ${fmtNum(f.vat)}٪`);
      if (f.photos.length) ex.push(`📷 ${faDigits(f.photos.length)} عکس`);
      return s + (ex.length ? "\n" + ex.join(" | ") : "");
    }
    showHub(c, f, edit = true) {
      f.step = "hub"; delete f.cur;
      const names = namesOf(this.db.members(f.pid));
      const lines = [this.txHead(f, names), ""];
      if (!f.items.length) lines.push("هنوز قلمی ثبت نشده. اقلام را اضافه کنید، یا اگر فاکتور ریز ندارد کل مبلغ را بین افراد تقسیم کنید.");
      f.items.forEach((it, i) => {
        const calc = it.kind === UNIT ? `فی ${fmt(it.price)} × ${fmt(itemQty(it))}` : `کل ${fmt(it.price)} ÷ ${fmt(itemQty(it))} نفر`;
        lines.push(`${faDigits(i + 1)}. ${h(it.name)} — ${calc} = ${fmt(itemTotal(it))}`, `    ↳ ${itemPeople(it, names) || "⚠️ کسی انتخاب نشده"}`);
      });
      if (f.items.length) {
        const bd = this.flowInvoice(f);
        lines.push("", `جمع اقلام: ${fmt(bd.subtotal)}`);
        if (bd.discount) lines.push(`🏷 تخفیف: −${fmt(bd.discount)}`);
        if (bd.vat) lines.push(`💯 ارزش افزوده ${fmtNum(f.vat)}٪: ${fmt(bd.vat)}`);
        lines.push(`<b>جمع فاکتور: ${fmt(bd.invoice)}</b>`);
        if (f.paid) { const rest = f.paid - bd.invoice; lines.push(rest ? `مبلغ پرداختی ${fmt(Math.abs(rest))} ${rest > 0 ? "بیشتر" : "کمتر"} از جمع فاکتور است.` : "✅ با مبلغ پرداختی برابر است."); }
      }
      const rows = [[["➕ افزودن قلم", "f:ia"]]];
      if (!f.items.length) rows.push([["➗ کل مبلغ بین افراد مساوی", "f:split"]]);
      rows.push(...pairs(f.items.map((it, i) => [`✏️ ${faDigits(i + 1)}. ${it.name}`, `f:ie:${i}`])));
      rows.push([[f.discount ? `🏷 تخفیف: ${fmt(f.discount)}` : "🏷 تخفیف: ندارد", "f:dc"], [f.vat ? `💯 ارزش افزوده: ${fmtNum(f.vat)}٪` : "💯 ارزش افزوده: ندارد", "f:vat"]]);
      rows.push([[`📷 عکس فاکتور (${faDigits(f.photos.length)})`, "f:ph"], ["📝 عنوان، تاریخ، پرداخت‌کننده", "f:hd"]]);
      rows.push([["✅ پایان و ثبت", "f:fin"], ["❌ انصراف", "f:cancel"]]);
      this.say(c, lines.join("\n"), kb(...rows), edit);
    }
    showEditor(c, f, edit = true) {
      if (f.cur === undefined || f.cur === null || f.cur >= f.items.length) return this.showHub(c, f, edit);
      f.step = "editor";
      const it = f.items[f.cur], al = new Map(it.alloc);
      const btns = this.db.members(f.pid).map((m) => {
        const q = al.get(m.id) || 0;
        return [(q ? "✅ " : "⬜ ") + m.name + (it.kind === UNIT && q > 1 ? ` ×${faDigits(q)}` : ""), `f:t:${m.id}`];
      });
      let head, sw;
      if (it.kind === UNIT) {
        head = `🍽 <b>${h(it.name)}</b> — <b>فی</b>: هر نفر ${fmt(it.price)}\nبه حساب چه کسانی زده شود؟ (اگر کسی دو عدد گرفته، دوبار لمس کنید)\nتعداد: ${fmt(itemQty(it))} | جمع: ${fmt(itemTotal(it))}`;
        sw = "🔁 تبدیل به مبلغ کل";
      } else {
        const q = itemQty(it);
        head = `🧾 <b>${h(it.name)}</b> — <b>مبلغ کل</b>: ${fmt(it.price)}\nبین چه کسانی مساوی تقسیم شود؟\n${fmt(q)} نفر | سهم هر نفر ≈ ${q ? fmt(Math.floor(it.price / q)) : "—"}`;
        sw = "🔁 تبدیل به فی";
      }
      const rows = pairs(btns);
      rows.push([["همه", "f:all"], ["هیچ‌کس", "f:none"]], [["✏️ عنوان", "f:in"], ["💰 مبلغ", "f:ip"], [sw, "f:ik2"]], [["🗑 حذف قلم", "f:idel"], ["✅ تایید قلم", "f:iok"]]);
      this.say(c, head, kb(...rows), edit);
    }
    defaultAlloc(f, kind) {
      if (kind === UNIT) return [];
      const seen = [];
      for (const it of f.items) for (const [p, q] of it.alloc) if (q && !seen.includes(p)) seen.push(p);
      return (seen.length ? seen : this.db.members(f.pid).map((m) => m.id)).map((p) => [p, 1]);
    }
    askFinalPaid(c, f, edit = true) {
      f.step = "paid";
      const bd = this.flowInvoice(f);
      const rows = [[[`✅ همان جمع فاکتور: ${fmt(bd.invoice)}`, "f:pf"]]];
      if (f.paid && f.paid !== bd.invoice) rows.push([[`💰 مبلغ ثبت‌شده قبلی: ${fmt(f.paid)}`, "f:pk"]]);
      rows.push([["↩️ برگشت به فاکتور", "f:hub"]]);
      this.say(c, `💰 <b>چه مبلغی واقعاً پرداخت شد؟</b>\nجمع فاکتور: <b>${fmt(bd.invoice)}</b> تومان\nاگر همین مبلغ پرداخت شده دکمه را بزنید؛ وگرنه مبلغ پرداختی را بنویسید.`, kb(...rows), edit);
    }
    showPreview(c, f, edit = true) {
      f.step = "preview";
      this.say(c, invoicePreviewText(this.flowToTx(f), namesOf(this.db.members(f.pid))),
        kb([["💾 ثبت نهایی", "f:ok"]], [["✏️ اصلاح مبلغ پرداختی", "f:fin"], ["↩️ برگشت به فاکتور", "f:hub"]], [["❌ انصراف", "f:cancel"]]), edit);
    }
    showIncome(c, f, edit = true) {
      f.step = "income";
      const names = namesOf(this.db.members(f.pid));
      const title = f.edit_no ? "✏️ ویرایش دریافتی" : "💵 <b>ثبت دریافتی از عضو</b>";
      this.say(c, `${title}\n👤 از: <b>${nm(names, f.payer)}</b>  ←  به: <b>${nm(names, f.receiver)}</b>\n💰 مبلغ: <b>${fmt(f.paid)}</b> تومان\n📅 ${showJ(f.date)} | 📷 عکس رسید: ${faDigits(f.photos.length)}\n\nاین مبلغ از بدهی واریزکننده کم می‌شود.`,
        kb([["💾 ثبت", "f:save"]], [["📷 عکس رسید", "f:ph"], ["📝 ویرایش موارد", "f:hd"]], [["❌ انصراف", "f:cancel"]]), edit);
    }
    saveFlow(c, f) {
      const pid = f.pid, p = this.owned(c, pid);
      if (!p || !isOpen(p)) return this.alert(c, LOCK_MSG);
      const tx = this.flowToTx(f);
      let no, verb;
      if (f.edit_no) { this.db.updateTx(pid, f.edit_no, tx); no = f.edit_no; verb = "ویرایش شد"; }
      else { no = this.db.saveTx(pid, tx); verb = "ثبت شد"; }
      delete c.ud.flow;
      this.say(c, `✅ <b>${verb}</b>\n\n` + txDetailText(this.db.tx(pid, no), namesOf(this.db.members(pid))),
        kb([["🧾 هزینه بعدی", `pte:${pid}`], ["💵 دریافتی", `pti:${pid}`]], [["🧮 محاسبه دنگ‌ها", `pc:${pid}`], ["🔙 منوی برنامه", `p:${pid}`]]), true);
    }
    flowCallback(c, parts) {
      const f = this.flowTx(c);
      if (!f) return this.alert(c, "این منو منقضی شده. از منوی برنامه دوباره شروع کنید.");
      const act = parts[1], arg = parts[2], pid = f.pid;
      const mids = new Set(this.db.members(pid).map((m) => m.id));
      const hasCur = f.cur !== undefined && f.cur !== null;
      if (act === "cancel") return this.programMenu(c, pid, true, "❌ انصراف داده شد؛ چیزی ذخیره نشد.");
      if (act === "back") return this.advance(c, f, true);
      if (act === "k" && f.pending) { const [field, a, then] = f.pending; delete f.pending; f[field] = arg === "1" ? a * 1000 : a; return this.afterAmount(then, c, f); }
      if (act === "dt") { f.date = todayJ(); return this.advance(c, f, true); }
      if ((act === "pay" || act === "rec") && arg && mids.has(+arg)) {
        f[act === "pay" ? "payer" : "receiver"] = +arg;
        if (f.type === "income" && f.payer === f.receiver) delete f[act === "rec" ? "payer" : "receiver"];
        return this.advance(c, f, true);
      }
      if (act === "hd") {
        const rows = f.type === "expense"
          ? [[["📝 عنوان", "f:e:title"], ["📅 تاریخ", "f:e:date"]], [["👤 پرداخت‌کننده", "f:e:payer"]]]
          : [[["👤 واریزکننده", "f:e:payer"], ["👤 گیرنده", "f:e:receiver"]], [["💰 مبلغ", "f:e:paid"], ["📅 تاریخ", "f:e:date"]]];
        rows.push([["🔙 برگشت", "f:back"]]);
        return this.say(c, "کدام مورد را تغییر می‌دهید؟", kb(...rows), true);
      }
      if (act === "e" && ["title", "date", "paid", "payer", "receiver"].includes(arg)) { delete f[arg]; return this.advance(c, f, true); }
      if (act === "ph") {
        f.step = "photo";
        const rows = [[["📷 دوربین", "x:cam"], ["🖼 گالری", "x:gal"]]];
        if (f.photos.length) rows.push([["🗑 حذف عکس‌ها", "f:phx"]]);
        rows.push([["🔙 برگشت", "f:back"]]);
        return this.say(c, `📷 از فاکتور یا رسید عکس بگیرید، یا از گالری انتخاب کنید (چند عکس هم می‌شود).\nعکس‌های فعلی: ${faDigits(f.photos.length)}`, kb(...rows), true);
      }
      if (act === "phx") { f.photos = []; return this.advance(c, f, true); }
      if (act === "save") { if (f.type === "expense") return this.alert(c, "از «✅ پایان و ثبت» استفاده کنید."); return this.saveFlow(c, f); }
      if (f.type !== "expense") return this.alert(c, "این دکمه دیگر فعال نیست.");
      if (act === "ia") { f.newitem = {}; f.step = "iname"; return this.say(c, "➕ <b>عنوان قلم؟</b>\nمثال: <code>چلو جوجه</code>، <code>نوشابه</code>، <code>سرویس</code>، <code>کرایه</code>", kb([["🔙 برگشت", "f:hub"]]), true); }
      if (act === "ik" && f.newitem && f.newitem.name) {
        f.newitem.kind = arg === "u" ? UNIT : FIXED; f.step = "iprice";
        return this.say(c, arg === "u" ? "💰 <b>فی</b> (مبلغی که برای هر نفر حساب می‌شود)؟" : "💰 <b>مبلغ کل</b> (بین افراد مساوی تقسیم می‌شود)؟", kb([["🔙 برگشت", "f:hub"]]), true);
      }
      if (act === "split") {
        if (f.items.length) return this.showHub(c, f);
        f.newitem = { name: f.title, kind: FIXED }; f.step = "iprice";
        return this.say(c, "💰 <b>مبلغ کل فاکتور</b> (بین افراد انتخابی مساوی تقسیم می‌شود)؟", kb([["🔙 برگشت", "f:hub"]]), true);
      }
      if (act === "ie" && arg !== undefined && +arg < f.items.length) { f.cur = +arg; return this.showEditor(c, f); }
      if (["t", "all", "none"].includes(act) && hasCur) {
        const it = f.items[f.cur];
        if (act === "t" && mids.has(+arg)) {
          const m = +arg, al = new Map(it.alloc);
          let q = al.get(m) || 0;
          q = it.kind === UNIT ? (q + 1) % (MAX_QTY + 1) : q ? 0 : 1;
          if (q) al.set(m, q); else al.delete(m);
          it.alloc = [...al];
        } else if (act === "all") it.alloc = [...mids].map((m) => [m, 1]);
        else if (act === "none") it.alloc = [];
        return this.showEditor(c, f);
      }
      if (act === "in" && hasCur) { f.step = "iname_e"; return this.say(c, "عنوان جدید قلم؟", null, true); }
      if (act === "ip" && hasCur) { f.step = "iprice_e"; return this.say(c, f.items[f.cur].kind === UNIT ? "فی جدید (برای هر نفر)؟" : "مبلغ کل جدید؟", null, true); }
      if (act === "ik2" && hasCur) {
        const it = f.items[f.cur];
        it.kind = it.kind === UNIT ? FIXED : UNIT;
        if (it.kind === FIXED) it.alloc = it.alloc.map(([p]) => [p, 1]);
        return this.showEditor(c, f);
      }
      if (act === "idel" && hasCur) { f.items.splice(f.cur, 1); return this.showHub(c, f); }
      if (act === "iok" && hasCur) { if (!allocOf(f.items[f.cur]).length) return this.alert(c, "حداقل یک نفر را انتخاب کنید (یا قلم را حذف کنید)."); return this.showHub(c, f); }
      if (act === "hub") { delete f.newitem; return this.showHub(c, f); }
      if (act === "vat") return this.say(c, "💯 ارزش افزوده دارد؟ (روی کل فاکتور حساب می‌شود)", kb([["ندارد", "f:vs:0"], ["۹٪", "f:vs:9"], ["۱۰٪", "f:vs:10"]], [["درصد دیگر", "f:vs:x"], ["🔙 برگشت", "f:hub"]]), true);
      if (act === "vs") { if (arg === "x") { f.step = "vat"; return this.say(c, "درصد ارزش افزوده را بنویسید (مثلاً ۹):", null, true); } f.vat = +arg; return this.showHub(c, f); }
      if (act === "dc") {
        f.step = "discount";
        const rows = f.discount ? [[["🗑 بدون تخفیف", "f:dc0"]]] : [];
        rows.push([["🔙 برگشت", "f:hub"]]);
        return this.say(c, "🏷 <b>مبلغ تخفیف کل فاکتور؟</b>\nاز جمع اقلام کم می‌شود و بین افراد همین فاکتور مساوی تقسیم می‌شود. ارزش افزوده روی مبلغ پس از تخفیف حساب می‌شود.", kb(...rows), true);
      }
      if (act === "dc0") { f.discount = 0; return this.showHub(c, f); }
      if (act === "fin") {
        if (!f.items.length) return this.alert(c, "هنوز قلمی ثبت نشده. «➕ افزودن قلم» یا «➗ کل مبلغ بین افراد مساوی» را بزنید.");
        if (f.items.some((i) => !allocOf(i).length)) return this.alert(c, "برای بعضی اقلام کسی انتخاب نشده.");
        if (this.flowInvoice(f).discount < (f.discount || 0)) return this.alert(c, "تخفیف از جمع اقلام بیشتر است؛ آن را اصلاح کنید.");
        return this.askFinalPaid(c, f);
      }
      if (act === "pf") { f.paid = this.flowInvoice(f).invoice; return this.showPreview(c, f); }
      if (act === "pk" && f.paid) return this.showPreview(c, f);
      if (act === "ok") return f.paid ? this.saveFlow(c, f) : this.askFinalPaid(c, f);
      this.alert(c, "این دکمه دیگر فعال نیست.");
    }
    flowText(c, f, text) {
      const s = f.step;
      if (s === "title") { f.title = text.slice(0, 120); return this.advance(c, f); }
      if (s === "date") {
        const d = parseJdate(text);
        if (!d) return this.say(c, "تاریخ را متوجه نشدم. مثل <code>۱۴۰۵/۰۴/۱۰</code> یا <code>۱۰ تیر</code> بنویسید.", kb([[`📅 امروز ${showJ(todayJ())}`, "f:dt"]]));
        f.date = d; return this.advance(c, f);
      }
      if (s === "paid") return this.takeAmount(c, f, text, "paid", "paid");
      if (s === "discount") return this.takeAmount(c, f, text, "discount", "discount");
      if (s === "iname") {
        f.newitem = { name: text.slice(0, 80) };
        return this.say(c, `«${h(text.slice(0, 80))}» از چه نوعی است؟`, kb([["🍽 فی — برای هر نفر همین مبلغ", "f:ik:u"]], [["🧾 مبلغ کل — تقسیم مساوی بین افراد", "f:ik:f"]], [["🔙 برگشت", "f:hub"]]));
      }
      if (s === "iprice" || s === "iprice_e") return this.takeAmount(c, f, text, "iprice", "iprice");
      if (s === "iname_e" && f.cur !== undefined && f.cur !== null) { f.items[f.cur].name = text.slice(0, 80); return this.showEditor(c, f, false); }
      if (s === "vat") {
        const v = parseNumber(text);
        if (v === null || v < 0 || v > 100) return this.say(c, "یک عدد بین ۰ تا ۱۰۰ بفرستید.");
        f.vat = v; return this.showHub(c, f, false);
      }
      if (s === "photo") return this.say(c, "لطفاً عکس بفرستید، یا «🔙 برگشت» را بزنید.");
      this.say(c, "از دکمه‌های پیام قبلی استفاده کنید، یا /cancel برای انصراف.");
    }
    photo(user, fid) {
      const c = this.ctx(user), f = this.flowTx(c);
      if (!f) return this.say(c, "برای ثبت عکس فاکتور، هزینه را ثبت کنید یا از «📋 مرور و ویرایش تراکنش‌ها» آن را ویرایش کنید.");
      f.photos.push([fid, "photo"]);
      this.say(c, `📷 عکس اضافه شد (${faDigits(f.photos.length)}). عکس دیگری بگیرید یا برگردید.`, kb([["📷 عکس دیگر", "x:cam"], ["🖼 گالری", "x:gal"]], [["✅ برگشت به فاکتور", "f:back"]]));
    }
    // ---- تسویه کلی
    globalSelect(c, edit = true) {
      const progs = this.db.programs(c.uid);
      if (!progs.length) return this.say(c, "هنوز برنامه‌ای ثبت نکرده‌اید.", kb([["🔙 منوی اصلی", "m:main"]]), edit);
      let f = c.ud.flow;
      if (!f || f.kind !== "global") f = c.ud.flow = { kind: "global", sel: progs.filter((p) => !p.settled).map((p) => p.id), mode: "pair" };
      const rows = progs.slice(0, 40).map((p) => [[`${f.sel.includes(p.id) ? "✅" : "⬜"} ${p.title}${p.settled ? " (تسویه‌شده)" : ""}`, `g:t:${p.id}`]]);
      rows.push([["⚖️ محاسبه تسویه", "g:calc"]], [["🔙 منوی اصلی", "m:main"]]);
      this.say(c, "⚖️ <b>تسویه حساب کلی</b>\nبرنامه‌هایی را که می‌خواهید با هم تسویه شوند انتخاب کنید.\n(هر برنامه می‌تواند مادرخرج خودش را داشته باشد)", kb(...rows), edit);
    }
    globalCalc(c, edit = true) {
      const f = c.ud.flow;
      if (!f || f.kind !== "global") return this.globalSelect(c, edit);
      if (!f.sel.length) return this.alert(c, "حداقل یک برنامه انتخاب کنید.");
      const progs = f.sel.map((pid) => this.owned(c, pid)).filter(Boolean).map((p) => [p, this.db.members(p.id).map((m) => m.id), this.db.txs(p.id)]);
      const pair = f.mode === "pair";
      this.say(c, globalText(progs, namesOf(this.db.persons(c.uid)), f.mode), kb([[pair ? "⚡ کمترین تعداد انتقال" : "🔁 به تفکیک مادرخرج هر برنامه", "g:mode"]],
        [["✔️ ثبت این برنامه‌ها به‌عنوان تسویه‌شده", "g:done"]], [["🔙 انتخاب برنامه‌ها", "g:sel"], ["🏠 منوی اصلی", "m:main"]]), edit);
    }
    globalCallback(c, parts) {
      const act = parts[1];
      let f = c.ud.flow;
      if (f && f.kind !== "global") f = null;
      if (act === "t" && f) { const pid = +parts[2]; f.sel = f.sel.includes(pid) ? f.sel.filter((x) => x !== pid) : f.sel.concat(pid); return this.globalSelect(c); }
      if (act === "calc") return this.globalCalc(c);
      if (act === "mode" && f) { f.mode = f.mode === "pair" ? "min" : "pair"; return this.globalCalc(c); }
      if (act === "done" && f) return this.say(c, `${faDigits(f.sel.length)} برنامه به‌عنوان تسویه‌شده علامت بخورد؟ (این برنامه‌ها قفل هم می‌شوند)`, kb([["✅ بله، تسویه شد", "g:dy"], ["🔙 برگشت", "g:calc"]]), true);
      if (act === "dy" && f) {
        for (const pid of f.sel) if (this.owned(c, pid)) this.db.updateProgram(pid, { settled: now(), status: "closed" });
        delete c.ud.flow;
        this.say(c, "✔️ برنامه‌ها تسویه‌شده ثبت شدند.", null, true);
        return this.mainMenu(c);
      }
      this.globalSelect(c);
    }
    // ---- نمای عضو
    memberPrograms(c) {
      const progs = this.db.programsAsMember(c.uid, this.myPhone(c.uid));
      if (!progs.length) return this.say(c, "در برنامه‌ای عضو نیستید.", kb([["🔙 منوی اصلی", "m:main"]]), true);
      const rows = progs.slice(0, 40).map((p) => [[`${isOpen(p) ? "🟢" : "🔒"} ${p.title} · ${progDate(p)}`, `v:${p.id}`]]);
      rows.push([["🔙 منوی اصلی", "m:main"]]);
      this.say(c, "👤 <b>برنامه‌هایی که عضوشان هستم</b>", kb(...rows), true);
    }
    memberCallback(c, head, pid, extra) {
      const p = this.db.program(pid), me = p ? this.db.memberPerson(pid, c.uid, this.myPhone(c.uid)) : null;
      if (!me) return this.alert(c, "به این برنامه دسترسی ندارید.");
      const [, mids, txs, names] = this.data(pid);
      if (head === "v") return this.say(c, txs.length ? programCalcText(p, mids, txs, names) : `📌 <b>${h(p.title)}</b>\nهنوز تراکنشی ثبت نشده.`,
        kb([["🧾 صورت‌حساب من", `vi:${pid}`], ["📋 تراکنش‌ها", `vl:${pid}`]], [["📊 فایل اکسل", `vx:${pid}`]], [["🔙 برنامه‌های من", "m:mine"]]), true);
      if (head === "vi") return this.say(c, personInvoiceText(me.id, p, txs, names) || "در این برنامه سهمی ندارید.", kb([["🔙 برگشت", `v:${pid}`]]), true);
      if (head === "vl") return this.txList(c, pid, true);
      if (head === "vx") return this.sendTable(c, pid);
      const tx = this.db.tx(pid, extra);
      if (head === "vt") {
        if (!tx) return this.txList(c, pid, true);
        const row = tx.kind !== INCOME ? [["📊 جدول این تراکنش", `vtb:${pid}:${extra}`]] : [];
        if (tx.photos.length) row.push([`📷 عکس‌ها (${faDigits(tx.photos.length)})`, `vph:${pid}:${extra}`]);
        const rows = row.length ? [row] : [];
        rows.push([["🔙 تراکنش‌ها", `vl:${pid}`]]);
        return this.say(c, txDetailText(tx, names), kb(...rows), true);
      }
      if (head === "vph" && tx) this.sendPhotos(c, tx);
      if (head === "vtb") this.sendTxTable(c, pid, extra);
    }
    // ---- مسیریاب‌ها
    callback(user, data, msgId) {
      const c = this.ctx(user, msgId);
      const parts = data.split(":"), head = parts[0];
      if (data === "m:pdt") {                               // تاریخ برنامه جدید = امروز
        const f = c.ud.flow;
        if (f && f.kind === "newprog" && f.title) return this.finishNewProgram(c, todayJ());
        return this.alert(c, "این منو منقضی شده.");
      }
      if (head === "m") {
        const t = parts[1];
        if (t !== "main") { this.dropReplyKb(c); delete c.ud.flow; }
        if (t === "main") this.mainMenu(c, true);
        else if (t === "new") this.newProgram(c);
        else if (t === "progs") this.programsList(c);
        else if (t === "global") this.globalSelect(c);
        else if (t === "mine") this.memberPrograms(c);
        else if (t === "phone") this.askPhone(c);
        return;
      }
      if (head === "f") return this.flowCallback(c, parts);
      if (head === "g") return this.globalCallback(c, parts);
      if (["v", "vi", "vl", "vt", "vph", "vx", "vtb"].includes(head)) return this.memberCallback(c, head, +parts[1], parts[2] !== undefined ? +parts[2] : null);
      const pid = +parts[1], p = this.owned(c, pid);
      if (!p) return this.alert(c, "برنامه پیدا نشد.");
      const extra = parts[2] !== undefined ? +parts[2] : null;
      if (["pmd", "pmr", "pmx", "pmn", "pte", "pti", "pe", "pdel", "pdy", "pk", "pkk", "pnd", "pn", "pdd"].includes(head) && !isOpen(p)) return this.alert(c, LOCK_MSG);
      switch (head) {
        case "p": return this.programMenu(c, pid);
        case "pnd": return this.say(c, `📌 ${h(p.title)}\n📅 ${progDate(p)}\nکدام را تغییر می‌دهید؟`, kb([["📝 نام برنامه", `pn:${pid}`], ["📅 تاریخ برنامه", `pdd:${pid}`]], [["🔙 برگشت", `p:${pid}`]]), true);
        case "pn": c.ud.flow = { kind: "progedit", pid, field: "title" }; return this.say(c, "نام جدید برنامه را بنویسید:", kb([["🔙 برگشت", `p:${pid}`]]), true);
        case "pdd": c.ud.flow = { kind: "progedit", pid, field: "date" }; return this.say(c, "تاریخ برنامه را بنویسید: <code>۱۴۰۵/۰۵/۱۰</code> یا <code>۱۰ مرداد</code>", kb([["🔙 برگشت", `p:${pid}`]]), true);
        case "pm": return this.membersScreen(c, pid, true);
        case "pmd": case "pmr": return this.membersPick(c, pid, head);
        case "pmx": return this.db.removeMember(pid, extra) ? this.membersScreen(c, pid, true, "➖ عضو حذف شد.") : this.alert(c, "این عضو در تراکنش‌ها حضور دارد؛ اول آن تراکنش‌ها را ویرایش یا حذف کنید.");
        case "pmn": c.ud.flow = { kind: "members", pid, rename: extra }; return this.say(c, `نام جدید «${h(this.db.person(extra).name)}» را بنویسید:`, null, true);
        case "pte": case "pti": this.dropReplyKb(c); return this.txStart(c, pid, head === "pte" ? "expense" : "income");
        case "pl": return this.txList(c, pid);
        case "pv": return this.txView(c, pid, extra);
        case "pe": { const tx = this.db.tx(pid, extra); if (tx) { c.ud.flow = this.txToFlow(pid, tx); this.advance(c, c.ud.flow, true); } return; }
        case "ptb": return this.sendTxTable(c, pid, extra);
        case "pph": { const tx = this.db.tx(pid, extra); if (tx) this.sendPhotos(c, tx); return; }
        case "pdel": return this.say(c, `تراکنش #${faDigits(extra)} حذف شود؟`, kb([["✅ بله، حذف شود", `pdy:${pid}:${extra}`], ["🔙 خیر", `pv:${pid}:${extra}`]]), true);
        case "pdy": this.db.deleteTx(pid, extra); return this.txList(c, pid);
        case "pc": return this.calcScreen(c, pid);
        case "pxl": return this.sendTable(c, pid);
        case "ps": return this.sendInvoicesScreen(c, pid);
        case "psy": return this.sendInvoices(c, pid);
        case "pk": return this.treasurerPick(c, pid);
        case "pkk": this.db.updateProgram(pid, { treasurer: extra }); return this.programMenu(c, pid, true, "👑 مادرخرج تغییر کرد.");
        case "pst": return this.say(c, isOpen(p) ? "🏁 با پایان برنامه، ثبت و ویرایش تراکنش‌ها و اعضا قفل می‌شود. ادامه می‌دهید؟" : "🔓 با بازگشایی، ویرایش تراکنش‌ها دوباره ممکن می‌شود. ادامه می‌دهید؟",
          kb([["✅ بله", `pstc:${pid}`], ["🔙 خیر", `p:${pid}`]]), true);
        case "pstc": { const st = isOpen(p) ? "closed" : "open"; this.db.updateProgram(pid, { status: st }); return this.programMenu(c, pid, true, st === "closed" ? "🏁 برنامه پایان یافت و قفل شد." : "🔓 برنامه بازگشایی شد."); }
      }
    }
    text(user, text) {
      const c = this.ctx(user);
      text = text.trim();
      if (text === "/start" || text === "/menu") return this.start(user);
      if (text === "/cancel") return this.cancel(user);
      const f = c.ud.flow || {};
      if (f.kind === "newprog" && f.step !== "date") { f.title = text.slice(0, 120); f.step = "date"; return this.askProgDate(c); }
      if (f.kind === "newprog") {
        const d = parseJdate(text);
        if (!d) return this.say(c, "تاریخ را متوجه نشدم. مثل <code>۱۴۰۵/۰۵/۱۰</code> یا <code>۱۰ مرداد</code> بنویسید.", kb([[`📅 امروز ${showJ(todayJ())}`, "m:pdt"]]));
        return this.finishNewProgram(c, d);
      }
      if (f.kind === "progedit") {
        const p = this.owned(c, f.pid);
        if (!p) return this.mainMenu(c);
        if (f.field === "title") { p.title = text.slice(0, 120); return this.programMenu(c, f.pid, false, "📝 نام برنامه تغییر کرد."); }
        const d = parseJdate(text);
        if (!d) return this.say(c, "تاریخ را متوجه نشدم. مثل <code>۱۴۰۵/۰۵/۱۰</code> یا <code>۱۰ مرداد</code> بنویسید.");
        p.date = d; return this.programMenu(c, f.pid, false, "📅 تاریخ برنامه تغییر کرد.");
      }
      if (f.kind === "members" && f.rename) { this.db.renamePerson(f.rename, text.slice(0, 60)); return this.membersScreen(c, f.pid, false, "✏️ نام تغییر کرد."); }
      if (f.kind === "members") return this.membersAddText(c, f.pid, text);
      if (f.kind === "tx") return this.flowText(c, f, text);
      this.mainMenu(c);
    }
  }
  const lib = {
    UNIT, FIXED, INCOME, EXPENSE, JMONTHS, fmt, fmtSigned, fmtNum, faDigits, toEn, showJ, todayJ, jdate, parseJdate, parseAmount, parseNumber,
    normalizePhone, splitNamePhone, splitAmount, itemAmounts, itemQty, itemTotal, allocOf, breakdown, breakdownRows, balances, net, nets,
    settle, settleViaHub, netPairwise, tableData, programTable, txDetailText, personInvoiceText, programCalcText, globalText, progDate,
  };
  return { Store, Bot, lib, core: { parseAmount, parseJdate, splitAmount, breakdown, nets, fmt, todayJ, splitNamePhone, normalizePhone, toEn } };
})();
if (typeof module !== "undefined") module.exports = Dong;
