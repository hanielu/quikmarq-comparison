package content

import (
	"github.com/riducms/ridu"
	"github.com/riducms/ridu/field"
	"github.com/riducms/ridu/operation"
)

// Admins is the only auth collection admitted to the framework admin.
var Admins = ridu.Collection{
	Slug: "admins", Auth: true,
	Fields: field.Fields{field.Email("email").Required().Unique()},
	Access: ridu.CollectionAccess{
		Admin: adminOnly, Read: adminOnly,
		Update: adminOnly, Delete: adminOnly,
	},
}

// Users are public application identities. Explicit Create enables signup.
var Users = ridu.Collection{
	Slug: "users",
	Auth: true,
	Access: ridu.CollectionAccess{
		Admin: denyAll, Create: publicCreate, Read: selfRecords("id"),
		// Existing owner relationships must remain valid during admin edits; this
		// grants reference validation without exposing public account documents.
		Reference: ownRecords("id"), Update: selfRecords("id"), Delete: denyAll,
	},
	Fields: field.Fields{
		field.Email("email").Required().Unique(),
		field.Text("displayName").Required().MaxLength(80),
		field.Number("groupMutationVersion").Default(0).Admin(field.Admin{Hidden: true}).Access(field.Access{
			Create: denyInternalField, Read: denyInternalField,
			Update: func(ctx operation.Context) (bool, error) { return ctx.Context.Value(groupMutationKey{}) != nil, nil },
		}),
	},
	Hooks: ridu.CollectionHooks{AfterChange: []ridu.Hook{createInbox}},
}

func denyInternalField(operation.Context) (bool, error) { return false, nil }

func publicCreate(ridu.AccessContext) (ridu.AccessDecision, error) { return ridu.Allow(), nil }
func denyAll(ridu.AccessContext) (ridu.AccessDecision, error)      { return ridu.Deny(), nil }

func createInbox(ctx ridu.HookContext) error {
	if ctx.Operation != operation.Create || ctx.Document == nil {
		return nil
	}
	_, err := ctx.Local.Create(ctx.Context, "groups", mapValues(
		"owner", ctx.Document.ID, "name", "Inbox", "rank", initialGroupRank,
	), ridu.MutationOptions{Actor: ctx.Document, ActorCollection: "users"})
	return err
}
