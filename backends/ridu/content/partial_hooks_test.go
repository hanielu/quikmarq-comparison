package content

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/riducms/ridu"
	"github.com/riducms/ridu/protocol"
	"github.com/riducms/ridu/schema"
	"github.com/riducms/ridu/store"
)

func TestFinalGroupDeletionRejectsAndKeepsContent(t *testing.T) {
	app, owner, groups := linkMemoryFixture(t, 2)
	ctx := t.Context()
	options := ridu.MutationOptions{Actor: &owner, ActorCollection: "users"}
	read := ridu.FindOptions{Actor: &owner, ActorCollection: "users"}
	notes := make([]store.Document, len(groups))
	for index, group := range groups {
		var err error
		notes[index], err = app.Local().Create(ctx, "bookmarks", store.Values{
			"group": store.String(group.ID), "kind": store.String("text"), "text": store.String("Keep this note"),
		}, options)
		if err != nil {
			t.Fatal(err)
		}
	}
	imageBytes := new(bytes.Buffer)
	if err := png.Encode(imageBytes, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	asset, err := app.Upload(ctx, "assets", ridu.UploadInput{
		Filename: "retained.png", Reader: bytes.NewReader(imageBytes.Bytes()),
		Data: store.Values{"group": store.String(groups[0].ID)}, Actor: &owner, ActorCollection: "users",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.Local().Delete(ctx, "groups", groups[1].ID, options); err != nil {
		t.Fatalf("delete a group while another remains: %v", err)
	}
	if _, err := app.Local().Find(ctx, "bookmarks", notes[1].ID, read); err == nil {
		t.Fatal("allowed group deletion retained its bookmark")
	}
	before, err := app.Local().Find(ctx, "users", owner.ID, read)
	if err != nil {
		t.Fatal(err)
	}
	for _, actor := range []ridu.MutationOptions{options, {Actor: &store.Document{ID: "admin-1"}, ActorCollection: "admins"}} {
		_, err := app.Local().Delete(ctx, "groups", groups[0].ID, actor)
		var rejected *ridu.OperationError
		if !errors.As(err, &rejected) || rejected.Code != "rejected" || rejected.Status != http.StatusUnprocessableEntity || rejected.Message != "Cannot delete the final group" {
			t.Fatalf("final group deletion = %v; want readable rejected/422", err)
		}
	}
	session, err := app.Login(ctx, "users", "memory@example.test", "memory-fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodDelete, "http://group.test/api/collections/groups/"+groups[0].ID, nil)
	request.AddCookie(&http.Cookie{Name: "ridu_session", Value: session.Token})
	response := httptest.NewRecorder()
	app.Handler(ridu.HandlerOptions{}).ServeHTTP(response, request)
	var envelope protocol.ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusUnprocessableEntity || envelope.Error.Code != protocol.ErrorRejected || envelope.Error.Message != "Cannot delete the final group" {
		t.Fatalf("HTTP final group deletion = %d %#v", response.Code, envelope.Error)
	}
	for _, retained := range []struct{ collection, id string }{{"groups", groups[0].ID}, {"bookmarks", notes[0].ID}, {"assets", asset.ID}} {
		if _, err := app.Local().Find(ctx, retained.collection, retained.id, read); err != nil {
			t.Fatalf("rejected deletion removed %s: %v", retained.collection, err)
		}
	}
	after, err := app.Local().Find(ctx, "users", owner.ID, read)
	if err != nil || after.Revision != before.Revision {
		t.Fatalf("rejected deletion changed the owner mutation revision: %d -> %d, %v", before.Revision, after.Revision, err)
	}
	key, _ := asset.Values["objectKey"].StringValue()
	source, _, err := app.OpenUploadWithOptions(ctx, "assets", key, read)
	if err != nil {
		t.Fatalf("rejected deletion removed the upload: %v", err)
	}
	defer source.Close()
	got, err := io.ReadAll(source)
	if err != nil || !bytes.Equal(got, imageBytes.Bytes()) {
		t.Fatalf("rejected deletion changed uploaded bytes: %v", err)
	}
}

func TestPartialContentUpdatesKeepSavedFieldsAndEnforceInvariants(t *testing.T) {
	app, owner, groups := linkMemoryFixture(t, 2)
	ctx := t.Context()
	admin := &store.Document{ID: "admin-1"}
	ownerOptions := ridu.MutationOptions{Actor: &owner, ActorCollection: "users"}
	adminOptions := ridu.MutationOptions{Actor: admin, ActorCollection: "admins"}
	adminRead := ridu.FindOptions{Actor: admin, ActorCollection: "admins"}

	imageBytes := new(bytes.Buffer)
	imageFile := image.NewRGBA(image.Rect(0, 0, 2, 2))
	imageFile.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(imageBytes, imageFile); err != nil {
		t.Fatal(err)
	}
	asset, err := app.Upload(ctx, "assets", ridu.UploadInput{
		Filename: "photo.png", Reader: bytes.NewReader(imageBytes.Bytes()),
		Data:  store.Values{"owner": store.String(owner.ID), "group": store.String(groups[0].ID), "alt": store.String("Photo")},
		Actor: &owner, ActorCollection: "users",
	})
	if err != nil {
		t.Fatal(err)
	}
	fileMetadata := store.Values{}
	for _, name := range []string{"filename", "mimeType", "filesize", "objectKey", "url", "source", "sizes"} {
		fileMetadata[name] = asset.Values[name]
	}
	objectKey, _ := asset.Values["objectKey"].StringValue()
	if objectKey == "" || fileMetadata["source"].IsZero() {
		t.Fatal("upload did not save source file metadata")
	}
	assertOriginalFile := func(document store.Document) {
		t.Helper()
		for name, original := range fileMetadata {
			if !reflect.DeepEqual(document.Values[name], original) {
				t.Fatalf("metadata %s changed during alt text edit", name)
			}
		}
		reader, _, err := app.OpenUploadWithOptions(ctx, "assets", objectKey,
			ridu.FindOptions{Actor: &owner, ActorCollection: "users"})
		if err != nil {
			t.Fatalf("open retained upload: %v", err)
		}
		defer reader.Close()
		retained, err := io.ReadAll(reader)
		if err != nil || !bytes.Equal(retained, imageBytes.Bytes()) {
			t.Fatalf("retained upload bytes changed: %v", err)
		}
	}
	asset, err = app.UpdateUpload(ctx, "assets", asset.ID, ridu.UpdateUploadInput{
		Data:             store.Values{"alt": store.String("Admin alt text")},
		ExpectedRevision: asset.Revision, Actor: admin, ActorCollection: "admins",
	})
	if err != nil {
		var operationError *ridu.OperationError
		if errors.As(err, &operationError) {
			t.Fatalf("admin alt-only upload update: %v: %#v", err, operationError.Issues)
		}
		t.Fatalf("admin alt-only upload update: %v", err)
	}
	if got, _ := asset.Values["alt"].StringValue(); got != "Admin alt text" {
		t.Fatalf("admin alt text = %q", got)
	}
	assertOriginalFile(asset)
	asset, err = app.UpdateUpload(ctx, "assets", asset.ID, ridu.UpdateUploadInput{
		Data:             store.Values{"alt": store.String("Owner alt text")},
		ExpectedRevision: asset.Revision, Actor: &owner, ActorCollection: "users",
	})
	if err != nil {
		t.Fatalf("owner alt-only upload update: %v", err)
	}
	if group, _ := asset.Values["group"].StringValue(); group != groups[0].ID {
		t.Fatalf("alt text edit moved asset to group %q", group)
	}
	if ownerID, _ := asset.Values["owner"].StringValue(); ownerID != owner.ID {
		t.Fatalf("alt text edit changed asset owner to %q", ownerID)
	}
	assertOriginalFile(asset)

	for _, test := range []struct {
		name, kind string
		content    store.Values
		patch      store.Values
	}{
		{"link", "link", store.Values{"url": store.String("https://example.test/one")}, store.Values{"title": store.String("Renamed link")}},
		{"text", "text", store.Values{"text": store.String("Original note")}, store.Values{"text": store.String("Edited note")}},
		{"media", "media", store.Values{"images": store.List(store.String(asset.ID))}, store.Values{"caption": store.String("Edited media caption")}},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := store.Values{
				"owner": store.String(owner.ID), "group": store.String(groups[0].ID),
				"kind": store.String(test.kind), "position": store.String("0"),
			}
			for name, value := range test.content {
				input[name] = value
			}
			bookmark, err := app.Local().Create(ctx, "bookmarks", input, ownerOptions)
			if err != nil {
				t.Fatal(err)
			}
			position, _ := bookmark.Values["position"].StringValue()
			updated, err := app.Local().PublishChanges(ctx, "bookmarks", bookmark.ID, test.patch,
				ridu.MutationOptions{Actor: admin, ActorCollection: "admins", ExpectedRevision: bookmark.Revision})
			if err != nil {
				t.Fatalf("partial bookmark edit: %v", err)
			}
			if got, _ := updated.Values["position"].StringValue(); got != position {
				t.Fatalf("position changed on same-group edit: %q -> %q", position, got)
			}
			if got, _ := updated.Values["kind"].StringValue(); got != test.kind {
				t.Fatalf("kind changed to %q", got)
			}
			if got, _ := updated.Values["group"].StringValue(); got != groups[0].ID {
				t.Fatalf("group changed to %q", got)
			}
			for name, expected := range test.patch {
				gotText, _ := updated.Values[name].StringValue()
				wantText, _ := expected.StringValue()
				if gotText != wantText {
					t.Fatalf("%s = %q, want %q", name, gotText, wantText)
				}
			}
			if test.kind == "link" {
				moved, err := app.Local().PublishChanges(ctx, "bookmarks", updated.ID,
					store.Values{"group": store.String(groups[1].ID)},
					ridu.MutationOptions{Actor: admin, ActorCollection: "admins", ExpectedRevision: updated.Revision})
				if err != nil {
					t.Fatalf("partial group move: %v", err)
				}
				if got, _ := moved.Values["position"].StringValue(); got == position {
					t.Fatal("group move did not allocate a new position")
				}
			} else if test.kind == "media" {
				_, err := app.Local().PublishChanges(ctx, "bookmarks", updated.ID,
					store.Values{"group": store.String(groups[1].ID)},
					ridu.MutationOptions{Actor: admin, ActorCollection: "admins", ExpectedRevision: updated.Revision})
				var operationError *ridu.OperationError
				if !errors.As(err, &operationError) || operationError.Code != "rejected" {
					t.Fatalf("moving media without copying images = %v, want rejection", err)
				}
				retained, err := app.Local().Find(ctx, "bookmarks", updated.ID, adminRead)
				if err != nil {
					t.Fatal(err)
				}
				if retained.Revision != updated.Revision {
					t.Fatalf("rejected media move changed revision %d to %d", updated.Revision, retained.Revision)
				}
			}
		})
	}

	assertRejected := func(name string, mutate func() error) {
		t.Helper()
		err := mutate()
		var operationError *ridu.OperationError
		if !errors.As(err, &operationError) || operationError.Code != "rejected" || operationError.Status != 422 {
			t.Fatalf("%s = %v, want rejected/422", name, err)
		}
	}
	assertInvalidField := func(name, field string, mutate func() error) {
		t.Helper()
		err := mutate()
		var operationError *ridu.OperationError
		if !errors.As(err, &operationError) || operationError.Status != 422 {
			t.Fatalf("%s = %v, want validation/422", name, err)
		}
		for _, issue := range operationError.Issues {
			if issue.Path == field {
				return
			}
		}
		t.Fatalf("%s issues = %#v, want %s", name, operationError.Issues, field)
	}
	assertRejected("asset group move", func() error {
		_, err := app.UpdateUpload(ctx, "assets", asset.ID, ridu.UpdateUploadInput{
			Data:             store.Values{"group": store.String(groups[1].ID)},
			ExpectedRevision: asset.Revision, Actor: admin, ActorCollection: "admins",
		})
		return err
	})
	assertRejected("asset owner change", func() error {
		_, err := app.UpdateUpload(ctx, "assets", asset.ID, ridu.UpdateUploadInput{
			Data:             store.Values{"owner": store.String("another-owner")},
			ExpectedRevision: asset.Revision, Actor: admin, ActorCollection: "admins",
		})
		return err
	})
	assertInvalidField("required asset group cleared", "group", func() error {
		_, err := app.UpdateUpload(ctx, "assets", asset.ID, ridu.UpdateUploadInput{
			Data:             store.Values{"group": store.Null()},
			ExpectedRevision: asset.Revision, Actor: admin, ActorCollection: "admins",
		})
		return err
	})

	bookmark, err := app.Local().Create(ctx, "bookmarks", store.Values{
		"owner": store.String(owner.ID), "group": store.String(groups[0].ID),
		"kind": store.String("link"), "position": store.String("0"),
		"url": store.String("https://example.test/steady"),
	}, ownerOptions)
	if err != nil {
		t.Fatal(err)
	}
	assertRejected("bookmark kind change", func() error {
		_, err := app.Local().PublishChanges(ctx, "bookmarks", bookmark.ID,
			store.Values{"kind": store.String("text"), "text": store.String("Replacement")},
			adminOptions)
		return err
	})
	assertInvalidField("required bookmark kind cleared", "kind", func() error {
		_, err := app.Local().PublishChanges(ctx, "bookmarks", bookmark.ID,
			store.Values{"kind": store.Null()}, adminOptions)
		return err
	})
	assertInvalidField("bookmark kind is not a string", "kind", func() error {
		_, err := app.Local().PublishChanges(ctx, "bookmarks", bookmark.ID,
			store.Values{"kind": store.Number(1)}, adminOptions)
		return err
	})
	otherOwner, err := app.CreateAuthUser(ctx, "users", store.Values{
		"email": store.String("other-partial@example.test"), "displayName": store.String("Other owner"),
	}, "other-owner-password", ridu.MutationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name       string
		actor      *store.Document
		collection schema.CollectionSlug
	}{
		{"anonymous", nil, ""},
		{"another account", &otherOwner, "users"},
	} {
		t.Run(test.name+" cannot edit owned content", func(t *testing.T) {
			_, assetError := app.UpdateUpload(ctx, "assets", asset.ID, ridu.UpdateUploadInput{
				Data:             store.Values{"alt": store.String("Forged alt text")},
				ExpectedRevision: asset.Revision, Actor: test.actor, ActorCollection: test.collection,
			})
			_, bookmarkError := app.Local().PublishChanges(ctx, "bookmarks", bookmark.ID,
				store.Values{"title": store.String("Forged title")},
				ridu.MutationOptions{Actor: test.actor, ActorCollection: test.collection})
			for _, failure := range []struct {
				name string
				err  error
			}{{"asset", assetError}, {"bookmark", bookmarkError}} {
				var operationError *ridu.OperationError
				if !errors.As(failure.err, &operationError) ||
					(operationError.Code != "access_denied" && operationError.Code != "not_found") {
					t.Fatalf("%s update = %v, want denied", failure.name, failure.err)
				}
			}
		})
	}
	for _, test := range []struct {
		name, code string
		options    ridu.FindOptions
	}{
		{"admin cannot read public account", "access_denied", adminRead},
		{"another account cannot read public account", "not_found", ridu.FindOptions{Actor: &owner, ActorCollection: "users"}},
	} {
		_, err := app.Local().Find(ctx, "users", otherOwner.ID, test.options)
		var operationError *ridu.OperationError
		if !errors.As(err, &operationError) || operationError.Code != test.code {
			t.Fatalf("%s: %v, want %s", test.name, err, test.code)
		}
	}
	otherGroups, err := app.Local().List(ctx, "groups", ridu.ListOptions{Actor: &otherOwner, ActorCollection: "users"})
	if err != nil || len(otherGroups.Documents) != 1 {
		t.Fatalf("other owner's initial group: %v, docs = %d", err, len(otherGroups.Documents))
	}
	assertRejected("bookmark mismatched group owner", func() error {
		_, err := app.Local().PublishChanges(ctx, "bookmarks", bookmark.ID,
			store.Values{"group": store.String(otherGroups.Documents[0].ID)}, adminOptions)
		return err
	})
	assertRejected("bookmark inaccessible group", func() error {
		_, err := app.Local().PublishChanges(ctx, "bookmarks", bookmark.ID,
			store.Values{"group": store.String(otherGroups.Documents[0].ID)}, ownerOptions)
		return err
	})
	unchanged, err := app.Local().Find(ctx, "bookmarks", bookmark.ID, adminRead)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Revision != bookmark.Revision {
		t.Fatalf("rejected mutations changed revision %d to %d", bookmark.Revision, unchanged.Revision)
	}
	if kind, _ := unchanged.Values["kind"].StringValue(); kind != "link" {
		t.Fatalf("rejected mutation changed kind to %q", kind)
	}
	if group, _ := unchanged.Values["group"].StringValue(); group != groups[0].ID {
		t.Fatalf("rejected mutation changed group to %q", group)
	}
	_, err = app.UpdateUpload(ctx, "assets", asset.ID, ridu.UpdateUploadInput{
		Data:             store.Values{"alt": store.String("Stale")},
		ExpectedRevision: asset.Revision - 1, Actor: admin, ActorCollection: "admins",
	})
	var operationError *ridu.OperationError
	if !errors.As(err, &operationError) || operationError.Code != "conflict" || operationError.Status != 409 {
		t.Fatalf("stale upload revision = %v, want conflict/409", err)
	}
	refetchedAsset, err := app.Local().Find(ctx, "assets", asset.ID, adminRead)
	if err != nil {
		t.Fatal(err)
	}
	if alt, _ := refetchedAsset.Values["alt"].StringValue(); alt != "Owner alt text" {
		t.Fatalf("rejected upload mutation changed alt text to %q", alt)
	}
	if refetchedAsset.Revision != asset.Revision {
		t.Fatalf("rejected upload mutation changed revision %d to %d", asset.Revision, refetchedAsset.Revision)
	}
	asset, err = app.UpdateUpload(ctx, "assets", asset.ID, ridu.UpdateUploadInput{
		Data:             store.Values{"alt": store.Null()},
		ExpectedRevision: asset.Revision, Actor: admin, ActorCollection: "admins",
	})
	if err != nil {
		t.Fatalf("clear optional asset alt text: %v", err)
	}
	if asset.Values["alt"].Kind() != store.ValueNull {
		t.Fatalf("cleared alt text = %#v, want null", asset.Values["alt"])
	}
	assertOriginalFile(asset)
}
