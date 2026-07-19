# Keep The Kernel In Plain JavaScript With Opt-In Static Checking

The kernel is intentionally implemented in plain JavaScript. The source a customer audits is byte-identical to the
source that executes: containers copy `src/` directly, release bundles ship the same files, and no transpiler,
bundler, or emit step sits between review and runtime. For a substrate whose product claim is that software — not
models — adjudicates authority and evidence, this audit-what-runs property is load-bearing, and it composes with the
deliberately small runtime footprint of two dependencies. This decision was previously undocumented across 106 ADRs;
it is recorded here as a choice, not a default.

Static checking is adopted without giving up that property. A root `tsconfig.json` runs the TypeScript checker in
no-emit mode over `src/`, `verifier/`, and `packages/` with `strict: true` and `checkJs` disabled globally. Files opt
in with a leading `// @ts-check` pragma and JSDoc annotations, one bounded module group at a time — files that ship
together and share contract shapes, such as a service factory, its contracts, and its clients. An opted-in file is
never opted back out. The checked-file manifest in `config/typechecked-js.json` is enforced by the unit suite, so
coverage changes are explicit and reviewable rather than silently disappearing with a deleted pragma.
`npm run typecheck` must stay clean; a global lenient baseline
was rejected because checking all 129 kernel modules at once surfaces dozens of findings that would either be
suppressed wholesale or fixed without review, and a strict bar on a small surface is worth more than a loose bar on
the whole.

Runtime contract validators remain the authority at every trust boundary. The `*-contracts.js` modules reject
hostile, malformed, or replayed input at runtime, which static annotations cannot do — types vanish before the first
request arrives. JSDoc therefore describes the shapes those validators accept and return, so the checker can verify
that internal callers wire them correctly, but an annotation never substitutes for validation and a validator is
never weakened to satisfy the checker.

A full TypeScript migration is deliberately deferred, not rejected on principle. It would reintroduce a build step,
break the byte-identical audit story, and force rework of the Dockerfiles, release qualification, and the independent
verifier image; JSDoc annotations convert mechanically to TypeScript syntax if the modular monorepo direction of
ADR 0057 ever makes emitted packages worthwhile. A rewrite in Go or Rust is rejected: it would invalidate roughly
76,000 lines of working JavaScript together with the acceptance, rehearsal, and canonical-proof harnesses that
constitute the project's verified claims, in exchange for guarantees the kernel does not currently need.
