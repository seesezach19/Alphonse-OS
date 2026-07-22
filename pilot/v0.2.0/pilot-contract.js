// @ts-check

import { createHash } from "node:crypto";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATERIALS = ["pilot_packet", "release_archive", "public_protocol", "operations_console",
  "authorized_n8n_access"];
const JOURNEY = ["install", "onboard", "observe", "diagnose", "repair", "verify", "authorize",
  "target_confirm", "assurance_export"];
const DECISIONS = ["retain_paid", "decline"];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value, max = 2000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    && !/^REPLACE(?:_|$)/.test(value);
}

function timestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function issue(issues, code, path, message) {
  issues.push({ code, path, message });
}

function shape(issues, value, path, keys) {
  const candidate = object(value);
  if (!candidate) {
    issue(issues, "INVALID_PILOT_SHAPE", path, "Value must be an object.");
    return null;
  }
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    issue(issues, "INVALID_PILOT_SHAPE", path, "Object fields do not match the closed pilot contract.");
  }
  return candidate;
}

function exactStrings(value, expected) {
  return Array.isArray(value) && value.length === expected.length
    && [...value].sort().every((entry, index) => entry === [...expected].sort()[index]);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function secretPath(value, path = "pilot") {
  if (typeof value === "string" && (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    || /^(?:Bearer|Owner|Operator)\s+\S+$/i.test(value))) return path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = secretPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
  } else if (object(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (/(^|_)(password|private_key|token|api_key|secret|authorization)($|_)/i.test(key)
        && !/(?:_id|_digest)$/.test(key) && typeof child !== "boolean") {
        return `${path}.${key}`;
      }
      const found = secretPath(child, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

export function pilotDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stable(value))).digest("hex")}`;
}

export function validatePilotPlan(value) {
  const issues = [];
  const plan = shape(issues, value, "plan", ["schema_version", "plan_id", "status", "release",
    "target_selection", "success_criteria", "authority_boundary", "commercial", "external_gate"]);
  if (!plan) return { valid: false, issues };
  if (plan.schema_version !== "alphonse.design_partner_pilot_plan.v0.2") {
    issue(issues, "PILOT_PLAN_SCHEMA_UNSUPPORTED", "plan.schema_version", "Pilot plan schema is unsupported.");
  }
  if (!text(plan.plan_id, 160) || !["internal_draft_not_offered", "partner_precommitted"].includes(plan.status)) {
    issue(issues, "PILOT_PLAN_STATUS_INVALID", "plan", "Plan identity and status must be explicit.");
  }

  const release = shape(issues, plan.release, "plan.release", ["version", "archive_digest", "qualification_digest",
    "sbom_digest", "provenance_digest", "public_materials"]);
  if (!release || release.version !== "0.2.0"
    || ![release.archive_digest, release.qualification_digest, release.sbom_digest, release.provenance_digest]
      .every((entry) => DIGEST.test(entry ?? ""))
    || !exactStrings(release.public_materials, ["START-HERE.md", "RELEASE-OPERATOR.md",
      "WORKFLOW-SELECTION.md", "PILOT-AGREEMENT.md", "pilot-plan.json",
      "pilot-evidence.template.json", "assurance-receipt.sample.json"])) {
    issue(issues, "PILOT_RELEASE_NOT_PINNED", "plan.release",
      "Pilot must pin the qualified release and the complete public starting packet.");
  }

  const selection = shape(issues, plan.target_selection, "plan.target_selection", ["platform",
    "existing_customer_workflow_required", "real_client_required", "customer_owned_required", "low_risk_required",
    "reversible_required", "pre_pilot_backup_required", "managed_tls_required", "preference_score_minimum",
    "excluded"]);
  const excluded = ["credential_migration", "financial_disbursement", "legal_or_safety_decision",
    "irreversible_delete", "high_availability_dependency", "unbounded_personal_data"];
  if (!selection || selection.platform !== "n8n" || selection.existing_customer_workflow_required !== true
    || selection.real_client_required !== true || selection.customer_owned_required !== true
    || selection.low_risk_required !== true || selection.reversible_required !== true
    || selection.pre_pilot_backup_required !== true || selection.managed_tls_required !== true
    || selection.preference_score_minimum !== 12
    || !exactStrings(selection.excluded, excluded)) {
    issue(issues, "PILOT_TARGET_POLICY_WEAKENED", "plan.target_selection",
      "Target selection must retain every real-client, reversibility, backup, TLS, and exclusion boundary.");
  }

  const success = shape(issues, plan.success_criteria, "plan.success_criteria", ["real_incidents_minimum",
    "independently_verified_owner_authorized_repairs_minimum", "client_usable_assurance_required",
    "duplicate_consequential_effects_maximum", "unfamiliar_operator_required", "public_materials_only",
    "repository_access_allowed", "undocumented_steps_maximum", "payment_decision_required"]);
  if (!success || success.real_incidents_minimum !== 1
    || success.independently_verified_owner_authorized_repairs_minimum !== 1
    || success.client_usable_assurance_required !== true
    || success.duplicate_consequential_effects_maximum !== 0 || success.unfamiliar_operator_required !== true
    || success.public_materials_only !== true || success.repository_access_allowed !== false
    || success.undocumented_steps_maximum !== 0 || success.payment_decision_required !== true) {
    issue(issues, "PILOT_SUCCESS_CRITERIA_WEAKENED", "plan.success_criteria",
      "Technical, operator, client-utility, duplicate-effect, and payment gates may not be weakened.");
  }

  const authority = ["kernel_owns_authority", "adapter_edge_holds_provider_credentials",
    "repair_worker_cannot_verify_or_promote", "verifier_cannot_promote", "named_owner_authorizes_promotion",
    "reconcile_before_retry", "rollback_separately_authorized"];
  if (!exactStrings(plan.authority_boundary, authority)) {
    issue(issues, "PILOT_AUTHORITY_BOUNDARY_WEAKENED", "plan.authority_boundary",
      "Pilot must precommit every authority and recovery separation.");
  }

  const commercial = shape(issues, plan.commercial, "plan.commercial", ["currency", "onboarding_fee",
    "monthly_per_workflow", "included_scope", "pricing_status", "decision_due_within_days_after_pilot",
    "decision_options", "pre_agreed_payment_decision_required"]);
  if (!commercial || commercial.currency !== "USD" || !Number.isSafeInteger(commercial.onboarding_fee)
    || commercial.onboarding_fee <= 0 || !Number.isSafeInteger(commercial.monthly_per_workflow)
    || commercial.monthly_per_workflow <= 0 || !text(commercial.included_scope)
    || commercial.pricing_status !== (plan.status === "partner_precommitted"
      ? "partner_precommitted_hypothesis" : "hypothesis_not_offered")
    || !Number.isSafeInteger(commercial.decision_due_within_days_after_pilot)
    || commercial.decision_due_within_days_after_pilot < 1
    || commercial.decision_due_within_days_after_pilot > 30
    || !exactStrings(commercial.decision_options, DECISIONS)
    || commercial.pre_agreed_payment_decision_required !== true) {
    issue(issues, "PILOT_COMMERCIAL_GATE_WEAKENED", "plan.commercial",
      "Pilot needs a positive pricing hypothesis and a bounded pre-agreed retain-or-decline decision.");
  }

  if (!exactStrings(plan.external_gate, ["unfamiliar_human_operator", "real_agency", "real_client_workflow",
    "owner_authorized_live_repair", "client_assurance_review", "agency_payment_decision"])) {
    issue(issues, "PILOT_EXTERNAL_GATE_INCOMPLETE", "plan.external_gate",
      "Every external human, customer, live-repair, utility, and payment fact must remain explicit.");
  }
  const secret = secretPath(plan);
  if (secret) issue(issues, "PILOT_SECRET_PROHIBITED", secret, "Pilot plans contain references, never credentials.");
  issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  return { valid: issues.length === 0, issues };
}

export function validatePilotEvidence(planValue, value) {
  const planResult = validatePilotPlan(planValue);
  const issues = [...planResult.issues];
  const evidence = shape(issues, value, "evidence", ["schema_version", "plan_digest", "pilot_id", "started_at",
    "finished_at", "operator", "agency", "client", "workflow", "journey", "friction", "incident", "repair",
    "assurance", "commercial", "limitations"]);
  if (!evidence) return { valid: false, technical_qualified: false, commercial_qualified: false, issues };
  if (evidence.schema_version !== "alphonse.design_partner_pilot_evidence.v0.2") {
    issue(issues, "PILOT_EVIDENCE_SCHEMA_UNSUPPORTED", "evidence.schema_version", "Pilot evidence schema is unsupported.");
  }
  if (planValue?.status !== "partner_precommitted") {
    issue(issues, "PILOT_TERMS_NOT_PRECOMMITTED", "plan.status",
      "A partner-specific copy of the plan must be precommitted before the pilot begins.");
  }
  if (evidence.plan_digest !== pilotDigest(planValue)) {
    issue(issues, "PILOT_PLAN_DIGEST_MISMATCH", "evidence.plan_digest", "Evidence must bind the exact precommitted plan.");
  }
  if (!UUID.test(evidence.pilot_id ?? "") || !timestamp(evidence.started_at) || !timestamp(evidence.finished_at)
    || Date.parse(evidence.finished_at) <= Date.parse(evidence.started_at)) {
    issue(issues, "PILOT_CLOCK_INVALID", "evidence", "Pilot identity and positive time interval are required.");
  }

  const operator = shape(issues, evidence.operator, "evidence.operator", ["operator_id", "unfamiliar_with_alphonse",
    "repository_accessed", "allowed_materials", "human_attention_ms", "undocumented_steps"]);
  if (!operator || !text(operator.operator_id) || operator.unfamiliar_with_alphonse !== true
    || operator.repository_accessed !== false || !exactStrings(operator.allowed_materials, MATERIALS)
    || !Number.isSafeInteger(operator.human_attention_ms) || operator.human_attention_ms <= 0
    || !Array.isArray(operator.undocumented_steps) || operator.undocumented_steps.length !== 0) {
    issue(issues, "UNFAMILIAR_OPERATOR_NOT_QUALIFIED", "evidence.operator",
      "A real unfamiliar operator must use only public materials and finish with no undocumented step.");
  }

  const agency = shape(issues, evidence.agency, "evidence.agency", ["agency_id", "agreement_digest",
    "agreement_signed_at", "decision_terms_precommitted"]);
  if (!agency || !text(agency.agency_id) || !DIGEST.test(agency.agreement_digest ?? "")
    || !timestamp(agency.agreement_signed_at) || agency.decision_terms_precommitted !== true
    || (timestamp(evidence.started_at) && Date.parse(agency.agreement_signed_at) >= Date.parse(evidence.started_at))) {
    issue(issues, "REAL_AGENCY_AGREEMENT_MISSING", "evidence.agency",
      "A real agency must bind and precommit the pilot agreement before execution.");
  }

  const client = shape(issues, evidence.client, "evidence.client", ["client_id", "real_client", "consent_digest"]);
  if (!client || !text(client.client_id) || client.real_client !== true || !DIGEST.test(client.consent_digest ?? "")) {
    issue(issues, "REAL_CLIENT_CONSENT_MISSING", "evidence.client", "Real-client identity and consent evidence are required.");
  }

  const workflow = shape(issues, evidence.workflow, "evidence.workflow", ["workflow_id", "existing_workflow",
    "customer_owned", "low_risk", "reversible", "pre_pilot_backup_digest", "managed_tls",
    "provider_credentials_at_adapter_edge", "rollback_reference_digest", "selection_record_digest",
    "hard_gates_passed", "preference_score"]);
  if (!workflow || !text(workflow.workflow_id) || workflow.existing_workflow !== true
    || workflow.customer_owned !== true || workflow.low_risk !== true || workflow.reversible !== true
    || !DIGEST.test(workflow.pre_pilot_backup_digest ?? "") || workflow.managed_tls !== true
    || workflow.provider_credentials_at_adapter_edge !== true
    || !DIGEST.test(workflow.rollback_reference_digest ?? "")
    || !DIGEST.test(workflow.selection_record_digest ?? "") || workflow.hard_gates_passed !== true
    || !Number.isSafeInteger(workflow.preference_score)
    || workflow.preference_score < (planValue?.target_selection?.preference_score_minimum ?? 12)
    || workflow.preference_score > 16) {
    issue(issues, "REAL_WORKFLOW_NOT_QUALIFIED", "evidence.workflow",
      "The selected customer-owned workflow must be existing, low-risk, reversible, backed up, TLS-protected, and edge-credentialed.");
  }

  if (!Array.isArray(evidence.journey) || evidence.journey.length !== JOURNEY.length) {
    issue(issues, "PILOT_JOURNEY_INCOMPLETE", "evidence.journey", "Every integrated journey step is required exactly once.");
  } else {
    let previous = Date.parse(evidence.started_at);
    evidence.journey.forEach((step, index) => {
      const item = shape(issues, step, `evidence.journey[${index}]`, ["step", "completed_at", "public_evidence_ref"]);
      const completed = Date.parse(item?.completed_at);
      if (!item || item.step !== JOURNEY[index] || !timestamp(item.completed_at) || !text(item.public_evidence_ref)
        || completed <= previous || completed > Date.parse(evidence.finished_at)) {
        issue(issues, "PILOT_JOURNEY_STEP_INVALID", `evidence.journey[${index}]`,
          "Journey steps must be ordered within the pilot interval and bound to public evidence.");
      }
      if (Number.isFinite(completed)) previous = completed;
    });
  }

  if (!Array.isArray(evidence.friction)) {
    issue(issues, "PILOT_FRICTION_RECORD_INVALID", "evidence.friction", "Friction must be an explicit array, including when empty.");
  } else {
    evidence.friction.forEach((entry, index) => {
      const item = shape(issues, entry, `evidence.friction[${index}]`, ["step", "started_at", "ended_at",
        "human_attention_ms", "material", "observed_code", "resolution"]);
      if (!item || !JOURNEY.includes(item.step) || !timestamp(item.started_at) || !timestamp(item.ended_at)
        || Date.parse(item.ended_at) <= Date.parse(item.started_at)
        || Date.parse(item.started_at) < Date.parse(evidence.started_at)
        || Date.parse(item.ended_at) > Date.parse(evidence.finished_at)
        || !Number.isSafeInteger(item.human_attention_ms) || item.human_attention_ms < 0
        || !MATERIALS.includes(item.material) || !text(item.observed_code) || !text(item.resolution)) {
        issue(issues, "PILOT_FRICTION_RECORD_INVALID", `evidence.friction[${index}]`,
          "Each friction event needs bounded timing, material, observation, resolution, and active attention.");
      }
    });
  }

  const incident = shape(issues, evidence.incident, "evidence.incident", ["case_id", "real_incident",
    "observed_behavior_digest", "expected_behavior_digest"]);
  if (!incident || !UUID.test(incident.case_id ?? "") || incident.real_incident !== true
    || !DIGEST.test(incident.observed_behavior_digest ?? "") || !DIGEST.test(incident.expected_behavior_digest ?? "")) {
    issue(issues, "REAL_INCIDENT_MISSING", "evidence.incident", "At least one real, digest-bound incident is required.");
  }

  const repair = shape(issues, evidence.repair, "evidence.repair", ["candidate_id", "verification_id",
    "promotion_id", "owner_authorization_id", "repair_worker_id", "verifier_id", "owner_id",
    "independently_verified", "owner_authorized", "target_confirmation_digest",
    "rollback_reference_digest", "duplicate_consequential_effects"]);
  if (!repair || ![repair.candidate_id, repair.verification_id, repair.promotion_id, repair.owner_authorization_id]
    .every((entry) => UUID.test(entry ?? "")) || repair.independently_verified !== true
    || new Set([repair.candidate_id, repair.verification_id, repair.promotion_id,
      repair.owner_authorization_id]).size !== 4
    || ![repair.repair_worker_id, repair.verifier_id, repair.owner_id].every((entry) => text(entry))
    || new Set([repair.repair_worker_id, repair.verifier_id, repair.owner_id]).size !== 3
    || repair.owner_authorized !== true || !DIGEST.test(repair.target_confirmation_digest ?? "")
    || !DIGEST.test(repair.rollback_reference_digest ?? "")
    || repair.rollback_reference_digest !== workflow?.rollback_reference_digest
    || repair.duplicate_consequential_effects !== 0) {
    issue(issues, "OWNER_AUTHORIZED_REPAIR_MISSING", "evidence.repair",
      "One exact independently verified, Owner-authorized, target-confirmed repair with zero duplicates is required.");
  }

  const assurance = shape(issues, evidence.assurance, "evidence.assurance", ["bundle_digest", "client_reviewed",
    "useful_to_client", "limitations_acknowledged"]);
  if (!assurance || !DIGEST.test(assurance.bundle_digest ?? "") || assurance.client_reviewed !== true
    || assurance.useful_to_client !== true || assurance.limitations_acknowledged !== true) {
    issue(issues, "CLIENT_ASSURANCE_NOT_ACCEPTED", "evidence.assurance",
      "The real client must review and find the exact assurance bundle useful while acknowledging limitations.");
  }

  const commercial = shape(issues, evidence.commercial, "evidence.commercial", ["decision", "decided_at",
    "agreement_digest", "monthly_amount", "currency"]);
  const commercialQualified = Boolean(commercial && commercial.decision === "retain_paid"
    && timestamp(commercial.decided_at) && DIGEST.test(commercial.agreement_digest ?? "")
    && commercial.currency === planValue?.commercial?.currency
    && Number.isSafeInteger(commercial.monthly_amount)
    && commercial.monthly_amount >= planValue?.commercial?.monthly_per_workflow
    && Date.parse(commercial.decided_at) >= Date.parse(evidence.finished_at)
    && Date.parse(commercial.decided_at) <= Date.parse(evidence.finished_at)
      + (planValue?.commercial?.decision_due_within_days_after_pilot ?? 0) * 86_400_000);
  if (!commercialQualified) {
    issue(issues, "AGENCY_PAYMENT_DECISION_NOT_RETAINED", "evidence.commercial",
      "Issue closure requires the agency to choose paid retention at or above the precommitted monthly hypothesis.");
  }
  if (!Array.isArray(evidence.limitations) || evidence.limitations.length === 0
    || evidence.limitations.some((entry) => !text(entry))) {
    issue(issues, "PILOT_LIMITATIONS_MISSING", "evidence.limitations", "Production limitations must remain explicit.");
  }
  const secret = secretPath(evidence);
  if (secret) issue(issues, "PILOT_SECRET_PROHIBITED", secret, "Pilot evidence contains references, never credentials.");

  issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  const commercialCodes = new Set(["AGENCY_PAYMENT_DECISION_NOT_RETAINED"]);
  const technicalIssues = issues.filter((entry) => !commercialCodes.has(entry.code));
  return {
    valid: issues.length === 0,
    technical_qualified: technicalIssues.length === 0,
    commercial_qualified: commercialQualified,
    issues
  };
}
