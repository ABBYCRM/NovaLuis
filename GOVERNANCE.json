### `config/autonomy-governance.json`

```json
{
  "schemaVersion": "1.0.0",
  "module": "EXHAUSTIVE_AUTONOMY_GOVERNANCE",
  "engine": "EXHAUSTIVE_WORK_CYCLE_ENGINE",
  "configRevision": 1,
  "autonomyEnabled": true,
  "enforcementMode": "FAIL_CLOSED",

  "ownership": {
    "operatorEditable": true,
    "runtimeMayModifyThisFile": false,
    "runtimeStateStoredSeparately": true,
    "authoritativePoller": "scripts/poll-events.mjs",
    "authoritativeTimezone": "UTC"
  },

  "killSwitch": {
    "enabledField": "autonomyEnabled",
    "falseMeansImmediateDisable": true,
    "disableHeartbeatCron": true,
    "preventNewAutonomousRuns": true,
    "allowActiveRunToFinish": false,
    "terminateActiveRunOnDisable": true,
    "terminationGracePeriodSeconds": 30,
    "queueAlertWhenActivated": true,
    "alertPriority": "P1",
    "autoReenableAllowed": false
  },

  "poller": {
    "enabled": true,
    "script": "scripts/poll-events.mjs",
    "intervalSeconds": 600,
    "maximumExpectedDetectionDelaySeconds": 600,
    "startupEvaluationRequired": true,
    "evaluateBeforeEveryHeartbeat": true,
    "evaluateAfterEveryHeartbeat": true,
    "evaluateAfterConfigReload": true,
    "reloadConfigEveryTick": true,
    "rejectCachedConfigAfterSeconds": 600,
    "singleInstanceRequired": true,
    "instanceLockRequired": true,
    "instanceLockTtlSeconds": 900,
    "recoverStaleInstanceLock": true,
    "failClosedOnReadError": true,
    "failClosedOnParseError": true,
    "failClosedOnValidationError": true,
    "failClosedOnStateWriteError": true
  },

  "heartbeatJob": {
    "jobId": "heartbeat",
    "jobType": "AUTONOMOUS_HEARTBEAT",
    "managedByPoller": true,
    "pollerMayDisable": true,
    "pollerMayReenable": true,
    "operatorDisableHasPriority": true,
    "disableWhenAutonomyDisabled": true,
    "disableWhenDailyCapReached": true,
    "disableWhenCircuitBreakerOpen": true,
    "disableWhenStateIsCorrupt": true,
    "disableWhenRequiredDependencyUnavailable": true,
    "reenableOnlyWhenPollerWasDisabler": true,
    "neverOverrideManualDisable": true,
    "neverOverrideOperatorKillSwitch": true
  },

  "runClassification": {
    "countedRunTypes": [
      "AUTONOMOUS_HEARTBEAT"
    ],
    "excludedRunTypes": [
      "OPERATOR_PROMPTED",
      "MANUAL_TEST",
      "HEALTH_CHECK",
      "CONFIG_VALIDATION",
      "RECOVERY_CHECK",
      "DRY_RUN"
    ],
    "countRetriesAsNewRuns": false,
    "countCorrectionLoopsAsNewRuns": false,
    "countRejectedRuns": false,
    "countReservedRuns": true,
    "countAbortedRunsAfterReservation": true,
    "countTimedOutRuns": true,
    "countFailedRuns": true,
    "countSuccessfulRuns": true
  },

  "quotas": {
    "dailyAutonomousRunCap": 60,
    "dailyWindowTimezone": "UTC",
    "dailyWindowResetTime": "00:00:00",
    "hourlyAutonomousRunCap": 12,
    "rollingWindow": {
      "enabled": true,
      "windowMinutes": 60,
      "maximumRuns": 12
    },
    "burstProtection": {
      "enabled": true,
      "windowMinutes": 10,
      "maximumRuns": 3
    },
    "minimumSecondsBetweenAutonomousRuns": 60,
    "maximumConsecutiveAutonomousRuns": 6,
    "cooldownAfterMaximumConsecutiveRunsSeconds": 900,
    "reservationRequiredBeforeExecution": true,
    "reservationIsAtomic": true,
    "rejectRunWhenReservationFails": true,
    "disableHeartbeatWhenDailyCapReached": true,
    "queueAlertWhenDailyCapReached": true,
    "dailyCapAlertPriority": "P1"
  },

  "counterSemantics": {
    "counterName": "reservedAutonomousRuns",
    "dayKeyFormat": "YYYY-MM-DD",
    "dayBoundaryTimezone": "UTC",
    "incrementPoint": "AFTER_ELIGIBILITY_BEFORE_EXECUTION",
    "atomicIncrementRequired": true,
    "rollbackIncrementOnExecutionFailure": false,
    "separateAttemptAndOutcomeCounters": true,
    "trackedCounters": [
      "reservedAutonomousRuns",
      "startedAutonomousRuns",
      "succeededAutonomousRuns",
      "failedAutonomousRuns",
      "timedOutAutonomousRuns",
      "abortedAutonomousRuns",
      "rejectedAutonomousRuns",
      "retriedOperations",
      "correctionLoops"
    ]
  },

  "runEligibility": {
    "allChecksMustPass": true,
    "checks": [
      "CONFIG_VALID",
      "AUTONOMY_ENABLED",
      "HEARTBEAT_JOB_ENABLED",
      "NO_OPERATOR_PAUSE",
      "NO_ACTIVE_KILL_SWITCH",
      "DAILY_CAP_AVAILABLE",
      "HOURLY_CAP_AVAILABLE",
      "BURST_CAP_AVAILABLE",
      "COOLDOWN_COMPLETE",
      "CIRCUIT_BREAKER_CLOSED",
      "NO_ACTIVE_RUN_LEASE",
      "STATE_STORE_HEALTHY",
      "REQUIRED_DEPENDENCIES_AVAILABLE",
      "RESOURCE_BUDGET_AVAILABLE"
    ],
    "onFailedEligibility": {
      "doNotStartRun": true,
      "recordRejection": true,
      "recordFailedChecks": true,
      "disableHeartbeatForHardFailure": true,
      "alertOnlyWhenActionable": true
    }
  },

  "concurrency": {
    "maximumConcurrentAutonomousRuns": 1,
    "maximumConcurrentHeartbeatRuns": 1,
    "rejectConcurrentDuplicateRuns": true,
    "queueConcurrentRuns": false,
    "distributedLeaseRequired": true,
    "leaseKey": "autonomy:heartbeat:active",
    "leaseTtlSeconds": 1800,
    "leaseRenewalIntervalSeconds": 60,
    "leaseRenewalFailureLimit": 3,
    "terminateRunWhenLeaseLost": true,
    "recoverExpiredLease": true,
    "recordLeaseOwner": true,
    "recordLeaseAcquiredAt": true,
    "recordLeaseExpiresAt": true
  },

  "executionLimits": {
    "maximumRunDurationSeconds": 1800,
    "maximumPlanningDurationSeconds": 300,
    "maximumSingleToolCallDurationSeconds": 300,
    "maximumToolCallsPerRun": 100,
    "maximumCorrectionLoopsPerRun": 10,
    "maximumRepeatedIdenticalFailures": 3,
    "maximumUnchangedRetries": 0,
    "terminateOnDurationLimit": true,
    "terminateOnToolCallLimit": true,
    "terminateOnCorrectionLimit": true,
    "recordTerminationReason": true
  },

  "retryPolicy": {
    "enabled": true,
    "maximumRetriesPerOperation": 3,
    "retryOnlyTransientFailures": true,
    "requireChangedHypothesisOrNewEvidence": true,
    "prohibitIdenticalBlindRetry": true,
    "backoffStrategy": "EXPONENTIAL_WITH_JITTER",
    "initialDelaySeconds": 5,
    "maximumDelaySeconds": 120,
    "multiplier": 2,
    "jitterPercent": 20,
    "retryableFailureClasses": [
      "TIMEOUT",
      "RATE_LIMIT",
      "TEMPORARY_NETWORK_FAILURE",
      "TEMPORARY_PROVIDER_FAILURE",
      "LEASE_CONTENTION",
      "TRANSIENT_DATABASE_FAILURE"
    ],
    "nonRetryableFailureClasses": [
      "INVALID_CONFIGURATION",
      "AUTHENTICATION_FAILURE",
      "AUTHORIZATION_FAILURE",
      "MISSING_REQUIRED_SECRET",
      "UNSUPPORTED_OPERATION",
      "VALIDATION_FAILURE",
      "OPERATOR_KILL_SWITCH",
      "DAILY_CAP_REACHED"
    ]
  },

  "failureGovernance": {
    "consecutiveFailureLimit": 5,
    "consecutiveTimeoutLimit": 3,
    "failureRateWindowRuns": 20,
    "failureRateThresholdPercent": 50,
    "openCircuitOnConsecutiveFailureLimit": true,
    "openCircuitOnConsecutiveTimeoutLimit": true,
    "openCircuitOnFailureRateThreshold": true,
    "resetConsecutiveFailuresAfterSuccess": true,
    "preserveOriginalErrorEvidence": true,
    "requireRootCauseClassification": true,
    "requireCorrectionNodeBeforeRetry": true
  },

  "circuitBreaker": {
    "enabled": true,
    "initialState": "CLOSED",
    "openDurationSeconds": 3600,
    "disableHeartbeatWhenOpen": true,
    "queueAlertWhenOpened": true,
    "openedAlertPriority": "P1",
    "allowAutomaticHalfOpen": true,
    "halfOpenProbeRuns": 1,
    "halfOpenProbeCountsAgainstDailyCap": true,
    "closeAfterSuccessfulProbe": true,
    "reopenAfterFailedProbe": true,
    "manualResetAllowed": true,
    "automaticResetAllowedFor": [
      "TRANSIENT_FAILURE_THRESHOLD",
      "TIMEOUT_THRESHOLD"
    ],
    "automaticResetDisallowedFor": [
      "INVALID_CONFIGURATION",
      "STATE_CORRUPTION",
      "MISSING_REQUIRED_SECRET",
      "AUTHORIZATION_FAILURE",
      "OPERATOR_KILL_SWITCH"
    ]
  },

  "resourceBudgets": {
    "enabled": true,
    "failClosedWhenBudgetUnknown": false,
    "maximumEstimatedCostPerRunUsd": 5,
    "maximumEstimatedDailyCostUsd": 100,
    "maximumInputTokensPerRun": 500000,
    "maximumOutputTokensPerRun": 100000,
    "maximumExternalApiCallsPerRun": 100,
    "maximumBrowserSessionsPerRun": 5,
    "maximumRepositoryWritesPerRun": 100,
    "maximumDeploymentAttemptsPerRun": 3,
    "stopBeforeExceedingBudget": true,
    "queueAlertWhenBudgetReached": true,
    "budgetAlertPriority": "P1"
  },

  "dependencyChecks": {
    "enabled": true,
    "requiredBeforeRun": [
      "STATE_STORE_WRITABLE",
      "HEARTBEAT_JOB_RESOLVABLE",
      "EVENT_QUEUE_AVAILABLE",
      "AUDIT_LOG_WRITABLE"
    ],
    "optionalDependenciesMayDegrade": true,
    "recordDependencyHealth": true,
    "disableHeartbeatAfterConsecutiveDependencyFailures": 3,
    "dependencyFailureAlertPriority": "P1"
  },

  "resetPolicy": {
    "dailyResetEnabled": true,
    "resetTimezone": "UTC",
    "resetAt": "00:00:00",
    "resetCounters": [
      "reservedAutonomousRuns",
      "startedAutonomousRuns",
      "succeededAutonomousRuns",
      "failedAutonomousRuns",
      "timedOutAutonomousRuns",
      "abortedAutonomousRuns",
      "rejectedAutonomousRuns",
      "retriedOperations",
      "correctionLoops"
    ],
    "preserveLifetimeCounters": true,
    "preserveAuditHistory": true,
    "preserveCircuitBreakerState": true,
    "preserveManualPauseState": true,
    "preserveOperatorKillSwitchState": true,
    "reenableHeartbeatAfterDailyReset": true,
    "reenableConditions": [
      "AUTONOMY_ENABLED",
      "POLLER_PREVIOUSLY_DISABLED_HEARTBEAT",
      "DISABLE_REASON_WAS_DAILY_CAP",
      "NO_MANUAL_DISABLE",
      "NO_OPERATOR_PAUSE",
      "NO_ACTIVE_KILL_SWITCH",
      "CIRCUIT_BREAKER_NOT_OPEN",
      "CONFIG_VALID",
      "STATE_STORE_HEALTHY"
    ],
    "neverReenableAfterManualDisable": true,
    "neverReenableAfterKillSwitch": true,
    "neverReenableForUnresolvedHardFailure": true
  },

  "operatorControls": {
    "manualPauseSupported": true,
    "manualResumeSupported": true,
    "manualDisableHeartbeatSupported": true,
    "manualEnableHeartbeatSupported": true,
    "manualCircuitResetSupported": true,
    "manualCounterResetSupported": true,
    "manualCounterResetRequiresReason": true,
    "manualOverrideRecordedInAuditLog": true,
    "manualOverrideTakesPriority": true,
    "operatorChangesEffectiveNextPoll": true,
    "maximumConfigActivationDelaySeconds": 600
  },

  "manualPause": {
    "paused": false,
    "reason": null,
    "pausedBy": null,
    "pausedAt": null,
    "resumeAt": null,
    "autoResumeAllowed": false
  },

  "alerts": {
    "enabled": true,
    "queue": "operator-alerts",
    "defaultPriority": "P2",
    "deduplicate": true,
    "deduplicationWindowSeconds": 3600,
    "includeRunId": true,
    "includeEventId": true,
    "includeReason": true,
    "includeEvidenceReference": true,
    "includeRequiredOperatorAction": true,
    "alertEvents": {
      "KILL_SWITCH_ACTIVATED": "P1",
      "DAILY_CAP_REACHED": "P1",
      "CIRCUIT_BREAKER_OPENED": "P1",
      "STATE_CORRUPTION_DETECTED": "P0",
      "CONFIG_VALIDATION_FAILED": "P0",
      "HEARTBEAT_DISABLE_FAILED": "P0",
      "LEASE_LOST": "P1",
      "RUN_TIMEOUT": "P1",
      "CONSECUTIVE_FAILURE_LIMIT_REACHED": "P1",
      "DEPENDENCY_FAILURE_LIMIT_REACHED": "P1",
      "RESOURCE_BUDGET_REACHED": "P1",
      "AUTOMATIC_HEARTBEAT_REENABLED": "P2",
      "DAILY_COUNTER_RESET": "P3",
      "AUTONOMOUS_RUN_REJECTED": "P3"
    }
  },

  "audit": {
    "enabled": true,
    "appendOnly": true,
    "structuredFormat": "JSONL",
    "path": "runtime/audit/autonomy-events.jsonl",
    "flushAfterEveryEvent": true,
    "includeTimestamp": true,
    "timestampTimezone": "UTC",
    "includeConfigRevision": true,
    "includeProcessId": true,
    "includePollerInstanceId": true,
    "includeRunId": true,
    "includeNodeId": true,
    "includeEventType": true,
    "includePreviousState": true,
    "includeNewState": true,
    "includeReason": true,
    "includeEvidence": true,
    "redactSecrets": true,
    "recordedEvents": [
      "POLLER_STARTED",
      "POLLER_STOPPED",
      "CONFIG_LOADED",
      "CONFIG_REJECTED",
      "STATE_LOADED",
      "STATE_RECOVERED",
      "STATE_WRITE_FAILED",
      "ELIGIBILITY_EVALUATED",
      "RUN_RESERVED",
      "RUN_STARTED",
      "RUN_SUCCEEDED",
      "RUN_FAILED",
      "RUN_TIMED_OUT",
      "RUN_ABORTED",
      "RUN_REJECTED",
      "RETRY_SCHEDULED",
      "CORRECTION_LOOP_STARTED",
      "LEASE_ACQUIRED",
      "LEASE_RENEWED",
      "LEASE_LOST",
      "LEASE_RELEASED",
      "DAILY_CAP_REACHED",
      "HEARTBEAT_DISABLED",
      "HEARTBEAT_REENABLED",
      "CIRCUIT_OPENED",
      "CIRCUIT_HALF_OPENED",
      "CIRCUIT_CLOSED",
      "DAILY_COUNTER_RESET",
      "MANUAL_OVERRIDE",
      "ALERT_QUEUED",
      "ALERT_QUEUE_FAILED"
    ],
    "retentionDays": 90,
    "rotateDaily": true,
    "maximumFileSizeMb": 100
  },

  "stateStore": {
    "path": "runtime/state/autonomy-runtime-state.json",
    "backupPath": "runtime/state/autonomy-runtime-state.backup.json",
    "lockPath": "runtime/state/autonomy-runtime-state.lock",
    "format": "JSON",
    "atomicWrites": true,
    "writeTemporaryThenRename": true,
    "fsyncBeforeRename": true,
    "backupBeforeWrite": true,
    "validateAfterWrite": true,
    "recoverFromBackup": true,
    "failClosedWhenPrimaryAndBackupInvalid": true,
    "runtimeStateOperatorEditable": false
  },

  "stateIntegrity": {
    "enabled": true,
    "schemaValidationRequired": true,
    "monotonicCounterValidation": true,
    "rejectNegativeCounters": true,
    "rejectFutureTimestampsBeyondSeconds": 300,
    "rejectInvalidStateTransitions": true,
    "detectDuplicateRunIds": true,
    "detectOverlappingActiveRuns": true,
    "detectCounterDayMismatch": true,
    "queueP0AlertOnCorruption": true,
    "disableHeartbeatOnCorruption": true
  },

  "idempotency": {
    "required": true,
    "runIdRequired": true,
    "eventIdRequired": true,
    "reservationIdRequired": true,
    "preventDuplicateReservation": true,
    "preventDuplicateCounterIncrement": true,
    "preventDuplicateAlert": true,
    "preventDuplicateHeartbeatDisable": true,
    "preventDuplicateHeartbeatReenable": true,
    "idempotencyRetentionHours": 48
  },

  "recovery": {
    "recoverAfterPollerRestart": true,
    "recoverStaleRunLease": true,
    "recoverInterruptedStateWrite": true,
    "recoverFromBackupState": true,
    "markInterruptedRunAsAborted": true,
    "interruptedRunCountsAgainstDailyCap": true,
    "reconcileHeartbeatStateOnStartup": true,
    "reconcileCounterDayOnStartup": true,
    "reconcileCircuitBreakerOnStartup": true,
    "queueAlertWhenRecoveryChangesState": true
  },

  "observability": {
    "emitMetrics": true,
    "metricsPrefix": "autonomy",
    "metrics": [
      "poller_ticks_total",
      "poller_errors_total",
      "eligibility_checks_total",
      "autonomous_runs_reserved_total",
      "autonomous_runs_started_total",
      "autonomous_runs_succeeded_total",
      "autonomous_runs_failed_total",
      "autonomous_runs_timed_out_total",
      "autonomous_runs_aborted_total",
      "autonomous_runs_rejected_total",
      "autonomy_daily_runs_remaining",
      "active_autonomous_runs",
      "consecutive_failures",
      "circuit_breaker_state",
      "heartbeat_enabled",
      "state_write_failures_total",
      "alerts_queued_total"
    ],
    "healthSnapshotPath": "runtime/state/autonomy-health.json",
    "updateHealthSnapshotEveryPoll": true
  },

  "completionRules": {
    "runSuccessRequiresVerifiedCompletion": true,
    "executionWithoutVerificationIsFailure": true,
    "partialCompletionIsNotSuccess": true,
    "blockedRunIsNotSuccess": true,
    "requireFinalStatus": true,
    "allowedFinalStatuses": [
      "DONE",
      "DONE_WITH_NONCRITICAL_LIMITATIONS",
      "PARTIALLY_DONE",
      "BLOCKED",
      "FAILED",
      "UNVERIFIED"
    ],
    "successfulFinalStatuses": [
      "DONE",
      "DONE_WITH_NONCRITICAL_LIMITATIONS"
    ],
    "requireExecutionTrace": true,
    "requireEvidenceReport": true,
    "requirePlanExecutionAlignment": true,
    "requireNoUnresolvedStubs": true
  },

  "configurationValidation": {
    "strict": true,
    "rejectUnknownFields": false,
    "requireSchemaVersion": true,
    "requirePositiveDailyCap": true,
    "requirePollIntervalAtLeastSeconds": 60,
    "requireRunDurationGreaterThanToolTimeout": true,
    "requireLeaseTtlGreaterThanRenewalInterval": true,
    "requireDailyCapAtLeastHourlyCap": true,
    "requireBurstCapAtMostHourlyCap": true,
    "requireAlertQueueWhenAlertsEnabled": true,
    "requireAuditPathWhenAuditEnabled": true,
    "requireStatePath": true
  },

  "_notes": {
    "summary": "Autonomy governance enforced by scripts/poll-events.mjs.",
    "killSwitch": "autonomyEnabled=false is a hard kill switch. It prevents new autonomous runs, disables the heartbeat job, and terminates an active autonomous run after the configured grace period.",
    "dailyCap": "dailyAutonomousRunCap limits reserved AUTONOMOUS_HEARTBEAT runs per UTC calendar day. Reservations occur atomically before execution and remain counted even when the run later fails, times out, or aborts.",
    "reset": "At UTC midnight, daily counters reset. The poller may re-enable the heartbeat only when the poller disabled it specifically because the previous UTC day's daily cap was reached.",
    "manualPriority": "The poller must never override a manual heartbeat disable, manual pause, operator kill switch, unresolved circuit breaker, invalid configuration, or corrupt runtime state.",
    "stateSeparation": "Mutable counters and runtime state are stored in runtime/state/autonomy-runtime-state.json. The governance configuration must not be rewritten by the poller.",
    "activation": "Operator edits take effect on the next poll tick, with a maximum expected delay of 600 seconds.",
    "implementationRequirement": "A configuration field is not enforced merely because it exists. scripts/poll-events.mjs must validate and implement every required governance behavior."
  }
}
```

### `runtime/state/autonomy-runtime-state.json`

```json
{
  "schemaVersion": "1.0.0",
  "configRevisionObserved": 1,
  "currentUtcDay": null,

  "poller": {
    "instanceId": null,
    "processId": null,
    "startedAt": null,
    "lastTickAt": null,
    "lastSuccessfulTickAt": null,
    "consecutiveTickFailures": 0
  },

  "heartbeat": {
    "jobId": "heartbeat",
    "enabled": null,
    "disabledByPoller": false,
    "disabledReason": null,
    "disabledAt": null,
    "lastReenabledAt": null,
    "manualDisableDetected": false
  },

  "dailyCounters": {
    "reservedAutonomousRuns": 0,
    "startedAutonomousRuns": 0,
    "succeededAutonomousRuns": 0,
    "failedAutonomousRuns": 0,
    "timedOutAutonomousRuns": 0,
    "abortedAutonomousRuns": 0,
    "rejectedAutonomousRuns": 0,
    "retriedOperations": 0,
    "correctionLoops": 0
  },

  "lifetimeCounters": {
    "reservedAutonomousRuns": 0,
    "startedAutonomousRuns": 0,
    "succeededAutonomousRuns": 0,
    "failedAutonomousRuns": 0,
    "timedOutAutonomousRuns": 0,
    "abortedAutonomousRuns": 0,
    "rejectedAutonomousRuns": 0,
    "retriedOperations": 0,
    "correctionLoops": 0,
    "dailyResets": 0,
    "heartbeatDisables": 0,
    "heartbeatReenables": 0,
    "circuitBreakerOpens": 0
  },

  "rollingRunHistory": [],

  "activeRun": {
    "runId": null,
    "reservationId": null,
    "status": null,
    "startedAt": null,
    "deadlineAt": null,
    "leaseOwner": null,
    "leaseAcquiredAt": null,
    "leaseExpiresAt": null,
    "toolCallsUsed": 0,
    "correctionLoopsUsed": 0,
    "estimatedCostUsd": 0
  },

  "failureState": {
    "consecutiveFailures": 0,
    "consecutiveTimeouts": 0,
    "lastFailureAt": null,
    "lastFailureClass": null,
    "lastFailureMessage": null,
    "lastSuccessfulRunAt": null
  },

  "circuitBreaker": {
    "state": "CLOSED",
    "openedAt": null,
    "openUntil": null,
    "reason": null,
    "halfOpenProbeRunId": null,
    "manuallyResetAt": null,
    "manuallyResetBy": null
  },

  "manualControl": {
    "paused": false,
    "pauseReason": null,
    "pausedAt": null,
    "pausedBy": null,
    "resumeAt": null,
    "lastOverrideAt": null,
    "lastOverrideBy": null,
    "lastOverrideReason": null
  },

  "lastEligibilityEvaluation": {
    "evaluatedAt": null,
    "eligible": false,
    "passedChecks": [],
    "failedChecks": [],
    "rejectionReason": null
  },

  "lastReset": {
    "previousUtcDay": null,
    "newUtcDay": null,
    "resetAt": null,
    "heartbeatReenabled": false,
    "heartbeatReenableReason": null
  },

  "lastAlert": {
    "alertId": null,
    "eventType": null,
    "priority": null,
    "queuedAt": null,
    "deduplicationKey": null
  },

  "stateMetadata": {
    "createdAt": null,
    "updatedAt": null,
    "writeSequence": 0,
    "previousStateChecksum": null,
    "currentStateChecksum": null,
    "recoveredFromBackup": false
  }
}
```

### Mandatory enforcement order

```text
1. Acquire poller instance lock.
2. Load and validate governance configuration.
3. Load and validate runtime state.
4. Reconcile the current UTC day.
5. Reset daily counters when the UTC day changed.
6. Reconcile actual heartbeat-job state.
7. Reconcile stale active-run leases.
8. Evaluate the hard kill switch.
9. Evaluate manual pause and manual heartbeat disable.
10. Evaluate circuit-breaker state.
11. Evaluate daily, hourly, rolling, and burst quotas.
12. Evaluate cooldown and consecutive-run restrictions.
13. Evaluate dependency and resource-budget health.
14. Atomically reserve the run.
15. Atomically increment reservation counters.
16. Acquire the autonomous-run lease.
17. Start the autonomous heartbeat run.
18. Renew the lease while the run remains active.
19. Enforce duration, tool-call, correction-loop, and cost limits.
20. Record the terminal run result.
21. Update failure and circuit-breaker state.
22. Release the autonomous-run lease.
23. Re-evaluate quota and heartbeat state.
24. Persist runtime state atomically.
25. Append the complete audit event.
26. Queue required alerts.
27. Release the poller instance lock.
```

### Completion invariants

```text
autonomyEnabled = false
→ heartbeat disabled
→ no new autonomous reservation
→ active autonomous run terminated
→ P1 alert queued
→ no automatic re-enable

reservedAutonomousRuns >= dailyAutonomousRunCap
→ heartbeat disabled by poller
→ disable reason = DAILY_CAP_REACHED
→ P1 alert queued
→ autonomous run rejected

UTC day changes
AND heartbeat was disabled by poller
AND disable reason was DAILY_CAP_REACHED
AND autonomyEnabled = true
AND no manual pause
AND no manual disable
AND circuit breaker is not open
AND configuration and state are valid
→ counters reset
→ heartbeat re-enabled

manual disable OR kill switch OR hard failure
→ midnight reset must not re-enable heartbeat

runtime state invalid
→ fail closed
→ heartbeat disabled
→ autonomous execution rejected
→ P0 alert queued

node executed without verification
→ run cannot be marked DONE

any required node unresolved
→ run cannot be marked successful
```
