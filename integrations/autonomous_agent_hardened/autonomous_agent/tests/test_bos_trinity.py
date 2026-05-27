from autonomous_agent.governance.bos_trinity import BOSTrinityKernel, Decision, GovernanceInput


def test_bos_blocks_destructive_by_default():
    decision = BOSTrinityKernel().decide(GovernanceInput(action_type="write", destructive=True, confidence=0.9))
    assert decision.decision is Decision.REJECT
    assert "destructive" in decision.reasoning_summary


def test_bos_allows_read_operation():
    decision = BOSTrinityKernel().decide(GovernanceInput(action_type="read", evidence=["stdout observed"], confidence=0.7))
    assert decision.decision is Decision.COMMIT
    assert decision.audit_ready is True
