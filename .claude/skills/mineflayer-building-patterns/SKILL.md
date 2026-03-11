---
name: mineflayer-building-patterns
description: Mineflayer building patterns for Minecraft bots — 4x4 floor, 3-block walls, roof construction, bot.placeBlock() API, and shelter validation for AC-2 completion.
---

# Mineflayer Building Patterns

Complete guide to building structures in Minecraft using mineflayer's block placement API.

## When to Use
- Building shelters, houses, or structures
- Placing blocks programmatically
- Validating structure completion
- Implementing AC-2 (shelter building) tasks
- Creating floors, walls, and roofs

## Core Patterns

### 1. Basic Block Placement

```javascript
const Vec3 = require('vec3');

async function placeBlock(bot, position, blockType) {
  // Get the block item from inventory
  const blockItem = bot.inventory.items().find(item => 
    item.name === blockType
  );
  
  if (!blockItem) {
    throw new Error(`No ${blockType} in inventory`);
  }
  
  // Equip the block
  await bot.equip(blockItem, 'hand');
  
  // Find a reference block to place against
  const referenceBlock = bot.blockAt(position.offset(0, -1, 0));
  if (!referenceBlock) {
    throw new Error(`No reference block at ${position}`);
  }
  
  // Place the block
  const faceVector = new Vec3(0, 1, 0);  // Place on top
  await bot.placeBlock(referenceBlock, faceVector);
  
  // Verify placement
  const placedBlock = bot.blockAt(position);
  return placedBlock && placedBlock.name === blockType;
}
```

### 2. 4x4 Floor Pattern

```javascript
async function build4x4Floor(bot, cornerPos, blockType = 'oak_planks') {
  const positions = [];
  
  // Generate 4x4 grid positions
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      positions.push(cornerPos.offset(x, 0, z));
    }
  }
  
  // Place blocks sequentially
  for (const pos of positions) {
    try {
      await placeBlock(bot, pos, blockType);
      await bot.waitForTicks(2);  // Small delay for stability
    } catch (err) {
      console.error(`Failed to place block at ${pos}:`, err.message);
      throw err;
    }
  }
  
  return positions.length;
}
```

### 3. 3-Block Wall Pattern

```javascript
async function build3BlockWall(bot, startPos, direction, length, blockType = 'oak_planks') {
  const positions = [];
  
  // direction: 'north', 'south', 'east', 'west'
  const offsets = {
    north: { x: 0, z: -1 },
    south: { x: 0, z: 1 },
    east: { x: 1, z: 0 },
    west: { x: -1, z: 0 },
  };
  
  const offset = offsets[direction];
  if (!offset) throw new Error(`Invalid direction: ${direction}`);
  
  // Build wall: 3 blocks high, `length` blocks long
  for (let i = 0; i < length; i++) {
    for (let y = 0; y < 3; y++) {
      const pos = startPos.offset(
        offset.x * i,
        y,
        offset.z * i
      );
      positions.push(pos);
    }
  }
  
  // Place blocks
  for (const pos of positions) {
    try {
      await placeBlock(bot, pos, blockType);
      await bot.waitForTicks(2);
    } catch (err) {
      console.error(`Failed to place wall block at ${pos}:`, err.message);
      throw err;
    }
  }
  
  return positions.length;
}
```

### 4. Roof Pattern

```javascript
async function buildFlatRoof(bot, cornerPos, width, depth, blockType = 'oak_planks') {
  const positions = [];
  const roofY = 3;  // Roof at height 3 (above 3-block walls)
  
  // Generate roof positions
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      positions.push(cornerPos.offset(x, roofY, z));
    }
  }
  
  // Place roof blocks
  for (const pos of positions) {
    try {
      await placeBlock(bot, pos, blockType);
      await bot.waitForTicks(2);
    } catch (err) {
      console.error(`Failed to place roof block at ${pos}:`, err.message);
      throw err;
    }
  }
  
  return positions.length;
}
```

### 5. Complete 3x3x3 Shelter (AC-2)

```javascript
async function buildShelter(bot, cornerPos) {
  const blockType = 'oak_planks';
  
  console.log('Building 4x4 floor...');
  await build4x4Floor(bot, cornerPos, blockType);
  
  console.log('Building north wall...');
  await build3BlockWall(bot, cornerPos, 'north', 4, blockType);
  
  console.log('Building south wall...');
  await build3BlockWall(bot, cornerPos.offset(0, 0, 3), 'south', 4, blockType);
  
  console.log('Building east wall...');
  await build3BlockWall(bot, cornerPos.offset(3, 0, 0), 'east', 4, blockType);
  
  console.log('Building west wall...');
  await build3BlockWall(bot, cornerPos, 'west', 4, blockType);
  
  console.log('Building roof...');
  await buildFlatRoof(bot, cornerPos, 4, 4, blockType);
  
  console.log('Shelter complete!');
  return true;
}
```

### 6. Shelter Validation

```javascript
function isValidShelter(bot, cornerPos) {
  const blockType = 'oak_planks';
  
  // Check floor (4x4)
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      const block = bot.blockAt(cornerPos.offset(x, 0, z));
      if (!block || block.name !== blockType) {
        return false;
      }
    }
  }
  
  // Check walls (3 blocks high, 4 sides)
  const wallChecks = [
    { start: cornerPos, dir: 'north', len: 4 },
    { start: cornerPos.offset(0, 0, 3), dir: 'south', len: 4 },
    { start: cornerPos.offset(3, 0, 0), dir: 'east', len: 4 },
    { start: cornerPos, dir: 'west', len: 4 },
  ];
  
  for (const wall of wallChecks) {
    if (!isValidWall(bot, wall.start, wall.dir, wall.len, blockType)) {
      return false;
    }
  }
  
  // Check roof (4x4 at height 3)
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      const block = bot.blockAt(cornerPos.offset(x, 3, z));
      if (!block || block.name !== blockType) {
        return false;
      }
    }
  }
  
  return true;
}

function isValidWall(bot, startPos, direction, length, blockType) {
  const offsets = {
    north: { x: 0, z: -1 },
    south: { x: 0, z: 1 },
    east: { x: 1, z: 0 },
    west: { x: -1, z: 0 },
  };
  
  const offset = offsets[direction];
  
  for (let i = 0; i < length; i++) {
    for (let y = 0; y < 3; y++) {
      const pos = startPos.offset(offset.x * i, y, offset.z * i);
      const block = bot.blockAt(pos);
      if (!block || block.name !== blockType) {
        return false;
      }
    }
  }
  
  return true;
}
```

### 7. Pathfinding to Build Position

```javascript
const { goals } = require('mineflayer-pathfinder');

async function navigateToBuildSite(bot, targetPos) {
  // Move to a position adjacent to the build site
  const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);
  
  await bot.pathfinder.goto(goal);
  
  // Face the build site
  await bot.lookAt(targetPos);
}
```

### 8. Inventory Management for Building

```javascript
async function ensureBuildingMaterials(bot, blockType, requiredCount) {
  const items = bot.inventory.items().filter(item => item.name === blockType);
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  
  if (totalCount < requiredCount) {
    throw new Error(`Insufficient ${blockType}: have ${totalCount}, need ${requiredCount}`);
  }
  
  return totalCount;
}

async function calculateShelterMaterials() {
  // 4x4 floor = 16 blocks
  // 4 walls × 4 length × 3 height = 48 blocks
  // 4x4 roof = 16 blocks
  // Total = 80 blocks
  return 80;
}
```

## Advanced Patterns

### 9. Multi-Story Building

```javascript
async function buildMultiStory(bot, cornerPos, floors) {
  for (let floor = 0; floor < floors; floor++) {
    const floorPos = cornerPos.offset(0, floor * 4, 0);
    await buildShelter(bot, floorPos);
  }
}
```

### 10. Door Placement

```javascript
async function placeDoor(bot, position, facing = 'north') {
  const doorItem = bot.inventory.items().find(item => 
    item.name.includes('door')
  );
  
  if (!doorItem) {
    throw new Error('No door in inventory');
  }
  
  await bot.equip(doorItem, 'hand');
  
  // Place door (2 blocks high)
  const referenceBlock = bot.blockAt(position.offset(0, -1, 0));
  await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
  
  // Door automatically places upper half
  await bot.waitForTicks(5);
}
```

## Error Handling

### Common Errors
1. **No reference block**: Ensure ground exists below placement position
2. **Insufficient materials**: Check inventory before starting
3. **Pathfinding failure**: Validate build site is reachable
4. **Block placement timeout**: Increase wait time between placements

### Retry Logic
```javascript
async function placeBlockWithRetry(bot, position, blockType, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await placeBlock(bot, position, blockType);
      return true;
    } catch (err) {
      console.warn(`Placement attempt ${attempt + 1} failed:`, err.message);
      if (attempt === maxRetries - 1) throw err;
      await bot.waitForTicks(10);  // Wait before retry
    }
  }
}
```

## Integration with Octiv

### AC-2 Implementation
```javascript
// agent/builder.js
async function executeAC2(bot, shelterPos) {
  // Ensure materials
  const required = await calculateShelterMaterials();
  await ensureBuildingMaterials(bot, 'oak_planks', required);
  
  // Navigate to build site
  await navigateToBuildSite(bot, shelterPos);
  
  // Build shelter
  await buildShelter(bot, shelterPos);
  
  // Validate
  if (!isValidShelter(bot, shelterPos)) {
    throw new Error('Shelter validation failed');
  }
  
  // Publish completion
  await board.publish('builder:shelter-complete', {
    agentId: bot.username,
    position: shelterPos,
    timestamp: Date.now(),
  });
  
  return true;
}
```

## Testing

### Mock Bot for Testing
```javascript
const mockBot = {
  inventory: {
    items: () => [{ name: 'oak_planks', count: 100 }]
  },
  blockAt: (pos) => ({ name: 'oak_planks' }),
  equip: jest.fn(),
  placeBlock: jest.fn(),
  waitForTicks: jest.fn(),
};
```

### Test Shelter Validation
```javascript
test('isValidShelter returns true for complete shelter', () => {
  const result = isValidShelter(mockBot, new Vec3(0, 0, 0));
  expect(result).toBe(true);
});
```

## Performance Tips
- Place blocks sequentially (avoid parallel placement)
- Add small delays between placements (2-5 ticks)
- Validate inventory before starting large builds
- Use pathfinder to position bot optimally
- Cache block positions to avoid repeated calculations

## References
- [Mineflayer Documentation](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)
- [Mineflayer Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)
- [Minecraft Block Placement](https://minecraft.fandom.com/wiki/Block)
- Octiv: `agent/builder.js` (AC-2 implementation)
