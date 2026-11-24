-- Jobs waiting in the pipeline have no driver; a driver is picked when a job goes on the calendar.
UPDATE jobs SET driver_id = NULL, scheduled_time = NULL WHERE stage = 'pipeline';
