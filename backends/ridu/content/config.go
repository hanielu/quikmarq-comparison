package content

import (
	"github.com/riducms/ridu"
)

func Config() ridu.Config {
	return ridu.Config{
		Name: "Quikmarq", Admin: ridu.AdminConfig{User: "admins"},
		StorageNamespace: "quikmarq", Plugins: installedPlugins(),
		Collections: []ridu.Collection{Admins, Users, Groups, Assets, Bookmarks},
		Endpoints:   endpoints(),
	}
}
