/**
 * SPM 261 — Slide Questions & Comments
 * -------------------------------------
 * Backend for the "?" button embedded in the lecture decks (week3-1 and
 * on). A student clicks it on any slide, types a question or comment,
 * and it becomes one row in a Google Sheet you can read at your own
 * pace -- tagged with which deck and which slide it came from. You also
 * get an immediate email so you don't have to keep the Sheet open.
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
 * UPDATING AN EXISTING DEPLOYMENT (e.g. after this email-notification
 * change was added): paste the new code into the same script project,
 * Save, then Deploy -> Manage deployments -> pencil icon on the active
 * deployment -> Version: "New version" -> Deploy. This keeps the same
 * /exec URL, so config.js does NOT need to change.
 *
 * No triggers, no cron. Every submission is a synchronous doPost that
 * appends one row and sends one email. Open the Sheet any time to read
 * the full history -- newest at the bottom, or add a filter/sort to
 * read by deck or slide.
 */

var NOTIFY_EMAIL = 'kimjw@arcadia.edu';   // gets an email on every submission
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

    var deck = String(body.deck || '').slice(0, 160);
    var slideIndex = body.slideIndex === '' || body.slideIndex == null ? '' : Number(body.slideIndex);
    var slideTitle = String(body.slideTitle || '').slice(0, 200);
    var name = String(body.name || 'Anonymous').trim().slice(0, 120) || 'Anonymous';

    appendRow_([new Date(), deck, slideIndex, slideTitle, text, name]);
    notify_(deck, slideIndex, slideTitle, text, name);
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

function notify_(deck, slideIndex, slideTitle, text, name){
  if (!NOTIFY_EMAIL) return;
  try {
    var subject = 'SPM261 question — ' + (deck || 'a deck') + ', slide ' + slideIndex;
    var body = [
      'From: ' + name,
      'Deck: ' + (deck || '(not sent)'),
      'Slide: ' + slideIndex + (slideTitle ? ' — ' + slideTitle : ''),
      '',
      text
    ].join('\n');
    MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
  } catch (e) {
    // a failed notification email must never break the student's submission
  }
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
