-- 111_online_join_cancellation_copy.sql
-- Seed the cancellation-policy copy keys surfaced by the term step (step 3) of
-- the join widget. The widget shows `cancellation_rules_label` as a subscript
-- link that opens a modal containing `cancellation_rules_body`. Both are
-- editable from Admin -> Online Join -> Copy.

INSERT INTO online_join_copy (copy_key, copy_value, description) VALUES
  ('cancellation_rules_label', 'Cancellation policy',
   'Term step: text of the subscript link that opens the cancellation-rules popup.'),
  ('cancellation_rules_body',
   'Month-to-Month memberships may be cancelled at any time with written notice; the final payment covers the 30 days following your notice. 1-Year memberships are a 12-month commitment and may be cancelled early only under the conditions allowed by your agreement (such as a permanent move or qualifying medical reason) with supporting documentation. Please contact your home club for the full written terms.',
   'Term step: full cancellation-policy text shown in the popup. Plain text; line breaks are preserved.')
ON CONFLICT (copy_key) DO NOTHING;
