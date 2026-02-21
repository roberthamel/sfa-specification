package sfa

import (
	"testing"
)

func TestInvokeDepthLimitReached(t *testing.T) {
	safety := &SafetyState{Depth: 4, MaxDepth: 5, CallChain: []string{"a", "b", "c", "d", "e"}}

	_, err := invokeAgent("target", safety, nil, nil)
	if err == nil {
		t.Fatal("expected depth limit error")
	}
}

func TestInvokeLoopDetected(t *testing.T) {
	safety := &SafetyState{Depth: 1, MaxDepth: 5, CallChain: []string{"parent", "child"}}

	_, err := invokeAgent("parent", safety, nil, nil)
	if err == nil {
		t.Fatal("expected loop detection error")
	}
}

func TestBuildSubagentSafetyEnvIncrementsDepth(t *testing.T) {
	safety := &SafetyState{
		Depth:     2,
		MaxDepth:  5,
		CallChain: []string{"a", "b", "c"},
		SessionID: "test-session",
	}

	env := buildSubagentSafetyEnv(safety)
	if env["SFA_DEPTH"] != "3" {
		t.Errorf("expected depth 3, got %s", env["SFA_DEPTH"])
	}
}
