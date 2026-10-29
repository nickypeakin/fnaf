// Shared constants: rooms, animatronic paths, night difficulty and tuning.
// Every gameplay number worth tweaking lives in FN.TUNE so balance changes stay in one place.
(function () {
  'use strict';
  const FN = (window.FN = window.FN || {});

  FN.W = 1280;
  FN.H = 720;
  FN.PROTOCOL = 1;
  FN.PEER_PREFIX = 'fnafmp-v1-';

  FN.CHARS = ['freddy', 'bonnie', 'chica', 'foxy'];
  FN.CHAR_INFO = {
    freddy: { name: 'Freddy Fazbear', tag: 'Fr', short: 'Freddy', color: '#8a5a32', side: 'R',
      blurb: 'Slow and sneaky. Can only move while nobody is watching your camera. From the East Hall Corner you can slip into the office while the guard is busy on the monitor.' },
    bonnie: { name: 'Bonnie', tag: 'Bo', short: 'Bonnie', color: '#6a5fd0', side: 'L',
      blurb: 'Fast, roams the west side. Reach the left door, wait for the guard to slip up, then sneak in.' },
    chica: { name: 'Chica', tag: 'Ch', short: 'Chica', color: '#e8c234', side: 'R',
      blurb: 'Roams the east side and the kitchen. Reach the right door, wait for an opening, then sneak in.' },
    foxy: { name: 'Foxy', tag: 'Fx', short: 'Foxy', color: '#c4462a', side: 'L',
      blurb: 'Creep out of Pirate Cove while nobody is looking, then SPRINT down the West Hall. A shut door drains the guard\'s power.' },
  };

  FN.ROLES = ['guard', 'freddy', 'bonnie', 'chica', 'foxy', 'spectator'];
  FN.MAX_GUARDS = 2;

  FN.ROOMS = {
    '1A': { name: 'Show Stage' },
    '1B': { name: 'Dining Area' },
    '1C': { name: 'Pirate Cove' },
    '2A': { name: 'West Hall' },
    '2B': { name: 'W. Hall Corner' },
    '3': { name: 'Supply Closet' },
    '4A': { name: 'East Hall' },
    '4B': { name: 'E. Hall Corner' },
    '5': { name: 'Backstage' },
    '6': { name: 'Kitchen' },
    '7': { name: 'Restrooms' },
    LD: { name: 'Left Door' },
    RD: { name: 'Right Door' },
    OF: { name: 'The Office' },
  };
  FN.CAMS = ['1A', '1B', '1C', '5', '7', '6', '2A', '3', '2B', '4A', '4B'];
  FN.DOOR_ROOM = { L: 'LD', R: 'RD' };

  // Where the AI is allowed to wander (picked at random on a successful roll).
  FN.AI_PATH = {
    bonnie: { '1A': ['1B'], '1B': ['5', '2A'], '5': ['1B', '2A'], '2A': ['3', '2B'], '3': ['2A', 'LD'], '2B': ['3', 'LD'] },
    chica: { '1A': ['1B'], '1B': ['7', '6'], '7': ['6', '4A'], '6': ['7', '4A'], '4A': ['1B', '4B'], '4B': ['4A', 'RD'] },
    freddy: { '1A': ['1B'], '1B': ['7'], '7': ['6'], '6': ['4A'], '4A': ['4B'] },
  };

  // Where a human-controlled animatronic may step from each room.
  FN.PLAYER_GRAPH = {
    bonnie: {
      '1A': ['1B'], '1B': ['1A', '5', '2A'], '5': ['1B', '2A'], '2A': ['1B', '5', '3', '2B'],
      '3': ['2A', 'LD'], '2B': ['2A', 'LD'], LD: ['2B', '3'],
    },
    chica: {
      '1A': ['1B'], '1B': ['1A', '7', '6', '4A'], '7': ['1B', '6', '4A'], '6': ['1B', '7', '4A'],
      '4A': ['1B', '6', '7', '4B'], '4B': ['4A', 'RD'], RD: ['4B'],
    },
    freddy: { '1A': ['1B'], '1B': ['1A', '7'], '7': ['1B', '6'], '6': ['7', '4A'], '4A': ['6', '4B'], '4B': ['4A'] },
  };

  // Base AI levels (0-20) per night. Night 7 is the custom night.
  FN.NIGHT_AI = {
    1: { freddy: 0, bonnie: 0, chica: 0, foxy: 0 },
    2: { freddy: 0, bonnie: 3, chica: 1, foxy: 1 },
    3: { freddy: 1, bonnie: 0, chica: 5, foxy: 2 },
    4: { freddy: 1, bonnie: 2, chica: 4, foxy: 6 },
    5: { freddy: 3, bonnie: 5, chica: 7, foxy: 5 },
    6: { freddy: 4, bonnie: 10, chica: 12, foxy: 16 },
  };
  // AI levels that rise as the night goes on: hour -> list of characters that get +1.
  FN.HOURLY_AI = { 2: ['bonnie'], 3: ['bonnie', 'chica', 'foxy'], 4: ['bonnie', 'chica', 'foxy'] };
  // Extra power drain (% per second, classic-length night) that later nights add on top of usage.
  FN.NIGHT_PASSIVE_DRAIN = { 1: 0, 2: 0.01, 3: 0.015, 4: 0.02, 5: 0.025, 6: 0.03, 7: 0.03 };

  FN.LENGTHS = {
    classic: { label: 'Classic (~9 min)', hour: 89 },
    short: { label: 'Short (6 min)', hour: 60 },
    quick: { label: 'Quick (4 min)', hour: 40 },
  };
  FN.SPEEDS = {
    auto: { label: 'Auto (evens out team sizes)', mult: null },
    slow: { label: 'Slow', mult: 1.4 },
    normal: { label: 'Normal', mult: 1.0 },
    fast: { label: 'Fast', mult: 0.7 },
  };

  FN.TUNE = {
    tickMs: 50,
    // AI movement opportunity intervals (seconds), straight from the original's timings.
    aiInterval: { freddy: 3.02, bonnie: 4.97, chica: 4.98, foxy: 5.01 },
    // Player animatronic move cooldowns (seconds) before the speed multiplier.
    playerCooldown: { freddy: 7, bonnie: 8, chica: 8, foxy: 10 },
    repelCooldown: 12, // after being turned away at a door
    doorLurkMin: 4, // seconds a player must wait at a doorway before sneaking in
    doorRepelTime: 4, // door shut this long while you're in the doorway sends you back
    officeGrace: 1.2, // seconds inside before you can strike a guard who isn't on the monitor
    officeForce: 20, // strike anyway after this long, even if they never lower the monitor
    jamDuration: 5,
    jamCooldown: 30,
    glitchOnMove: 1.6, // camera static after something moves in or out of a room
    foxyRunTime: 2.6,
    foxyAiLeaveTime: 22, // AI Foxy runs this long after leaving even if 2A is never checked
    foxyBangCooldown: 12,
    playerFoxyBang: 1.5, // % power per bang from a human Foxy on a classic-length night
    powerPerUsage: 0.09, // % per second per usage bar on a classic-length night
    jumpscareTime: 1.5,
    powerOut: { toMusic: [2, 5], music: [5, 18], dark: [2, 5] },
  };
})();
