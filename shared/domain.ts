// Business vocabulary and access rules, shared by the API and the web app.

export const ROLES = ["driver", "scheduler", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  driver: "Driver",
  scheduler: "Scheduler",
  owner: "Owner",
};

// The 5 pay types. Drivers pick one when they finish a job; it decides how the expense is priced.
export const JOB_TYPES = ["new", "used", "shop_build", "repo", "attempted_repo", "private_move"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  new: "New",
  used: "Used",
  shop_build: "Shop Build",
  repo: "Repo",
  attempted_repo: "Attempted Repo",
  private_move: "Private Move",
};

/** Which follow-up questions the driver must answer for each type. */
export const DRIVER_QUESTIONS: Record<JobType, { miles: boolean; lot: boolean; amountGiven: boolean; keptPaid: boolean }> = {
  new: { miles: true, lot: false, amountGiven: false, keptPaid: false },
  used: { miles: true, lot: false, amountGiven: false, keptPaid: false },
  shop_build: { miles: true, lot: false, amountGiven: false, keptPaid: false },
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

/** The amount the driver must collect on this job, or null if nothing is due. */
export function amountToCollect(jobType: JobType, balanceCents: number | null): number | null {
  return COLLECTS_BALANCE.has(jobType) && balanceCents !== null && balanceCents > 0 ? balanceCents : null;
}

/** What's still missing before a driver can submit, in plain words. */
export function missingDriverAnswers(j: {
  jobType: JobType; reportedCustomerName: string; miles: number | null; lotTakenTo: string;
  collectCents: number | null; collectedCents: number | null; collectedMethod: string | null;
  keptPaidInFull?: boolean | null;
}): string[] {
  const q = DRIVER_QUESTIONS[j.jobType];
  const out: string[] = [];
  if (!j.reportedCustomerName.trim()) out.push("customer name");
  if (q.miles && (j.miles === null || !(j.miles >= 0))) out.push("miles");
  if (q.lot && !j.lotTakenTo.trim()) out.push("lot taken to");
  if (q.amountGiven && (j.collectedCents === null || j.collectedCents < 0)) out.push("how much was given");
  if (q.keptPaid && (j.keptPaidInFull === null || j.keptPaidInFull === undefined)) out.push("whether the customer paid in full");
  if (j.collectCents !== null) {
    if (j.collectedCents === null || j.collectedCents < 0) out.push("amount collected");
    if (!isPaymentMethod(j.collectedMethod) && !(j.collectedCents === 0)) out.push("how it was paid");
  }
  return out;
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
  createdAt: string;
  moody: boolean;
  amountOverrideCents: number | null;
  photoRead: import("./photo-read").PhotoReadState;
  escortCents: number | null;
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
