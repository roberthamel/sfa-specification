package embedded

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed sdks/typescript/*
var typescriptFS embed.FS

//go:embed sdks/golang/*
var golangFS embed.FS

//go:embed VERSION
var specVersion string

//go:embed CHANGELOG.md
var specChangelog string

var sdkMap = map[string]embed.FS{
	"typescript": typescriptFS,
	"golang":     golangFS,
}

// SupportedLanguages returns the list of supported SDK language identifiers.
func SupportedLanguages() []string {
	langs := make([]string, 0, len(sdkMap))
	for lang := range sdkMap {
		langs = append(langs, lang)
	}
	return langs
}

// ExtractSDK copies embedded SDK files for the given language to the target directory.
func ExtractSDK(language, targetDir string) error {
	fsys, ok := sdkMap[language]
	if !ok {
		return fmt.Errorf("unsupported language: %s (supported: %s)", language, strings.Join(SupportedLanguages(), ", "))
	}

	prefix := fmt.Sprintf("sdks/%s", language)

	return fs.WalkDir(fsys, prefix, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(prefix, path)
		if err != nil {
			return err
		}

		destPath := filepath.Join(targetDir, relPath)

		if d.IsDir() {
			return os.MkdirAll(destPath, 0755)
		}

		data, err := fsys.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read embedded file %s: %w", path, err)
		}

		return os.WriteFile(destPath, data, 0644)
	})
}

// SDKVersion returns the embedded SFA spec version string.
func SDKVersion() string {
	return strings.TrimSpace(specVersion)
}

// SDKChangelog returns the embedded CHANGELOG.md content.
func SDKChangelog() string {
	return specChangelog
}

// InjectVersionFiles writes VERSION and CHANGELOG.md into the target SDK directory.
func InjectVersionFiles(targetDir string) error {
	if err := os.WriteFile(filepath.Join(targetDir, "VERSION"), []byte(specVersion), 0644); err != nil {
		return fmt.Errorf("failed to write VERSION: %w", err)
	}
	if err := os.WriteFile(filepath.Join(targetDir, "CHANGELOG.md"), []byte(specChangelog), 0644); err != nil {
		return fmt.Errorf("failed to write CHANGELOG.md: %w", err)
	}
	return nil
}
