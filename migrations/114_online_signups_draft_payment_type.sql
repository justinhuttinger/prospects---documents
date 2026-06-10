-- 114_online_signups_draft_payment_type.sql
-- Card-today + bank-recurring hybrid for EFT members. ABC's PayPage can't draft
-- a "due today" from a bank account, so when an ACH member has money due today
-- we collect TODAY on a card and RECURRING on the bank — two PayPage passes,
-- two tokens with two methods.
--
-- We already have paypage_today_transaction_id + paypage_draft_transaction_id +
-- paypage_payment_type (the TODAY method). Add the DRAFT (recurring) method so
-- the two legs can differ (today=Credit Card, draft=Bank Account).

ALTER TABLE online_signups
  ADD COLUMN IF NOT EXISTS paypage_draft_payment_type TEXT;

COMMENT ON COLUMN online_signups.paypage_draft_payment_type IS
  'Recurring/draft payment method: "Credit Card" or "Bank Account". May differ from paypage_payment_type (the today method) in the EFT card-today hybrid.';
