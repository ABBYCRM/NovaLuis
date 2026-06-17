---
name: Express pathless middleware gate
description: Why auth middleware must be mounted with an explicit path prefix, not pathless before a sub-router.
---

# Express pathless middleware leaks to all later routes

`router.use(mw, subRouter)` registers `mw` at the router root (no path filter), so
`mw` runs for **every** request that reaches the router — not only the ones the
sub-router handles. The sub-router then only *handles* its matched paths, but the
middleware already executed for everything mounted after it too.

**Symptom seen in Nova:** gating the credential/knowledge routers with
`router.use(requireWtAuth, integrationsRouter)` (pathless) made `requireWtAuth` a
catch-all, so the chat proxy mounted later returned `{error:"locked",needPin:true}`
401 in prod — chat appeared "PIN-locked" with no obvious cause.

**Fix / rule:** scope auth middleware to explicit path prefixes and mount the
routers separately:

```js
router.use(["/integrations", "/knowledge"], requireWtAuth);
router.use(integrationsRouter);
router.use(knowledgeRouter);
router.use(openaiProxyRouter); // ungated
```

This works because the sub-routers define their own full paths
(`/integrations/...`, `/knowledge/...`) and `requireWtAuth` is path-independent
(it only reads a cookie), so prefix-stripping by `router.use(path, …)` is harmless.

**Why it matters:** the bug is invisible to typecheck and to any test that doesn't
hit a *different* route after the gated one. Always smoke-test an ungated route
(the chat proxy) after touching middleware mount order.
