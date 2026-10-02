export type UatBaseline = { columns: string[]; rows: Record<string, string>[] };

/** Strict quoted CSV reader for the human-readable acceptance ledger. */
export function parseAuditCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else field += char;
    } else if (char === '"') {
      if (field || closed) throw new Error("Malformed CSV quote.");
      quoted = true;
    } else if (char === "," || char === "\n") {
      row.push(field);
      field = "";
      closed = false;
      if (char === "\n") {
        rows.push(row);
        row = [];
      }
    } else if (char !== "\r") {
      if (closed) throw new Error("Malformed CSV after quote.");
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

export function verifyAuditUatLedger(csv: string, baseline: UatBaseline) {
  const [header, ...rows] = parseAuditCsv(csv);
  if (baseline.rows.length !== 50 || rows.length !== 50)
    throw new Error("Exactly50 original UAT rows required.");
  if (
    !header ||
    new Set(header).size !== header.length ||
    baseline.columns.some((c, i) => header[i] !== c)
  )
    throw new Error("The original acceptance columns must be retained in order.");
  const counts = { pass: 0, fail: 0, blocked: 0, not_run: 0 };
  const seen = new Set<string>();
  let localOnlyPasses = 0;
  for (const [index, row] of rows.entries()) {
    if (row.length !== header.length) throw new Error(`Malformed row${index + 1}.`);
    const record = Object.fromEntries(header.map((column, i) => [column, row[i]]));
    const id = record.UAT_ID;
    if (seen.has(id)) throw new Error(`Duplicate original UAT${id}.`);
    seen.add(id);
    if (baseline.columns.some((column) => record[column] !== baseline.rows[index][column]))
      throw new Error(`Changed original acceptance${id}.`);
    const status = record["新一輪狀態"];
    if (!Object.hasOwn(counts, status)) throw new Error(`Invalid status${id}.`);
    counts[status as keyof typeof counts]++;
    if (status !== "not_run") {
      for (const column of [
        "Build_SHA",
        "環境",
        "測試資料版本",
        "角色",
        "執行命令或步驟",
        "實際結果",
        "證據路徑",
        "重測日期",
      ])
        if (!record[column]?.trim()) throw new Error(`Missing${column} evidence for${id}.`);
      if (!/^[a-f0-9]{7,40}$/.test(record.Build_SHA)) throw new Error(`Invalid build SHA${id}.`);
      if (status === "blocked" && !record["Blocker及Owner"]?.trim())
        throw new Error(`Blocked${id} requires owner and next action.`);
    }
    if (
      status === "pass" &&
      /local|mock|synthetic|injected|demo|dry.run/i.test(
        [record["環境"], record["測試資料版本"], record["角色"]].join(" "),
      )
    )
      localOnlyPasses++;
  }
  return {
    original: 50,
    counts,
    localOnlyPasses,
    runtimeReleaseReady: counts.pass === 50 && localOnlyPasses === 0,
  };
}
