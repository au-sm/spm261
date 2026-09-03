/**
 * Class Coin Exchange — backend for BOTH SPM 261 sections.
 * One standalone Apps Script project, deployed as a Web App.
 *
 * SETUP
 *  1. script.google.com -> New project. Paste this file in. Save.
 *  2. Project Settings (gear) -> Script Properties -> add:
 *       ADMIN_PW = <the teacher password you'll type in the page>
 *     (optional: ADMIN_PW_01 / ADMIN_PW_02 to use a different password per section)
 *  3. Deploy -> New deployment -> type "Web app"
 *       Execute as: Me
 *       Who has access: Anyone            <-- required so students (not signed in) can view
 *     Deploy, authorize, copy the Web app URL (ends in /exec).
 *  4. Put that URL in coin-exchange/config.js and push.
 *
 * No triggers, no cron. The market index is recomputed from the live BTC price on
 * every request; the first request each day records that day's close for the chart.
 */

var BTC_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
var PROPS = PropertiesService.getScriptProperties();

function doGet(e){
  var section = (e && e.parameter && e.parameter.section) || '01';
  return json_(handle_(section, null));
}
function doPost(e){
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch(err){}
  return json_(handle_(body.section || '01', body));
}

function handle_(section, body){
  section = String(section).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 12) || '01';
  var lock = LockService.getScriptLock();
  try { lock.waitLock(9000); } catch(err){ return {ok:false, error:'busy'}; }
  try {
    var st = loadState_(section);
    var btc = fetchBtc_();
    if (!st.startPrice) st.startPrice = btc;                 // first ever call seeds the baseline

    // ONE update per day: the first request after midnight (script timezone) locks in
    // that day's close from the live price. It does not move again until tomorrow.
    var today = todayISO_();
    var last = st.history[st.history.length - 1];
    if (!last || last.date < today) {
      var closeIndex = round2_(100 * btc / st.startPrice);
      var prev = last ? last.index : 100;
      st.history.push({ date: today, index: closeIndex, pct: round2_((closeIndex - prev) / prev * 100), btc: round2_(btc) });
      last = st.history[st.history.length - 1];
      if (st.history.length > 400) st.history = st.history.slice(-400);
    }
    var index = last.index;                                  // today's locked close
    var closeBtc = last.btc || btc;

    if (body && body.action) {
      if (body.action === 'ping') {
        if (!checkPw_(section, body.password)) return {ok:false, error:'not_authorized'};
      } else {
        if (!checkPw_(section, body.password)) return {ok:false, error:'not_authorized'};
        applyAction_(st, body.action, body.payload || {}, index);
      }
    }

    saveState_(section, st);
    return {
      ok: true, section: section,
      btc: closeBtc, liveBtc: btc, startPrice: round2_(st.startPrice), index: index,
      history: st.history, students: st.students, serverDate: today
    };
  } finally {
    lock.releaseLock();
  }
}

function applyAction_(st, action, p, index){
  if (action === 'addStudent') {
    var name = String(p.name || '').trim().slice(0, 80);
    if (name) st.students.push({ id: uid_(), name: name, banked: 0, coins: [] });

  } else if (action === 'grantCoin') {
    var s = find_(st.students, p.studentId);
    if (s) s.coins.push({ id: uid_(), entryIndex: index, grantedAt: todayISO_() });

  } else if (action === 'sell') {
    var s2 = find_(st.students, p.studentId);
    if (s2) {
      var i = s2.coins.map(function(c){ return c.id; }).indexOf(p.coinId);
      if (i > -1) {
        var val = 2 * (index / s2.coins[i].entryIndex);
        s2.banked = round2_(s2.banked + val);
        s2.coins.splice(i, 1);
      }
    }

  } else if (action === 'removeStudent') {
    st.students = st.students.filter(function(x){ return x.id !== p.studentId; });
  }
}

/**
 * Run this ONCE from the editor (pick "seed" in the function dropdown, click Run)
 * to carry the three test-week days onto the chart and re-anchor the baseline so
 * today's first close continues smoothly from ~101.05 instead of snapping to 100.
 * Safe to skip entirely if you'd rather start fresh. It refuses to run on a
 * section that has already accumulated its own daily closes.
 */
function seed(){
  var H = [
    { date: '2026-08-30', index: 101,    pct: 1 },
    { date: '2026-08-31', index: 100.54, pct: -0.46 },
    { date: '2026-09-01', index: 101.05, pct: 0.51 }
  ];
  var anchor = round2_(fetchBtc_() / 1.0105);
  ['01', '02'].forEach(function(sec){
    var st = loadState_(sec);
    var ownDays = (st.history || []).filter(function(h){ return h.date > '2026-09-01'; });
    if (ownDays.length > 1) return;                 // already running for real — leave it alone
    st.startPrice = anchor;
    st.history = H.map(function(x){ return { date: x.date, index: x.index, pct: x.pct }; });
    if (!Array.isArray(st.students)) st.students = [];
    saveState_(sec, st);
  });
}

function fetchBtc_(){
  var cache = CacheService.getScriptCache();
  var hit = cache.get('btc');
  if (hit) return Number(hit);
  try {
    var res = UrlFetchApp.fetch(BTC_URL, { muteHttpExceptions: true });
    var amt = Number(JSON.parse(res.getContentText()).data.amount);
    if (amt > 0) {
      cache.put('btc', String(amt), 60);
      PROPS.setProperty('last_btc', String(amt));
      return amt;
    }
  } catch (e) {}
  var lg = Number(PROPS.getProperty('last_btc'));
  if (lg > 0) return lg;
  throw new Error('BTC price unavailable');
}

function checkPw_(section, given){
  var want = PROPS.getProperty('ADMIN_PW_' + section) || PROPS.getProperty('ADMIN_PW') || '';
  return !!want && String(given || '') === want;
}
function loadState_(section){
  var raw = PROPS.getProperty('state_' + section);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return { startPrice: 0, history: [], students: [] };
}
function saveState_(section, st){
  PROPS.setProperty('state_' + section, JSON.stringify(st));
}
function find_(arr, id){ return arr.filter(function(x){ return x.id === id; })[0]; }
function uid_(){ return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function round2_(n){ return Math.round(n * 100) / 100; }
function todayISO_(){ return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
