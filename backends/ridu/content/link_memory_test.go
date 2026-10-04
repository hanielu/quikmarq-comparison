package content

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/riducms/ridu"
	"github.com/riducms/ridu/adapters/sqlite"
	localstorage "github.com/riducms/ridu/adapters/storage/local"
	"github.com/riducms/ridu/query"
	"github.com/riducms/ridu/store"
	"modernc.org/libc"
)

// Run one case per fresh go test process. Example:
// LINK_MEMORY_CASE=full-5-small go test ./content -run '^TestLinkMemoryProfile$' -count=1 -v
// The opt-in test reports process-local Go heap metrics; it does not model SvelteKit memory.
func TestLinkMemoryProfile(t *testing.T) {
	name := os.Getenv("LINK_MEMORY_CASE")
	if name == "" {
		t.Skip("set LINK_MEMORY_CASE to opt in")
	}
	iterations := 100
	if raw := os.Getenv("LINK_MEMORY_ITERATIONS"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 1000 {
			t.Fatalf("invalid LINK_MEMORY_ITERATIONS %q", raw)
		}
		iterations = parsed
	}
	parts := strings.Split(name, "-")
	if len(parts) < 2 {
		t.Fatalf("invalid case %q", name)
	}
	phase := parts[0]
	groupCount := 0
	if phase != "metadata" {
		var err error
		groupCount, err = strconv.Atoi(parts[1])
		if err != nil || (groupCount != 1 && groupCount != 5) {
			t.Fatalf("invalid group count in %q", name)
		}
	}
	large := parts[len(parts)-1] == "large"
	switch phase {
	case "metadata":
		if len(parts) != 2 || (parts[1] != "small" && parts[1] != "large") {
			t.Fatalf("invalid metadata case %q", name)
		}
	case "crud":
		if len(parts) != 2 || groupCount != 1 {
			t.Fatalf("invalid CRUD case %q", name)
		}
	case "full", "rest", "targeted", "targetedrest":
		if len(parts) != 3 || (parts[2] != "small" && parts[2] != "large") {
			t.Fatalf("invalid workflow case %q", name)
		}
	default:
		t.Fatalf("unknown case %q", name)
	}

	body := `<html><head><title>Fixture</title><meta property="og:title" content="Fixture title"><meta name="description" content="Fixture description"><link rel="icon" href="/icon.png"></head><body>fixture</body></html>`
	if large {
		body = strings.Replace(body, "fixture</body>", strings.Repeat("a", (1<<20)-len(body)-64)+"</body>", 1)
	}
	var app *ridu.App
	var owner store.Document
	var groups []store.Document
	if phase != "metadata" {
		app, owner, groups = linkMemoryFixture(t, groupCount)
	}
	ctx := context.Background()
	var handler http.Handler
	var session ridu.AuthSession
	var httpRequests atomic.Int32
	if phase == "rest" || phase == "targetedrest" {
		handler = app.Handler(ridu.HandlerOptions{})
		var loginErr error
		session, loginErr = app.Login(ctx, "users", "memory@example.test", "memory-fixture-password")
		if loginErr != nil {
			t.Fatal(loginErr)
		}
	}
	// The fake connection is reached only after the production public-address
	// and redirect checks. This keeps every metadata read deterministic and offline.
	public := netip.MustParseAddr("8.8.8.8")
	lookup := func(context.Context, string, string) ([]netip.Addr, error) { return []netip.Addr{public}, nil }
	var dials atomic.Int32
	dial := metadataPipeDial(func(*http.Request) string {
		return metadataResponse("200 OK", "text/html", body)
	}, &dials)
	target, err := parsePublicURL("http://example.test/link")
	if err != nil {
		t.Fatal(err)
	}
	readMetadata := func() pageMetadata {
		metadata, err := fetchMetadataWithNetwork(ctx, target, lookup, dial)
		if err != nil {
			t.Fatal(err)
		}
		if metadata.Title != "Fixture title" {
			t.Fatalf("metadata title = %q", metadata.Title)
		}
		return metadata
	}
	createBookmark := func(metadata pageMetadata) store.Document {
		bookmark, err := app.Local().Create(ctx, "bookmarks", store.Values{
			"owner": store.String(owner.ID), "group": store.String(groups[0].ID),
			"kind": store.String("link"), "position": store.String("0"),
			"url": store.String(metadata.NormalizedURL), "title": store.String(metadata.Title),
			"description": store.String(metadata.Description), "favicon": store.String(metadata.Favicon),
		}, ridu.MutationOptions{Actor: &owner, ActorCollection: "users"})
		if err != nil {
			t.Fatal(err)
		}
		return bookmark
	}
	deleteBookmark := func(bookmark store.Document) {
		if _, err := app.Local().Delete(ctx, "bookmarks", bookmark.ID, ridu.MutationOptions{Actor: &owner, ActorCollection: "users"}); err != nil {
			t.Fatal(err)
		}
	}
	restSaveAndReconcile := func(metadata pageMetadata, targeted bool) {
		request := func(method, path, body string) ([]byte, error) {
			httpRequest := httptest.NewRequest(method, "http://memory.test"+path, strings.NewReader(body))
			httpRequest.AddCookie(&http.Cookie{Name: "ridu_session", Value: session.Token})
			if body != "" {
				httpRequest.Header.Set("Content-Type", "application/json")
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httpRequest)
			httpRequests.Add(1)
			if recorder.Code < 200 || recorder.Code >= 300 {
				return nil, fmt.Errorf("%s %s: HTTP %d: %s", method, path, recorder.Code, recorder.Body.String())
			}
			return recorder.Body.Bytes(), nil
		}
		mustRequest := func(method, path, body string) []byte {
			result, err := request(method, path, body)
			if err != nil {
				t.Fatal(err)
			}
			return result
		}
		encoded, err := json.Marshal(map[string]string{
			"owner": owner.ID, "group": groups[0].ID, "kind": "link", "position": "0",
			"url": metadata.NormalizedURL, "title": metadata.Title,
			"description": metadata.Description, "favicon": metadata.Favicon,
		})
		if err != nil {
			t.Fatal(err)
		}
		created := mustRequest(http.MethodPost, "/api/collections/bookmarks", string(encoded))
		var envelope struct {
			Doc struct {
				ID string `json:"id"`
			} `json:"doc"`
		}
		if err := json.Unmarshal(created, &envelope); err != nil || envelope.Doc.ID == "" {
			t.Fatalf("decode created bookmark: %v: %s", err, created)
		}
		// The page and workspace remote queries refresh in parallel. Each query
		// chains its own auth/read operations, while workspace counts fan out.
		var refreshes sync.WaitGroup
		refreshErrors := make(chan error, len(groups)+4)
		refreshes.Add(2)
		go func() {
			defer refreshes.Done()
			if _, err := request(http.MethodGet, "/api/auth/me", ""); err != nil {
				refreshErrors <- err
				return
			}
			groupFilter := url.QueryEscape(fmt.Sprintf(`{"and":[{"id":{"equals":%q}},{"owner":{"equals":%q}}]}`, groups[0].ID, owner.ID))
			if _, err := request(http.MethodGet, "/api/collections/groups?limit=1&where="+groupFilter, ""); err != nil {
				refreshErrors <- err
				return
			}
			bookmarkFilter := url.QueryEscape(fmt.Sprintf(`{"group":{"equals":%q}}`, groups[0].ID))
			if _, err := request(http.MethodGet, "/api/collections/bookmarks?limit=24&sort=-position&sort=-createdAt&where="+bookmarkFilter, ""); err != nil {
				refreshErrors <- err
			}
		}()
		go func() {
			defer refreshes.Done()
			if _, err := request(http.MethodGet, "/api/auth/me", ""); err != nil {
				refreshErrors <- err
				return
			}
			if !targeted {
				ownerFilter := url.QueryEscape(fmt.Sprintf(`{"owner":{"equals":%q}}`, owner.ID))
				if _, err := request(http.MethodGet, "/api/collections/groups?limit=100&sort=rank&sort=createdAt&where="+ownerFilter, ""); err != nil {
					refreshErrors <- err
					return
				}
			}
			var counts sync.WaitGroup
			for _, group := range groups {
				counts.Add(1)
				go func(groupID string) {
					defer counts.Done()
					filter := url.QueryEscape(fmt.Sprintf(`{"group":{"equals":%q}}`, groupID))
					if _, err := request(http.MethodGet, "/api/collections/bookmarks/count?where="+filter, ""); err != nil {
						refreshErrors <- err
					}
				}(group.ID)
				if targeted {
					break
				}
			}
			counts.Wait()
		}()
		refreshes.Wait()
		close(refreshErrors)
		for err := range refreshErrors {
			t.Error(err)
		}
		if t.Failed() {
			t.FailNow()
		}
		mustRequest(http.MethodDelete, "/api/collections/bookmarks/"+url.PathEscape(envelope.Doc.ID), "")
	}
	// Warm the case and all lazily allocated query/store paths before sampling.
	for i := 0; i < 2; i++ {
		switch phase {
		case "metadata":
			readMetadata()
		case "crud":
			deleteBookmark(createBookmark(pageMetadata{NormalizedURL: target.String(), Title: "Fixture title"}))
		case "full":
			metadata := readMetadata()
			bookmark := createBookmark(metadata)
			linkMemoryReconcile(t, app, &owner, groups, false)
			deleteBookmark(bookmark)
		case "rest":
			restSaveAndReconcile(readMetadata(), false)
		case "targeted":
			metadata := readMetadata()
			bookmark := createBookmark(metadata)
			linkMemoryReconcile(t, app, &owner, groups, true)
			deleteBookmark(bookmark)
		case "targetedrest":
			restSaveAndReconcile(readMetadata(), true)
		}
	}
	before := linkMemorySnapshot()
	beforeHTTPRequests := httpRequests.Load()
	for i := 0; i < iterations; i++ {
		switch phase {
		case "metadata":
			readMetadata()
		case "crud":
			deleteBookmark(createBookmark(pageMetadata{NormalizedURL: target.String(), Title: "Fixture title"}))
		case "full":
			metadata := readMetadata()
			bookmark := createBookmark(metadata)
			linkMemoryReconcile(t, app, &owner, groups, false)
			deleteBookmark(bookmark)
		case "rest":
			restSaveAndReconcile(readMetadata(), false)
		case "targeted":
			metadata := readMetadata()
			bookmark := createBookmark(metadata)
			linkMemoryReconcile(t, app, &owner, groups, true)
			deleteBookmark(bookmark)
		case "targetedrest":
			restSaveAndReconcile(readMetadata(), true)
		}
	}
	after := linkMemorySnapshot()
	result := map[string]any{
		"case": name, "iterations": iterations, "groups": groupCount,
		"html_bytes": len(body), "metadata_dials": dials.Load(),
		"http_requests":                 httpRequests.Load() - beforeHTTPRequests,
		"allocated_bytes":               after.totalAlloc - before.totalAlloc,
		"allocated_bytes_per_iteration": (after.totalAlloc - before.totalAlloc) / uint64(iterations),
		"live_heap_bytes_before":        before.heapAlloc, "live_heap_bytes_after": after.heapAlloc,
		"live_heap_delta_bytes": int64(after.heapAlloc) - int64(before.heapAlloc),
		"gc_cycles":             after.numGC - before.numGC,
		"goroutines_before":     before.goroutines, "goroutines_after": after.goroutines,
	}
	// `-tags memory.counters` enables modernc's test-only allocator gauges.
	// These gauge requested mmap bytes in its allocator, not process RSS.
	if before.nativeBytes != 0 || after.nativeBytes != 0 {
		result["modernc_allocator_bytes_before"] = before.nativeBytes
		result["modernc_allocator_bytes_after"] = after.nativeBytes
		result["modernc_allocator_delta_bytes"] = after.nativeBytes - before.nativeBytes
		result["modernc_allocator_mmaps_before"] = before.nativeMmaps
		result["modernc_allocator_mmaps_after"] = after.nativeMmaps
		result["modernc_allocator_allocs_before"] = before.nativeAllocs
		result["modernc_allocator_allocs_after"] = after.nativeAllocs
	}
	if before.rssBytes != 0 && after.rssBytes != 0 {
		result["linux_rss_bytes_before"] = before.rssBytes
		result["linux_rss_bytes_after"] = after.rssBytes
		result["linux_rss_delta_bytes"] = int64(after.rssBytes) - int64(before.rssBytes)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("LINK_MEMORY_RESULT %s", encoded)
	runtime.KeepAlive(readMetadata)
	runtime.KeepAlive(dial)
	runtime.KeepAlive(body)
	runtime.KeepAlive(app)
	runtime.KeepAlive(groups)
	runtime.KeepAlive(handler)
	runtime.KeepAlive(session)
}

type linkMemoryStats struct {
	heapAlloc, totalAlloc uint64
	numGC                 uint32
	goroutines            int
	nativeBytes           int
	nativeMmaps           int
	nativeAllocs          int
	rssBytes              uint64
}

func linkMemorySnapshot() linkMemoryStats {
	runtime.GC()
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	native := libc.MemStat()
	return linkMemoryStats{
		heapAlloc: stats.HeapAlloc, totalAlloc: stats.TotalAlloc,
		numGC: stats.NumGC, goroutines: runtime.NumGoroutine(),
		nativeBytes: native.Bytes, nativeMmaps: native.Mmaps, nativeAllocs: native.Allocs,
		rssBytes: linkMemoryLinuxRSS(),
	}
}

func linkMemoryLinuxRSS() uint64 {
	if runtime.GOOS != "linux" {
		return 0
	}
	status, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(status), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 3 || fields[2] != "kB" {
			return 0
		}
		kilobytes, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0
		}
		return kilobytes * 1024
	}
	return 0
}

func linkMemoryFixture(t *testing.T, groupCount int) (*ridu.App, store.Document, []store.Document) {
	t.Helper()
	ctx := context.Background()
	directory := t.TempDir()
	backend, err := sqlite.Open(ctx, filepath.Join(directory, "memory.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	storage, err := localstorage.New(filepath.Join(directory, "uploads"))
	if err != nil {
		t.Fatal(err)
	}
	config := Config()
	config.Storage = storage
	manifest, err := ridu.Resolve(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := backend.Migrate(ctx, manifest); err != nil {
		t.Fatal(err)
	}
	app, err := ridu.New(config, backend)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := app.CreateAuthUser(ctx, "users", store.Values{
		"email": store.String("memory@example.test"), "displayName": store.String("Memory owner"),
	}, "memory-fixture-password", ridu.MutationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	page, err := app.Local().List(ctx, "groups", ridu.ListOptions{
		Where: query.Equal("owner", owner.ID), Limit: 100, Actor: &owner, ActorCollection: "users",
	})
	if err != nil || len(page.Documents) != 1 {
		t.Fatalf("initial group: %v, docs = %d", err, len(page.Documents))
	}
	groups := append([]store.Document(nil), page.Documents...)
	for index := 1; index < groupCount; index++ {
		group, err := app.Local().Create(ctx, "groups", store.Values{
			"owner": store.String(owner.ID), "name": store.String(fmt.Sprintf("Group %d", index)),
			"rank": store.String(fmt.Sprintf("%032x", index)),
		}, ridu.MutationOptions{Actor: &owner, ActorCollection: "users"})
		if err != nil {
			t.Fatal(err)
		}
		groups = append(groups, group)
	}
	return app, owner, groups
}

// The modeled post-save data reconciliation uses the same authorized Local API
// operation engine as REST. Both shapes cover the page's group check/bookmark
// list. The old shape reloads groups and all counts; targeted reads one count.
// This excludes SvelteKit and HTTP encoding.
func linkMemoryReconcile(t *testing.T, app *ridu.App, owner *store.Document, groups []store.Document, targeted bool) {
	t.Helper()
	ctx := context.Background()
	identity := ridu.ListOptions{Actor: owner, ActorCollection: "users"}
	pageGroup := identity
	pageGroup.Where = query.And(query.Equal("id", groups[0].ID), query.Equal("owner", owner.ID))
	pageGroup.Limit = 1
	if _, err := app.Local().List(ctx, "groups", pageGroup); err != nil {
		t.Fatal(err)
	}
	bookmarks := identity
	bookmarks.Where = query.Equal("group", groups[0].ID)
	bookmarks.Limit = 24
	bookmarks.Sort = []query.Sort{query.Desc("position"), query.Desc("createdAt")}
	if _, err := app.Local().List(ctx, "bookmarks", bookmarks); err != nil {
		t.Fatal(err)
	}
	if !targeted {
		workspace := identity
		workspace.Where = query.Equal("owner", owner.ID)
		workspace.Limit = 100
		workspace.Sort = []query.Sort{query.Asc("rank"), query.Asc("createdAt")}
		if _, err := app.Local().List(ctx, "groups", workspace); err != nil {
			t.Fatal(err)
		}
	}
	for _, group := range groups {
		count := identity
		count.Where = query.Equal("group", group.ID)
		count.Limit = 1
		if _, err := app.Local().List(ctx, "bookmarks", count); err != nil {
			t.Fatal(err)
		}
		if targeted {
			break
		}
	}
}
