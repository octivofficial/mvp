# Product Overview

Octiv is an AI agent sandbox that operates autonomous AI bots within a PaperMC 1.21.1 Minecraft server environment. The system enables AI agents to explore, survive, build, and manage resources in Minecraft while maintaining coordination through a shared memory system (Redis blackboard).

## Core Purpose

Enable autonomous AI agents to:
- Interact with Minecraft world via mineflayer/mcporter
- Coordinate through shared Redis-based memory (Blackboard)
- Execute tasks using specialized role-based agents (builder, explorer, farmer, miner, woodcutter)
- Communicate via Discord bot integration
- Maintain long-term memory and learning through Zettelkasten/Obsidian integration

## Operating Philosophy (眞善美孝永)

The system follows five guiding principles:
1. **Truth (眞)** - Accurate state reading, logic-driven decisions
2. **Goodness (善)** - Server stability, safe actions, no destructive behavior
3. **Beauty (美)** - Elegant builds, organized storage, clean automation
4. **Serenity (孝)** - Clear progress reporting, commander's peace of mind
5. **Eternity (永)** - Sustainable resource management, long-term planning

## Key Components

- **Agent Team**: Multi-agent orchestration with specialized roles
- **Blackboard**: Redis-based shared memory for agent coordination
- **Discord Bot**: External communication and command interface
- **MCP Server**: Model Context Protocol integration for external tools
- **Dashboard**: Web-based monitoring interface (port 3000)
- **Minecraft Server**: PaperMC 1.21.11 (localhost:25565, offline mode)
