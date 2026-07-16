const LAYERS = new Set(["generation", "orchestration", "integration", "ai_runtime", "security"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const RESPONSES = new Set(["reject", "quarantine", "retry", "reconcile", "compensate", "escalate", "continue"]);

function fail(message) {
  throw new Error(`Invalid Agency Lab case: ${message}`);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value;
}

function exact(value, field, keys) {
  object(value, field);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${field} fields must be exact`);
  return value;
}

function string(value, field, maximum = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) fail(`${field} must be bounded text`);
  return value.trim();
}

function strings(value, field, { minimum = 1, maximum = 30 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${field} has invalid length`);
  return value.map((item, index) => string(item, `${field}[${index}]`, 500));
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${field} must be a positive integer`);
  return value;
}

function identifier(value, field) {
  const checked = string(value, field, 100);
  if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(checked)) {
    fail(`${field} must be an uppercase metadata identifier`);
  }
  return checked;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative integer`);
  return value;
}

export function validateAgencyLabCase(value) {
  const input = exact(value, "case", [
    "schema_version", "failure_id", "title", "domain", "layer", "failure_primitive",
    "platform_tags", "severity", "scenario", "fault_injection", "expected_response_class",
    "expected_behavior", "forbidden_behavior", "state_invariants", "side_effect_invariants",
    "evidence_requirements", "worker_policy", "repeat", "controller"
  ]);
  if (input.schema_version !== "0.1.0") fail("schema_version must be 0.1.0");
  if (!LAYERS.has(input.layer)) fail("layer is unsupported");
  if (!SEVERITIES.has(input.severity)) fail("severity is unsupported");
  if (!RESPONSES.has(input.expected_response_class)) fail("expected_response_class is unsupported");

  const scenario = exact(input.scenario, "scenario", ["objective", "input_fixture"]);
  const fault = exact(input.fault_injection, "fault_injection", ["kind", "target", "trigger"]);
  object(fault.trigger, "fault_injection.trigger");
  const workerPolicy = exact(input.worker_policy, "worker_policy", [
    "allowed_inputs", "prohibited_inputs", "allowed_actions"
  ]);
  const repeat = exact(input.repeat, "repeat", ["controller_runs", "worker_runs"]);
  const controller = exact(input.controller, "controller", ["evaluator_id", "answer_key_file"]);

  const stateInvariants = input.state_invariants.map((item, index) => {
    object(item, `state_invariants[${index}]`);
    if (item.kind === "record_reconciliation") {
      const invariant = exact(item, `state_invariants[${index}]`, [
        "invariant_id", "kind", "source_path", "result_path"
      ]);
      return {
        invariant_id: string(invariant.invariant_id, "invariant_id", 100),
        kind: invariant.kind,
        source_path: string(invariant.source_path, "source_path", 200),
        result_path: string(invariant.result_path, "result_path", 200)
      };
    }
    if (item.kind === "expected_value") {
      const invariant = exact(item, `state_invariants[${index}]`, [
        "invariant_id", "kind", "result_path", "expected_value"
      ]);
      return {
        invariant_id: string(invariant.invariant_id, "invariant_id", 100),
        kind: invariant.kind,
        result_path: string(invariant.result_path, "result_path", 200),
        expected_value: string(invariant.expected_value, "expected_value", 200)
      };
    }
    fail(`${item.invariant_id ?? `state_invariants[${index}]`} kind is unsupported`);
  });
  const sideEffectInvariants = input.side_effect_invariants.map((item, index) => {
    object(item, `side_effect_invariants[${index}]`);
    if (item.kind === "collection_cardinality") {
      const invariant = exact(item, `side_effect_invariants[${index}]`, [
        "invariant_id", "kind", "result_path", "scope_field", "expected_count_per_scope"
      ]);
      return {
        invariant_id: string(invariant.invariant_id, "invariant_id", 100),
        kind: invariant.kind,
        result_path: string(invariant.result_path, "result_path", 200),
        scope_field: string(invariant.scope_field, "scope_field", 100),
        expected_count_per_scope: positiveInteger(invariant.expected_count_per_scope, "expected_count_per_scope")
      };
    }
    if (item.kind === "collection_count") {
      const invariant = exact(item, `side_effect_invariants[${index}]`, [
        "invariant_id", "kind", "result_path", "expected_count"
      ]);
      return {
        invariant_id: string(invariant.invariant_id, "invariant_id", 100),
        kind: invariant.kind,
        result_path: string(invariant.result_path, "result_path", 200),
        expected_count: nonNegativeInteger(invariant.expected_count, "expected_count")
      };
    }
    fail(`${item.invariant_id ?? `side_effect_invariants[${index}]`} kind is unsupported`);
  });
  const evidenceRequirements = input.evidence_requirements.map((item, index) => {
    const requirement = exact(item, `evidence_requirements[${index}]`, [
      "evidence_id", "kind", "minimum_count", "required_fields"
    ]);
    return {
      evidence_id: string(requirement.evidence_id, "evidence_id", 100),
      kind: string(requirement.kind, "kind", 100),
      minimum_count: positiveInteger(requirement.minimum_count, "minimum_count"),
      required_fields: strings(requirement.required_fields, "required_fields")
    };
  });

  return {
    schema_version: "0.1.0",
    failure_id: identifier(input.failure_id, "failure_id"),
    title: string(input.title, "title", 200),
    domain: string(input.domain, "domain", 100),
    layer: input.layer,
    failure_primitive: string(input.failure_primitive, "failure_primitive", 100),
    platform_tags: strings(input.platform_tags, "platform_tags"),
    severity: input.severity,
    scenario: {
      objective: string(scenario.objective, "scenario.objective", 1000),
      input_fixture: string(scenario.input_fixture, "scenario.input_fixture", 500)
    },
    fault_injection: {
      kind: string(fault.kind, "fault_injection.kind", 100),
      target: string(fault.target, "fault_injection.target", 200),
      trigger: structuredClone(fault.trigger)
    },
    expected_response_class: input.expected_response_class,
    expected_behavior: string(input.expected_behavior, "expected_behavior", 1000),
    forbidden_behavior: strings(input.forbidden_behavior, "forbidden_behavior"),
    state_invariants: stateInvariants,
    side_effect_invariants: sideEffectInvariants,
    evidence_requirements: evidenceRequirements,
    worker_policy: {
      allowed_inputs: strings(workerPolicy.allowed_inputs, "worker_policy.allowed_inputs"),
      prohibited_inputs: strings(workerPolicy.prohibited_inputs, "worker_policy.prohibited_inputs"),
      allowed_actions: strings(workerPolicy.allowed_actions, "worker_policy.allowed_actions")
    },
    repeat: {
      controller_runs: positiveInteger(repeat.controller_runs, "repeat.controller_runs"),
      worker_runs: positiveInteger(repeat.worker_runs, "repeat.worker_runs")
    },
    controller: {
      evaluator_id: string(controller.evaluator_id, "controller.evaluator_id", 100),
      answer_key_file: string(controller.answer_key_file, "controller.answer_key_file", 500)
    }
  };
}
