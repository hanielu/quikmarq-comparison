package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/riducms/ridu/storage"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestSignedURLUsesVirtualHost(t *testing.T) {
	backend, err := New(Config{
		Endpoint: "https://t3.storageapi.dev", Region: "auto", Bucket: "quikmarq-abc123",
		AccessKey: "test-access", SecretKey: "test-secret", MaxSpoolBytes: 32 << 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	signed, err := backend.SignedURL(context.Background(), "quikmarq/assets/photo.jpg", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(signed)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Host != "quikmarq-abc123.t3.storageapi.dev" || parsed.Path != "/quikmarq/assets/photo.jpg" {
		t.Fatalf("signed URL used %s%s; want virtual-host bucket and bare object path", parsed.Host, parsed.Path)
	}
	if parsed.Query().Get("X-Amz-Signature") == "" {
		t.Fatal("signed URL is missing its signature")
	}
}

func TestNewRejectsPlaintextEndpoint(t *testing.T) {
	_, err := New(Config{
		Endpoint: "http://t3.storageapi.dev", Region: "auto", Bucket: "quikmarq",
		AccessKey: "test-access", SecretKey: "test-secret", MaxSpoolBytes: 32 << 20,
	})
	if err == nil {
		t.Fatal("expected plaintext endpoint to be rejected")
	}
}

func TestNewRejectsEndpointPath(t *testing.T) {
	_, err := New(Config{
		Endpoint: "https://t3.storageapi.dev/bucket", Region: "auto", Bucket: "quikmarq",
		AccessKey: "test-access", SecretKey: "test-secret", MaxSpoolBytes: 5_000_000,
	})
	if err == nil {
		t.Fatal("expected endpoint path to be rejected")
	}
}

func TestOpenMapsGeneric404ToNotFound(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusNotFound, Status: "404 Not Found",
			Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), Request: request,
		}, nil
	})}
	backend, err := New(Config{
		Endpoint: "https://t3.storageapi.dev", Region: "auto", Bucket: "quikmarq",
		AccessKey: "test-access", SecretKey: "test-secret", MaxSpoolBytes: 5_000_000, HTTPClient: client,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = backend.Open(context.Background(), "quikmarq/missing.png")
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("Open error = %v; want storage.ErrNotFound", err)
	}
}

func TestInvalidObjectKey(t *testing.T) {
	backend, err := New(Config{
		Endpoint: "https://t3.storageapi.dev", Region: "auto", Bucket: "quikmarq",
		AccessKey: "test-access", SecretKey: "test-secret", MaxSpoolBytes: 5_000_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"", "/absolute", "a//b", "a/../b", `a\b`} {
		if _, err := backend.SignedURL(context.Background(), key, time.Minute); err == nil {
			t.Errorf("SignedURL accepted invalid key %q", key)
		}
	}
}
