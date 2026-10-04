package content

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

var benchmarkMetadata pageMetadata

func benchmarkHTML(size int) string {
	var body strings.Builder
	body.Grow(size)
	body.WriteString(`<!doctype html><html><head><title>Article &amp; Notes</title><meta property="og:title" content="Article &amp; Notes"><meta name="description" content="A useful description"><meta property="og:image" content="/cover.jpg"><link rel="icon" href="/favicon.png"></head><body>`)
	paragraph := `<article><p>Representative article text with links, numbers, and punctuation. The metadata parser needs to scan ordinary body content without retaining it.</p></article>`
	for body.Len()+len(paragraph)+14 <= size {
		body.WriteString(paragraph)
	}
	body.WriteString(`</body></html>`)
	return body.String()
}

func benchmarkHTMLSingleText(size int) string {
	const prefix = `<!doctype html><title>Article</title><meta name="description" content="A useful description"><body>`
	const suffix = `</body>`
	return prefix + strings.Repeat("x", size-len(prefix)-len(suffix)) + suffix
}

func BenchmarkParseHTMLMetadata(b *testing.B) {
	page, err := url.Parse("https://example.com/articles/notes")
	if err != nil {
		b.Fatal(err)
	}
	for _, test := range []struct {
		name string
		size int
	}{
		{name: "Small_8KiB", size: 8 << 10},
		{name: "Large_Near1MiB", size: (1 << 20) - 1024},
	} {
		b.Run(test.name, func(b *testing.B) {
			body := benchmarkHTML(test.size)
			b.SetBytes(int64(len(body)))
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				benchmarkMetadata = parseHTMLMetadata(body, page)
			}
		})
	}
	b.Run("Large_OneTextNode", func(b *testing.B) {
		body := benchmarkHTMLSingleText((1 << 20) - 1024)
		b.SetBytes(int64(len(body)))
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			benchmarkMetadata = parseHTMLMetadata(body, page)
		}
	})
}

func BenchmarkFetchMetadata(b *testing.B) {
	page, err := parsePublicURL("http://example.test/articles/notes")
	if err != nil {
		b.Fatal(err)
	}
	public := netip.MustParseAddr("8.8.8.8")
	lookup := func(context.Context, string, string) ([]netip.Addr, error) { return []netip.Addr{public}, nil }
	for _, test := range []struct {
		name string
		size int
	}{
		{name: "Small_8KiB", size: 8 << 10},
		{name: "Large_Near1MiB", size: (1 << 20) - 1024},
	} {
		b.Run(test.name, func(b *testing.B) {
			response := metadataResponse("200 OK", "text/html", benchmarkHTML(test.size))
			var dials atomic.Int32
			dial := metadataPipeDial(func(*http.Request) string { return response }, &dials)
			b.SetBytes(int64(len(response)))
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				metadata, err := fetchMetadataWithNetwork(context.Background(), page, lookup, dial)
				if err != nil {
					b.Fatal(err)
				}
				benchmarkMetadata = metadata
			}
		})
	}
}

func BenchmarkFetchMetadataPooledHTTP(b *testing.B) {
	for _, test := range []struct {
		name string
		size int
	}{
		{name: "Small_8KiB", size: 8 << 10},
		{name: "Large_Near1MiB", size: (1 << 20) - 1024},
	} {
		b.Run(test.name, func(b *testing.B) {
			body := benchmarkHTML(test.size)
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "text/html")
				_, _ = io.WriteString(writer, body)
			}))
			defer server.Close()
			var dials atomic.Int32
			var dialer net.Dialer
			client := newMetadataClient(
				func(context.Context, string, string) ([]netip.Addr, error) {
					return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
				},
				func(ctx context.Context, network, _ string) (net.Conn, error) {
					dials.Add(1)
					return dialer.DialContext(ctx, network, server.Listener.Addr().String())
				},
			)
			defer client.CloseIdleConnections()
			target, err := parsePublicURL("http://example.test/articles/notes")
			if err != nil {
				b.Fatal(err)
			}
			b.SetBytes(int64(len(body)))
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				metadata, err := fetchMetadataWithClient(context.Background(), target, client)
				if err != nil {
					b.Fatal(err)
				}
				benchmarkMetadata = metadata
			}
			b.ReportMetric(float64(dials.Load())/float64(b.N), "dials/op")
		})
	}
}
