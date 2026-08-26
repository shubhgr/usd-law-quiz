// USD Knowledge Challenge — Google Sheets backend
//
// Registration  → lead capture ONLY (name, email, phone + lead-gen fields)
// Responses     → ALL quiz product data (answers, score, time, completedAt)
//
// Product reads (resume / progress / leaderboard) use Responses first.
// Deploy: Deploy > New deployment > Web app
//   Execute as: Me | Who has access: Anyone
// Set Script Property API_KEY to match GAS_API_KEY in Next.js (.env.local)

var TOTAL_QUESTIONS = 26;
var TAB_SWITCH_LIMIT = 5;
var QUIZ_TIME_LIMIT_SECONDS = 45 * 60;
// Must match lib/answerKey.ts CORRECT values (pipe-separated; multi-select is concatenated letters).
var CORRECT_KEY = "b|b|b|c|b|c|c|a|b|b|b|b|b|c|c|b|ab|b|c|a|ab|b|a|a|bd|bcd";

var REG_HEADERS = [
  "pid",
  "name",
  "email",
  "phone",
  "workExperience",
  "domain",
  "linkedinUrl",
  "bestDescribeYou",
  "considerMasters",
  "planningYear",
  "interestsMost",
  "status",
  "registeredAt",
  "lastActivityAt",
  "completionTimeSeconds",
  "completedAt",
  "tabSwitches",
  "quizStartedAt",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "pageUrl",
  "collegeName",
];
// Product source of truth for quiz UX:
var RESP_HEADERS = [
  "pid", "name", "email", "answers", "score",
  "completionTimeSeconds", "completedAt",
];

// Column indexes are 1-based for getRange/setValue.
var REG_STATUS = 12; // status
var REG_REGISTERED_AT = 13; // registeredAt
var REG_LAST = 14; // lastActivityAt
var REG_TAB_SWITCHES = 17; // tabSwitches
var REG_QUIZ_STARTED_AT = 18; // quizStartedAt
var REG_UTM_SOURCE = 19;
var REG_UTM_MEDIUM = 20;
var REG_UTM_CAMPAIGN = 21;
var REG_UTM_TERM = 22;
var REG_UTM_CONTENT = 23;
var REG_UTM_ID = 24;
var REG_PAGE_URL = 25;
var REG_COLLEGE_NAME = 26;
var RESP_ANSWERS = 4;
var RESP_SCORE = 5;
var RESP_TIME = 6;
var RESP_COMPLETED = 7;

function doGet(e) {
  return handle(e);
}

function doPost(e) {
  return handle(e);
}

function handle(e) {
  var params = e.parameter || {};
  var action = String(params.action || "");
  var lock = null;
  // Read-only actions skip the exclusive lock so Continue/leaderboard
  // aren't stuck behind register/saveAnswers.
  var needsLock =
    action === "register" ||
    action === "saveAnswers" ||
    action === "clearResponses" ||
    action === "submit" ||
    action === "tabSwitch" ||
    action === "quizStart";
  if (needsLock) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(8000)) {
      return json({
        ok: false,
        code: "BUSY",
        error: "Server busy, please retry in a moment.",
      });
    }
  }
  try {
    ensureSetup();
    var authErr = checkAuth(params);
    if (authErr) return json(authErr);

    var result;
    switch (action) {
      case "register":       result = actionRegister(params); break;
      case "resume":         result = actionResume(params); break;
      case "getProgress":    result = actionGetProgress(params); break;
      case "saveAnswers":    result = actionSaveAnswers(params); break;
      case "clearResponses": result = actionClearResponses(params); break;
      case "submit":         result = actionSubmit(params); break;
      case "tabSwitch":      result = actionTabSwitch(params); break;
      case "quizStart":      result = actionQuizStart(params); break;
      case "leaderboard":    result = actionLeaderboard(params); break;
      default:
        result = { ok: false, code: "UNKNOWN_ACTION", error: "Unknown action: " + action };
    }
    return json(result);
  } catch (err) {
    return json({ ok: false, code: "ERROR", error: String(err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function checkAuth(params) {
  var expected = PropertiesService.getScriptProperties().getProperty("API_KEY");
  if (!expected) return null;
  if (String(params.key || "") !== expected) {
    return { ok: false, code: "UNAUTHORIZED", error: "Invalid API key" };
  }
  return null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Setup & schema ----

function ensureSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reg = ss.getSheetByName("Registration");
  if (!reg) reg = ss.insertSheet("Registration");
  ensureHeader(reg, REG_HEADERS);

  migrateResponsesSheetIfNeeded(ss);
  var resp = ss.getSheetByName("Responses");
  if (!resp) resp = ss.insertSheet("Responses");
  ensureHeader(resp, RESP_HEADERS);
  backfillResponseTimesFromRegistration(ss);
}

/** One-time: copy completion time from Registration into Responses for old rows. */
function backfillResponseTimesFromRegistration(ss) {
  var respSheet = ss.getSheetByName("Responses");
  var regSheet = ss.getSheetByName("Registration");
  if (!respSheet || !regSheet) return;
  var respLast = respSheet.getLastRow();
  var regLast = regSheet.getLastRow();
  if (respLast < 2 || regLast < 2) return;

  var regData = regSheet.getRange(2, 1, regLast - 1, 11).getValues();
  var regByPid = {};
  for (var i = 0; i < regData.length; i++) {
    regByPid[String(regData[i][0])] = regData[i];
  }

  var respData = respSheet.getRange(2, 1, respLast - 1, RESP_HEADERS.length).getValues();
  for (var r = 0; r < respData.length; r++) {
    var row = respData[r];
    if (!hasScore(row)) continue;
    var timeEmpty = row[RESP_TIME - 1] === "" || row[RESP_TIME - 1] === null || row[RESP_TIME - 1] === undefined;
    var completedEmpty = row[RESP_COMPLETED - 1] === "" || row[RESP_COMPLETED - 1] === null || row[RESP_COMPLETED - 1] === undefined;
    if (!timeEmpty && !completedEmpty) continue;
    var reg = regByPid[String(row[0])];
    if (!reg) continue;
    var sheetRow = r + 2;
    if (timeEmpty && reg[9] !== "" && reg[9] !== null && reg[9] !== undefined) {
      respSheet.getRange(sheetRow, RESP_TIME).setValue(Number(reg[9] || 0));
    }
    if (completedEmpty && reg[10]) {
      respSheet.getRange(sheetRow, RESP_COMPLETED).setValue(reg[10]);
    }
  }
}

/** Old deployments used q1..q28 columns. Archive that tab and start fresh. */
function migrateResponsesSheetIfNeeded(ss) {
  var resp = ss.getSheetByName("Responses");
  if (!resp || resp.getLastRow() === 0) return;

  var col4Header = String(resp.getRange(1, 4).getValue()).trim();
  if (col4Header === "answers") return;

  if (col4Header === "q1" || resp.getLastColumn() > 12) {
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
    resp.setName("Responses_old_" + stamp);
  }
}

function ensureHeader(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  var first = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var ok = first.length === headers.length;
  if (ok) {
    for (var i = 0; i < headers.length; i++) {
      if (String(first[i]) !== headers[i]) { ok = false; break; }
    }
  }
  if (!ok) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

// ---- Lookups ----

function findRow(sheet, col, value) {
  var data = sheet.getDataRange().getValues();
  var needle = String(value).toLowerCase();
  for (var i = 1; i < data.length; i++) {
    var cell = data[i][col - 1];
    if (cell !== null && cell !== undefined && String(cell).toLowerCase() === needle) {
      return { row: i + 1, values: data[i] };
    }
  }
  return null;
}

function findRegistrationByPid(ss, pid) {
  return findRow(ss.getSheetByName("Registration"), 1, pid);
}

function findRegistrationByEmail(ss, email) {
  return findRow(ss.getSheetByName("Registration"), 3, email);
}

function findResponseRowByPid(ss, pid) {
  return findRow(ss.getSheetByName("Responses"), 1, pid);
}

function findResponseRowByEmail(ss, email) {
  return findRow(ss.getSheetByName("Responses"), 3, email);
}

function iso(v) {
  try {
    if (v === null || v === undefined || v === "") return null;
    var d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toISOString();
  } catch (e) {
    return String(v);
  }
}

function hasScore(values) {
  var sc = values[RESP_SCORE - 1];
  return sc !== "" && sc !== null && sc !== undefined;
}

function scorePayload(values) {
  if (!hasScore(values)) return null;
  return {
    totalScore: Number(values[RESP_SCORE - 1]),
    completionTimeSeconds: Number(values[RESP_TIME - 1] || 0),
    completedAt: iso(values[RESP_COMPLETED - 1]),
  };
}

function ensureResponseRow(ss, reg) {
  var sheet = ss.getSheetByName("Responses");
  var pid = String(reg.values[0]);
  var resp = findResponseRowByPid(ss, pid);
  if (!resp) {
    sheet.appendRow([
      pid,
      String(reg.values[1]),
      String(reg.values[2]),
      "",
      "",
      "",
      "",
    ]);
    resp = findResponseRowByPid(ss, pid);
  }
  return { sheet: sheet, resp: resp };
}

// ---- Answer string helpers ----

function questionIdAt(index) {
  return "q" + (index + 1);
}

function normalizeAnswers(raw) {
  return String(raw || "").trim().toLowerCase();
}

function splitAnswers(raw) {
  var s = normalizeAnswers(raw);
  if (!s) return [];
  if (s.indexOf("|") >= 0) {
    var parts = s.split("|");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = String(parts[i] || "").replace(/[^a-f]/g, "").split("").sort().join("");
      out.push(p);
    }
    return out;
  }
  var chars = [];
  for (var j = 0; j < s.length; j++) {
    if (/^[a-f]$/.test(s.charAt(j))) chars.push(s.charAt(j));
  }
  return chars;
}

function correctParts() {
  return String(CORRECT_KEY).split("|");
}

function validateAnswers(answers) {
  if (!answers) return "answers is required";
  var parts = splitAnswers(answers);
  if (parts.length > TOTAL_QUESTIONS) return "answers string is too long";
  if (answers.indexOf("|") >= 0) {
    if (!/^[a-f]*(\|[a-f]*)*$/.test(normalizeAnswers(answers))) {
      return "answers must be a-f letters separated by |";
    }
  } else if (!/^[a-f]+$/.test(normalizeAnswers(answers))) {
    return "answers must be only a–f";
  }
  return null;
}

function scoreFromAnswers(answers) {
  var parts = splitAnswers(answers);
  var key = correctParts();
  var total = 0;
  for (var i = 0; i < key.length; i++) {
    if (parts[i] === key[i]) total++;
  }
  return total;
}

function responsesFromString(answerStr) {
  var parts = splitAnswers(answerStr);
  var out = [];
  for (var i = 0; i < parts.length && i < TOTAL_QUESTIONS; i++) {
    out.push({
      questionId: questionIdAt(i),
      answer: parts[i],
      answeredAt: null,
    });
  }
  return out;
}

function answersComplete(answers) {
  var parts = splitAnswers(answers);
  if (parts.length !== TOTAL_QUESTIONS) return false;
  var key = correctParts();
  for (var i = 0; i < TOTAL_QUESTIONS; i++) {
    if (!parts[i] || parts[i].length !== key[i].length) return false;
  }
  return true;
}

function quizElapsedSeconds(startMs, nowMs) {
  return Math.min(
    QUIZ_TIME_LIMIT_SECONDS,
    Math.max(0, Math.round((nowMs - startMs) / 1000))
  );
}

function isQuizTimeExpired(startMs, nowMs) {
  return quizElapsedSeconds(startMs, nowMs) >= QUIZ_TIME_LIMIT_SECONDS;
}

function readStartMs(reg) {
  var startedAt = reg.values[REG_QUIZ_STARTED_AT - 1] || reg.values[REG_REGISTERED_AT - 1];
  var startMs = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
  if (isNaN(startMs)) startMs = Date.now();
  return startMs;
}

function markCompleted(reg, rowInfo, answers) {
  var now = new Date();
  var totalScore = scoreFromAnswers(answers);
  var startMs = readStartMs(reg);
  var completionTimeSeconds = quizElapsedSeconds(startMs, now.getTime());

  // Write ALL quiz completion data to Responses (product source of truth).
  rowInfo.sheet.getRange(rowInfo.resp.row, RESP_SCORE).setValue(totalScore);
  rowInfo.sheet.getRange(rowInfo.resp.row, RESP_TIME).setValue(completionTimeSeconds);
  rowInfo.sheet.getRange(rowInfo.resp.row, RESP_COMPLETED).setValue(now);

  // Lead sheet: status only (CRM), not used by quiz UI.
  var rs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Registration");
  rs.getRange(reg.row, REG_STATUS).setValue("completed");
  rs.getRange(reg.row, REG_LAST).setValue(now);

  return {
    ok: true,
    completed: true,
    totalScore: totalScore,
    completionTimeSeconds: completionTimeSeconds,
    completedAt: now.toISOString(),
  };
}

/** Build ranked entries from Responses only (one sheet read). */
function buildLeaderboardEntries(ss) {
  var respSheet = ss.getSheetByName("Responses");
  var respLast = respSheet.getLastRow();
  if (respLast < 2) return [];

  var respRows = respLast - 1;
  var respData = respSheet.getRange(2, 1, respRows, RESP_HEADERS.length).getValues();
  var entries = [];

  for (var i = 0; i < respData.length; i++) {
    var r = respData[i];
    if (!hasScore(r)) continue;
    entries.push({
      pid: String(r[0]),
      name: String(r[1]),
      email: String(r[2] || "").toLowerCase(),
      totalScore: Number(r[RESP_SCORE - 1]),
      completionTimeSeconds: Number(r[RESP_TIME - 1] || 0),
      completedAt: iso(r[RESP_COMPLETED - 1]),
    });
  }

  entries.sort(function (a, b) {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    if (a.completionTimeSeconds !== b.completionTimeSeconds) {
      return a.completionTimeSeconds - b.completionTimeSeconds;
    }
    if ((a.completedAt || "") < (b.completedAt || "")) return -1;
    if ((a.completedAt || "") > (b.completedAt || "")) return 1;
    return 0;
  });

  return entries;
}

function findRank(entries, pid, email) {
  for (var j = 0; j < entries.length; j++) {
    if (pid && entries[j].pid === pid) return j + 1;
    if (email && entries[j].email === email) return j + 1;
  }
  return null;
}

// ---- Actions ----

function readTabSwitches(reg) {
  if (!reg) return 0;
  return Math.max(0, Math.trunc(Number(reg.values[REG_TAB_SWITCHES - 1] || 0)));
}

function readQuizStartedAt(reg) {
  if (!reg) return null;
  return iso(reg.values[REG_QUIZ_STARTED_AT - 1]);
}

function isTabBlockedCount(count) {
  return count >= TAB_SWITCH_LIMIT;
}

function blockedPayload(reg) {
  return {
    ok: true,
    blocked: true,
    tabSwitches: readTabSwitches(reg),
    existing: true,
    pid: String(reg.values[0]),
    name: String(reg.values[1]),
    email: String(reg.values[2]),
    status: "blocked",
    score: null,
    answers: "",
    rank: null,
    registeredAt: iso(reg.values[REG_REGISTERED_AT - 1]),
    lastActivityAt: iso(reg.values[REG_LAST - 1]),
  };
}

function readUtmValue(params, key) {
  var v = params[key];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function utmRowValues(params) {
  return [
    readUtmValue(params, "utm_source"),
    readUtmValue(params, "utm_medium"),
    readUtmValue(params, "utm_campaign"),
    readUtmValue(params, "utm_term"),
    readUtmValue(params, "utm_content"),
    readUtmValue(params, "utm_id"),
    readUtmValue(params, "pageUrl"),
  ];
}

function writeUtmColumns(sheet, row, params) {
  var values = utmRowValues(params);
  // Only overwrite when at least one UTM / pageUrl is present.
  var hasAny = false;
  for (var i = 0; i < values.length; i++) {
    if (values[i]) { hasAny = true; break; }
  }
  if (!hasAny) return;
  sheet.getRange(row, REG_UTM_SOURCE, 1, values.length).setValues([values]);
}

function actionRegister(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  var email = String(params.email || "").trim().toLowerCase();
  if (!pid || !email) {
    return { ok: false, code: "BAD_REQUEST", error: "pid and email are required" };
  }

  // If they already finished, prefer Responses (product data).
  var existingResp = findResponseRowByEmail(ss, email);
  if (existingResp && hasScore(existingResp.values)) {
    var completedReg = findRegistrationByEmail(ss, email) || findRegistrationByPid(ss, String(existingResp.values[0]));
    if (completedReg && isTabBlockedCount(readTabSwitches(completedReg))) {
      return blockedPayload(completedReg);
    }
    if (completedReg) {
      writeUtmColumns(ss.getSheetByName("Registration"), completedReg.row, params);
    }
    var entries = buildLeaderboardEntries(ss);
    return {
      ok: true,
      existing: true,
      pid: String(existingResp.values[0]),
      name: String(existingResp.values[1]),
      email: email,
      status: "completed",
      score: scorePayload(existingResp.values),
      rank: findRank(entries, String(existingResp.values[0]), email),
      registeredAt: null,
      lastActivityAt: iso(existingResp.values[RESP_COMPLETED - 1]),
      tabSwitches: completedReg ? readTabSwitches(completedReg) : 0,
      quizStartedAt: completedReg ? readQuizStartedAt(completedReg) : null,
      blocked: false,
    };
  }

  var existing = findRegistrationByEmail(ss, email);
  if (existing) {
    if (isTabBlockedCount(readTabSwitches(existing))) {
      return blockedPayload(existing);
    }
    var rsExisting = ss.getSheetByName("Registration");
    writeUtmColumns(rsExisting, existing.row, params);
    // Keep profile fields fresh on re-register.
    rsExisting.getRange(existing.row, 2).setValue(String(params.name || existing.values[1] || ""));
    rsExisting.getRange(existing.row, 4).setValue(String(params.phone || existing.values[3] || ""));
    rsExisting.getRange(existing.row, 7).setValue(String(params.linkedinUrl || existing.values[6] || ""));
    rsExisting.getRange(existing.row, 8).setValue(String(params.bestDescribeYou || existing.values[7] || ""));
    rsExisting.getRange(existing.row, 9).setValue(String(params.considerMasters || existing.values[8] || ""));
    rsExisting.getRange(existing.row, 10).setValue(String(params.planningYear || existing.values[9] || ""));
    rsExisting.getRange(existing.row, 11).setValue(String(params.interestsMost || existing.values[10] || ""));
    rsExisting.getRange(existing.row, REG_COLLEGE_NAME).setValue(String(params.collegeName || existing.values[REG_COLLEGE_NAME - 1] || ""));
    return {
      ok: true,
      existing: true,
      pid: String(existing.values[0]),
      name: String(existing.values[1]),
      email: String(existing.values[2]),
      status: String(existing.values[REG_STATUS - 1]),
      registeredAt: iso(existing.values[REG_REGISTERED_AT - 1]),
      lastActivityAt: iso(existing.values[REG_LAST - 1]),
      tabSwitches: readTabSwitches(existing),
      quizStartedAt: readQuizStartedAt(existing),
      blocked: false,
    };
  }

  var now = new Date();
  var utmVals = utmRowValues(params);
  ss.getSheetByName("Registration").appendRow([
    pid,
    String(params.name || ""),
    email,
    String(params.phone || ""),
    String(params.workExperience || ""),
    String(params.domain || ""),
    String(params.linkedinUrl || ""),
    String(params.bestDescribeYou || ""),
    String(params.considerMasters || ""),
    String(params.planningYear || ""),
    String(params.interestsMost || ""),
    "not_started",
    now,
    now,
    "",
    "",
    0,
    "",
    utmVals[0],
    utmVals[1],
    utmVals[2],
    utmVals[3],
    utmVals[4],
    utmVals[5],
    utmVals[6],
    String(params.collegeName || ""),
  ]);

  return {
    ok: true,
    existing: false,
    pid: pid,
    name: String(params.name || ""),
    email: email,
    status: "not_started",
    registeredAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    quizStartedAt: null,
  };
}

function actionResume(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var email = String(params.email || "").trim().toLowerCase();
  if (!email) return { ok: false, code: "BAD_REQUEST", error: "Email is required" };

  var found = findRegistrationByEmail(ss, email);
  if (found && isTabBlockedCount(readTabSwitches(found))) {
    return blockedPayload(found);
  }

  // Product path: Responses first (score + time + rank in one sheet pass).
  var resp = findResponseRowByEmail(ss, email);
  if (resp) {
    var answerStr = normalizeAnswers(resp.values[RESP_ANSWERS - 1]);
    var score = scorePayload(resp.values);
    var status = score ? "completed" : answerStr ? "in_progress" : "not_started";
    var entries = score ? buildLeaderboardEntries(ss) : [];
    var rank = score ? findRank(entries, String(resp.values[0]), email) : null;

    return {
      ok: true,
      pid: String(resp.values[0]),
      name: String(resp.values[1]),
      email: email,
      status: status,
      answers: answerStr,
      score: score,
      rank: rank,
      registeredAt: null,
      lastActivityAt: score
        ? iso(resp.values[RESP_COMPLETED - 1])
        : null,
      tabSwitches: found ? readTabSwitches(found) : 0,
      quizStartedAt: found ? readQuizStartedAt(found) : null,
      blocked: false,
    };
  }

  // Lead-only: registered but never answered — still need pid to continue quiz.
  if (!found) {
    return { ok: false, code: "NOT_FOUND", error: "No registration found for this email." };
  }

  return {
    ok: true,
    pid: String(found.values[0]),
    name: String(found.values[1]),
    email: String(found.values[2]),
    status: String(found.values[REG_STATUS - 1] || "not_started"),
    answers: "",
    score: null,
    rank: null,
    registeredAt: iso(found.values[REG_REGISTERED_AT - 1]),
    lastActivityAt: iso(found.values[REG_LAST - 1]),
    tabSwitches: readTabSwitches(found),
    quizStartedAt: readQuizStartedAt(found),
    blocked: false,
  };
}

function actionGetProgress(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  if (!pid) return { ok: false, code: "BAD_REQUEST", error: "pid is required" };

  var resp = findResponseRowByPid(ss, pid);
  if (resp) {
    var answerStr = normalizeAnswers(resp.values[RESP_ANSWERS - 1]);
    var score = scorePayload(resp.values);
    var status = score ? "completed" : answerStr ? "in_progress" : "not_started";
    var entries = score ? buildLeaderboardEntries(ss) : [];
    var regForStart = findRegistrationByPid(ss, pid);
    return {
      ok: true,
      pid: pid,
      name: String(resp.values[1]),
      email: String(resp.values[2]),
      status: status,
      registeredAt: null,
      lastActivityAt: score ? iso(resp.values[RESP_COMPLETED - 1]) : null,
      responses: responsesFromString(answerStr),
      score: score,
      rank: score ? findRank(entries, pid, String(resp.values[2] || "").toLowerCase()) : null,
      quizStartedAt: readQuizStartedAt(regForStart),
    };
  }

  var reg = findRegistrationByPid(ss, pid);
  if (!reg) return { ok: false, code: "NOT_FOUND", error: "Participant not found" };

  return {
    ok: true,
    pid: pid,
    name: String(reg.values[1]),
    email: String(reg.values[2]),
    status: String(reg.values[REG_STATUS - 1]),
    registeredAt: iso(reg.values[REG_REGISTERED_AT - 1]),
    lastActivityAt: iso(reg.values[REG_LAST - 1]),
    responses: [],
    score: null,
    rank: null,
    quizStartedAt: readQuizStartedAt(reg),
  };
}

function actionSaveAnswers(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  var answers = normalizeAnswers(params.answers);

  if (!pid) return { ok: false, code: "BAD_REQUEST", error: "pid is required" };

  var err = validateAnswers(answers);
  if (err) return { ok: false, code: "BAD_REQUEST", error: err };

  var reg = findRegistrationByPid(ss, pid);
  if (!reg) return { ok: false, code: "NOT_FOUND", error: "Participant not found" };

  var existingResp = findResponseRowByPid(ss, pid);
  if (existingResp && hasScore(existingResp.values)) {
    return { ok: false, code: "ALREADY_COMPLETED", error: "Quiz already completed" };
  }

  var rowInfo = ensureResponseRow(ss, reg);
  var now = new Date();
  rowInfo.sheet.getRange(rowInfo.resp.row, RESP_ANSWERS).setValue(answers);
  rowInfo.sheet.getRange(rowInfo.resp.row, 2).setValue(String(reg.values[1]));
  rowInfo.sheet.getRange(rowInfo.resp.row, 3).setValue(String(reg.values[2]));

  var rs = ss.getSheetByName("Registration");
  rs.getRange(reg.row, REG_STATUS).setValue("in_progress");
  rs.getRange(reg.row, REG_LAST).setValue(now);

  var startMs = readStartMs(reg);
  if (answersComplete(answers) || isQuizTimeExpired(startMs, now.getTime())) {
    return markCompleted(reg, rowInfo, answers);
  }

  return { ok: true, completed: false };
}

function actionClearResponses(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  var resp = findResponseRowByPid(ss, pid);

  if (resp) {
    var sheet = ss.getSheetByName("Responses");
    sheet.getRange(resp.row, RESP_ANSWERS).setValue("");
    sheet.getRange(resp.row, RESP_SCORE).setValue("");
    sheet.getRange(resp.row, RESP_TIME).setValue("");
    sheet.getRange(resp.row, RESP_COMPLETED).setValue("");
  }

  var reg = findRegistrationByPid(ss, pid);
  if (reg) {
    var rs = ss.getSheetByName("Registration");
    rs.getRange(reg.row, REG_STATUS).setValue("not_started");
    rs.getRange(reg.row, REG_LAST).setValue(new Date());
    rs.getRange(reg.row, REG_QUIZ_STARTED_AT).setValue("");
  }

  return { ok: true };
}

function actionTabSwitch(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  if (!pid) return { ok: false, code: "BAD_REQUEST", error: "pid is required" };
  var count = Math.max(0, Math.trunc(Number(params.count || 0)));
  var reg = findRegistrationByPid(ss, pid);
  if (!reg) return { ok: false, code: "NOT_FOUND", error: "Participant not found" };
  var rs = ss.getSheetByName("Registration");
  rs.getRange(reg.row, REG_TAB_SWITCHES).setValue(count);
  var blocked = isTabBlockedCount(count);
  if (blocked) {
    rs.getRange(reg.row, REG_STATUS).setValue("blocked");
  }
  return { ok: true, tabSwitches: count, blocked: blocked };
}

function actionQuizStart(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  if (!pid) return { ok: false, code: "BAD_REQUEST", error: "pid is required" };
  var reg = findRegistrationByPid(ss, pid);
  if (!reg) return { ok: false, code: "NOT_FOUND", error: "Participant not found" };

  var existing = reg.values[REG_QUIZ_STARTED_AT - 1];
  if (existing) {
    return {
      ok: true,
      quizStartedAt: iso(existing),
      alreadyStarted: true,
    };
  }

  var now = new Date();
  var rs = ss.getSheetByName("Registration");
  rs.getRange(reg.row, REG_QUIZ_STARTED_AT).setValue(now);
  rs.getRange(reg.row, REG_LAST).setValue(now);
  var status = String(reg.values[REG_STATUS - 1] || "not_started");
  if (status === "not_started") {
    rs.getRange(reg.row, REG_STATUS).setValue("in_progress");
  }
  return {
    ok: true,
    quizStartedAt: now.toISOString(),
    alreadyStarted: false,
  };
}

function actionSubmit(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  var reg = findRegistrationByPid(ss, pid);
  if (!reg) return { ok: false, code: "NOT_FOUND", error: "Participant not found" };

  var resp = findResponseRowByPid(ss, pid);
  if (!resp) return { ok: false, code: "INCOMPLETE", error: "Not all questions have been answered" };

  if (hasScore(resp.values)) {
    var scored = scorePayload(resp.values);
    return {
      ok: true,
      alreadyCompleted: true,
      totalScore: scored.totalScore,
      completionTimeSeconds: scored.completionTimeSeconds,
      completedAt: scored.completedAt,
    };
  }

  var answerStr = normalizeAnswers(resp.values[RESP_ANSWERS - 1]);
  var startMs = readStartMs(reg);
  if (!answersComplete(answerStr) && !isQuizTimeExpired(startMs, Date.now())) {
    return { ok: false, code: "INCOMPLETE", error: "Not all questions have been answered" };
  }

  var rowInfo = { sheet: ss.getSheetByName("Responses"), resp: resp };
  var result = markCompleted(reg, rowInfo, answerStr);
  result.alreadyCompleted = false;
  return result;
}

function actionLeaderboard(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  var email = String(params.email || "").trim().toLowerCase();
  var limit = Math.min(100, Math.max(1, Math.trunc(Number(params.limit || 20))));

  var entries = buildLeaderboardEntries(ss);
  var topEntries = entries.slice(0, limit).map(function (e) {
    return {
      pid: e.pid,
      name: e.name,
      totalScore: e.totalScore,
      completionTimeSeconds: e.completionTimeSeconds,
      completedAt: e.completedAt,
    };
  });

  var me = null;
  var rank = findRank(entries, pid, email);
  if (rank) {
    var e = entries[rank - 1];
    me = {
      rank: rank,
      totalScore: e.totalScore,
      completionTimeSeconds: e.completionTimeSeconds,
      completedAt: e.completedAt,
    };
  }

  return { ok: true, topEntries: topEntries, me: me };
}
