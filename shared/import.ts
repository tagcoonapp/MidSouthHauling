// Bulk import of jobs read from NetSuite (by Claude in Chrome, or pasted by hand).
import { JOB_TYPES, type JobType } from "./domain";

export interface ImportRow {
  customerName: string;
  address: string;
  city: string;
  phone: string;
  serial: string;
  balanceCents: number | null;
  jobType: JobType;
  notes: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  /** Lines/entries that couldn't be used, with the reason. */
  bad: { entry: string; reason: string }[];
}

const TYPE_WORDS: [RegExp, JobType][] = [
  [/attempt/i, "attempted_repo"],
  [/repo|reposs/i, "repo"],
  [/shop/i, "shop_build"],
  [/private/i, "private_move"],
  [/used|customer purchase|resale/i, "used"],
  [/new|delivery|off.?lot|order/i, "new"],
];

export function parseJobType(v: unknown): JobType {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if ((JOB_TYPES as readonly string[]).includes(t)) return t as JobType;
    for (const [re, type] of TYPE_WORDS) if (re.test(v)) return type;
  }
  return "new";
}

function parseMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  const s = String(v).trim();
  if (/^(ndb|none|paid|n\/a|-)$/i.test(s)) return 0;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const pick = (o: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of Object.keys(o)) {
    const norm = k.toLowerCase().replace(/[^a-z]/g, "");
    if (keys.includes(norm)) {
      const v = o[k];
      if (v !== null && v !== undefined) return String(v).trim();
    }
  }
  return "";
};

function fromObject(o: Record<string, unknown>): ImportRow {
  const balanceRaw = Object.entries(o).find(([k]) => /balance|due|owe/i.test(k))?.[1];
  return {
    customerName: pick(o, "customername", "customer", "name"),
    address: pick(o, "address", "deliveryaddress", "street"),
    city: pick(o, "city", "town"),
    phone: pick(o, "phone", "phonenumber", "tel", "mobile"),
    serial: pick(o, "serial", "serialnumber", "buildinginventorynumber", "inventorynumber", "sn").toUpperCase(),
    balanceCents: parseMoney(balanceRaw),
    jobType: parseJobType(pick(o, "jobtype", "type")),
    notes: pick(o, "notes", "note", "comments", "memo"),
  };
}

/**
 * Accepts a JSON list of objects (what Claude in Chrome pastes), or one job per line separated by | or tabs:
 * Name | Address | City | Phone | Serial | Balance | Type
 */
export function parseImport(text: string): ParsedImport {
  const rows: ImportRow[] = [];
  const bad: ParsedImport["bad"] = [];
  const t = text.trim();
  if (!t) return { rows, bad };

  const jsonStart = t.search(/[[{]/);
  if (jsonStart !== -1 && (t.startsWith("[") || t.startsWith("{") || t.includes("```"))) {
    const body = t.slice(jsonStart, Math.max(t.lastIndexOf("]"), t.lastIndexOf("}")) + 1);
    try {
      const data = JSON.parse(body);
      const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : [data];
      for (const item of list) {
        if (!item || typeof item !== "object") { bad.push({ entry: JSON.stringify(item), reason: "Not a job" }); continue; }
        const row = fromObject(item as Record<string, unknown>);
        if (!row.customerName) bad.push({ entry: JSON.stringify(item).slice(0, 120), reason: "No customer name" });
        else rows.push(row);
      }
      return { rows, bad };
    } catch {
      // fall through to line format
    }
  }

  for (const line of t.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || /^name\s*[|\t]/i.test(l) || l.startsWith("#")) continue;
    const parts = l.split(/\s*[|\t]\s*/);
    if (parts.length < 2 || !parts[0]) { bad.push({ entry: l, reason: "Expected: Name | Address | City | Phone | Serial | Balance | Type" }); continue; }
    rows.push({
      customerName: parts[0]!,
      address: parts[1] ?? "",
      city: parts[2] ?? "",
      phone: parts[3] ?? "",
      serial: (parts[4] ?? "").toUpperCase(),
      balanceCents: parseMoney(parts[5]),
      jobType: parseJobType(parts[6]),
      notes: parts[7] ?? "",
    });
  }
  return { rows, bad };
}

export const normSerialKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function importInstructions(siteUrl: string): string {
  return `Please import my In Progress jobs from NetSuite into my hauling site.

1. In my NetSuite tab (Employee Center), open the jobs list and show the jobs that are "In Progress". Do not change, submit or delete anything in NetSuite. Only read.
2. For EVERY job in that list, collect:
   - customerName
   - address (delivery street address)
   - city
   - phone
   - serial (the Building Inventory Number, like ULB-305353-1016-092126)
   - balance (balance due in dollars; 0 if none)
   - jobType (one of: New, Used, Shop Build, Repo, Attempted Repo; use New if you can't tell)
   If the list doesn't show something, open that job's record to find it. If it truly isn't there, leave it blank.
3. Open ${siteUrl}/import (I'm already signed in), paste everything into the big box as a JSON list, for example:
   [{"customerName":"William Temples","address":"123 Main St","city":"Moody","phone":"(205) 555-0100","serial":"ULB-305353-1016-092126","balance":0,"jobType":"New"}]
4. Click "Preview", then click the "Add" button to add the new jobs. Jobs already on the site are skipped automatically.
5. Tell me how many jobs were added and list any you couldn't read.`;
}
