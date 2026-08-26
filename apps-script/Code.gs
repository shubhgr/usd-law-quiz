// USD Law Quiz - Google Sheets STORE ONLY
// Backend (Next.js + Postgres) owns scoring, timers, and quiz logic.
// This script only writes/reads rows the backend sends.
//
// Deploy: Deploy > New deployment > Web app
//   Execute as: Me | Who has access: Anyone
// Script Property API_KEY must match GAS_API_KEY in .env.local

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

var RESP_HEADERS = [
  "pid",
  "name",
  "email",
  "answers",
  "score",
  "completionTimeSeconds",
  "completedAt",
];

var REG_STATUS = 12;
var REG_REGISTERED_AT = 13;
var REG_LAST = 14;
var REG_COMPLETION_TIME = 15;
var REG_COMPLETED_AT = 16;
var REG_TAB_SWITCHES = 17;
var REG_QUIZ_STARTED_AT = 18;
var REG_UTM_SOURCE = 19;
var REG_COLLEGE_NAME = 26;

function doGet(e) {
  return handle(e);
}

function doPost(e) {
  return handle(e);
}

function handle(e) {
  var params = e.parameter || {};
  var action = String(params.action || "");
  try {
    ensureSetup();
    var authErr = checkAuth(params);
    if (authErr) return json(authErr);

    var result;
    switch (action) {
      case "register":
        result = actionRegister(params);
        break;
      case "saveAnswers":
        result = actionSaveAnswers(params);
        break;
      case "submit":
        result = actionSubmit(params);
        break;
      case "tabSwitch":
        result = actionTabSwitch(params);
        break;
      case "quizStart":
        result = actionQuizStart(params);
        break;
      case "resume":
        result = actionResume(params);
        break;
      case "getProgress":
        result = actionGetProgress(params);
        break;
      case "leaderboard":
        result = actionLeaderboard(params);
        break;
      case "clearResponses":
        result = actionClearResponses(params);
        break;
      default:
        result = {
          ok: false,
          code: "UNKNOWN_ACTION",
          error: "Unknown action: " + action,
        };
    }
    return json(result);
  } catch (err) {
    return json({ ok: false, code: "ERROR", error: String(err) });
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
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function ensureSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reg = ss.getSheetByName("Registration");
  if (!reg) reg = ss.insertSheet("Registration");
  ensureHeader(reg, REG_HEADERS);

  var resp = ss.getSheetByName("Responses");
  if (!resp) resp = ss.insertSheet("Responses");
  ensureHeader(resp, RESP_HEADERS);
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
      if (String(first[i]) !== headers[i]) {
        ok = false;
        break;
      }
    }
  }
  if (!ok) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function findRow(sheet, col, value) {
  var data = sheet.getDataRange().getValues();
  var needle = String(value).toLowerCase();
  for (var i = 1; i < data.length; i++) {
    var cell = data[i][col - 1];
    if (
      cell !== null &&
      cell !== undefined &&
      String(cell).toLowerCase() === needle
    ) {
      return { row: i + 1, values: data[i] };
    }
  }
  return null;
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
  var hasAny = false;
  for (var i = 0; i < values.length; i++) {
    if (values[i]) {
      hasAny = true;
      break;
    }
  }
  if (!hasAny) return;
  sheet.getRange(row, REG_UTM_SOURCE, 1, values.length).setValues([values]);
}

/** Upsert Registration row - values come from backend. */
function actionRegister(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Registration");
  var pid = String(params.pid || "");
  var email = String(params.email || "")
    .trim()
    .toLowerCase();
  if (!pid || !email) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      error: "pid and email are required",
    };
  }

  var existing = findRow(sheet, 3, email);
  var now = new Date();
  var status = String(params.status || "not_started");

  if (existing) {
    sheet.getRange(existing.row, 2).setValue(String(params.name || existing.values[1] || ""));
    sheet.getRange(existing.row, 4).setValue(String(params.phone || existing.values[3] || ""));
    sheet.getRange(existing.row, 5).setValue(String(params.workExperience || existing.values[4] || ""));
    sheet.getRange(existing.row, 6).setValue(String(params.domain || existing.values[5] || ""));
    sheet.getRange(existing.row, 7).setValue(String(params.linkedinUrl || existing.values[6] || ""));
    sheet.getRange(existing.row, 8).setValue(String(params.bestDescribeYou || existing.values[7] || ""));
    sheet.getRange(existing.row, 9).setValue(String(params.considerMasters || existing.values[8] || ""));
    sheet.getRange(existing.row, 10).setValue(String(params.planningYear || existing.values[9] || ""));
    sheet.getRange(existing.row, 11).setValue(String(params.interestsMost || existing.values[10] || ""));
    if (params.status) sheet.getRange(existing.row, REG_STATUS).setValue(status);
    sheet.getRange(existing.row, REG_LAST).setValue(now);
    sheet.getRange(existing.row, REG_COLLEGE_NAME).setValue(
      String(params.collegeName || existing.values[REG_COLLEGE_NAME - 1] || "")
    );
    writeUtmColumns(sheet, existing.row, params);
    return {
      ok: true,
      existing: true,
      pid: String(existing.values[0]),
      name: String(existing.values[1]),
      email: email,
      status: String(existing.values[REG_STATUS - 1] || status),
      registeredAt: iso(existing.values[REG_REGISTERED_AT - 1]),
      lastActivityAt: now.toISOString(),
      tabSwitches: Number(existing.values[REG_TAB_SWITCHES - 1] || 0),
      quizStartedAt: iso(existing.values[REG_QUIZ_STARTED_AT - 1]),
      blocked: String(existing.values[REG_STATUS - 1]) === "blocked",
    };
  }

  var utmVals = utmRowValues(params);
  sheet.appendRow([
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
    status,
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
    status: status,
    registeredAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    quizStartedAt: null,
    tabSwitches: 0,
    blocked: false,
  };
}

/**
 * Store answers (+ optional score fields) sent by backend.
 * Does NOT compute scores.
 */
function actionSaveAnswers(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  if (!pid) {
    return { ok: false, code: "BAD_REQUEST", error: "pid is required" };
  }

  var reg = findRow(ss.getSheetByName("Registration"), 1, pid);
  var name = String(params.name || (reg ? reg.values[1] : "") || "");
  var email = String(params.email || (reg ? reg.values[2] : "") || "").toLowerCase();
  var answers = String(params.answers || "");
  var now = new Date();

  var respSheet = ss.getSheetByName("Responses");
  var resp = findRow(respSheet, 1, pid);
  var scoreVal =
    params.score !== undefined && params.score !== ""
      ? Number(params.score)
      : "";
  var timeVal =
    params.completionTimeSeconds !== undefined &&
    params.completionTimeSeconds !== ""
      ? Number(params.completionTimeSeconds)
      : "";
  var completedVal = params.completedAt
    ? new Date(String(params.completedAt))
    : "";

  if (!resp) {
    respSheet.appendRow([
      pid,
      name,
      email,
      answers,
      scoreVal === "" || isNaN(scoreVal) ? "" : scoreVal,
      timeVal === "" || isNaN(timeVal) ? "" : timeVal,
      completedVal || "",
    ]);
  } else {
    respSheet.getRange(resp.row, 2).setValue(name);
    respSheet.getRange(resp.row, 3).setValue(email);
    respSheet.getRange(resp.row, 4).setValue(answers);
    if (scoreVal !== "" && !isNaN(scoreVal)) {
      respSheet.getRange(resp.row, 5).setValue(scoreVal);
    }
    if (timeVal !== "" && !isNaN(timeVal)) {
      respSheet.getRange(resp.row, 6).setValue(timeVal);
    }
    if (completedVal) {
      respSheet.getRange(resp.row, 7).setValue(completedVal);
    }
  }

  if (reg) {
    var rs = ss.getSheetByName("Registration");
    var status = String(params.status || "");
    if (status) {
      rs.getRange(reg.row, REG_STATUS).setValue(status);
    } else if (scoreVal !== "" && !isNaN(scoreVal)) {
      rs.getRange(reg.row, REG_STATUS).setValue("completed");
    } else {
      rs.getRange(reg.row, REG_STATUS).setValue("in_progress");
    }
    rs.getRange(reg.row, REG_LAST).setValue(now);
    if (timeVal !== "" && !isNaN(timeVal)) {
      rs.getRange(reg.row, REG_COMPLETION_TIME).setValue(timeVal);
    }
    if (completedVal) {
      rs.getRange(reg.row, REG_COMPLETED_AT).setValue(completedVal);
    }
  }

  var out = { ok: true, completed: false };
  if (scoreVal !== "" && !isNaN(scoreVal)) {
    out.completed = true;
    out.totalScore = scoreVal;
    out.completionTimeSeconds = timeVal !== "" && !isNaN(timeVal) ? timeVal : 0;
    out.completedAt = completedVal
      ? completedVal.toISOString()
      : now.toISOString();
  }
  return out;
}

/**
 * Store final score fields sent by backend. Does NOT score answers.
 */
function actionSubmit(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  if (!pid) {
    return { ok: false, code: "BAD_REQUEST", error: "pid is required" };
  }

  var totalScore = Number(params.totalScore);
  var completionTimeSeconds = Number(params.completionTimeSeconds || 0);
  var completedAt = params.completedAt
    ? new Date(String(params.completedAt))
    : new Date();
  var answers = params.answers !== undefined ? String(params.answers) : null;

  if (isNaN(totalScore)) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      error: "totalScore is required from backend",
    };
  }

  var reg = findRow(ss.getSheetByName("Registration"), 1, pid);
  var name = String(params.name || (reg ? reg.values[1] : "") || "");
  var email = String(params.email || (reg ? reg.values[2] : "") || "").toLowerCase();

  var respSheet = ss.getSheetByName("Responses");
  var resp = findRow(respSheet, 1, pid);
  var already = false;

  if (resp) {
    var existingScore = resp.values[4];
    if (existingScore !== "" && existingScore !== null && existingScore !== undefined) {
      already = true;
      return {
        ok: true,
        alreadyCompleted: true,
        totalScore: Number(existingScore),
        completionTimeSeconds: Number(resp.values[5] || 0),
        completedAt: iso(resp.values[6]),
      };
    }
    if (answers !== null) respSheet.getRange(resp.row, 4).setValue(answers);
    respSheet.getRange(resp.row, 2).setValue(name);
    respSheet.getRange(resp.row, 3).setValue(email);
    respSheet.getRange(resp.row, 5).setValue(totalScore);
    respSheet.getRange(resp.row, 6).setValue(completionTimeSeconds);
    respSheet.getRange(resp.row, 7).setValue(completedAt);
  } else {
    respSheet.appendRow([
      pid,
      name,
      email,
      answers !== null ? answers : "",
      totalScore,
      completionTimeSeconds,
      completedAt,
    ]);
  }

  if (reg) {
    var rs = ss.getSheetByName("Registration");
    rs.getRange(reg.row, REG_STATUS).setValue("completed");
    rs.getRange(reg.row, REG_LAST).setValue(completedAt);
    rs.getRange(reg.row, REG_COMPLETION_TIME).setValue(completionTimeSeconds);
    rs.getRange(reg.row, REG_COMPLETED_AT).setValue(completedAt);
  }

  return {
    ok: true,
    alreadyCompleted: already,
    totalScore: totalScore,
    completionTimeSeconds: completionTimeSeconds,
    completedAt: completedAt.toISOString(),
  };
}

function actionTabSwitch(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  var count = Math.max(0, Math.trunc(Number(params.count || 0)));
  var blocked = String(params.blocked || "") === "true" || count >= 5;
  var reg = findRow(ss.getSheetByName("Registration"), 1, pid);
  if (!reg) {
    return { ok: false, code: "NOT_FOUND", error: "Participant not found" };
  }
  var rs = ss.getSheetByName("Registration");
  rs.getRange(reg.row, REG_TAB_SWITCHES).setValue(count);
  if (blocked) {
    rs.getRange(reg.row, REG_STATUS).setValue("blocked");
  }
  return { ok: true, tabSwitches: count, blocked: blocked };
}

function actionQuizStart(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  var reg = findRow(ss.getSheetByName("Registration"), 1, pid);
  if (!reg) {
    return { ok: false, code: "NOT_FOUND", error: "Participant not found" };
  }
  var existing = reg.values[REG_QUIZ_STARTED_AT - 1];
  if (existing) {
    return {
      ok: true,
      quizStartedAt: iso(existing),
      alreadyStarted: true,
    };
  }
  var now = params.quizStartedAt
    ? new Date(String(params.quizStartedAt))
    : new Date();
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

/** Read-only helpers for rare Sheets fallback - no scoring. */
function actionResume(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var email = String(params.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    return { ok: false, code: "BAD_REQUEST", error: "Email is required" };
  }
  var reg = findRow(ss.getSheetByName("Registration"), 3, email);
  if (!reg) {
    return {
      ok: false,
      code: "NOT_FOUND",
      error: "No registration found for this email.",
    };
  }
  var resp = findRow(ss.getSheetByName("Responses"), 3, email);
  var score = null;
  if (resp && resp.values[4] !== "" && resp.values[4] !== null) {
    score = {
      totalScore: Number(resp.values[4]),
      completionTimeSeconds: Number(resp.values[5] || 0),
      completedAt: iso(resp.values[6]),
    };
  }
  return {
    ok: true,
    pid: String(reg.values[0]),
    name: String(reg.values[1]),
    email: email,
    status: String(reg.values[REG_STATUS - 1] || "not_started"),
    answers: resp ? String(resp.values[3] || "") : "",
    score: score,
    rank: null,
    registeredAt: iso(reg.values[REG_REGISTERED_AT - 1]),
    lastActivityAt: iso(reg.values[REG_LAST - 1]),
    tabSwitches: Number(reg.values[REG_TAB_SWITCHES - 1] || 0),
    quizStartedAt: iso(reg.values[REG_QUIZ_STARTED_AT - 1]),
    blocked: String(reg.values[REG_STATUS - 1]) === "blocked",
  };
}

function actionGetProgress(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  if (!pid) {
    return { ok: false, code: "BAD_REQUEST", error: "pid is required" };
  }
  var reg = findRow(ss.getSheetByName("Registration"), 1, pid);
  var resp = findRow(ss.getSheetByName("Responses"), 1, pid);
  if (!reg && !resp) {
    return { ok: false, code: "NOT_FOUND", error: "Participant not found" };
  }
  var name = String((resp && resp.values[1]) || (reg && reg.values[1]) || "");
  var email = String((resp && resp.values[2]) || (reg && reg.values[2]) || "");
  var answerStr = resp ? String(resp.values[3] || "") : "";
  var score = null;
  if (resp && resp.values[4] !== "" && resp.values[4] !== null) {
    score = {
      totalScore: Number(resp.values[4]),
      completionTimeSeconds: Number(resp.values[5] || 0),
      completedAt: iso(resp.values[6]),
    };
  }
  var responses = [];
  if (answerStr) {
    var parts = answerStr.indexOf("|") >= 0 ? answerStr.split("|") : answerStr.split("");
    for (var i = 0; i < parts.length; i++) {
      responses.push({
        questionId: "q" + (i + 1),
        answer: String(parts[i] || ""),
        answeredAt: null,
      });
    }
  }
  return {
    ok: true,
    pid: pid,
    name: name,
    email: email,
    status: score
      ? "completed"
      : String((reg && reg.values[REG_STATUS - 1]) || "not_started"),
    registeredAt: reg ? iso(reg.values[REG_REGISTERED_AT - 1]) : null,
    lastActivityAt: reg ? iso(reg.values[REG_LAST - 1]) : null,
    responses: responses,
    score: score,
    rank: null,
    quizStartedAt: reg ? iso(reg.values[REG_QUIZ_STARTED_AT - 1]) : null,
  };
}

function actionLeaderboard(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var limit = Math.min(100, Math.max(1, Math.trunc(Number(params.limit || 20))));
  var pid = String(params.pid || "");
  var respSheet = ss.getSheetByName("Responses");
  var last = respSheet.getLastRow();
  var entries = [];
  if (last >= 2) {
    var data = respSheet.getRange(2, 1, last - 1, RESP_HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (r[4] === "" || r[4] === null || r[4] === undefined) continue;
      entries.push({
        pid: String(r[0]),
        name: String(r[1]),
        totalScore: Number(r[4]),
        completionTimeSeconds: Number(r[5] || 0),
        completedAt: iso(r[6]),
      });
    }
  }
  entries.sort(function (a, b) {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    if (a.completionTimeSeconds !== b.completionTimeSeconds) {
      return a.completionTimeSeconds - b.completionTimeSeconds;
    }
    return 0;
  });
  var topEntries = entries.slice(0, limit);
  var me = null;
  if (pid) {
    for (var j = 0; j < entries.length; j++) {
      if (entries[j].pid === pid) {
        me = {
          rank: j + 1,
          totalScore: entries[j].totalScore,
          completionTimeSeconds: entries[j].completionTimeSeconds,
          completedAt: entries[j].completedAt,
        };
        break;
      }
    }
  }
  return { ok: true, topEntries: topEntries, me: me };
}

function actionClearResponses(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pid = String(params.pid || "");
  var resp = findRow(ss.getSheetByName("Responses"), 1, pid);
  if (resp) {
    var sheet = ss.getSheetByName("Responses");
    sheet.getRange(resp.row, 4, 1, 4).setValues([["", "", "", ""]]);
  }
  var reg = findRow(ss.getSheetByName("Registration"), 1, pid);
  if (reg) {
    var rs = ss.getSheetByName("Registration");
    rs.getRange(reg.row, REG_STATUS).setValue("not_started");
    rs.getRange(reg.row, REG_LAST).setValue(new Date());
    rs.getRange(reg.row, REG_QUIZ_STARTED_AT).setValue("");
    rs.getRange(reg.row, REG_COMPLETION_TIME).setValue("");
    rs.getRange(reg.row, REG_COMPLETED_AT).setValue("");
  }
  return { ok: true };
}
