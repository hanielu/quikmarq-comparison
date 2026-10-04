package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hanielu/quikmarq-ridu/content"
	virtuals3 "github.com/hanielu/quikmarq-ridu/internal/storage"
	"github.com/riducms/ridu"
	"github.com/riducms/ridu/adapters/sqlite"
	localstorage "github.com/riducms/ridu/adapters/storage/local"
	s3storage "github.com/riducms/ridu/adapters/storage/s3"
)

func TestSQLiteDatabasePath(t *testing.T) {
	absolute := filepath.Join(t.TempDir(), "content.sqlite")
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "absolute path", value: absolute},
		{name: "absolute file URI", value: "file:" + absolute},
		{name: "empty", wantErr: true},
		{name: "relative path", value: "content.sqlite", wantErr: true},
		{name: "relative file URI", value: "file:content.sqlite", wantErr: true},
		{name: "private memory", value: ":memory:", wantErr: true},
		{name: "shared memory", value: "file:/content.sqlite?mode=memory", wantErr: true},
		{name: "memory VFS", value: "file:/content.sqlite?vfs=memdb", wantErr: true},
		{name: "remote file URI", value: "file://example.test/content.sqlite", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("RIDU_SQLITE_PATH", test.value)
			got, err := sqliteDatabasePath()
			if (err != nil) != test.wantErr {
				t.Fatalf("sqliteDatabasePath() = %q, %v; want error %t", got, err, test.wantErr)
			}
			if err == nil && got != test.value {
				t.Fatalf("sqliteDatabasePath() = %q; want %q", got, test.value)
			}
		})
	}
}

func TestStartupMigrationsApplyAndInspectFreshSQLite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "content.sqlite")
	directory := filepath.Join("..", "..", "migrations")
	applicationConfig := content.Config()
	if err := applyStartupMigrations(context.Background(), applicationConfig, path, directory); err != nil {
		t.Fatal(err)
	}
	if err := applyStartupMigrations(context.Background(), applicationConfig, path, directory); err != nil {
		t.Fatalf("repeat startup migration: %v", err)
	}
	manifest, err := ridu.Resolve(applicationConfig)
	if err != nil {
		t.Fatal(err)
	}
	statuses, err := sqlite.InspectArtifacts(context.Background(), path, directory, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 1 || !statuses[0].Applied {
		t.Fatalf("migration statuses = %+v; want one applied initial migration", statuses)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

func TestStartupMigrationsRejectMissingOrChangedHistory(t *testing.T) {
	committedDirectory := filepath.Join("..", "..", "migrations")
	applicationConfig := content.Config()
	files, err := filepath.Glob(filepath.Join(committedDirectory, "*.ridu.json"))
	if err != nil || len(files) != 1 {
		t.Fatalf("initial migration files = %v, %v; want one", files, err)
	}
	artifact, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name  string
		files map[string][]byte
	}{
		{name: "missing", files: nil},
		{name: "altered", files: map[string][]byte{filepath.Base(files[0]): append(append([]byte(nil), artifact...), '\n')}},
		{name: "renamed", files: map[string][]byte{"20990101000000.000000000_initial.ridu.json": artifact}},
		{name: "additional", files: map[string][]byte{
			filepath.Base(files[0]):                    artifact,
			"20990101000000.000000000_extra.ridu.json": artifact,
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "content.sqlite")
			directory := t.TempDir()
			for name, bytes := range test.files {
				if err := os.WriteFile(filepath.Join(directory, name), bytes, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if err := applyStartupMigrations(context.Background(), applicationConfig, path, directory); err == nil {
				t.Fatal("startup accepted different runtime history")
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatalf("target SQLite file exists after rejected history: %v", err)
			}
		})
	}
}

func TestStrictStartupRejectsReadinessBypasses(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("RIDU_UPLOAD_PATH", filepath.Join(t.TempDir(), "uploads"))
	for _, name := range []string{"RIDU_SKIP_READINESS_PREFLIGHT", "RIDU_ALLOW_UNVERIFIABLE_READINESS"} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("RIDU_SKIP_READINESS_PREFLIGHT", "false")
			t.Setenv("RIDU_ALLOW_UNVERIFIABLE_READINESS", "false")
			if err := validateStrictStartup(); err != nil {
				t.Fatalf("false readiness options: %v", err)
			}
			t.Setenv(name, "true")
			if err := validateStrictStartup(); err == nil || !strings.Contains(err.Error(), name) {
				t.Fatalf("enabled %s error = %v", name, err)
			}
		})
	}
}

func TestStrictStartupRequiresDurableLocalUploads(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("RIDU_SKIP_READINESS_PREFLIGHT", "false")
	t.Setenv("RIDU_ALLOW_UNVERIFIABLE_READINESS", "false")
	for _, path := range []string{"", ".ridu/uploads", "uploads"} {
		t.Setenv("RIDU_UPLOAD_PATH", path)
		if err := validateStrictStartup(); err == nil || !strings.Contains(err.Error(), "RIDU_UPLOAD_PATH") {
			t.Fatalf("relative upload path %q error = %v", path, err)
		}
	}
	t.Setenv("RIDU_UPLOAD_PATH", filepath.Join(t.TempDir(), "uploads"))
	if err := validateStrictStartup(); err != nil {
		t.Fatal(err)
	}
	// An S3 deployment does not use RIDU_UPLOAD_PATH. Its credentials are
	// separately validated before startup readiness admits traffic.
	t.Setenv("S3_BUCKET", "example")
	t.Setenv("RIDU_UPLOAD_PATH", "")
	if err := validateStrictStartup(); err != nil {
		t.Fatal(err)
	}
}

func clearStorageEnv(t *testing.T) {
	t.Helper()
	for _, name := range []string{
		"S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_URL_STYLE",
		"ENDPOINT", "REGION", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "RIDU_S3_SPOOL_DIRECTORY",
	} {
		t.Setenv(name, "")
	}
}

func TestUploadStorageDefaultsLocal(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("RIDU_UPLOAD_PATH", filepath.Join(t.TempDir(), "uploads"))
	backend, err := uploadStorage()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := backend.(*localstorage.Backend); !ok {
		t.Fatalf("backend = %T; want local storage", backend)
	}
}

func TestUploadStorageSelectsRailwayURLStyle(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("ENDPOINT", "https://t3.storageapi.dev")
	t.Setenv("REGION", "auto")
	t.Setenv("BUCKET", "quikmarq-abc123")
	t.Setenv("ACCESS_KEY_ID", "access")
	t.Setenv("SECRET_ACCESS_KEY", "secret")
	t.Setenv("RIDU_S3_SPOOL_DIRECTORY", filepath.Join(t.TempDir(), "spool"))
	backend, err := uploadStorage()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := backend.(*virtuals3.Backend); !ok {
		t.Fatalf("backend = %T; want virtual-host S3", backend)
	}
	t.Setenv("S3_URL_STYLE", "path")
	backend, err = uploadStorage()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := backend.(*s3storage.Backend); !ok {
		t.Fatalf("backend = %T; want released path-style S3", backend)
	}
}

func TestUploadStorageRejectsPartialS3Config(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("BUCKET", "quikmarq-abc123")
	_, err := uploadStorage()
	if err == nil || !strings.Contains(err.Error(), "all five S3 credentials") {
		t.Fatalf("error = %v; want incomplete S3 configuration", err)
	}
}
