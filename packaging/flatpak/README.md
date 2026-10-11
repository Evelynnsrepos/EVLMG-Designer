# Flatpak

`io.github.Evelynnsrepos.Evelopment-Games-Designer.yml` repackages the Linux `.deb` from a GitHub
release into a Flatpak. The release workflow builds it and attaches
`Evelopment.Games.Designer_<version>_x86_64.flatpak` to every release (see `.github/workflows/flatpak.yml`,
which also points the recipe at the right `.deb` and checksum, so nothing here needs updating per release).

Install: `flatpak install Evelopment.Games.Designer_<version>_x86_64.flatpak`
(on NixOS, enable Flatpak first with `services.flatpak.enable = true;`).

This recipe is not for Flathub. Flathub requires recipes written without AI tools and apps built from
source, and this one was written with AI help and repackages a prebuilt binary.
