# Hypergamous Tree Chopping Simulator 4

First-person, spooky, idle-ish tree chopper for Windows. The trees are alive. Don't look away.

**Download:** grab the installer from the [latest release](https://github.com/trickortree/treesim4/releases/latest). The game updates itself after that.

## Run from source

```bash
npm install
npm start
```

## Tree Sim 4 Studio

```bash
npm run studio
```

Opens the game as an editor: fly around any island, place and move signs and props, design trees (or ask Claude to), and play-test with F5. It saves to `content/` (shipped with the game). The `studio/` folder itself never goes into the installer.

## Release (maintainers)

The easy way: **🚀 Release** in the Studio runs the checks, previews the update popup, does the steps below and then watches GitHub until the release is live. By hand:

1. Bump `version` in `package.json` and update `build.releaseInfo.releaseNotes` (that text is the in-game update popup).
2. Commit, push `main`, then `git tag vX.Y.Z` and `git push origin vX.Y.Z`.
3. The GitHub Action builds the installer and publishes the release; players are offered the update in-game.

Made by Tree Chop Studios.
