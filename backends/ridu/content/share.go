package content

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/riducms/ridu"
	"github.com/riducms/ridu/query"
	"github.com/riducms/ridu/storage"
	"github.com/riducms/ridu/store"
)

type shareMutationKey struct{}

var shareStorage struct {
	sync.RWMutex
	backend storage.Backend
}

// ConfigureShareStorage installs the same runtime backend used by Ridu uploads.
// It is intentionally separate from Config so generation stays side-effect free.
func ConfigureShareStorage(backend storage.Backend) {
	shareStorage.Lock()
	shareStorage.backend = backend
	shareStorage.Unlock()
}

func configuredShareStorage() storage.Backend {
	shareStorage.RLock()
	defer shareStorage.RUnlock()
	return shareStorage.backend
}

type shareClaims struct {
	Group   string `json:"g"`
	Version int64  `json:"v"`
}

type mediaClaims struct {
	shareClaims
	Asset   string `json:"a"`
	Key     string `json:"k"`
	Expires int64  `json:"e"`
}

func shareEndpoints() []ridu.Endpoint {
	return []ridu.Endpoint{
		{Method: "GET", Path: "/:id/share", Summary: "Get group sharing status", Handler: shareStatus},
		{Method: "POST", Path: "/:id/share", Summary: "Enable or rotate group sharing", MaxBodyBytes: 512, Handler: shareEnable},
		{Method: "DELETE", Path: "/:id/share", Summary: "Disable group sharing", Handler: shareDisable},
	}
}

func shareSecret() ([]byte, error) {
	secret := []byte(os.Getenv("QUIKMARQ_SHARE_SECRET"))
	if len(secret) < 32 {
		return nil, errors.New("QUIKMARQ_SHARE_SECRET must contain at least 32 bytes")
	}
	return secret, nil
}

func signShare(claims shareClaims, secret []byte) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func verifyShare(token string, secret []byte) (shareClaims, bool) {
	var claims shareClaims
	if len(token) > 1024 {
		return claims, false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return claims, false
	}
	payload, err1 := base64.RawURLEncoding.DecodeString(parts[0])
	signature, err2 := base64.RawURLEncoding.DecodeString(parts[1])
	if err1 != nil || err2 != nil || len(signature) != sha256.Size {
		return claims, false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return claims, false
	}
	if json.Unmarshal(payload, &claims) != nil || claims.Group == "" || claims.Version <= 0 {
		return shareClaims{}, false
	}
	canonical, _ := json.Marshal(claims)
	if !hmac.Equal(payload, canonical) {
		return shareClaims{}, false
	}
	return claims, true
}

func signMedia(claims mediaClaims, secret []byte) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func verifyMedia(token string, secret []byte) (mediaClaims, bool) {
	var claims mediaClaims
	if len(token) > 4096 {
		return claims, false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return claims, false
	}
	payload, err1 := base64.RawURLEncoding.DecodeString(parts[0])
	signature, err2 := base64.RawURLEncoding.DecodeString(parts[1])
	if err1 != nil || err2 != nil || len(signature) != sha256.Size {
		return claims, false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return claims, false
	}
	if json.Unmarshal(payload, &claims) != nil || claims.Group == "" || claims.Version <= 0 || claims.Asset == "" || claims.Key == "" || claims.Expires <= time.Now().Unix() {
		return mediaClaims{}, false
	}
	canonical, _ := json.Marshal(claims)
	if !hmac.Equal(payload, canonical) {
		return mediaClaims{}, false
	}
	return claims, true
}

func shareGroup(ctx ridu.EndpointContext) (store.Document, bool) {
	if ctx.Actor == nil || (ctx.ActorCollection != "users" && ctx.ActorCollection != "admins") {
		writeError(ctx.Writer, http.StatusUnauthorized, "authentication required")
		return store.Document{}, false
	}
	group, err := ctx.Local.Find(ctx.Request.Context(), "groups", ctx.RouteParams["id"], ridu.FindOptions{Actor: ctx.Actor, ActorCollection: ctx.ActorCollection})
	if err != nil {
		writeError(ctx.Writer, http.StatusNotFound, "group not found")
		return store.Document{}, false
	}
	return group, true
}

func shareStatus(ctx ridu.EndpointContext) {
	group, ok := shareGroup(ctx)
	if !ok {
		return
	}
	enabled, _ := group.Values["sharingEnabled"].BooleanValue()
	result := map[string]any{"sharingEnabled": enabled}
	if enabled {
		secret, err := shareSecret()
		if err != nil {
			writeError(ctx.Writer, http.StatusServiceUnavailable, "sharing is unavailable")
			return
		}
		claims := claimsForGroup(group)
		result["token"], _ = signShare(claims, secret)
	}
	writeJSON(ctx.Writer, http.StatusOK, result)
}

func shareEnable(ctx ridu.EndpointContext) {
	group, ok := shareGroup(ctx)
	if !ok {
		return
	}
	secret, err := shareSecret()
	if err != nil {
		writeError(ctx.Writer, http.StatusServiceUnavailable, "sharing is unavailable")
		return
	}
	var input struct {
		Rotate bool `json:"rotate"`
	}
	if err := decodeJSON(ctx.Request, &input); err != nil {
		writeError(ctx.Writer, http.StatusBadRequest, "invalid request")
		return
	}
	enabled, _ := group.Values["sharingEnabled"].BooleanValue()
	if enabled && !input.Rotate {
		token, _ := signShare(claimsForGroup(group), secret)
		writeJSON(ctx.Writer, http.StatusOK, map[string]any{"sharingEnabled": true, "token": token})
		return
	}
	version, _ := group.Values["shareVersion"].NumberValue()
	updated, err := ctx.Local.PublishChanges(context.WithValue(ctx.Request.Context(), shareMutationKey{}, true), "groups", group.ID,
		store.Values{"sharingEnabled": store.Boolean(true), "shareVersion": store.Number(version + 1)},
		ridu.MutationOptions{Actor: ctx.Actor, ActorCollection: ctx.ActorCollection, ExpectedRevision: group.Revision})
	if err != nil {
		writeError(ctx.Writer, http.StatusConflict, "share state changed; retry")
		return
	}
	token, _ := signShare(claimsForGroup(updated), secret)
	writeJSON(ctx.Writer, http.StatusOK, map[string]any{"sharingEnabled": true, "token": token})
}

func shareDisable(ctx ridu.EndpointContext) {
	group, ok := shareGroup(ctx)
	if !ok {
		return
	}
	version, _ := group.Values["shareVersion"].NumberValue()
	_, err := ctx.Local.PublishChanges(context.WithValue(ctx.Request.Context(), shareMutationKey{}, true), "groups", group.ID,
		store.Values{"sharingEnabled": store.Boolean(false), "shareVersion": store.Number(version + 1)},
		ridu.MutationOptions{Actor: ctx.Actor, ActorCollection: ctx.ActorCollection, ExpectedRevision: group.Revision})
	if err != nil {
		writeError(ctx.Writer, http.StatusConflict, "share state changed; retry")
		return
	}
	writeJSON(ctx.Writer, http.StatusOK, map[string]any{"sharingEnabled": false})
}

func claimsForGroup(group store.Document) shareClaims {
	version, _ := group.Values["shareVersion"].NumberValue()
	return shareClaims{Group: group.ID, Version: int64(version)}
}

func shareIsCurrent(group store.Document, claims shareClaims) bool {
	enabled, _ := group.Values["sharingEnabled"].BooleanValue()
	owner, _ := group.Values["owner"].StringValue()
	return enabled && owner != "" && claimsForGroup(group) == claims
}

func currentSharedGroup(ctx ridu.EndpointContext, claims shareClaims) (store.Document, *store.Document, error) {
	// The signed capability authorizes a lookup of this one group. Ridu 0.3
	// has no capability principal, so use the application's admin policy for
	// that lookup, then use the actual owner for every related Local API read.
	group, err := ctx.Local.Find(ctx.Request.Context(), "groups", claims.Group, ridu.FindOptions{
		Actor: &store.Document{ID: "share-capability"}, ActorCollection: "admins",
	})
	if err != nil {
		return store.Document{}, nil, err
	}
	if !shareIsCurrent(group, claims) {
		return store.Document{}, nil, errors.New("share is no longer active")
	}
	ownerID, _ := group.Values["owner"].StringValue()
	return group, &store.Document{ID: ownerID}, nil
}

func resolveShare(ctx ridu.EndpointContext) {
	secret, err := shareSecret()
	if err != nil {
		writeError(ctx.Writer, http.StatusServiceUnavailable, "sharing is unavailable")
		return
	}
	var input struct {
		Token string `json:"token"`
		Page  int    `json:"page"`
		Limit int    `json:"limit"`
		Query string `json:"query"`
		Kind  string `json:"kind"`
	}
	if decodeJSON(ctx.Request, &input) != nil {
		shareNotFound(ctx.Writer)
		return
	}
	claims, valid := verifyShare(input.Token, secret)
	if !valid {
		shareNotFound(ctx.Writer)
		return
	}
	group, owner, err := currentSharedGroup(ctx, claims)
	if err != nil {
		shareNotFound(ctx.Writer)
		return
	}
	filter := query.Equal(query.Field("group"), query.String(claims.Group))
	if input.Kind != "" {
		if input.Kind != "link" && input.Kind != "text" && input.Kind != "media" {
			shareNotFound(ctx.Writer)
			return
		}
		filter = query.And(filter, query.Equal(query.Field("kind"), query.String(input.Kind)))
	}
	if input.Query != "" {
		if len(input.Query) > 200 {
			shareNotFound(ctx.Writer)
			return
		}
		search := query.Or(
			query.Contains(query.Field("title"), input.Query),
			query.Contains(query.Field("url"), input.Query),
			query.Contains(query.Field("description"), input.Query),
			query.Contains(query.Field("text"), input.Query),
			query.Contains(query.Field("caption"), input.Query),
		)
		filter = query.And(filter, search)
	}
	if input.Page < 1 {
		input.Page = 1
	}
	if input.Page > 10000 {
		shareNotFound(ctx.Writer)
		return
	}
	if input.Limit < 1 {
		input.Limit = 30
	}
	if input.Limit > 100 {
		input.Limit = 100
	}
	position, _ := query.NewPath("position")
	page, err := ctx.Local.List(ctx.Request.Context(), "bookmarks", ridu.ListOptions{
		Where: filter, Page: input.Page, Limit: input.Limit,
		Sort:  []query.Sort{{Path: position, Direction: query.Descending}},
		Actor: owner, ActorCollection: "users",
	})
	if err != nil {
		shareNotFound(ctx.Writer)
		return
	}
	items := make([]map[string]any, 0, len(page.Documents))
	for _, doc := range page.Documents {
		item, err := publicBookmark(ctx, doc, claims, owner, secret)
		if err != nil {
			writeError(ctx.Writer, http.StatusServiceUnavailable, "shared media is unavailable")
			return
		}
		items = append(items, item)
	}
	if _, _, err := currentSharedGroup(ctx, claims); err != nil {
		shareNotFound(ctx.Writer)
		return
	}
	totalDocs, totalPages := 0, 0
	if page.Total != nil {
		totalDocs = *page.Total
	}
	if page.Limit > 0 {
		totalPages = (totalDocs + page.Limit - 1) / page.Limit
	}
	writeJSON(ctx.Writer, http.StatusOK, map[string]any{
		"group":      map[string]any{"id": group.ID, "name": group.Values["name"]},
		"docs":       items,
		"pagination": map[string]any{"page": page.Page, "limit": page.Limit, "totalDocs": totalDocs, "totalPages": totalPages, "hasNextPage": page.Page < totalPages, "hasPrevPage": page.Page > 1},
	})
}

func publicBookmark(ctx ridu.EndpointContext, doc store.Document, claims shareClaims, owner *store.Document, secret []byte) (map[string]any, error) {
	result := map[string]any{"id": doc.ID}
	for _, key := range []string{"group", "kind", "position", "url", "title", "description", "favicon", "previewImage", "videoProvider", "videoID", "text", "caption"} {
		if value, ok := doc.Values[key]; ok {
			result[key] = value
		}
	}
	images, _ := doc.Values["images"].CopyList()
	media := make([]map[string]any, 0, len(images))
	for _, image := range images {
		id, _ := image.StringValue()
		asset, err := ctx.Local.Find(ctx.Request.Context(), "assets", id, ridu.FindOptions{Actor: owner, ActorCollection: "users"})
		if err != nil {
			return nil, err
		}
		assetGroup, _ := asset.Values["group"].StringValue()
		if assetGroup != claims.Group {
			return nil, errors.New("asset group mismatch")
		}
		key, _ := asset.Values["objectKey"].StringValue()
		url, err := sharedMediaURL(ctx.Request.Context(), claims, asset.ID, key, secret)
		if err != nil {
			return nil, err
		}
		thumbnailKey, _ := asset.Values["sizes"].Get("thumb").Get("objectKey").StringValue()
		thumbnailURL := url
		if thumbnailKey != "" {
			thumbnailURL, err = sharedMediaURL(ctx.Request.Context(), claims, asset.ID, thumbnailKey, secret)
			if err != nil {
				return nil, err
			}
		}
		item := map[string]any{"id": asset.ID, "url": url, "thumbnailURL": thumbnailURL}
		for _, fieldName := range []string{"alt", "width", "height"} {
			if value, ok := asset.Values[fieldName]; ok {
				item[fieldName] = value
			}
		}
		media = append(media, item)
	}
	result["images"] = media
	return result, nil
}

func sharedMediaURL(ctx context.Context, group shareClaims, assetID, key string, secret []byte) (string, error) {
	backend := configuredShareStorage()
	if backend == nil || !strings.HasPrefix(key, "ridu/quikmarq/objects/") {
		return "", errors.New("shared media unavailable")
	}
	// Always return an application-signed capability, including when the
	// storage backend can produce a direct presigned URL. The media handler
	// rechecks the group's enabled flag and share version on every fetch, so a
	// rotated or disabled share link revokes already-issued image URLs too.
	_ = ctx
	token, err := signMedia(mediaClaims{shareClaims: group, Asset: assetID, Key: key, Expires: time.Now().Add(10 * time.Minute).Unix()}, secret)
	if err != nil {
		return "", err
	}
	return "/api/share/media/" + token, nil
}

func serveSharedMedia(ctx ridu.EndpointContext) {
	secret, err := shareSecret()
	if err != nil {
		writeError(ctx.Writer, http.StatusServiceUnavailable, "sharing is unavailable")
		return
	}
	claims, valid := verifyMedia(ctx.RouteParams["capability"], secret)
	if !valid {
		shareNotFound(ctx.Writer)
		return
	}
	_, owner, err := currentSharedGroup(ctx, claims.shareClaims)
	if err != nil {
		shareNotFound(ctx.Writer)
		return
	}
	asset, err := ctx.Local.Find(ctx.Request.Context(), "assets", claims.Asset, ridu.FindOptions{Actor: owner, ActorCollection: "users"})
	if err != nil {
		shareNotFound(ctx.Writer)
		return
	}
	assetGroup, _ := asset.Values["group"].StringValue()
	if assetGroup != claims.Group {
		shareNotFound(ctx.Writer)
		return
	}
	primary, _ := asset.Values["objectKey"].StringValue()
	thumbnail, _ := asset.Values["sizes"].Get("thumb").Get("objectKey").StringValue()
	if claims.Key != primary && claims.Key != thumbnail {
		shareNotFound(ctx.Writer)
		return
	}
	backend := configuredShareStorage()
	if backend == nil {
		writeError(ctx.Writer, http.StatusServiceUnavailable, "shared media is unavailable")
		return
	}
	reader, object, err := backend.Open(ctx.Request.Context(), claims.Key)
	if err != nil {
		shareNotFound(ctx.Writer)
		return
	}
	defer reader.Close()
	if object.ContentType != "image/jpeg" && object.ContentType != "image/png" {
		shareNotFound(ctx.Writer)
		return
	}
	ctx.Writer.Header().Set("Cache-Control", "private, no-store")
	ctx.Writer.Header().Set("X-Content-Type-Options", "nosniff")
	ctx.Writer.Header().Set("Content-Type", object.ContentType)
	ctx.Writer.Header().Set("Content-Length", strconv.FormatInt(object.Size, 10))
	_, _ = io.Copy(ctx.Writer, reader)
}

func shareNotFound(writer http.ResponseWriter) {
	writeError(writer, http.StatusNotFound, "share not found")
}

func decodeJSON(request *http.Request, target any) error {
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("multiple JSON values")
	}
	return nil
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]string{"error": message, "status": strconv.Itoa(status)})
}
