-- Acknowledgement + signature columns for the new step 6 (Review & Sign).
-- The widget collects a drawn signature + typed printed-name on the new
-- acknowledgement step before /submit fires. After ABC creates the
-- agreement we render the signed contract as a PDF and POST it to the
-- member's ABC document folder.

ALTER TABLE online_signups
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS typed_signature text,
  ADD COLUMN IF NOT EXISTS signed_document_uploaded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signed_document_id text;

COMMENT ON COLUMN online_signups.signed_at IS
  'When the member checked "I agree" and submitted the acknowledgment step. Set right before /submit calls ABC.';
COMMENT ON COLUMN online_signups.typed_signature IS
  'Name the member typed alongside the drawn signature. Acts as a printed-name audit alongside the rendered signature image.';
COMMENT ON COLUMN online_signups.signed_document_uploaded IS
  'True once the rendered agreement PDF has been POSTed to ABC documents.';
COMMENT ON COLUMN online_signups.signed_document_id IS
  'The documentId returned by ABC, if available.';
