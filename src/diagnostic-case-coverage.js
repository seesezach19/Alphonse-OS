import { canonicalize } from "./canonical-json.js";

function compareCanonical(left, right) {
  const leftBytes = canonicalize(left);
  const rightBytes = canonicalize(right);
  return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
}

function streamKey(grantId, streamId) {
  return `${grantId ?? ""}\u0000${streamId ?? ""}`;
}

export function selectCaseRelevantCoverage({ correlationProjection, observationEvidence }) {
  const selectedReceiptIds = new Set(observationEvidence.map((entry) => entry.receipt_id));
  const contributingStreams = new Set(observationEvidence.map((entry) => streamKey(
    entry.envelope?.grant_id, entry.envelope?.stream_id
  )));
  const streams = correlationProjection.coverage.streams.filter((entry) => contributingStreams.has(
    streamKey(entry.grant_id, entry.stream_id)
  )).map((entry) => structuredClone(entry)).sort(compareCanonical);
  const conflicts = correlationProjection.coverage.conflicts.filter((entry) =>
    (entry.accepted_receipt_ids ?? []).some((receiptId) => selectedReceiptIds.has(receiptId)))
    .map((entry) => structuredClone(entry)).sort(compareCanonical);
  const limitations = correlationProjection.coverage.limitations.filter((entry) =>
    selectedReceiptIds.has(entry.receipt_id)).map((entry) => structuredClone(entry)).sort(compareCanonical);
  return {
    streams,
    conflicts,
    // Rejection material intentionally lacks a trustworthy operation or stream binding.
    // It remains frozen in the complete prefix and independent-verification lineage, but
    // cannot become case evidence merely because it was received by the same installation.
    rejections: [],
    limitations
  };
}
