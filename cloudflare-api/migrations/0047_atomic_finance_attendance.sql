-- Serialize the invariant at the database write boundary. Two Workers may both
-- read the same outstanding amount, but only inserts whose committed total is
-- within the charge can pass this trigger.
CREATE TRIGGER fee_payment_prevent_overpayment
BEFORE INSERT ON fee_payments
WHEN NEW.amount_piastres > 0 AND (
  COALESCE((SELECT SUM(amount_piastres) FROM fee_payments WHERE fee_charge_id=NEW.fee_charge_id), 0)
  + NEW.amount_piastres
) > (SELECT amount_piastres FROM fee_charges WHERE id=NEW.fee_charge_id)
BEGIN
  SELECT RAISE(ABORT, 'fee_overpayment');
END;

-- The request transition and official register update are one SQLite
-- statement. A losing concurrent reject/approve cannot change attendance.
CREATE TRIGGER attendance_request_apply_approval
AFTER UPDATE OF status ON training_attendance_requests
WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
  INSERT INTO training_attendance (training_session_id, player_id, status, created_at, updated_at)
  VALUES (NEW.training_session_id, NEW.player_id, NEW.requested_status, NEW.decided_at, NEW.updated_at)
  ON CONFLICT(training_session_id, player_id)
  DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at;
END;
