/** Instructions pasted into Claude in Chrome for entering approved expenses into NetSuite Employee Center. */
export function expenseInstructions(siteUrl: string): string {
  return `Enter Midsouth Hauling's approved expenses into NetSuite Employee Center, one job at a time.

1. Open ${siteUrl}/completed. Rows whose "In NetSuite" box says "Not yet" still need entering. Skip rows that say "Entered".
2. For one "Not yet" row, click its "Photos" link. The photos page lists the expense line(s) for that job (memo and amount) and the job photos, with a Download button for each photo. A repo can have two lines (the haul and a separate "Fuel" line): enter each as its own expense line.
3. In NetSuite Employee Center, add the expense line(s) exactly as shown (same memo, same amount), attach the downloaded photos, and submit it the way you normally would.
4. EVERY TIME NetSuite confirms the expense was submitted, go back to that job's photos page and click "Mark entered in NetSuite" (or tick the job's "In NetSuite" box on the Completed page). Do this right away, before starting the next job, so nothing gets entered twice.
5. If NetSuite shows an error or you aren't sure it went through, do NOT mark it entered. Stop and tell me which job.
6. Repeat for the next "Not yet" row. When none are left, tell me how many you entered and the total.

Never change amounts, never mark a job you didn't submit, and never untick a box that already says "Entered".`;
}
