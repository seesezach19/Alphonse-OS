const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_ACTIVE_MS = 8 * 60 * 60 * 1000;
const MAX_HUMAN_MS = 2 * 60 * 60 * 1000;
const ALLOWED_MATERIALS = ["kernel_protocol", "public_documentation", "builder_toolkit",
  "running_local_environment", "source_system_access"];
const EXPLANATION_FIELDS = ["identity", "intent", "versions", "context", "authority", "effect", "evidence",
  "uncertainty", "recovery", "final_accountability"];
const SHORTCUT_FIELDS = ["direct_sql_used", "authority_bypass_used", "hidden_scaffold_used", "secret_copied",
  "duplicate_uncertain_effect", "failure_history_erased"];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function issue(issues, code, path, message) {
  issues.push({ code, path, message });
}

function shape(issues, value, path, keys) {
  const candidate = object(value);
  if (!candidate) {
    issue(issues, "INVALID_PROOF_SHAPE", path, "Value must be an object.");
    return null;
  }
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    issue(issues, "INVALID_PROOF_SHAPE", path, "Object fields do not match the proof contract.");
  }
  return candidate;
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 2000;
}

function time(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function exactStrings(value, expected) {
  return Array.isArray(value) && value.length === expected.length
    && [...value].sort().every((entry, index) => entry === [...expected].sort()[index]);
}

function findSecret(value, path = "proof") {
  if (typeof value === "string" && (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    || /\bAKIA[0-9A-Z]{16}\b/.test(value) || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)
    || /^Bearer\s+\S+$/i.test(value))) return path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecret(value[index], `${path}[${index}]`);
      if (found) return found;
    }
  } else if (object(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (/(^|_)(password|private_key|token|api_key|secret|authorization)($|_)/i.test(key)
        && typeof child !== "boolean") return `${path}.${key}`;
      const found = findSecret(child, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

export function validateQualificationPacket(value) {
  const issues = [];
  const packet = shape(issues, value, "proof", ["schema_version", "proof_session_id", "started_at", "finished_at",
    "builder", "timing", "integrity", "runtime_handoff", "staging_recovery", "production_effect",
    "operator_explanation", "builder_reviews"]);
  if (!packet) return { valid: false, issues };
  if (packet.schema_version !== "alphonse.unfamiliar_builder_proof.v0.1") {
    issue(issues, "PROOF_SCHEMA_UNSUPPORTED", "proof.schema_version", "Proof schema is unsupported.");
  }
  if (!UUID.test(packet.proof_session_id ?? "")) issue(issues, "INVALID_PROOF_ID", "proof.proof_session_id", "Proof Session ID must be a UUID.");
  if (!time(packet.started_at) || !time(packet.finished_at) || Date.parse(packet.finished_at) <= Date.parse(packet.started_at)) {
    issue(issues, "INVALID_PROOF_CLOCK", "proof", "Proof timestamps must define a positive interval.");
  }

  const builder = shape(issues, packet.builder, "proof.builder", ["builder_id", "unfamiliar_with_kernel_internals",
    "has_not_built_operational_package", "kernel_source_accessed", "internal_schema_accessed", "allowed_materials"]);
  if (!builder || !text(builder.builder_id) || builder.unfamiliar_with_kernel_internals !== true
    || builder.has_not_built_operational_package !== true || builder.kernel_source_accessed !== false
    || builder.internal_schema_accessed !== false || !exactStrings(builder.allowed_materials, ALLOWED_MATERIALS)) {
    issue(issues, "BUILDER_NOT_UNFAMILIAR", "proof.builder",
      "Builder must be unfamiliar and receive only the declared public starting materials.");
  }

  const timing = shape(issues, packet.timing, "proof.timing", ["workflow_active_ms", "human_attention_ms",
    "agent_runtime_ms", "external_wait_ms", "environment_setup_ms"]);
  if (timing) {
    for (const [key, number] of Object.entries(timing)) {
      if (!Number.isSafeInteger(number) || number < 0) issue(issues, "INVALID_PROOF_CLOCK", `proof.timing.${key}`, "Timing must be non-negative integer milliseconds.");
    }
    if (timing.workflow_active_ms >= MAX_ACTIVE_MS) issue(issues, "ACTIVE_TIME_LIMIT_EXCEEDED", "proof.timing.workflow_active_ms", "Workflow active time must remain under eight hours.");
    if (timing.human_attention_ms >= MAX_HUMAN_MS) issue(issues, "HUMAN_ATTENTION_LIMIT_EXCEEDED", "proof.timing.human_attention_ms", "Human attention must remain under two hours.");
  }

  const integrity = shape(issues, packet.integrity, "proof.integrity", ["kernel_source_before", "kernel_source_after",
    "schema_before", "schema_after", ...SHORTCUT_FIELDS]);
  if (integrity) {
    for (const field of ["kernel_source_before", "kernel_source_after", "schema_before", "schema_after"]) {
      if (!DIGEST.test(integrity[field] ?? "")) issue(issues, "INVALID_INTEGRITY_DIGEST", `proof.integrity.${field}`, "Integrity value must be a SHA-256 digest.");
    }
    if (integrity.kernel_source_before !== integrity.kernel_source_after || integrity.schema_before !== integrity.schema_after) {
      issue(issues, "KERNEL_OR_SCHEMA_CHANGED", "proof.integrity", "Kernel source and schema must remain unchanged during workflow construction.");
    }
    for (const field of SHORTCUT_FIELDS) {
      if (integrity[field] !== false) issue(issues, "DISQUALIFYING_SHORTCUT", `proof.integrity.${field}`, "Any bypass or erased history fails qualification.");
    }
  }

  const handoff = shape(issues, packet.runtime_handoff, "proof.runtime_handoff", ["handoff_id", "source_passport_id",
    "target_passport_id", "source_runtime", "target_runtime", "conversation_history_received", "hidden_memory_received"]);
  if (!handoff || !UUID.test(handoff.handoff_id ?? "") || !UUID.test(handoff.source_passport_id ?? "")
    || !UUID.test(handoff.target_passport_id ?? "") || handoff.source_passport_id === handoff.target_passport_id
    || !text(handoff.source_runtime) || !text(handoff.target_runtime) || handoff.source_runtime === handoff.target_runtime
    || handoff.conversation_history_received !== false || handoff.hidden_memory_received !== false) {
    issue(issues, "RUNTIME_HANDOFF_NOT_DISTINCT", "proof.runtime_handoff",
      "Handoff requires distinct runtime identities and no conversation history or hidden memory.");
  }

  const recovery = shape(issues, packet.staging_recovery, "proof.staging_recovery",
    ["recovery_case_id", "was_uncertain", "final_status", "completed_at"]);
  if (!recovery || !UUID.test(recovery.recovery_case_id ?? "") || recovery.was_uncertain !== true
    || recovery.final_status !== "resolved_applied" || !time(recovery.completed_at)) {
    issue(issues, "STAGING_RECOVERY_INCOMPLETE", "proof.staging_recovery", "Staging uncertainty must be resolved and preserved before production.");
  }

  const effect = shape(issues, packet.production_effect, "proof.production_effect", ["effect_id", "run_id",
    "evidence_record_id", "capability_activation_id", "target_system", "target_subject", "provider", "aws",
    "selected_by_user", "approved_by_user", "reversible", "completed_at"]);
  if (!effect || ![effect.effect_id, effect.run_id, effect.evidence_record_id, effect.capability_activation_id]
    .every((entry) => UUID.test(entry ?? "")) || !text(effect.target_system) || /staging/i.test(effect.target_system)
    || !text(effect.target_subject) || !text(effect.provider) || /\baws\b|amazon web services/i.test(effect.provider)
    || effect.aws !== false
    || effect.selected_by_user !== true || effect.approved_by_user !== true || effect.reversible !== true
    || !time(effect.completed_at)) {
    issue(issues, "PRODUCTION_EFFECT_NOT_QUALIFIED", "proof.production_effect",
      "Production effect must be user-selected, approved, reversible, non-AWS, and bound to exact public records.");
  }
  if (recovery && effect && time(recovery.completed_at) && time(effect.completed_at)
    && Date.parse(recovery.completed_at) >= Date.parse(effect.completed_at)) {
    issue(issues, "STAGING_RECOVERY_NOT_BEFORE_PRODUCTION", "proof.staging_recovery.completed_at",
      "Staging recovery must complete before the production effect.");
  }

  const explanation = shape(issues, packet.operator_explanation, "proof.operator_explanation", ["source", ...EXPLANATION_FIELDS]);
  if (!explanation || explanation.source !== "butler" || EXPLANATION_FIELDS.some((field) => !text(explanation[field]))) {
    issue(issues, "OPERATOR_EXPLANATION_INCOMPLETE", "proof.operator_explanation",
      "Business Operator must explain every required dimension from Butler.");
  }

  if (!Array.isArray(packet.builder_reviews) || packet.builder_reviews.length < 5) {
    issue(issues, "BUILDER_REVIEWS_INCOMPLETE", "proof.builder_reviews", "At least five distinct builder reviews are required.");
  } else {
    const reviewers = new Set();
    packet.builder_reviews.forEach((review, index) => {
      const path = `proof.builder_reviews[${index}]`;
      const item = shape(issues, review, path, ["reviewer_id", "understanding", "test_requests",
        "supplied_workflow_interest", "paid_workflow_interest"]);
      if (!item || !text(item.reviewer_id) || reviewers.has(item.reviewer_id) || !text(item.understanding)
        || !Array.isArray(item.test_requests) || item.test_requests.length === 0 || item.test_requests.some((entry) => !text(entry))
        || typeof item.supplied_workflow_interest !== "boolean" || typeof item.paid_workflow_interest !== "boolean") {
        issue(issues, "BUILDER_REVIEW_INVALID", path, "Review must record distinct identity, understanding, tests, and workflow interest.");
      }
      if (item?.reviewer_id) reviewers.add(item.reviewer_id);
    });
  }

  const secretPath = findSecret(packet);
  if (secretPath) issue(issues, "SECRET_MATERIAL_PROHIBITED", secretPath, "Proof packets contain references and explanations, never credentials.");
  issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  return { valid: issues.length === 0, issues };
}

export async function verifyQualificationAgainstPublicState(packet, { kernelUrl, operatorToken, fetchImpl = fetch }) {
  const structural = validateQualificationPacket(packet);
  if (!structural.valid) return structural;
  const issues = [];
  const read = async (path, field) => {
    const response = await fetchImpl(`${kernelUrl}${path}`, { headers: { authorization: `Bearer ${operatorToken}` } });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    const body = await response.json();
    return field ? body[field] : body;
  };
  const [handoff, recovery, effect, run, evidence, overview] = await Promise.all([
    read(`/kernel/v0/handoffs/${packet.runtime_handoff.handoff_id}`, "handoff"),
    read(`/kernel/v0/recovery-cases/${packet.staging_recovery.recovery_case_id}`, "recovery_case"),
    read(`/kernel/v0/effects/${packet.production_effect.effect_id}`, "effect_record"),
    read(`/kernel/v0/runs/${packet.production_effect.run_id}`, "run"),
    read(`/kernel/v0/evidence-records/${packet.production_effect.evidence_record_id}`, "evidence_record"),
    read("/kernel/v0/accountable-work/overview", null)
  ]);
  const overviewBody = overview;
  if (handoff.state !== "accepted" || handoff.source_passport_id !== packet.runtime_handoff.source_passport_id
    || handoff.target_passport_id !== packet.runtime_handoff.target_passport_id
    || handoff.conversation_history_received !== false || handoff.hidden_memory_received !== false) {
    issue(issues, "PUBLIC_HANDOFF_MISMATCH", "public.handoff", "Public handoff does not match the proof packet.");
  }
  if (recovery.status !== packet.staging_recovery.final_status || recovery.was_uncertain !== true
    || Date.parse(recovery.updated_at) !== Date.parse(packet.staging_recovery.completed_at)) {
    issue(issues, "PUBLIC_RECOVERY_MISMATCH", "public.recovery_case", "Public Recovery Case does not prove staging uncertainty recovery.");
  }
  if (effect.status !== "succeeded" || effect.run_id !== packet.production_effect.run_id
    || effect.evidence_record_id !== packet.production_effect.evidence_record_id
    || effect.capability_activation_id !== packet.production_effect.capability_activation_id
    || effect.target?.system !== packet.production_effect.target_system
    || Date.parse(effect.completed_at) !== Date.parse(packet.production_effect.completed_at)
    || effect.target?.subject !== packet.production_effect.target_subject) {
    issue(issues, "PUBLIC_EFFECT_MISMATCH", "public.effect", "Public Effect does not match the approved production proof.");
  }
  if (run.execution_status !== "succeeded" || run.accountability_status !== "satisfied"
    || run.evidence_record_id !== packet.production_effect.evidence_record_id) {
    issue(issues, "PUBLIC_ACCOUNTABILITY_MISMATCH", "public.run", "Run must be succeeded and accountability satisfied.");
  }
  if (evidence.run_id !== packet.production_effect.run_id || evidence.evidence_record_id !== packet.production_effect.evidence_record_id) {
    issue(issues, "PUBLIC_EVIDENCE_MISMATCH", "public.evidence", "Evidence does not bind the exact production Run.");
  }
  if (!overviewBody || overviewBody.authority !== "read_only_projection"
    || !overviewBody.handoffs.items.some((item) => item.handoff_id === handoff.handoff_id)
    || !overviewBody.effects.items.some((item) => item.effect_id === effect.effect_id)
    || !overviewBody.recovery_cases.items.some((item) => item.recovery_case_id === recovery.recovery_case_id)) {
    issue(issues, "BUTLER_PROJECTION_INCOMPLETE", "public.butler", "Butler does not project every proof-critical record.");
  }
  return { valid: issues.length === 0, issues };
}
