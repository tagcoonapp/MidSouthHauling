import { amountToCollect, isPaymentMethod, type CallStatus, type DriverJob, type JobStage, type JobType, type OfficeJob, type Photo } from "../shared/domain";
import type { PhotoRead, PhotoReadState, PhotoReadStatus } from "../shared/photo-read";

export function photoReadOf(r: JobRow): PhotoReadState {
  let result: PhotoRead | null = null;
  try { result = r.ai_result ? (JSON.parse(r.ai_result) as PhotoRead) : null; } catch { result = null; }
  return { status: (r.ai_status || "none") as PhotoReadStatus, result, error: r.ai_error, readAt: r.ai_read_at };
}

export interface JobRow {
  id: string;
  customer_name: string;
  address: string;
  city: string;
  phone: string;
  serial: string;
  building: string;
  balance_cents: number | null;
  job_type: string;
  stage: string;
  call_status: string;
  call_attempts: number;
  driver_id: string | null;
  driver_name?: string | null;
  driver_color?: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  office_notes: string;
  driver_notes: string;
  pdf_key: string | null;
  submitted_at: string | null;
  created_at: string;
  reported_customer_name: string;
  miles: number | null;
  lot_taken_to: string;
  moody: number;
  amount_override_cents: number | null;
  ai_status: string;
  ai_result: string | null;
  ai_error: string | null;
  ai_read_at: string | null;
  collected_cents: number | null;
  collected_method: string | null;
  collected_ref: string;
  escort_cents: number | null;
  kept_paid_in_full: number | null;
  tlo_notes?: string;
  lat?: number | null;
  lng?: number | null;
  geo_approx?: number;
}

export interface PhotoRow {
  id: string;
  job_id: string;
  created_at: string;
}

function photosFor(rows: PhotoRow[], jobId: string): Photo[] {
  return rows
    .filter((p) => p.job_id === jobId)
    .map((p) => ({ id: p.id, url: `/api/photos/${p.id}`, createdAt: p.created_at }));
}

/**
 * The driver's view of a job. Built field by field (never by spreading the row)
 * so a new money column can never leak to drivers by accident.
 */
export function toDriverJob(r: JobRow, photos: PhotoRow[]): DriverJob {
  return {
    id: r.id,
    customerName: r.customer_name,
    address: r.address,
    city: r.city,
    phone: r.phone,
    serial: r.serial,
    building: r.building,
    jobType: r.job_type as JobType,
    stage: r.stage as JobStage,
    callStatus: r.call_status as CallStatus,
    scheduledDate: r.scheduled_date,
    scheduledTime: r.scheduled_time,
    officeNotes: r.office_notes,
    driverNotes: r.driver_notes,
    hasPdf: !!r.pdf_key,
    photos: photosFor(photos, r.id),
    submittedAt: r.submitted_at,
    reportedCustomerName: r.reported_customer_name,
    miles: r.miles,
    lotTakenTo: r.lot_taken_to,
    collectCents: amountToCollect(r.job_type as JobType, r.balance_cents),
    collectedCents: r.collected_cents,
    collectedMethod: isPaymentMethod(r.collected_method) ? r.collected_method : null,
    collectedRef: r.collected_ref ?? "",
    keptPaidInFull: r.kept_paid_in_full === null || r.kept_paid_in_full === undefined ? null : !!r.kept_paid_in_full,
    tloNotes: r.tlo_notes ?? "",
  };
}

export function toOfficeJob(r: JobRow, photos: PhotoRow[]): OfficeJob {
  return {
    ...toDriverJob(r, photos),
    balanceCents: r.balance_cents,
    driverId: r.driver_id,
    driverName: r.driver_name ?? null,
    driverColor: r.driver_color ?? null,
    callAttempts: r.call_attempts,
    createdAt: r.created_at,
    moody: !!r.moody,
    amountOverrideCents: r.amount_override_cents,
    photoRead: photoReadOf(r),
    escortCents: r.escort_cents ?? null,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    geoApprox: !!r.geo_approx,
  };
}
