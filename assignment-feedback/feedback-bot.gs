/**
 * SPM 261 — Assignment Feedback bot
 * ---------------------------------
 * Attaches to the "Assignment Feedback" Google Form. On every submission it:
 *   1. reads the student's email, name, chosen assignment, and uploaded file(s)
 *   2. extracts the text (Docs / .docx / Slides / .pptx / .txt) or attaches the PDF
 *   3. asks Gemini to grade it against the rubric below
 *   4. emails a private pre-submission estimate to the student
 *
 * There is no polling. Google's installable onFormSubmit trigger IS the
 * "did someone submit?" check — it fires once per submission.
 *
 * SETUP (one time):
 *   1. Open the form -> three-dot menu -> "Script editor". Paste this file in.
 *   2. Left panel -> Services (+) -> add "Drive API"  (needed to convert .docx/.pptx).
 *   3. Project Settings -> Script Properties -> add:
 *        GEMINI_API_KEY = <key from https://aistudio.google.com/apikey>
 *   4. Triggers (clock icon) -> Add Trigger:
 *        function: onFormSubmit | event source: From form | type: On form submit
 *   5. Run onFormSubmit once from the editor to approve the permission prompts
 *      (it will error with "Cannot read properties of undefined" — that's fine,
 *       it just means there was no live submission; the auth grant is what matters).
 *   6. Optional: set LOG_SHEET_ID below to a spreadsheet you own for an audit log.
 */

/* ================================ CONFIG ================================ */
const GEMINI_MODEL     = 'gemini-3.6-flash';   // 2.5-flash is retired for new keys
const INSTRUCTOR_EMAIL = 'kimjw@arcadia.edu';   // gets error reports
const COPY_INSTRUCTOR  = false;                 // CC instructor on every student email
const LOG_SHEET_ID     = '';                    // '' = no log; else a spreadsheet ID
const SUBJECT_PREFIX   = 'SPM 261 — Assignment Feedback';
const SENDER_NAME      = 'SPM 261 Assignment Feedback';

/* ============================== RUBRICS ================================= */
const RUBRICS = {
  // The Career Planning Portfolio is submitted as TWO separate uploads, each
  // graded out of 2.5. A single submission is scored out of 2.5, never out of 5.
  career_plan: {
    key: 'career_plan',
    title: 'Career Planning Portfolio — Five-Year Career Plan',
    maxScore: 2.5,
    liveOnly: '',
    instructions:
`This upload is ONE part of the Career Planning Portfolio: the Statement of
Five-Year Career Plan (no more than 2 pages), worth 2.5 points on its own. The
resume is submitted separately and is NOT part of this score.

 - Discusses the future career plan clearly.
 - The FIRST year of the plan must be the year the student graduates from Arcadia
   University (e.g., Class of 2026 -> first year in the plan is 2026).
 - Includes a graph or table showing the plan year by year, with a written
   explanation of the steps to success.

Grade ONLY the five-year plan. Do not mention or deduct for a missing resume.
The maximum possible score is 2.5.`,
    rubric:
`Statement of Five-Year Career Plan (max 2.5):
  2.5 — Clearly and specifically articulated year-by-year. First year correctly
        matches the student's Arcadia graduation year. Well-developed graph or
        table with a clear explanation of the steps to success. Within 2 pages.
  2.0 — Present and mostly clear but lacks specificity in some years. Graph/table
        present but underdeveloped or thinly explained. Minor issues with
        first-year logic or length.
  1.0 — Vague or generic; unclear link between steps and goals. Graph/table
        missing or very weak. Or significantly over the 2-page limit.
  0   — No coherent career plan, or the graph/table and explanation are missing.`
  },

  career_resume: {
    key: 'career_resume',
    title: 'Career Planning Portfolio — Resume',
    maxScore: 2.5,
    liveOnly: '',
    instructions:
`This upload is ONE part of the Career Planning Portfolio: the Resume (1 page),
worth 2.5 points on its own. The five-year career plan is submitted separately
and is NOT part of this score.

Grade ONLY the resume. Do not mention or deduct for a missing career plan.
The maximum possible score is 2.5.`,
    rubric:
`Resume (max 2.5):
  2.5 — Current and professional. Clearly organized (contact info, education,
        experience, skills). Free of typos/formatting errors. About 1 page.
  2.0 — Mostly professional and current; minor formatting inconsistencies, small
        errors, or length slightly off from 1 page.
  1.0 — Significant gaps: missing key sections, outdated content, multiple
        errors, or formatting that hurts readability.
  0   — No resume submitted, or not usable as a resume.`
  },

  tech: {
    key: 'tech',
    title: 'Sports Technology Presentation',
    maxScore: 10,
    liveOnly:
`Professionalism & Presentation Style (max 3) is delivered live in class and
cannot be judged from the file. Estimate Content and Adherence to Format only;
for the style category, say it will be assessed during the in-class talk and do
not include it in the expected score total (state the total as "X / 7 gradable
from the file, style assessed live").`,
    instructions:
`Individual 5-minute in-class presentation on how a technology (AI, VR, AR,
metaverse, etc.) will change sports and the business of sports in the next 10
years.

Must include: Title Page, Your Idea, Rationale, Expected outcome/impact
(financial, safety, improvement, etc.), and References (cited sources).

Formatting rules (hard):
 - No more than 5 slides NOT including the title page (so <= 6 slides total).
 - No more than 3 sentences on any slide.
 - Failure to follow the formatting rules = minimum points for the assignment.

Ideas must be the student's own; insight and creativity are the main focus.
Sources should be news or scholarly articles.`,
    rubric:
`Content (max 5):
  5 — Insightful, thoroughly researched, well-supported with credible sources.
      Rationale and expected outcomes are clear and persuasive.
  4 — All required elements present but shallow rationale or outcomes; sources
      present but not well integrated.
  2 — Addresses the topic but missing key elements (rationale or outcomes);
      limited or weak sourcing.
  0 — Incomplete or off-topic; no clear tie to the required elements.

Adherence to Format (max 2):
  2 — Exactly 5 content slides (excluding title), <= 3 sentences per slide,
      title page present.
  0 — Any violation (more than 5 content slides, a slide over 3 sentences, or no
      title page). Per the rules this also caps the whole assignment at minimum
      points — say so explicitly.

Professionalism & Presentation Style (max 3) — assessed live, not from the file.`
  }
};

/* ============================ ENTRY POINT ============================== */
function onFormSubmit(e) {
  const resp = e.response;                 // FormResponse (form-bound trigger)
  const responseId = resp.getId();
  if (isProcessed_(responseId)) return;

  try {
    const sub = parseResponse_(resp);
    if (!sub.assignmentKey) throw new Error('Could not tell which assignment: "' + sub.assignment + '"');
    const rubric = RUBRICS[sub.assignmentKey];

    const material = extractSubmission_(sub.fileIds);
    const ai = callGemini_(rubric, sub, material);
    const body = renderEmail_(rubric, sub, ai);
    const subject = SUBJECT_PREFIX + ': ' + rubric.title + ' (Pre-Submission Estimate)';

    const to = sub.email || INSTRUCTOR_EMAIL;
    const opts = { name: SENDER_NAME };
    if (COPY_INSTRUCTOR && sub.email) opts.cc = INSTRUCTOR_EMAIL;
    GmailApp.sendEmail(to, subject, body, opts);

    log_([new Date(), sub.name, sub.email, rubric.title,
          ai.expectedScore + ' / ' + ai.maxScore, 'sent']);
    markProcessed_(responseId);
  } catch (err) {
    GmailApp.sendEmail(INSTRUCTOR_EMAIL,
      SUBJECT_PREFIX + ' — ERROR on a submission',
      'Response ID: ' + responseId + '\n\n' + (err.stack || err));
    log_([new Date(), '', '', '', '', 'ERROR: ' + err.message]);
  }
}

/* ========================== PARSE RESPONSE ============================ */
function parseResponse_(resp) {
  const out = { email: resp.getRespondentEmail() || '', name: '', assignment: '',
                assignmentKey: '', fileIds: [] };

  resp.getItemResponses().forEach(function (ir) {
    const item  = ir.getItem();
    const title = (item.getTitle() || '').toLowerCase();
    const type  = item.getType();
    const val   = ir.getResponse();

    if (type === FormApp.ItemType.FILE_UPLOAD) {
      out.fileIds = out.fileIds.concat([].concat(val));            // array of file IDs
    } else if (!out.name && title.indexOf('name') > -1) {
      out.name = String(val);
    } else if (!out.email && title.indexOf('email') > -1 && String(val).indexOf('@') > -1) {
      out.email = String(val);
    } else if (title.indexOf('assignment') > -1 || title.indexOf('which') > -1 || title.indexOf('select') > -1) {
      out.assignment = String(val);
    } else if (typeof val === 'string' && /career|resume|five[-\s]?year|5[-\s]?year|sports?\s*technology|presentation/i.test(val)) {
      out.assignment = val;
    }
  });

  // Career Planning Portfolio = two SEPARATE 2.5-pt uploads (plan, resume).
  const a = out.assignment.toLowerCase();
  if (a.indexOf('resume') > -1)                                      out.assignmentKey = 'career_resume';
  else if (a.indexOf('tech') > -1 || a.indexOf('presentation') > -1) out.assignmentKey = 'tech';
  else if (/career|five[-\s]?year|5[-\s]?year|\bplan\b|statement/.test(a)) out.assignmentKey = 'career_plan';
  return out;
}

/* ======================= EXTRACT SUBMISSION ========================== */
function extractSubmission_(fileIds) {
  const texts = [];
  const pdfBlobs = [];
  let slideCount = 0;

  fileIds.forEach(function (id) {
    const file = DriveApp.getFileById(id);
    const mt = file.getMimeType();

    if (mt === MimeType.GOOGLE_DOCS) {
      texts.push(DocumentApp.openById(id).getBody().getText());

    } else if (mt === MimeType.MICROSOFT_WORD ||
               mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const copy = Drive.Files.copy({ name: 'tmp-conv', mimeType: MimeType.GOOGLE_DOCS }, id);
      texts.push(DocumentApp.openById(copy.id).getBody().getText());
      DriveApp.getFileById(copy.id).setTrashed(true);

    } else if (mt === MimeType.GOOGLE_SLIDES) {
      const r = slidesText_(id); texts.push(r.text); slideCount += r.count;

    } else if (mt === MimeType.MICROSOFT_POWERPOINT ||
               mt === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      const copy = Drive.Files.copy({ name: 'tmp-conv', mimeType: MimeType.GOOGLE_SLIDES }, id);
      const r = slidesText_(copy.id); texts.push(r.text); slideCount += r.count;
      DriveApp.getFileById(copy.id).setTrashed(true);

    } else if (mt === MimeType.PDF) {
      pdfBlobs.push(file.getBlob());

    } else if (mt === MimeType.PLAIN_TEXT) {
      texts.push(file.getBlob().getDataAsString());

    } else {
      texts.push('[Unsupported file type ' + mt + ' — ' + file.getName() + ']');
    }
  });

  return { text: texts.join('\n\n----------\n\n'), pdfBlobs: pdfBlobs, slideCount: slideCount };
}

function slidesText_(id) {
  const slides = SlidesApp.openById(id).getSlides();
  const buf = [];
  slides.forEach(function (s, i) {
    const parts = [];
    s.getShapes().forEach(function (sh) {
      try { const t = sh.getText().asString().trim(); if (t) parts.push(t); } catch (e) {}
    });
    s.getNotesPage() && (function () {
      try {
        const n = s.getNotesPage().getSpeakerNotesShape().getText().asString().trim();
        if (n) parts.push('(speaker notes) ' + n);
      } catch (e) {}
    })();
    buf.push('Slide ' + (i + 1) + ':\n' + parts.join('\n'));
  });
  return { text: buf.join('\n\n'), count: slides.length };
}

/* ============================= GEMINI ================================ */
function callGemini_(rubric, sub, material) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Missing Script Property GEMINI_API_KEY');

  const system = [
    'You are a teaching assistant for SPM 261 (Sport Management) at Arcadia University.',
    'Grade the student submission ONLY against the rubric given. Be specific, factual, and constructive; quote or point to concrete parts of the work.',
    'Never use course grades or GPA as evidence. This is a pre-submission ESTIMATE, not an official grade.',
    'Do not invent facts about the student that are not in the submission.',
    rubric.liveOnly,
    'Return STRICT JSON only (no markdown fences), exactly this shape:',
    '{',
    '  "expectedScore": number,',
    '  "maxScore": number,',
    '  "breakdown": [ { "category": string, "points": number, "max": number, "whatWorks": string, "whatToChange": string } ],',
    '  "topPriorities": [ string ],',
    '  "notes": string',
    '}'
  ].filter(String).join('\n');

  const userParts = [{ text: [
    'ASSIGNMENT: ' + rubric.title + '  (out of ' + rubric.maxScore + ' points)',
    '',
    'INSTRUCTIONS:',
    rubric.instructions,
    '',
    'RUBRIC:',
    rubric.rubric,
    '',
    rubric.key === 'tech' ? 'SLIDE COUNT DETECTED IN FILE (including title page): ' + material.slideCount : '',
    '',
    'STUDENT: ' + (sub.name || '(name not provided)'),
    '',
    'SUBMISSION CONTENT (extracted text; a PDF may also be attached below):',
    material.text || '(no extractable text — see attached file)'
  ].filter(String).join('\n') }];

  material.pdfBlobs.forEach(function (b) {
    userParts.push({ inline_data: { mime_type: 'application/pdf',
                                    data: Utilities.base64Encode(b.getBytes()) } });
  });

  const payload = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: userParts }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
  };

  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL +
      ':generateContent?key=' + encodeURIComponent(key),
    { method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true });

  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500));
  }
  const out = JSON.parse(res.getContentText());
  const txt = out.candidates && out.candidates[0].content.parts[0].text;
  if (!txt) throw new Error('Gemini returned no text: ' + res.getContentText().slice(0, 500));
  return JSON.parse(txt);
}

/* ============================ EMAIL BODY ============================= */
function renderEmail_(rubric, sub, ai) {
  const bar = '--------------------------------------------------';
  const L = [];
  L.push('SPM 261 · Sport Management');
  L.push('Assignment Feedback — Pre-Submission Estimate');
  L.push('');
  L.push('Assignment: ' + rubric.title);
  L.push('Student: ' + (sub.name || '(not provided)'));
  L.push('');
  L.push('This is an AI-generated estimate to help you improve your work before you');
  L.push('submit it to Canvas. It is not your official grade, and it does NOT submit');
  L.push('your assignment — you still have to turn it in on Canvas.');
  L.push('');
  L.push('EXPECTED SCORE: ' + ai.expectedScore + ' / ' + ai.maxScore + ' points');
  L.push('');

  (ai.breakdown || []).forEach(function (b) {
    L.push(bar);
    L.push(b.category + ' — ' + b.points + ' / ' + b.max + ' pts');
    L.push(bar);
    if (b.whatWorks)    { L.push("What's working:"); L.push(b.whatWorks); L.push(''); }
    if (b.whatToChange) { L.push('What to change:'); L.push(b.whatToChange); L.push(''); }
  });

  if (ai.topPriorities && ai.topPriorities.length) {
    L.push(bar);
    L.push('Top priorities before you submit to Canvas');
    L.push(bar);
    ai.topPriorities.forEach(function (p, i) { L.push((i + 1) + '. ' + p); });
    L.push('');
  }
  if (ai.notes) { L.push(ai.notes); L.push(''); }

  L.push('Reminder: submit the final version on Canvas — this feedback check does');
  L.push('not do that for you.');
  return L.join('\n');
}

/* ===================== DEDUPE + AUDIT LOG =========================== */
function isProcessed_(id) {
  const seen = JSON.parse(PropertiesService.getScriptProperties().getProperty('SEEN') || '[]');
  return seen.indexOf(id) > -1;
}
function markProcessed_(id) {
  const p = PropertiesService.getScriptProperties();
  let seen = JSON.parse(p.getProperty('SEEN') || '[]');
  seen.push(id);
  if (seen.length > 500) seen = seen.slice(-500);
  p.setProperty('SEEN', JSON.stringify(seen));
}
function log_(row) {
  if (!LOG_SHEET_ID) return;
  try {
    const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
    const sh = ss.getSheetByName('FeedbackLog') || ss.insertSheet('FeedbackLog');
    if (sh.getLastRow() === 0) sh.appendRow(['When', 'Name', 'Email', 'Assignment', 'Score', 'Status']);
    sh.appendRow(row);
  } catch (e) { /* logging must never break the pipeline */ }
}
