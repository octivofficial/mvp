/**
 * Builder Shelter — extracted from builder.js
 * AC-2: 3x3x3 shelter construction logic.
 */
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { getLogger } = require('./logger');
const log = getLogger();

const { GoalNear } = goals;

/**
 * Craft oak_planks from oak_log in bot inventory.
 */
async function craftPlanks(bot, mcData) {
  const planksItem = mcData.itemsByName.oak_planks;
  if (!planksItem) return;
  const logItem = bot.inventory.items().find(i => i.name === 'oak_log');
  if (!logItem) return;
  const recipes = bot.recipesFor(planksItem.id, null, 1, null);
  if (!recipes || recipes.length === 0) return;
  const count = Math.min(logItem.count, 9);
  for (let i = 0; i < count; i++) {
    await bot.craft(recipes[0], 1, null);
  }
}

/**
 * Find a flat 3x3 build site within radius.
 * @returns {Vec3|null} - origin position or null
 */
function findBuildSite(bot, buildSiteRadius) {
  const botPos = bot.entity.position.floored();
  for (let r = 1; r <= buildSiteRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const base = botPos.offset(dx, -1, dz);
        if (isFlatSite(bot, base)) return botPos.offset(dx, 0, dz);
      }
    }
  }
  return null;
}

/**
 * Check if 3x3 ground is solid + 4 layers of air above.
 */
function isFlatSite(bot, groundCorner) {
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 3; z++) {
      const ground = bot.blockAt(groundCorner.offset(x, 0, z));
      if (!ground || ground.boundingBox !== 'block') return false;
      for (let y = 1; y <= 4; y++) {
        const air = bot.blockAt(groundCorner.offset(x, y, z));
        if (air && air.boundingBox === 'block') return false;
      }
    }
  }
  return true;
}

/**
 * Navigate near and place block at position.
 * @param {Function} gotoFn - async (goal) => void
 */
async function placeBlockAt(bot, pos, blockName, gotoFn) {
  await gotoFn(new GoalNear(pos.x, pos.y, pos.z, 4));

  const item = bot.inventory.items().find(i => i.name === blockName);
  if (!item) throw new Error(`No ${blockName} in inventory`);
  await bot.equip(item, 'hand');

  const referenceBlock = bot.blockAt(pos.offset(0, -1, 0));
  if (referenceBlock) {
    await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
  }
}

/**
 * Build a 3x3x3 shelter (floor + walls + roof with door).
 * @param {object} ctx - { bot, mcData, board, id, logger, adaptations, gotoFn, setupPathfinderFn }
 * @returns {Vec3} - shelter origin position
 */
async function buildShelter(ctx) {
  const { bot, mcData, board, id, logger, adaptations, gotoFn, setupPathfinderFn } = ctx;
  log.info(id, 'starting shelter construction');

  await craftPlanks(bot, mcData);

  const origin = findBuildSite(bot, adaptations.buildSiteRadius);
  if (!origin) throw new Error('No suitable build site found');

  setupPathfinderFn();

  const plankName = 'oak_planks';
  for (let dy = 0; dy <= 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      for (let dz = 0; dz < 3; dz++) {
        const isFloor = (dy === 0);
        const isRoof = (dy === 3);
        const isWall = (dy === 1 || dy === 2);
        const isEdge = (dx === 0 || dx === 2 || dz === 0 || dz === 2);
        const isDoor = (dx === 1 && dz === 0 && (dy === 1 || dy === 2));

        if (isDoor) continue;
        if (!isFloor && !isRoof && !(isWall && isEdge)) continue;

        const pos = origin.offset(dx, dy, dz);
        await placeBlockAt(bot, pos, plankName, gotoFn);
      }
    }
  }

  await board.updateAC(id, 2, 'done');
  await board.publish('builder:shelter', {
    author: id,
    position: { x: origin.x, y: origin.y, z: origin.z },
    size: { x: 3, y: 4, z: 3 },
  });
  if (logger) logger.logEvent(id, { type: 'ac_complete', ac: 2, position: { x: origin.x, y: origin.y, z: origin.z } }).catch(e => log.error(id, 'log persist error', { error: e.message }));
  log.info(id, `AC-2 done: shelter at ${origin}`);

  return origin;
}

module.exports = { craftPlanks, findBuildSite, isFlatSite, placeBlockAt, buildShelter };
