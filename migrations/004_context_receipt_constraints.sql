ALTER TABLE kernel_context_access_grants
  ADD CONSTRAINT kernel_context_grant_subjects_array
    CHECK (jsonb_typeof(subjects) = 'array' AND jsonb_array_length(subjects) > 0),
  ADD CONSTRAINT kernel_context_grant_sources_array
    CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) > 0),
  ADD CONSTRAINT kernel_context_grant_sensitivity_array
    CHECK (jsonb_typeof(sensitivity_classes) = 'array' AND jsonb_array_length(sensitivity_classes) > 0);

ALTER TABLE kernel_context_receipts
  ADD CONSTRAINT kernel_context_receipt_items_array
    CHECK (jsonb_typeof(item_references) = 'array' AND jsonb_array_length(item_references) > 0),
  ADD CONSTRAINT kernel_context_receipt_authority_array
    CHECK (jsonb_typeof(authority_claims) = 'array' AND jsonb_array_length(authority_claims) > 0),
  ADD CONSTRAINT kernel_context_receipt_freshness_array
    CHECK (jsonb_typeof(freshness_claims) = 'array' AND jsonb_array_length(freshness_claims) > 0),
  ADD CONSTRAINT kernel_context_receipt_provenance_object
    CHECK (jsonb_typeof(provenance) = 'object'),
  ADD CONSTRAINT kernel_context_receipt_limitations_object
    CHECK (jsonb_typeof(limitations) = 'object');
