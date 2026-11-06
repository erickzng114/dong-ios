"use strict";
/* اپلیکیشن دنگ — رابط فرم‌محور، آفلاین. محاسبات با همان موتور ربات (engine.js → Dong.lib) */
(function () {
  const L = Dong.lib;
  const { fmt, faDigits, showJ, todayJ, parseAmount, UNIT, FIXED, INCOME, EXPENSE } = L;
  const ME = 1;
  const KEY = "dong-app-v2", OLD_KEY = "dong-app-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const native = window.Android || null;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  try {
    const dark = native ? native.isDark() : !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) { /* مرورگر */ }
  // نسخهٔ وب (آیفون و مرورگر): تشخیص گفتار خود مرورگر، اگر باشد
  const WebSpeech = !native ? window.SpeechRecognition || window.webkitSpeechRecognition || null : null;

  // ============================================================ ذخیره‌سازی
  const photos = {};
  let idb = null;
  const openIdb = () => new Promise((res) => {
    try {
      const r = indexedDB.open("dong-photos", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("p");
      r.onsuccess = () => { idb = r.result; res(); };
      r.onerror = () => res();
    } catch (e) { res(); }
  });
  const loadPhotos = () => new Promise((res) => {
    if (!idb) return res();
    const req = idb.transaction("p", "readonly").objectStore("p").openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { photos[c.key] = c.value; c.continue(); } else res(); };
    req.onerror = () => res();
  });
  function putPhoto(fid, url) { photos[fid] = url; try { if (idb) idb.transaction("p", "readwrite").objectStore("p").put(url, fid); } catch (e) { /* */ } }
  function clearPhotos() { try { if (idb) idb.transaction("p", "readwrite").objectStore("p").clear(); } catch (e) { /* */ } for (const k in photos) delete photos[k]; }

  // انتقال یک‌باره از نسخه‌های قبلی که از file:// اجرا می‌شدند (Android.migTake)
  let legacy = null;
  try {
    if (native && native.migTake && !localStorage.getItem(KEY) && !localStorage.getItem(OLD_KEY)) {
      const raw = native.migTake();
      if (raw) { legacy = JSON.parse(raw); for (const k in legacy.ls || {}) localStorage.setItem(k, legacy.ls[k]); }
    }
  } catch (e) { legacy = null; }
  function importLegacyPhotos() {
    if (legacy) for (const fid in legacy.photos || {}) if (!photos[fid]) putPhoto(fid, legacy.photos[fid]);
    legacy = null;
    try { if (native && native.migClear) native.migClear(); } catch (e) { /* */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
      const old = localStorage.getItem(OLD_KEY);                 // انتقال از نسخه گفتگومحور
      if (old) { const o = JSON.parse(old); return { name: o.name, state: o.state }; }
    } catch (e) { /* */ }
    return { name: null, state: null };
  }
  let S, store;
  function boot(st) {
    S = st;
    store = new Dong.Store(S.state);
    S.state = store.s;
    for (const id in store.s.users) if (store.s.users[id].phone === "offline") store.s.users[id].phone = null;
    for (const pe of store.s.persons) if (pe.phone === "offline") pe.phone = null;
    if (S.name) { store.touchUser(ME, S.name); store.selfPerson(ME, S.name); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("ذخیره نشد: حافظه برنامه پر است."); } }

  // ============================================================ داده‌ها
  const me = () => store.selfPerson(ME, S.name || "من");
  const namesOf = (pid) => new Map(store.members(pid).map((m) => [m.id, m.name]));
  const isOpen = (p) => p.status === "open";
  const pDate = (p) => p.date || "";
  function sortPrograms(list) {
    return [...list].sort((a, b) => (isOpen(b) - isOpen(a)) || (pDate(b) > pDate(a) ? 1 : pDate(b) < pDate(a) ? -1 : b.id - a.id));
  }
  function stats(p) {
    const txs = store.txs(p.id);
    const exp = txs.filter((t) => t.kind !== INCOME), inc = txs.filter((t) => t.kind === INCOME);
    return { txs, exp, inc, spent: sum(exp.map((t) => t.paid)), received: sum(inc.map((t) => t.paid)), members: store.members(p.id).length };
  }
  function tagsHtml(p) {
    const t = [isOpen(p) ? `<span class="tag ok">● در جریان</span>` : `<span class="tag done">تمام‌شده</span>`,
      isOpen(p) ? `<span class="tag open">🔓 قابل ویرایش</span>` : `<span class="tag lock">🔒 قفل</span>`];
    if (p.settled) t.push(`<span class="tag settled">✔️ تسویه‌شده</span>`);
    if (isPetty(p)) { t.unshift(`<span class="tag open">💳 تنخواه</span>`); if (pettyStats(p).need) t.push(`<span class="tag lock">⚠️ نیاز به شارژ</span>`); }
    return `<div class="tags">${t.join("")}</div>`;
  }
  function progCard(p) {
    if (isPetty(p)) {
      const ps = pettyStats(p);
      return `<button type="button" class="card tap" data-act="openProg" data-pid="${p.id}">
        <div class="row"><h3 class="grow">💳 ${esc(p.title)}</h3></div>${tagsHtml(p)}
        <div class="meta"><span>📅 ${L.progDate(p)}</span><span>💳 موجودی ${fmt(ps.balance)}</span><span>📉 ${faDigits(L.fmtNum(ps.usedPct))}٪ مصرف</span><span>🧾 ${faDigits(ps.list.length - ps.list.filter(isCharge).length)} هزینه</span>${p.company ? `<span>🏢 ${esc(p.company)}</span>` : ""}</div>
      </button>`;
    }
    const st = stats(p), names = namesOf(p.id);
    return `<button type="button" class="card tap" data-act="openProg" data-pid="${p.id}">
      <div class="row"><h3 class="grow">${esc(p.title)}</h3></div>
      ${tagsHtml(p)}
      <div class="meta"><span>📅 ${L.progDate(p)}</span><span>👥 ${faDigits(st.members)} نفر</span><span>🧾 ${faDigits(st.exp.length)} هزینه</span><span>💰 ${fmt(st.spent)} تومان</span><span>👑 ${esc(names.get(p.treasurer) || "")}</span></div>
    </button>`;
  }

  // ============================================================ ناوبری
  let stack = [{ v: "home" }];
  const top = () => stack[stack.length - 1];
  function go(route) { stack.push(route); render(true); }
  function replaceTop(route) { stack[stack.length - 1] = route; render(true); }
  function goBack(force) {
    const r = top();
    if (!force && r.dirty) return confirmSheet("تغییرات ذخیره نشده‌اند", "اگر برگردید، تغییرات این فرم از بین می‌رود.", "برگرد بدون ذخیره", () => goBack(true));
    if (stack.length > 1) { stack.pop(); render(true); return true; }
    return false;
  }
  window.dongBack = function () {
    if (!$("overlay").hidden && S.name) { closeSheet(); return true; }
    if (stack.length > 1 || top().dirty) { goBack(); return true; }
    return false;
  };

  // ============================================================ نمایش
  function render(scrollTop) {
    const r = top();
    const out = VIEWS[r.v](r);
    const backBtn = stack.length > 1 ? `<button class="icon-btn" type="button" data-act="back" aria-label="برگشت">→</button>` : `<span class="icon-btn" aria-hidden="true">🧮</span>`;
    const menuBtn = out.menu ? `<button class="icon-btn" type="button" data-act="${out.menu}" aria-label="بیشتر">⋮</button>` : "";
    $("bar").innerHTML = `${backBtn}<h1>${esc(out.title)}${out.sub ? `<small>${esc(out.sub)}</small>` : ""}</h1>${menuBtn}`;
    $("view").innerHTML = out.body;
    $("foot").hidden = !out.foot;
    $("foot").innerHTML = out.foot || "";
    if (scrollTop) $("view").scrollTop = 0;
    if (out.after) out.after();
  }
  const VIEWS = {};
  const ACT = {};

  // ---------------------------------------------------------------- خانه
  VIEWS.home = () => {
    const every = sortPrograms(store.programs(ME)), all = every.filter((p) => !isPetty(p)), pettys = every.filter(isPetty);
    const shown = all.slice(0, 8);
    let body = `<div class="hero-actions">
        <button type="button" class="btn primary" data-act="newProg"><b>＋</b>برنامه جدید</button>
        <button type="button" class="btn" data-act="browse"><b>📂</b>مرور برنامه‌ها</button>
        <button type="button" class="btn" data-act="global"><b>⚖️</b>تسویه حساب کلی</button>
      </div>`;
    body += pettyHomeCard(pettys);
    if (!all.length) {
      body += `<div class="card empty"><div class="big">🧳</div><b>هنوز برنامه‌ای ندارید</b>
        <span class="hint">برای سفر یا ماموریت بعدی یک برنامه بسازید؛ اعضا را اضافه کنید و هزینه‌ها را ثبت کنید. دنگ هر نفر خودکار حساب می‌شود.</span>
        <div class="btns"><button type="button" class="btn primary" data-act="newProg">ساخت برنامه</button><button type="button" class="btn" data-act="sample">دیدن نمونه</button></div></div>`;
    } else {
      body += `<h2 class="sec">👥 برنامه‌های گروهی ${all.length > shown.length ? `<button type="button" class="link" data-act="browse" data-k="group">همه (${faDigits(all.length)})</button>` : ""}</h2>`;
      body += shown.map(progCard).join("");
    }
    return { title: "دنگ", sub: "حساب‌وکتاب مادرخرج", menu: "settings", body };
  };
  ACT.newProg = () => go({ v: "progForm", pid: null });
  ACT.browse = (el) => go({ v: "browse", q: "", f: "all", k: (el && el.dataset && el.dataset.k) || "group" });
  ACT.newPetty = () => go({ v: "pettyForm", pid: null });
  function pettyHomeCard(pettys) {
    const shown = pettys.slice(0, 5);
    return `<div class="card petty-home"><div class="row"><h3 class="grow">💳 مدیریت تنخواه</h3>${pettys.length > shown.length ? `<button type="button" class="link" data-act="browse" data-k="petty">همه (${faDigits(pettys.length)})</button>` : ""}</div>
      ${pettys.length ? `<div class="list">${shown.map((p) => { const st = pettyStats(p); return `<button type="button" class="li" data-act="openProg" data-pid="${p.id}"><div class="ic">💳</div>
        <div class="grow"><b>${esc(p.title)}${st.need ? ` <span class="tag lock">⚠️ نیاز به شارژ</span>` : ""}${isOpen(p) ? "" : ` <span class="tag done">بسته</span>`}</b><small>${p.company ? esc(p.company) + " · " : ""}${faDigits(L.fmtNum(st.usedPct))}٪ مصرف</small>
        <span class="meter sm"><i style="width:${Math.min(100, st.usedPct)}%" class="${st.need ? "hot" : ""}"></i></span></div><span class="amount">${fmt(st.balance)}</span></button>`; }).join("")}</div>`
        : `<p class="hint">کارت تنخواه شرکت دست شماست؟ هزینه‌ها را با عکس فاکتور ثبت کنید، موجودی را ببینید، سر ۶۰٪ هشدار شارژ بگیرید و گزارش را zip کنید.</p>`}
      <div class="btns"><button type="button" class="btn soft" data-act="newPetty">＋ تنخواه جدید</button></div></div>`;
  }
  ACT.global = () => go({ v: "global" });
  ACT.openProg = (el) => go({ v: "prog", pid: +el.dataset.pid, tab: "tx" });
  ACT.back = () => goBack();

  // ---------------------------------------------------------------- مرور برنامه‌ها
  VIEWS.browse = (r) => ({
    title: "مرور برنامه‌ها",
    body: `<div class="seg" id="b-k">${[["group", "👥 برنامه‌های گروهی"], ["petty", "💳 تنخواه"]].map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${(r.k || "group") === k}">${t}</button>`).join("")}</div>
      <input class="input" id="b-q" type="search" placeholder="جستجوی نام برنامه…" value="${esc(r.q)}" autocomplete="off">
      <div class="seg" id="b-f">${[["all", "همه"], ["open", "در جریان"], ["done", "تمام‌شده"], ["settled", "تسویه‌شده"]].map(([k, t]) => `<button type="button" data-f="${k}" aria-pressed="${r.f === k}">${t}</button>`).join("")}</div>
      <div class="list" id="b-list"></div>`,
    after() {
      r.k = r.k || "group";
      const draw = () => {
        const q = r.q.trim();
        const list = sortPrograms(store.programs(ME)).filter((p) => (r.k === "petty") === isPetty(p) &&
          (!q || p.title.includes(q)) && (r.f === "all" || (r.f === "open" && isOpen(p)) || (r.f === "done" && !isOpen(p)) || (r.f === "settled" && p.settled)));
        $("b-list").innerHTML = list.length ? list.map(progCard).join("") : `<div class="card empty">${r.k === "petty" ? "تنخواهی" : "برنامه‌ای"} با این مشخصات نیست.</div>`;
      };
      $("b-q").oninput = (e) => { r.q = e.target.value; draw(); };
      $("b-k").onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; r.k = b.dataset.k; $("b-k").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); };
      $("b-f").onclick = (e) => { const b = e.target.closest("[data-f]"); if (!b) return; r.f = b.dataset.f; $("b-f").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); };
      draw();
    },
  });

  // ---------------------------------------------------------------- صفحه برنامه
  VIEWS.prog = (r) => {
    const p = store.program(r.pid);
    if (!p) { stack = [{ v: "home" }]; return VIEWS.home(); }
    if (isPetty(p)) { if (!["tx", "reports"].includes(r.tab)) r.tab = "tx"; return pettyView(r, p); }
    const st = stats(p), names = namesOf(p.id), mids = store.members(p.id).map((m) => m.id);
    const bal = L.balances(st.txs, mids);
    let body = `<div class="card">
        <h3>${esc(p.title)}</h3>${tagsHtml(p)}
        <div class="meta"><span>📅 ${L.progDate(p)}</span><span>👑 مادرخرج: ${esc(names.get(p.treasurer) || "")}</span><span>👥 ${faDigits(st.members)} نفر</span></div>
        <div class="row"><span class="grow hint">جمع هزینه‌ها (${faDigits(st.exp.length)})</span><span class="amount">${fmt(st.spent)} تومان</span></div>
        ${st.inc.length ? `<div class="row"><span class="grow hint">دریافتی از اعضا (${faDigits(st.inc.length)})</span><span class="amount">${fmt(st.received)} تومان</span></div>` : ""}
        ${hasWork(p) ? `<div class="row"><span class="grow hint">🏢 هزینه‌های شرکتی (${faDigits(comps(p.id).length)})</span><span class="amount">${fmt(sum(comps(p.id).map((c) => c.amount)))} تومان</span></div>` : ""}
      </div>`;
    if (isOpen(p)) body += `<div class="btns two"><button type="button" class="btn primary" data-act="addExp">＋ ثبت هزینه</button>${hasWork(p) ? `<button type="button" class="btn primary" data-act="addComp">🏢 ثبت هزینه شرکتی</button>` : ""}</div>
      <div class="btns two"><button type="button" class="btn soft" data-act="voiceExp">🎤 ثبت صوتی</button><button type="button" class="btn soft" data-act="addInc">💵 دریافتی از عضو</button></div>`;
    const tabs = [["tx", "تراکنش‌ها"], ["members", "اعضا"], ["dong", "دنگ و تسویه"]];
    if (hasWork(p)) { tabs[2][1] = "دنگ"; tabs.push(["company", "🏢 شرکتی"]); }
    if (r.tab === "company" && !hasWork(p)) r.tab = "tx";
    body += `<div class="tabs" role="tablist">${tabs.map(([k, t]) =>
      `<button type="button" role="tab" data-act="tab" data-tab="${k}" aria-selected="${r.tab === k}">${t}</button>`).join("")}</div>`;
    if (r.tab === "tx") {
      body += st.txs.length ? `<div class="list">${st.txs.map((t) => txItem(t, names)).join("")}</div>`
        : `<div class="card empty"><div class="big">🧾</div>هنوز تراکنشی ثبت نشده.${isOpen(p) ? `<button type="button" class="btn primary" data-act="addExp">ثبت اولین هزینه</button>` : ""}</div>`;
    } else if (r.tab === "company") {
      body += companyTab(p);
    } else if (r.tab === "members") {
      body += `<div class="list">${store.members(p.id).map((m) => {
        const n = L.net(bal.get(m.id) || { spent: 0, deposited: 0, received: 0, share: 0 });
        return `<div class="li"><div class="ic">${m.id === p.treasurer ? "👑" : "👤"}</div><div class="grow"><b>${esc(m.name)}${m.isSelf ? " (شما)" : ""}</b>
          <small dir="ltr">${esc(m.phone || "")}</small></div><span class="amount ${n < 0 ? "neg" : n > 0 ? "pos" : ""}">${n ? fmt(Math.abs(n)) : "—"}</span></div>`;
      }).join("")}</div>
      <p class="hint">عدد سبز = طلبکار، قرمز = بدهکار</p>`;
      if (isOpen(p)) body += `<button type="button" class="btn" data-act="editProg">✏️ ویرایش اعضا و مشخصات برنامه</button>`;
    } else {
      if (!st.txs.length) body += `<div class="card empty">بعد از ثبت هزینه‌ها، سهم هر نفر اینجا نمایش داده می‌شود.</div>`;
      else {
        body += `<div class="list">${[...bal].map(([m, b]) => {
          const n = L.net(b);
          const parts = [`سهم ${fmt(b.share)}`];
          if (b.spent) parts.push(`خرج ${fmt(b.spent)}`);
          if (b.deposited) parts.push(`واریز ${fmt(b.deposited)}`);
          if (b.received) parts.push(`دریافت ${fmt(b.received)}`);
          return `<div class="li"><div class="ic">${m === p.treasurer ? "👑" : "👤"}</div><div class="grow"><b>${esc(names.get(m))}</b><small>${parts.join(" · ")}</small></div>
            <div style="text-align:left"><span class="amount ${n < 0 ? "neg" : n > 0 ? "pos" : ""}">${n ? fmt(Math.abs(n)) : "—"}</span><br><small class="hint">${n > 0 ? "طلبکار" : n < 0 ? "بدهکار" : "تسویه"}</small></div></div>`;
        }).join("")}</div>`;
        const tr = L.settleViaHub(new Map([...bal].map(([m, b]) => [m, L.net(b)])), p.treasurer);
        body += `<div class="card"><h3>💸 تسویه با مادرخرج</h3>${tr.length ? tr.map(([a, b, x]) =>
          `<div class="row"><span class="grow">${esc(names.get(a))} ← به ${esc(names.get(b))}</span><span class="amount">${fmt(x)}</span></div>`).join("") : `<span class="hint">همه تسویه‌اند 🎉</span>`}</div>
          <div class="btns"><button type="button" class="btn soft" data-act="table">📊 جدول کامل</button><button type="button" class="btn primary" data-act="invoices">📤 صورت‌حساب‌ها</button></div>`;
      }
    }
    return { title: p.title, sub: L.progDate(p), menu: "progMenu", body };
  };
  function txItem(t, names) {
    if (t.kind === INCOME) {
      return `<button type="button" class="li" data-act="openTx" data-no="${t.no}"><div class="ic in">💵</div><div class="grow"><b>${esc(t.title)}</b>
        <small>${showJ(t.date)} · ${esc(names.get(t.payer))} ← به ${esc(names.get(t.receiver))}</small></div><span class="amount">${fmt(t.paid)}</span></button>`;
    }
    return `<button type="button" class="li" data-act="openTx" data-no="${t.no}"><div class="ic">🧾</div><div class="grow"><b>${esc(t.title)}${t.photos.length ? " 📷" : ""}</b>
      <small>${showJ(t.date)} · پرداخت: ${esc(names.get(t.payer))} · ${faDigits(t.items.length)} قلم</small></div><span class="amount">${fmt(t.paid)}</span></button>`;
  }
  ACT.tab = (el) => { top().tab = el.dataset.tab; render(false); };
  ACT.addExp = () => { const p = store.program(top().pid); if (!guardOpen(p)) return; if (store.members(p.id).length < 2) return toast("اول اعضای برنامه را اضافه کنید."); go({ v: "expForm", pid: p.id, no: null }); };
  // ---------------------------------------------------------------- ثبت صوتی
  const VOICE_EX = ["شام دو میلیون و چهارصد، علی و محمد و عارف مساوی", "بنزین ۸۰۰ هزار تومان علی حساب کرد", "کرایه سه میلیون همه به جز جلیلی",
    "بلیط نفری ۴۵۰ هزار برای من و علی", "هتل ۹ میلیون، علی دو سهم، بقیه یک سهم"];
  const VOICE_EX_COMP = ["شام کاری دو میلیون و سیصد از رستوران ساحل فاکتور شماره ۸۸۷ شرکتی", "اقامت هتل ۹ میلیون و ششصد به حساب شرکت شماره فاکتور ۴۵۲۱۸",
    "بنزین ۸۰۰ هزار از پمپ بنزین آزادی", "دیروز تاکسی فرودگاه ۶۵۰ هزار"];
  const VOICE_EX_PETTY = ["خرید کارتریج پرینتر یک میلیون و دویست از فروشگاه رایان قبض ۳۳۴۵", "پذیرایی جلسه میوه و شیرینی یک و نیم میلیون",
    "تنخواه شارژ شد ۳۰ میلیون کد پیگیری ۹۸۷۶۵۴", "دیروز پیک موتوری ۱۸۰ هزار"];
  let voiceRes = null, voiceMode = null;
  function voiceCtx(pid) {
    const p = store.program(pid), ms = store.members(pid), self = me();
    return { petty: isPetty(p), forceCompany: voiceMode === "comp",
      members: ms.map((m) => ({ id: m.id, name: m.name })), treasurer: p.treasurer, selfId: ms.some((m) => m.id === self.id) ? self.id : null,
      todayJ: todayJ(), shiftDate: (d) => L.toEn(L.jdate(Math.floor(Date.now() / 1000) + d * 86400)) };
  }
  ACT.voiceExp = (el) => {
    const p = store.program(top().pid); if (!guardOpen(p)) return;
    voiceMode = el && el.dataset && el.dataset.mode || null;
    const petty = isPetty(p), compMode = petty || voiceMode === "comp";
    if (!compMode && !hasWork(p) && store.members(p.id).length < 2) return toast("اول اعضای برنامه را اضافه کنید.");
    const EX = petty ? VOICE_EX_PETTY : compMode ? VOICE_EX_COMP : hasWork(p) ? VOICE_EX.slice(0, 3).concat(VOICE_EX_COMP.slice(0, 2)) : VOICE_EX;
    voiceRes = null;
    const mic = (native && native.voice) || WebSpeech;
    openSheet(`<h2>🎤 ${petty ? "ثبت صوتی تنخواه" : compMode ? "ثبت صوتی هزینهٔ شرکتی" : "ثبت صوتی هزینه"}</h2><div class="sheet-scroll">
      ${mic ? `<div class="voice-mic"><button type="button" data-act="voiceStart" aria-label="شروع صحبت">🎤</button><span class="hint">بزنید و هزینه را بگویید</span></div>` : ""}
      ${!native ? `<p class="hint">💡 روی آیفون می‌توانید در کادر زیر روی میکروفون کیبورد بزنید و جمله را بگویید.</p>` : ""}
      <label class="field"><span>${mic ? "یا جمله را بنویسید / اصلاح کنید" : "جمله را بنویسید"}</span><textarea class="input" id="v-text" placeholder="مثلاً: ${esc(EX[0])}"></textarea></label>
      <div class="btns"><button type="button" class="btn primary" data-act="voiceParse">🔍 بررسی جمله</button></div>
      <div id="v-out"></div>
      <details class="voice-ex"><summary class="hint">چطور بگویم؟ (نمونه‌ها)</summary>
        <p>${petty ? "شرح، مبلغ، و اگر دارید «از فلان فروشگاه» و «فاکتور شماره …». برای شارژ کارت بگویید «تنخواه شارژ شد ۳۰ میلیون»." : compMode ? "شرح، مبلغ، «از فلان فروشگاه / رستوران» و «فاکتور شماره …». اگر کس دیگری پرداخت کرده: «علی حساب کرد»." : "عنوان، مبلغ، و اینکه بین چه کسانی است. اگر کسی غیر از مادرخرج پرداخت کرده بگویید «علی حساب کرد». برای سهم نابرابر: «علی دو سهم» یا «علی ۴۰ درصد». برای قیمت هر نفر: «نفری ۴۵۰ هزار»."}${hasWork(p) && !compMode ? " اگر بگویید «شرکتی» یا «به حساب شرکت»، در فهرست هزینه‌های شرکتی ثبت می‌شود." : ""}</p>
        ${EX.map((t) => `<button type="button" data-act="voiceTry" data-t="${esc(t)}">${esc(t)}</button>`).join("")}
      </details></div>
      <button type="button" class="btn" data-act="closeSheet">بستن</button>`);
    const ta = $("v-text"); if (ta && !mic) ta.focus();
  };
  let webRec = null;
  ACT.voiceStart = () => {
    if (native && native.voice) { try { native.voice(); } catch (e) { toast("تایپ صوتی باز نشد؛ جمله را بنویسید."); } return; }
    if (!WebSpeech) return toast("این مرورگر تشخیص گفتار ندارد؛ از میکروفون کیبورد استفاده کنید.");
    try {
      if (webRec) { webRec.abort(); webRec = null; }
      const rec = new WebSpeech(); webRec = rec;
      rec.lang = "fa-IR"; rec.interimResults = false; rec.maxAlternatives = 5; rec.continuous = false;
      rec.onresult = (e) => { const r = e.results[0], list = []; for (let i = 0; i < r.length; i++) list.push(r[i].transcript); window.dongNative.onVoice(list); };
      rec.onerror = (e) => { toast(e.error === "not-allowed" || e.error === "service-not-allowed" ? "اجازهٔ میکروفون داده نشد. می‌توانید با میکروفون کیبورد آیفون جمله را بنویسید." : e.error === "no-speech" ? "صدایی شنیده نشد؛ دوباره امتحان کنید." : "تشخیص گفتار انجام نشد؛ از میکروفون کیبورد استفاده کنید."); };
      rec.onend = () => { webRec = null; const b = document.querySelector('.voice-mic button'); if (b) b.classList.remove("rec"); };
      rec.start();
      const b = document.querySelector('.voice-mic button'); if (b) b.classList.add("rec");
      toast("🎤 صحبت کنید…");
    } catch (e) { toast("تشخیص گفتار شروع نشد؛ از میکروفون کیبورد استفاده کنید."); }
  };
  ACT.voiceTry = (el) => { $("v-text").value = el.dataset.t; voiceShow([el.dataset.t]); };
  ACT.voiceParse = () => { const t = $("v-text").value.trim(); if (!t) return toast("جمله‌ای ننوشته‌اید."); voiceShow([t]); };
  function voiceShow(texts) {
    const pid = top().pid, ctx = voiceCtx(pid);
    const r = DongVoice.parseBest(texts, ctx); voiceRes = r;
    if (!r) return;
    const s = r.summary, names = namesOf(pid);
    if ($("v-text") && texts.length > 1) $("v-text").value = r.text;
    if (s.company) return voiceShowComp(r, names, isPetty(store.program(pid)), store.members(pid).length > 1);
    const rows = [
      `<div><span>عنوان</span><span>${s.title ? esc(s.title) : "—"}</span></div>`,
      `<div><span>${s.perHead ? "مبلغ هر نفر (فی)" : "مبلغ"}</span><span class="num">${s.amount ? fmt(s.amount) + " تومان" : "—"}</span></div>`,
      `<div><span>تاریخ</span><span>${showJ(r.draft.date)}</span></div>`,
      `<div><span>پرداخت‌کننده</span><span>${esc(names.get(s.payer) || "")}${s.payerSaid ? "" : " <small class=\"hint\">(مادرخرج)</small>"}</span></div>`,
    ];
    if (s.discount) rows.push(`<div><span>تخفیف</span><span class="num">${fmt(s.discount)}</span></div>`);
    if (s.vat) rows.push(`<div><span>ارزش افزوده</span><span>${L.fmtNum(s.vat)}٪</span></div>`);
    const people = s.people.length ? `<div class="list">${s.people.map((x) => `<div class="row"><span class="grow">${esc(x.name)}${x.weight && x.weight !== 1 ? ` <small class="hint">${s.pct ? L.fmtNum(Math.round(x.weight * 10) / 10) + "٪" : faDigits(x.weight) + " سهم"}</small>` : ""}</span><span class="amount">${fmt(x.share)}</span></div>`).join("")}</div>` : "";
    $("v-out").innerHTML = `<div class="card" style="margin-top:10px"><h3>برداشت دنگ از جمله</h3><div class="sum">${rows.join("")}</div>
      ${people ? `<h3 style="margin-top:8px">سهم هر نفر${s.discount || s.vat ? " <small class=\"hint\">(پیش از تخفیف و مالیات)</small>" : ""}</h3>${people}` : ""}
      ${r.notes.map((n) => `<p class="hint">ℹ️ ${esc(n)}</p>`).join("")}
      ${r.warnings.map((w) => `<div class="warn-box">${esc(w)}</div>`).join("")}
      <div class="btns" style="margin-top:8px"><button type="button" class="btn primary" data-act="voiceUse">✅ ادامه در فرم هزینه</button></div>
      <p class="hint">در فرم می‌توانید همه‌چیز را اصلاح و بعد ذخیره کنید.</p></div>`;
    $("v-out").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function voiceShowComp(r, names, petty, many) {
    const s = r.summary, c = r.comp;
    const kind = s.charge ? "💳 شارژ تنخواه" : petty ? "🧾 هزینه از تنخواه" : "🏢 هزینهٔ شرکتی";
    const rows = [["نوع", kind], ["شرح", c.title || "—"], ["مبلغ", c.amount ? fmt(c.amount) + " تومان" : "—"], ["تاریخ", showJ(c.date)]];
    if (!s.charge) { rows.push(["دسته", c.category || "—"], ["طرف حساب", c.vendor || "—"]); }
    rows.push([s.charge ? "شمارهٔ سند / پیگیری" : "شمارهٔ فاکتور / قبض", c.invoiceNo ? faDigits(c.invoiceNo) : "—"]);
    if (many && !s.charge) rows.push(["پرداخت‌کننده", names.get(c.payer) || ""]);
    const warns = r.warnings.filter((w) => !/تقسیم|عضوی/.test(w));
    if (!s.charge) { const miss = [!c.category && "دسته", !c.vendor && "طرف حساب", !c.invoiceNo && "شمارهٔ فاکتور"].filter(Boolean); if (miss.length) warns.push(`${miss.join("، ")} گفته نشد؛ در فرم وارد کنید (اجباری).`); }
    $("v-out").innerHTML = `<div class="card" style="margin-top:10px"><h3>برداشت دنگ از جمله</h3><div class="sum">${rows.map(([k, v]) => `<div><span>${k}</span><span>${esc(v)}</span></div>`).join("")}</div>
      ${!s.charge && !petty ? `<p class="hint">این هزینه در دنگ اعضا حساب نمی‌شود و در فهرست شرکتی می‌رود.</p>` : ""}
      ${!s.charge && petty ? `<p class="hint">📷 در فرم، عکس فاکتور یا قبض را اضافه کنید (اجباری).</p>` : ""}
      ${r.notes.map((n) => `<p class="hint">ℹ️ ${esc(n)}</p>`).join("")}${warns.map((w) => `<div class="warn-box">${esc(w)}</div>`).join("")}
      <div class="btns" style="margin-top:8px"><button type="button" class="btn primary" data-act="voiceUse">✅ ادامه در فرم</button></div></div>`;
    $("v-out").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  ACT.voiceUse = () => {
    if (!voiceRes) return;
    const pid = top().pid, p = store.program(pid);
    if (voiceRes.summary.company) {
      const c = clone(voiceRes.comp); closeSheet();
      if (voiceRes.summary.charge) {
        if (!isPetty(p)) return toast("شارژ فقط در برنامهٔ تنخواه معنی دارد.");
        go({ v: "chargeForm", pid, id: null, d: { title: c.title || "شارژ تنخواه", date: c.date, amount: c.amount, invoiceNo: c.invoiceNo, note: "", photos: [] }, dirty: true });
      } else go({ v: "compForm", pid, id: null, d: c, dirty: true });
      return toast("فرم از روی جمله پر شد؛ " + (isPetty(p) && !voiceRes.summary.charge ? "عکس فاکتور را اضافه و " : "") + "ذخیره کنید.");
    }
    if (store.members(pid).length < 2) return toast("برای هزینهٔ دنگی، اول اعضای برنامه را اضافه کنید.");
    const d = clone(voiceRes.draft);
    closeSheet();
    go({ v: "expForm", pid, no: null, d, dirty: true });
    toast("فرم از روی جمله پر شد؛ بررسی و ذخیره کنید.");
  };

  // ---------------------------------------------------------------- هزینه‌های شرکتی
  const COMP_CATS = ["اقامت", "غذا", "حمل‌ونقل", "سوخت", "عوارض و پارکینگ", "ارتباطات", "پذیرایی", "لوازم و خرید", "سایر"];
  function comps(pid) {
    if (!store.s.company) store.s.company = [];
    if (pid == null) return store.s.company;
    return store.s.company.filter((c) => c.prog === pid && (!isCharge(c) || isPetty(store.program(pid)))).sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : a.id - b.id));
  }
  const hasWork = (p) => !!p.work || comps(p.id).length > 0;
  function companyTab(p) {
    const list = comps(p.id), names = namesOf(p.id), total = sum(list.map((c) => c.amount));
    const byPayer = new Map(); for (const c of list) byPayer.set(c.payer, (byPayer.get(c.payer) || 0) + c.amount);
    const noPhoto = list.filter((c) => !c.photos.length).length;
    let h = `<div class="card"><div class="row"><b class="grow">جمع هزینه‌های شرکتی</b><span class="amount">${fmt(total)} تومان</span></div>
      <div class="meta"><span>🧾 ${faDigits(list.length)} مورد</span><span>📷 ${faDigits(sum(list.map((c) => c.photos.length)))} عکس فاکتور</span>${p.company ? `<span>🏢 ${esc(p.company)}</span>` : ""}</div>
      ${byPayer.size > 1 || (byPayer.size === 1 && !byPayer.has(p.treasurer)) ? `<h3 style="margin-top:6px">طلب هر نفر از شرکت</h3>${[...byPayer].map(([id, v]) => `<div class="row"><span class="grow">${esc(names.get(id))}</span><span class="amount">${fmt(v)}</span></div>`).join("")}` : ""}
      ${noPhoto ? `<div class="warn-box">${faDigits(noPhoto)} مورد عکس فاکتور ندارد.</div>` : ""}
      <p class="hint">این هزینه‌ها در دنگ اعضا حساب نمی‌شوند؛ شرکت مبلغ را به پرداخت‌کننده برمی‌گرداند.</p></div>`;
    if (isOpen(p)) h += `<div class="btns"><button type="button" class="btn soft" data-act="addComp">＋ هزینه شرکتی</button><button type="button" class="btn soft" data-act="voiceExp" data-mode="comp">🎤 ثبت صوتی شرکتی</button></div>`;
    h += list.length ? `<div class="list">${list.map((c, i) => `<button type="button" class="li" data-act="openComp" data-id="${c.id}"><div class="ic">${faDigits(i + 1)}</div>
        <div class="grow"><b>${esc(c.title)}${c.photos.length ? ` 📷${c.photos.length > 1 ? faDigits(c.photos.length) : ""}` : ""}</b>
        <small>${showJ(c.date)}${c.vendor ? " · " + esc(c.vendor) : ""}${c.invoiceNo ? " · فاکتور " + esc(faDigits(c.invoiceNo)) : ""} · ${esc(names.get(c.payer) || "")}</small></div><span class="amount">${fmt(c.amount)}</span></button>`).join("")}</div>
        <div class="btns"><button type="button" class="btn primary" data-act="compExport">📦 خروجی اکسل + عکس فاکتورها${proTag()}</button></div>`
      : `<div class="card empty"><div class="big">🏢</div>هنوز هزینهٔ شرکتی ثبت نشده.</div>`;
    return h;
  }
  ACT.addComp = () => { const p = store.program(top().pid); if (!guardOpen(p)) return; go({ v: "compForm", pid: p.id, id: null }); };
  ACT.openComp = (el) => {
    const p = store.program(top().pid), c = comps().find((x) => x.id === +el.dataset.id); if (!c) return;
    if (isOpen(p)) return go({ v: isCharge(c) ? "chargeForm" : "compForm", pid: p.id, id: c.id });
    const names = namesOf(p.id);
    openSheet(`<h2>🏢 ${esc(c.title)}</h2><div class="sheet-scroll"><div class="sum">
      ${[["تاریخ", showJ(c.date)], ["مبلغ", fmt(c.amount) + " تومان"], ["دسته", c.category], ["طرف حساب", c.vendor], ["شماره فاکتور / قبض", c.invoiceNo && faDigits(c.invoiceNo)], ["پرداخت‌کننده", names.get(c.payer)], ["توضیحات", c.note]]
        .filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><span>${esc(v)}</span></div>`).join("")}</div>
      ${c.photos.length ? `<div class="photos" style="margin-top:8px">${c.photos.map(([fid], i) => `<button type="button" class="ph" data-act="viewPhoto" data-fid="${fid}">${photos[fid] ? `<img src="${photos[fid]}" alt="عکس ${faDigits(i + 1)}">` : "📷"}</button>`).join("")}</div>` : ""}
      <p class="hint">🔒 برنامه قفل است؛ برای ویرایش، بازگشایی کنید.</p></div><button type="button" class="btn" data-act="closeSheet">بستن</button>`);
  };
  VIEWS.compForm = (r) => {
    const p = store.program(r.pid), ms = store.members(r.pid);
    if (!r.d) {
      const c = r.id ? comps().find((x) => x.id === r.id) : null;
      r.d = c ? clone(c) : { title: "", date: todayJ(), amount: null, payer: p.treasurer, vendor: "", invoiceNo: "", category: "", note: "", photos: [] };
    }
    const d = r.d, cats = d.category && !COMP_CATS.includes(d.category) ? [...COMP_CATS, d.category] : COMP_CATS;
    return {
      title: isPetty(p) ? (r.id ? "ویرایش هزینهٔ تنخواه" : "هزینه از تنخواه") : r.id ? "ویرایش هزینهٔ شرکتی" : "هزینهٔ شرکتی",
      sub: p.title + (p.company ? " · " + p.company : ""),
      body: `<div class="card">
          <label class="field"><span>شرح هزینه</span><input class="input" id="c-title" value="${esc(d.title)}" placeholder="مثلاً: اقامت هتل دو شب" autocomplete="off"></label>
          <div class="field"><span>تاریخ</span>${datePicker("c-date", d.date)}</div>
          <label class="field"><span>مبلغ (تومان)</span><input class="input num" id="c-amount" inputmode="numeric" value="${d.amount ? fmt(d.amount) : ""}" placeholder="مثلاً ۴٬۵۰۰٬۰۰۰ یا ۴٫۵ میلیون"></label>
          <label class="field"><span>دسته <b class="req">*</b></span><select class="select" id="c-cat"><option value="">—</option>${cats.map((k) => `<option${k === d.category ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        </div>
        <div class="card"><h3>🧾 مشخصات فاکتور</h3>
          <label class="field"><span>طرف حساب (فروشنده / گیرندهٔ پول) <b class="req">*</b></span><input class="input" id="c-vendor" value="${esc(d.vendor)}" placeholder="مثلاً: هتل پارس" autocomplete="off"></label>
          <label class="field"><span>شمارهٔ فاکتور یا قبض پرداخت <b class="req">*</b></span><input class="input" id="c-inv" value="${esc(d.invoiceNo)}" placeholder="مثلاً ۴۵۲۱۸" autocomplete="off"></label>
          <label class="field"${ms.length < 2 ? " hidden" : ""}><span>پرداخت‌کننده</span><select class="select" id="c-payer">${ms.map((m) => `<option value="${m.id}"${m.id === d.payer ? " selected" : ""}>${m.id === p.treasurer ? "👑 " : ""}${esc(m.name)}</option>`).join("")}</select></label>
          <label class="field"><span>توضیحات (اختیاری)</span><input class="input" id="c-note" value="${esc(d.note)}" autocomplete="off"></label>
        </div>
        ${isPetty(p) ? `<p class="hint">💳 موجودی کارت: ${fmt(pettyStats(p).balance + (r.id ? (comps().find((x) => x.id === r.id) || {}).amount || 0 : 0))} تومان${p.limit ? ` · سقف هر پرداخت: ${fmt(p.limit)}` : ""}</p>` : ""}
        <div class="card"><h3>📷 عکس فاکتور / رسید${isPetty(p) ? ` <small style="color:var(--warn)">(اجباری)</small>` : ""}</h3><div class="photos" id="e-photos"></div>
          <div class="btns"><button type="button" class="btn soft" data-act="camera">📷 دوربین</button><button type="button" class="btn" data-act="gallery">🖼 گالری</button></div>
          <p class="hint">در خروجی zip، نام عکس‌ها با شمارهٔ ردیف اکسل یکی است.</p></div>
        ${r.id ? `<button type="button" class="btn danger" data-act="delComp">🗑 حذف این هزینه</button>` : ""}`,
      foot: `<button type="button" class="btn primary" data-act="saveComp">💾 ذخیره</button><button type="button" class="btn" data-act="back">انصراف</button>`,
      after() {
        drawPhotos();
        const dirty = () => { r.dirty = true; };
        $("c-title").oninput = (e) => { d.title = e.target.value; dirty(); };
        $("c-date").onchange = dirty;
        $("c-amount").oninput = (e) => { d.amount = parseAmount(e.target.value); dirty(); };
        $("c-amount").addEventListener("blur", (e) => { const v = parseAmount(e.target.value); if (v) e.target.value = fmt(v); });
        $("c-cat").onchange = (e) => { d.category = e.target.value; e.target.classList.remove("bad"); dirty(); };
        for (const id of ["c-vendor", "c-inv"]) $(id).addEventListener("input", (e) => e.target.classList.remove("bad"));
        $("c-vendor").oninput = (e) => { d.vendor = e.target.value; dirty(); };
        $("c-inv").oninput = (e) => { d.invoiceNo = e.target.value; dirty(); };
        $("c-payer").onchange = (e) => { d.payer = +e.target.value; dirty(); };
        $("c-note").oninput = (e) => { d.note = e.target.value; dirty(); };
      },
    };
  };
  ACT.saveComp = () => {
    const r = top(), d = r.d;
    d.title = $("c-title").value.trim(); d.date = readDate("c-date"); d.amount = parseAmount($("c-amount").value);
    if (!d.title) return toast("شرح هزینه را بنویسید.");
    if (!d.date) return toast("تاریخ معتبر نیست.");
    if (!d.amount) return toast("مبلغ را وارد کنید.");
    d.category = $("c-cat").value; d.vendor = $("c-vendor").value.trim(); d.invoiceNo = $("c-inv").value.trim();
    const miss = [!d.category && "دسته", !d.vendor && "طرف حساب", !d.invoiceNo && "شمارهٔ فاکتور یا قبض"].filter(Boolean);
    if (miss.length) {
      const id = !d.category ? "c-cat" : !d.vendor ? "c-vendor" : "c-inv";
      $(id).classList.add("bad"); $(id).focus(); $(id).scrollIntoView({ block: "center", behavior: "smooth" });
      return toast(`این موارد اجباری است: ${miss.join("، ")}`);
    }
    const pp = store.program(r.pid);
    if (isPetty(pp)) {
      if (!d.photos.length) return toast("📷 عکس فاکتور یا قبض پرداخت برای هزینهٔ تنخواه اجباری است.");
      if (!d.ok) {
        const old = r.id ? (comps().find((x) => x.id === r.id) || {}).amount || 0 : 0, bal = pettyStats(pp).balance + old;
        const msgs = [];
        if (pp.limit && d.amount > pp.limit) msgs.push(`مبلغ ${fmt(d.amount)} از سقف هر پرداخت (${fmt(pp.limit)}) بیشتر است.`);
        if (d.amount > bal) msgs.push(`مبلغ از موجودی کارت (${fmt(bal)}) بیشتر است.`);
        if (msgs.length) return confirmSheet("ثبت شود؟", msgs.join(" "), "بله، ثبت شود", () => { d.ok = true; ACT.saveComp(); });
      }
    }
    const rec = { title: d.title, date: d.date, amount: d.amount, payer: d.payer, vendor: (d.vendor || "").trim(), invoiceNo: L.toEn((d.invoiceNo || "").trim()),
      category: d.category || "", note: (d.note || "").trim(), photos: clone(d.photos) };
    if (r.id) Object.assign(comps().find((x) => x.id === r.id), rec);
    else {
      const seq = store.s.seq; seq.company = (seq.company || 0) + 1;
      comps().push(Object.assign({ id: seq.company, prog: r.pid, created: Date.now() }, rec));
    }
    store.updateProgram(r.pid, { work: true });
    delete d.ok;
    save(); r.dirty = false; goBack(true);
    const pr = top(); if (pr.v === "prog") { pr.tab = "company"; render(false); }
    toast(r.id ? "هزینهٔ شرکتی ویرایش شد." : "🏢 هزینهٔ شرکتی ثبت شد.");
  };
  ACT.delComp = () => confirmSheet("حذف هزینهٔ شرکتی؟", "این مورد و عکس‌هایش از فهرست شرکتی حذف می‌شود.", "بله، حذف شود", () => {
    const r = top(); store.s.company = comps().filter((x) => x.id !== r.id); save(); r.dirty = false; goBack(true); toast("حذف شد.");
  }, true);

  // ---- خروجی اکسل و zip
  function compFiles(pid) {
    const list = comps(pid), w = Math.max(2, String(list.length).length);
    return list.map((c, i) => {
      const no = String(i + 1).padStart(w, "0");
      const files = c.photos.map(([fid], j) => {
        const b = DongExport.dataUrlBytes(photos[fid]);
        return b ? { name: `${no}${c.photos.length > 1 ? "-" + (j + 1) : ""}.${b.ext}`, bytes: b.bytes } : null;
      }).filter(Boolean);
      return { c, row: i + 1, files };
    });
  }
  function compSheet(pid, rows) {
    const p = store.program(pid), names = namesOf(pid);
    const S_ = (v, st) => ({ v, s: st });
    const total = sum(rows.map((x) => x.c.amount));
    const dates = rows.map((x) => x.c.date).sort();
    const head = ["ردیف", "تاریخ", "شرح", "دسته", "طرف حساب", "شماره فاکتور / قبض", "پرداخت‌کننده", "مبلغ (تومان)", "عکس فاکتور (پوشه Invoices)", "توضیحات"];
    const out = [];
    out.push({ ht: 28, cells: [S_(`صورت هزینه‌های شرکتی — ${p.title}`, 1)] });
    out.push([S_([p.company ? "شرکت: " + p.company : "", "مادرخرج: " + (names.get(p.treasurer) || ""), dates.length ? `بازه: ${dates[0]} تا ${dates[dates.length - 1]}` : "", "تاریخ تهیه: " + todayJ()].filter(Boolean).join("   |   "), 8)]);
    out.push([]);
    out.push({ ht: 30, cells: head.map((h) => S_(h, 2)) });
    const first = 5;
    for (const x of rows) {
      const c = x.c;
      out.push([S_(x.row, 7), S_(c.date, 7), S_(c.title, 3), S_(c.category || "", 3), S_(c.vendor || "", 3), S_(c.invoiceNo || "", 7), S_(names.get(c.payer) || "", 3),
        S_(c.amount, 4), S_(x.files.length ? x.files.map((f) => f.name).join("، ") : "—", 7), S_(c.note || "", 3)]);
    }
    const last = first + rows.length - 1, tr = last + 1;
    out.push([S_("جمع کل", 5), S_("", 5), S_("", 5), S_("", 5), S_("", 5), S_("", 5), S_("", 5), { v: total, s: 6, f: `SUM(H${first}:H${last})` }, S_("", 5), S_("", 5)]);
    out.push({ ht: 24, cells: [S_(`مبلغ به حروف: ${DongExport.words(total)} تومان`, 9), ...new Array(9).fill(S_("", 9))] });
    const merges = ["A1:J1", "A2:J2", `A${tr}:G${tr}`, `A${tr + 1}:J${tr + 1}`];
    const payers = [...new Set(rows.map((x) => x.c.payer))];
    if (payers.length) {
      out.push([]);
      const hr = out.length + 1;
      out.push([S_("طلب هر نفر از شرکت", 2), S_("", 2), S_("", 2), S_("", 2), S_("", 2), S_("", 2), S_("", 2), S_("مبلغ (تومان)", 2)]);
      merges.push(`A${hr}:G${hr}`);
      for (const id of payers) {
        const rr = out.length + 1, nm = names.get(id) || "";
        out.push([S_(nm, 3), S_("", 3), S_("", 3), S_("", 3), S_("", 3), S_("", 3), S_("", 3), { v: sum(rows.filter((x) => x.c.payer === id).map((x) => x.c.amount)), s: 4, f: `SUMIF(G${first}:G${last},"${nm.replace(/"/g, '""')}",H${first}:H${last})` }]);
        merges.push(`A${rr}:G${rr}`);
      }
    }
    return DongExport.xlsx({ name: "هزینه‌های شرکتی", title: `هزینه‌های شرکتی — ${p.title}`, rtl: true, widths: [6, 12, 30, 13, 20, 18, 14, 16, 20, 26],
      rows: out, merges, freezeRow: 4, autoFilter: `A4:J${last}`, printTitles: 4 });
  }
  function compExportBytes(pid, kind) {
    const rows = compFiles(pid), xl = compSheet(pid, rows);
    if (kind === "xlsx") return xl;
    const files = [{ name: "Company-Expenses.xlsx", data: xl }];
    for (const x of rows) for (const f of x.files) files.push({ name: "Invoices/" + f.name, data: f.bytes });
    return DongExport.zip(files);
  }
  ACT.compExport = () => {
    const pid = top().pid, list = comps(pid);
    if (!list.length) return toast("هزینهٔ شرکتی ثبت نشده.");
    if (needPro("خروجی اکسل و zip هزینه‌های شرکتی")) return;
    const nPh = sum(list.map((c) => c.photos.length));
    openSheet(`<h2>📦 خروجی هزینه‌های شرکتی</h2>
      <div class="card"><b>فایل zip کامل</b><p class="hint">اکسل ${faDigits(list.length)} ردیف با جمع کل + پوشهٔ <bdi dir="ltr">Invoices</bdi> با ${faDigits(nPh)} عکس. نام هر عکس همان شمارهٔ ردیف در اکسل است: ردیف ۳ ← <bdi dir="ltr" style="white-space:nowrap">03.jpg</bdi> (اگر چند عکس دارد <bdi dir="ltr" style="white-space:nowrap">03-1.jpg</bdi>، <bdi dir="ltr" style="white-space:nowrap">03-2.jpg</bdi>).</p>
        <div class="btns"><button type="button" class="btn primary" data-act="compOut" data-op="zip-share">📤 ارسال</button><button type="button" class="btn soft" data-act="compOut" data-op="zip-save">💾 ذخیره در گوشی</button></div></div>
      <div class="card"><b>فقط فایل اکسل</b>
        <div class="btns"><button type="button" class="btn soft" data-act="compOut" data-op="xlsx-share">📤 ارسال</button><button type="button" class="btn" data-act="compOut" data-op="xlsx-save">💾 ذخیره</button></div></div>
      <button type="button" class="btn" data-act="closeSheet">بستن</button>`);
  };
  ACT.compOut = (el) => {
    const pid = top().pid, [kind, how] = el.dataset.op.split("-");
    try {
      const bytes = compExportBytes(pid, kind), b = DongExport.b64(bytes);
      const name = `dong-company-${pid}-${todayJ().replace(/\//g, "-")}.${kind}`;
      const mime = kind === "zip" ? "application/zip" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      closeSheet();
      (how === "share" ? shareFile : saveFile)(b, mime, name);
    } catch (e) { toast("ساخت فایل ممکن نشد: " + e.message); }
  };

  // ---------------------------------------------------------------- دنگ پرو
  const PRO_FEATURES = [["🏢", "خروجی هزینه‌های شرکتی", "فایل zip با اکسل (ردیف، جمع کل، مبلغ به حروف، طلب هر نفر) و پوشهٔ عکس فاکتورها با شمارهٔ ردیف"],
    ["💳", "گزارش تنخواه", "برای هر بازهٔ زمانی: اکسل تراکنش‌ها با مانده و خلاصهٔ تنخواه + عکس‌های شماره‌دار + متن درخواست شارژ"]];
  let proPrice = null;
  // نسخهٔ وب پرداخت درون‌برنامه‌ای ندارد؛ امکانات پرو در آن (و نسخهٔ گوگل‌پلی) رایگان است
  const proFree = (() => { try { return !native || !!(native.proFree && native.proFree()); } catch (e) { return false; } })();
  const isPro = () => proFree || !!(S.pro && S.pro.active);
  const storeName = () => { try { return native && native.storeName ? native.storeName() : null; } catch (e) { return null; } };
  function needPro(feature) { if (isPro()) return false; paywall(feature); return true; }
  function paywall(feature) {
    const st = storeName();
    openSheet(`<h2>⭐ دنگ پرو</h2><div class="sheet-scroll">
      ${feature ? `<p><b>${esc(feature)}</b> از امکانات نسخهٔ پرو است.</p>` : ""}
      <p class="hint">با یک بار خرید، این امکانات برای همیشه باز می‌شود${st ? ` (روی حساب ${esc(st)} شما، حتی بعد از نصب دوباره)` : ""}:</p>
      <div class="list">${PRO_FEATURES.map(([i, t, d]) => `<div class="li"><div class="ic">${i}</div><div class="grow"><b>${t}</b><small>${d}</small></div></div>`).join("")}</div>
      <div class="pro-price" id="pro-price">${proPrice ? "قیمت: " + esc(proPrice) : ""}</div>
      ${st ? `<div class="btns"><button type="button" class="btn primary" data-act="proBuy">⭐ خرید دنگ پرو از ${esc(st)}</button></div>
        <button type="button" class="link" data-act="proRestore">قبلاً خریده‌ام؛ بازیابی خرید</button>`
        : `<div class="warn-box">خرید دنگ پرو فقط در نسخهٔ اندروید نصب‌شده از کافه‌بازار یا مایکت ممکن است.</div>`}
      <p class="hint">ثبت هزینه‌ها، هزینه‌های شرکتی و تنخواه، موجودی، هشدار شارژ و متن درخواست شارژ همچنان رایگان است؛ فقط ساخت فایل‌های گزارش پرو است.</p>
      </div><button type="button" class="btn" data-act="closeSheet">بعداً</button>`);
    if (st && !proPrice && native.proPriceQuery) { try { native.proPriceQuery(); } catch (e) { /* */ } }
  }
  ACT.proInfo = () => {
    if (!isPro()) return paywall(null);
    openSheet(`<h2>⭐ دنگ پرو فعال است</h2><p>ممنون از حمایت شما! همهٔ امکانات پرو باز است.</p>
      <div class="list">${PRO_FEATURES.map(([i, t]) => `<div class="li"><div class="ic">${i}</div><div class="grow"><b>${t}</b></div><span class="tag ok">فعال</span></div>`).join("")}</div>
      ${S.pro.at ? `<p class="hint">فعال‌سازی: ${showJ(S.pro.at)}</p>` : ""}<button type="button" class="btn" data-act="closeSheet">بستن</button>`);
  };
  ACT.proBuy = () => { try { native.buy(); toast(`در حال اتصال به ${storeName()}…`); } catch (e) { toast("خرید شروع نشد؛ دوباره امتحان کنید."); } };
  ACT.proRestore = () => { try { native.restore(false); toast("در حال بررسی خریدهای قبلی…"); } catch (e) { toast("بازیابی شروع نشد."); } };
  function activatePro(data) {
    let token = null; try { token = JSON.parse(data).purchaseToken || null; } catch (e) { /* */ }
    S.pro = { active: true, at: (S.pro && S.pro.at) || todayJ(), token };
    save();
  }
  const proTag = () => (isPro() ? "" : ` <span class="tag pro">⭐ پرو</span>`);

  // ---------------------------------------------------------------- تنخواه
  const isPetty = (p) => p && p.kind === "petty";
  const isCharge = (c) => c.kind === "charge";
  function pettyStats(p) {
    const list = comps(p.id);
    const charged = sum(list.filter(isCharge).map((c) => c.amount)), spent = sum(list.filter((c) => !isCharge(c)).map((c) => c.amount));
    const balance = charged - spent, fund = p.fund || 0, th = p.threshold || 60;
    const usedPct = fund ? Math.max(0, Math.round(((fund - balance) / fund) * 1000) / 10) : 0;
    const exp = list.filter((c) => !isCharge(c));
    return { list, charged, spent, balance, fund, th, usedPct, need: fund > 0 && usedPct >= th, suggest: Math.max(0, fund - balance),
      overLimit: p.limit ? exp.filter((c) => c.amount > p.limit).length : 0, noPhoto: exp.filter((c) => !c.photos.length).length,
      unreported: list.filter((c) => !c.reported).length };
  }
  VIEWS.pettyForm = (r) => {
    if (!r.d) {
      const p = r.pid ? store.program(r.pid) : null;
      r.d = p ? { title: p.title, date: p.date || todayJ(), company: p.company || "", card: p.card || "", fund: p.fund || null, limit: p.limit || null, threshold: p.threshold || 60 }
        : { title: "", date: todayJ(), company: "", card: "", fund: null, opening: null, limit: null, threshold: 60 };
    }
    const d = r.d, num = (v) => (v ? fmt(v) : "");
    return {
      title: r.pid ? "ویرایش تنخواه" : "تنخواه جدید",
      body: `${r.pid ? "" : `<div class="seg" style="margin-bottom:2px"><button type="button" data-act="toGroup" aria-pressed="false">👥 سفر و برنامهٔ گروهی</button><button type="button" aria-pressed="true">💳 تنخواه شرکتی</button></div>`}
        <div class="card">
          <label class="field"><span>نام تنخواه</span><input class="input" id="t-title" value="${esc(d.title)}" placeholder="مثلاً: تنخواه واحد فروش ۱۴۰۵" autocomplete="off"></label>
          <div class="field"><span>تاریخ شروع</span>${datePicker("t-date", d.date)}</div>
          <label class="field"><span>نام شرکت / سازمان</span><input class="input" id="t-company" value="${esc(d.company)}" placeholder="برای سربرگ گزارش" autocomplete="off"></label>
          <label class="field"><span>کارت تنخواه (بانک و ۴ رقم آخر)</span><input class="input" id="t-card" value="${esc(d.card)}" placeholder="مثلاً: ملت ۴۵۶۷" autocomplete="off"></label>
        </div>
        <div class="card"><h3>💳 مبلغ و سقف‌ها</h3>
          <label class="field"><span>مبلغ تنخواه (سقف موجودی کارت)</span><input class="input num" id="t-fund" inputmode="numeric" value="${num(d.fund)}" placeholder="مثلاً ۵۰ میلیون"></label>
          ${r.pid ? "" : `<label class="field"><span>موجودی فعلی کارت</span><input class="input num" id="t-open" inputmode="numeric" value="${num(d.opening)}" placeholder="خالی = همان مبلغ تنخواه"></label>`}
          <label class="field"><span>سقف هر پرداخت (اختیاری)</span><input class="input num" id="t-limit" inputmode="numeric" value="${num(d.limit)}" placeholder="مثلاً ۱۰ میلیون"></label>
          <label class="field"><span>درخواست شارژ وقتی چند درصد مصرف شد؟</span><input class="input num" id="t-th" inputmode="numeric" value="${faDigits(d.threshold)}"></label>
          <p class="hint">با رسیدن مصرف به این درصد، دنگ هشدار می‌دهد و متن درخواست شارژ و گزارش را آماده می‌کند.</p>
        </div>`,
      foot: `<button type="button" class="btn primary" data-act="savePetty">💾 ذخیره</button><button type="button" class="btn" data-act="back">انصراف</button>`,
      after() {
        for (const id of ["t-title", "t-company", "t-card", "t-fund", "t-open", "t-limit", "t-th"]) if ($(id)) $(id).addEventListener("input", () => { r.dirty = true; });
        for (const id of ["t-fund", "t-open", "t-limit"]) if ($(id)) $(id).addEventListener("blur", (e) => { const v = parseAmount(e.target.value); if (v) e.target.value = fmt(v); });
      },
    };
  };
  ACT.toGroup = () => replaceTop({ v: "progForm", pid: null });
  ACT.toPetty = () => replaceTop({ v: "pettyForm", pid: null });
  ACT.savePetty = () => {
    const r = top(), d = r.d;
    d.title = $("t-title").value.trim(); d.date = readDate("t-date");
    d.company = $("t-company").value.trim(); d.card = $("t-card").value.trim();
    d.fund = parseAmount($("t-fund").value); d.limit = parseAmount($("t-limit").value) || null;
    d.threshold = Math.min(100, Math.max(1, Math.round(L.parseNumber($("t-th").value) || 60)));
    if (!d.title) return toast("نام تنخواه را بنویسید.");
    if (!d.date) return toast("تاریخ معتبر نیست.");
    if (!d.fund) return toast("مبلغ تنخواه را وارد کنید.");
    const fields = { title: d.title, date: d.date, company: d.company, card: d.card, fund: d.fund, limit: d.limit, threshold: d.threshold, kind: "petty", work: true };
    let pid = r.pid;
    if (pid) store.updateProgram(pid, fields);
    else {
      pid = store.createProgram(ME, S.name, d.title, d.date);
      store.updateProgram(pid, Object.assign(fields, { reports: [] }));
      const open = $("t-open") ? parseAmount($("t-open").value) : null;
      addComp(pid, { kind: "charge", title: "موجودی اولیهٔ تنخواه", date: d.date, amount: open || d.fund, payer: store.program(pid).treasurer, vendor: "", invoiceNo: "", category: "", note: "", photos: [] });
    }
    save(); r.dirty = false;
    if (r.pid) { goBack(true); toast("تنخواه ذخیره شد."); }
    else { replaceTop({ v: "prog", pid, tab: "tx" }); toast("💳 تنخواه ساخته شد. هزینه‌ها را با عکس فاکتور ثبت کنید."); }
  };
  function addComp(pid, rec) {
    const seq = store.s.seq; seq.company = (seq.company || 0) + 1;
    comps().push(Object.assign({ id: seq.company, prog: pid, created: Date.now() }, rec));
    return seq.company;
  }
  function pettyView(r, p) {
    const st = pettyStats(p), pct = Math.min(100, st.usedPct), open = isOpen(p);
    let body = `<div class="card">
        <h3>${esc(p.title)}</h3>${tagsHtml(p)}
        <div class="meta"><span>📅 ${L.progDate(p)}</span>${p.company ? `<span>🏢 ${esc(p.company)}</span>` : ""}${p.card ? `<span>💳 ${esc(p.card)}</span>` : ""}</div>
        <div class="petty-bal"><span class="hint">موجودی کارت</span><b class="${st.balance < 0 ? "neg" : ""}">${fmt(st.balance)} <small>تومان</small></b></div>
        <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="درصد مصرف"><i style="width:${pct}%" class="${st.need ? "hot" : ""}"></i><s style="right:${st.th}%"></s></div>
        <div class="row hint"><span class="grow">${faDigits(L.fmtNum(st.usedPct))}٪ از ${fmt(st.fund)} مصرف شده</span><span>آستانهٔ شارژ ${faDigits(st.th)}٪</span></div>
        <div class="sum" style="margin-top:6px">
          <div><span>جمع شارژها</span><span class="num">${fmt(st.charged)}</span></div>
          <div><span>جمع هزینه‌ها (${faDigits(st.list.length - st.list.filter(isCharge).length)})</span><span class="num">${fmt(st.spent)}</span></div>
          ${p.limit ? `<div><span>سقف هر پرداخت</span><span class="num">${fmt(p.limit)}</span></div>` : ""}
        </div>
        ${st.need ? `<div class="warn-box" style="margin-top:8px">⚠️ ${faDigits(L.fmtNum(st.usedPct))}٪ تنخواه مصرف شده؛ وقت درخواست شارژ است (پیشنهاد: ${fmt(st.suggest)} تومان).</div>` : ""}
        ${st.balance < 0 ? `<div class="warn-box">موجودی منفی است؛ هزینه‌ای بیش از موجودی کارت ثبت شده.</div>` : ""}
        ${st.noPhoto ? `<div class="warn-box">${faDigits(st.noPhoto)} هزینه عکس فاکتور ندارد.</div>` : ""}
      </div>`;
    if (open) body += `<div class="btns"><button type="button" class="btn primary" data-act="addComp">＋ هزینه از تنخواه</button><button type="button" class="btn soft" data-act="addCharge">💳 ثبت شارژ</button><button type="button" class="btn soft" data-act="voiceExp">🎤 ثبت صوتی</button></div>`;
    body += `<div class="btns"><button type="button" class="btn ${st.need ? "primary" : "soft"}" data-act="pettyReport">📦 گزارش تنخواه (zip)${proTag()}</button><button type="button" class="btn" data-act="chargeRequest">📨 متن درخواست شارژ</button></div>`;
    body += `<div class="tabs" role="tablist">${[["tx", "تراکنش‌ها"], ["reports", "گزارش‌های ارسال‌شده"]].map(([k, t]) => `<button type="button" role="tab" data-act="tab" data-tab="${k}" aria-selected="${r.tab === k}">${t}</button>`).join("")}</div>`;
    if (r.tab === "reports") {
      const reps = (p.reports || []).slice().reverse();
      body += reps.length ? `<div class="list">${reps.map((x) => `<button type="button" class="li" data-act="pettyReport" data-from="${x.from}" data-to="${x.to}"><div class="ic">📦</div><div class="grow"><b>${showJ(x.from)} تا ${showJ(x.to)}</b>
          <small>ارسال ${showJ(x.at)} · ${faDigits(x.n)} ردیف · هزینه ${fmt(x.spent)}${x.charged ? " · شارژ " + fmt(x.charged) : ""}</small></div><span class="hint">دوباره</span></button>`).join("")}</div>`
        : `<div class="card empty"><div class="big">📦</div>هنوز گزارشی ارسال نشده. با «گزارش تنخواه» فایل zip بسازید و گزینهٔ «علامت گزارش‌شده» را بزنید.</div>`;
    } else {
      let bal = 0; const rows = st.list.map((c) => { bal += isCharge(c) ? c.amount : -c.amount; return { c, bal }; }).reverse();
      body += rows.length ? `<div class="list">${rows.map(({ c, bal: b }) => {
        const ch = isCharge(c), over = !ch && p.limit && c.amount > p.limit;
        return `<button type="button" class="li" data-act="openComp" data-id="${c.id}"><div class="ic${ch ? " in" : ""}">${ch ? "💳" : "🧾"}</div>
          <div class="grow"><b>${esc(c.title)}${c.photos.length ? " 📷" : ch ? "" : " ⚠️بدون عکس"}${over ? " ⚠️سقف" : ""}${c.reported ? " ✔" : ""}</b>
          <small>${showJ(c.date)}${c.vendor ? " · " + esc(c.vendor) : ""}${c.invoiceNo ? " · ش " + esc(faDigits(c.invoiceNo)) : ""} · مانده ${fmt(b)}</small></div>
          <span class="amount ${ch ? "pos" : ""}" dir="ltr">${ch ? "+" : "−"}${fmt(c.amount)}</span></button>`;
      }).join("")}</div><p class="hint">✔ = در گزارش ارسال‌شده آمده · مانده = موجودی کارت بعد از همان تراکنش</p>`
        : `<div class="card empty">هنوز تراکنشی ثبت نشده.</div>`;
    }
    return { title: p.title, sub: "💳 تنخواه · " + L.progDate(p), menu: "progMenu", body };
  }

  // ---- شارژ تنخواه
  ACT.addCharge = () => { const p = store.program(top().pid); if (!guardOpen(p)) return; const st = pettyStats(p); go({ v: "chargeForm", pid: p.id, id: null, d: { title: "شارژ تنخواه", date: todayJ(), amount: st.suggest || null, invoiceNo: "", note: "", photos: [] } }); };
  VIEWS.chargeForm = (r) => {
    const p = store.program(r.pid);
    if (!r.d) { const c = comps().find((x) => x.id === r.id); r.d = clone(c); }
    const d = r.d, st = pettyStats(p);
    return {
      title: r.id ? "ویرایش شارژ" : "ثبت شارژ تنخواه", sub: p.title,
      body: `<div class="card">
          <p class="hint">موجودی فعلی: <b>${fmt(st.balance)}</b> تومان · برای رسیدن به سقف ${fmt(st.fund)}: <b>${fmt(st.suggest)}</b></p>
          <label class="field"><span>شرح</span><input class="input" id="g-title" value="${esc(d.title)}" autocomplete="off"></label>
          <div class="field"><span>تاریخ واریز</span>${datePicker("g-date", d.date)}</div>
          <label class="field"><span>مبلغ شارژ (تومان)</span><input class="input num" id="g-amount" inputmode="numeric" value="${d.amount ? fmt(d.amount) : ""}"></label>
          <label class="field"><span>شمارهٔ سند / پیگیری (اختیاری)</span><input class="input" id="g-ref" value="${esc(d.invoiceNo || "")}" autocomplete="off"></label>
          <label class="field"><span>توضیحات (اختیاری)</span><input class="input" id="g-note" value="${esc(d.note || "")}" autocomplete="off"></label>
        </div>
        <div class="card"><h3>📷 رسید واریز (اختیاری)</h3><div class="photos" id="e-photos"></div>
          <div class="btns"><button type="button" class="btn soft" data-act="camera">📷 دوربین</button><button type="button" class="btn" data-act="gallery">🖼 گالری</button></div></div>
        ${r.id ? `<button type="button" class="btn danger" data-act="delComp">🗑 حذف این شارژ</button>` : ""}`,
      foot: `<button type="button" class="btn primary" data-act="saveCharge">💾 ذخیره</button><button type="button" class="btn" data-act="back">انصراف</button>`,
      after() {
        drawPhotos();
        for (const id of ["g-title", "g-amount", "g-ref", "g-note"]) $(id).addEventListener("input", () => { r.dirty = true; });
        $("g-amount").addEventListener("blur", (e) => { const v = parseAmount(e.target.value); if (v) e.target.value = fmt(v); });
      },
    };
  };
  ACT.saveCharge = () => {
    const r = top(), d = r.d;
    const rec = { kind: "charge", title: $("g-title").value.trim() || "شارژ تنخواه", date: readDate("g-date"), amount: parseAmount($("g-amount").value),
      invoiceNo: L.toEn($("g-ref").value.trim()), note: $("g-note").value.trim(), photos: clone(d.photos), vendor: "", category: "", payer: store.program(r.pid).treasurer };
    if (!rec.date) return toast("تاریخ معتبر نیست.");
    if (!rec.amount) return toast("مبلغ شارژ را وارد کنید.");
    if (r.id) Object.assign(comps().find((x) => x.id === r.id), rec); else addComp(r.pid, rec);
    save(); r.dirty = false; goBack(true); toast(r.id ? "شارژ ویرایش شد." : "💳 شارژ ثبت شد.");
  };

  // ---- درخواست شارژ
  function chargeRequestText(p) {
    const st = pettyStats(p), names = namesOf(p.id), holder = names.get(p.treasurer) || S.name || "";
    const last = st.list.filter(isCharge).slice(-1)[0];
    const since = last ? st.list.filter((c) => !isCharge(c) && (c.date > last.date || (c.date === last.date && c.id > last.id))) : [];
    return [`موضوع: درخواست شارژ تنخواه${p.card ? " — کارت " + p.card : ""}`, "",
      `${p.company ? "واحد محترم مالی " + p.company : "واحد محترم مالی"}`, "با سلام و احترام،", "",
      `به استحضار می‌رساند از مبلغ تنخواه ${fmt(st.fund)} تومان، تا تاریخ ${showJ(todayJ())} مبلغ ${fmt(st.fund - st.balance > 0 ? st.fund - st.balance : 0)} تومان مصرف شده و موجودی فعلی کارت ${fmt(st.balance)} تومان (${faDigits(L.fmtNum(st.usedPct))}٪ مصرف) است.`,
      since.length ? `از آخرین شارژ (${showJ(last.date)}) تعداد ${faDigits(since.length)} هزینه به مبلغ ${fmt(sum(since.map((c) => c.amount)))} تومان پرداخت شده است.` : "",
      `خواهشمند است دستور فرمایید کارت تنخواه به مبلغ ${fmt(st.suggest)} تومان (${DongExport.words(st.suggest)} تومان) شارژ گردد.`,
      "گزارش اکسل هزینه‌ها و تصاویر فاکتورها به پیوست تقدیم می‌شود.", "", "با تشکر", `تنخواه‌گردان: ${holder}`, `تاریخ: ${showJ(todayJ())}`].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  }
  ACT.chargeRequest = () => {
    const p = store.program(top().pid), t = chargeRequestText(p);
    openSheet(`<h2>📨 درخواست شارژ تنخواه</h2><div class="sheet-scroll"><pre class="invoice">${esc(t)}</pre></div>
      <div class="btns"><button type="button" class="btn primary" data-act="chargeReqShare">📤 ارسال</button><button type="button" class="btn soft" data-act="chargeReqCopy">📋 کپی</button></div>
      <button type="button" class="btn" data-act="closeSheet">بستن</button>`);
  };
  ACT.chargeReqShare = () => shareText(chargeRequestText(store.program(top().pid)));
  ACT.chargeReqCopy = () => copyText(chargeRequestText(store.program(top().pid)));

  // ---- گزارش تنخواه (بازهٔ زمانی)
  ACT.pettyReport = (el) => {
    const p = store.program(top().pid), st = pettyStats(p);
    if (!st.list.length) return toast("تراکنشی ثبت نشده.");
    if (needPro("گزارش تنخواه")) return;
    const reps = p.reports || [], lastTo = reps.length ? reps[reps.length - 1].to : null;
    const first = st.list[0].date, unrep = st.list.filter((c) => !c.reported);
    const from = (el && el.dataset.from) || (unrep.length ? unrep[0].date : lastTo || first), to = (el && el.dataset.to) || todayJ();
    openSheet(`<h2>📦 گزارش تنخواه</h2><div class="sheet-scroll">
      <div class="field"><span>از تاریخ</span>${datePicker("r-from", from)}</div>
      <div class="field"><span>تا تاریخ</span>${datePicker("r-to", to > from ? to : from)}</div>
      <div class="chips" style="margin:6px 0"><button type="button" class="chip" data-act="repRange" data-k="unrep">گزارش‌نشده‌ها</button><button type="button" class="chip" data-act="repRange" data-k="month">این ماه</button><button type="button" class="chip" data-act="repRange" data-k="all">همه</button></div>
      <div id="r-info" class="hint"></div>
      <label class="check"><input type="checkbox" id="r-mark"${el && el.dataset.from ? "" : " checked"}> بعد از ساخت فایل، این ردیف‌ها «گزارش‌شده» علامت بخورند</label>
      <div class="card"><b>فایل zip کامل</b><p class="hint">اکسل تراکنش‌ها با مانده، جمع‌ها و خلاصه + پوشهٔ <bdi dir="ltr">Invoices</bdi> با عکس‌های شماره‌گذاری‌شده مطابق ردیف اکسل + متن درخواست شارژ.</p>
        <div class="btns"><button type="button" class="btn primary" data-act="repOut" data-op="zip-share">📤 ارسال</button><button type="button" class="btn soft" data-act="repOut" data-op="zip-save">💾 ذخیره</button></div></div>
      <div class="btns"><button type="button" class="btn soft" data-act="repOut" data-op="xlsx-share">📊 فقط اکسل · ارسال</button><button type="button" class="btn" data-act="repOut" data-op="xlsx-save">📊 فقط اکسل · ذخیره</button></div>
      </div><button type="button" class="btn" data-act="closeSheet">بستن</button>`);
    const info = () => {
      const f = readDate("r-from"), t = readDate("r-to"); if (!f || !t) { $("r-info").textContent = "تاریخ معتبر نیست."; return; }
      const rows = st.list.filter((c) => c.date >= f && c.date <= t), ex = rows.filter((c) => !isCharge(c));
      $("r-info").innerHTML = `${faDigits(rows.length)} تراکنش در این بازه · هزینه ${fmt(sum(ex.map((c) => c.amount)))} · ${faDigits(sum(rows.map((c) => c.photos.length)))} عکس${ex.some((c) => !c.photos.length) ? ` · <span style="color:var(--warn)">${faDigits(ex.filter((c) => !c.photos.length).length)} هزینه بدون عکس</span>` : ""}`;
    };
    $("r-from").onchange = info; $("r-to").onchange = info; info();
    ACT.repRange = (b) => {
      const set = (id, v) => { const [y, m, d] = v.split("/").map(Number), box = $(id); box.querySelector('[data-dp="y"]').value = y; box.querySelector('[data-dp="m"]').value = m; box.querySelector('[data-dp="d"]').value = d; };
      const today = todayJ(), k = b.dataset.k;
      if (k === "all") { set("r-from", first); set("r-to", today); }
      else if (k === "month") { set("r-from", today.slice(0, 8) + "01"); set("r-to", today); }
      else { set("r-from", unrep.length ? unrep[0].date : today); set("r-to", today); }
      info();
    };
  };
  ACT.repOut = (el) => {
    const pid = top().pid, p = store.program(pid), f = readDate("r-from"), t = readDate("r-to");
    if (!f || !t) return toast("تاریخ معتبر نیست.");
    if (f > t) return toast("«از تاریخ» بعد از «تا تاریخ» است.");
    const rows = comps(pid).filter((c) => c.date >= f && c.date <= t);
    if (!rows.length) return toast("در این بازه تراکنشی نیست.");
    const [kind, how] = el.dataset.op.split("-"), mark = $("r-mark").checked;
    try {
      const files = numberedFiles(rows), xl = pettySheet(p, f, t, files);
      let bytes = xl;
      if (kind === "zip") {
        const z = [{ name: "Petty-Cash-Report.xlsx", data: xl }, { name: "Charge-Request.txt", data: "﻿" + chargeRequestText(p).replace(/\n/g, "\r\n") }];
        for (const x of files) for (const fl of x.files) z.push({ name: "Invoices/" + fl.name, data: fl.bytes });
        bytes = DongExport.zip(z);
      }
      const name = `petty-${pid}-${f.replace(/\//g, "")}-${t.replace(/\//g, "")}.${kind}`;
      const mime = kind === "zip" ? "application/zip" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (mark) {
        const ex = rows.filter((c) => !isCharge(c));
        const rep = { id: (p.reports || []).reduce((a, x) => Math.max(a, x.id), 0) + 1, from: f, to: t, at: todayJ(), n: rows.length, spent: sum(ex.map((c) => c.amount)), charged: sum(rows.filter(isCharge).map((c) => c.amount)) };
        p.reports = (p.reports || []).filter((x) => !(x.from === f && x.to === t)).concat([rep]);
        for (const c of rows) c.reported = rep.id;
        save();
      }
      closeSheet(); render(false);
      (how === "share" ? shareFile : saveFile)(DongExport.b64(bytes), mime, name);
    } catch (e) { toast("ساخت فایل ممکن نشد: " + e.message); }
  };
  /** شماره‌گذاری عکس‌ها مطابق ردیف اکسل */
  function numberedFiles(list) {
    const w = Math.max(2, String(list.length).length);
    return list.map((c, i) => {
      const no = String(i + 1).padStart(w, "0");
      const files = c.photos.map(([fid], j) => { const b = DongExport.dataUrlBytes(photos[fid]); return b ? { name: `${no}${c.photos.length > 1 ? "-" + (j + 1) : ""}.${b.ext}`, bytes: b.bytes } : null; }).filter(Boolean);
      return { c, row: i + 1, files };
    });
  }
  function pettySheet(p, from, to, rows) {
    const names = namesOf(p.id), S_ = (v, s) => ({ v, s }), E = (s) => S_("", s);
    const all = comps(p.id), before = all.filter((c) => c.date < from);
    const opening = sum(before.map((c) => (isCharge(c) ? c.amount : -c.amount)));
    const charged = sum(rows.filter((x) => isCharge(x.c)).map((x) => x.c.amount)), spent = sum(rows.filter((x) => !isCharge(x.c)).map((x) => x.c.amount));
    const closing = opening + charged - spent, fund = p.fund || 0;
    const head = ["ردیف", "تاریخ", "نوع", "شرح", "دسته", "طرف حساب", "شماره فاکتور / قبض / سند", "واریز (شارژ)", "برداشت (هزینه)", "مانده", "عکس (پوشه Invoices)", "توضیحات"];
    const out = [], merges = ["A1:L1", "A2:L2"];
    out.push({ ht: 28, cells: [S_(`گزارش تنخواه — ${p.title}`, 1)] });
    out.push([S_([p.company && "شرکت: " + p.company, "تنخواه‌گردان: " + (names.get(p.treasurer) || ""), p.card && "کارت: " + p.card, `بازه: ${from} تا ${to}`, "تاریخ تهیه: " + todayJ()].filter(Boolean).join("   |   "), 8)]);
    out.push([]);
    out.push({ ht: 30, cells: head.map((h) => S_(h, 2)) });
    out.push([S_("مانده ابتدای دوره", 9), E(9), E(9), E(9), E(9), E(9), E(9), E(9), E(9), S_(opening, 6), E(9), E(9)]); merges.push("A5:I5");
    let bal = opening, r0 = 6;
    rows.forEach((x, i) => {
      const c = x.c, ch = isCharge(c), rr = r0 + i; bal += ch ? c.amount : -c.amount;
      const over = !ch && p.limit && c.amount > p.limit;
      out.push([S_(x.row, 7), S_(c.date, 7), S_(ch ? "شارژ" : "هزینه", 7), S_(c.title, 3), S_(c.category || "", 3), S_(c.vendor || "", 3), S_(c.invoiceNo || "", 7),
        ch ? S_(c.amount, 4) : E(4), ch ? E(4) : S_(c.amount, 4), { v: bal, s: 4, f: `J${rr - 1}+H${rr}-I${rr}` },
        S_(x.files.length ? x.files.map((f) => f.name).join("، ") : ch ? "" : "— بدون عکس", 7), S_([over ? "بیش از سقف هر پرداخت" : "", c.note || ""].filter(Boolean).join(" · "), 3)]);
    });
    const last = r0 + rows.length - 1, tr = last + 1;
    out.push([S_("جمع دوره", 5), E(5), E(5), E(5), E(5), E(5), E(5), { v: charged, s: 6, f: `SUM(H${r0}:H${last})` }, { v: spent, s: 6, f: `SUM(I${r0}:I${last})` }, { v: closing, s: 6, f: `J5+H${tr}-I${tr}` }, E(5), E(5)]);
    merges.push(`A${tr}:G${tr}`);
    out.push([]);
    const sumRow = (label, v, f) => { const rr = out.length + 1; out.push([S_(label, 9), E(9), E(9), E(9), E(9), E(9), E(9), { v, s: 6, f }]); merges.push(`A${rr}:G${rr}`); };
    const h0 = out.length + 1; out.push([S_("خلاصهٔ تنخواه", 2), E(2), E(2), E(2), E(2), E(2), E(2), S_("مبلغ (تومان)", 2)]); merges.push(`A${h0}:G${h0}`);
    sumRow("مبلغ تنخواه (سقف کارت)", fund);
    sumRow("مانده ابتدای دوره", opening, "J5");
    sumRow("جمع شارژهای دوره", charged, `H${tr}`);
    sumRow("جمع هزینه‌های دوره", spent, `I${tr}`);
    sumRow("مانده پایان دوره", closing, `J${tr}`);
    sumRow(`درصد مصرف از مبلغ تنخواه (آستانهٔ شارژ ${p.threshold || 60}٪)`, fund ? Math.round(((fund - closing) / fund) * 1000) / 10 : 0);
    sumRow("مبلغ پیشنهادی برای شارژ", Math.max(0, fund - closing));
    { const rr = out.length + 1; out.push({ ht: 24, cells: [S_(`جمع هزینه‌ها به حروف: ${DongExport.words(spent)} تومان`, 9), ...new Array(7).fill(E(9))] }); merges.push(`A${rr}:H${rr}`); }
    const cats = new Map(); for (const x of rows) if (!isCharge(x.c)) { const k = x.c.category || "بدون دسته"; const o = cats.get(k) || [0, 0]; o[0]++; o[1] += x.c.amount; cats.set(k, o); }
    if (cats.size) {
      out.push([]);
      const hr = out.length + 1; out.push([S_("هزینه به تفکیک دسته", 2), E(2), E(2), E(2), E(2), E(2), S_("تعداد", 2), S_("مبلغ (تومان)", 2)]); merges.push(`A${hr}:F${hr}`);
      for (const [k, [n, v]] of [...cats].sort((a, b) => b[1][1] - a[1][1])) { const rr = out.length + 1; out.push([S_(k, 3), E(3), E(3), E(3), E(3), E(3), S_(n, 7), S_(v, 4)]); merges.push(`A${rr}:F${rr}`); }
    }
    out.push([]); out.push([]);
    { const rr = out.length + 1; out.push({ ht: 40, cells: [S_("امضای تنخواه‌گردان:", 3), E(3), E(3), E(3), E(3), E(3), S_("تأیید واحد مالی:", 3), E(3), E(3), E(3), E(3), E(3)] }); merges.push(`A${rr}:F${rr}`, `G${rr}:L${rr}`); }
    // درصد مصرف عدد اعشاری است؛ قالب عدد صحیح دارد — به‌صورت متن بنویس
    for (const row of out) { const cells = row && (row.cells || row); if (cells && cells[0] && String(cells[0].v).startsWith("درصد مصرف")) cells[7] = S_(L.fmtNum(cells[7].v).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)) + "٪", 6); }
    return DongExport.xlsx({ name: "تنخواه", title: `گزارش تنخواه — ${p.title}`, rtl: true, widths: [6, 12, 8, 28, 13, 18, 18, 15, 15, 15, 18, 24],
      rows: out, merges, freezeRow: 4, autoFilter: `A4:L${last}`, printTitles: 4 });
  }

  ACT.addInc = () => { const p = store.program(top().pid); if (!guardOpen(p)) return; if (store.members(p.id).length < 2) return toast("اول اعضای برنامه را اضافه کنید."); go({ v: "incForm", pid: p.id, no: null }); };
  ACT.openTx = (el) => go({ v: "tx", pid: top().pid, no: +el.dataset.no });
  ACT.editProg = () => go({ v: isPetty(store.program(top().pid)) ? "pettyForm" : "progForm", pid: top().pid });
  ACT.table = () => go({ v: "table", pid: top().pid });
  ACT.invoices = () => go({ v: "invoices", pid: top().pid });
  function guardOpen(p) { if (isOpen(p)) return true; toast("🔒 برنامه تمام‌شده و قفل است. برای تغییر، از منوی ⋮ بازگشایی کنید."); return false; }
  ACT.progMenu = () => {
    const p = store.program(top().pid);
    openSheet(`<h2>${esc(p.title)}</h2><div class="menu-list">
      ${isOpen(p) ? `<button type="button" data-act="editProg">✏️ ویرایش مشخصات و اعضا</button><button type="button" data-act="finishProg">🏁 پایان برنامه (قفل ویرایش)</button>`
        : `<button type="button" data-act="reopenProg">🔓 بازگشایی برنامه</button>`}
      ${isPetty(p) ? `<button type="button" data-act="pettyReport">📦 گزارش تنخواه</button><button type="button" data-act="chargeRequest">📨 متن درخواست شارژ</button>` : `<button type="button" data-act="table">📊 جدول کامل</button>`}
      <button type="button" class="danger" data-act="delProg">🗑 حذف برنامه</button></div>
      <button type="button" class="btn" data-act="closeSheet">بستن</button>`);
  };
  ACT.finishProg = () => confirmSheet("پایان برنامه؟", "با پایان برنامه، ثبت و ویرایش تراکنش‌ها و اعضا قفل می‌شود. هر وقت لازم شد می‌توانید بازگشایی کنید.", "بله، پایان برنامه", () => {
    store.updateProgram(top().pid, { status: "closed" }); save(); render(false); toast("🏁 برنامه تمام شد و قفل شد.");
  });
  ACT.reopenProg = () => confirmSheet("بازگشایی برنامه؟", "با بازگشایی، ویرایش تراکنش‌ها و اعضا دوباره ممکن می‌شود.", "بله، بازگشایی", () => {
    store.updateProgram(top().pid, { status: "open" }); save(); render(false); toast("🔓 برنامه بازگشایی شد.");
  });
  ACT.delProg = () => confirmSheet("حذف برنامه؟", "همه تراکنش‌های این برنامه هم حذف می‌شود و قابل برگشت نیست.", "بله، حذف شود", () => {
    const dp = top().pid; store.s.company = comps().filter((c) => c.prog !== dp);
    store.deleteProgram(dp); save(); stack = [{ v: "home" }]; render(true); toast("برنامه حذف شد.");
  }, true);

  // ---------------------------------------------------------------- تاریخ شمسی (انتخابگر)
  function datePicker(id, value) {
    const [y, m, d] = (value || todayJ()).split("/").map(Number);
    const years = []; for (let i = 1398; i <= 1412; i++) years.push(i);
    return `<div class="grid3" id="${id}">
      <select class="select" data-dp="d" aria-label="روز">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${i + 1 === d ? " selected" : ""}>${faDigits(i + 1)}</option>`).join("")}</select>
      <select class="select" data-dp="m" aria-label="ماه">${L.JMONTHS.map((n, i) => `<option value="${i + 1}"${i + 1 === m ? " selected" : ""}>${n}</option>`).join("")}</select>
      <select class="select" data-dp="y" aria-label="سال">${years.map((v) => `<option value="${v}"${v === y ? " selected" : ""}>${faDigits(v)}</option>`).join("")}</select>
    </div><button type="button" class="link" data-act="today" data-dp="${id}">📅 امروز (${showJ(todayJ())})</button>`;
  }
  function readDate(id) {
    const el = $(id), g = (k) => +el.querySelector(`[data-dp="${k}"]`).value;
    const y = g("y"), m = g("m"), d = g("d");
    if (d > (m <= 6 ? 31 : 30)) return null;
    return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
  }
  ACT.today = (el) => {
    const [y, m, d] = todayJ().split("/").map(Number), box = $(el.dataset.dp);
    box.querySelector('[data-dp="y"]').value = y; box.querySelector('[data-dp="m"]').value = m; box.querySelector('[data-dp="d"]').value = d;
    top().dirty = true;
  };

  // ---------------------------------------------------------------- فرم برنامه (ساخت/ویرایش)
  let keySeq = 0;
  VIEWS.progForm = (r) => {
    if (!r.d) {
      const self = me();
      if (r.pid) {
        const p = store.program(r.pid);
        r.d = { title: p.title, date: p.date || todayJ(), treasurer: "p" + p.treasurer, work: !!p.work, company: p.company || "",
          members: store.members(p.id).map((m) => ({ k: "p" + m.id, pid: m.id, name: m.name, phone: m.phone, self: m.isSelf, used: store.memberUsed(p.id, m.id) })) };
      } else {
        r.d = { title: "", date: todayJ(), treasurer: "p" + self.id, work: false, company: "", members: [{ k: "p" + self.id, pid: self.id, name: self.name, phone: self.phone, self: true }] };
      }
    }
    const d = r.d;
    return {
      title: r.pid ? "ویرایش برنامه" : "برنامه جدید",
      body: `${r.pid ? "" : `<div class="seg" style="margin-bottom:2px"><button type="button" aria-pressed="true">👥 سفر و برنامهٔ گروهی</button><button type="button" data-act="toPetty" aria-pressed="false">💳 تنخواه شرکتی</button></div>`}<div class="card">
          <label class="field"><span>نام برنامه</span><input class="input" id="f-title" value="${esc(d.title)}" placeholder="مثلاً: برنامه شما تابستان ۱۴۰۵" autocomplete="off"></label>
          <div class="field"><span>تاریخ برنامه</span>${datePicker("f-date", d.date)}</div>
        </div>
        <div class="card">
          <h3>👥 اعضا</h3>
          <div class="chips" id="f-members"></div>
          <div class="btns"><button type="button" class="btn soft" data-act="contacts">📇 انتخاب از مخاطبین گوشی</button></div>
          <div class="row"><input class="input grow" id="f-add" placeholder="یا نام‌ها را بنویسید: علی، محمد ۰۹۱۲…" autocomplete="off"><button type="button" class="btn small primary" data-act="addNames">افزودن</button></div>
          <p class="hint">چند نام را با «،» جدا کنید. شماره موبایل اختیاری است. اعضای دارای تراکنش حذف نمی‌شوند.</p>
          <label class="field"><span>👑 مادرخرج</span><select class="select" id="f-treas"></select></label>
        </div>
        <div class="card"><h3>🏢 ماموریت کاری</h3>
          <label class="check"><input type="checkbox" id="f-work"${d.work ? " checked" : ""}> بعضی هزینه‌ها را شرکت برمی‌گرداند</label>
          <label class="field" id="f-company-box"${d.work ? "" : " hidden"}><span>نام شرکت / سازمان (برای سربرگ اکسل)</span><input class="input" id="f-company" value="${esc(d.company)}" placeholder="اختیاری" autocomplete="off"></label>
          <p class="hint">هزینه‌های شرکتی در فهرست جدا ثبت می‌شوند، در دنگ اعضا حساب نمی‌شوند و با یک دکمه همراه عکس فاکتورها به‌صورت اکسل و zip خروجی می‌گیرند.</p>
        </div>`,
      foot: `<button type="button" class="btn primary" data-act="saveProg">💾 ذخیره</button><button type="button" class="btn" data-act="back">انصراف</button>`,
      after() {
        drawMembers();
        $("f-title").oninput = (e) => { d.title = e.target.value; r.dirty = true; };
        $("f-date").onchange = () => { r.dirty = true; };
        $("f-treas").onchange = (e) => { d.treasurer = e.target.value; r.dirty = true; };
        $("f-work").onchange = (e) => { d.work = e.target.checked; $("f-company-box").hidden = !d.work; r.dirty = true; };
        $("f-company").oninput = (e) => { d.company = e.target.value; r.dirty = true; };
        $("f-add").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); ACT.addNames(); } };
      },
    };
  };
  function drawMembers() {
    const d = top().d;
    $("f-members").innerHTML = d.members.map((m) => `<span class="chip">${m.k === d.treasurer ? "👑 " : ""}${esc(m.name)}${m.self ? " (شما)" : ""}${m.phone && m.phone !== m.name ? ` <small dir="ltr">${esc(m.phone)}</small>` : ""}
      ${m.self || m.used ? "" : `<button type="button" class="x" data-act="rmMember" data-k="${m.k}" aria-label="حذف ${esc(m.name)}">✕</button>`}</span>`).join("");
    $("f-treas").innerHTML = d.members.map((m) => `<option value="${m.k}"${m.k === d.treasurer ? " selected" : ""}>${esc(m.name)}</option>`).join("");
  }
  function addDraftMembers(list) {
    const d = top().d;
    let added = 0;
    for (const { name, phone } of list) {
      const nm = (name || phone || "").trim();
      if (!nm) continue;
      const ph = phone ? (L.normalizePhone(phone) || phone) : null;
      if (d.members.some((m) => (ph && m.phone === ph) || (!ph && m.name === nm))) continue;
      d.members.push({ k: "n" + (++keySeq), pid: null, name: nm, phone: ph, self: false });
      added++;
    }
    top().dirty = true;
    drawMembers();
    if (added) toast(`${faDigits(added)} نفر اضافه شد.`);
  }
  ACT.addNames = () => {
    const v = $("f-add").value.trim();
    if (!v) return;
    const list = v.split(/[،,\n؛;]+/).map((s) => s.trim()).filter(Boolean).map((chunk) => { const [name, phone] = L.splitNamePhone(chunk); return { name: name || phone, phone }; });
    $("f-add").value = "";
    addDraftMembers(list);
  };
  ACT.rmMember = (el) => { const d = top().d; d.members = d.members.filter((m) => m.k !== el.dataset.k); if (d.treasurer === el.dataset.k) d.treasurer = d.members[0].k; top().dirty = true; drawMembers(); };
  ACT.contacts = () => openContacts(addDraftMembers);
  ACT.saveProg = () => {
    const r = top(), d = r.d;
    d.title = $("f-title").value.trim();
    const date = readDate("f-date");
    if (!d.title) return toast("نام برنامه را بنویسید.");
    if (!date) return toast("تاریخ معتبر نیست (نیمه دوم سال ۳۰ روز دارد).");
    if (d.members.length < 2) return toast("حداقل یک همسفر اضافه کنید.");
    let pid = r.pid;
    if (!pid) pid = store.createProgram(ME, S.name, d.title, date);
    else store.updateProgram(pid, { title: d.title, date });
    const keyToPid = {};
    for (const m of d.members) {
      const person = m.pid ? store.person(m.pid) : store.addPerson(ME, m.name, m.phone, null);
      keyToPid[m.k] = person.id;
      store.addMember(pid, person.id);
    }
    if (r.pid) {
      const keep = new Set(Object.values(keyToPid));
      for (const m of store.members(pid)) if (!keep.has(m.id)) store.removeMember(pid, m.id);
    }
    store.updateProgram(pid, { treasurer: keyToPid[d.treasurer] || me().id, work: !!d.work || comps(pid).length > 0, company: (d.company || "").trim() });
    save();
    r.dirty = false;
    if (r.pid) { goBack(true); toast("برنامه ذخیره شد."); }
    else { replaceTop({ v: "prog", pid, tab: "tx" }); toast("برنامه ساخته شد. حالا هزینه‌ها را ثبت کنید."); }
  };

  // ---------------------------------------------------------------- فرم هزینه
  VIEWS.expForm = (r) => {
    const p = store.program(r.pid), ms = store.members(r.pid);
    if (!r.d) {
      if (r.no) {
        const t = store.tx(r.pid, r.no);
        const bd = L.breakdown(Object.assign(clone(t), { paid: 0 }));
        r.d = { title: t.title, date: t.date || todayJ(), payer: t.payer, items: clone(t.items), discount: t.discount || 0, vat: t.vat || 0,
          paidSame: t.paid === bd.invoice, paid: t.paid, photos: clone(t.photos) };
      } else {
        r.d = { title: "", date: todayJ(), payer: p.treasurer, items: [], discount: 0, vat: 0, paidSame: true, paid: null, photos: [] };
      }
    }
    const d = r.d;
    const vatMode = [0, 9, 10].includes(d.vat) ? String(d.vat) : "x";
    return {
      title: r.no ? "ویرایش هزینه" : "ثبت هزینه",
      sub: p.title,
      body: `<div class="card">
          <label class="field"><span>عنوان</span><input class="input" id="e-title" value="${esc(d.title)}" placeholder="مثلاً: شام شب اول" autocomplete="off"></label>
          <div class="field"><span>تاریخ</span>${datePicker("e-date", d.date)}</div>
          <label class="field"><span>پرداخت‌کننده</span><select class="select" id="e-payer">${ms.map((m) => `<option value="${m.id}"${m.id === d.payer ? " selected" : ""}>${m.id === p.treasurer ? "👑 " : ""}${esc(m.name)}</option>`).join("")}</select></label>
        </div>
        <div class="card"><h3>🧾 اقلام فاکتور</h3>
          <div class="list" id="e-items"></div>
          <div class="btns"><button type="button" class="btn soft" data-act="addItem" data-kind="unit">＋ قلم با فی</button><button type="button" class="btn soft" data-act="addItem" data-kind="fixed">＋ مبلغ کل (تقسیم مساوی)</button></div>
          <p class="hint">فی: همان مبلغ برای هر نفر (اگر کسی دو عدد گرفته، دوبار روی نامش بزنید). مبلغ کل: بین افراد انتخاب‌شده مساوی تقسیم می‌شود، مثل سرویس یا کرایه.</p>
        </div>
        <div class="card"><h3>🏷 تخفیف و ارزش افزوده</h3>
          <label class="field"><span>مبلغ تخفیف کل فاکتور (اختیاری)</span><input class="input num" id="e-disc" inputmode="numeric" value="${d.discount ? fmt(d.discount) : ""}" placeholder="۰"></label>
          <div class="field"><span>ارزش افزوده (روی مبلغ پس از تخفیف)</span>
            <div class="seg" id="e-vat">${[["0", "ندارد"], ["9", "۹٪"], ["10", "۱۰٪"], ["x", "سایر"]].map(([k, t]) => `<button type="button" data-v="${k}" aria-pressed="${vatMode === k}">${t}</button>`).join("")}</div>
            <input class="input num" id="e-vatx" inputmode="decimal" placeholder="درصد" value="${vatMode === "x" ? faDigits(d.vat) : ""}"${vatMode === "x" ? "" : " hidden"}></div>
          <p class="hint">تخفیف بین افراد همین فاکتور مساوی تقسیم می‌شود.</p>
        </div>
        <div class="card"><h3>📷 عکس فاکتور</h3><div class="photos" id="e-photos"></div>
          <div class="btns"><button type="button" class="btn soft" data-act="camera">📷 دوربین</button><button type="button" class="btn" data-act="gallery">🖼 گالری</button></div></div>
        <div class="card"><h3>💰 جمع و مبلغ پرداختی</h3><div id="e-sum"></div>
          <label class="check"><input type="checkbox" id="e-same"${d.paidSame ? " checked" : ""}> مبلغ پرداختی همان جمع فاکتور است</label>
          <label class="field" id="e-paid-box"${d.paidSame ? " hidden" : ""}><span>مبلغی که واقعاً پرداخت شد</span><input class="input num" id="e-paid" inputmode="numeric" value="${d.paid && !d.paidSame ? fmt(d.paid) : ""}"></label>
          <div id="e-diff"></div>
          <details><summary class="hint">سهم هر نفر</summary><div class="list" id="e-shares"></div></details>
        </div>`,
      foot: `<button type="button" class="btn primary" data-act="saveExp">💾 ذخیره هزینه</button><button type="button" class="btn" data-act="back">انصراف</button>`,
      after() {
        drawItems(); drawPhotos(); updateSummary();
        const dirty = () => { r.dirty = true; };
        $("e-title").oninput = (e) => { d.title = e.target.value; dirty(); };
        $("e-date").onchange = dirty;
        $("e-payer").onchange = (e) => { d.payer = +e.target.value; dirty(); };
        $("e-disc").oninput = (e) => { d.discount = parseAmount(e.target.value) || 0; dirty(); updateSummary(); };
        $("e-vat").onclick = (e) => {
          const b = e.target.closest("[data-v]"); if (!b) return;
          $("e-vat").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
          $("e-vatx").hidden = b.dataset.v !== "x";
          d.vat = b.dataset.v === "x" ? (L.parseNumber($("e-vatx").value) || 0) : +b.dataset.v;
          dirty(); updateSummary();
        };
        $("e-vatx").oninput = (e) => { const v = L.parseNumber(e.target.value); d.vat = v && v > 0 && v <= 100 ? v : 0; dirty(); updateSummary(); };
        $("e-same").onchange = (e) => { d.paidSame = e.target.checked; $("e-paid-box").hidden = d.paidSame; dirty(); updateSummary(); };
        $("e-paid").oninput = (e) => { d.paid = parseAmount(e.target.value); dirty(); updateSummary(); };
        $("e-items").addEventListener("input", (e) => {
          const box = e.target.closest("[data-i]"), f = e.target.dataset.f; if (!box || !f) return;
          const it = d.items[+box.dataset.i];
          if (f === "name") it.name = e.target.value;
          if (f === "price") { it.price = parseAmount(e.target.value) || 0; box.querySelector(".line").textContent = itemLine(it); }
          dirty(); updateSummary();
        });
        $("e-items").addEventListener("focusout", (e) => { if (e.target.dataset.f === "price") { const v = parseAmount(e.target.value); if (v) e.target.value = fmt(v); } });
        for (const id of ["e-disc", "e-paid"]) $(id).addEventListener("blur", (e) => { const v = parseAmount(e.target.value); if (v) e.target.value = fmt(v); });
      },
    };
  };
  function itemLine(it) {
    const q = L.itemQty(it);
    if (!q) return "⚠️ هنوز کسی انتخاب نشده";
    return it.kind === UNIT ? `${faDigits(q)} عدد × ${fmt(it.price || 0)} = ${fmt(L.itemTotal(it))}` : `${fmt(it.price || 0)} ÷ ${faDigits(q)} نفر ≈ ${fmt(Math.floor((it.price || 0) / q))} برای هر نفر`;
  }
  function drawItems() {
    const r = top(), d = r.d, ms = store.members(r.pid);
    $("e-items").innerHTML = d.items.length ? d.items.map((it, i) => {
      const al = new Map(it.alloc);
      return `<div class="item" data-i="${i}">
        <div class="row"><input class="input grow" data-f="name" value="${esc(it.name)}" placeholder="عنوان قلم (مثلاً چلو جوجه)" autocomplete="off"><button type="button" class="icon-btn" style="color:var(--warn)" data-act="delItem" data-i="${i}" aria-label="حذف قلم">🗑</button></div>
        <div class="seg"><button type="button" data-act="itemKind" data-i="${i}" data-k="unit" aria-pressed="${it.kind === UNIT}">🍽 فی (برای هر نفر)</button><button type="button" data-act="itemKind" data-i="${i}" data-k="fixed" aria-pressed="${it.kind === FIXED}">🧾 مبلغ کل (مساوی)</button></div>
        <label class="field"><span>${it.kind === UNIT ? "فی (قیمت یک واحد)" : "مبلغ کل"}</span><input class="input num" data-f="price" inputmode="numeric" value="${it.price ? fmt(it.price) : ""}" placeholder="مثلاً ۱۲۰۰۰۰۰ یا ۱٫۲ میلیون"></label>
        <div class="chips">${ms.map((m) => { const q = al.get(m.id) || 0; return `<button type="button" class="chip" data-act="itemPerson" data-i="${i}" data-p="${m.id}" aria-pressed="${q > 0}">${esc(m.name)}${it.kind === UNIT && q > 1 ? ` ×${faDigits(q)}` : ""}</button>`; }).join("")}</div>
        <div class="row hint"><span class="grow line">${itemLine(it)}</span><button type="button" class="link" data-act="itemAll" data-i="${i}">همه</button><span>·</span><button type="button" class="link" data-act="itemNone" data-i="${i}">هیچ‌کس</button></div>
      </div>`;
    }).join("") : `<p class="hint">هنوز قلمی اضافه نشده. اگر فاکتور ریز ندارد، یک «مبلغ کل» اضافه کنید.</p>`;
  }
  ACT.addItem = (el) => {
    const r = top(), d = r.d, kind = el.dataset.kind === "unit" ? UNIT : FIXED;
    let alloc = [];
    if (kind === FIXED) {
      const seen = []; for (const it of d.items) for (const [p, q] of it.alloc) if (q && !seen.includes(p)) seen.push(p);
      alloc = (seen.length ? seen : store.members(r.pid).map((m) => m.id)).map((p) => [p, 1]);
    }
    d.items.push({ name: !d.items.length && kind === FIXED ? d.title : "", kind, price: 0, alloc });
    r.dirty = true; drawItems(); updateSummary();
    const last = $("e-items").lastElementChild; if (last) { last.scrollIntoView({ block: "center", behavior: "smooth" }); const inp = last.querySelector(d.items.at(-1).name ? '[data-f="price"]' : '[data-f="name"]'); if (inp) inp.focus(); }
  };
  ACT.delItem = (el) => { const r = top(); r.d.items.splice(+el.dataset.i, 1); r.dirty = true; drawItems(); updateSummary(); };
  ACT.itemKind = (el) => {
    const r = top(), it = r.d.items[+el.dataset.i];
    it.kind = el.dataset.k === "unit" ? UNIT : FIXED;
    if (it.kind === FIXED) it.alloc = it.alloc.filter(([, q]) => q).map(([p]) => [p, 1]);
    r.dirty = true; drawItems(); updateSummary();
  };
  ACT.itemPerson = (el) => {
    const r = top(), it = r.d.items[+el.dataset.i], pid = +el.dataset.p, al = new Map(it.alloc);
    let q = al.get(pid) || 0;
    q = it.kind === UNIT ? (q + 1) % 6 : q ? 0 : 1;
    if (q) al.set(pid, q); else al.delete(pid);
    it.alloc = [...al]; r.dirty = true; drawItems(); updateSummary();
  };
  ACT.itemAll = (el) => { const r = top(); r.d.items[+el.dataset.i].alloc = store.members(r.pid).map((m) => [m.id, 1]); r.dirty = true; drawItems(); updateSummary(); };
  ACT.itemNone = (el) => { const r = top(); r.d.items[+el.dataset.i].alloc = []; r.dirty = true; drawItems(); updateSummary(); };
  function draftTx(d, paid) {
    return { title: d.title, payer: d.payer, paid, vat: d.vat || 0, discount: d.discount || 0, kind: EXPENSE, receiver: null, date: d.date, photos: d.photos,
      items: d.items.map((it) => ({ name: it.name || "قلم", kind: it.kind, price: it.price || 0, alloc: it.alloc })) };
  }
  function updateSummary() {
    const r = top(), d = r.d, names = namesOf(r.pid);
    const bd0 = L.breakdown(draftTx(d, 0));
    const paid = d.paidSame ? bd0.invoice : (d.paid || 0);
    const rows = [`<div><span>جمع اقلام</span><span class="num">${fmt(bd0.subtotal)}</span></div>`];
    if (bd0.discount) rows.push(`<div><span>🏷 تخفیف</span><span class="num">−${fmt(bd0.discount)}</span></div>`, `<div><span>پس از تخفیف</span><span class="num">${fmt(bd0.subtotal - bd0.discount)}</span></div>`);
    if (bd0.vat) rows.push(`<div><span>💯 ارزش افزوده ${L.fmtNum(d.vat)}٪</span><span class="num">${fmt(bd0.vat)}</span></div>`);
    rows.push(`<div class="total"><span>جمع فاکتور</span><span class="num">${fmt(bd0.invoice)} تومان</span></div>`);
    $("e-sum").innerHTML = `<div class="sum">${rows.join("")}</div>`;
    let diff = "";
    if ((d.discount || 0) > bd0.subtotal && bd0.subtotal) diff = `<div class="warn-box">تخفیف از جمع اقلام بیشتر است.</div>`;
    else if (!d.paidSame && paid && bd0.invoice) {
      const x = paid - bd0.invoice;
      diff = x ? `<div class="warn-box">مبلغ پرداختی ${fmt(Math.abs(x))} تومان ${x < 0 ? "کمتر" : "بیشتر"} از جمع فاکتور است. اگر درست است، اختلاف به نسبت سهم هر نفر پخش می‌شود.</div>`
        : `<div class="ok-box">✅ مبلغ پرداختی با جمع فاکتور برابر است.</div>`;
    }
    $("e-diff").innerHTML = diff;
    const bd = L.breakdown(draftTx(d, paid));
    $("e-shares").innerHTML = bd.shares.size ? [...bd.shares].map(([p, v]) => `<div class="row"><span class="grow">${esc(names.get(p))}</span><span class="amount">${fmt(v)}</span></div>`).join("") : `<span class="hint">—</span>`;
  }
  ACT.saveExp = () => {
    const r = top(), d = r.d;
    d.title = $("e-title").value.trim();
    d.date = readDate("e-date");
    if (!d.title) return toast("عنوان هزینه را بنویسید.");
    if (!d.date) return toast("تاریخ معتبر نیست.");
    if (!d.items.length) return toast("حداقل یک قلم اضافه کنید.");
    for (const [i, it] of d.items.entries()) {
      if (!it.price) return toast(`مبلغ قلم ${faDigits(i + 1)} را وارد کنید.`);
      if (!L.itemQty(it)) return toast(`برای قلم ${faDigits(i + 1)} افراد را انتخاب کنید.`);
      if (!it.name.trim()) it.name = it.kind === FIXED && d.items.length === 1 ? d.title : `قلم ${faDigits(i + 1)}`;
    }
    const bd0 = L.breakdown(draftTx(d, 0));
    if ((d.discount || 0) > bd0.subtotal) return toast("تخفیف از جمع اقلام بیشتر است.");
    const paid = d.paidSame ? bd0.invoice : d.paid;
    if (!paid) return toast("مبلغ پرداختی را وارد کنید.");
    const tx = draftTx(d, paid);
    tx.photos = clone(d.photos);
    let no = r.no;
    if (no) store.updateTx(r.pid, no, tx); else no = store.saveTx(r.pid, tx);
    save(); r.dirty = false;
    replaceTop({ v: "tx", pid: r.pid, no });
    toast(r.no ? "هزینه ویرایش شد." : "هزینه ثبت شد.");
  };

  // ---------------------------------------------------------------- فرم دریافتی
  VIEWS.incForm = (r) => {
    const p = store.program(r.pid), ms = store.members(r.pid);
    if (!r.d) {
      if (r.no) { const t = store.tx(r.pid, r.no); r.d = { payer: t.payer, receiver: t.receiver, paid: t.paid, date: t.date || todayJ(), photos: clone(t.photos) }; }
      else r.d = { payer: (ms.find((m) => m.id !== p.treasurer) || ms[0]).id, receiver: p.treasurer, paid: null, date: todayJ(), photos: [] };
    }
    const d = r.d;
    const opts = (sel) => ms.map((m) => `<option value="${m.id}"${m.id === sel ? " selected" : ""}>${m.id === p.treasurer ? "👑 " : ""}${esc(m.name)}</option>`).join("");
    return {
      title: r.no ? "ویرایش دریافتی" : "ثبت دریافتی از عضو",
      sub: p.title,
      body: `<div class="card">
          <p class="hint">پولی که یکی از اعضا در طول برنامه به مادرخرج می‌دهد؛ از بدهی او کم می‌شود.</p>
          <div class="grid2"><label class="field"><span>از (واریزکننده)</span><select class="select" id="i-from">${opts(d.payer)}</select></label>
          <label class="field"><span>به (گیرنده)</span><select class="select" id="i-to">${opts(d.receiver)}</select></label></div>
          <label class="field"><span>مبلغ</span><input class="input num" id="i-amt" inputmode="numeric" value="${d.paid ? fmt(d.paid) : ""}" placeholder="مثلاً ۱ میلیون"></label>
          <div class="field"><span>تاریخ</span>${datePicker("i-date", d.date)}</div>
        </div>
        <div class="card"><h3>📷 عکس رسید (اختیاری)</h3><div class="photos" id="e-photos"></div>
          <div class="btns"><button type="button" class="btn soft" data-act="camera">📷 دوربین</button><button type="button" class="btn" data-act="gallery">🖼 گالری</button></div></div>`,
      foot: `<button type="button" class="btn primary" data-act="saveInc">💾 ذخیره</button><button type="button" class="btn" data-act="back">انصراف</button>`,
      after() {
        drawPhotos();
        const dirty = () => { r.dirty = true; };
        $("i-from").onchange = (e) => { d.payer = +e.target.value; dirty(); };
        $("i-to").onchange = (e) => { d.receiver = +e.target.value; dirty(); };
        $("i-amt").oninput = (e) => { d.paid = parseAmount(e.target.value); dirty(); };
        $("i-amt").onblur = (e) => { const v = parseAmount(e.target.value); if (v) e.target.value = fmt(v); };
        $("i-date").onchange = dirty;
      },
    };
  };
  ACT.saveInc = () => {
    const r = top(), d = r.d, names = namesOf(r.pid);
    d.date = readDate("i-date");
    if (d.payer === d.receiver) return toast("واریزکننده و گیرنده نباید یک نفر باشند.");
    if (!d.paid) return toast("مبلغ را وارد کنید.");
    if (!d.date) return toast("تاریخ معتبر نیست.");
    const tx = { title: `واریز ${names.get(d.payer)}`, payer: d.payer, paid: d.paid, vat: 0, discount: 0, items: [], kind: INCOME, receiver: d.receiver, date: d.date, photos: clone(d.photos) };
    let no = r.no;
    if (no) store.updateTx(r.pid, no, tx); else no = store.saveTx(r.pid, tx);
    save(); r.dirty = false;
    replaceTop({ v: "tx", pid: r.pid, no });
    toast(r.no ? "دریافتی ویرایش شد." : "دریافتی ثبت شد.");
  };

  // ---------------------------------------------------------------- عکس‌ها
  function drawPhotos() {
    const d = top().d;
    $("e-photos").innerHTML = d.photos.length ? d.photos.map(([fid], i) => `<div class="ph">${photos[fid] ? `<img src="${photos[fid]}" alt="عکس ${faDigits(i + 1)}" data-act="viewPhoto" data-fid="${fid}">` : "📷"}<button type="button" class="del" data-act="rmPhoto" data-i="${i}" aria-label="حذف عکس">✕</button></div>`).join("")
      : `<span class="hint">عکسی اضافه نشده.</span>`;
  }
  ACT.rmPhoto = (el) => { const r = top(); r.d.photos.splice(+el.dataset.i, 1); r.dirty = true; drawPhotos(); };
  ACT.viewPhoto = (el) => openSheet(`<img class="photo-full" src="${photos[el.dataset.fid]}" alt="عکس فاکتور"><button type="button" class="btn" data-act="closeSheet">بستن</button>`);
  ACT.camera = () => {
    if (native && native.takePhoto) { try { native.takePhoto(); return; } catch (e) { /* */ } }
    $("file").setAttribute("capture", "environment"); $("file").click();
  };
  ACT.gallery = () => { $("file").removeAttribute("capture"); $("file").click(); };
  function addPhoto(url) {
    const r = top();
    if (!r.d || !r.d.photos) return toast("برای افزودن عکس، فرم هزینه یا دریافتی را باز کنید.");
    const fid = "ph" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    putPhoto(fid, url);
    r.d.photos.push([fid, "photo"]); r.dirty = true;
    drawPhotos(); toast("📷 عکس اضافه شد.");
  }
  $("file").onchange = (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 1400 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        addPhoto(cv.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => toast("این فایل تصویر نیست.");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  // ---------------------------------------------------------------- جزئیات تراکنش
  VIEWS.tx = (r) => {
    const p = store.program(r.pid), t = store.tx(r.pid, r.no);
    if (!t) { stack.pop(); return VIEWS[top().v](top()); }
    const names = namesOf(r.pid);
    let body;
    if (t.kind === INCOME) {
      body = `<div class="card"><h3>💵 ${esc(t.title)}</h3><div class="meta"><span>📅 ${showJ(t.date)}</span></div>
        <div class="row"><span class="grow">${esc(names.get(t.payer))} ← به ${esc(names.get(t.receiver))}</span><span class="amount">${fmt(t.paid)} تومان</span></div>
        <p class="hint">این مبلغ از بدهی ${esc(names.get(t.payer))} کم شده است.</p></div>`;
    } else {
      const bd = L.breakdown(t);
      const tags = [];
      if (t.discount) tags.push(`<span class="tag open">🏷 تخفیف ${fmt(t.discount)}</span>`);
      if (t.vat) tags.push(`<span class="tag open">💯 ارزش افزوده ${L.fmtNum(t.vat)}٪</span>`);
      if (bd.diff) tags.push(`<span class="tag lock">اختلاف ${L.fmtSigned(bd.diff)}</span>`);
      body = `<div class="card"><h3>🧾 ${esc(t.title)}</h3>${tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}
          <div class="meta"><span>📅 ${showJ(t.date)}</span><span>👤 پرداخت: ${esc(names.get(t.payer))}</span></div>
          <div class="row"><span class="grow hint">مبلغ پرداختی</span><span class="amount">${fmt(t.paid)} تومان</span></div></div>
        <div class="card">${L.programTable(p, [...bd.shares.keys()], [t], names, false, `جدول «${t.title}»`)}
          <div class="btns"><button type="button" class="btn primary" data-act="shareTxTable">↗ اشتراک / ذخیره جدول</button></div></div>`;
    }
    if (t.photos.length) body += `<div class="card"><h3>📷 عکس‌ها</h3><div class="photos">${t.photos.map(([fid], i) => `<button type="button" class="ph" data-act="viewPhoto" data-fid="${fid}">${photos[fid] ? `<img src="${photos[fid]}" alt="عکس ${faDigits(i + 1)}">` : "📷"}</button>`).join("")}</div></div>`;
    if (!isOpen(p)) body += `<p class="hint">🔒 برنامه تمام‌شده؛ ویرایش قفل است.</p>`;
    return {
      title: t.kind === INCOME ? "دریافتی" : "هزینه", sub: `${p.title} · #${faDigits(t.no)}`, body,
      foot: isOpen(p) ? `<button type="button" class="btn primary" data-act="editTx">✏️ ویرایش</button><button type="button" class="btn danger" data-act="delTx">🗑 حذف</button>` : null,
    };
  };
  ACT.editTx = () => { const r = top(), t = store.tx(r.pid, r.no); go({ v: t.kind === INCOME ? "incForm" : "expForm", pid: r.pid, no: r.no }); };
  ACT.delTx = () => confirmSheet("حذف تراکنش؟", "این تراکنش برای همیشه حذف می‌شود.", "بله، حذف شود", () => {
    const r = top(); store.deleteTx(r.pid, r.no); save(); goBack(true); toast("تراکنش حذف شد.");
  }, true);
  ACT.shareTxTable = () => {
    const r = top(), p = store.program(r.pid), t = store.tx(r.pid, r.no), names = namesOf(r.pid);
    const data = L.tableData(p, [...L.breakdown(t).shares.keys()], [t], names, false, `«${t.title}» — ${showJ(t.date)} — ${p.title}`);
    tableShareSheet(data, `dong-p${p.id}-tx${t.no}`);
  };

  // ---------------------------------------------------------------- جدول کامل
  VIEWS.table = (r) => {
    const p = store.program(r.pid), names = namesOf(r.pid), mids = store.members(r.pid).map((m) => m.id), txs = store.txs(r.pid);
    return {
      title: "جدول دنگ", sub: p.title,
      body: txs.length ? `<div class="card">${L.programTable(p, mids, txs, names)}</div><p class="hint">اعضا در ستون‌ها، مخارج در سطرها. برای دیدن همه ستون‌ها جدول را به چپ بکشید.</p>`
        : `<div class="card empty">هنوز تراکنشی ثبت نشده.</div>`,
      foot: txs.length ? `<button type="button" class="btn primary" data-act="shareFull">↗ اشتراک / ذخیره جدول</button>` : null,
    };
  };
  ACT.shareFull = () => {
    const r = top(), p = store.program(r.pid);
    tableShareSheet(L.tableData(p, store.members(r.pid).map((m) => m.id), store.txs(r.pid), namesOf(r.pid)), `dong-p${p.id}-table`);
  };

  // ---------------------------------------------------------------- صورت‌حساب‌ها
  VIEWS.invoices = (r) => {
    const p = store.program(r.pid), names = namesOf(r.pid), txs = store.txs(r.pid);
    const list = store.members(r.pid).map((m) => [m, L.personInvoiceText(m.id, p, txs, names)]).filter(([, t]) => t);
    return {
      title: "صورت‌حساب‌ها", sub: p.title,
      body: (list.length ? `<p class="hint">صورت‌حساب هر نفر را کپی کنید یا مستقیم برایش بفرستید.</p>` : `<div class="card empty">هنوز صورت‌حسابی نیست.</div>`) +
        list.map(([m, html]) => `<div class="card"><div class="pre">${html}</div>
          <div class="btns"><button type="button" class="btn small soft" data-act="copyInv" data-p="${m.id}">📋 کپی متن</button><button type="button" class="btn small primary" data-act="shareInv" data-p="${m.id}">↗ اشتراک‌گذاری</button></div></div>`).join(""),
      foot: list.length ? `<button type="button" class="btn" data-act="shareAllInv">↗ اشتراک همه صورت‌حساب‌ها با هم</button>` : null,
    };
  };
  const plain = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent; };
  function invoiceText(pid, personId) { const p = store.program(pid); return plain(L.personInvoiceText(personId, p, store.txs(pid), namesOf(pid)) || ""); }
  ACT.copyInv = (el) => copyText(invoiceText(top().pid, +el.dataset.p));
  ACT.shareInv = (el) => shareText(invoiceText(top().pid, +el.dataset.p));
  ACT.shareAllInv = () => {
    const r = top();
    shareText(store.members(r.pid).map((m) => invoiceText(r.pid, m.id)).filter(Boolean).join("\n\n"));
  };

  // ---------------------------------------------------------------- تسویه کلی
  VIEWS.global = (r) => {
    if (!r.kind) r.kind = "group";
    const allP = sortPrograms(store.programs(ME));
    const progs = allP.filter((p) => (r.kind === "all" ? true : r.kind === "petty" ? isPetty(p) : !isPetty(p)));
    if (!r.selBy) r.selBy = {};
    if (!r.selBy[r.kind]) r.selBy[r.kind] = progs.filter((p) => !p.settled).map((p) => p.id);
    if (!r.mode) r.mode = "pair";
    const sel = r.selBy[r.kind];
    const hint = { group: "برنامه‌های گروهی را که می‌خواهید با هم تسویه شوند انتخاب کنید؛ هر برنامه می‌تواند مادرخرج خودش را داشته باشد.",
      petty: "وضعیت تسویهٔ هر تنخواه با شرکت: موجودی کارت، شارژها، هزینه‌ها و ردیف‌هایی که هنوز گزارش نشده‌اند.",
      all: "همهٔ حساب‌ها با هم: تسویه بین اعضای برنامه‌های گروهی، طلب از شرکت بابت هزینه‌های شرکتی، و موجودی تنخواه‌ها." }[r.kind];
    let body = `<div class="seg" id="g-kind">${[["group", "👥 برنامه‌های گروهی"], ["petty", "💳 تنخواه"], ["all", "🔗 همه با هم"]].map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${r.kind === k}">${t}</button>`).join("")}</div>
      <p class="hint">${hint}</p>`;
    if (!progs.length) body += `<div class="card empty">${r.kind === "petty" ? "هنوز تنخواهی ندارید." : "هنوز برنامه‌ای ندارید."}</div>`;
    body += `<div class="list">${progs.map((p) => `<label class="pick"><input type="checkbox" data-gsel="${p.id}"${sel.includes(p.id) ? " checked" : ""}><span class="grow"><b>${isPetty(p) ? "💳 " : ""}${esc(p.title)}</b><br><small class="hint">${L.progDate(p)}${isPetty(p) ? ` · موجودی ${fmt(pettyStats(p).balance)}` : ` · 👑 ${esc(namesOf(p.id).get(p.treasurer) || "")}`}${p.settled ? " · ✔️ تسویه‌شده" : ""}</small></span></label>`).join("")}</div>`;
    const chosen = sel.map((id) => store.program(id)).filter(Boolean);
    if (chosen.length) {
      const groups = chosen.filter((p) => !isPetty(p)), pettys = chosen.filter(isPetty);
      if (r.kind !== "petty" && groups.length) body += `<div class="seg" id="g-mode"><button type="button" data-m="pair" aria-pressed="${r.mode === "pair"}">به تفکیک مادرخرج‌ها</button><button type="button" data-m="min" aria-pressed="${r.mode === "min"}">کمترین تعداد انتقال</button></div>`;
      body += `<div class="card"><div class="pre" id="g-out">${esc(globalAllText(groups, pettys, r.kind, r.mode))}</div></div>`;
    }
    return {
      title: "تسویه حساب کلی", body,
      foot: chosen.length ? `<button type="button" class="btn primary" data-act="shareGlobal">↗ اشتراک نتیجه</button><button type="button" class="btn" data-act="settleGlobal">✔️ ثبت تسویه</button>` : null,
      after() {
        $("view").querySelectorAll("[data-gsel]").forEach((c) => (c.onchange = () => {
          const id = +c.dataset.gsel; r.selBy[r.kind] = c.checked ? [...r.selBy[r.kind], id] : r.selBy[r.kind].filter((x) => x !== id); render(false);
        }));
        $("g-kind").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { r.kind = b.dataset.k; render(false); } };
        if ($("g-mode")) $("g-mode").onclick = (e) => { const b = e.target.closest("[data-m]"); if (b) { r.mode = b.dataset.m; render(false); } };
      },
    };
  };
  function globalAllText(groups, pettys, kind, mode) {
    const out = [], names = new Map(store.persons(ME).map((x) => [x.id, x.name])), myId = me().id, line = "━━━━━━━━━━━━";
    let myGroup = 0;
    if (kind !== "petty" && groups.length) {
      const input = groups.map((p) => [p, store.members(p.id).map((m) => m.id), store.txs(p.id)]);
      const tx = L.globalText(input, names, mode).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      if (kind === "all") out.push("👥 برنامه‌های گروهی", line);
      out.push(tx.trim());
      for (const p of groups) {
        const mids = store.members(p.id).map((m) => m.id);
        if (!mids.includes(myId)) continue;
        const b = L.balances(store.txs(p.id), mids).get(myId);
        if (b) myGroup += L.net(b);
      }
    }
    // حساب با شرکت‌ها: هزینه‌های شرکتی (طلب پرداخت‌کننده) و موجودی تنخواه (نزد تنخواه‌گردان)
    const byCo = new Map(); // company → Map(person → net)  (+ = شرکت بدهکار به فرد)
    const add = (co, pid, v) => { const k = co || "شرکت"; if (!byCo.has(k)) byCo.set(k, new Map()); const m = byCo.get(k); m.set(pid, (m.get(pid) || 0) + v); };
    if (kind === "all") for (const p of groups) for (const c of comps(p.id)) if (!isCharge(c)) add(p.company, c.payer, c.amount);
    const pettyLines = [];
    for (const p of pettys) {
      const st = pettyStats(p), holder = p.treasurer, unrep = st.list.filter((c) => !c.reported && !isCharge(c));
      pettyLines.push(`🔹 ${p.title}${p.company ? " — " + p.company : ""}`,
        `   مبلغ تنخواه ${fmt(st.fund)} · شارژها ${fmt(st.charged)} · هزینه‌ها ${fmt(st.spent)}`,
        `   موجودی کارت: ${fmt(st.balance)} تومان (${faDigits(L.fmtNum(st.usedPct))}٪ مصرف)`,
        st.balance > 0 ? `   ← ${fmt(st.balance)} تومان پول ${p.company || "شرکت"} نزد ${names.get(holder) || "تنخواه‌گردان"} است (هنگام بستن تنخواه برگردانده شود).`
          : st.balance < 0 ? `   ← ${p.company || "شرکت"} باید ${fmt(-st.balance)} تومان به ${names.get(holder) || "تنخواه‌گردان"} بپردازد.` : "   ← تسویه است.",
        unrep.length ? `   ⚠️ ${faDigits(unrep.length)} هزینه به مبلغ ${fmt(sum(unrep.map((c) => c.amount)))} هنوز گزارش نشده.` : "   ✔ همهٔ هزینه‌ها گزارش شده‌اند.", "");
      add(p.company, holder, -st.balance);
    }
    if (pettyLines.length) { if (out.length) out.push("", ""); out.push("💳 تنخواه‌ها", line, ...pettyLines);
      if (pettys.length > 1) out.push(`جمع موجودی کارت‌ها: ${fmt(sum(pettys.map((p) => pettyStats(p).balance)))} تومان`); }
    let myCo = 0;
    if (kind === "all" && byCo.size) {
      out.push("", "", "🏢 حساب با شرکت‌ها", line);
      for (const [co, m] of byCo) {
        out.push(`🔹 ${co}`);
        for (const [pid, v] of m) {
          if (pid === myId) myCo += v;
          if (!v) continue;
          out.push(v > 0 ? `   ${co} → به ${names.get(pid) || "?"}: ${fmt(v)}` : `   ${names.get(pid) || "?"} → به ${co}: ${fmt(-v)}`);
        }
      }
    }
    if (kind === "all") {
      const tot = myGroup + myCo, nm = names.get(myId) || "شما";
      out.push("", "", `📌 خلاصهٔ ${nm}`, line,
        `از برنامه‌های گروهی: ${myGroup > 0 ? "طلبکار " + fmt(myGroup) : myGroup < 0 ? "بدهکار " + fmt(-myGroup) : "تسویه"}`,
        `با شرکت‌ها: ${myCo > 0 ? "طلبکار " + fmt(myCo) : myCo < 0 ? "بدهکار " + fmt(-myCo) : "تسویه"}`,
        `جمع: ${tot > 0 ? "طلبکار " + fmt(tot) : tot < 0 ? "بدهکار " + fmt(-tot) : "تسویه"} تومان`);
    }
    return out.join("\n");
  }
  ACT.shareGlobal = () => shareText($("g-out").textContent);
  ACT.settleGlobal = () => {
    const r = top(), sel = r.selBy[r.kind];
    confirmSheet("ثبت تسویه؟", `${faDigits(sel.length)} برنامه به‌عنوان تسویه‌شده علامت می‌خورد و قفل می‌شود.`, "بله، تسویه شد", () => {
      const now = Math.floor(Date.now() / 1000);
      for (const id of sel) store.updateProgram(id, { settled: now, status: "closed" });
      save(); goBack(true); toast("✔️ تسویه ثبت شد.");
    });
  };

  // ============================================================ اشتراک و ذخیره
  let toastTimer;
  function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3000); }
  function copyText(text) {
    if (native && native.copy) { try { native.copy(text); toast("📋 متن کپی شد."); return; } catch (e) { /* */ } }
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("📋 متن کپی شد."); } catch (e) { toast("کپی نشد."); }
    ta.remove();
  }
  function shareText(text) {
    if (native && native.share) { try { native.share(text); return; } catch (e) { /* */ } }
    if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
    copyText(text);
  }
  const b64utf8 = (s) => btoa(unescape(encodeURIComponent(s)));
  function browserFile(b64, mime, name, doShare) {
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], name, { type: mime });
    if (doShare && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file] }).catch(() => {}); return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function shareFile(b64, mime, name) { if (native && native.shareFile) { try { native.shareFile(b64, mime, name); return; } catch (e) { /* */ } } browserFile(b64, mime, name, true); }
  function saveFile(b64, mime, name) { if (native && native.saveFile) { try { native.saveFile(b64, mime, name); return; } catch (e) { /* */ } } browserFile(b64, mime, name, false); }

  function csvOf(data) {
    const q = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [[data.title], data.head, ...data.rows.map((r) => (r.title ? [r.title] : r.cells))];
    return "﻿" + lines.map((l) => l.map(q).join(",")).join("\r\n");
  }
  async function pngOf(data) {
    try { await document.fonts.load('700 24px "Vazirmatn"'); await document.fonts.load('400 24px "Vazirmatn"'); } catch (e) { /* */ }
    const F = '"Vazirmatn", Tahoma, sans-serif';
    const c = document.createElement("canvas"), x = c.getContext("2d");
    const C = { bg: "#ffffff", fg: "#15201e", muted: "#5b6c68", line: "#d6e0dc", accent: "#0a7570", soft: "#dff1ed", ok: "#dcf2e5", gold: "#fff6df", stripe: "#f6faf9", neg: "#b3261e" };
    const cellText = (v) => (typeof v === "number" ? (v ? fmt(v) : "—") : String(v));
    const width = (t, bold) => { x.font = `${bold ? 700 : 400} 24px ${F}`; return x.measureText(t).width; };
    const n = data.head.length, w = new Array(n).fill(0);
    data.head.forEach((t, i) => { w[i] = Math.max(w[i], width(t, true)); });
    for (const r of data.rows) if (!r.title) r.cells.forEach((v, i) => { w[i] = Math.max(w[i], width(cellText(v), r.cls)); });
    w[0] = Math.min(w[0], 520);
    const cw = w.map((v) => Math.ceil(v) + 36), PAD = 28, RH = 50, HH = 56, TOP = 92, FOOT = 56;
    const W = Math.max(sum(cw) + PAD * 2, 560), H = TOP + HH + data.rows.length * RH + FOOT;
    c.width = W; c.height = H;
    x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
    x.direction = "rtl"; x.textBaseline = "middle";
    x.fillStyle = C.accent; x.font = `800 30px ${F}`; x.textAlign = "right";
    x.fillText("📊 " + data.title, W - PAD, 48, W - PAD * 2);
    const right0 = W - PAD;
    const drawRow = (y, h, cells, opts) => {
      let r = right0;
      cells.forEach((v, i) => {
        const t = cellText(v);
        x.font = `${opts.bold ? 700 : 400} 24px ${F}`;
        x.fillStyle = opts.color || (typeof v === "number" && v < 0 ? C.neg : C.fg);
        if (i === 0) { x.textAlign = "right"; let s = t; while (x.measureText(s).width > cw[0] - 30 && s.length > 2) s = s.slice(0, -2) + "…"; x.fillText(s, r - 16, y + h / 2); }
        else { x.textAlign = "center"; x.fillText(t, r - cw[i] / 2, y + h / 2); }
        r -= cw[i];
      });
    };
    let y = TOP;
    x.fillStyle = C.accent; x.fillRect(PAD, y, W - PAD * 2, HH);
    drawRow(y, HH, data.head, { bold: true, color: "#ffffff" });
    y += HH;
    data.rows.forEach((r, idx) => {
      const fill = r.cls === "t" || r.cls === "s" ? C.soft : r.cls === "i" ? C.ok : r.cls === "g" ? C.gold : idx % 2 ? C.stripe : C.bg;
      x.fillStyle = fill; x.fillRect(PAD, y, W - PAD * 2, RH);
      if (r.title) { x.font = `700 24px ${F}`; x.fillStyle = C.fg; x.textAlign = "right"; x.fillText(r.title, right0 - 16, y + RH / 2, W - PAD * 2 - 32); }
      else drawRow(y, RH, r.cells, { bold: !!r.cls });
      x.fillStyle = C.line; x.fillRect(PAD, y + RH - 1, W - PAD * 2, 1);
      y += RH;
    });
    x.fillStyle = C.muted; x.font = `400 20px ${F}`; x.textAlign = "right";
    x.fillText(`ساخته‌شده با اپلیکیشن دنگ · ${showJ(todayJ())}`, W - PAD, H - FOOT / 2);
    return c.toDataURL("image/png");
  }
  function tableShareSheet(data, base) {
    openSheet(`<h2>اشتراک یا ذخیره جدول</h2><p>${esc(data.title)}</p><div class="menu-list">
      <button type="button" data-act="tbl" data-op="share-png">🖼 ارسال به‌صورت عکس (واتساپ، تلگرام…)</button>
      <button type="button" data-act="tbl" data-op="share-csv">📄 ارسال فایل اکسل (CSV)</button>
      <button type="button" data-act="tbl" data-op="save-png">💾 ذخیره عکس جدول در گوشی</button>
      <button type="button" data-act="tbl" data-op="save-csv">💾 ذخیره فایل اکسل در گوشی</button></div>
      <button type="button" class="btn" data-act="closeSheet">بستن</button>`);
    tableShareSheet.current = { data, base };
  }
  ACT.tbl = async (el) => {
    const { data, base } = tableShareSheet.current, [op, kind] = el.dataset.op.split("-");
    closeSheet();
    let b64, mime, name;
    if (kind === "png") { toast("در حال ساخت عکس جدول…"); b64 = (await pngOf(data)).split(",")[1]; mime = "image/png"; name = base + ".png"; }
    else { b64 = b64utf8(csvOf(data)); mime = "text/csv"; name = base + ".csv"; }
    (op === "share" ? shareFile : saveFile)(b64, mime, name);
  };

  // ============================================================ برگه‌ها
  function openSheet(html) { $("sheet").innerHTML = html; $("overlay").hidden = false; }
  function closeSheet() { $("overlay").hidden = true; $("sheet").innerHTML = ""; }
  ACT.closeSheet = closeSheet;
  $("overlay").addEventListener("click", (e) => { if (e.target.id === "overlay" && S.name) closeSheet(); });
  function confirmSheet(title, text, yes, fn, danger) {
    openSheet(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="btns"><button type="button" class="btn ${danger ? "danger" : "primary"}" id="cf-yes">${esc(yes)}</button><button type="button" class="btn" data-act="closeSheet">انصراف</button></div>`);
    $("cf-yes").onclick = () => { closeSheet(); fn(); };
    return true;
  }

  // ---- مخاطبین گوشی
  const foldFa = (t) => L.toEn(String(t || "")).replace(/ي/g, "ی").replace(/ك/g, "ک").toLowerCase();
  let onPick = null;
  function manualContact() {
    openSheet(`<h2>افزودن مخاطب</h2>
      <label class="field"><span>نام</span><input class="input" id="c-name" autocomplete="off"></label>
      <label class="field"><span>شماره موبایل (اختیاری)</span><input class="input ltr" id="c-phone" inputmode="tel" placeholder="09…" autocomplete="off"></label>
      <div class="btns"><button type="button" class="btn primary" id="c-ok">افزودن</button><button type="button" class="btn" data-act="closeSheet">انصراف</button></div>`);
    $("c-ok").onclick = () => {
      const name = $("c-name").value.trim(), phone = $("c-phone").value.trim();
      if (!name && !phone) return toast("نام یا شماره را وارد کنید.");
      closeSheet(); if (onPick) onPick([{ name, phone }]);
    };
  }
  function openContacts(cb) {
    onPick = cb;
    if (!native || !native.pickContacts) return manualContact();
    openSheet(`<h2>مخاطبین گوشی</h2><p>در حال خواندن مخاطبین…</p>`);
    try { native.pickContacts(); } catch (e) { manualContact(); }
  }
  function contactsDenied(text) {
    openSheet(`<h2>مخاطبین گوشی</h2><p>${text}</p><div class="btns"><button type="button" class="btn primary" id="ct-retry">دوباره تلاش کن</button><button type="button" class="btn" id="ct-manual">ورود دستی</button></div>`);
    $("ct-retry").onclick = () => openContacts(onPick);
    $("ct-manual").onclick = manualContact;
  }
  function contactsPicker(list) {
    const seen = new Set(), items = [];
    for (const [name, phone] of list) {
      if (!phone) continue;
      const p = L.normalizePhone(phone) || L.toEn(phone).replace(/[^\d+]/g, "");
      const key = foldFa(name) + "|" + p;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ name: (name || p).trim(), phone: p, key, hay: foldFa(name) + " " + p });
    }
    const chosen = new Set();
    openSheet(`<h2>مخاطبین گوشی</h2>
      <input class="input" id="ct-q" type="search" placeholder="جستجوی نام یا شماره…" autocomplete="off">
      <div class="ct-list" id="ct-list"></div>
      <div class="btns"><button type="button" class="btn primary" id="ct-add" disabled>افزودن</button><button type="button" class="btn" id="ct-manual">ورود دستی</button><button type="button" class="btn" data-act="closeSheet">انصراف</button></div>`);
    const draw = () => {
      const q = foldFa($("ct-q").value.trim());
      const hits = q ? items.filter((it) => it.hay.includes(q)) : items, shown = hits.slice(0, 250);
      $("ct-list").innerHTML = shown.length
        ? shown.map((it) => `<label class="pick"><input type="checkbox" data-k="${esc(it.key)}"${chosen.has(it.key) ? " checked" : ""}><span class="ct-name">${esc(it.name)}</span><span class="ct-phone" dir="ltr">${esc(it.phone)}</span></label>`).join("") +
          (hits.length > shown.length ? `<p>${faDigits(hits.length - shown.length)} مخاطب دیگر؛ برای دیدن، جستجو کنید.</p>` : "")
        : `<p>${items.length ? "مخاطبی با این مشخصات پیدا نشد." : "مخاطبی با شماره تلفن روی گوشی نیست."}</p>`;
      $("ct-add").disabled = !chosen.size;
      $("ct-add").textContent = chosen.size ? `افزودن ${faDigits(chosen.size)} نفر` : "افزودن";
    };
    $("ct-q").oninput = draw;
    $("ct-list").onchange = (e) => { const k = e.target.dataset.k; if (!k) return; e.target.checked ? chosen.add(k) : chosen.delete(k); draw(); };
    $("ct-manual").onclick = manualContact;
    $("ct-add").onclick = () => { const pick = items.filter((it) => chosen.has(it.key)); closeSheet(); if (onPick) onPick(pick.map(({ name, phone }) => ({ name, phone }))); };
    draw();
  }
  window.dongNative = {
    onContacts(list) {
      if (list === "denied") return contactsDenied("اجازه دسترسی به مخاطبین داده نشد. دوباره تلاش کنید و «اجازه دادن» را بزنید، یا مخاطب را دستی وارد کنید.");
      if (!Array.isArray(list)) return contactsDenied("خواندن مخاطبین ممکن نشد. می‌توانید مخاطب را دستی وارد کنید.");
      contactsPicker(list);
    },
    onPhoto(url, reason) {
      if (url) return addPhoto(url);
      if (reason === "nocamera") toast("برنامه دوربین روی گوشی پیدا نشد؛ از گالری انتخاب کنید.");
      else if (reason === "error") toast("خواندن عکس ممکن نشد. دوباره امتحان کنید.");
    },
    onPurchase(data, reason) {
      if (data) { activatePro(data); closeSheet(); render(false); toast("⭐ دنگ پرو فعال شد. ممنون از حمایت شما!"); return; }
      const st = storeName() || "مارکت";
      const msg = { cancel: "خرید لغو شد.", nostore: `برنامهٔ ${st} روی گوشی نصب نیست یا قدیمی است.`, unavailable: `پرداخت در دسترس نیست؛ وارد حساب ${st} شوید و دوباره امتحان کنید.`,
        verify: "خرید انجام شد ولی تأیید نشد؛ «بازیابی خرید» را بزنید." }[reason] || `خرید انجام نشد (${reason || "خطا"}). دوباره امتحان کنید.`;
      toast(msg);
    },
    onRestore(owned, silent, data) {
      if (owned) { const was = isPro(); activatePro(data); if (!silent || !was) { closeSheet(); render(false); toast("⭐ خرید قبلی پیدا شد؛ دنگ پرو فعال است."); } return; }
      if (owned === false) {
        if (isPro()) { S.pro.active = false; save(); render(false); }
        if (!silent) toast(`خریدی برای حساب ${storeName() || "مارکت"} شما پیدا نشد.`);
        return;
      }
      if (!silent) toast(data === "nostore" ? `برنامهٔ ${storeName() || "مارکت"} روی گوشی نیست.` : "بررسی خرید ممکن نشد؛ بعداً دوباره امتحان کنید.");
    },
    onSku(info) { if (info && info.price) { proPrice = info.price; if ($("pro-price")) $("pro-price").textContent = "قیمت: " + proPrice; } },
    onVoice(list, reason) {
      if (Array.isArray(list) && list.length) {
        if (!$("v-text")) return;
        $("v-text").value = list[0];
        return voiceShow(list);
      }
      if (reason === "norecognizer") toast("تایپ صوتی روی این گوشی پیدا نشد. برنامهٔ Google را نصب یا به‌روز کنید، یا جمله را بنویسید.");
      else if (reason === "empty") toast("صدایی تشخیص داده نشد؛ دوباره امتحان کنید.");
    },
    onSaved(ok) { toast(ok ? "💾 فایل ذخیره شد." : "ذخیره فایل انجام نشد."); },
  };

  // ---- تنظیمات
  ACT.settings = () => openSheet(`<h2>تنظیمات</h2><div class="menu-list">
      ${proFree ? "" : `<button type="button" data-act="proInfo">⭐ دنگ پرو${isPro() ? " (فعال)" : ""}</button>`}
      <button type="button" data-act="backup">💾 ذخیره فایل پشتیبان</button>
      <button type="button" data-act="backupShare">📤 ارسال پشتیبان (تلگرام، ایمیل…)</button>
      <button type="button" data-act="restore">📥 بازگردانی از پشتیبان</button>
      <button type="button" data-act="sample">▶ ساخت برنامه نمونه</button>
      <button type="button" data-act="rename">✏️ تغییر نام من (${esc(S.name || "")})</button>
      <button type="button" class="danger" data-act="reset">🗑 پاک کردن همه اطلاعات</button>
      <button type="button" data-act="about">ℹ️ درباره</button></div>
      <button type="button" class="btn" data-act="closeSheet">بستن</button>`);
  // پشتیبان شامل عکس‌های فاکتور هم هست (برای انتقال به گوشی دیگر)
  function usedPhotoIds() {
    const ids = new Set();
    for (const t of store.s.txs) for (const [fid] of t.photos || []) ids.add(fid);
    for (const c of store.s.company || []) for (const [fid] of c.photos || []) ids.add(fid);
    return ids;
  }
  const backupJson = () => {
    const ph = {}; for (const fid of usedPhotoIds()) if (photos[fid]) ph[fid] = photos[fid];
    return JSON.stringify({ app: "dong", v: 3, name: S.name, state: S.state, photos: ph });
  };
  ACT.backup = () => { closeSheet(); saveFile(b64utf8(backupJson()), "application/json", `dong-backup-${todayJ().replace(/\//g, "-")}.json`); };
  ACT.backupShare = () => { closeSheet(); shareFile(b64utf8(backupJson()), "application/json", `dong-backup-${todayJ().replace(/\//g, "-")}.json`); };
  ACT.restore = () => {
    openSheet(`<h2>بازگردانی از پشتیبان</h2><p>فایل پشتیبان را انتخاب کنید یا متن آن را جای‌گذاری کنید. اطلاعات فعلی جایگزین می‌شود.</p>
      <button type="button" class="btn soft" id="rs-file">📂 انتخاب فایل پشتیبان</button>
      <textarea class="input ltr" id="rs-text" rows="5" placeholder='{"app":"dong", …}'></textarea>
      <div class="btns"><button type="button" class="btn primary" id="rs-ok">بازگردانی</button><button type="button" class="btn" data-act="closeSheet">انصراف</button></div>`);
    const apply = (txt) => {
      try {
        const d = JSON.parse(txt.trim());
        if (d.app !== "dong" || !d.state || !Array.isArray(d.state.programs)) throw new Error("bad");
        boot({ name: d.name || S.name, state: d.state }); save();
        if (d.photos && typeof d.photos === "object") for (const fid in d.photos) putPhoto(fid, d.photos[fid]);
        closeSheet(); stack = [{ v: "home" }]; render(true); toast(`بازگردانی شد: ${faDigits(d.state.programs.length)} برنامه.`);
      } catch (e) { toast("این فایل یا متن، پشتیبان دنگ نیست."); }
    };
    $("rs-ok").onclick = () => apply($("rs-text").value);
    $("rs-file").onclick = () => {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json,.json,text/plain";
      inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => apply(String(rd.result)); rd.readAsText(f); };
      inp.click();
    };
  };
  ACT.rename = () => {
    openSheet(`<h2>تغییر نام</h2><label class="field"><span>نام شما</span><input class="input" id="r-name" value="${esc(S.name || "")}" autocomplete="off"></label>
      <div class="btns"><button type="button" class="btn primary" id="r-ok">ذخیره</button><button type="button" class="btn" data-act="closeSheet">انصراف</button></div>`);
    $("r-ok").onclick = () => {
      const n = $("r-name").value.trim(); if (!n) return;
      S.name = n; store.touchUser(ME, n); me().name = n; save(); closeSheet(); render(false); toast("نام تغییر کرد.");
    };
  };
  ACT.reset = () => confirmSheet("همه اطلاعات پاک شود؟", "همه برنامه‌ها، تراکنش‌ها و عکس‌ها از این گوشی حذف می‌شود و قابل برگشت نیست. اگر لازم دارید، اول پشتیبان بگیرید.", "بله، پاک شود", () => {
    const n = S.name; clearPhotos(); boot({ name: n, state: null }); save(); stack = [{ v: "home" }]; render(true); toast("همه اطلاعات پاک شد.");
  }, true);
  ACT.about = () => openSheet(`<h2>دنگ ۱٫۴</h2><p>حساب‌وکتاب خرج‌های گروهی با مادرخرج، کاملاً آفلاین. اطلاعات فقط روی همین گوشی ذخیره می‌شود.</p>
    <p>قلم: وزیرمتن، اثر صابر راستی‌کردار، با مجوز SIL Open Font License 1.1.</p><button type="button" class="btn" data-act="closeSheet">بستن</button>`);
  ACT.sample = () => {
    closeSheet();
    const self = me();
    const pid = store.createProgram(ME, S.name, "برنامه شما تابستان ۱۴۰۵ (نمونه)", "1405/04/10");
    const add = (name, phone) => { const pe = store.addPerson(ME, name, phone || null, null); store.addMember(pid, pe.id); return pe.id; };
    const ali = add("علی"), moh = add("محمد", "09121112233"), aref = add("عارف"), jal = add("جلیلی"); add("بهروز");
    store.saveTx(pid, { title: "شام شب اول", payer: self.id, paid: 4850500, vat: 9, discount: 0, kind: EXPENSE, receiver: null, date: "1405/04/10", photos: [], items: [
      { name: "چلو جوجه", kind: UNIT, price: 1200000, alloc: [[self.id, 1], [ali, 1], [moh, 1]] },
      { name: "ماست", kind: UNIT, price: 50000, alloc: [[ali, 1]] },
      { name: "نوشابه", kind: UNIT, price: 100000, alloc: [[ali, 1], [moh, 1], [self.id, 1]] },
      { name: "سالاد", kind: UNIT, price: 150000, alloc: [[moh, 1], [self.id, 1]] },
      { name: "سرویس", kind: FIXED, price: 200000, alloc: [[self.id, 1], [ali, 1], [moh, 1]] }] });
    store.saveTx(pid, { title: "تو راهی روز اول", payer: self.id, paid: 600000, vat: 0, discount: 0, kind: EXPENSE, receiver: null, date: "1405/04/10", photos: [], items: [
      { name: "قهوه", kind: FIXED, price: 100000, alloc: [[aref, 1], [jal, 1]] },
      { name: "مخلفات", kind: FIXED, price: 500000, alloc: [[self.id, 1], [moh, 1], [aref, 1]] }] });
    store.saveTx(pid, { title: "واریز علی", payer: ali, paid: 1000000, vat: 0, discount: 0, kind: INCOME, receiver: self.id, date: "1405/04/11", photos: [], items: [] });
    save(); stack = [{ v: "home" }, { v: "prog", pid, tab: "dong" }]; render(true);
    toast("برنامه نمونه ساخته شد. از منوی ⋮ همان برنامه می‌توانید حذفش کنید.");
  };

  // ============================================================ رویدادها و شروع
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || !ACT[el.dataset.act]) return;
    e.preventDefault();
    ACT[el.dataset.act](el);
  });
  function askName() {
    $("bar").innerHTML = `<span class="icon-btn">🧮</span><h1>دنگ</h1>`;
    openSheet(`<h2>به دنگ خوش آمدید</h2><p>نام شما به‌عنوان مادرخرج در برنامه‌ها ثبت می‌شود. همه اطلاعات فقط روی همین گوشی می‌ماند و اینترنت لازم نیست.</p>
      <label class="field"><span>نام شما</span><input class="input" id="n-name" autocomplete="off"></label>
      <button type="button" class="btn primary" id="n-ok">شروع</button>`);
    $("n-ok").onclick = () => {
      const n = $("n-name").value.trim();
      if (!n) return toast("نام را وارد کنید.");
      S.name = n; boot(S); save(); closeSheet(); render(true);
    };
  }
  boot(loadState());
  openIdb().then(loadPhotos).then(() => {
    importLegacyPhotos();
    if (!S.name) return askName();
    save(); render(true);
    if (native && native.restore) setTimeout(() => { try { native.restore(true); } catch (e) { /* */ } }, 1500);
  });
})();
