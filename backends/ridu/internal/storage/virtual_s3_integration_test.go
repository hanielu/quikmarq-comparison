package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/riducms/ridu/storage"
)

// minioWireTransport preserves the signed virtual-host Host header while
// routing test traffic to the HTTP-only Compose fixture. Production never
// uses this transport or an HTTP S3 endpoint.
type minioWireTransport struct {
	address string
	base    http.RoundTripper
}

func (transport minioWireTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	copy := request.Clone(request.Context())
	copy.URL.Scheme = "http"
	copy.URL.Host = transport.address
	copy.Host = request.URL.Host
	return transport.base.RoundTrip(copy)
}

func TestMinIOVirtualHostContract(t *testing.T) {
	if os.Getenv("QUIKMARQ_MINIO_TEST") != "1" {
		t.Skip("set QUIKMARQ_MINIO_TEST=1 after starting the storage Compose profile")
	}
	address := os.Getenv("QUIKMARQ_MINIO_ADDRESS")
	if address == "" {
		address = "127.0.0.1:9000"
	}
	client := &http.Client{Timeout: 10 * time.Second, Transport: minioWireTransport{
		address: address, base: http.DefaultTransport,
	}}
	bucket := "quikmarq-contract-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	backend, err := New(Config{
		Endpoint: "https://minio.localhost", Region: "us-east-1", Bucket: bucket,
		AccessKey: "quikmarq_minio", SecretKey: "quikmarq_minio_secret",
		MaxSpoolBytes: 5_000_000, HTTPClient: client,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := backend.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)}); err != nil {
		t.Fatalf("create MinIO bucket: %v", err)
	}
	keys := []string{"contract/one.png", "contract/two.png"}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		for _, key := range keys {
			_ = backend.Delete(cleanup, key)
		}
		_, _ = backend.client.DeleteBucket(cleanup, &s3.DeleteBucketInput{Bucket: aws.String(bucket)})
	})
	if err := backend.Ping(ctx); err != nil {
		t.Fatalf("bucket health check: %v", err)
	}
	first := []byte("quikmarq storage contract image one")
	for index, key := range keys {
		body := first
		if index == 1 {
			body = []byte("image two")
		}
		if err := backend.Put(ctx, key, bytes.NewReader(body), int64(len(body)), "image/png"); err != nil {
			t.Fatalf("put %s: %v", key, err)
		}
	}
	opened, object, err := backend.Open(ctx, keys[0])
	if err != nil {
		t.Fatalf("open object: %v", err)
	}
	data, readErr := io.ReadAll(opened)
	closeErr := opened.Close()
	if readErr != nil || closeErr != nil {
		t.Fatalf("read object: read=%v close=%v", readErr, closeErr)
	}
	if !bytes.Equal(data, first) || object.Key != keys[0] || object.Size != int64(len(first)) || object.ContentType != "image/png" {
		t.Fatalf("open returned unexpected object: metadata=%+v body=%q", object, data)
	}
	var listed []storage.Object
	cursor := ""
	for {
		page, err := backend.List(ctx, storage.ListRequest{Prefix: "contract/", Cursor: cursor, Limit: 1})
		if err != nil {
			t.Fatalf("list page: %v", err)
		}
		if len(page.Objects) > 1 {
			t.Fatalf("list returned %d objects for limit 1", len(page.Objects))
		}
		listed = append(listed, page.Objects...)
		if page.NextCursor == "" {
			break
		}
		if page.NextCursor == cursor {
			t.Fatal("list cursor did not advance")
		}
		cursor = page.NextCursor
	}
	if len(listed) != 2 || listed[0].Key != keys[0] || listed[1].Key != keys[1] || listed[0].ModifiedAt.IsZero() || listed[1].ModifiedAt.IsZero() {
		t.Fatalf("unexpected list result: %+v", listed)
	}
	signed, err := backend.SignedURL(ctx, keys[0], time.Minute)
	if err != nil {
		t.Fatalf("signed URL: %v", err)
	}
	parsed, err := url.Parse(signed)
	if err != nil || parsed.Host != bucket+".minio.localhost" || parsed.Path != "/"+keys[0] {
		t.Fatalf("signed URL is not virtual hosted: %q (%v)", signed, err)
	}
	response, err := client.Get(signed)
	if err != nil {
		t.Fatalf("download signed URL: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		failure, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		t.Fatalf("signed URL returned %s: %s", response.Status, strings.TrimSpace(string(failure)))
	}
	got, err := io.ReadAll(response.Body)
	if err != nil || !bytes.Equal(got, first) {
		t.Fatalf("signed download: body=%q error=%v", got, err)
	}
	for _, key := range keys {
		if err := backend.Delete(ctx, key); err != nil {
			t.Fatalf("delete %s: %v", key, err)
		}
	}
	if err := backend.Delete(ctx, keys[0]); err != nil {
		t.Fatalf("deleting missing object must succeed: %v", err)
	}
	_, _, err = backend.Open(ctx, keys[0])
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("open after delete = %v, want ErrNotFound", err)
	}
	page, err := backend.List(ctx, storage.ListRequest{Prefix: "contract/", Limit: 1})
	if err != nil || len(page.Objects) != 0 {
		t.Fatalf("list after delete: page=%+v error=%v", page, err)
	}
	if err := backend.Ping(ctx); err != nil {
		t.Fatalf("health after operations: %v", err)
	}
}
