package content

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func metadataResponse(status, contentType, body string) string {
	header := fmt.Sprintf("HTTP/1.1 %s\r\nContent-Length: %d\r\nConnection: close\r\n", status, len(body))
	if contentType != "" {
		header += "Content-Type: " + contentType + "\r\n"
	}
	return header + "\r\n" + body
}

// The fake dial receives only addresses already accepted by the production
// validator and serves HTTP over an in-memory pipe; no public network is used.
func metadataPipeDial(response func(*http.Request) string, calls *atomic.Int32) func(context.Context, string, string) (net.Conn, error) {
	return func(_ context.Context, _, _ string) (net.Conn, error) {
		calls.Add(1)
		client, server := net.Pipe()
		go func() {
			defer server.Close()
			request, err := http.ReadRequest(bufio.NewReader(server))
			if err != nil {
				return
			}
			defer request.Body.Close()
			_, _ = io.WriteString(server, response(request))
		}()
		return client, nil
	}
}

func TestFetchMetadataWithoutPublicNetwork(t *testing.T) {
	public := netip.MustParseAddr("8.8.8.8")
	lookup := func(_ context.Context, _, _ string) ([]netip.Addr, error) { return []netip.Addr{public}, nil }
	for _, test := range []struct {
		name, body, contentType string
		wantError               bool
	}{
		{name: "HTML and relative media", body: `<title>Fallback</title><meta property="og:title" content="Final &amp; Title"><meta name="description" content="A page"><meta property="og:image" content="/cover.png">`, contentType: "text/html; charset=utf-8"},
		{name: "HTML without type", body: `<!doctype html><title>Detected</title>`},
		{name: "malformed HTML", body: `<title>Unclosed <meta name="description" content="Partial">`, contentType: "text/html"},
		{name: "exact body limit", body: `<title>Bounded</title>` + strings.Repeat("x", (1<<20)-len(`<title>Bounded</title>`)), contentType: "text/html"},
		{name: "non HTML", body: `{"title":"not a page"}`, contentType: "application/json", wantError: true},
		{name: "non HTML without type", body: strings.Repeat("\x00", 512), wantError: true},
		{name: "oversize HTML after early metadata", body: `<title>Early</title>` + strings.Repeat("x", (1<<20)+1-len(`<title>Early</title>`)), contentType: "text/html", wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var dials atomic.Int32
			target, err := parsePublicURL("http://example.test/path")
			if err != nil {
				t.Fatal(err)
			}
			metadata, err := fetchMetadataWithNetwork(context.Background(), target, lookup, metadataPipeDial(func(*http.Request) string {
				return metadataResponse("200 OK", test.contentType, test.body)
			}, &dials))
			if (err != nil) != test.wantError {
				t.Fatalf("metadata = %#v, error = %v; want error %v", metadata, err, test.wantError)
			}
			if dials.Load() != 1 {
				t.Fatalf("dials = %d, want 1", dials.Load())
			}
			if !test.wantError && metadata.NormalizedURL != target.String() {
				t.Fatalf("normalized URL = %q", metadata.NormalizedURL)
			}
			if test.name == "HTML and relative media" && (metadata.Title != "Final & Title" || metadata.Description != "A page" || metadata.PreviewImage != "http://example.test/cover.png") {
				t.Fatalf("metadata = %#v", metadata)
			}
			if test.name == "malformed HTML" && metadata.Favicon != "http://example.test/favicon.ico" {
				t.Fatalf("malformed HTML fallback = %#v", metadata)
			}
		})
	}
}

func TestFetchMetadataRedirectValidationAndDNSRebinding(t *testing.T) {
	public := netip.MustParseAddr("8.8.8.8")
	private := netip.MustParseAddr("127.0.0.1")
	for _, test := range []struct {
		name, location string
		rebind         bool
		wantError      bool
		wantDials      int32
	}{
		{name: "public redirect", location: "http://redirect.test/final", wantDials: 2},
		{name: "private address redirect", location: "http://127.0.0.1/private", wantError: true, wantDials: 1},
		{name: "private DNS redirect", location: "http://private.test/private", wantError: true, wantDials: 1},
		{name: "credential redirect", location: "http://user:secret@redirect.test/private", wantError: true, wantDials: 1},
		{name: "non HTTP redirect", location: "file:///etc/passwd", wantError: true, wantDials: 1},
		{name: "DNS rebinding on same host", location: "http://example.test/next", rebind: true, wantError: true, wantDials: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			var dials, lookups atomic.Int32
			lookup := func(_ context.Context, _, host string) ([]netip.Addr, error) {
				lookups.Add(1)
				if host == "private.test" || (test.rebind && lookups.Load() > 1) {
					return []netip.Addr{private}, nil
				}
				return []netip.Addr{public}, nil
			}
			target, err := parsePublicURL("http://example.test/start")
			if err != nil {
				t.Fatal(err)
			}
			metadata, err := fetchMetadataWithNetwork(context.Background(), target, lookup, metadataPipeDial(func(request *http.Request) string {
				if request.URL.Path == "/start" {
					return "HTTP/1.1 302 Found\r\nLocation: " + test.location + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
				}
				return metadataResponse("200 OK", "text/html", "<title>Redirected</title>")
			}, &dials))
			if (err != nil) != test.wantError {
				t.Fatalf("metadata = %#v, error = %v; want error %v", metadata, err, test.wantError)
			}
			if dials.Load() != test.wantDials {
				t.Fatalf("dials = %d, want %d", dials.Load(), test.wantDials)
			}
			if !test.wantError && (metadata.Title != "Redirected" || metadata.NormalizedURL != test.location) {
				t.Fatalf("redirected metadata = %#v", metadata)
			}
		})
	}
}

func TestFetchMetadataReusesValidatedConnection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(writer, "<title>Reused</title>")
	}))
	defer server.Close()
	public := netip.MustParseAddr("8.8.8.8")
	var dials atomic.Int32
	var dialer net.Dialer
	client := newMetadataClient(
		func(context.Context, string, string) ([]netip.Addr, error) { return []netip.Addr{public}, nil },
		func(ctx context.Context, network, _ string) (net.Conn, error) {
			dials.Add(1)
			return dialer.DialContext(ctx, network, server.Listener.Addr().String())
		},
	)
	defer client.CloseIdleConnections()
	target, err := parsePublicURL("http://example.test/page")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		metadata, err := fetchMetadataWithClient(context.Background(), target, client)
		if err != nil || metadata.Title != "Reused" {
			t.Fatalf("metadata = %#v, error = %v", metadata, err)
		}
	}
	if got := dials.Load(); got != 1 {
		t.Fatalf("dials = %d, want one validated connection reused", got)
	}
}

func TestFetchMetadataRejectsRebindingOnReusableRedirect(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		if request.URL.Path == "/start" {
			http.Redirect(writer, request, "http://example.test/final", http.StatusFound)
			return
		}
		writer.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(writer, "<title>Unexpected</title>")
	}))
	defer server.Close()
	public := netip.MustParseAddr("8.8.8.8")
	private := netip.MustParseAddr("127.0.0.1")
	var lookups atomic.Int32
	var dialer net.Dialer
	client := newMetadataClient(
		func(context.Context, string, string) ([]netip.Addr, error) {
			if lookups.Add(1) == 1 {
				return []netip.Addr{public}, nil
			}
			return []netip.Addr{private}, nil
		},
		func(ctx context.Context, network, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, server.Listener.Addr().String())
		},
	)
	defer client.CloseIdleConnections()
	target, err := parsePublicURL("http://example.test/start")
	if err != nil {
		t.Fatal(err)
	}
	_, err = fetchMetadataWithClient(context.Background(), target, client)
	if err == nil || requests.Load() != 1 || lookups.Load() != 2 {
		t.Fatalf("redirect rebinding: error = %v, requests = %d, lookups = %d", err, requests.Load(), lookups.Load())
	}
}

func TestFetchMetadataLimitsConcurrentWork(t *testing.T) {
	entered := make(chan struct{}, 8)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		entered <- struct{}{}
		<-release
		writer.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(writer, "<title>Ready</title>")
	}))
	defer server.Close()
	public := netip.MustParseAddr("8.8.8.8")
	var dialer net.Dialer
	client := newMetadataClient(
		func(context.Context, string, string) ([]netip.Addr, error) { return []netip.Addr{public}, nil },
		func(ctx context.Context, network, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, server.Listener.Addr().String())
		},
	)
	defer client.CloseIdleConnections()
	var workers sync.WaitGroup
	errors := make(chan error, 8)
	for i := range 8 {
		workers.Add(1)
		go func(i int) {
			defer workers.Done()
			target, err := parsePublicURL(fmt.Sprintf("http://example%d.test/page", i))
			if err == nil {
				_, err = fetchMetadataWithClient(context.Background(), target, client)
			}
			errors <- err
		}(i)
	}
	for range cap(metadataSlots) {
		select {
		case <-entered:
		case <-time.After(time.Second):
			close(release)
			t.Fatal("fewer than four requests entered")
		}
	}
	select {
	case <-entered:
		close(release)
		t.Fatal("more than four requests entered before release")
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent fetch: %v", err)
		}
	}
}

func TestFetchMetadataCanceledWhileQueued(t *testing.T) {
	for range cap(metadataSlots) {
		metadataSlots <- struct{}{}
	}
	defer func() {
		for range cap(metadataSlots) {
			<-metadataSlots
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	target, err := parsePublicURL("http://example.test/page")
	if err != nil {
		t.Fatal(err)
	}
	_, err = fetchMetadataWithClient(ctx, target, &http.Client{})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("queued request error = %v, want deadline exceeded", err)
	}
}

func TestParseHTMLMetadataPrefersOpenGraphTitleRegardlessOfOrder(t *testing.T) {
	page, err := parsePublicURL("https://example.test/page")
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		`<title>Fallback</title><meta property="og:title" content="Preferred">`,
		`<meta property="og:title" content="Preferred"><title>Fallback</title>`,
	} {
		metadata := parseHTMLMetadata(body, page)
		if metadata.Title != "Preferred" {
			t.Fatalf("body %q: title = %q", body, metadata.Title)
		}
	}
}

func TestFetchMetadataRejectsMixedDNSAnswersAndTimeout(t *testing.T) {
	public := netip.MustParseAddr("8.8.8.8")
	private := netip.MustParseAddr("10.0.0.1")
	target, err := parsePublicURL("http://example.test/")
	if err != nil {
		t.Fatal(err)
	}
	var dials atomic.Int32
	_, err = fetchMetadataWithNetwork(context.Background(), target, func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{public, private}, nil
	}, metadataPipeDial(func(*http.Request) string { return metadataResponse("200 OK", "text/html", "ok") }, &dials))
	if err == nil || dials.Load() != 0 {
		t.Fatalf("mixed DNS answers: error = %v, dials = %d", err, dials.Load())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err = fetchMetadataWithNetwork(ctx, target, func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{public}, nil
	}, metadataPipeDial(func(*http.Request) string {
		time.Sleep(100 * time.Millisecond)
		return metadataResponse("200 OK", "text/html", "<title>Too late</title>")
	}, &dials))
	if err == nil || ctx.Err() != context.DeadlineExceeded {
		t.Fatalf("timeout: error = %v, context = %v", err, ctx.Err())
	}
}
