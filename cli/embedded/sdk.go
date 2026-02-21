package embedded

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed sdk/*
var sdkFS embed.FS

// ExtractSDK copies all embedded SDK files to the target directory.
func ExtractSDK(targetDir string) error {
	return fs.WalkDir(sdkFS, "sdk", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Compute the relative path from "sdk/" prefix
		relPath, err := filepath.Rel("sdk", path)
		if err != nil {
			return err
		}

		destPath := filepath.Join(targetDir, relPath)

		if d.IsDir() {
			return os.MkdirAll(destPath, 0755)
		}

		data, err := sdkFS.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read embedded file %s: %w", path, err)
		}

		return os.WriteFile(destPath, data, 0644)
	})
}
