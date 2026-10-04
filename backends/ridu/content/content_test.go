package content

import (
	"context"
	"net/netip"
	"net/url"
	"testing"

	"github.com/riducms/ridu"
	"github.com/riducms/ridu/field"
	"github.com/riducms/ridu/operation"
	"github.com/riducms/ridu/schema"
	"github.com/riducms/ridu/store"
)

func TestConfigResolves(t *testing.T) {
	if _, err := ridu.Resolve(Config()); err != nil {
		t.Fatal(err)
	}
}

func TestShareTokenIntegrity(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef")
	claims := shareClaims{Group: "g1", Version: 2}
	token, err := signShare(claims, secret)
	if err != nil {
		t.Fatal(err)
	}
	decoded, valid := verifyShare(token, secret)
	if !valid || decoded != claims {
		t.Fatalf("token did not round trip: %#v %v", decoded, valid)
	}
	for _, altered := range []string{token + "x", token[:len(token)-1] + "x", "invalid"} {
		if _, valid := verifyShare(altered, secret); valid {
			t.Fatalf("accepted altered token %q", altered)
		}
	}
	media := mediaClaims{shareClaims: claims, Asset: "a1", Key: "ridu/quikmarq/objects/a1/photo.jpg", Expires: 9999999999}
	mediaToken, err := signMedia(media, secret)
	if err != nil {
		t.Fatal(err)
	}
	decodedMedia, valid := verifyMedia(mediaToken, secret)
	if !valid || decodedMedia != media {
		t.Fatalf("media token did not round trip: %#v %v", decodedMedia, valid)
	}
}

func TestOwnershipRules(t *testing.T) {
	owner := &store.Document{ID: "user-1"}
	other := &store.Document{ID: "user-2"}
	rule := ownRecords("owner")
	for _, test := range []struct {
		actor      *store.Document
		collection string
		want       ridu.AccessDecisionKind
	}{
		{nil, "", ridu.AccessDeny},
		{other, "admins", ridu.AccessAllow},
		{owner, "users", ridu.AccessWhere},
	} {
		decision, err := rule(ridu.AccessContext{Actor: test.actor, ActorCollection: schema.CollectionSlug(test.collection)})
		if err != nil || decision.Kind() != test.want {
			t.Fatalf("access = %v, %v; want %s", decision.Kind(), err, test.want)
		}
	}
	if err := mustOwner(ridu.HookContext{Context: context.Background(), Operation: operation.Create, Actor: owner, ActorCollection: "users", Data: store.Values{"owner": store.String("user-2")}}); err == nil {
		t.Fatal("accepted forged owner")
	}
	values := store.Values{}
	if err := mustOwner(ridu.HookContext{Context: context.Background(), Operation: operation.Create, Actor: owner, ActorCollection: "users", Data: values}); err != nil {
		t.Fatal(err)
	}
	if got, _ := values["owner"].StringValue(); got != "user-1" {
		t.Fatalf("owner = %q", got)
	}
	if err := mustOwner(ridu.HookContext{Operation: operation.Read}); err != nil {
		t.Fatalf("read hook should not mutate: %v", err)
	}
	if err := mustOwner(ridu.HookContext{Operation: operation.Publish, Actor: owner, ActorCollection: "users", Original: &store.Document{Values: store.Values{"owner": store.String("user-1")}}, Data: store.Values{"owner": store.String("user-2")}}); err == nil {
		t.Fatal("accepted owner change during publish")
	}
}

func TestPublicUsersAreSelfOnlyEvenForAdmins(t *testing.T) {
	rule := selfRecords("id")
	for _, test := range []struct {
		actor      *store.Document
		collection schema.CollectionSlug
		want       ridu.AccessDecisionKind
	}{
		{&store.Document{ID: "admin-1"}, "admins", ridu.AccessDeny},
		{&store.Document{ID: "user-1"}, "users", ridu.AccessWhere},
		{nil, "", ridu.AccessDeny},
	} {
		decision, err := rule(ridu.AccessContext{Actor: test.actor, ActorCollection: test.collection})
		if err != nil || decision.Kind() != test.want {
			t.Fatalf("self access = %s, %v; want %s", decision.Kind(), err, test.want)
		}
	}
}

func TestMetadataSafetyAndParsing(t *testing.T) {
	for _, blocked := range []string{"http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://192.0.2.1/", "http://198.51.100.1/", "http://203.0.113.1/", "http://[2001:db8::1]/", "http://localhost/", "file:///etc/passwd", "http://example.com:8080/"} {
		if _, err := parsePublicURL(blocked); err == nil {
			t.Errorf("accepted blocked URL %q", blocked)
		}
	}
	if publicAddress(netip.MustParseAddr("::ffff:127.0.0.1")) {
		t.Fatal("accepted IPv4-mapped loopback")
	}
	if !publicAddress(netip.MustParseAddr("1.1.1.1")) {
		t.Fatal("blocked public address")
	}
	page, _ := url.Parse("https://example.com/path/page")
	metadata := parseHTMLMetadata(`<title>Fallback</title><meta property="og:title" content="&quot;Title&quot;"><meta name="description" content="Hello"><meta property="og:image" content="/image.jpg"><link rel="icon" href="../icon.png">`, page)
	if metadata.Title != `"Title"` || metadata.Description != "Hello" || metadata.PreviewImage != "https://example.com/image.jpg" || metadata.Favicon != "https://example.com/icon.png" {
		t.Fatalf("unexpected metadata %#v", metadata)
	}
}

func TestServerOwnedBookmarkPosition(t *testing.T) {
	created := store.Values{"position": store.String("client"), "group": store.String("g1")}
	if err := assignPosition(ridu.HookContext{Operation: operation.Create, Data: created}); err != nil {
		t.Fatal(err)
	}
	first, _ := created["position"].StringValue()
	if first == "client" || !positionPattern.MatchString(first) {
		t.Fatalf("created position = %q", first)
	}
	old := &store.Document{Values: store.Values{"position": store.String(first), "group": store.String("g1")}}
	edited := store.Values{"position": store.String("forged"), "group": store.String("g1")}
	if err := assignPosition(ridu.HookContext{Operation: operation.Publish, Original: old, Data: edited}); err != nil {
		t.Fatal(err)
	}
	if got, _ := edited["position"].StringValue(); got != first {
		t.Fatalf("edit position = %q", got)
	}
	moved := store.Values{"position": store.String("forged"), "group": store.String("g2")}
	if err := assignPosition(ridu.HookContext{Operation: operation.Publish, Original: old, Data: moved}); err != nil {
		t.Fatal(err)
	}
	if got, _ := moved["position"].StringValue(); got <= first {
		t.Fatalf("move position = %q, want after %q", got, first)
	}
}

func TestDetachedImageSet(t *testing.T) {
	ids := bookmarkImageIDs(store.Values{"images": store.List(store.String("a"), store.String("b"), store.String("a"))})
	if len(ids) != 2 {
		t.Fatalf("IDs = %#v", ids)
	}
}

func TestInitialGroupRankHasFixedWidth(t *testing.T) {
	if len(initialGroupRank) != 32 || !groupRankPattern.MatchString(initialGroupRank) {
		t.Fatalf("initial group rank = %q", initialGroupRank)
	}
}

func TestGroupRanksRequireFrontendCompatibleWidth(t *testing.T) {
	for _, value := range []string{"short", "hzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz0", "Hzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"} {
		issues, err := validateGroupRank(operation.Context{}, operation.Present(value))
		if err != nil || len(issues) == 0 {
			t.Fatalf("accepted invalid group rank %q: %#v, %v", value, issues, err)
		}
	}
	issues, err := validateGroupRank(operation.Context{}, operation.Present(initialGroupRank))
	if err != nil || len(issues) != 0 {
		t.Fatalf("rejected valid group rank: %#v, %v", issues, err)
	}
}

func TestBookmarkPositionAllowsServerKeysWithoutWeakeningGroupRank(t *testing.T) {
	for _, position := range []string{"0", nextPosition(), "abc123"} {
		issues, err := validatePosition(operation.Context{}, operation.Present(position))
		if err != nil || len(issues) != 0 {
			t.Fatalf("rejected position %q: %#v, %v", position, issues, err)
		}
		if groupRankPattern.MatchString(position) {
			t.Fatalf("position %q unexpectedly satisfies fixed-width group rank", position)
		}
	}
	for _, position := range []string{"Uppercase", "with space", "\x00"} {
		issues, err := validatePosition(operation.Context{}, operation.Present(position))
		if err != nil || len(issues) == 0 {
			t.Fatalf("accepted invalid position %q: %#v, %v", position, issues, err)
		}
	}
}

func TestGroupMutationFieldIsHookOnly(t *testing.T) {
	policy := field.Snapshot(Users.Fields[2]).AccessPolicy()
	for _, rule := range []field.AccessRule{policy.Create, policy.Read, policy.Update} {
		allowed, err := rule(operation.Context{Context: context.Background()})
		if err != nil || allowed {
			t.Fatalf("public field access = %v, %v", allowed, err)
		}
	}
	allowed, err := policy.Update(operation.Context{Context: context.WithValue(context.Background(), groupMutationKey{}, true)})
	if err != nil || !allowed {
		t.Fatalf("hook field access = %v, %v", allowed, err)
	}
}

func TestShareStateChangesOnlyThroughEndpointContext(t *testing.T) {
	original := &store.Document{Values: store.Values{
		"sharingEnabled": store.Boolean(false),
		"shareVersion":   store.Number(1),
	}}
	change := ridu.HookContext{
		Context:         context.Background(),
		Operation:       operation.Publish,
		Actor:           &store.Document{ID: "admin"},
		ActorCollection: "admins",
		Original:        original,
		Data: store.Values{
			"sharingEnabled": store.Boolean(true),
			"shareVersion":   store.Number(1),
		},
	}
	if err := guardShareFields(change); err == nil {
		t.Fatal("admin bypassed versioned share endpoint")
	}
	change.Context = context.WithValue(context.Background(), shareMutationKey{}, true)
	if err := guardShareFields(change); err != nil {
		t.Fatalf("share endpoint mutation was rejected: %v", err)
	}
}

func TestAssetGroupChangesRequireStorageAwareDuplicate(t *testing.T) {
	original := &store.Document{Values: store.Values{"group": store.String("old")}}
	change := ridu.HookContext{Original: original, Data: store.Values{"group": store.String("new")}}
	change.Operation = operation.Update
	if err := guardAssetGroup(change); err == nil {
		t.Fatal("accepted in-place asset group move")
	}
	change.Operation = operation.Duplicate
	if err := guardAssetGroup(change); err != nil {
		t.Fatalf("rejected storage-aware duplicate: %v", err)
	}
}
