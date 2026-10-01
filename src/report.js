// Report formats: text for a terminal, Markdown for a pull request or job summary, JSON for other tools,
// CSV for a spreadsheet. SARIF for code scanning is in sarif.js.

function inputs(r) {
  const s = r.sources || {};
  const parts = [`lock ${s.lock ?? 'lock file'} (lockfileVersion ${r.lockfileVersion})`];
  if (s.package) parts.push(`package ${s.package}`);
  if (s.config) parts.push(`config ${s.config}`);
  return parts.join(', ');
}

function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function summaryLine(r) {
  const s = r.summary;
  const direct = s.direct === null ? 'direct unknown' : `${s.direct.toLocaleString('en-US')} direct`;
  return `packages: ${s.packages.toLocaleString('en-US')} locked (${direct}, ${s.dev.toLocaleString('en-US')} dev, ${s.optional.toLocaleString('en-US')} optional), ${s.installScripts.toLocaleString('en-US')} with install scripts, ${plural(s.links, 'link')}, ${s.bundled.toLocaleString('en-US')} bundled`;
}

function findingSummary(r) {
  const shown = r.findings.length < r.total ? ` (showing ${r.findings.length.toLocaleString('en-US')} of ${r.total.toLocaleString('en-US')})` : '';
  return `${r.counts.error} error, ${r.counts.warning} warning, ${r.counts.info} info${shown}`;
}

function scriptRows(r) {
  return {
    head: ['Install script', 'Version', 'Path', 'Allowed'],
    rows: r.installScripts.map((s) => [s.package, s.version ?? '-', s.path, s.allowed ? 'yes' : 'no'])
  };
}

function textTable({ head, rows }) {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const line = (cells) => cells.map((c, i) => (i === cells.length - 1 ? String(c) : String(c).padEnd(widths[i]))).join('  ').trimEnd();
  return [line(head), ...rows.map(line)];
}

export function toText(r) {
  const lines = [
    `lockfile-check: ${inputs(r)}`,
    summaryLine(r),
    `findings: ${findingSummary(r)}`
  ];
  if (r.installScripts.length) lines.push('', ...textTable(scriptRows(r)));
  if (!r.findings.length) lines.push('', 'no findings');
  for (const f of r.findings) lines.push('', `${f.severity.toUpperCase().padEnd(8)}  ${f.id.padEnd(19)}  ${f.message}`);
  if (r.notes.length) lines.push('');
  for (const n of r.notes) lines.push(`note: ${n}`);
  lines.push('', r.gate.pass ? `GATE: PASS (--fail-on ${r.gate.failOn})` : `GATE: FAIL - ${r.gate.reason}`);
  return lines.join('\n') + '\n';
}

// A Markdown table cell: backslashes and pipes escaped, line breaks flattened, so text from a lock file cannot break the table.
export function mdCell(t) {
  return String(t).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ');
}

function mdTable({ head, rows }) {
  return [
    `| ${head.map(mdCell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`)
  ];
}

export function toMarkdown(r) {
  const lines = [
    `## lockfile-check: ${findingSummary(r)}`,
    '',
    `${mdCell(inputs(r))}.`,
    '',
    `${mdCell(summaryLine(r))}.`
  ];
  if (r.installScripts.length) lines.push('', ...mdTable(scriptRows(r)));
  if (!r.findings.length) lines.push('', 'No findings.');
  else {
    lines.push('', '| Severity | Check | Package | Message |', '| --- | --- | --- | --- |');
    for (const f of r.findings) lines.push(`| ${f.severity} | ${mdCell(f.id)} | ${mdCell(f.package ?? '-')} | ${mdCell(f.message)} |`);
  }
  if (r.notes.length) lines.push('');
  for (const n of r.notes) lines.push(`- ${mdCell(n)}`);
  lines.push('', r.gate.pass ? `**Gate passed** (--fail-on ${r.gate.failOn}).` : `**Gate failed:** ${mdCell(r.gate.reason)}.`);
  return lines.join('\n') + '\n';
}

export function toJson(r) {
  return JSON.stringify(r, null, 2) + '\n';
}

// RFC 4180 quoting, and a leading quote on cells a spreadsheet would read as a formula.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per finding, then one per package with an install script.
export function toCsv(r) {
  const rows = [['type', 'severity', 'id', 'package', 'version', 'path', 'line', 'message']];
  for (const f of r.findings) rows.push(['finding', f.severity, f.id, f.package, f.version, f.path, f.line, f.message]);
  for (const s of r.installScripts) rows.push(['install-script', '', '', s.package, s.version, s.path, '', s.allowed ? 'allowed' : 'not allowed']);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
