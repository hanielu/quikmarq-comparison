package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	s3storage "github.com/riducms/ridu/adapters/storage/s3"
	"github.com/riducms/ridu/storage"
)

// This opt-in qualification only touches a fresh random prefix. Run it with
// Railway-injected credentials; never copy those credentials into a fixture.
func TestRailwayBucketContract(t *testing.T) {
	if os.Getenv("QUIKMARQ_RAILWAY_STORAGE_TEST") != "1" {
		t.Skip("set QUIKMARQ_RAILWAY_STORAGE_TEST=1 with Railway bucket variables")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	config := s3storage.Config{
		Endpoint: envFirst("S3_ENDPOINT", "ENDPOINT"), Region: envFirst("S3_REGION", "REGION"),
		Bucket: envFirst("S3_BUCKET", "BUCKET"), AccessKey: envFirst("S3_ACCESS_KEY", "ACCESS_KEY_ID"),
		SecretKey: envFirst("S3_SECRET_KEY", "SECRET_ACCESS_KEY"), MaxSpoolBytes: 5_000_000,
	}
	released, err := s3storage.New(config)
	if err != nil {
		t.Fatal("released S3 adapter configuration failed")
	}
	if err := released.Ping(ctx); err != nil {
		t.Log("released path-style adapter cannot access this bucket; qualifying application virtual-host adapter")
	} else {
		t.Log("released path-style adapter can access this bucket")
	}
	backend, err := uploadStorage()
	if err != nil {
		t.Fatal(err)
	}
	if err := backend.(storage.HealthBackend).Ping(ctx); err != nil {
		t.Fatalf("configured bucket readiness: %v", err)
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		t.Fatal(err)
	}
	prefix := "qualification/" + hex.EncodeToString(nonce[:]) + "/"
	keys := []string{prefix + "one.png", prefix + "two.png"}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		for _, key := range keys {
			if err := backend.Delete(cleanup, key); err != nil {
				t.Errorf("cleanup qualification object: %v", err)
			}
		}
	})
	body := []byte("Quikmarq Railway storage qualification")
	for _, key := range keys {
		if err := backend.Put(ctx, key, bytes.NewReader(body), int64(len(body)), "image/png"); err != nil {
			t.Fatalf("upload: %v", err)
		}
	}
	reader, object, err := backend.Open(ctx, keys[0])
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	got, readErr := io.ReadAll(io.LimitReader(reader, int64(len(body))+1))
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, body) || object.Size != int64(len(body)) || object.ContentType != "image/png" {
		t.Fatal("uploaded bytes or metadata did not round-trip")
	}
	page, err := backend.List(ctx, storage.ListRequest{Prefix: prefix, Limit: 1})
	if err != nil || len(page.Objects) != 1 || page.Objects[0].Key != keys[0] || page.NextCursor == "" {
		t.Fatalf("first listing page: %+v, %v", page, err)
	}
	last, err := backend.List(ctx, storage.ListRequest{Prefix: prefix, Limit: 1, Cursor: page.NextCursor})
	if err != nil || len(last.Objects) != 1 || last.Objects[0].Key != keys[1] || last.NextCursor != "" {
		t.Fatalf("last listing page: %+v, %v", last, err)
	}
	signed, err := backend.(storage.URLSigner).SignedURL(ctx, keys[0], time.Minute)
	if err != nil {
		t.Fatal("could not sign the uploaded object")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, signed, nil)
	if err != nil {
		t.Fatal("invalid signed URL")
	}
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		// Do not print a URL containing signing credentials to deployment logs.
		t.Fatal("signed URL download failed")
	}
	got, readErr = io.ReadAll(io.LimitReader(response.Body, int64(len(body))+1))
	response.Body.Close()
	if response.StatusCode != http.StatusOK || readErr != nil || !bytes.Equal(got, body) {
		t.Fatalf("signed download did not round-trip: HTTP %d", response.StatusCode)
	}
	for _, key := range keys {
		if err := backend.Delete(ctx, key); err != nil {
			t.Fatalf("delete: %v", err)
		}
	}
	_, _, err = backend.Open(ctx, keys[0])
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatal("deleted object did not return storage.ErrNotFound")
	}
	page, err = backend.List(ctx, storage.ListRequest{Prefix: prefix, Limit: 1})
	if err != nil || len(page.Objects) != 0 {
		t.Fatal("qualification prefix was not empty after deletion")
	}
}
