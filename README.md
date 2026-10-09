# Hypergamous Tree Chopping Simulator 4

First-person, spooky, idle-ish tree chopper for Windows. The trees are alive. Don't look away.

**Download:** grab the installer from the [latest release](https://github.com/trickortree/treesim4/releases/latest). The game updates itself after that.

## Run from source

```bash
npm install
npm start
```

## Release (maintainers)

1. Bump `version` in `package.json` and update `build.releaseInfo.releaseNotes` (that text is the in-game update popup).
2. Commit, push `main`, then `git tag vX.Y.Z` and `git push origin vX.Y.Z`.
3. The GitHub Action builds the installer and publishes the release; players are offered the update in-game.

Made by Tree Chop Studios.
