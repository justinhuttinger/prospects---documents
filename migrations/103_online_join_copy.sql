-- 103_online_join_copy.sql
-- Key-value table for editable strings used across the widget. Keeps global
-- text (terms URLs, trust language, confirmation messaging, brand color) out
-- of code and editable from the admin UI without redeploying.

CREATE TABLE IF NOT EXISTS online_join_copy (
  copy_key    TEXT PRIMARY KEY,
  copy_value  TEXT NOT NULL,
  description TEXT,                          -- shown to admin to explain context
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  TEXT
);

-- Default rows (idempotent: only insert if missing).
INSERT INTO online_join_copy (copy_key, copy_value, description) VALUES
  ('terms_url',
    'https://westcoaststrength.com/terms',
    'Link target for the T&C checkbox.'),
  ('privacy_url',
    'https://westcoaststrength.com/privacy',
    'Link target for the privacy checkbox.'),
  ('step_5_trust_text',
    'Your payment is securely processed by ABC Fitness. Card details never touch our servers.',
    'Reassurance text shown above the PayPage iframe.'),
  ('step_6_welcome_heading',
    'Welcome to the WCS family!',
    'Confirmation page heading.'),
  ('step_6_welcome_body',
    'Your membership is active. Book your free Day One session below to meet your trainer and tour the gym.',
    'Confirmation page body copy.'),
  ('support_phone',
    '541-555-0123',
    'Phone shown on error screens.'),
  ('primary_color',
    '#FF0000',
    'Brand color used for CTAs and accents.')
ON CONFLICT (copy_key) DO NOTHING;
