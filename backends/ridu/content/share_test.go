package content

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/riducms/ridu/adapters/storage/local"
	"github.com/riducms/ridu/storage"
	"github.com/riducms/ridu/store"
)

type signedURLStorage struct {
	storage.Backend
	called bool
}

func (backend *signedURLStorage) SignedURL(context.Context, string, time.Duration) (string, error) {
	backend.called = true
	return "https://storage.example.test/direct", nil
}

func TestShareCapabilitiesContainNoOwnerAndRevokeOnStateChange(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef")
	group := store.Document{ID: "group-1", Values: store.Values{
		"owner":          store.String("private-owner-id"),
		"sharingEnabled": store.Boolean(true),
		"shareVersion":   store.Number(3),
	}}
	claims := claimsForGroup(group)
	if !shareIsCurrent(group, claims) {
		t.Fatal("new share token is not current")
	}
	shareToken, err := signShare(claims, secret)
	if err != nil {
		t.Fatal(err)
	}
	backend, err := local.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	signer := &signedURLStorage{Backend: backend}
	previous := configuredShareStorage()
	ConfigureShareStorage(signer)
	t.Cleanup(func() { ConfigureShareStorage(previous) })
	mediaURL, err := sharedMediaURL(context.Background(), claims, "asset-1", "ridu/quikmarq/objects/asset-1/image.jpg", secret)
	if err != nil {
		t.Fatal(err)
	}
	if signer.called || !strings.HasPrefix(mediaURL, "/api/share/media/") {
		t.Fatalf("media URL bypasses revocation handler: %q, signer called = %v", mediaURL, signer.called)
	}
	mediaToken := strings.TrimPrefix(mediaURL, "/api/share/media/")
	media, valid := verifyMedia(mediaToken, secret)
	if !valid || media.shareClaims != claims {
		t.Fatalf("media claims = %#v, valid = %v", media, valid)
	}
	for _, token := range []string{shareToken, mediaToken} {
		payload, err := base64.RawURLEncoding.DecodeString(strings.Split(token, ".")[0])
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if err := json.Unmarshal(payload, &fields); err != nil {
			t.Fatal(err)
		}
		if _, ok := fields["o"]; ok || strings.Contains(string(payload), "private-owner-id") {
			t.Fatalf("capability exposes owner: %s", payload)
		}
	}
	group.Values["sharingEnabled"] = store.Boolean(false)
	if shareIsCurrent(group, claims) {
		t.Fatal("disabled share remained current")
	}
	group.Values["sharingEnabled"] = store.Boolean(true)
	group.Values["shareVersion"] = store.Number(4)
	if shareIsCurrent(group, claims) {
		t.Fatal("rotated share remained current")
	}
	if _, err := sharedMediaURL(context.Background(), claims, "asset-1", "other-prefix/image.jpg", secret); err == nil {
		t.Fatal("signed a key outside the upload object namespace")
	}
}
