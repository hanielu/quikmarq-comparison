// Package migrations binds the committed SQLite migration files to the server binary.
package migrations

import (
	"bytes"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

//go:embed *.ridu.json
var compiledHistory embed.FS

// ValidateDirectory rejects runtime migration files that differ from the ones
// present when this application binary was compiled. Ridu separately verifies
// the artifact plan and the applied database ledger.
func ValidateDirectory(directory string) error {
	compiled, err := compiledHistory.ReadDir(".")
	if err != nil {
		return fmt.Errorf("read compiled migration history: %w", err)
	}
	if len(compiled) == 0 {
		return fmt.Errorf("compiled migration history is empty")
	}
	runtimeEntries, err := os.ReadDir(directory)
	if err != nil {
		return fmt.Errorf("read runtime migration history: %w", err)
	}
	runtimeArtifacts := make(map[string]os.DirEntry)
	for _, entry := range runtimeEntries {
		if strings.HasSuffix(entry.Name(), ".ridu.json") {
			runtimeArtifacts[entry.Name()] = entry
		}
	}
	if len(runtimeArtifacts) != len(compiled) {
		return fmt.Errorf("runtime migration history has %d artifacts; binary contains %d", len(runtimeArtifacts), len(compiled))
	}
	for _, expected := range compiled {
		entry, ok := runtimeArtifacts[expected.Name()]
		if !ok || entry.IsDir() {
			return fmt.Errorf("runtime migration artifact %s is missing", expected.Name())
		}
		compiledBytes, err := compiledHistory.ReadFile(expected.Name())
		if err != nil {
			return fmt.Errorf("read compiled migration artifact %s: %w", expected.Name(), err)
		}
		runtimeBytes, err := os.ReadFile(filepath.Join(directory, expected.Name()))
		if err != nil {
			return fmt.Errorf("read runtime migration artifact %s: %w", expected.Name(), err)
		}
		if !bytes.Equal(runtimeBytes, compiledBytes) {
			return fmt.Errorf("runtime migration artifact %s differs from the compiled history", expected.Name())
		}
	}
	return nil
}
