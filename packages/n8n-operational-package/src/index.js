import { sha256Digest } from "../../../src/canonical-json.js";

const REQUIRED_EXPORTS = [
  "workflow_runtime_adapter", "repair_delivery_adapter", "verification_adapter",
  "event_reporter_workflow", "reference_workflow"
];
const REQUIRED_MAPPINGS = [
  "workflow_identity", "revision_identity", "event_receipt", "health", "repair_delivery", "verification"
];

export function validateN8nOperationalPackage(value) {
  const issues = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) issues.push("manifest must be an object");
  if (value?.package_id !== "alphonse.runtime.n8n") issues.push("package_id is unsupported");
  if (value?.package_version !== "0.2.0") issues.push("package_version is unsupported");
  if (value?.compatibility?.n8n !== ">=2.25.0 <3.0.0") issues.push("n8n compatibility is unsupported");
  for (const name of REQUIRED_EXPORTS) if (!value?.exports?.[name]) issues.push(`missing export ${name}`);
  for (const name of REQUIRED_MAPPINGS) if (!value?.mappings?.[name]) issues.push(`missing mapping ${name}`);
  if (!Array.isArray(value?.fingerprint_rules?.included_fields)
      || value.fingerprint_rules.included_fields.length === 0) issues.push("fingerprint fields are required");
  return { valid: issues.length === 0, issues };
}

export function evaluateDefectiveInventoryFixture(fixture) {
  const erpRecord = fixture.erp_inventory.find((record) => record.sku === fixture.order.sku);
  const erpQuantity = erpRecord?.quantity ?? 0;
  const risk = erpQuantity < fixture.order.quantity ? "delay_likely" : "ready";
  return {
    order_id: fixture.order.order_id,
    sku: fixture.order.sku,
    erp_quantity: erpQuantity,
    storefront_quantity: fixture.storefront_inventory.quantity,
    inventory_state: erpQuantity === 0 ? "out_of_stock" : "in_stock",
    fulfillment_risk: risk,
    draft: risk === "delay_likely" ? {
      kind: "customer_delay_follow_up",
      subject: `Possible delay for ${fixture.order.order_id}`
    } : null,
    delivery: { channel: "local_review", sent: false },
    defect_path: erpRecord ? "matched_sku" : "missing_sku -> zero_inventory -> delay_draft"
  };
}

export function evaluateRepairedInventoryFixture(fixture) {
  const erpRecord = fixture.erp_inventory.find((record) => record.sku === fixture.order.sku);
  if (!erpRecord) {
    return {
      ...fixture,
      erp_quantity: null,
      inventory_state: "inventory_unknown",
      defect_path: "missing_sku -> inventory_unknown -> human_review",
      fulfillment_risk: "unknown",
      draft: null,
      delivery: { channel: "local_review", sent: false },
      review_reason: "missing_inventory_data"
    };
  }
  return {
    ...fixture,
    erp_quantity: erpRecord.quantity,
    inventory_state: "known",
    defect_path: "matched_sku",
    fulfillment_risk: erpRecord.quantity < fixture.order.quantity ? "delay_likely" : "ready",
    draft: null,
    delivery: { channel: "local_review", sent: false }
  };
}

function qualifyLead(lead) {
  const budgetScore = lead.monthly_budget >= 2500 ? 40 : lead.monthly_budget >= 1000 ? 20 : 0;
  const timelineScore = lead.timeline_days <= 30 ? 35 : lead.timeline_days <= 90 ? 15 : 0;
  const need = `${lead.service_need ?? ""}`.toLowerCase();
  const fitScore = need.includes("commercial") || need.includes("maintenance") ? 25 : 0;
  const score = budgetScore + timelineScore + fitScore;
  return {
    score,
    status: score >= 70 ? "qualified" : "needs_review",
    route: score >= 70 ? "sales:commercial" : "sales:intake_review"
  };
}

function duplicateSubmissionIds(events) {
  const counts = new Map();
  for (const event of events) {
    counts.set(event.submission_id, (counts.get(event.submission_id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([submissionId]) => submissionId);
}

export function evaluateDefectiveLeadFixture(fixture) {
  const crmLeads = structuredClone(fixture.crm_initial ?? []);
  const notifications = structuredClone(fixture.notifications_initial ?? []);
  const externalEffects = [];
  for (const [index, event] of fixture.lead_form_events.entries()) {
    const qualification = qualifyLead(event.lead);
    const crmLead = {
      crm_lead_id: `crm-${String(index + 1).padStart(3, "0")}`,
      form_submission_id: event.submission_id,
      email: event.lead.email,
      company: event.lead.company,
      qualification,
      created_from_event_id: event.event_id
    };
    crmLeads.push(crmLead);
    externalEffects.push({
      system: "mock_crm",
      operation: "create_lead",
      idempotency_key: null,
      event_id: event.event_id,
      result_id: crmLead.crm_lead_id
    });
    if (qualification.status === "qualified") {
      const notification = {
        notification_id: `notify-${String(index + 1).padStart(3, "0")}`,
        form_submission_id: event.submission_id,
        to: qualification.route,
        subject: `Qualified lead: ${event.lead.company}`,
        created_from_event_id: event.event_id
      };
      notifications.push(notification);
      externalEffects.push({
        system: "mailpit",
        operation: "send_notification",
        idempotency_key: null,
        event_id: event.event_id,
        result_id: notification.notification_id
      });
    }
  }
  const duplicates = duplicateSubmissionIds(fixture.lead_form_events);
  return {
    processed_event_count: fixture.lead_form_events.length,
    crm_leads: crmLeads,
    notifications,
    duplicate_submission_ids: duplicates,
    external_effects: externalEffects,
    lead_state: duplicates.length > 0 ? "duplicate_created" : "created",
    defect_path: duplicates.length > 0
      ? "duplicate_webhook -> create_without_idempotency -> duplicate_crm_and_notification"
      : "single_delivery"
  };
}

export function evaluateRepairedLeadFixture(fixture) {
  const crmLeads = structuredClone(fixture.crm_initial ?? []);
  const notifications = structuredClone(fixture.notifications_initial ?? []);
  const suppressed_duplicates = [];
  const externalEffects = [];
  for (const event of fixture.lead_form_events) {
    const existing = crmLeads.find((lead) => lead.form_submission_id === event.submission_id);
    if (existing) {
      suppressed_duplicates.push({
        event_id: event.event_id,
        form_submission_id: event.submission_id,
        reason: "duplicate_delivery"
      });
      continue;
    }
    const qualification = qualifyLead(event.lead);
    const stableSuffix = event.submission_id.toLowerCase();
    const crmLead = {
      crm_lead_id: `crm-${stableSuffix}`,
      form_submission_id: event.submission_id,
      email: event.lead.email,
      company: event.lead.company,
      qualification,
      created_from_event_id: event.event_id
    };
    crmLeads.push(crmLead);
    externalEffects.push({
      system: "mock_crm",
      operation: "upsert_lead",
      idempotency_key: event.submission_id,
      event_id: event.event_id,
      result_id: crmLead.crm_lead_id
    });
    if (qualification.status === "qualified") {
      const notification = {
        notification_id: `notify-${stableSuffix}`,
        form_submission_id: event.submission_id,
        to: qualification.route,
        subject: `Qualified lead: ${event.lead.company}`,
        created_from_event_id: event.event_id
      };
      notifications.push(notification);
      externalEffects.push({
        system: "mailpit",
        operation: "send_notification",
        idempotency_key: event.submission_id,
        event_id: event.event_id,
        result_id: notification.notification_id
      });
    }
  }
  return {
    processed_event_count: fixture.lead_form_events.length,
    crm_leads: crmLeads,
    notifications,
    duplicate_submission_ids: duplicateSubmissionIds(fixture.lead_form_events),
    suppressed_duplicates,
    external_effects: externalEffects,
    lead_state: suppressed_duplicates.length > 0 ? "idempotent_duplicate_suppressed" : "created",
    defect_path: suppressed_duplicates.length > 0
      ? "duplicate_webhook -> idempotency_gate -> existing_lead_preserved"
      : "single_delivery"
  };
}

function leadRecord(event, qualification, suffix) {
  return {
    crm_lead_id: `crm-${suffix}`,
    form_submission_id: event.submission_id,
    email: event.lead.email,
    company: event.lead.company,
    qualification,
    created_from_event_id: event.event_id
  };
}

function leadNotification(event, qualification, suffix) {
  return {
    notification_id: `notify-${suffix}`,
    form_submission_id: event.submission_id,
    to: qualification.route,
    subject: `Qualified lead: ${event.lead.company}`,
    created_from_event_id: event.event_id
  };
}

export function evaluateDefectiveAmbiguousLeadFixture(fixture) {
  const [event] = fixture.lead_form_events;
  const qualification = qualifyLead(event.lead);
  const crmLeads = structuredClone(fixture.crm_initial ?? []);
  const notifications = structuredClone(fixture.notifications_initial ?? []);
  const firstLead = leadRecord(event, qualification, "001");
  const retryLead = leadRecord(event, qualification, "002");
  crmLeads.push(firstLead, retryLead);
  const externalEffects = [
    {
      system: "mock_crm", operation: "create_lead", attempt: 1,
      event_id: event.event_id, submission_id: event.submission_id,
      idempotency_key: null, outcome: "uncertain", destination_committed: true,
      result_id: firstLead.crm_lead_id
    },
    {
      system: "mock_crm", operation: "create_lead", attempt: 2,
      event_id: event.event_id, submission_id: event.submission_id,
      idempotency_key: null, outcome: "confirmed", destination_committed: true,
      result_id: retryLead.crm_lead_id
    }
  ];
  if (qualification.status === "qualified") {
    const notification = leadNotification(event, qualification, "001");
    notifications.push(notification);
    externalEffects.push({
      system: "mailpit", operation: "send_notification", attempt: 1,
      event_id: event.event_id, submission_id: event.submission_id,
      idempotency_key: null, outcome: "confirmed", destination_committed: true,
      result_id: notification.notification_id
    });
  }
  return {
    processed_event_count: fixture.lead_form_events.length,
    crm_leads: crmLeads,
    notifications,
    external_effects: externalEffects,
    uncertain_effects: externalEffects.filter((effect) => effect.outcome === "uncertain"),
    lead_state: "duplicate_created_after_uncertain_write",
    defect_path: "committed_create -> lost_response -> blind_retry -> duplicate_crm_lead"
  };
}

export function evaluateRepairedAmbiguousLeadFixture(fixture) {
  const [event] = fixture.lead_form_events;
  const qualification = qualifyLead(event.lead);
  const crmLeads = structuredClone(fixture.crm_initial ?? []);
  const notifications = structuredClone(fixture.notifications_initial ?? []);
  const committedLead = leadRecord(event, qualification, "001");
  crmLeads.push(committedLead);
  const externalEffects = [
    {
      system: "mock_crm", operation: "create_lead", attempt: 1,
      event_id: event.event_id, submission_id: event.submission_id,
      idempotency_key: event.submission_id, outcome: "uncertain", destination_committed: true,
      result_id: committedLead.crm_lead_id
    },
    {
      system: "mock_crm", operation: "lookup_lead", attempt: 1,
      event_id: event.event_id, submission_id: event.submission_id,
      idempotency_key: event.submission_id, outcome: "confirmed", destination_committed: false,
      result_id: committedLead.crm_lead_id
    }
  ];
  if (qualification.status === "qualified") {
    const notification = leadNotification(event, qualification, "001");
    notifications.push(notification);
    externalEffects.push({
      system: "mailpit", operation: "send_notification", attempt: 1,
      event_id: event.event_id, submission_id: event.submission_id,
      idempotency_key: event.submission_id, outcome: "confirmed", destination_committed: true,
      result_id: notification.notification_id
    });
  }
  return {
    processed_event_count: fixture.lead_form_events.length,
    crm_leads: crmLeads,
    notifications,
    external_effects: externalEffects,
    uncertain_effects: externalEffects.filter((effect) => effect.outcome === "uncertain"),
    reconciliations: externalEffects.filter((effect) => effect.operation === "lookup_lead"),
    lead_state: "uncertain_write_reconciled",
    defect_path: "committed_create -> uncertain_outcome -> destination_lookup -> existing_lead_preserved"
  };
}

function routingContextRead(fixture) {
  return {
    source_id: fixture.routing_context.source_id,
    snapshot_id: fixture.routing_context.snapshot_id,
    captured_at: fixture.routing_context.captured_at,
    maximum_age_seconds: fixture.routing_context.maximum_age_seconds,
    decision_at: fixture.lead_form_events[0].received_at,
    candidate_owner_id: fixture.routing_context.candidate_owner.owner_id,
    candidate_status_at_capture: fixture.routing_context.candidate_owner.status
  };
}

export function evaluateDefectiveStaleRoutingFixture(fixture) {
  const [event] = fixture.lead_form_events;
  const qualification = qualifyLead(event.lead);
  const ownerId = fixture.routing_context.candidate_owner.owner_id;
  const crmLead = {
    ...leadRecord(event, qualification, "001"),
    assigned_owner_id: ownerId
  };
  const notification = {
    ...leadNotification(event, qualification, "001"),
    to: ownerId
  };
  return {
    processed_event_count: 1,
    crm_leads: [crmLead],
    notifications: [notification],
    external_effects: [
      {
        system: "mock_crm", operation: "create_lead", event_id: event.event_id,
        submission_id: event.submission_id, idempotency_key: event.submission_id,
        outcome: "confirmed", destination_committed: true, result_id: crmLead.crm_lead_id
      },
      {
        system: "mailpit", operation: "send_notification", event_id: event.event_id,
        submission_id: event.submission_id, idempotency_key: event.submission_id,
        outcome: "confirmed", destination_committed: true, result_id: notification.notification_id
      }
    ],
    context_reads: [routingContextRead(fixture)],
    routing_decisions: [{
      submission_id: event.submission_id,
      owner_id: ownerId,
      decision_at: event.received_at,
      snapshot_id: fixture.routing_context.snapshot_id,
      disposition: "assigned"
    }],
    authoritative_owner_state: structuredClone(fixture.authoritative_owner_state),
    escalations: [],
    lead_state: "routed_using_expired_context"
  };
}

export function evaluateRepairedStaleRoutingFixture(fixture) {
  const [event] = fixture.lead_form_events;
  const qualification = qualifyLead(event.lead);
  const crmLead = {
    ...leadRecord(event, qualification, "001"),
    assigned_owner_id: null
  };
  return {
    processed_event_count: 1,
    crm_leads: [crmLead],
    notifications: [],
    external_effects: [{
      system: "mock_crm", operation: "create_lead", event_id: event.event_id,
      submission_id: event.submission_id, idempotency_key: event.submission_id,
      outcome: "confirmed", destination_committed: true, result_id: crmLead.crm_lead_id
    }],
    context_reads: [routingContextRead(fixture)],
    routing_decisions: [],
    authoritative_owner_state: structuredClone(fixture.authoritative_owner_state),
    escalations: [{
      submission_id: event.submission_id,
      reason: "routing_context_requires_refresh",
      disposition: "owner_assignment_held"
    }],
    lead_state: "routing_context_stale_escalated"
  };
}

function observedLeadPaths(event) {
  return Object.keys(event.lead).sort().map((field) => `lead.${field}`);
}

function schemaMappingObservation(fixture, event, overrides = {}) {
  const observedPaths = observedLeadPaths(event);
  const unresolvedPaths = fixture.mapping_contract.required_source_paths.filter((requiredPath) =>
    !observedPaths.includes(requiredPath));
  return {
    contract_id: fixture.mapping_contract.contract_id,
    event_schema_id: event.schema_id,
    event_schema_version: event.schema_version,
    accepted_schema_versions: fixture.mapping_contract.accepted_schema_versions,
    required_source_paths: fixture.mapping_contract.required_source_paths,
    observed_source_paths: observedPaths,
    source_value_observations: event.lead.estimated_monthly_budget === undefined ? [] : [{
      path: "lead.estimated_monthly_budget",
      value: event.lead.estimated_monthly_budget
    }],
    unresolved_source_paths: unresolvedPaths,
    defaults_applied: [],
    aliases_applied: [],
    ...overrides
  };
}

export function evaluateDefectiveSchemaChangeFixture(fixture) {
  const [event] = fixture.lead_form_events;
  const defaultBudget = fixture.mapping_contract.defaults.monthly_budget;
  const qualification = qualifyLead({ ...event.lead, monthly_budget: defaultBudget });
  const crmLead = leadRecord(event, qualification, "001");
  return {
    processed_event_count: 1,
    crm_leads: [crmLead],
    notifications: [],
    external_effects: [{
      system: "mock_crm", operation: "create_lead", event_id: event.event_id,
      submission_id: event.submission_id, idempotency_key: event.submission_id,
      outcome: "confirmed", destination_committed: true, result_id: crmLead.crm_lead_id
    }],
    source_schema_state: structuredClone(fixture.source_schema),
    mapping_observations: [schemaMappingObservation(fixture, event, {
      defaults_applied: [{ target_field: "monthly_budget", value: defaultBudget }],
      mapped_values: { monthly_budget: defaultBudget }
    })],
    lead_state: "qualified_from_silent_default"
  };
}

export function evaluateRepairedSchemaChangeFixture(fixture) {
  const [event] = fixture.lead_form_events;
  const qualification = qualifyLead({
    ...event.lead,
    monthly_budget: event.lead.estimated_monthly_budget
  });
  const crmLead = leadRecord(event, qualification, "001");
  const notification = leadNotification(event, qualification, "001");
  return {
    processed_event_count: 1,
    crm_leads: [crmLead],
    notifications: [notification],
    external_effects: [
      {
        system: "mock_crm", operation: "create_lead", event_id: event.event_id,
        submission_id: event.submission_id, idempotency_key: event.submission_id,
        outcome: "confirmed", destination_committed: true, result_id: crmLead.crm_lead_id
      },
      {
        system: "mailpit", operation: "send_notification", event_id: event.event_id,
        submission_id: event.submission_id, idempotency_key: event.submission_id,
        outcome: "confirmed", destination_committed: true, result_id: notification.notification_id
      }
    ],
    source_schema_state: structuredClone(fixture.source_schema),
    mapping_observations: [schemaMappingObservation(fixture, event, {
      accepted_schema_versions: ["1", "2"],
      unresolved_source_paths: [],
      aliases_applied: [{
        source_path: "lead.estimated_monthly_budget",
        target_field: "monthly_budget"
      }],
      mapped_values: { monthly_budget: event.lead.estimated_monthly_budget }
    })],
    lead_state: "schema_version_mapped"
  };
}

export function buildN8nRevisionMaterial({ packageManifest, workflow, reporter }) {
  const nodes = [...workflow.nodes, ...reporter.nodes].map((node) => ({
    node_type: node.type,
    node_version: String(node.typeVersion)
  }));
  return {
    workflow_content: { primary_workflow: workflow, dependencies: [reporter] },
    runtime: {
      runtime_id: "n8n",
      runtime_version: packageManifest.compatibility.reference_version,
      image_digest: packageManifest.compatibility.reference_image.split("@")[1]
    },
    nodes,
    model: { provider: "fixture", model: "deterministic-follow-up", version: "1" },
    configuration: {
      delivery: "local_review",
      external_effects: false,
      configuration_fingerprint: sha256Digest({ delivery: "local_review", external_effects: false })
    },
    adapter: {
      adapter_id: "alphonse.n8n.runtime",
      adapter_version: "0.2.0",
      fingerprint_rules_digest: sha256Digest(packageManifest.fingerprint_rules)
    }
  };
}

export function adapterHealthProjection({ runtimeReachable, reportingReachable, lastEventAt }) {
  if (!runtimeReachable) return {
    status: "unavailable", runtime: "unreachable", reporting: "unknown", workflow_activity: "unknown"
  };
  if (!reportingReachable) return {
    status: "degraded", runtime: "reachable", reporting: "broken", workflow_activity: "unknown"
  };
  return {
    status: "healthy",
    runtime: "reachable",
    reporting: "reachable",
    workflow_activity: lastEventAt ? "observed" : "none_observed"
  };
}
