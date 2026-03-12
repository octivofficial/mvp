// Octiv Agent Rewards — KubeJS server script
// Distributes rewards on task completion

ServerEvents.customCommand('octiv_task_complete', event => {
  const player = event.player;
  if (!player || !player.name.startsWith('Octiv_')) return;

  player.give(Item.of('minecraft:diamond', 1));
  event.server.runCommandSilent(`tellraw @a ["Agent ${player.name} completed a task!"]`);
});
