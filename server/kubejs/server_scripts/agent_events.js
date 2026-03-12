// Octiv Agent Events — KubeJS server script
// Handles block breaking events for Octiv agents

ServerEvents.blockBroken(event => {
  const player = event.player;
  if (!player || !player.name.startsWith('Octiv_')) return;

  const block = event.block;
  event.server.runCommandSilent(`tellraw @a ["Agent ${player.name} broke ${block.id}"]`);
});
