/**
 * AC-2 Shelter Building Tests — Property-Based Testing
 * Tests BEFORE implementation (TDD Red phase)
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { BuilderAgent } = require('../agent/builder');
const { Blackboard } = require('../agent/blackboard');
const { Vec3 } = require('vec3');

describe('AC-2: Shelter Building', () => {
  let board;
  let builder;
  let mockBot;
  let placedBlocks;

  beforeEach(async () => {
    board = new Blackboard();
    await board.connect();
    builder = new BuilderAgent({ id: 'test-builder' });
    builder.board = board;
    
    // Mock mcData
    builder.mcData = {
      itemsByName: {
        oak_planks: { id: 5, name: 'oak_planks' },
        oak_log: { id: 17, name: 'oak_log' },
      },
      blocksByName: {
        oak_planks: { id: 5, name: 'oak_planks' },
      },
    };
    
    // Mock adaptations
    builder.adaptations = {
      buildSiteRadius: 10,
    };
    
    // Mock setupPathfinder
    builder._setupPathfinder = () => {};
    
    // Mock goto function
    builder._goto = async () => {};

    placedBlocks = [];
    mockBot = {
      entity: { 
        position: new Vec3(0, 64, 0),
      },
      blockAt: (pos) => {
        const key = `${pos.x},${pos.y},${pos.z}`;
        const placed = placedBlocks.find(b => `${b.x},${b.y},${b.z}` === key);
        if (placed) return { name: 'oak_planks', boundingBox: 'block', position: pos };
        
        // Ground blocks
        if (pos.y === 63) return { name: 'stone', boundingBox: 'block', position: pos };
        
        // Air blocks
        return { name: 'air', boundingBox: 'empty', position: pos };
      },
      placeBlock: async (refBlock, faceVector) => {
        const newPos = refBlock.position.plus(faceVector);
        placedBlocks.push({
          x: newPos.x,
          y: newPos.y,
          z: newPos.z,
        });
      },
      findBlock: () => ({ position: new Vec3(0, 63, 0) }), // ground
      pathfinder: {
        setMovements: () => {},
        goto: async () => {},
      },
      inventory: {
        items: () => [
          { name: 'oak_planks', count: 64 },
          { name: 'oak_log', count: 16 },
        ],
      },
      equip: async () => {},
      craft: async () => {},
      recipesFor: () => [{ id: 1 }],
    };
    
    builder.bot = mockBot;
  });

  afterEach(async () => {
    await board.disconnect();
  });

  // Property 1: Block count invariant
  it('should place exactly 32 blocks (9 floor + 14 walls + 9 roof)', async () => {
    await builder.buildShelter(mockBot);
    
    // 3x3 floor = 9, 3x3 walls (2 layers) - 2 door = 14, 3x3 roof = 9
    assert.strictEqual(placedBlocks.length, 32, 'Must place 32 blocks total');
  });

  // Property 2: Hollow structure
  it('should create hollow interior (no blocks inside)', async () => {
    await builder.buildShelter(mockBot);
    
    // Interior should be empty (1x1x2 space)
    const interior = placedBlocks.filter(b => 
      b.x === 0 && b.z === 0 && b.y >= 64 && b.y <= 65
    );
    
    assert.strictEqual(interior.length, 0, 'Interior must be hollow');
  });

  // Property 3: Door opening
  it('should leave 2-block door opening on one wall', async () => {
    await builder.buildShelter(mockBot);
    
    // Count wall blocks at y=64 and y=65 (door height)
    const wallBlocks = placedBlocks.filter(b => 
      (b.y === 64 || b.y === 65) && 
      (Math.abs(b.x) === 1 || Math.abs(b.z) === 1)
    );
    
    // 4 walls * 3 blocks * 2 height = 24, minus 2 for door = 22
    // But corners are shared, so actual count is 12 (perimeter)
    assert.ok(wallBlocks.length >= 10 && wallBlocks.length <= 12, 
      'Wall blocks should account for door opening');
  });

  // Property 4: Blackboard publish
  it('should publish shelter coordinates to Blackboard', async () => {
    await builder.buildShelter(mockBot);
    
    const shelterData = await board.get('builder:shelter');
    assert.ok(shelterData, 'Shelter data must be published');
    assert.ok(shelterData.position, 'Shelter position must be included');
    assert.strictEqual(shelterData.status, 'complete', 'Status must be complete');
  });

  // Property 5: AC-2 status update
  it('should update AC-2 status to done', async () => {
    await builder.buildShelter(mockBot);
    
    const acProgress = await board.getACProgress('test-builder');
    assert.ok(acProgress['AC-2'], 'AC-2 must be recorded');
    
    const ac2 = JSON.parse(acProgress['AC-2']);
    assert.strictEqual(ac2.status, 'done', 'AC-2 status must be done');
  });

  // Property 6: Floor placement
  it('should place floor blocks at ground level', async () => {
    await builder.buildShelter(mockBot);
    
    const floorBlocks = placedBlocks.filter(b => b.y === 64);
    assert.strictEqual(floorBlocks.length, 9, 'Floor must have 9 blocks (3x3)');
  });

  // Property 7: Roof placement
  it('should place roof blocks at top level', async () => {
    await builder.buildShelter(mockBot);
    
    const roofBlocks = placedBlocks.filter(b => b.y === 66);
    assert.strictEqual(roofBlocks.length, 9, 'Roof must have 9 blocks (3x3)');
  });

  // Property 8: Error handling - no planks
  it('should throw error if no planks in inventory', async () => {
    mockBot.inventory.items = () => [];
    
    await assert.rejects(
      () => builder.buildShelter(mockBot),
      /no planks/i,
      'Must throw error when no planks available'
    );
  });

  // Property 9: Idempotency
  it('should not rebuild if shelter already exists', async () => {
    await board.publish('builder:shelter', {
      author: 'test-builder',
      position: { x: 0, y: 64, z: 0 },
      status: 'complete',
    });
    
    await builder.buildShelter(mockBot);
    
    // Should not place any blocks
    assert.strictEqual(placedBlocks.length, 0, 'Should skip if shelter exists');
  });
});
