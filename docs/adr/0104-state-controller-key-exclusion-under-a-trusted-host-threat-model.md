# State Controller Key Exclusion Under A Trusted-Host Threat Model

V1 trusts the customer-controlled host, Docker daemon, and one-shot bootstrap launcher. A hostile host operator or
daemon could inspect or remount secrets regardless of declared container manifests, so the proof does not claim
cryptographic controller exclusion from key custody.

The bootstrap launcher performs one Compose launch and is outside the in-test Principal model. Scenario sequencing
then uses one-shot container dependencies and a runtime supervisor with no Docker socket, secret-store authority,
host mounts, or observer and tokenization secrets. Environment, mount, and network manifests prove configured
exclusion for in-test roles under the trusted-host assumption. The acceptance report states this limitation
explicitly. Stronger hostile-host claims require measured boot, confidential computing, or cryptographic runtime
attestation and remain deferred.
