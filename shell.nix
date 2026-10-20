# NixOS: `nix-shell` gives everything needed to build and run the desktop app, without installing it system-wide.
{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  packages = with pkgs; [
    rustc cargo gcc pkg-config
    nodejs_22
    webkitgtk_4_1 gtk3 glib cairo pango gdk-pixbuf harfbuzz atk at-spi2-atk
    libsoup_3 librsvg dbus libayatana-appindicator
    glib-networking gsettings-desktop-schemas adwaita-icon-theme
  ];
  # HTTPS inside the web view, and schemas/icons for file dialogs.
  GIO_MODULE_DIR = "${pkgs.glib-networking}/lib/gio/modules/";
  shellHook = ''
    export XDG_DATA_DIRS=${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:${pkgs.adwaita-icon-theme}/share:$XDG_DATA_DIRS
  '';
}
