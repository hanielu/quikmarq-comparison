package main

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/hanielu/quikmarq-ridu/content"
	"github.com/hanielu/quikmarq-ridu/internal/adminassets"
	virtuals3 "github.com/hanielu/quikmarq-ridu/internal/storage"
	"github.com/hanielu/quikmarq-ridu/migrations"
	"github.com/riducms/ridu"
	"github.com/riducms/ridu/adapters/sqlite"
	localstorage "github.com/riducms/ridu/adapters/storage/local"
	s3storage "github.com/riducms/ridu/adapters/storage/s3"
	"github.com/riducms/ridu/migration"
	"github.com/riducms/ridu/storage"
	"github.com/riducms/ridu/store"
)

const serveWithMigrations = "serve-with-migrations"

func main() {
	applicationConfig := content.Config()
	options := []ridu.ExecuteOption{ridu.WithProjectMigrations(sqlite.ProjectMigrations())}
	strictStartup := len(os.Args) == 2 && os.Args[1] == serveWithMigrations
	if len(os.Args) == 1 || strictStartup {
		if strictStartup {
			if err := validateStrictStartup(); err != nil {
				log.Fatal(err)
			}
		}
		path, err := sqliteDatabasePath()
		if err != nil {
			log.Fatal(err)
		}
		if strictStartup {
			migrationContext, cancelMigrations := context.WithTimeout(context.Background(), time.Minute)
			err := applyStartupMigrations(migrationContext, applicationConfig, path, "migrations")
			cancelMigrations()
			if err != nil {
				log.Fatal(err)
			}
			os.Args = os.Args[:1]
		}
		options = append(options, runtimeOptions(path, strictStartup)...)
	}
	if err := ridu.Execute(applicationConfig, options...); err != nil {
		log.Fatal(err)
	}
}

func applyStartupMigrations(ctx context.Context, applicationConfig ridu.Config, path, directory string) error {
	if err := migrations.ValidateDirectory(directory); err != nil {
		return fmt.Errorf("validate compiled SQLite migration history: %w", err)
	}
	manifest, err := ridu.Resolve(applicationConfig)
	if err != nil {
		return fmt.Errorf("resolve schema for SQLite migrations: %w", err)
	}
	driver := sqlite.ProjectMigrations()
	if err := driver.RunProjectMigration(ctx, migration.ProjectRequest{
		Action:       migration.ProjectApply,
		DatabasePath: path,
		Directory:    directory,
	}, manifest); err != nil {
		return fmt.Errorf("apply SQLite migrations: %w", err)
	}
	statuses, err := sqlite.InspectArtifacts(ctx, path, directory, manifest)
	if err != nil {
		return fmt.Errorf("inspect applied SQLite migrations: %w", err)
	}
	for _, status := range statuses {
		if !status.Applied {
			return fmt.Errorf("SQLite migration %s remains pending", status.Name)
		}
	}
	return nil
}

func validateStrictStartup() error {
	for _, name := range []string{"RIDU_SKIP_READINESS_PREFLIGHT", "RIDU_ALLOW_UNVERIFIABLE_READINESS"} {
		raw := strings.TrimSpace(os.Getenv(name))
		if raw == "" {
			continue
		}
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return fmt.Errorf("%s must be a boolean: %w", name, err)
		}
		if value {
			return fmt.Errorf("%s cannot be enabled with %s", name, serveWithMigrations)
		}
	}
	if !hasS3Configuration() {
		root := strings.TrimSpace(os.Getenv("RIDU_UPLOAD_PATH"))
		if !filepath.IsAbs(root) {
			return fmt.Errorf("RIDU_UPLOAD_PATH is required and must name a durable absolute directory with %s", serveWithMigrations)
		}
	}
	return nil
}

func sqliteDatabasePath() (string, error) {
	path := strings.TrimSpace(os.Getenv("RIDU_SQLITE_PATH"))
	switch {
	case path == "":
		return "", fmt.Errorf("RIDU_SQLITE_PATH is required and must name a durable absolute file path")
	case path == ":memory:":
		return "", fmt.Errorf("RIDU_SQLITE_PATH must be a persistent file")
	case strings.HasPrefix(path, "file:"):
		parsed, err := url.Parse(path)
		if err != nil || parsed.Host != "" {
			return "", fmt.Errorf("RIDU_SQLITE_PATH must be a valid local SQLite file URI")
		}
		target := parsed.Path
		if target == "" {
			target, err = url.PathUnescape(parsed.Opaque)
		}
		if err != nil || !filepath.IsAbs(target) {
			return "", fmt.Errorf("RIDU_SQLITE_PATH file URI must contain an absolute path")
		}
		parameters := parsed.Query()
		if target == ":memory:" || strings.EqualFold(parameters.Get("mode"), "memory") || strings.EqualFold(parameters.Get("vfs"), "memdb") {
			return "", fmt.Errorf("RIDU_SQLITE_PATH must be a persistent file")
		}
	case !filepath.IsAbs(path):
		return "", fmt.Errorf("RIDU_SQLITE_PATH must be an absolute file path or file URI")
	}
	return path, nil
}

func runtimeOptions(path string, strictStartup bool) []ridu.ExecuteOption {
	return []ridu.ExecuteOption{
		ridu.WithStore(func(ctx context.Context) (store.Store, error) {
			return sqlite.Open(ctx, path)
		}),
		ridu.WithUploadStorage(func(_ context.Context) (storage.Backend, error) {
			backend, err := uploadStorage()
			if err != nil {
				return nil, err
			}
			content.ConfigureShareStorage(backend)
			return backend, nil
		}),
		ridu.WithAddress(serverAddress()),
		ridu.WithHandlerOptions(ridu.HandlerOptions{
			AdminAssets:             adminassets.FS(),
			MaxBodyBytes:            5_000_000,
			RequestTimeout:          60 * time.Second,
			AllowedOrigins:          envList("RIDU_ALLOWED_ORIGINS"),
			AllowedHosts:            envList("RIDU_ALLOWED_HOSTS"),
			TrustedProxyCIDRs:       envList("RIDU_TRUSTED_PROXY_CIDRS"),
			AuthRateLimit:           int(envInt32("RIDU_AUTH_RATE_LIMIT")),
			ReadinessTimeout:        envDuration("RIDU_READINESS_TIMEOUT"),
			StrictTransportSecurity: os.Getenv("RIDU_STRICT_TRANSPORT_SECURITY"),
		}),
		ridu.WithServerOptions(ridu.ServerOptions{
			ShutdownTimeout:            envDuration("RIDU_SHUTDOWN_TIMEOUT"),
			WorkerDrainTimeout:         envDuration("RIDU_WORKER_DRAIN_TIMEOUT"),
			ReadinessDrainDelay:        envDuration("RIDU_READINESS_DRAIN_DELAY"),
			AllowUnverifiableReadiness: !strictStartup && envBool("RIDU_ALLOW_UNVERIFIABLE_READINESS"),
			SkipReadinessPreflight:     !strictStartup && envBool("RIDU_SKIP_READINESS_PREFLIGHT"),
		}),
	}
}

func uploadStorage() (storage.Backend, error) {
	endpoint := envFirst("S3_ENDPOINT", "ENDPOINT")
	region := envFirst("S3_REGION", "REGION")
	bucket := envFirst("S3_BUCKET", "BUCKET")
	accessKey := envFirst("S3_ACCESS_KEY", "ACCESS_KEY_ID")
	secretKey := envFirst("S3_SECRET_KEY", "SECRET_ACCESS_KEY")
	style := strings.TrimSpace(os.Getenv("S3_URL_STYLE"))
	spoolDirectory := strings.TrimSpace(os.Getenv("RIDU_S3_SPOOL_DIRECTORY"))
	if !hasS3Configuration() {
		root := strings.TrimSpace(os.Getenv("RIDU_UPLOAD_PATH"))
		if root == "" {
			root = ".ridu/uploads"
		}
		return localstorage.New(root)
	}
	if endpoint == "" || region == "" || bucket == "" || accessKey == "" || secretKey == "" {
		return nil, fmt.Errorf("all five S3 credentials must be set, using S3_* or Railway bucket variable names")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("S3_ENDPOINT must be an HTTPS origin without a path, query, or fragment")
	}
	if style != "" && style != "virtual" && style != "path" {
		return nil, fmt.Errorf("S3_URL_STYLE must be virtual or path")
	}
	if spoolDirectory == "" {
		spoolDirectory = os.TempDir()
	}
	if err := os.MkdirAll(spoolDirectory, 0o700); err != nil {
		return nil, fmt.Errorf("create S3 spool directory: %w", err)
	}
	if style == "path" {
		return s3storage.New(s3storage.Config{
			Endpoint: endpoint, Region: region, Bucket: bucket,
			AccessKey: accessKey, SecretKey: secretKey,
			MaxSpoolBytes:  5_000_000,
			SpoolDirectory: spoolDirectory,
		})
	}
	return virtuals3.New(virtuals3.Config{
		Endpoint: endpoint, Region: region, Bucket: bucket,
		AccessKey: accessKey, SecretKey: secretKey,
		MaxSpoolBytes:  5_000_000,
		SpoolDirectory: spoolDirectory,
	})
}

func hasS3Configuration() bool {
	return envFirst("S3_ENDPOINT", "ENDPOINT", "S3_REGION", "REGION", "S3_BUCKET", "BUCKET", "S3_ACCESS_KEY", "ACCESS_KEY_ID", "S3_SECRET_KEY", "SECRET_ACCESS_KEY", "S3_URL_STYLE") != ""
}

func envFirst(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func serverAddress() string {
	if address := strings.TrimSpace(os.Getenv("RIDU_ADDRESS")); address != "" {
		return address
	}
	if port := strings.TrimSpace(os.Getenv("PORT")); port != "" {
		return ":" + port
	}
	return ":8080"
}

func envBool(name string) bool {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return false
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		log.Fatalf("%s must be a boolean: %v", name, err)
	}
	return value
}

func envDuration(name string) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return 0
	}
	value, err := time.ParseDuration(raw)
	if err != nil {
		log.Fatalf("%s must be a Go duration: %v", name, err)
	}
	return value
}

func envInt32(name string) int32 {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return 0
	}
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil || value < 0 {
		log.Fatalf("%s must be a non-negative 32-bit integer", name)
	}
	return int32(value)
}

func envList(name string) []string {
	var values []string
	for _, value := range strings.Split(os.Getenv(name), ",") {
		if value = strings.TrimSpace(value); value != "" {
			values = append(values, value)
		}
	}
	return values
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
