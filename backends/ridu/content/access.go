package content

import (
	"fmt"
	"github.com/riducms/ridu"
	"github.com/riducms/ridu/operation"
	"github.com/riducms/ridu/query"
	"github.com/riducms/ridu/store"
)

func adminOnly(ctx ridu.AccessContext) (ridu.AccessDecision, error) {
	if isAdmin(ctx.Actor, string(ctx.ActorCollection)) {
		return ridu.Allow(), nil
	}
	return ridu.Deny(), nil
}

func isAdmin(actor *store.Document, collection string) bool {
	return actor != nil && collection == "admins"
}

func appUser(actor *store.Document, collection string) bool {
	return actor != nil && collection == "users"
}

// ownRecords keeps ownership on the atomic store query for reads and writes.
func ownRecords(fieldName string) ridu.AccessRule {
	path, err := query.NewPath(fieldName)
	if err != nil {
		panic(err)
	}
	return func(ctx ridu.AccessContext) (ridu.AccessDecision, error) {
		if isAdmin(ctx.Actor, string(ctx.ActorCollection)) {
			return ridu.Allow(), nil
		}
		if !appUser(ctx.Actor, string(ctx.ActorCollection)) {
			return ridu.Deny(), nil
		}
		return ridu.Where(query.Equal(path, query.String(ctx.Actor.ID))), nil
	}
}

// selfRecords is deliberately stricter than ordinary ownership: application
// administrators do not gain access to public-account documents.
func selfRecords(fieldName string) ridu.AccessRule {
	path, err := query.NewPath(fieldName)
	if err != nil {
		panic(err)
	}
	return func(ctx ridu.AccessContext) (ridu.AccessDecision, error) {
		if !appUser(ctx.Actor, string(ctx.ActorCollection)) {
			return ridu.Deny(), nil
		}
		return ridu.Where(query.Equal(path, query.String(ctx.Actor.ID))), nil
	}
}

func signedInApp(ctx ridu.AccessContext) (ridu.AccessDecision, error) {
	if isAdmin(ctx.Actor, string(ctx.ActorCollection)) || appUser(ctx.Actor, string(ctx.ActorCollection)) {
		return ridu.Allow(), nil
	}
	return ridu.Deny(), nil
}

func mustOwner(ctx ridu.HookContext) error {
	if !contentWrite(ctx.Operation) {
		return nil
	}
	if ctx.Original != nil && ctx.Operation != operation.Duplicate {
		originalOwner, _ := ctx.Original.Values["owner"].StringValue()
		if submitted, ok := ctx.Data["owner"]; ok {
			owner, valid := submitted.StringValue()
			if !valid || owner != originalOwner {
				return ridu.Reject("owner cannot change", operation.Issue{Target: operation.At("owner"), Message: "Keep the original owner."})
			}
		}
	}
	if isAdmin(ctx.Actor, string(ctx.ActorCollection)) {
		return nil
	}
	if !appUser(ctx.Actor, string(ctx.ActorCollection)) {
		return fmt.Errorf("an application account is required")
	}
	if value, ok := ctx.Data["owner"]; ok {
		owner, valid := value.StringValue()
		if !valid || owner != ctx.Actor.ID {
			return ridu.Reject("owner must match the signed-in account", operation.Issue{Target: operation.At("owner"), Message: "Use your account as the owner."})
		}
	}
	if ctx.Original != nil {
		oldOwner, _ := ctx.Original.Values["owner"].StringValue()
		if oldOwner != ctx.Actor.ID {
			return ridu.Reject("owner cannot change", operation.Issue{Target: operation.At("owner"), Message: "Keep the original owner."})
		}
	}
	ctx.Data["owner"] = store.String(ctx.Actor.ID)
	return nil
}

func contentWrite(kind operation.Kind) bool {
	return kind == operation.Create || kind == operation.Duplicate || kind == operation.Update || kind == operation.Publish
}

func mapValues(kv ...string) store.Values {
	values := make(store.Values, len(kv)/2)
	for i := 0; i < len(kv); i += 2 {
		values[kv[i]] = store.String(kv[i+1])
	}
	return values
}
