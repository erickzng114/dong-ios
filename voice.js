"use strict";
/* دنگ — تحلیل جملهٔ فارسی (از تایپ صوتی یا تایپ دستی) به پیش‌نویس فرم هزینه. کاملاً آفلاین. */
var DongVoice = (function () {
  const FA = "۰۱۲۳۴۵۶۷۸۹", AR = "٠١٢٣٤٥٦٧٨٩";

  // ---------------------------------------------------------------- عادی‌سازی
  function norm(s) {
    return String(s || "")
      .replace(/[۰-۹]/g, (c) => FA.indexOf(c)).replace(/[٠-٩]/g, (c) => AR.indexOf(c))
      .replace(/ي/g, "ی").replace(/ى/g, "ی").replace(/ك/g, "ک").replace(/ة/g, "ه").replace(/[ۀ]/g, "ه")
      .replace(/[ً-ْٰ]/g, "")           // اعراب
      .replace(/(\d)[٫.\/](\d)/g, "$1.$2")               // ممیز
      .replace(/(\d)[٬,،](?=\d{3}\b)/g, "$1")            // جداکننده هزارگان
      .replace(/[‌‏‎]/g, " ")             // نیم‌فاصله
      .replace(/(\d)(?=[^\d\s.A-Za-z])/g, "$1 ").replace(/([^\d\s.A-Za-z])(?=\d)/g, "$1 ")
      .replace(/(هزار|میلیون|میلیارد)(تومان|تومن|ریال|تومنی|تومانی)/g, "$1 $2")
      .replace(/[٪%]/g, " درصد ")
      .replace(/[,،؛;:!?؟«»"()\-–—]/g, " ")
      .replace(/\s+/g, " ").trim()
      .replace(/(^| )(یه|یک|دو|سه|چهار|چار|پنج)تا(?= |$)/g, "$1$2 تا");
  }
  const key = (s) => norm(s).replace(/\s+/g, "").replace(/ئ/g, "ی").replace(/[أإآ]/g, "ا");

  // ---------------------------------------------------------------- عددهای فارسی
  const W = {
    صفر: 0, یک: 1, یه: 1, یکی: 1, دو: 2, سه: 3, چهار: 4, چار: 4, پنج: 5, پنش: 5, شش: 6, شیش: 6, هفت: 7, هشت: 8, نه: 9,
    ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, پونزده: 15, شانزده: 16, شونزده: 16, هفده: 17, هیفده: 17,
    هجده: 18, هیجده: 18, نوزده: 19, بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
    صد: 100, یکصد: 100, دویست: 200, سیصد: 300, چهارصد: 400, پانصد: 500, پونصد: 500, ششصد: 600, شیشصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900,
  };
  const SCALE = { هزار: 1e3, تومن_هزار: 1e3, میلیون: 1e6, ملیون: 1e6, تومن_میلیون: 1e6, میلیارد: 1e9, ملیارد: 1e9 };
  // «نه» و «سی» و «ده» معنی غیرعددی هم دارند؛ فقط در کنار عدد دیگر یا واحد شمرده می‌شوند
  const AMBIG = new Set(["نه", "سی", "ده", "یه", "یکی"]);
  const isNumTok = (t) => /^\d+(\.\d+)?$/.test(t) || t in W || t in SCALE || t === "نیم" || t === "ونیم";

  /** از اندیس i یک عدد می‌خواند؛ {value, end, hadScale, unit} یا null */
  function readNumber(toks, i) {
    let total = 0, cur = 0, j = i, used = 0, lastScale = 0, hadScale = false, any = false;
    while (j < toks.length) {
      let t = toks[j];
      if (t === "و" && any && j + 1 < toks.length && isNumTok(toks[j + 1])) { j++; continue; }
      if (t === "ونیم") t = "نیم";
      if (/^\d+(\.\d+)?$/.test(t)) { if (any && cur && !(cur % 1000 === 0 && +t < cur)) break; cur += parseFloat(t); any = true; used++; j++; continue; }
      if (t in W) {
        const v = W[t];
        if (any && cur && v >= 100 && cur < 10 && v % 100 === 0) break; // «دو چهارصد» دو عدد جداست
        cur += v; any = true; used++; j++; continue;
      }
      if (t === "نیم" && any) { cur += 0.5; used++; j++; continue; }
      if (t in SCALE) {
        const s = SCALE[t];
        if (!any) { cur = 1; any = true; }
        if (lastScale && s > lastScale) { total = (total + (cur || 0)) * s; } else { total += (cur || 1) * s; }
        cur = 0; lastScale = s; hadScale = true; used++; j++; continue;
      }
      break;
    }
    if (!any) return null;
    if (used === 1 && AMBIG.has(toks[i]) && !(j < toks.length && /^(تومان|تومن|ریال|درصد|سهم|برابر|تا|نفر|عدد|تومنی|تومانی)$/.test(toks[j]))) return null;
    // «دو میلیون و چهارصد» یعنی ۲٬۴۰۰٬۰۰۰
    if (cur && lastScale >= 1e6 && cur < 1000) cur = cur * (lastScale / 1000);
    let value = total + cur;
    let unit = null;
    if (j < toks.length && /^(تومان|تومن|تومنی|تومانی)$/.test(toks[j])) { unit = "toman"; j++; }
    else if (j < toks.length && toks[j] === "ریال") { unit = "rial"; value = value / 10; j++; }
    return { value: Math.round(value * 100) / 100, end: j, hadScale, unit };
  }

  // ---------------------------------------------------------------- کلمات کلیدی
  const ALL = ["همه", "همگی", "همه‌ی", "همهٔ", "همه ی", "کل اعضا", "همه اعضا", "همه بچه ها", "همه بچه‌ها", "بچه ها", "همه نفرات", "همه با هم", "همشون", "همه‌شون"];
  const EXCEPT = ["به جز", "بجز", "غیر از", "به غیر از", "منهای", "الا", "جز"];
  const SELF = ["من", "خودم", "بنده"];
  const PER_HEAD = ["نفری", "هر نفر", "هرنفر", "هر کدام", "هرکدام", "هر کدوم", "هرکدوم", "برای هر نفر", "به ازای هر نفر"];
  const PAYER_BEFORE = ["پرداخت کننده", "پرداختکننده", "مادرخرج", "مادر خرج", "با کارت", "از جیب", "حساب", "پولش رو", "پولشو", "پول رو", "پولو"];
  const PAYER_AFTER = ["کارت کشید", "کارت کشیدم", "حساب کرد", "حساب کردم", "پرداخت کرد", "پرداخت کردم", "پول داد", "پولش رو داد", "پولشو داد", "داد", "دادم", "خرید", "خریدم", "پرداخت", "حساب"];
  const FILLER = new Set(["برای", "بابت", "هزینه", "هزینه‌ی", "هزینهٔ", "خرج", "ثبت", "کن", "بکن", "شد", "شده", "که", "رو", "را", "یه", "یک", "امروز", "دیروز", "پریروز", "دیشب", "مبلغ", "به", "مبلغ", "با", "از", "اون", "این", "یکی", "تا", "و"]);
  const COMPANY_WORDS = ["به حساب شرکت", "حساب شرکت", "کارت شرکت", "کارت تنخواه", "از تنخواه", "با تنخواه", "تنخواه", "شرکتی", "شرکت", "ماموریت", "ماموریتی"];
  const INV_STRONG = /^(شماره|کد|پیگیری|سند|ارجاع|سریال)$/, INV_WEAK = /^(فاکتور|قبض|رسید|فیش)$/;
  const PLACE = /^(رستوران|هتل|فروشگاه|پمپ|جایگاه|کافه|کافی|سوپرمارکت|سوپر|هایپر|داروخانه|آژانس|پارکینگ|نانوایی|قنادی|مهمانپذیر|مسافرخانه|تاکسی|اسنپ|تپسی|کترینگ|فست|کبابی|چلوکبابی|بازار|نمایندگی|تعمیرگاه|کارواش|کتابفروشی|لوازم|چاپخانه|شرکت)$/;
  const CATS = [
    ["اقامت", /^(هتل|اقامت|مهمانپذیر|مسافرخانه|سوئیت|ویلا|اتاق|اقامتگاه|هتلآپارتمان)$/],
    ["سوخت", /^(بنزین|گازوئیل|سوخت|گاز|cng)$/],
    ["عوارض و پارکینگ", /^(عوارض|پارکینگ|پارک|آزادراه|جریمه)$/],
    ["حمل‌ونقل", /^(بلیط|بلیت|تاکسی|اسنپ|تپسی|کرایه|قطار|هواپیما|اتوبوس|پرواز|آژانس|مترو|ماشین|سواری|باربری|پیک)$/],
    ["پذیرایی", /^(پذیرایی|میوه|شیرینی|کافه|چای|قهوه|آبمیوه|تنقلات|کیک)$/],
    ["غذا", /^(شام|ناهار|نهار|صبحانه|غذا|رستوران|ساندویچ|پیتزا|کباب|چلوکباب|عصرانه)$/],
    ["ارتباطات", /^(موبایل|اینترنت|سیمکارت|سیم|مکالمه|تلفن|پست)$/],
    ["لوازم و خرید", /^(لوازم|تحریر|کاغذ|پرینت|کپی|خرید|ابزار|قطعه|قطعات|کارتریج)$/],
  ];
  const DATE_WORDS = { امروز: 0, امشب: 0, دیروز: -1, دیشب: -1, پریروز: -2, پریشب: -2 };

  function findAll(toks, phrase) {
    const out = []; let k = -1;
    while ((k = findPhrase(toks, phrase, k + 1)) >= 0) out.push(k);
    return out;
  }
  function findPhrase(toks, phrase, from = 0) {
    const p = norm(phrase).split(" ");
    for (let i = from; i <= toks.length - p.length; i++) if (p.every((w, k) => toks[i + k] === w)) return i;
    return -1;
  }

  // ---------------------------------------------------------------- نام اعضا
  /** فهرست الگوهای نام: نام کامل، نام کوچک، و فامیلی (اگر یکتا باشد) */
  function namePatterns(members, selfId) {
    const pats = [];
    const firstCount = {}, lastCount = {};
    for (const m of members) {
      const w = norm(m.name).split(" ").filter(Boolean);
      if (!w.length) continue;
      firstCount[w[0]] = (firstCount[w[0]] || 0) + 1;
      if (w.length > 1) lastCount[w[w.length - 1]] = (lastCount[w[w.length - 1]] || 0) + 1;
    }
    for (const m of members) {
      const w = norm(m.name).split(" ").filter(Boolean);
      if (!w.length) continue;
      pats.push({ id: m.id, words: w });
      if (w.length > 1 && firstCount[w[0]] === 1) pats.push({ id: m.id, words: [w[0]] });
      if (w.length > 1 && lastCount[w[w.length - 1]] === 1 && !(w[w.length - 1] in firstCount)) pats.push({ id: m.id, words: [w[w.length - 1]] });
    }
    if (selfId != null) for (const s of SELF) pats.push({ id: selfId, words: [s], self: true });
    // الگوهای بلندتر اول
    return pats.sort((a, b) => b.words.length - a.words.length);
  }
  // پسوندهای رایج گفتاری بعد از نام: «علی‌ام»، «محمدو»، «عارفم»، «علی هم»
  const SUFFIXES = ["", "و", "ه", "ام", "م", "رو", "هم", "جان", "جون"];
  function matchName(toks, i, pats) {
    for (const p of pats) {
      let ok = true;
      for (let k = 0; k < p.words.length; k++) {
        const t = toks[i + k];
        if (t === undefined) { ok = false; break; }
        if (t === p.words[k]) continue;
        if (k === p.words.length - 1 && !p.self && p.words[k].length >= 2 && SUFFIXES.some((s) => s && t === p.words[k] + s)) continue;
        ok = false; break;
      }
      if (ok) return { id: p.id, len: p.words.length };
    }
    return null;
  }

  // ---------------------------------------------------------------- تحلیل
  /**
   * text: جمله
   * ctx: {members:[{id,name}], treasurer, selfId, todayJ: "1405/08/09", shiftDate(days)->"yyyy/mm/dd"}
   * خروجی: {ok, draft, notes:[...], warnings:[...], score}
   */
  function parse(text, ctx) {
    const toks = norm(text).split(" ").filter(Boolean);
    const used = new Array(toks.length).fill(false);
    const mark = (a, b) => { for (let k = a; k < b; k++) used[k] = true; };
    const notes = [], warnings = [];
    const members = ctx.members || [];
    const pats = namePatterns(members, ctx.selfId);
    const nameOf = (id) => (members.find((m) => m.id === id) || {}).name || "?";

    // ۱) نام‌ها
    const mentions = []; // {id, at, len}
    for (let i = 0; i < toks.length; i++) {
      const m = matchName(toks, i, pats);
      if (m) { mentions.push({ id: m.id, at: i, len: m.len }); i += m.len - 1; }
    }
    const atMention = new Map(mentions.map((m) => [m.at, m]));

    // ۲) تاریخ
    let date = ctx.todayJ, dateWord = null;
    for (let i = 0; i < toks.length; i++) if (toks[i] in DATE_WORDS) { dateWord = toks[i]; if (ctx.shiftDate) date = ctx.shiftDate(DATE_WORDS[toks[i]]); used[i] = true; break; }

    // ۳) عددها
    const nums = []; // {value, at, end, hadScale, unit}
    for (let i = 0; i < toks.length; i++) {
      if (atMention.has(i)) { i += atMention.get(i).len - 1; continue; }
      const n = readNumber(toks, i);
      if (n) { nums.push(Object.assign({ at: i }, n)); i = n.end - 1; }
    }
    const after = (n, words) => words.some((w) => findPhrase(toks, w, n.end) === n.end);
    const before = (n, words) => words.some((w) => { const len = norm(w).split(" ").length; return n.at - len >= 0 && findPhrase(toks, w, n.at - len) === n.at - len; });

    // ۳ب) هزینهٔ شرکتی، شارژ تنخواه، شمارهٔ فاکتور
    let companySaid = false, charge = false;
    for (const w of COMPANY_WORDS) for (const k of findAll(toks, w)) { if (used[k]) continue; companySaid = true; mark(k, k + norm(w).split(" ").length); }
    const company = companySaid || !!ctx.forceCompany || !!ctx.petty;
    const iCharge = toks.findIndex((t, k) => /^(شارژ|واریز|شارژش)$/.test(t) && !/^(موبایل|گوشی|سیمکارت|سیم|اینترنت|باتری)$/.test(toks[k + 1] || ""));
    if (iCharge >= 0 && (ctx.petty || toks.includes("تنخواه") || findPhrase(toks, "کارت تنخواه") >= 0)) { charge = true; used[iCharge] = true; if (toks[iCharge + 1] === "شد") used[iCharge + 1] = true; }
    let invoiceNo = "";
    if (company) {
      for (const n of nums) {
        if (n.role || n.hadScale || n.unit) continue;
        const lead = []; for (let k = Math.max(0, n.at - 3); k < n.at; k++) lead.push(k);
        const strong = lead.some((k) => INV_STRONG.test(toks[k])), weak = lead.some((k) => INV_WEAK.test(toks[k]));
        const others = nums.some((m) => m !== n && !m.role);
        if (!(strong || (weak && others))) continue;
        n.role = "invoice";
        invoiceNo = toks.slice(n.at, n.end).filter((t) => /^\d+$/.test(t)).join("") || String(n.value);
        mark(n.at, n.end); for (const k of lead) if (INV_STRONG.test(toks[k]) || INV_WEAK.test(toks[k])) used[k] = true;
        break;
      }
    }

    // ۴) تخفیف و ارزش افزوده
    let discount = 0, vat = 0;
    const iDisc = toks.findIndex((t) => t === "تخفیف");
    if (iDisc >= 0) {
      const n = nums.find((x) => !x.role && (x.at === iDisc + 1 || x.end === iDisc || (x.at > iDisc && x.at <= iDisc + 3)));
      if (n) { n.role = "discount"; discount = n.value < 1000 && !n.hadScale ? n.value * 1000 : n.value; mark(n.at, n.end); notes.push(`تخفیف: ${fmtN(discount)}`); }
      used[iDisc] = true;
    }
    let iVat = findPhrase(toks, "ارزش افزوده");
    if (iVat < 0) iVat = toks.findIndex((t) => t === "مالیات");
    if (iVat >= 0) {
      const n = nums.find((x) => !x.role && Math.abs(x.at - iVat) <= 4 && x.value <= 100 && (after(x, ["درصد"]) || before(x, ["ارزش افزوده", "مالیات"])));
      vat = n ? n.value : 10;
      if (n) { n.role = "vat"; mark(n.at, n.end); }
      notes.push(`ارزش افزوده: ${fmtN(vat)}٪`);
      if (/^(بدون|نداره|نداشت)$/.test(toks[iVat - 1] || "") || /^(نداره|نداشت|نیست)$/.test(toks[iVat + 2] || "")) { vat = 0; notes.pop(); }
    }

    // ۵) وزن‌ها: «علی دو سهم»، «محمد دوبرابر»، «عارف ۴۰ درصد»، «علی دو تا»
    const weights = new Map(); let pct = false;
    for (const n of nums) {
      if (n.role) continue;
      const isShare = after(n, ["سهم", "برابر", "برابره", "تا", "عدد", "پرس", "نفر"]) && n.value <= 20;
      const isPct = after(n, ["درصد"]) && n.value <= 100;
      if (!isShare && !isPct) continue;
      // نام قبل یا بعد از عدد
      let who = null;
      for (const m of mentions) if (m.at + m.len === n.at || m.at + m.len === n.at - 1) who = m;
      if (!who) { const tailLen = isPct ? 1 : 1; for (const m of mentions) if (m.at === n.end + tailLen || m.at === n.end + tailLen + 1) who = m; }
      if (!who) { if (isShare && after(n, ["نفر"])) { n.role = "headcount"; mark(n.at, n.end + 1); } continue; }
      n.role = isPct ? "pct" : "weight";
      weights.set(who.id, n.value);
      if (isPct) pct = true;
      mark(n.at, n.end + 1);
    }

    // ۶) مبلغ اصلی: بزرگ‌ترین عدد باقی‌مانده
    const rest = nums.filter((n) => !n.role);
    let amount = null, perHead = false;
    if (rest.length) {
      let best = rest[0];
      for (const n of rest) if (n.value > best.value) best = n;
      amount = best.value;
      // «دویست» تنها معمولاً یعنی دویست هزار تومان
      if (amount < 1000 && best.unit !== "rial" && !best.hadScale) {
        if (amount < 10) { amount = amount * 1e6; notes.push("عدد بدون واحد به میلیون تومان تعبیر شد"); }
        else { amount = amount * 1000; notes.push("عدد بدون واحد به هزار تومان تعبیر شد"); }
      }
      best.role = "amount"; mark(best.at, best.end);
      const near = (k) => (k >= best.at - 4 && k < best.at) || (k >= best.end && k <= best.end + 1);
      for (const w of PER_HEAD) for (const k of findAll(toks, w)) if (near(k)) { perHead = true; mark(k, k + norm(w).split(" ").length); }
      for (const n of rest) if (n !== best && n.value >= 1000) warnings.push(`عدد ${fmtN(n.value)} هم گفته شد؛ فقط ${fmtN(amount)} به‌عنوان مبلغ گرفته شد.`);
    }

    // ۷) پرداخت‌کننده
    let payer = null;
    for (const m of mentions) {
      const endAt = m.at + m.len;
      if (PAYER_AFTER.some((w) => findPhrase(toks, w, endAt) === endAt || findPhrase(toks, w, endAt + 1) === endAt + 1 && toks[endAt] !== "و")) {
        // «علی داد» فقط وقتی پرداخت است که نام بلافاصله قبل از فعل باشد
        payer = m; break;
      }
      if (PAYER_BEFORE.some((w) => { const len = norm(w).split(" ").length; return m.at - len >= 0 && findPhrase(toks, w, m.at - len) === m.at - len; })) { payer = m; break; }
    }
    if (payer) { mark(payer.at, payer.at + payer.len); payer.isPayer = true; }

    // ۷ب) طرف حساب (فقط برای هزینهٔ شرکتی)
    let vendor = "";
    if (company) {
      const STOP = /^(و|با|به|برای|بابت|که|شد|شده|کرد|کردم|داد|دادم|حساب|پرداخت|تومان|تومن|هزار|میلیون)$/;
      for (let i = 0; i < toks.length && !vendor; i++) {
        if (used[i]) continue;
        let start = -1;
        const ph = ["طرف حساب", "فروشنده"].find((w) => findPhrase(toks, w, i) === i);
        if (ph) start = i + norm(ph).split(" ").length;
        else if (toks[i] === "از" && toks[i + 1] && toks[i + 1] !== "جیب" && !used[i + 1] && !atMention.has(i + 1) && !isNumTok(toks[i + 1])) start = i + 1;
        else if (/^(در|تو|توی)$/.test(toks[i]) && PLACE.test(toks[i + 1] || "")) start = i + 1;
        if (start < 0) continue;
        const out = [];
        for (let k = start; k < toks.length && out.length < 4; k++) {
          if (used[k] || atMention.has(k) || nums.some((n) => k >= n.at && k < n.end) || STOP.test(toks[k]) || toks[k] in DATE_WORDS) break;
          out.push(toks[k]);
        }
        if (out.length) { vendor = out.join(" "); mark(i, start + out.length); }
      }
    }

    // ۸) شرکت‌کنندگان
    const allIds = members.map((m) => m.id);
    let iExc = -1, excLen = 0;
    for (const w of EXCEPT) { const k = findPhrase(toks, w); if (k >= 0 && (iExc < 0 || k < iExc)) { iExc = k; excLen = norm(w).split(" ").length; } }
    const hasAll = ALL.some((w) => findPhrase(toks, w) >= 0);
    const excluded = new Set();
    if (iExc >= 0) {
      // نام‌های پشت سر هم بعد از «به جز»
      let k = iExc + excLen;
      for (const m of mentions) {
        if (m.at < k) continue;
        if (m.at === k || (toks[k] === "و" && m.at === k + 1)) { excluded.add(m.id); k = m.at + m.len; } else break;
      }
      mark(iExc, k);
    }
    let people = [];
    const named = mentions.filter((m) => !m.isPayer && !excluded.has(m.id)).map((m) => m.id);
    // اگر پرداخت‌کننده با «من و علی» در فهرست هم آمده، دوباره حساب می‌شود
    if (payer) {
      const again = mentions.filter((m) => m.id === payer.id && m !== payer);
      if (again.length) named.push(payer.id);
    }
    if (hasAll || (!named.length && !weights.size)) {
      people = allIds.filter((id) => !excluded.has(id));
      if (!hasAll && !excluded.size) notes.push("کسی نام برده نشد؛ بین همه اعضا تقسیم شد");
    } else {
      people = [...new Set([...named, ...weights.keys()])].filter((id) => !excluded.has(id));
      // «من» در جمله نیامده ولی پرداخت‌کننده «من» است؟ فقط وقتی «ما»/«با هم» گفته شده باشد
      if (payer && !people.includes(payer.id) && /(^| )(ما|باهم|با هم|منم|خودمم)( |$)/.test(toks.join(" "))) people.push(payer.id);
    }
    // ترتیب اعضا مثل ترتیب برنامه
    people = allIds.filter((id) => people.includes(id));

    // ۹) عنوان
    let title = "";
    const iBabat = toks.findIndex((t) => t === "بابت" || t === "برای");
    const titleFrom = (start) => {
      const out = [];
      for (let k = start; k < toks.length && out.length < 5; k++) {
        if (!out.length && (FILLER.has(toks[k]) || toks[k] in DATE_WORDS || (used[k] && !atMention.has(k)))) continue;
        if (used[k] || atMention.has(k) || nums.some((n) => k >= n.at && k < n.end)) break;
        if (k === iExc || ["نفری", "هر", "تومان", "تومن", "مساوی", "تقسیم", "سهم"].includes(toks[k])) break;
        if ((PAYER_AFTER.includes(toks[k]) && !/^خرید/.test(toks[k])) || ["پرداخت", "حساب", "مادرخرج"].includes(toks[k])) break;
        out.push(toks[k]);
      }
      while (out.length && FILLER.has(out[out.length - 1])) out.pop();
      return out.join(" ");
    };
    if (iBabat >= 0) title = titleFrom(iBabat + 1);
    if (!title) title = titleFrom(0);
    if (!title) {
      // اولین کلمهٔ «مصرفی» در کل جمله
      const k = toks.findIndex((t, idx) => !used[idx] && !atMention.has(idx) && !FILLER.has(t) && !isNumTok(t) && t.length > 1 && !/^(تومان|تومن|ریال|نفری|مساوی|همه|سهم|درصد|برابر|تقسیم|کرد|کردم|داد|دادم)$/.test(t));
      title = k >= 0 ? toks[k] : "";
    }
    if (!title && charge) title = "شارژ تنخواه";
    if (!title) warnings.push("عنوان هزینه را پیدا نکردم؛ در فرم بنویسید.");
    let category = "";
    if (company && !charge) {
      const tt = norm(title).split(" ").concat(toks);
      for (const [c, re] of CATS) if (tt.some((t) => re.test(t.replace(/\s/g, "")))) { category = c; break; }
    }

    // ۱۰) اقلام
    const items = [];
    let paidSame = true, paid = null;
    if (amount && people.length) {
      const wOf = (id) => weights.get(id) || (pct ? 0 : 1);
      if (pct) {
        const left = 100 - [...weights.values()].reduce((a, b) => a + b, 0);
        const others = people.filter((id) => !weights.has(id));
        if (others.length && left > 0) for (const id of others) weights.set(id, left / others.length);
        const sum = people.reduce((a, id) => a + (weights.get(id) || 0), 0);
        if (Math.abs(sum - 100) > 0.5) warnings.push(`جمع درصدها ${fmtN(Math.round(sum * 10) / 10)} شد، نه ۱۰۰؛ سهم‌ها به همان نسبت حساب شد.`);
      }
      const ws = people.map(wOf);
      const allOne = ws.every((w) => w === 1);
      if (perHead) {
        const ints = ws.every((w) => Number.isInteger(w) && w >= 1 && w <= 5);
        items.push({ name: title || "قلم", kind: "unit", price: Math.round(amount), alloc: people.map((id, k) => [id, ints ? ws[k] : 1]) });
      } else if (allOne) {
        items.push({ name: title || "هزینه", kind: "fixed", price: Math.round(amount), alloc: people.map((id) => [id, 1]) });
      } else {
        const sumW = ws.reduce((a, b) => a + b, 0);
        const ints = ws.every((w) => Number.isInteger(w) && w >= 1 && w <= 5);
        if (ints && Math.round(amount) % sumW === 0) {
          items.push({ name: title || "قلم", kind: "unit", price: Math.round(amount) / sumW, alloc: people.map((id, k) => [id, ws[k]]) });
        } else {
          const parts = splitWeighted(Math.round(amount), ws);
          people.forEach((id, k) => { if (parts[k] > 0) items.push({ name: `${title || "سهم"} — ${nameOf(id)}`, kind: "fixed", price: parts[k], alloc: [[id, 1]] }); });
        }
      }
    }
    if (!amount) warnings.push("مبلغ را متوجه نشدم؛ در فرم وارد کنید.");
    if (amount && !people.length && !company) warnings.push("کسی برای تقسیم باقی نماند.");
    if (!members.length && !company) warnings.push("این برنامه عضوی ندارد.");

    // ۱۱) جمع‌بندی برای نمایش
    const shareMap = new Map();
    for (const it of items) {
      if (it.kind === "unit") for (const [id, q] of it.alloc) shareMap.set(id, (shareMap.get(id) || 0) + it.price * q);
      else { const parts = splitWeighted(it.price, it.alloc.map(() => 1)); it.alloc.forEach(([id], k) => shareMap.set(id, (shareMap.get(id) || 0) + parts[k])); }
    }
    const payerId = payer ? payer.id : ctx.treasurer;
    const draft = { title, date, payer: payerId, items, discount, vat, paidSame, paid, photos: [] };
    const summary = {
      title, amount: amount ? Math.round(amount) : null, perHead, dateWord,
      payer: payerId, payerSaid: !!payer,
      people: people.map((id) => ({ id, name: nameOf(id), weight: weights.get(id) || null, share: shareMap.get(id) || 0 })),
      excluded: [...excluded].map(nameOf), discount, vat, pct,
      company, companySaid, charge, vendor, invoiceNo, category,
    };
    const comp = { title, date, amount: amount ? Math.round(amount) : null, payer: payerId, vendor, invoiceNo, category, note: "", photos: [] };
    const score = (amount ? 4 : 0) + mentions.length + (title ? 1 : 0) - warnings.length;
    return { ok: !!(amount && (company || people.length)), draft, comp, summary, notes, warnings, score, text };
  }

  /** چند گزینهٔ تشخیص گفتار؛ بهترین را برمی‌گرداند */
  function parseBest(texts, ctx) {
    let best = null;
    for (const t of texts || []) { const r = parse(t, ctx); if (!best || r.score > best.score) best = r; }
    return best;
  }

  function splitWeighted(total, ws) {
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    const raw = ws.map((w) => (total * w) / sum), base = raw.map(Math.floor);
    let left = total - base.reduce((a, b) => a + b, 0);
    const order = raw.map((r, k) => [r - base[k], k]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) base[order[k][1]]++;
    return base;
  }
  function fmtN(n) {
    const s = String(Math.abs(Math.round(n * 100) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
    return s.replace(/\d/g, (d) => FA[d]).replace(".", "٫");
  }

  return { parse, parseBest, norm, readNumber: (s) => { const t = norm(s).split(" "); return readNumber(t, 0); }, splitWeighted, key };
})();
if (typeof module !== "undefined") module.exports = DongVoice;
