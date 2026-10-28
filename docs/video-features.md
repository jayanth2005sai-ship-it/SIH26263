# Video feature coverage

Reference: [VIDYA-VERIFY | SIH 2026 Project Demo](https://www.youtube.com/watch?v=tHKa69hXfHM), 3 minutes 29 seconds. Reviewed the description and preview frames; automatic captions were unavailable from the caption endpoint.

| Reference feature | IDVERA implementation |
| --- | --- |
| Institution-aware student records | `/workspace?tab=institutions` and `students`: create/edit institutions, configure programmes, create/edit student records; server validates programme ownership |
| Batch enrolment through CSV | `/workspace?tab=import`: templates, sample CSV, upload/drop, institution selection, validation preview and explicit commit |
| APAAR format validation | Server checks twelve numeric digits; outcomes do not imply official identity validation |
| Duplicate and cross-institution collisions | V-04 duplicate batch identifiers; V-05 keyed matches and heuristic candidates; date overlap and verified release handling |
| Sanctioned intake monitoring | Overview accounts for active regular enrolments independently from each configured supernumerary ceiling |
| Validation reports and errors | Accepted/flagged/rejected row reports with findings, remediation, persisted batch history and CSV download; rejected rows are not enrolled |
| Audit-oriented tracking | D1 event ledger written with mutations; database triggers reject UPDATE and DELETE; searchable history and export |
| Human finding adjudication | Record details include evidence requests, confirmed issues and reviewer clearance of potential collisions, with required rationale; changed evidence invalidates a prior clearance |
| Individual lookup and verification | Identifier lookup returns VERIFIED, NOT_VERIFIED or UNABLE_TO_VERIFY with masked identifiers and record evidence |

The updated landing page remains at `/`. The application lives at `/workspace` and uses the Site's existing private audience plus ChatGPT sign-in. Records are partitioned by the authenticated Site user, stored in D1, and survive reloads. The verifier is a sandbox over workspace records, without a live APAAR registry connection. Programme admission windows and quota ceilings are explicit configuration, not externally attested regulatory values.

Core checks: `node --test tests/domain.test.mjs` (24 cases); `npx tsc --noEmit`; build with the Sites build helper. Apply the generated Drizzle migration before using a local database. Sample data is synthetic and can be loaded only into an empty workspace.
