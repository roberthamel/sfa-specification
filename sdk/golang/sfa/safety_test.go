package sfa

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestInitSafetyTopLevel(t *testing.T) {
	os.Unsetenv("SFA_DEPTH")
	os.Unsetenv("SFA_MAX_DEPTH")
	os.Unsetenv("SFA_CALL_CHAIN")
	os.Unsetenv("SFA_SESSION_ID")

	safety, err := initSafety("test-agent", 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if safety.Depth != 0 {
		t.Errorf("expected depth 0, got %d", safety.Depth)
	}
	if safety.MaxDepth != 5 {
		t.Errorf("expected maxDepth 5, got %d", safety.MaxDepth)
	}
	if len(safety.CallChain) != 1 || safety.CallChain[0] != "test-agent" {
		t.Errorf("expected call chain [test-agent], got %v", safety.CallChain)
	}
	if safety.SessionID == "" {
		t.Error("expected non-empty session ID")
	}
	// Should be a valid UUID format
	if len(safety.SessionID) != 36 {
		t.Errorf("expected UUID format session ID, got %q", safety.SessionID)
	}
}

func TestInitSafetyNestedCall(t *testing.T) {
	os.Setenv("SFA_DEPTH", "1")
	os.Setenv("SFA_MAX_DEPTH", "5")
	os.Setenv("SFA_CALL_CHAIN", "parent-agent")
	os.Setenv("SFA_SESSION_ID", "existing-session")
	defer func() {
		os.Unsetenv("SFA_DEPTH")
		os.Unsetenv("SFA_MAX_DEPTH")
		os.Unsetenv("SFA_CALL_CHAIN")
		os.Unsetenv("SFA_SESSION_ID")
	}()

	safety, err := initSafety("child-agent", 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if safety.Depth != 1 {
		t.Errorf("expected depth 1, got %d", safety.Depth)
	}
	if safety.SessionID != "existing-session" {
		t.Errorf("expected existing-session, got %q", safety.SessionID)
	}
	if len(safety.CallChain) != 2 {
		t.Fatalf("expected 2 in call chain, got %d", len(safety.CallChain))
	}
	if safety.CallChain[0] != "parent-agent" || safety.CallChain[1] != "child-agent" {
		t.Errorf("expected [parent-agent, child-agent], got %v", safety.CallChain)
	}
}

func TestInitSafetyLoopDetection(t *testing.T) {
	os.Setenv("SFA_CALL_CHAIN", "agent-a,agent-b")
	defer os.Unsetenv("SFA_CALL_CHAIN")

	_, err := initSafety("agent-a", 5)
	if err == nil {
		t.Fatal("expected loop detection error")
	}
	if !strings.Contains(err.Error(), "loop detected") {
		t.Errorf("expected loop detected error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "agent-a → agent-b → agent-a") {
		t.Errorf("expected loop path in error, got: %v", err)
	}
}

func TestCheckDepthLimit(t *testing.T) {
	safety := &SafetyState{Depth: 4, MaxDepth: 5}
	err := checkDepthLimit(safety)
	if err == nil {
		t.Error("expected depth limit error")
	}
}

func TestCheckDepthLimitOK(t *testing.T) {
	safety := &SafetyState{Depth: 2, MaxDepth: 5}
	err := checkDepthLimit(safety)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestCheckLoopDetected(t *testing.T) {
	safety := &SafetyState{CallChain: []string{"agent-a", "agent-b"}}
	err := checkLoop(safety, "agent-a")
	if err == nil {
		t.Error("expected loop error")
	}
}

func TestCheckLoopOK(t *testing.T) {
	safety := &SafetyState{CallChain: []string{"agent-a", "agent-b"}}
	err := checkLoop(safety, "agent-c")
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestBuildSubagentSafetyEnv(t *testing.T) {
	safety := &SafetyState{
		Depth:     1,
		MaxDepth:  5,
		CallChain: []string{"parent", "child"},
		SessionID: "sess-123",
	}

	env := buildSubagentSafetyEnv(safety)

	if env["SFA_DEPTH"] != "2" {
		t.Errorf("expected depth 2, got %q", env["SFA_DEPTH"])
	}
	if env["SFA_MAX_DEPTH"] != "5" {
		t.Errorf("expected max-depth 5, got %q", env["SFA_MAX_DEPTH"])
	}
	if env["SFA_CALL_CHAIN"] != "parent,child" {
		t.Errorf("expected parent,child, got %q", env["SFA_CALL_CHAIN"])
	}
	if env["SFA_SESSION_ID"] != "sess-123" {
		t.Errorf("expected sess-123, got %q", env["SFA_SESSION_ID"])
	}
}

func TestSetupTimeout(t *testing.T) {
	ctx, cancel := setupTimeout("test", 1)
	defer cancel()

	select {
	case <-ctx.Done():
		t.Error("context should not be done immediately")
	default:
		// ok
	}

	// Wait for timeout
	time.Sleep(1100 * time.Millisecond)
	if ctx.Err() != context.DeadlineExceeded {
		t.Error("expected deadline exceeded after timeout")
	}
}

func TestGenerateUUID(t *testing.T) {
	uuid := generateUUID()
	if len(uuid) != 36 {
		t.Errorf("expected 36 char UUID, got %d: %q", len(uuid), uuid)
	}
	// Check format: 8-4-4-4-12
	parts := strings.Split(uuid, "-")
	if len(parts) != 5 {
		t.Errorf("expected 5 parts, got %d", len(parts))
	}

	// Generate two and ensure they're different
	uuid2 := generateUUID()
	if uuid == uuid2 {
		t.Error("two UUIDs should not be identical")
	}
}
