import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeTrustedOperator,
  directOwnerActor,
  isAuthorizedOwner,
  trustedOperatorOperations
} from "../../src/trusted-operator.js";

const passport = {
  passport_id: "00000000-0000-4000-8000-000000000810",
  agent_principal_id: "00000000-0000-4000-8000-000000000811",
  sponsor_principal_id: "00000000-0000-4000-8000-000000000812",
  permitted_intent_classes: ["trusted_operator"],
  package_skill_configuration: {
    protocol: "alphonse-trusted-operator-0.2.0",
    operator_operations: ["diagnostic.repair_task.create", "diagnostic.promotion.authorize"]
  }
};
const headers = {
  "x-alphonse-authorization-channel": "openclaw_chat",
  "x-alphonse-instruction-digest": `sha256:${"a".repeat(64)}`,
  "x-alphonse-authorized-at": "2026-07-16T04:04:20.000Z"
};

test("trusted operator records sponsor, executor, channel, and exact instruction", () => {
  const authorized = authorizeTrustedOperator(passport, "diagnostic.repair_task.create", headers);
  assert.equal(authorized.actor.type, "agent");
  assert.equal(authorized.actor.id, passport.agent_principal_id);
  assert.deepEqual(authorized.actor.authorization.authorized_by,
    { type: "human", id: passport.sponsor_principal_id });
  assert.deepEqual(authorized.actor.authorization.executed_by,
    { type: "agent", id: passport.agent_principal_id });
  assert.equal(authorized.actor.authorization.channel, "openclaw_chat");
  assert.equal(isAuthorizedOwner(authorized.actor), true);
});

test("trusted operator cannot invoke an operation omitted from its passport", () => {
  assert.throws(() => authorizeTrustedOperator(passport, "diagnostic.promotion.apply", headers),
    (error) => error.code === "OPERATOR_OPERATION_NOT_GRANTED");
});

test("trusted operator requires explicit authorization evidence", () => {
  assert.throws(() => authorizeTrustedOperator(passport, "diagnostic.repair_task.create", {}),
    (error) => error.code === "INVALID_OPERATOR_AUTHORIZATION");
});

test("ordinary agent passports never become trusted operators", () => {
  assert.deepEqual(trustedOperatorOperations({ ...passport, permitted_intent_classes: ["diagnostic_analysis"] }), []);
  assert.equal(isAuthorizedOwner({ type: "agent", id: passport.agent_principal_id }), false);
});

test("direct owner remains distinguishable from agent execution", () => {
  const actor = directOwnerActor({ type: "human", id: passport.sponsor_principal_id });
  assert.equal(actor.authorization.mode, "direct_owner");
  assert.deepEqual(actor.authorization.executed_by, { type: "human", id: passport.sponsor_principal_id });
});
