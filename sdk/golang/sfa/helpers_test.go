package sfa

import "os"

// writeTestFile is a helper for tests to create files.
func writeTestFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}
