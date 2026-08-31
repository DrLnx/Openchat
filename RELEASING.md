# Releasing

Everything here needs an account I cannot act on your behalf with, so this is
the list of steps rather than an automated release.

## 0. Before anything

```bash
npm run check          # lint + the full test suite
npm pack --dry-run     # confirm the tarball holds bin/, dist/, README, LICENSE
```

Bump `version` in `package.json`, add a section to `CHANGELOG.md`, commit.

## 1. Tag

```bash
git tag -a v0.1.0 -m 'openchat 0.1.0'
git push origin v0.1.0
```

Several packaging steps below fetch the GitHub tarball for that tag, so tag
first.

## 2. npm

```bash
npm login
npm publish --access public
```

`prepack` builds `dist/` automatically. Verify with:

```bash
npm install -g openchat && openchat --help
```

## 3. AUR (pacman)

Needs an AUR account with your SSH key registered at
<https://aur.archlinux.org/account>.

```bash
# checksum for the tag you just pushed
cd packaging && makepkg -g          # paste the result over sha256sums=('SKIP')

git clone ssh://aur@aur.archlinux.org/openchat.git aur-openchat
cp packaging/PKGBUILD aur-openchat/
cd aur-openchat
makepkg --printsrcinfo > .SRCINFO   # the AUR requires this file
git add PKGBUILD .SRCINFO
git commit -m 'openchat 0.1.0'
git push
```

Test locally first with `makepkg -si` — it will catch a missing `makedepends`
before your users do. `base-devel` and `python` are there because
`sodium-native` and `udx-native` fall back to compiling if no prebuild matches.

## 4. Homebrew

Create a tap repository named `homebrew-openchat` under your account, then:

```bash
curl -sL https://github.com/n3xtpy/Openchat/archive/refs/tags/v0.1.0.tar.gz | shasum -a 256
# paste into packaging/openchat.rb, replacing REPLACE_WITH_RELEASE_CHECKSUM

cp packaging/openchat.rb ../homebrew-openchat/Formula/openchat.rb
cd ../homebrew-openchat && git commit -am 'openchat 0.1.0' && git push
```

Verify: `brew install --build-from-source n3xtpy/openchat/openchat`.

## 5. After publishing

Remove the "not published yet" note at the top of the README's install section.
