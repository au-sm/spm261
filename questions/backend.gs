/**
 * SPM 261 — Slide Questions & Comments
 * -------------------------------------
 * Backend for the "?" button embedded in the lecture decks (week3-1 and
 * on). A student clicks it on any slide, types a question or comment,
 * and it becomes one row in a Google Sheet you can read at your own
 * pace -- tagged with which deck and which slide it came from.
 *
 * One standalone Apps Script project serves every deck on the site.
 *
 * SETUP (one time)
 *  1. Create a Google Sheet to hold submissions (or use an existing one).
 *     Copy its ID out of the URL: the long string between /d/ and /edit.
 *  2. script.google.com -> New project. Paste this file in. Save.
 *  3. Project Settings (gear) -> Script Properties -> add:
 *       SHEET_ID = <the Sheet ID from step 1>
 *  4. Deploy -> New deployment -> type "Web app"
 *       Execute as: Me
 *       Who has access: Anyone            <-- required so students (not signed in) can submit
 *     Deploy, authorize, copy the Web app URL (ends in /exec).
 *  5. Put that URL in SPM261_26/questions/config.js and push.
 *
 * No triggers, no cron. Every submission is a synchronous doPost that
 * appends one row. Open the Sheet any time to read what came in --
 * newest at the bottom, or add a filter/sort to read by deck or slide.
 */

var PROPS = PropertiesService.getScriptProperties();

function doGet(e){
  // Visiting the deployed URL directly in a browser should show this,
  // confirming the backend is live before you wire up the frontend.
  return json_({ ok: true, msg: 'SPM 261 questions backend is live. POST a question to submit one.' });
}

function doPost(e){
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return json_(handle_(body));
}

function handle_(body){
  var lock = LockService.getScriptLock();
  try { lock.waitLock(9000); } catch (err) { return { ok: false, error: 'busy' }; }
  try {
    var text = String(body.question || '').trim().slice(0, 4000);
    if (!text) return { ok: false, error: 'empty_question' };

    appendRow_([
      new Date(),
      String(body.deck || '').slice(0, 160),
      body.slideIndex === '' || body.slideIndex == null ? '' : Number(body.slideIndex),
      String(body.slideTitle || '').slice(0, 200),
      text,
      String(body.name || 'Anonymous').trim().slice(0, 120) || 'Anonymous'
    ]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function appendRow_(row){
  var id = PROPS.getProperty('SHEET_ID');
  if (!id) throw new Error('Missing Script Property SHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName('Questions') || ss.insertSheet('Questions');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['When', 'Deck', 'Slide #', 'Slide Title', 'Question / Comment', 'Name']);
    sh.setFrozenRows(1);
  }
  sh.appendRow(row);
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
