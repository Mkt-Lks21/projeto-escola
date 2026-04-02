-- 1. Re-create the trigger to include INSERT
DROP TRIGGER IF EXISTS trigger_sync_status_stage ON crm.leads;

CREATE TRIGGER trigger_sync_status_stage
BEFORE INSERT OR UPDATE ON crm.leads
FOR EACH ROW
EXECUTE FUNCTION crm.sync_status_and_stage();

-- 2. Performance a one-time sync for existing leads with NULL stage_id
-- We will force an update on the status field to trigger the function for everyone
UPDATE crm.leads 
SET status = status 
WHERE stage_id IS NULL AND status IS NOT NULL;

-- 3. Also fix leads where stage_id exists but status might be empty (unlikely but safe)
UPDATE crm.leads
SET stage_id = stage_id
WHERE status IS NULL AND stage_id IS NOT NULL;;
