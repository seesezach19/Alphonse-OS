import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  packageIdentity,
  publicKeyText,
  signDocument,
  validateAdvisoryShape,
  verifyDocument,
  verifyRelease
} from "./portable-trust.js";

export class RegistryError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "RegistryError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function conflict(code, message, details) {
  throw new RegistryError(409, code, message, details);
}

function exactDependencyIdentity(reference) {
  return `${reference.package_id}@${reference.semantic_version}#${reference.manifest_digest}+${reference.package_artifact_digest}`;
}

export function createPackageRegistryService(pool, registryId, registryPrivateKey, {
  trustedSourceRegistries = {},
  advisorySnapshotTtlSeconds = 3600
} = {}) {
  const registryPublicKey = publicKeyText(registryPrivateKey);
  const registryKeyId = sha256Digest(registryPublicKey);

  async function appendTransparency(client, entryType, entry, recordedAt) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`registry:${registryId}`]);
    const previous = await client.query(
      `SELECT sequence, root_hash FROM registry_transparency_entries
       WHERE registry_id=$1 ORDER BY sequence DESC LIMIT 1`,
      [registryId]
    );
    const sequence = previous.rows[0] ? Number(previous.rows[0].sequence) + 1 : 1;
    const entryDigest = sha256Digest(entry);
    const rootHash = sha256Digest({
      previous_root_hash: previous.rows[0]?.root_hash ?? null,
      sequence,
      entry_digest: entryDigest
    });
    await client.query(
      `INSERT INTO registry_transparency_entries
       (registry_id,sequence,entry_type,entry_digest,root_hash,entry,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [registryId, sequence, entryType, entryDigest, rootHash, JSON.stringify(entry), recordedAt]
    );
    return { registry_id: registryId, sequence, root_hash: rootHash, issued_at: recordedAt };
  }

  async function publish(release, { retainedCustodyReceipts = [], custodyMode = "publication" } = {},
    transactionClient = null) {
    const verified = verifyRelease(release, { requireCurrentDelegation: custodyMode === "publication" });
    const client = transactionClient ?? await pool.connect();
    const ownsTransaction = transactionClient === null;
    try {
      if (ownsTransaction) await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `registry-package:${registryId}:${verified.package_id}:${verified.semantic_version}`
      ]);
      const existing = await client.query(
        `SELECT * FROM registry_publications
         WHERE registry_id=$1 AND package_id=$2 AND semantic_version=$3`,
        [registryId, verified.package_id, verified.semantic_version]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].package_artifact_digest !== verified.package_artifact_digest
            || existing.rows[0].manifest_digest !== verified.manifest_digest
            || existing.rows[0].release_digest !== verified.release_digest) {
          conflict("PACKAGE_VERSION_BYTES_CONFLICT", "Package version already binds different bytes.");
        }
        if (ownsTransaction) await client.query("COMMIT");
        return { replayed: true, publication: existing.rows[0] };
      }

      for (const dependency of verified.dependencies) {
        const found = await client.query(
          `SELECT package_artifact_digest,manifest_digest FROM registry_publications
           WHERE registry_id=$1 AND package_id=$2 AND semantic_version=$3`,
          [registryId, dependency.package_id, dependency.semantic_version]
        );
        if (!found.rows[0] || found.rows[0].package_artifact_digest !== dependency.package_artifact_digest
            || found.rows[0].manifest_digest !== dependency.manifest_digest) {
          conflict("DEPENDENCY_NOT_PUBLISHED", `Exact dependency ${exactDependencyIdentity(dependency)} is unavailable.`);
        }
      }

      const publishedAt = new Date().toISOString();
      const entry = {
        schema_version: "alphonse.registry_entry.v0.1",
        entry_type: "publication",
        registry_id: registryId,
        package_identity: verified.package_identity,
        release_digest: sha256Digest(release),
        recorded_at: publishedAt
      };
      const checkpoint = await appendTransparency(client, "publication", entry, publishedAt);
      const receiptDocument = {
        schema_version: "alphonse.publication_receipt.v0.1",
        registry_id: registryId,
        package_id: verified.package_id,
        semantic_version: verified.semantic_version,
        package_artifact_digest: verified.package_artifact_digest,
        manifest_digest: verified.manifest_digest,
        release_digest: verified.release_digest,
        publisher_proof_digest: sha256Digest({ publisher: release.publisher, delegation: release.delegation }),
        artifact_descriptors: verified.artifact_descriptors,
        attestation_digests: verified.attestation_digests,
        custody_mode: custodyMode,
        source_receipt_digests: retainedCustodyReceipts.map((entry) => sha256Digest(entry)).sort(),
        transparency_checkpoint: checkpoint,
        published_at: publishedAt
      };
      const receipt = {
        document: receiptDocument,
        registry_key_id: registryKeyId,
        registry_signature: signDocument(receiptDocument, registryPrivateKey)
      };
      const custodyReceipts = [...retainedCustodyReceipts, receipt];
      await client.query(
        `INSERT INTO registry_publications
         (registry_id,package_id,semantic_version,package_artifact_digest,manifest_digest,release_digest,
          release_record,custody_receipts,published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [registryId, verified.package_id, verified.semantic_version, verified.package_artifact_digest,
          verified.manifest_digest, verified.release_digest, JSON.stringify(release), JSON.stringify(custodyReceipts),
          publishedAt]
      );
      if (ownsTransaction) await client.query("COMMIT");
      return {
        replayed: false,
        publication: {
          registry_id: registryId,
          package_identity: verified.package_identity,
          release_digest: entry.release_digest,
          custody_receipts: custodyReceipts,
          publication_receipt: receipt,
          published_at: publishedAt
        }
      };
    } catch (error) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  async function discover(packageId) {
    const values = [registryId];
    let filter = "";
    if (packageId) {
      values.push(packageId);
      filter = " AND package_id=$2";
    }
    const result = await pool.query(
      `SELECT registry_id,package_id,semantic_version,manifest_digest,package_artifact_digest,published_at
       FROM registry_publications WHERE registry_id=$1${filter}
       ORDER BY package_id,semantic_version`,
      values
    );
    return result.rows.map((row) => ({ ...row,
      package_identity: `${row.package_id}@${row.semantic_version}#${row.manifest_digest}+${row.package_artifact_digest}` }));
  }

  async function loadPublication(packageId, semanticVersion, digest, manifestDigest) {
    const result = await pool.query(
      `SELECT * FROM registry_publications
       WHERE registry_id=$1 AND package_id=$2 AND semantic_version=$3`,
      [registryId, packageId, semanticVersion]
    );
    const row = result.rows[0];
    if (!row || (digest && row.package_artifact_digest !== digest)
        || (manifestDigest && row.manifest_digest !== manifestDigest)) {
      throw new RegistryError(404, "PACKAGE_NOT_FOUND", "Exact Package publication does not exist.");
    }
    return row;
  }

  async function exportBundle(packageId, semanticVersion) {
    const root = await loadPublication(packageId, semanticVersion);
    const dependencies = [];
    const included = new Set([packageIdentity(root.release_record.manifest)]);
    async function visit(release) {
      for (const reference of release.manifest.dependencies) {
        const identity = exactDependencyIdentity(reference);
        if (included.has(identity)) continue;
        included.add(identity);
        const row = await loadPublication(reference.package_id, reference.semantic_version,
          reference.package_artifact_digest, reference.manifest_digest);
        await visit(row.release_record);
        dependencies.push({ release: row.release_record, custody_receipts: row.custody_receipts });
      }
    }
    await visit(root.release_record);
    const advisoriesById = new Map();
    const includedReleases = [root.release_record, ...dependencies.map((entry) => entry.release)];
    for (const release of includedReleases) {
      const result = await pool.query(
        `SELECT advisory FROM registry_advisories
         WHERE registry_id=$1 AND (
           (package_id=$2 AND manifest_digest=$3 AND package_artifact_digest=$4)
           OR (advisory->'document'->>'publisher_id'=$5 AND advisory->'document'->>'release_key_id'=$6)
         )
         ORDER BY advisory_id`,
        [registryId, release.manifest.package_id, sha256Digest(release.manifest),
          release.manifest.package_artifact_digest, release.publisher.publisher_id, release.manifest.release_key_id]
      );
      for (const row of result.rows) advisoriesById.set(row.advisory.document.advisory_id, row.advisory);
    }
    const advisories = [...advisoriesById.values()].sort((left, right) =>
      left.document.advisory_id.localeCompare(right.document.advisory_id));
    const generatedAt = new Date();
    const latestCheckpoint = await pool.query(
      `SELECT sequence,root_hash,recorded_at FROM registry_transparency_entries
       WHERE registry_id=$1 ORDER BY sequence DESC LIMIT 1`, [registryId]
    );
    const checkpoint = latestCheckpoint.rows[0];
    const snapshotDocument = {
      schema_version: "alphonse.advisory_snapshot.v0.1",
      registry_id: registryId,
      package_identities: [...included].sort(),
      advisory_digests: advisories.map((entry) => sha256Digest(entry)).sort(),
      transparency_checkpoint: {
        registry_id: registryId,
        sequence: Number(checkpoint.sequence),
        root_hash: checkpoint.root_hash,
        issued_at: new Date(checkpoint.recorded_at).toISOString()
      },
      generated_at: generatedAt.toISOString(),
      expires_at: new Date(generatedAt.getTime() + advisorySnapshotTtlSeconds * 1000).toISOString()
    };
    return {
      schema_version: "alphonse.offline_bundle.v0.1",
      root: { release: root.release_record, custody_receipts: root.custody_receipts },
      dependencies,
      advisories,
      advisory_snapshot: {
        document: snapshotDocument,
        registry_key_id: registryKeyId,
        registry_signature: signDocument(snapshotDocument, registryPrivateKey)
      }
    };
  }

  function verifySourceCustody(node, verified) {
    const valid = (node.custody_receipts ?? []).some((receipt) => {
      const document = receipt?.document;
      const publicKey = trustedSourceRegistries[document?.registry_id];
      if (!publicKey || receipt.registry_key_id !== sha256Digest(publicKey)
          || !verifyDocument(document, receipt.registry_signature, publicKey)) return false;
      const publishedAt = Date.parse(document.published_at);
      return document.package_id === verified.package_id
        && document.semantic_version === verified.semantic_version
        && document.package_artifact_digest === verified.package_artifact_digest
        && document.manifest_digest === verified.manifest_digest
        && document.release_digest === verified.release_digest
        && document.publisher_proof_digest === sha256Digest({ publisher: node.release.publisher,
          delegation: node.release.delegation })
        && canonicalize(document.artifact_descriptors) === canonicalize(verified.artifact_descriptors)
        && canonicalize(document.attestation_digests) === canonicalize(verified.attestation_digests)
        && (document.custody_mode ?? "publication") === "publication"
        && publishedAt >= Date.parse(node.release.delegation.document.issued_at)
        && publishedAt < Date.parse(node.release.delegation.document.expires_at)
        && publishedAt >= Date.parse(node.release.manifest.issued_at);
    });
    if (!valid) conflict("SOURCE_CUSTODY_UNTRUSTED", `No trusted source receipt exists for ${verified.package_identity}.`);
  }

  function verifySourceAdvisorySnapshot(bundle, packageIdentities) {
    const snapshot = bundle.advisory_snapshot;
    const document = snapshot?.document;
    const advisories = bundle.advisories;
    if (document?.schema_version !== "alphonse.advisory_snapshot.v0.1" || !Array.isArray(advisories)) {
      conflict("SOURCE_ADVISORY_SNAPSHOT_INVALID", "Mirror bundle requires a complete source advisory snapshot.");
    }
    const sourcePublicKey = trustedSourceRegistries[document.registry_id];
    if (!sourcePublicKey || snapshot.registry_key_id !== sha256Digest(sourcePublicKey)
        || !verifyDocument(document, snapshot.registry_signature, sourcePublicKey)) {
      conflict("SOURCE_ADVISORY_SNAPSHOT_UNTRUSTED", "Source advisory snapshot signature is invalid or untrusted.");
    }
    const advisoryDigests = advisories.map((entry) => sha256Digest(entry)).sort();
    if (canonicalize(document.package_identities) !== canonicalize([...packageIdentities].sort())
        || canonicalize(document.advisory_digests) !== canonicalize(advisoryDigests)) {
      conflict("SOURCE_ADVISORY_SNAPSHOT_MISMATCH", "Source snapshot does not bind the exact mirror bundle.");
    }
    const generatedAt = Date.parse(document.generated_at);
    const expiresAt = Date.parse(document.expires_at);
    const checkpoint = document.transparency_checkpoint;
    const checkpointAt = Date.parse(checkpoint?.issued_at);
    const now = Date.now();
    if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(checkpointAt)
        || checkpoint?.registry_id !== document.registry_id || !Number.isSafeInteger(checkpoint?.sequence)
        || checkpoint.sequence < 1 || typeof checkpoint.root_hash !== "string" || checkpointAt > generatedAt) {
      conflict("SOURCE_ADVISORY_SNAPSHOT_INVALID", "Source advisory snapshot checkpoint or time bounds are invalid.");
    }
    if (generatedAt > now || expiresAt <= now
        || now - generatedAt > advisorySnapshotTtlSeconds * 1000) {
      conflict("SOURCE_ADVISORY_SNAPSHOT_STALE", "Source advisory snapshot is not current enough to mirror.");
    }
  }

  async function mirrorBundle(bundle) {
    if (bundle?.schema_version !== "alphonse.offline_bundle.v0.1" || !bundle.root
        || !Array.isArray(bundle.dependencies)) {
      throw new RegistryError(400, "INVALID_BUNDLE", "Portable offline bundle is required.");
    }
    const all = [bundle.root, ...bundle.dependencies];
    const byIdentity = new Map();
    for (const node of all) {
      const verified = verifyRelease(node.release);
      verifySourceCustody(node, verified);
      if (byIdentity.has(verified.package_identity)) conflict("DUPLICATE_PACKAGE", "Bundle repeats a Package identity.");
      byIdentity.set(verified.package_identity, node);
    }
    verifySourceAdvisorySnapshot(bundle, byIdentity.keys());
    const publishing = new Set();
    const published = new Set();
    async function publishNode(identity, client) {
      if (published.has(identity)) return;
      if (publishing.has(identity)) conflict("DEPENDENCY_CYCLE", "Mirror bundle contains a dependency cycle.");
      const node = byIdentity.get(identity);
      if (!node) conflict("MISSING_DEPENDENCY", `Mirror bundle is missing ${identity}.`);
      publishing.add(identity);
      for (const dependency of node.release.manifest.dependencies) {
        await publishNode(exactDependencyIdentity(dependency), client);
      }
      await publish(node.release, { retainedCustodyReceipts: node.custody_receipts ?? [], custodyMode: "mirror" }, client);
      publishing.delete(identity);
      published.add(identity);
    }
    const rootIdentity = packageIdentity(bundle.root.release.manifest);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await publishNode(rootIdentity, client);
      if (published.size !== byIdentity.size) {
        conflict("EXTRANEOUS_DEPENDENCY", "Mirror bundle contains unreachable Packages.");
      }
      const scopeReleases = all.map((node) => node.release);
      for (const advisory of bundle.advisories) await recordAdvisory(advisory, { scopeReleases }, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return exportBundle(bundle.root.release.manifest.package_id, bundle.root.release.manifest.semantic_version);
  }

  async function recordAdvisory(advisory, { scopeReleases = null } = {}, transactionClient = null) {
    const document = validateAdvisoryShape(advisory);
    const client = transactionClient ?? await pool.connect();
    const ownsTransaction = transactionClient === null;
    let targetRelease;
    try {
      if (scopeReleases) {
        targetRelease = scopeReleases.find((release) => document.release_key_id
          ? release.publisher.publisher_id === document.publisher_id
            && release.manifest.release_key_id === document.release_key_id
          : release.manifest.package_id === document.package_id
            && sha256Digest(release.manifest) === document.manifest_digest
            && release.manifest.package_artifact_digest === document.package_artifact_digest);
      } else {
        const target = await client.query(
          `SELECT * FROM registry_publications
           WHERE registry_id=$1 AND package_id=$2 AND manifest_digest=$3 AND package_artifact_digest=$4`,
          [registryId, document.package_id, document.manifest_digest, document.package_artifact_digest]
        );
        targetRelease = target.rows[0]?.release_record;
      }
      if (!targetRelease || targetRelease.publisher.publisher_id !== document.publisher_id) {
        conflict("ADVISORY_SCOPE_MISMATCH", "Advisory does not bind the published Package scope.");
      }
      if (!verifyDocument(document, advisory.signature, targetRelease.publisher.root_public_key)) {
        throw new RegistryError(403, "INVALID_ADVISORY_SIGNATURE", "Publisher advisory signature is invalid.");
      }
      if (ownsTransaction) await client.query("BEGIN");
      const existing = await client.query(
        "SELECT advisory FROM registry_advisories WHERE registry_id=$1 AND advisory_id=$2",
        [registryId, document.advisory_id]
      );
      if (existing.rows[0]) {
        if (sha256Digest(existing.rows[0].advisory) !== sha256Digest(advisory)) {
          conflict("ADVISORY_ID_CONFLICT", "Advisory ID already binds different content.");
        }
        if (ownsTransaction) await client.query("COMMIT");
        return { replayed: true, advisory: existing.rows[0].advisory };
      }
      const recordedAt = new Date().toISOString();
      await appendTransparency(client, "advisory", {
        schema_version: "alphonse.registry_entry.v0.1",
        entry_type: "advisory",
        registry_id: registryId,
        advisory_id: document.advisory_id,
        advisory_digest: sha256Digest(advisory),
        recorded_at: recordedAt
      }, recordedAt);
      await client.query(
        `INSERT INTO registry_advisories
         (registry_id,advisory_id,package_id,manifest_digest,package_artifact_digest,advisory,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [registryId, document.advisory_id, document.package_id, document.manifest_digest,
          document.package_artifact_digest, JSON.stringify(advisory), recordedAt]
      );
      if (ownsTransaction) await client.query("COMMIT");
      return { replayed: false, advisory };
    } catch (error) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  return {
    registryId,
    registryPublicKey,
    registryKeyId,
    publish,
    discover,
    exportBundle,
    mirrorBundle,
    recordAdvisory
  };
}
