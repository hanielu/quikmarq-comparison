package content

import (
	"reflect"
	"testing"

	"github.com/riducms/ridu"
	"github.com/riducms/ridu/query"
	"github.com/riducms/ridu/schema"
	"github.com/riducms/ridu/store"
)

func TestCollectionAccessMatrix(t *testing.T) {
	actors := []struct {
		name, collection string
		actor            *store.Document
		owned            ridu.AccessDecisionKind
	}{
		{name: "anonymous", owned: ridu.AccessDeny},
		{name: "app account", collection: "users", actor: &store.Document{ID: "user-1"}, owned: ridu.AccessWhere},
		{name: "administrator", collection: "admins", actor: &store.Document{ID: "admin-1"}, owned: ridu.AccessAllow},
		{name: "unknown auth collection", collection: "other", actor: &store.Document{ID: "other-1"}, owned: ridu.AccessDeny},
	}
	ownerPath, err := query.NewPath("owner")
	if err != nil {
		t.Fatal(err)
	}
	for _, collection := range []ridu.Collection{Groups, Assets, Bookmarks} {
		for _, actor := range actors {
			context := ridu.AccessContext{Actor: actor.actor, ActorCollection: schema.CollectionSlug(actor.collection)}
			create, err := collection.Access.Create(context)
			if err != nil {
				t.Fatal(err)
			}
			wantCreate := ridu.AccessDeny
			if actor.owned == ridu.AccessAllow || actor.owned == ridu.AccessWhere {
				wantCreate = ridu.AccessAllow
			}
			if create.Kind() != wantCreate {
				t.Errorf("%s/%s create = %s, want %s", collection.Slug, actor.name, create.Kind(), wantCreate)
			}
			for _, operation := range []struct {
				name string
				rule ridu.AccessRule
			}{{"read", collection.Access.Read}, {"update", collection.Access.Update}, {"delete", collection.Access.Delete}} {
				decision, err := operation.rule(context)
				if err != nil || decision.Kind() != actor.owned {
					t.Errorf("%s/%s %s = %s, %v; want %s", collection.Slug, actor.name, operation.name, decision.Kind(), err, actor.owned)
				}
				if actor.owned == ridu.AccessWhere {
					filter, ok := decision.Filter()
					want := query.Equal(ownerPath, query.String(actor.actor.ID)).Node()
					if !ok || !reflect.DeepEqual(filter, want) {
						t.Errorf("%s/%s %s filter = %#v; want %#v", collection.Slug, actor.name, operation.name, filter, want)
					}
				}
			}
		}
	}
}

func TestIdentityAccessMatrix(t *testing.T) {
	idPath, err := query.NewPath("id")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name       string
		actor      *store.Document
		collection schema.CollectionSlug
		admin      ridu.AccessDecisionKind
		user       ridu.AccessDecisionKind
	}{
		{name: "anonymous", admin: ridu.AccessDeny, user: ridu.AccessDeny},
		{name: "public account", actor: &store.Document{ID: "user-1"}, collection: "users", admin: ridu.AccessDeny, user: ridu.AccessWhere},
		{name: "administrator", actor: &store.Document{ID: "admin-1"}, collection: "admins", admin: ridu.AccessAllow, user: ridu.AccessDeny},
	} {
		ctx := ridu.AccessContext{Actor: test.actor, ActorCollection: test.collection}
		for _, operation := range []struct {
			name string
			rule ridu.AccessRule
			want ridu.AccessDecisionKind
		}{{"admin entry", Admins.Access.Admin, test.admin}, {"admin read", Admins.Access.Read, test.admin}, {"admin update", Admins.Access.Update, test.admin}, {"admin delete", Admins.Access.Delete, test.admin}, {"public admin entry", Users.Access.Admin, ridu.AccessDeny}, {"user read", Users.Access.Read, test.user}, {"user update", Users.Access.Update, test.user}, {"user delete", Users.Access.Delete, ridu.AccessDeny}} {
			decision, err := operation.rule(ctx)
			if err != nil || decision.Kind() != operation.want {
				t.Errorf("%s/%s = %s, %v; want %s", test.name, operation.name, decision.Kind(), err, operation.want)
			}
			if decision.Kind() == ridu.AccessWhere {
				filter, ok := decision.Filter()
				want := query.Equal(idPath, query.String(test.actor.ID)).Node()
				if !ok || !reflect.DeepEqual(filter, want) {
					t.Errorf("%s/%s filter = %#v; want %#v", test.name, operation.name, filter, want)
				}
			}
		}
	}
	anonymousCreate, err := Users.Access.Create(ridu.AccessContext{})
	if err != nil || anonymousCreate.Kind() != ridu.AccessAllow {
		t.Fatalf("public signup = %s, %v", anonymousCreate.Kind(), err)
	}
}

func TestPublicUserReferenceDoesNotGrantAdminRead(t *testing.T) {
	admin := ridu.AccessContext{Actor: &store.Document{ID: "admin-1"}, ActorCollection: "admins"}
	read, err := Users.Access.Read(admin)
	if err != nil || read.Kind() != ridu.AccessDeny {
		t.Fatalf("admin read = %s, %v; want denied", read.Kind(), err)
	}
	reference, err := Users.Access.Reference(admin)
	if err != nil || reference.Kind() != ridu.AccessAllow {
		t.Fatalf("admin reference = %s, %v; want allowed", reference.Kind(), err)
	}
	account := ridu.AccessContext{Actor: &store.Document{ID: "user-1"}, ActorCollection: "users"}
	reference, err = Users.Access.Reference(account)
	if err != nil || reference.Kind() != ridu.AccessWhere {
		t.Fatalf("account reference = %s, %v; want self predicate", reference.Kind(), err)
	}
	want := query.Equal("id", "user-1").Node()
	filter, ok := reference.Filter()
	if !ok || !reflect.DeepEqual(filter, want) {
		t.Fatalf("account reference predicate = %#v; want %#v", filter, want)
	}
}
