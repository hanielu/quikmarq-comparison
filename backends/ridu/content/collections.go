package content

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/riducms/ridu"
	"github.com/riducms/ridu/field"
	"github.com/riducms/ridu/operation"
	"github.com/riducms/ridu/query"
	"github.com/riducms/ridu/store"
)

type groupMutationKey struct{}

// Fixed-width base-36 ranks leave a large midpoint on either side while
// preserving ordinary lexicographic ordering in every store adapter.
const initialGroupRank = "hzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"

var Groups = ridu.Collection{
	Slug:     "groups",
	Versions: true, VersionConfig: ridu.VersionConfig{MaxPerDocument: 1},
	Admin: ridu.CollectionAdmin{UseAsTitle: "name"},
	Fields: field.Fields{
		field.Relationship("owner", "users").Required().Index().OnDelete(field.ReferenceDeleteRestrict),
		field.Text("name").Required().MaxLength(80),
		field.Text("rank").Required().Index().Validate(validateGroupRank),
		field.Checkbox("sharingEnabled").Default(false),
		field.Number("shareVersion").Default(0),
	},
	Access: ridu.CollectionAccess{Create: signedInApp, Read: ownRecords("owner"), Update: ownRecords("owner"), Delete: ownRecords("owner")},
	Hooks: ridu.CollectionHooks{
		BeforeValidate: []ridu.Hook{mustOwner},
		BeforeChange:   []ridu.Hook{guardShareFields},
		BeforeDelete:   []ridu.Hook{deleteGroupContents},
	},
	Endpoints: shareEndpoints(),
}

var Assets = ridu.Collection{
	Slug: "assets", Upload: true,
	UploadConfig: ridu.UploadConfig{MaxFileSize: 4_000_000, MimeTypes: []string{"image/jpeg", "image/png"}, Private: true,
		ImageSizes: []ridu.ImageSize{{Name: "thumb", Width: 320, Height: 320, Fit: "cover"}}},
	Fields: field.Fields{
		field.Relationship("owner", "users").Required().Index().OnDelete(field.ReferenceDeleteRestrict),
		field.Relationship("group", "groups").Required().Index().OnDelete(field.ReferenceDeleteRestrict),
		field.Text("alt").MaxLength(200).Admin(field.Admin{
			Description: "Image accessibility text. Edit the bookmark's Caption to change the text shown in Quikmarq.",
		}),
	},
	Access: ridu.CollectionAccess{Create: signedInApp, Read: ownRecords("owner"), Update: ownRecords("owner"), Delete: ownRecords("owner")},
	Hooks:  ridu.CollectionHooks{BeforeValidate: []ridu.Hook{mustOwner}, BeforeChange: []ridu.Hook{validateGroupOwner, guardAssetGroup}},
}

var Bookmarks = ridu.Collection{
	Slug:     "bookmarks",
	Versions: true, VersionConfig: ridu.VersionConfig{MaxPerDocument: 1},
	Admin: ridu.CollectionAdmin{UseAsTitle: "title"},
	Fields: field.Fields{
		field.Relationship("owner", "users").Required().Index().OnDelete(field.ReferenceDeleteRestrict),
		field.Relationship("group", "groups").Required().Index().OnDelete(field.ReferenceDeleteRestrict),
		field.Select("kind", "link", "text", "media").Required(),
		field.Text("position").Required().Index().Validate(validatePosition),
		field.Text("url").Validate(validateBookmarkURL),
		field.Text("title").MaxLength(500),
		field.Textarea("description"),
		field.Text("favicon"), field.Text("previewImage"),
		field.Text("videoProvider"), field.Text("videoID"),
		field.Textarea("text"),
		field.Textarea("caption").Admin(field.Admin{
			Description: "Text shown on this media bookmark in Quikmarq, shared by all of its images.",
		}),
		field.Uploads("images", "assets").OnDelete(field.ReferenceDeleteRestrict).Validate(validateImageCount),
	},
	Access: ridu.CollectionAccess{Create: signedInApp, Read: ownRecords("owner"), Update: ownRecords("owner"), Delete: ownRecords("owner")},
	Hooks: ridu.CollectionHooks{
		BeforeValidate: []ridu.Hook{mustOwner, normalizeBookmarkInput, ensurePositionInput},
		BeforeChange:   []ridu.Hook{validateGroupOwner, assignPosition, validateBookmark},
		AfterChange:    []ridu.Hook{cleanupBookmarkAssets},
		AfterDelete:    []ridu.Hook{cleanupBookmarkAssets},
	},
}

var lastPosition atomic.Uint64

func nextPosition() string {
	for {
		previous := lastPosition.Load()
		candidate := uint64(time.Now().UnixNano())
		if candidate <= previous {
			candidate = previous + 1
		}
		if lastPosition.CompareAndSwap(previous, candidate) {
			return strings.Repeat("0", 13-len(strconv.FormatUint(candidate, 36))) + strconv.FormatUint(candidate, 36)
		}
	}
}

func ensurePositionInput(ctx ridu.HookContext) error {
	if ctx.Operation == operation.Create || ctx.Operation == operation.Duplicate {
		ctx.Data["position"] = store.String("0")
	}
	return nil
}

func assignPosition(ctx ridu.HookContext) error {
	if !contentWrite(ctx.Operation) {
		return nil
	}
	if ctx.Original == nil || ctx.Operation == operation.Duplicate {
		ctx.Data["position"] = store.String(nextPosition())
		return nil
	}
	oldGroup, _ := ctx.Original.Values["group"].StringValue()
	newGroup, _ := ctx.Candidate()["group"].StringValue()
	if oldGroup != newGroup {
		ctx.Data["position"] = store.String(nextPosition())
		return nil
	}
	ctx.Data["position"] = ctx.Original.Values["position"]
	return nil
}

var (
	groupRankPattern = regexp.MustCompile(`^[0-9a-z]{32}$`)
	positionPattern  = regexp.MustCompile(`^[0-9a-z]{1,128}$`)
)

func validateGroupRank(_ operation.Context, value operation.Value[string]) ([]operation.Issue, error) {
	rank, present := value.Get()
	if !present || rank == "" || groupRankPattern.MatchString(rank) {
		return nil, nil
	}
	return []operation.Issue{{Code: "invalid_rank", Message: "Use a 32-character lowercase alphanumeric ordering key."}}, nil
}

func validatePosition(_ operation.Context, value operation.Value[string]) ([]operation.Issue, error) {
	position, present := value.Get()
	if !present || position == "" || positionPattern.MatchString(position) {
		return nil, nil
	}
	return []operation.Issue{{Code: "invalid_position", Message: "Use a lowercase alphanumeric position key."}}, nil
}

func validateBookmarkURL(_ operation.Context, value operation.Value[string]) ([]operation.Issue, error) {
	text, present := value.Get()
	if !present || text == "" {
		return nil, nil
	}
	parsed, err := url.Parse(text)
	if err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Hostname() != "" && parsed.User == nil {
		return nil, nil
	}
	return []operation.Issue{{Code: "invalid_url", Message: "Use a valid HTTP or HTTPS URL."}}, nil
}

func validateImageCount(_ operation.Context, value operation.Value[[]operation.ID]) ([]operation.Issue, error) {
	images, present := value.Get()
	if !present || len(images) <= 4 {
		return nil, nil
	}
	return []operation.Issue{{Code: "too_many_images", Message: "Choose at most four images."}}, nil
}

func validateGroupOwner(ctx ridu.HookContext) error {
	if !contentWrite(ctx.Operation) {
		return nil
	}
	values := ctx.Candidate()
	groupID, _ := values["group"].StringValue()
	if groupID == "" {
		return ridu.Reject("group is required", operation.Issue{Target: operation.At("group"), Message: "Choose a group."})
	}
	group, err := ctx.Local.Find(ctx.Context, "groups", groupID, ridu.FindOptions{Actor: ctx.Actor, ActorCollection: ctx.ActorCollection})
	if err != nil {
		if referenceDeniedOrMissing(err) {
			return ridu.Reject("group is unavailable", operation.Issue{Target: operation.At("group"), Message: "Choose an available group."})
		}
		return fmt.Errorf("group is unavailable: %w", err)
	}
	owner, _ := values["owner"].StringValue()
	groupOwner, _ := group.Values["owner"].StringValue()
	if owner != groupOwner {
		return ridu.Reject("group must belong to the same owner", operation.Issue{Target: operation.At("group"), Message: "Choose a group owned by this account."})
	}
	return nil
}

func guardAssetGroup(ctx ridu.HookContext) error {
	// The framework's storage-aware App.Duplicate copies the object bytes and
	// allocates fresh keys; ordinary updates cannot move an existing object.
	if ctx.Operation == operation.Duplicate {
		return nil
	}
	if ctx.Original == nil {
		return nil
	}
	previous, _ := ctx.Original.Values["group"].StringValue()
	current, _ := ctx.Candidate()["group"].StringValue()
	if previous != current {
		return ridu.Reject("asset group cannot change; upload a copy in the destination group", operation.Issue{Target: operation.At("group"), Message: "Upload a copy in the destination group."})
	}
	return nil
}

func guardShareFields(ctx ridu.HookContext) error {
	if !contentWrite(ctx.Operation) {
		return nil
	}
	if ctx.Operation == operation.Duplicate {
		ctx.Data["sharingEnabled"] = store.Boolean(false)
		ctx.Data["shareVersion"] = store.Number(0)
		return nil
	}
	if ctx.Context.Value(shareMutationKey{}) != nil {
		return nil
	}
	// Share state changes only through the versioned endpoint.
	if ctx.Original != nil {
		for _, name := range []string{"sharingEnabled", "shareVersion"} {
			if submitted, ok := ctx.Data[name]; ok && !reflect.DeepEqual(submitted, ctx.Original.Values[name]) {
				return fmt.Errorf("%s is managed by the share endpoint", name)
			}
		}
	} else {
		if enabled, _ := ctx.Data["sharingEnabled"].BooleanValue(); enabled {
			return fmt.Errorf("sharing is managed by the share endpoint")
		}
		if version, _ := ctx.Data["shareVersion"].NumberValue(); version != 0 {
			return fmt.Errorf("share version is managed by the share endpoint")
		}
	}
	return nil
}

func normalizeBookmarkInput(ctx ridu.HookContext) error {
	if !contentWrite(ctx.Operation) {
		return nil
	}
	if value, ok := ctx.Data["kind"]; ok {
		kind, valid := value.StringValue()
		if !valid {
			return ridu.Reject("bookmark kind must be a string", operation.Issue{Target: operation.At("kind"), Message: "Choose a bookmark kind."})
		}
		ctx.Data["kind"] = store.String(strings.ToLower(strings.TrimSpace(kind)))
	}
	return nil
}

func validateBookmark(ctx ridu.HookContext) error {
	if !contentWrite(ctx.Operation) {
		return nil
	}
	values := ctx.Candidate()
	kind, _ := values["kind"].StringValue()
	if ctx.Original != nil {
		original, _ := ctx.Original.Values["kind"].StringValue()
		if kind != original {
			return ridu.Reject("bookmark kind cannot change", operation.Issue{Target: operation.At("kind"), Message: "Create a new bookmark to change its kind."})
		}
	}
	switch kind {
	case "link":
		if value, _ := values["url"].StringValue(); value == "" {
			return ridu.Reject("link bookmark needs a URL", operation.Issue{Target: operation.At("url"), Message: "Add a URL."})
		}
		clearBookmarkFields(ctx.Data, "text", "caption", "images")
	case "text":
		if value, _ := values["text"].StringValue(); strings.TrimSpace(value) == "" {
			return ridu.Reject("text bookmark needs text", operation.Issue{Target: operation.At("text"), Message: "Write a note."})
		}
		clearBookmarkFields(ctx.Data, "url", "favicon", "previewImage", "videoProvider", "videoID", "caption", "images")
	case "media":
		images, _ := values["images"].CopyList()
		if len(images) == 0 || len(images) > 4 {
			return ridu.Reject("media bookmark needs one to four images", operation.Issue{Target: operation.At("images"), Message: "Choose one to four images."})
		}
		for _, image := range images {
			id, _ := image.StringValue()
			asset, err := ctx.Local.Find(ctx.Context, "assets", id, ridu.FindOptions{Actor: ctx.Actor, ActorCollection: ctx.ActorCollection})
			if err != nil {
				if referenceDeniedOrMissing(err) {
					return ridu.Reject("image is unavailable", operation.Issue{Target: operation.At("images"), Message: "Choose an available image."})
				}
				return fmt.Errorf("image is unavailable: %w", err)
			}
			group, _ := values["group"].StringValue()
			assetGroup, _ := asset.Values["group"].StringValue()
			if group != assetGroup {
				return ridu.Reject("image must belong to the bookmark group", operation.Issue{Target: operation.At("images"), Message: "Choose images from the bookmark group."})
			}
		}
		clearBookmarkFields(ctx.Data, "url", "favicon", "previewImage", "videoProvider", "videoID", "text")
	default:
		return ridu.Reject("bookmark kind must be link, text, or media", operation.Issue{Target: operation.At("kind"), Message: "Choose a bookmark kind."})
	}
	return nil
}

func referenceDeniedOrMissing(err error) bool {
	var operationError *ridu.OperationError
	return errors.As(err, &operationError) && (operationError.Code == "not_found" || operationError.Code == "access_denied")
}

func clearBookmarkFields(values store.Values, names ...string) {
	for _, name := range names {
		values[name] = store.Null()
	}
}

func bookmarkImageIDs(values store.Values) map[string]struct{} {
	result := map[string]struct{}{}
	images, _ := values["images"].CopyList()
	for _, image := range images {
		if id, ok := image.StringValue(); ok && id != "" {
			result[id] = struct{}{}
		}
	}
	return result
}

// cleanupBookmarkAssets deletes only images removed from the saved bookmark and
// no longer referenced by any bookmark in the asset's group. Copies in the
// same group may reuse an asset; the restricted reference delete is the final
// transaction-level guard if another reference appears during the scan.
func cleanupBookmarkAssets(ctx ridu.HookContext) error {
	if ctx.Original == nil {
		return nil
	}
	candidates := bookmarkImageIDs(ctx.Original.Values)
	if ctx.Operation != operation.Delete && ctx.Operation != operation.DeletePermanent && ctx.Document != nil {
		for id := range bookmarkImageIDs(ctx.Document.Values) {
			delete(candidates, id)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	groupID, _ := ctx.Original.Values["group"].StringValue()
	groupPath, _ := query.NewPath("group")
	for pageNumber := 1; len(candidates) != 0; pageNumber++ {
		page, err := ctx.Local.List(ctx.Context, "bookmarks", ridu.ListOptions{
			Where: query.Equal(groupPath, query.String(groupID)), Page: pageNumber, Limit: 100,
			Actor: ctx.Actor, ActorCollection: ctx.ActorCollection,
		})
		if err != nil {
			return err
		}
		for _, bookmark := range page.Documents {
			for id := range bookmarkImageIDs(bookmark.Values) {
				delete(candidates, id)
			}
		}
		if pageNumber*page.Limit >= page.Total || len(page.Documents) == 0 {
			break
		}
	}
	for id := range candidates {
		asset, err := ctx.Local.Find(ctx.Context, "assets", id, ridu.FindOptions{Actor: ctx.Actor, ActorCollection: ctx.ActorCollection})
		if err != nil {
			return err
		}
		assetGroup, _ := asset.Values["group"].StringValue()
		if assetGroup != groupID {
			return fmt.Errorf("detached asset group mismatch")
		}
		if _, err := ctx.Local.Delete(ctx.Context, "assets", id, ridu.MutationOptions{Actor: ctx.Actor, ActorCollection: ctx.ActorCollection}); err != nil {
			return err
		}
	}
	return nil
}

func deleteGroupContents(ctx ridu.HookContext) error {
	if ctx.Original == nil {
		return nil
	}
	owner, _ := ctx.Original.Values["owner"].StringValue()
	ownerPath, _ := query.NewPath("owner")
	owned, err := ctx.Local.List(ctx.Context, "groups", ridu.ListOptions{Where: query.Equal(ownerPath, query.String(owner)), Limit: 2, Actor: ctx.Actor, ActorCollection: ctx.ActorCollection})
	if err != nil {
		return err
	}
	if owned.Total <= 1 {
		return ridu.Reject("Cannot delete the final group")
	}
	// Serialize deletes of different groups through the same owner row. Both
	// deletes may initially observe two groups, but only one can update this
	// revision with the owner row locked; the loser rolls its deletion back.
	userActor, userActorCollection := ctx.Actor, ctx.ActorCollection
	if isAdmin(ctx.Actor, string(ctx.ActorCollection)) {
		userActor, userActorCollection = &store.Document{ID: owner}, "users"
	}
	ownerDocument, err := ctx.Local.Find(ctx.Context, "users", owner, ridu.FindOptions{Actor: userActor, ActorCollection: userActorCollection})
	if err != nil {
		return err
	}
	_, err = ctx.Local.Update(context.WithValue(ctx.Context, groupMutationKey{}, true), "users", owner, store.Values{
		"groupMutationVersion": store.Number(float64(ownerDocument.Revision)),
	}, ridu.MutationOptions{Actor: userActor, ActorCollection: userActorCollection, ExpectedRevision: ownerDocument.Revision})
	if err != nil {
		return fmt.Errorf("group deletion conflicted with another change: %w", err)
	}
	// Recount after acquiring the owner write lock. A competing delete may
	// have committed between the first count and this update.
	owned, err = ctx.Local.List(ctx.Context, "groups", ridu.ListOptions{Where: query.Equal(ownerPath, query.String(owner)), Limit: 2, Actor: ctx.Actor, ActorCollection: ctx.ActorCollection})
	if err != nil {
		return err
	}
	if owned.Total <= 1 {
		return ridu.Reject("Cannot delete the final group")
	}
	groupPath, _ := query.NewPath("group")
	for _, collection := range []string{"bookmarks", "assets"} {
		for {
			page, err := ctx.Local.List(ctx.Context, collection, ridu.ListOptions{Where: query.Equal(groupPath, query.String(ctx.Original.ID)), Limit: 100, Actor: ctx.Actor, ActorCollection: ctx.ActorCollection})
			if err != nil {
				return err
			}
			if len(page.Documents) == 0 {
				break
			}
			for _, doc := range page.Documents {
				if _, err := ctx.Local.Delete(ctx.Context, collection, doc.ID, ridu.MutationOptions{Actor: ctx.Actor, ActorCollection: ctx.ActorCollection}); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
