{
  description = "Kimi-backed web_search and web_fetch tools for the pi coding agent";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.git-hooks.flakeModule
        inputs.treefmt-nix.flakeModule
      ];

      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      perSystem =
        {
          pkgs,
          config,
          lib,
          ...
        }:
        {
          treefmt = {
            projectRootFile = "flake.nix";
            programs = {
              nixfmt = {
                enable = true;
                width = 80;
              };
              biome = {
                enable = true;
                excludes = [ "package-lock.json" ];
                settings = removeAttrs (lib.importJSON ./biome.json) [
                  "files"
                  "vcs"
                ];
              };
            };
          };

          pre-commit.settings = {
            enable = true;
            hooks = {
              treefmt.enable = true;
              commitizen.enable = true;
            };
          };

          devShells.default = pkgs.mkShell {
            inputsFrom = [
              config.pre-commit.devShell
              config.treefmt.build.devShell
            ];
            packages = with pkgs; [
              nodejs_24
            ];
          };
        };
    };
}
