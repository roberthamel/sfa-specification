package sfa

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// resolveContextStorePath returns the context store directory path.
// Priority: SFA_CONTEXT_STORE env > config > default.
func resolveContextStorePath(config map[string]any) string {
	if p := os.Getenv("SFA_CONTEXT_STORE"); p != "" {
		return p
	}

	if cs, ok := config["contextStore"]; ok {
		if csm, ok := cs.(map[string]any); ok {
			if p, ok := csm["path"].(string); ok {
				return p
			}
		}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "/tmp/sfa-context"
	}
	return filepath.Join(home, ".local", "share", "single-file-agents", "context")
}

// writeContextEntry writes a context entry as a markdown file with YAML frontmatter.
// Returns the absolute path of the written file.
func writeContextEntry(entry ContextEntry, agentName, sessionID, storePath string) (string, error) {
	// Build directory path
	dir := filepath.Join(storePath, agentName)
	if sessionID != "" {
		dir = filepath.Join(dir, sessionID)
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create context directory: %w", err)
	}

	// Build filename: compact timestamp + slug
	ts := time.Now().UTC().Format("20060102T150405")
	filename := fmt.Sprintf("%s-%s.md", ts, entry.Slug)
	filePath := filepath.Join(dir, filename)

	// Build content with YAML frontmatter
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString(fmt.Sprintf("agent: %s\n", agentName))
	if sessionID != "" {
		b.WriteString(fmt.Sprintf("sessionId: %s\n", sessionID))
	}
	b.WriteString(fmt.Sprintf("timestamp: %s\n", time.Now().UTC().Format(time.RFC3339)))
	b.WriteString(fmt.Sprintf("type: %s\n", string(entry.Type)))

	if len(entry.Tags) > 0 {
		b.WriteString("tags:\n")
		for _, tag := range entry.Tags {
			b.WriteString(fmt.Sprintf("  - %s\n", tag))
		}
	}

	if len(entry.Links) > 0 {
		b.WriteString("links:\n")
		for _, link := range entry.Links {
			b.WriteString(fmt.Sprintf("  - %s\n", link))
		}
	}

	b.WriteString("---\n\n")
	b.WriteString(entry.Content)
	b.WriteString("\n")

	if err := os.WriteFile(filePath, []byte(b.String()), 0644); err != nil {
		return "", fmt.Errorf("failed to write context entry: %w", err)
	}

	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return filePath, nil
	}
	return absPath, nil
}

// searchContextEntries searches the context store for entries matching the query.
// Returns results sorted by timestamp descending (most recent first).
func searchContextEntries(query ContextQuery, storePath string) ([]ContextResult, error) {
	var results []ContextResult

	// Walk the context store directory
	err := filepath.Walk(storePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip errors
		}
		if info.IsDir() || !strings.HasSuffix(path, ".md") {
			return nil
		}

		entry, err := parseContextFile(path)
		if err != nil {
			return nil // skip unparseable files
		}

		// Apply filters
		if query.Agent != "" && entry.Agent != query.Agent {
			return nil
		}
		if query.Type != "" && entry.Type != query.Type {
			return nil
		}
		if len(query.Tags) > 0 {
			if !hasAnyTag(entry.Tags, query.Tags) {
				return nil
			}
		}
		if query.Query != "" {
			if !strings.Contains(strings.ToLower(entry.Content), strings.ToLower(query.Query)) {
				return nil
			}
		}

		results = append(results, *entry)
		return nil
	})

	if err != nil {
		return nil, err
	}

	// Sort by timestamp descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].Timestamp > results[j].Timestamp
	})

	return results, nil
}

// parseContextFile reads and parses a context entry markdown file.
func parseContextFile(path string) (*ContextResult, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	result := &ContextResult{FilePath: path}
	scanner := bufio.NewScanner(f)

	// Parse YAML frontmatter
	inFrontmatter := false
	var contentLines []string
	currentKey := ""

	for scanner.Scan() {
		line := scanner.Text()

		if line == "---" {
			if !inFrontmatter {
				inFrontmatter = true
				continue
			}
			inFrontmatter = false
			continue
		}

		if inFrontmatter {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "- ") && currentKey != "" {
				val := strings.TrimPrefix(trimmed, "- ")
				switch currentKey {
				case "tags":
					result.Tags = append(result.Tags, val)
				case "links":
					result.Links = append(result.Links, val)
				}
				continue
			}
			if idx := strings.Index(line, ": "); idx >= 0 {
				key := strings.TrimSpace(line[:idx])
				val := strings.TrimSpace(line[idx+2:])
				currentKey = key
				switch key {
				case "agent":
					result.Agent = val
				case "sessionId":
					result.SessionID = val
				case "timestamp":
					result.Timestamp = val
				case "type":
					result.Type = ContextType(val)
				}
			} else if strings.HasSuffix(trimmed, ":") {
				currentKey = strings.TrimSuffix(trimmed, ":")
			}
			continue
		}

		contentLines = append(contentLines, line)
	}

	result.Content = strings.TrimSpace(strings.Join(contentLines, "\n"))
	return result, nil
}

// hasAnyTag returns true if any of the query tags match any of the entry tags.
func hasAnyTag(entryTags, queryTags []string) bool {
	for _, qt := range queryTags {
		for _, et := range entryTags {
			if et == qt {
				return true
			}
		}
	}
	return false
}
