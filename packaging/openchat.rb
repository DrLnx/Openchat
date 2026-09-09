# Homebrew formula. Put this in a tap you own:
#
#   brew tap n3xtpy/openchat https://github.com/n3xtpy/homebrew-openchat
#   brew install n3xtpy/openchat/openchat
#
# Update `url` and `sha256` for each release:
#   curl -sL <url> | shasum -a 256

class Openchat < Formula
  desc "Serverless, end-to-end encrypted group chat and DMs for your terminal"
  homepage "https://github.com/n3xtpy/Openchat"
  url "https://github.com/n3xtpy/Openchat/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "REPLACE_WITH_RELEASE_CHECKSUM"
  license "MIT"

  depends_on "node" => "22"

  def install
    system "npm", "ci"
    system "npm", "run", "build"

    # Install runtime deps only, then link the launcher.
    system "npm", "ci", "--omit=dev"
    libexec.install Dir["*"]
    (bin/"openchat").write_env_script libexec/"bin/openchat.js", PATH: "#{Formula["node"].opt_bin}:$PATH"
  end

  test do
    assert_match "openchat", shell_output("#{bin}/openchat --help")
  end
end
