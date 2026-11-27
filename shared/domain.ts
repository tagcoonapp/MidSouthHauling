// Business vocabulary and access rules, shared by the API and the web app.

export const ROLES = ["driver", "scheduler", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  driver: "Driver",
  scheduler: "Scheduler",
  owner: "Owner",
};

// The 5 pay types. Drivers pick one when they finish a job; it decides how the expense is priced.
export const JOB_TYPES = ["new", "used", "shop_build", "inv_haul", "repo", "attempted_repo", "private_move"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  new: "New",
  used: "Used",
  shop_build: "Shop Build",
  inv_haul: "INV Haul",
  repo: "Repo",
  attempted_repo: "Attempted Repo",
  private_move: "Private Move",
};

/** Which follow-up questions the driver must answer for each type. */
export const DRIVER_QUESTIONS: Record<JobType, { miles: boolean; lot: boolean; amountGiven: boolean; keptPaid: boolean }> = {
  new: { miles: true, lot: false, amountGiven: false, keptPaid: false },
  used: { miles: true, lot: false, amountGiven: false, keptPaid: false },
  shop_build: { miles: true, lot: false, amountGiven: false, keptPaid: false },
  inv_haul: { miles: true, lot: false, amountGiven: false, keptPaid: false },
  repo: { miles: true, lot: true, amountGiven: false, keptPaid: false },
  attempted_repo: { miles: false, lot: false, amountGiven: false, keptPaid: true },
  private_move: { miles: false, lot: false, amountGiven: true, keptPaid: false },
};

/** Types where the driver collects a balance due from the customer (when NetSuite shows one). */
export const COLLECTS_BALANCE: ReadonlySet<JobType> = new Set<JobType>(["new", "used", "shop_build"]);
/** Types that never make an expense (recorded only, not expensed through NetSuite). */
export const NO_EXPENSE: ReadonlySet<JobType> = new Set<JobType>(["private_move"]);

export const PAYMENT_METHODS = ["cash", "check", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: "Cash", check: "Check", card: "Card (QR link)" };
export const isPaymentMethod = (v: unknown): v is PaymentMethod => typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);

/** Attempted repo, customer paid to keep the building: who took the payment. */
export const KEPT_PAID_TO = ["driver", "bhr"] as const;
export type KeptPaidTo = (typeof KEPT_PAID_TO)[number];
export const KEPT_PAID_TO_LABELS: Record<KeptPaidTo, string> = { driver: "Cash to driver", bhr: "Paid to BHR" };
export const isKeptPaidTo = (v: unknown): v is KeptPaidTo => v === "driver" || v === "bhr";

/** The amount the driver must collect on this job, or null if nothing is due. */
export function amountToCollect(jobType: JobType, balanceCents: number | null): number | null {
  return COLLECTS_BALANCE.has(jobType) && balanceCents !== null && balanceCents > 0 ? balanceCents : null;
}

/** What's still missing before a driver can submit, in plain words. */
export function missingDriverAnswers(j: {
  jobType: JobType; reportedCustomerName: string; miles: number | null; lotTakenTo: string;
  collectCents: number | null; collectedCents: number | null; collectedMethod: string | null;
  keptPaidInFull?: boolean | null;
  keptPaidTo?: KeptPaidTo | null;
}): string[] {
  const q = DRIVER_QUESTIONS[j.jobType];
  const out: string[] = [];
  // Inventory hauls (lot to lot) may have no customer.
  if (!j.reportedCustomerName.trim() && j.jobType !== "inv_haul") out.push("customer name");
  if (q.miles && (j.miles === null || !(j.miles >= 0))) out.push("miles");
  if (q.lot && !j.lotTakenTo.trim()) out.push("lot taken to");
  if (q.amountGiven && (j.collectedCents === null || j.collectedCents < 0)) out.push("how much was given");
  // Attempted repo: "customer paid to keep the building" is optional, but if ticked we need to know who got the money.
  if (q.keptPaid && j.keptPaidInFull === true && !isKeptPaidTo(j.keptPaidTo)) out.push("whether the customer paid cash to you or paid BHR");
  if (j.collectCents !== null) {
    if (j.collectedCents === null || j.collectedCents < 0) out.push("amount collected");
    if (!isPaymentMethod(j.collectedMethod) && !(j.collectedCents === 0)) out.push("how it was paid");
  }
  return out;
}

/** Job names can carry the lot after a bar ("Jade Gibbons | Henagar"); this is the customer part. */
export function baseCustomerName(name: string): string {
  return name.split("|")[0]!.trim();
}
/** The lot written after the bar in a job name, if any. */
export function lotFromName(name: string): string {
  const i = name.indexOf("|");
  return i === -1 ? "" : name.slice(i + 1).trim();
}

/** Lots that build on site: jobs from these lots are Shop Builds. */
export const isShopBuildLot = (lot: string | null | undefined) => !!lot && /\b(mize|south\s*fulton|toccoa)\b/i.test(lot);

export type MapCategory = "sale" | "shop_build" | "inv_haul" | "repo" | "private_move";
/** Map pin color group: green New/Used, blue Shop Build (or a shop-build lot), red Repo/Attempted Repo, purple Private Move. */
export function mapCategory(jobType: JobType, name: string): MapCategory {
  if (jobType === "repo" || jobType === "attempted_repo") return "repo";
  if (jobType === "private_move") return "private_move";
  if (jobType === "inv_haul") return "inv_haul"; // lot-to-lot: drawn as a little shed
  if (jobType === "shop_build" || isShopBuildLot(lotFromName(name))) return "shop_build";
  return "sale";
}

/** Whole days since a job was added. */
export function daysOnUs(createdAtIso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(createdAtIso)) / 86_400_000));
}

/** A note on the calendar between jobs, in a driver's day order. driverId null = everyone. */
export interface CalendarNote {
  id: string;
  date: string;
  driverId: string | null;
  driverName: string | null;
  driverColor: string | null;
  text: string;
  sortOrder: number;
  createdAt: string;
}

export const CALL_STATUSES = ["not_called", "attempted", "waiting", "confirmed"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  not_called: "Not called",
  attempted: "Attempted call",
  waiting: "Called – waiting",
  confirmed: "Confirmed",
};

/** Where a job is in its life: waiting in the pipeline, on the calendar, done by the driver, approved by the scheduler. */
export const JOB_STAGES = ["pipeline", "scheduled", "submitted", "approved"] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export const MAX_PHOTOS_PER_JOB = 4;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Drivers see their own submitted jobs for this many days; office roles keep everything. */
export const DRIVER_LOG_DAYS = 60;

export const DRIVER_COLORS = ["#2563eb", "#ea7a1a", "#8b5cf6", "#0d9488", "#db2777", "#65a30d", "#dc2626", "#0891b2"];

/** Everything a role may do. The API enforces these; the web app uses them only to hide buttons. */
export interface Permissions {
  viewPipeline: boolean;
  editSchedule: boolean;
  viewAllDrivers: boolean;
  viewFinancial: boolean;
  viewPendingExpenses: boolean;
  approveExpenses: boolean;
  manageTeam: boolean;
  submitJobs: boolean;
}

export function permissionsFor(role: Role): Permissions {
  switch (role) {
    case "scheduler":
      return {
        viewPipeline: true, editSchedule: true, viewAllDrivers: true, viewFinancial: true,
        viewPendingExpenses: true, approveExpenses: true, manageTeam: true, submitJobs: true,
      };
    case "owner":
      return {
        viewPipeline: true, editSchedule: true, viewAllDrivers: true, viewFinancial: true,
        viewPendingExpenses: false, approveExpenses: false, manageTeam: false, submitJobs: false,
      };
    case "driver":
      return {
        viewPipeline: false, editSchedule: false, viewAllDrivers: false, viewFinancial: false,
        viewPendingExpenses: false, approveExpenses: false, manageTeam: false, submitJobs: true,
      };
  }
}

export function isJobType(v: unknown): v is JobType {
  return typeof v === "string" && (JOB_TYPES as readonly string[]).includes(v);
}
export function isCallStatus(v: unknown): v is CallStatus {
  return typeof v === "string" && (CALL_STATUSES as readonly string[]).includes(v);
}
export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

// ---- API shapes ----

export interface Me {
  id: string;
  name: string;
  username: string;
  role: Role;
  color: string;
  permissions: Permissions;
}

export interface TeamMember {
  id: string;
  name: string;
  username: string;
  role: Role;
  color: string;
  active: boolean;
  /** Office only: driver pay rates in percent of the expense. */
  payHaulPct?: number | null;
  payRepoPct?: number | null;
}

export interface Photo {
  id: string;
  url: string;
  createdAt: string;
}

/** What a driver may see about a job. Deliberately has no money fields. */
export interface DriverJob {
  id: string;
  customerName: string;
  address: string;
  city: string;
  phone: string;
  serial: string;
  building: string;
  jobType: JobType;
  stage: JobStage;
  callStatus: CallStatus;
  scheduledDate: string | null;
  scheduledTime: string | null;
  officeNotes: string;
  driverNotes: string;
  hasPdf: boolean;
  photos: Photo[];
  submittedAt: string | null;
  reportedCustomerName: string;
  miles: number | null;
  lotTakenTo: string;
  /** Balance the driver must collect today (New/Used/Shop Build with a balance due). Not what the job pays. */
  collectCents: number | null;
  /** What the driver says they collected (or, on a Private Move, how much the customer gave). */
  collectedCents: number | null;
  collectedMethod: PaymentMethod | null;
  collectedRef: string;
  /** Attempted repo: customer paid the full balance to keep the building. */
  keptPaidInFull: boolean | null;
  keptPaidTo: KeptPaidTo | null;
  /** Repos: other possible addresses from a TLO search, one per line. */
  tloNotes: string;
  /** Order within the day (shared with calendar notes). */
  dayOrder: number;
}

export interface JobEvent {
  id: string;
  kind: string;
  detail: string;
  userName: string;
  createdAt: string;
}

/** What the scheduler and owners see. */
export interface OfficeJob extends DriverJob {
  balanceCents: number | null;
  driverId: string | null;
  driverName: string | null;
  driverColor: string | null;
  callAttempts: number;
  /** Order within the day (lower first); drivers see their stops in this order. */
  sortOrder: number;
  createdAt: string;
  moody: boolean;
  amountOverrideCents: number | null;
  photoRead: import("./photo-read").PhotoReadState;
  escortCents: number | null;
  lat: number | null;
  lng: number | null;
  geoApprox: boolean;
  /** Set when the last full NetSuite import didn't list this open job. */
  missingFromNetsuiteAt: string | null;
  /** Back in the pipeline because it wasn't submitted on this day. */
  missedDate?: string | null;
  events?: JobEvent[];
  /** Live expense draft (submitted jobs, scheduler only). */
  draft?: import("./pricing").ExpenseDraft & { nameMatches: boolean | null; photoChecks: import("./photo-read").PhotoCheck[]; serialFromPhoto: boolean };
  /** Expenses frozen at approval. */
  expenses?: ApprovedExpense[];
}

export interface ApprovedExpense {
  id: string;
  kind: "main" | "fuel";
  description: string;
  basis: string;
  amountCents: number;
  approvedAt: string;
  enteredAt: string | null;
}

// ---------- Receipts and accounting ----------

/** A fuel receipt. Drivers get their own; the office gets everyone's. */
export interface FuelReceipt {
  id: string;
  driverId: string;
  driverName?: string;
  driverColor?: string;
  date: string;
  amountCents: number | null;
  gallons: number | null;
  odometer: number | null;
  station: string;
  notes: string;
  photoUrl: string | null;
  aiStatus: string | null;
  aiError: string | null;
  /** Things that don't line up between what the driver typed and the photo. Office only. */
  checks?: string[];
  createdAt: string;
}

export const TRUCK_COST_CATEGORIES = ["repair", "tires", "maintenance", "insurance", "registration", "other"] as const;
export type TruckCostCategory = (typeof TRUCK_COST_CATEGORIES)[number];
export const TRUCK_COST_LABELS: Record<TruckCostCategory, string> = {
  repair: "Repair", tires: "Tires", maintenance: "Maintenance", insurance: "Insurance", registration: "Registration", other: "Other",
};
export const isTruckCostCategory = (v: unknown): v is TruckCostCategory => typeof v === "string" && (TRUCK_COST_CATEGORIES as readonly string[]).includes(v);

export interface TruckCost {
  id: string;
  date: string;
  category: TruckCostCategory;
  vehicle: string;
  driverId: string | null;
  driverName: string | null;
  vendor: string;
  description: string;
  amountCents: number;
  photoUrl: string | null;
  createdAt: string;
}

/** One approved job with its pay, for the accounting page. */
export interface PayJob {
  id: string;
  date: string;
  customerName: string;
  jobType: JobType;
  serial: string;
  driverId: string | null;
  driverName: string | null;
  driverColor: string | null;
  miles: number | null;
  expensedCents: number;
  fuelLineCents: number;
  payCents: number | null;
  payBasis: string;
  payPaidAt: string | null;
  collectedCents: number | null;
  collectedMethod: string | null;
  keptPaidTo: KeptPaidTo | null;
}

export interface AccountingReport {
  from: string;
  to: string;
  jobs: PayJob[];
  fuel: FuelReceipt[];
  truckCosts: TruckCost[];
  drivers: { id: string; name: string; color: string; payHaulPct: number | null; payRepoPct: number | null }[];
  /** Miles from odometer readings per driver in the period. */
  odometerMiles: Record<string, number>;
}

// ---------- Scheduling notes (office only) ----------

export interface SchedulingNote {
  id: string;
  jobId: string | null;
  customerName: string;
  text: string;
  author: string;
  createdAt: string;
  doneAt: string | null;
  doneBy: string | null;
  jobStage: string | null;
  jobDate: string | null;
}

/** Open scheduling notes that belong to a job: linked to it, or written for the same customer name. */
export function schedulingNotesFor(notes: SchedulingNote[], job: { id: string; customerName: string }): SchedulingNote[] {
  const name = baseCustomerName(job.customerName).toLowerCase();
  return notes.filter((n) => !n.doneAt && (n.jobId ? n.jobId === job.id : !!name && baseCustomerName(n.customerName).toLowerCase() === name));
}

// ---------- Premier lots ----------

export interface Lot {
  id: string;
  name: string;
  address: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  /** Other names used for this lot in job names, comma separated (e.g. "Moody"). */
  aliases: string;
}

const LOT_FILLER = new Set(["premier", "buildings", "building", "portable", "of", "the", "and", "trailers", "trailer", "lot", "sheds", "shed", "llc", "inc", "al", "ga", "tn", "ms", "co"]);
const lotWords = (s: string) => s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !LOT_FILLER.has(w));

/**
 * The lot a job name or "lot taken to" answer refers to ("Moody lot", "Vision 7 Buildings - Sumiton", "SOUTH FULTON").
 * Matches an alias or every distinctive word of the lot's name. Null if nothing fits.
 */
export function matchLot(text: string, lots: Lot[]): Lot | null {
  const words = new Set(lotWords(text));
  if (!words.size) return null;
  const has = (phrase: string) => { const w = lotWords(phrase); return w.length > 0 && w.every((x) => words.has(x)); };
  let best: Lot | null = null;
  let bestScore = 0;
  for (const lot of lots) {
    const aliasHit = lot.aliases.split(",").map((a) => a.trim()).filter(Boolean).find(has);
    const nameWords = lotWords(lot.name);
    const score = aliasHit ? 100 + lotWords(aliasHit).length : nameWords.length && has(lot.name) ? nameWords.length : 0;
    if (score > bestScore) { best = lot; bestScore = score; }
  }
  return best;
}
