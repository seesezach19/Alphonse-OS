import assert from "node:assert/strict";

import {
  evaluateDefectiveAmbiguousLeadFixture,
  evaluateDefectiveLeadFixture,
  evaluateDefectiveSchemaChangeFixture,
  evaluateDefectiveStaleRoutingFixture,
  evaluateRepairedAmbiguousLeadFixture,
  evaluateRepairedLeadFixture,
  evaluateRepairedSchemaChangeFixture,
  evaluateRepairedStaleRoutingFixture
} from "../../n8n-operational-package/src/index.js";

function atPath(value, pathValue) {
  return pathValue.split(".").reduce((current, part) => current?.[part], value);
}

function evaluateRecordInvariant(invariant, fixture, result) {
  const source = atPath(fixture, invariant.source_path);
  const actual = atPath(result, invariant.result_path);
  const expected = Array.isArray(source) ? source.length : source;
  return {
    invariant_id: invariant.invariant_id,
    passed: Number.isSafeInteger(expected) && actual === expected,
    expected,
    actual
  };
}

function evaluateExpectedValueInvariant(invariant, result) {
  const actual = atPath(result, invariant.result_path);
  return {
    invariant_id: invariant.invariant_id,
    passed: actual === invariant.expected_value,
    expected: invariant.expected_value,
    actual
  };
}

function evaluateCardinalityInvariant(invariant, result) {
  const collection = atPath(result, invariant.result_path);
  assert.equal(Array.isArray(collection), true, `${invariant.result_path} must be an array`);
  const counts = new Map();
  for (const item of collection) {
    const scope = item[invariant.scope_field];
    assert.equal(typeof scope, "string", `${invariant.result_path}.${invariant.scope_field} is required`);
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  const observed = Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
  return {
    invariant_id: invariant.invariant_id,
    passed: counts.size > 0 && [...counts.values()].every((count) => count === invariant.expected_count_per_scope),
    expected_count_per_scope: invariant.expected_count_per_scope,
    observed
  };
}

function evaluateCollectionCountInvariant(invariant, result) {
  const collection = atPath(result, invariant.result_path);
  assert.equal(Array.isArray(collection), true, `${invariant.result_path} must be an array`);
  return {
    invariant_id: invariant.invariant_id,
    passed: collection.length === invariant.expected_count,
    expected: invariant.expected_count,
    actual: collection.length
  };
}

function evaluateInvariants(caseDefinition, fixture, result) {
  const state = caseDefinition.state_invariants.map((invariant) => invariant.kind === "record_reconciliation"
    ? evaluateRecordInvariant(invariant, fixture, result)
    : evaluateExpectedValueInvariant(invariant, result));
  const sideEffects = caseDefinition.side_effect_invariants.map((invariant) =>
    invariant.kind === "collection_cardinality"
      ? evaluateCardinalityInvariant(invariant, result)
      : evaluateCollectionCountInvariant(invariant, result));
  return {
    state,
    side_effects: sideEffects,
    passed: [...state, ...sideEffects].every((invariant) => invariant.passed)
  };
}

function executeEvaluator(evaluatorId, fixture) {
  if (evaluatorId === "lead_duplicate_delivery_v1") {
    return {
      defective: evaluateDefectiveLeadFixture(fixture),
      repaired: evaluateRepairedLeadFixture(fixture)
    };
  }
  if (evaluatorId === "lead_ambiguous_write_v1") {
    return {
      defective: evaluateDefectiveAmbiguousLeadFixture(fixture),
      repaired: evaluateRepairedAmbiguousLeadFixture(fixture)
    };
  }
  if (evaluatorId === "lead_stale_routing_v1") {
    return {
      defective: evaluateDefectiveStaleRoutingFixture(fixture),
      repaired: evaluateRepairedStaleRoutingFixture(fixture)
    };
  }
  if (evaluatorId === "lead_schema_change_v1") {
    return {
      defective: evaluateDefectiveSchemaChangeFixture(fixture),
      repaired: evaluateRepairedSchemaChangeFixture(fixture)
    };
  }
  throw new Error(`Unsupported Agency Lab evaluator ${evaluatorId}`);
}

function assertExpectedFixtureResults(caseDefinition, fixture, defective, repaired) {
  assert.equal(defective.crm_leads.length, fixture.expected.defective.crm_lead_count);
  assert.equal(defective.notifications.length, fixture.expected.defective.notification_count);
  assert.equal(defective.lead_state, fixture.expected.defective.lead_state);
  assert.equal(repaired.crm_leads.length, fixture.expected.repaired.crm_lead_count);
  assert.equal(repaired.notifications.length, fixture.expected.repaired.notification_count);
  assert.equal(repaired.lead_state, fixture.expected.repaired.lead_state);
  if (caseDefinition.controller.evaluator_id === "lead_ambiguous_write_v1") {
    assert.equal(defective.external_effects.filter((effect) => effect.operation === "create_lead").length,
      fixture.expected.defective.crm_create_attempt_count);
    assert.equal(repaired.external_effects.filter((effect) => effect.operation === "create_lead").length,
      fixture.expected.repaired.crm_create_attempt_count);
    assert.equal(repaired.reconciliations.length, fixture.expected.repaired.reconciliation_count);
  }
  if (caseDefinition.controller.evaluator_id === "lead_stale_routing_v1") {
    assert.equal(defective.routing_decisions.length, fixture.expected.defective.routing_decision_count);
    assert.equal(repaired.routing_decisions.length, fixture.expected.repaired.routing_decision_count);
    assert.equal(repaired.escalations.length, fixture.expected.repaired.escalation_count);
  }
  if (caseDefinition.controller.evaluator_id === "lead_schema_change_v1") {
    assert.equal(defective.crm_leads[0].qualification.status,
      fixture.expected.defective.qualification_status);
    assert.equal(repaired.crm_leads[0].qualification.status,
      fixture.expected.repaired.qualification_status);
    assert.equal(defective.mapping_observations[0].defaults_applied.length, 1);
    assert.equal(repaired.mapping_observations[0].aliases_applied.length, 1);
  }
}

export function runAgencyLabCase(caseDefinition, fixture) {
  const { defective, repaired } = executeEvaluator(caseDefinition.controller.evaluator_id, fixture);
  assertExpectedFixtureResults(caseDefinition, fixture, defective, repaired);
  const baselineInvariants = evaluateInvariants(caseDefinition, fixture, defective);
  const repairedInvariants = evaluateInvariants(caseDefinition, fixture, repaired);
  assert.equal(baselineInvariants.passed, false);
  assert.equal(repairedInvariants.passed, true);
  return {
    case_id: caseDefinition.failure_id,
    failure_primitive: caseDefinition.failure_primitive,
    expected_response_class: caseDefinition.expected_response_class,
    failure_demonstrated: true,
    repaired_passed: true,
    baseline: defective,
    repaired,
    invariants: {
      baseline: baselineInvariants,
      repaired: repairedInvariants
    }
  };
}
