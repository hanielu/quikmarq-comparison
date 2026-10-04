package content

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"html"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/riducms/ridu"
	xhtml "golang.org/x/net/html"
)

func endpoints() []ridu.Endpoint {
	return []ridu.Endpoint{
		{Method: "POST", Path: "/bookmark-metadata", Summary: "Read public web page metadata", MaxBodyBytes: 2048, Handler: bookmarkMetadata},
		{Method: "POST", Path: "/share/resolve", Summary: "Read a shared group", MaxBodyBytes: 4096, Handler: resolveShare},
		{Method: "GET", Path: "/share/media/:capability", Summary: "Read a shared image", Handler: serveSharedMedia},
	}
}

type pageMetadata struct {
	NormalizedURL string `json:"normalizedURL"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	Favicon       string `json:"favicon"`
	PreviewImage  string `json:"previewImage"`
	VideoProvider string `json:"videoProvider,omitempty"`
	VideoID       string `json:"videoID,omitempty"`
}

func bookmarkMetadata(ctx ridu.EndpointContext) {
	if !appUser(ctx.Actor, string(ctx.ActorCollection)) && !isAdmin(ctx.Actor, string(ctx.ActorCollection)) {
		writeError(ctx.Writer, http.StatusUnauthorized, "authentication required")
		return
	}
	var input struct {
		URL string `json:"url"`
	}
	if decodeJSON(ctx.Request, &input) != nil {
		writeError(ctx.Writer, http.StatusBadRequest, "invalid request")
		return
	}
	target, err := parsePublicURL(input.URL)
	if err != nil {
		writeError(ctx.Writer, http.StatusBadRequest, "invalid URL")
		return
	}
	metadata, err := fetchMetadata(ctx.Request.Context(), target)
	if err != nil {
		writeError(ctx.Writer, http.StatusBadGateway, "could not read page metadata")
		return
	}
	writeJSON(ctx.Writer, http.StatusOK, metadata)
}

func parsePublicURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2048 {
		return nil, errors.New("URL length invalid")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	target, err := url.Parse(raw)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.User != nil {
		return nil, errors.New("unsupported URL")
	}
	host := strings.TrimSuffix(strings.ToLower(target.Hostname()), ".")
	if host == "" || !strings.Contains(host, ".") || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return nil, errors.New("host unavailable")
	}
	port := target.Port()
	if port != "" && port != "80" && port != "443" {
		return nil, errors.New("port unavailable")
	}
	if parsed, err := netip.ParseAddr(host); err == nil && !publicAddress(parsed) {
		return nil, errors.New("address unavailable")
	}
	target.Fragment = ""
	target.Host = host
	if strings.Contains(host, ":") {
		target.Host = "[" + host + "]"
	}
	if port != "" && !((target.Scheme == "http" && port == "80") || (target.Scheme == "https" && port == "443")) {
		target.Host = net.JoinHostPort(host, port)
	}
	return target, nil
}

var blockedAddresses = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"), netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/23"), netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"), netip.MustParsePrefix("3fff::/20"),
	netip.MustParsePrefix("fc00::/7"), netip.MustParsePrefix("fe80::/10"),
}

func publicAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsValid() || !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() {
		return false
	}
	for _, prefix := range blockedAddresses {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

func fetchMetadata(ctx context.Context, initial *url.URL) (pageMetadata, error) {
	return fetchMetadataWithClient(ctx, initial, metadataClient)
}

var metadataSlots = make(chan struct{}, 4)

var metadataClient = func() *http.Client {
	dialer := &net.Dialer{Timeout: 3 * time.Second}
	return newMetadataClient(net.DefaultResolver.LookupNetIP, dialer.DialContext)
}()

// Keep address validation adjacent to the dial. The injected functions let
// tests exercise redirects and DNS changes without contacting public hosts.
func fetchMetadataWithNetwork(ctx context.Context, initial *url.URL, lookup func(context.Context, string, string) ([]netip.Addr, error), dial func(context.Context, string, string) (net.Conn, error)) (pageMetadata, error) {
	client := newMetadataClient(lookup, dial)
	defer client.CloseIdleConnections()
	return fetchMetadataWithClient(ctx, initial, client)
}

func newMetadataClient(lookup func(context.Context, string, string) ([]netip.Addr, error), dial func(context.Context, string, string) (net.Conn, error)) *http.Client {
	transport := &http.Transport{
		Proxy: nil, MaxIdleConns: 16, MaxIdleConnsPerHost: 2, MaxConnsPerHost: 4,
		IdleConnTimeout: 30 * time.Second, TLSHandshakeTimeout: 3 * time.Second,
		ResponseHeaderTimeout: 4 * time.Second, MaxResponseHeaderBytes: 64 << 10,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			addresses, err := publicHostAddresses(ctx, host, lookup)
			if err != nil {
				return nil, err
			}
			return dial(ctx, "tcp", net.JoinHostPort(addresses[0].String(), port))
		},
	}
	return &http.Client{Timeout: 5 * time.Second, Transport: transport, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 3 {
			return errors.New("too many redirects")
		}
		target, err := parsePublicURL(req.URL.String())
		if err != nil {
			return err
		}
		// A redirect may reuse an existing connection. Check DNS on every hop
		// anyway, while DialContext validates the address actually connected.
		_, err = publicHostAddresses(req.Context(), target.Hostname(), lookup)
		return err
	}}
}

func publicHostAddresses(ctx context.Context, host string, lookup func(context.Context, string, string) ([]netip.Addr, error)) ([]netip.Addr, error) {
	addresses, err := lookup(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	if len(addresses) == 0 {
		return nil, errors.New("destination address unavailable")
	}
	for _, ip := range addresses {
		if !publicAddress(ip) {
			return nil, errors.New("destination address unavailable")
		}
	}
	return addresses, nil
}

func fetchMetadataWithClient(ctx context.Context, initial *url.URL, client *http.Client) (pageMetadata, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	select {
	case metadataSlots <- struct{}{}:
		defer func() { <-metadataSlots }()
	case <-ctx.Done():
		return pageMetadata{}, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return pageMetadata{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, initial.String(), nil)
	if err != nil {
		return pageMetadata{}, err
	}
	request.Header.Set("Accept", "text/html")
	request.Header.Set("User-Agent", "QuikmarqMetadata/1.0")
	response, err := client.Do(request)
	if err != nil {
		return pageMetadata{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return pageMetadata{}, errors.New("page request failed")
	}
	contentType := response.Header.Get("Content-Type")
	if contentType != "" && !strings.HasPrefix(strings.ToLower(contentType), "text/html") {
		return pageMetadata{}, errors.New("page is not HTML")
	}
	finalURL, err := parsePublicURL(response.Request.URL.String())
	if err != nil {
		return pageMetadata{}, err
	}
	limited := &io.LimitedReader{R: response.Body, N: 1<<20 + 1}
	var body io.Reader = limited
	if contentType == "" {
		buffered := bufio.NewReaderSize(limited, 512)
		preview, peekErr := buffered.Peek(512)
		if peekErr != nil && !errors.Is(peekErr, io.EOF) {
			return pageMetadata{}, peekErr
		}
		if !strings.HasPrefix(http.DetectContentType(preview), "text/html") {
			return pageMetadata{}, errors.New("page is not HTML")
		}
		body = buffered
	}
	metadata, err := parseHTMLMetadataReader(body, finalURL)
	if err != nil || limited.N == 0 {
		return pageMetadata{}, errors.New("page too large")
	}
	metadata.NormalizedURL = finalURL.String()
	metadata.VideoProvider, metadata.VideoID = videoIdentity(finalURL)
	return metadata, nil
}

var (
	tagPatternStrip = regexp.MustCompile(`(?s)<[^>]*>`)
)

func parseHTMLMetadata(body string, page *url.URL) pageMetadata {
	metadata, _ := parseHTMLMetadataReader(strings.NewReader(body), page)
	return metadata
}

func parseHTMLMetadataReader(body io.Reader, page *url.URL) (pageMetadata, error) {
	metadata := pageMetadata{}
	seenTitle := false
	ogTitle := false
	inTitle := false
	var title strings.Builder
	tokenizer := xhtml.NewTokenizer(body)
	tokenizer.SetMaxBuf(1<<20 + 1)
	for {
		switch tokenizer.Next() {
		case xhtml.ErrorToken:
			if err := tokenizer.Err(); err != nil && !errors.Is(err, io.EOF) {
				return pageMetadata{}, err
			}
			if metadata.Favicon == "" {
				metadata.Favicon = page.Scheme + "://" + page.Host + "/favicon.ico"
			}
			return metadata, nil
		case xhtml.TextToken:
			if inTitle {
				title.Write(tokenizer.Raw())
			}
		case xhtml.EndTagToken:
			if !inTitle || !metadataTagPrefix(tokenizer.Raw(), "</title") {
				continue
			}
			name, _ := tokenizer.TagName()
			if bytes.Equal(name, []byte("title")) {
				if !ogTitle {
					metadata.Title = cleanText(title.String())
				}
				seenTitle = true
				inTitle = false
				title.Reset()
			}
		case xhtml.StartTagToken, xhtml.SelfClosingTagToken:
			raw := tokenizer.Raw()
			if !metadataTagPrefix(raw, "<title") && !metadataTagPrefix(raw, "<meta") && !metadataTagPrefix(raw, "<link") {
				continue
			}
			name, hasAttributes := tokenizer.TagName()
			if bytes.Equal(name, []byte("title")) && !seenTitle {
				inTitle = true
				continue
			}
			if !hasAttributes || (!bytes.Equal(name, []byte("meta")) && !bytes.Equal(name, []byte("link"))) {
				continue
			}
			var attributeName, property, content, rel, href []byte
			for more := hasAttributes; more; {
				key, value, next := tokenizer.TagAttr()
				more = next
				switch string(key) {
				case "name":
					attributeName = value
				case "property":
					property = value
				case "content":
					content = value
				case "rel":
					rel = value
				case "href":
					href = value
				}
			}
			switch {
			case bytes.EqualFold(property, []byte("og:title")) && len(content) != 0:
				metadata.Title = cleanText(string(content))
				ogTitle = true
			case (bytes.EqualFold(property, []byte("og:description")) || bytes.EqualFold(attributeName, []byte("description"))) && metadata.Description == "":
				metadata.Description = cleanText(string(content))
			case bytes.EqualFold(property, []byte("og:image")) && metadata.PreviewImage == "":
				metadata.PreviewImage = resolvedMediaURL(page, string(content))
			case strings.Contains(strings.ToLower(string(rel)), "icon") && metadata.Favicon == "":
				metadata.Favicon = resolvedMediaURL(page, string(href))
			}
		}
	}
}

func metadataTagPrefix(raw []byte, prefix string) bool {
	if len(raw) <= len(prefix) || !bytes.EqualFold(raw[:len(prefix)], []byte(prefix)) {
		return false
	}
	switch raw[len(prefix)] {
	case ' ', '\t', '\n', '\r', '\f', '/', '>':
		return true
	default:
		return false
	}
}

func cleanText(value string) string {
	value = html.UnescapeString(tagPatternStrip.ReplaceAllString(value, ""))
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > 1000 {
		value = value[:1000]
	}
	return value
}

func resolvedMediaURL(page *url.URL, raw string) string {
	ref, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	resolved := page.ResolveReference(ref)
	if _, err := parsePublicURL(resolved.String()); err != nil {
		return ""
	}
	return resolved.String()
}

func videoIdentity(page *url.URL) (string, string) {
	host := strings.TrimPrefix(strings.ToLower(page.Hostname()), "www.")
	switch host {
	case "youtube.com", "m.youtube.com":
		id := page.Query().Get("v")
		if id == "" {
			parts := strings.Split(strings.Trim(page.Path, "/"), "/")
			if len(parts) == 2 && (parts[0] == "shorts" || parts[0] == "embed") {
				id = parts[1]
			}
		}
		if validVideoID(id, 11) {
			return "youtube", id
		}
	case "youtu.be":
		id := strings.Trim(page.Path, "/")
		if validVideoID(id, 11) {
			return "youtube", id
		}
	case "vimeo.com", "player.vimeo.com":
		parts := strings.Split(strings.Trim(page.Path, "/"), "/")
		id := parts[len(parts)-1]
		if id != "" && len(id) <= 20 && strings.Trim(id, "0123456789") == "" {
			return "vimeo", id
		}
	}
	return "", ""
}

func validVideoID(id string, length int) bool {
	if len(id) != length {
		return false
	}
	for _, character := range id {
		if !((character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '-' || character == '_') {
			return false
		}
	}
	return true
}
