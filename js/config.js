// Shared constants: rooms, animatronic paths, night difficulty and tuning.
// Every gameplay number worth tweaking lives in FN.TUNE so balance changes stay in one place.
(function () {
  'use strict';
  const FN = (window.FN = window.FN || {});

  FN.W = 1280;
  FN.H = 720;
  FN.PROTOCOL = 2;
  FN.PEER_PREFIX = 'fnafmp-v1-';

  FN.CHARS = ['freddy', 'bonnie', 'chica', 'foxy'];
  FN.CHAR_INFO = {
    freddy: { name: 'Freddy Fazbear', short: 'Freddy', color: '#8a5a32' },
    bonnie: { name: 'Bonnie', short: 'Bonnie', color: '#6a5fd0' },
    chica: { name: 'Chica', short: 'Chica', color: '#e8c234' },
    foxy: { name: 'Foxy', short: 'Foxy', color: '#c4462a' },
  };

  // Everybody is a night guard sharing the office; anyone past the limit watches.
  FN.ROLES = ['guard', 'spectator'];
  FN.MAX_GUARDS = 6;
  FN.MAX_PLAYERS = 12;
  FN.GUARD_COLORS = ['#e8c25a', '#6ec6ff', '#ff8a7a', '#8be08b', '#d9a0ff', '#ffb062'];

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

  // Where each animatronic may wander (picked at random on a successful roll).
  FN.AI_PATH = {
    bonnie: { '1A': ['1B'], '1B': ['5', '2A'], '5': ['1B', '2A'], '2A': ['3', '2B'], '3': ['2A', 'LD'], '2B': ['3', 'LD'] },
    chica: { '1A': ['1B'], '1B': ['7', '6'], '7': ['6', '4A'], '6': ['7', '4A'], '4A': ['1B', '4B'], '4B': ['4A', 'RD'] },
    freddy: { '1A': ['1B'], '1B': ['7'], '7': ['6'], '6': ['4A'], '4A': ['4B'] },
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

  FN.TUNE = {
    tickMs: 50,
    // AI movement opportunity intervals (seconds), straight from the original's timings.
    aiInterval: { freddy: 3.02, bonnie: 4.97, chica: 4.98, foxy: 5.01 },
    // More guards means more eyes, so each extra guard makes every animatronic this much more aggressive.
    teamAiBonus: 2,
    // ...but several people flicking lights and cameras at once burns power fast, so a team of
    // up to teamPowerCap extra guards gets a bigger battery.
    teamPowerBonus: 0.3,
    teamPowerCap: 2,
    officeGrace: 1.2, // seconds an animatronic stands in the office before striking someone off the monitor
    officeForce: 25, // strike anyway after this long, even if nobody ever lowers their monitor
    glitchOnMove: 1.6, // camera static after something moves in or out of a room
    foxyRunTime: 2.6,
    foxyLeaveTime: 22, // Foxy runs this long after leaving the cove even if nobody checks the West Hall
    powerPerUsage: 0.09, // % per second per usage bar on a classic-length night
    pingCooldown: 1.2,
    pingTime: 5, // seconds a call-out stays highlighted
    jumpscareTime: 1.5,
    powerOut: { toMusic: [2, 5], music: [5, 18], dark: [2, 5] },
  };

  // Extra AI levels for a team of `guards` players.
  FN.teamBonus = (guards) => Math.round(FN.TUNE.teamAiBonus * Math.max(0, guards - 1));
  // Power drain multiplier for a team of `guards` players.
  FN.teamPower = (guards) => 1 / (1 + FN.TUNE.teamPowerBonus * Math.min(FN.TUNE.teamPowerCap, Math.max(0, guards - 1)));
})();
