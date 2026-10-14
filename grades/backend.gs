/**
 * SPM 261 — My Grade (student grade lookup, Sections 01 and 02)
 * --------------------------------------------------------------
 * Backend for au-sm.github.io/spm261/grades/01/ and /grades/02/ (?section=01|02).
 * Each section has its own private Sheet: Script Properties SHEET_ID_01 and
 * SHEET_ID_02 (SHEET_ID is still accepted for Section 02). A student enters their Arcadia
 * username + grade PIN; this script returns ONLY that student's row from the
 * private gradebook Sheet. The public page holds no grade data at all.
 *
 * SHEET LAYOUT (one private Google Sheet, owned by the instructor)
 *  - Tab "Gradebook": the Canvas gradebook export pasted as-is
 *      row 1 = headers (Student, ID, SIS User ID, SIS Login ID, Section, <assignments...>, totals...)
 *      row 2 = "Points Possible"
 *      rows 3+ = one row per student
 *    Extra-credit columns: any header containing "Asking Questions" or "Bonus"
 *    is treated as bonus (added on top of the 100-point course total).
 *  - Tab "PINs": columns  login | pin | student | coin_name
 *      login = SIS Login ID (e.g. pbates_01); pin = Soccer League team PIN;
 *      coin_name = the student's name exactly as it appears on the Coin Exchange page.
 *
 * COIN EXCHANGE BONUS: each student's current coin total (banked + live value of
 * coins held, same formula as coin-exchange/app.js) is fetched live from the
 * Coin Exchange backend and shown as a bonus line, so it moves with Bitcoin.
 *
 * SETUP (one time)
 *  1. Upload SPM261.02_Grades_Data.xlsx to Google Drive -> Open with Google Sheets
 *     (File -> Save as Google Sheets). Copy its ID from the URL (between /d/ and /edit).
 *  2. script.google.com -> New project. Paste this file in. Save.
 *  3. Project Settings -> Script Properties -> add  SHEET_ID = <the Sheet ID>
 *  4. Deploy -> New deployment -> Web app. Execute as: Me. Who has access: Anyone.
 *     Copy the /exec URL and send it to Claude (it goes in grades/02/config.js).
 *
 * UPDATING GRADES: export the Canvas gradebook again and paste it over the
 * "Gradebook" tab (keep the tab name). No redeploy needed.
 *
 * Brute-force guard: 5 wrong PINs for a username locks that username for 15 minutes.
 */

var MAX_FAILS = 5, LOCK_SECONDS = 900;
var COIN_API = 'https://script.google.com/macros/s/AKfycbwDxIRDAcZru9LEvOoVpWWNfZptKGBaXSUF0QNSMLZFPRSAuGpuKndl2Pm9Tz1MIbUM/exec';

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action !== 'grade') return json_({ ok: false, error: 'unknown action' });
    var section = p.section === '01' ? '01' : '02';
    return json_(lookup_(String(p.login || '').trim().toLowerCase(), String(p.pin || '').trim(), section));
  } catch (err) {
    return json_({ ok: false, error: 'server error' });
  }
}

function lookup_(login, pin, section) {
  if (!login || !pin) return { ok: false, error: 'Enter your username and PIN.' };
  var cache = CacheService.getScriptCache(), key = 'fail_' + section + '_' + login;
  var fails = Number(cache.get(key) || 0);
  if (fails >= MAX_FAILS) return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' };

  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID_' + section) || (section === '02' ? props.getProperty('SHEET_ID') : null);
  if (!sheetId) return { ok: false, error: 'Grades for this section are not available yet.' };
  var ss = SpreadsheetApp.openById(sheetId);
  var pins = ss.getSheetByName('PINs').getDataRange().getDisplayValues();
  var good = false, coinName = '';
  for (var i = 1; i < pins.length; i++) {
    if (String(pins[i][0]).trim().toLowerCase() === login && String(pins[i][1]).trim() === pin) { good = true; coinName = String(pins[i][3] || '').trim(); break; }
  }
  if (!good) {
    cache.put(key, String(fails + 1), LOCK_SECONDS);
    return { ok: false, error: 'Username or PIN is incorrect.' };
  }
  cache.remove(key);

  var sh = ss.getSheetByName('Gradebook');
  var v = sh.getDataRange().getDisplayValues();
  var head = v[0], poss = v[1];
  var loginCol = head.indexOf('SIS Login ID');
  var row = null;
  for (var r = 2; r < v.length; r++) {
    if (String(v[r][loginCol]).trim().toLowerCase() === login) { row = v[r]; break; }
  }
  if (!row) return { ok: false, error: 'No grades found for this username yet.' };

  var stop = head.indexOf('Assignments Current Points');
  if (stop < 0) stop = head.length;
  var items = [], bonus = [];
  for (var c = 5; c < stop; c++) {
    var name = String(head[c]).replace(/\s*\(\d+\)\s*$/, '').trim();
    var val = String(row[c]).trim();
    if (/asking questions|bonus/i.test(name)) {
      bonus.push({ name: name, points: val === '' ? 0 : Number(val) });
      continue;
    }
    var pp = Number(poss[c]);
    if (!(pp > 0)) continue;                       // 0-point items (sign-ups, surveys) are not graded
    var excused = /^ex$/i.test(val);
    items.push({ name: name, possible: pp, points: (val === '' || excused) ? null : Number(val), excused: excused });
  }
  var coin = coinBonus_(coinName, section);
  if (coin !== null) bonus.push({ name: 'Coin Exchange (live, moves with Bitcoin)', points: coin });
  var parts = String(row[0]).split(',');
  return {
    ok: true,
    name: parts.length > 1 ? parts[1].trim() + ' ' + parts[0].trim() : row[0],
    section: row[4],
    updated: Utilities.formatDate(DriveApp.getFileById(ss.getId()).getLastUpdated(), 'America/New_York', 'MMM d, yyyy h:mm a'),
    items: items,
    bonus: bonus
  };
}

function coinBonus_(coinName, section) {
  if (!coinName) return null;
  try {
    var d = JSON.parse(UrlFetchApp.fetch(COIN_API + '?section=' + section, { muteHttpExceptions: true }).getContentText());
    var L = Number(d.leverage) || 10, idx = Number(d.index);
    for (var i = 0; i < d.students.length; i++) {
      var s = d.students[i];
      if (String(s.name).trim().toLowerCase() !== coinName.toLowerCase()) continue;
      var held = 0;
      for (var j = 0; j < s.coins.length; j++) {
        var base = Number(s.coins[j].base) > 0 ? Number(s.coins[j].base) : 2;
        held += Math.max(0, base * (1 + L * (idx / s.coins[j].entryIndex - 1)));
      }
      return Math.round((Number(s.banked || 0) + held) * 100) / 100;
    }
  } catch (e) {}
  return null;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
