# Mint Three.js Skills


Mint Three.js Skills helps coding agents build 3D apps and games faster. It is
designed as a companion to [Mint MCP](https://mcp.mint.gg/)

<p>
  <a href="https://play.mint.gg/vanguard-protocol"><img src="https://play.mint.gg/experience-assets/vanguard-protocol/social-card.webp" alt="Vanguard Protocol animated character roster" width="24%"></a>
  <a href="https://play.mint.gg/helios-form"><img src="https://play.mint.gg/experience-assets/helios-form/social-card.webp" alt="Helios Form orbital vehicle showroom" width="24%"></a>
  <a href="https://play.mint.gg/neon-relic"><img src="https://play.mint.gg/experience-assets/neon-relic/social-card.webp" alt="Neon Relic interactive science-fiction poster gallery" width="24%"></a>
  <a href="https://play.mint.gg/impossible-places"><img src="https://play.mint.gg/experience-assets/impossible-places/social-card.webp" alt="Impossible Places interactive Gaussian-splat travel magazine" width="24%"></a>
</p>

## Get Started

### 1. Install the skills and connect Mint MCP

From your project root, run one command. It installs Mint Three.js Skills,
adds Mint MCP for 3D asset generation, and sets up Codex, Claude Code, and
Cursor together. Requires Node.js 22.20 or later.

```bash
npx https://github.com/mintdotgg/mint-agent-skills/releases/download/v0.2.0/mintgg-setup-0.2.0.tgz
```

To set up one coding agent, add `--agent codex`, `--agent claude-code`, or
`--agent cursor`.

To install only the skills, for any coding agent:

```bash
npx skills add mintdotgg/mint-threejs-skills
```

Then connect Mint MCP from [mcp.mint.gg](https://mcp.mint.gg/).

### 2. Sign in to Mint

Open or restart your coding agent in the project and sign in to Mint. The
installer prints the sign-in step for each agent.

### 3. Use Mint Three.js Skills And Mint MCP

For a general 3D app:

```text
Use Mint Three.js Skills (mint-threejs-skills) and Mint MCP to build a
responsive Three.js product configurator with model variants, material
selection, annotations, and camera presets.
```

For a game:

```text
Use Mint Three.js Skills (mint-threejs-skills) and Mint MCP to build a polished
Three.js hover-racing game with a complete playable loop, responsive controls,
game UI, production assets, and release verification.
```

For an existing project:

```text
Use Mint Three.js Skills (mint-threejs-skills) and Mint MCP to inspect this
project, preserve its current stack, fix the interaction and rendering issues,
and verify the changed user journey.
```

## Acknowledgments

Mint Three.js Skills combines and adapts these open source skills. It is
generalized beyond games and designed specifically for use with Mint MCP as its
3D asset production pipeline.

- [threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills)
- [GameBlocks](https://github.com/xt4d/GameBlocks/tree/main)
- [Threejs-Awesome-Graphics-Agent-Skills](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills)
