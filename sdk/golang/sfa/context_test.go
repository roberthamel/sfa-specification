package sfa

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteContextEntry(t *testing.T) {
	tmpDir := t.TempDir()

	entry := ContextEntry{
		Type:    ContextFinding,
		Tags:    []string{"security", "critical"},
		Slug:    "sql-injection",
		Content: "Found SQL injection vulnerability in login handler.",
		Links:   []string{"../other/entry.md"},
	}

	path, err := writeContextEntry(entry, "test-agent", "session-1", tmpDir)
	if err != nil {
		t.Fatalf("failed to write context: %v", err)
	}

	if path == "" {
		t.Fatal("expected non-empty path")
	}

	// Read and verify content
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read file: %v", err)
	}

	content := string(data)

	// Check frontmatter
	if !strings.Contains(content, "agent: test-agent") {
		t.Error("expected agent in frontmatter")
	}
	if !strings.Contains(content, "sessionId: session-1") {
		t.Error("expected sessionId in frontmatter")
	}
	if !strings.Contains(content, "type: finding") {
		t.Error("expected type in frontmatter")
	}
	if !strings.Contains(content, "- security") {
		t.Error("expected security tag")
	}
	if !strings.Contains(content, "- critical") {
		t.Error("expected critical tag")
	}
	if !strings.Contains(content, "- ../other/entry.md") {
		t.Error("expected link in frontmatter")
	}
	if !strings.Contains(content, "Found SQL injection") {
		t.Error("expected content body")
	}

	// Check file path structure
	if !strings.Contains(path, filepath.Join("test-agent", "session-1")) {
		t.Errorf("expected agent/session dir structure, got %s", path)
	}
	if !strings.HasSuffix(path, "-sql-injection.md") {
		t.Errorf("expected slug in filename, got %s", path)
	}
}

func TestSearchContextEntries(t *testing.T) {
	tmpDir := t.TempDir()

	// Write two entries
	entry1 := ContextEntry{
		Type:    ContextFinding,
		Tags:    []string{"security"},
		Slug:    "finding-1",
		Content: "Security finding one",
	}
	entry2 := ContextEntry{
		Type:    ContextDecision,
		Tags:    []string{"architecture"},
		Slug:    "decision-1",
		Content: "Architecture decision one",
	}

	writeContextEntry(entry1, "agent-a", "session-1", tmpDir)
	writeContextEntry(entry2, "agent-b", "session-2", tmpDir)

	// Search all
	results, err := searchContextEntries(ContextQuery{}, tmpDir)
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}

	// Search by agent
	results, err = searchContextEntries(ContextQuery{Agent: "agent-a"}, tmpDir)
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result for agent-a, got %d", len(results))
	}
	if results[0].Agent != "agent-a" {
		t.Errorf("expected agent-a, got %s", results[0].Agent)
	}

	// Search by type
	results, err = searchContextEntries(ContextQuery{Type: ContextFinding}, tmpDir)
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(results))
	}

	// Search by tag
	results, err = searchContextEntries(ContextQuery{Tags: []string{"architecture"}}, tmpDir)
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 architecture result, got %d", len(results))
	}

	// Search by query
	results, err = searchContextEntries(ContextQuery{Query: "security finding"}, tmpDir)
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result for query, got %d", len(results))
	}
}

func TestSearchContextEmptyStore(t *testing.T) {
	tmpDir := t.TempDir()

	results, err := searchContextEntries(ContextQuery{}, tmpDir)
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}
