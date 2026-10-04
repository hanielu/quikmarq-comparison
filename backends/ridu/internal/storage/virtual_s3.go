// Package storage supplies the virtual-hosted S3 backend needed by current
// Railway buckets. Older path-style buckets use Ridu's released S3 adapter.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	smithyhttp "github.com/aws/smithy-go/transport/http"
	"github.com/riducms/ridu/storage"
)

type Config struct {
	Endpoint, Region, Bucket, AccessKey, SecretKey string
	MaxSpoolBytes                                  int64
	SpoolDirectory                                 string
	HTTPClient                                     *http.Client
}

type Backend struct {
	client         *s3.Client
	presign        *s3.PresignClient
	bucket         string
	maxSpoolBytes  int64
	spoolDirectory string
}

var (
	_ storage.Backend       = (*Backend)(nil)
	_ storage.HealthBackend = (*Backend)(nil)
	_ storage.URLSigner     = (*Backend)(nil)
)

func New(config Config) (*Backend, error) {
	endpoint, err := url.Parse(config.Endpoint)
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" || endpoint.User != nil || endpoint.Path != "" || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, fmt.Errorf("S3 endpoint must be an HTTPS origin")
	}
	if config.Region == "" || config.Bucket == "" || config.AccessKey == "" || config.SecretKey == "" {
		return nil, fmt.Errorf("S3 region, bucket, access key, and secret key are required")
	}
	if config.MaxSpoolBytes <= 0 {
		return nil, fmt.Errorf("S3 maximum spool bytes must be positive")
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	client := s3.NewFromConfig(aws.Config{
		Region:      config.Region,
		Credentials: credentials.NewStaticCredentialsProvider(config.AccessKey, config.SecretKey, ""),
		HTTPClient:  httpClient,
	}, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(config.Endpoint)
		options.UsePathStyle = false
	})
	return &Backend{client: client, presign: s3.NewPresignClient(client), bucket: config.Bucket, maxSpoolBytes: config.MaxSpoolBytes, spoolDirectory: config.SpoolDirectory}, nil
}

func (backend *Backend) Ping(ctx context.Context) error {
	_, err := backend.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(backend.bucket)})
	return err
}

func (backend *Backend) Put(ctx context.Context, key string, source io.Reader, size int64, contentType string) error {
	if err := validateKey(key); err != nil {
		return err
	}
	if source == nil || size < 0 || size > backend.maxSpoolBytes {
		return fmt.Errorf("S3 upload source and size up to %d bytes are required", backend.maxSpoolBytes)
	}
	// A temporary seekable body gives SigV4 an exact payload and bounds memory use.
	file, err := os.CreateTemp(backend.spoolDirectory, "quikmarq-s3-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	copied, err := io.Copy(file, io.LimitReader(source, size+1))
	if err != nil {
		return err
	}
	if copied != size {
		return fmt.Errorf("S3 upload length mismatch: declared %d bytes, read %d", size, copied)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	_, err = backend.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(backend.bucket), Key: aws.String(key), Body: file,
		ContentLength: aws.Int64(size), ContentType: aws.String(contentType),
	})
	return err
}

func (backend *Backend) Open(ctx context.Context, key string) (io.ReadCloser, storage.Object, error) {
	if err := validateKey(key); err != nil {
		return nil, storage.Object{}, err
	}
	result, err := backend.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(backend.bucket), Key: aws.String(key)})
	if err != nil {
		var notFound *types.NoSuchKey
		var genericNotFound *types.NotFound
		var responseError *smithyhttp.ResponseError
		if errors.As(err, &notFound) || errors.As(err, &genericNotFound) || (errors.As(err, &responseError) && responseError.HTTPStatusCode() == http.StatusNotFound) {
			return nil, storage.Object{}, storage.ErrNotFound
		}
		return nil, storage.Object{}, err
	}
	return result.Body, storage.Object{
		Key: key, Size: aws.ToInt64(result.ContentLength), ContentType: aws.ToString(result.ContentType),
		ModifiedAt: aws.ToTime(result.LastModified),
	}, nil
}

func (backend *Backend) Delete(ctx context.Context, key string) error {
	if err := validateKey(key); err != nil {
		return err
	}
	_, err := backend.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(backend.bucket), Key: aws.String(key)})
	return err
}

func (backend *Backend) List(ctx context.Context, request storage.ListRequest) (storage.ListPage, error) {
	if request.Limit < 1 || request.Limit > storage.MaxListPageSize {
		return storage.ListPage{}, fmt.Errorf("S3 list limit must be between 1 and %d", storage.MaxListPageSize)
	}
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(backend.bucket), Prefix: aws.String(request.Prefix), MaxKeys: aws.Int32(int32(request.Limit)),
	}
	if request.Cursor != "" {
		input.ContinuationToken = aws.String(request.Cursor)
	}
	result, err := backend.client.ListObjectsV2(ctx, input)
	if err != nil {
		return storage.ListPage{}, err
	}
	if len(result.Contents) > request.Limit {
		return storage.ListPage{}, fmt.Errorf("S3 returned more objects than requested")
	}
	objects := make([]storage.Object, 0, len(result.Contents))
	for _, item := range result.Contents {
		key := aws.ToString(item.Key)
		modified := aws.ToTime(item.LastModified)
		if !strings.HasPrefix(key, request.Prefix) || modified.IsZero() {
			return storage.ListPage{}, fmt.Errorf("S3 returned invalid object metadata")
		}
		objects = append(objects, storage.Object{Key: key, Size: aws.ToInt64(item.Size), ModifiedAt: modified})
	}
	sort.Slice(objects, func(left, right int) bool { return objects[left].Key < objects[right].Key })
	for index := 1; index < len(objects); index++ {
		if objects[index-1].Key == objects[index].Key {
			return storage.ListPage{}, fmt.Errorf("S3 returned duplicate object key")
		}
	}
	next := ""
	if aws.ToBool(result.IsTruncated) {
		next = aws.ToString(result.NextContinuationToken)
		if next == "" || next == request.Cursor {
			return storage.ListPage{}, fmt.Errorf("S3 returned invalid continuation token")
		}
	}
	return storage.ListPage{Objects: objects, NextCursor: next}, nil
}

func (backend *Backend) SignedURL(ctx context.Context, key string, ttl time.Duration) (string, error) {
	if err := validateKey(key); err != nil {
		return "", err
	}
	if ttl < time.Second || ttl > 7*24*time.Hour {
		return "", fmt.Errorf("S3 signed URL lifetime must be between one second and seven days")
	}
	result, err := backend.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(backend.bucket), Key: aws.String(key),
	}, func(options *s3.PresignOptions) { options.Expires = ttl })
	if err != nil {
		return "", err
	}
	return result.URL, nil
}

func validateKey(key string) error {
	if key == "" || strings.HasPrefix(key, "/") || strings.Contains(key, `\`) {
		return fmt.Errorf("invalid S3 object key")
	}
	for _, part := range strings.Split(key, "/") {
		if part == "" || part == "." || part == ".." {
			return fmt.Errorf("invalid S3 object key")
		}
	}
	return nil
}
