# Cross-Replica Session Compatibility

NOVA prefers an explicitly configured `SESSION_SECRET`. When one is not present, the startup supervisor now derives a domain-separated signing key from stable server-side configuration already shared by the service. A random process-local key is used only when no stable source exists.

This prevents a valid operator cookie created by one Render instance from being rejected by another instance during rolling deployments or multi-instance routing.

## Verification

The dedicated PIN compatibility workflow starts two independent production containers with no explicit session-signing value and the same stable server seed. The test:

1. unlocks replica A with canonical PIN `22`;
2. captures the issued `wt_session` cookie;
3. sends that exact cookie to a protected endpoint on replica B;
4. requires HTTP 200;
5. separately verifies the alternate configured PIN and wrong-PIN rejection.

Any cross-replica rejection fails the workflow.

A dedicated persistent `SESSION_SECRET` remains the preferred production configuration because it cleanly separates session signing from other infrastructure configuration. The stable derivation path is a self-healing fallback.
