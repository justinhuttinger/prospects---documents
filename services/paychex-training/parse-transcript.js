// Parse a Paychex Flex Learning "Transcript" zip and return one normalized
// row per (user, learnable) enrollment. The zip layout we expect:
//
//   dashboard-transcript/learner_transcript.csv
//
// The CSV has two quirks:
//   1. Line 1 is a metadata stub ("Custom Field Name, Custom field filter not selected").
//   2. The real header starts at line 2 and has a leading empty column (it's
//      the row-number column the Paychex UI uses) plus a trailing "_" column.
//
// Column names from line 2 (after dropping the leading empty + trailing "_"):
//   User Name, Title, Learnable Type, Status, Enrollment Date, Due Date,
//   Completion Date, Expiration Date, Re-enrollment Date, Modification Date,
//   Required (Yes / No), Score, Continuing Education Credits, Learnable ID,
//   Program IDs, Program titles, Certificate Link, User Deleted, User ID,
//   Email, UID, HRIS ID, Full Name of Manager, Email of Manager,
//   Uid of Manager, Account Name, Subscription End Date

const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');

const TRANSCRIPT_CSV_NAME = 'learner_transcript.csv';

// Map CSV header -> our DB column name. Anything not listed is preserved on
// the `raw` JSONB column but ignored for the typed columns.
const HEADER_TO_COLUMN = {
  'User Name': 'user_name',
  'Title': 'title',
  'Learnable Type': 'learnable_type',
  'Status': 'status',
  'Enrollment Date': 'enrollment_date',
  'Due Date': 'due_date',
  'Completion Date': 'completion_date',
  'Expiration Date': 'expiration_date',
  'Re-enrollment Date': 're_enrollment_date',
  'Modification Date': 'modification_date',
  'Required (Yes / No)': 'required',
  'Score': 'score',
  'Continuing Education Credits': 'continuing_education_credits',
  'Learnable ID': 'learnable_id',
  'Program IDs': 'program_ids',
  'Program titles': 'program_titles',
  'Certificate Link': 'certificate_link',
  'User Deleted': 'user_deleted',
  'User ID': 'user_id',
  'Email': 'email',
  'UID': 'uid',
  'HRIS ID': 'hris_id',
  'Full Name of Manager': 'manager_name',
  'Email of Manager': 'manager_email',
  'Uid of Manager': 'manager_uid',
  'Account Name': 'account_name',
  'Subscription End Date': 'subscription_end_date',
};

const DATE_COLUMNS = new Set([
  'enrollment_date', 'due_date', 'completion_date', 'expiration_date',
  're_enrollment_date', 'modification_date', 'subscription_end_date',
]);
const NUMERIC_COLUMNS = new Set(['score', 'continuing_education_credits']);
const BOOL_COLUMNS = new Set(['required', 'user_deleted']);

function toDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Accept YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss; keep just the date.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toNumeric(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'yes' || s === 'true' || s === '1') return true;
  if (s === 'no' || s === 'false' || s === '0') return false;
  if (s === '') return null;
  return null;
}

function normalizeRow(rawRow) {
  const out = { raw: rawRow };
  for (const [csvCol, dbCol] of Object.entries(HEADER_TO_COLUMN)) {
    const v = rawRow[csvCol];
    if (DATE_COLUMNS.has(dbCol)) {
      out[dbCol] = toDate(v);
    } else if (NUMERIC_COLUMNS.has(dbCol)) {
      out[dbCol] = toNumeric(v);
    } else if (BOOL_COLUMNS.has(dbCol)) {
      out[dbCol] = toBool(v);
    } else {
      const s = v == null ? null : String(v).trim();
      out[dbCol] = s === '' ? null : s;
    }
  }
  // user_deleted defaults to false (not null) since the DB column is NOT NULL.
  if (out.user_deleted == null) out.user_deleted = false;
  return out;
}

// Extract the CSV bytes from the zip. Returns { buffer, name } or throws.
function extractTranscriptCsv(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const entry = entries.find((e) => {
    if (e.isDirectory) return false;
    const base = e.entryName.split('/').pop();
    return base && base.toLowerCase() === TRANSCRIPT_CSV_NAME;
  });
  if (!entry) {
    const names = entries.map((e) => e.entryName).join(', ');
    throw new Error(`learner_transcript.csv not found in zip. Entries: ${names || '(empty)'}`);
  }
  return { buffer: entry.getData(), name: entry.entryName };
}

// Drop the leading metadata line, normalize the header line by trimming the
// leading row-number column and the trailing "_" column, then parse.
function parseTranscriptCsv(csvText) {
  const newline = csvText.includes('\r\n') ? '\r\n' : '\n';
  const lines = csvText.split(newline);
  if (lines.length < 2) return [];

  // Line 0 is the metadata stub; line 1 is the header; lines 2+ are data.
  // We let csv-parse handle quoting/escapes — just rejoin the relevant slice.
  const dataText = lines.slice(1).join(newline);
  const records = parse(dataText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  // csv-parse returns one extra unnamed key for the leading blank column and
  // another for the trailing "_" column. We just ignore them — only the
  // headers in HEADER_TO_COLUMN flow through to normalized rows.
  return records.map(normalizeRow).filter((r) => r.user_id && r.learnable_id);
}

function parseTranscriptZip(zipBuffer) {
  const { buffer, name } = extractTranscriptCsv(zipBuffer);
  const text = buffer.toString('utf8');
  const rows = parseTranscriptCsv(text);
  return { rows, csvEntryName: name, csvBuffer: buffer };
}

module.exports = {
  parseTranscriptZip,
  parseTranscriptCsv,
  extractTranscriptCsv,
  normalizeRow,
  HEADER_TO_COLUMN,
};
