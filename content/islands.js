// Islands made in Tree Sim 4 Studio (npm run studio). The Studio writes this file: make islands there.
// They come after the Iceberg in order: the first is island 7 (Rebirth 6), the next island 8 (Rebirth 7), and so on.
export default [
  {
    "name": "Glassdune Expanse",
    "sub": "Where the sands hum back at the sky",
    "theme": "",
    "seed": 6.884,
    "radius": 170,
    "wobble": 0.24,
    "plateau": 3,
    "hills": 14,
    "hillSize": 1.4,
    "beach": 16,
    "cliffs": 0.2,
    "decor": 1.6,
    "features": [
      {
        "type": "plateau",
        "dir": 100,
        "dist": 0.55,
        "r": 30,
        "h": 12
      },
      {
        "type": "ridge",
        "dir": 250,
        "dist": 0.6,
        "r": 18,
        "h": 14,
        "len": 110,
        "rot": 30
      },
      {
        "type": "spire",
        "dir": 200,
        "dist": 0.78,
        "r": 12,
        "h": 60,
        "name": "THE MERIDIAN SPIRE"
      },
      {
        "type": "crater",
        "dir": 40,
        "dist": 0.7,
        "r": 22,
        "h": 8,
        "name": "THE GLASS BASIN"
      },
      {
        "type": "islet",
        "dir": 300,
        "dist": 1.5,
        "r": 10,
        "h": 6
      },
      {
        "type": "islet",
        "dir": 20,
        "dist": 1.7,
        "r": 7,
        "h": 4
      },
      {
        "type": "isle",
        "dir": 185,
        "dist": 2,
        "r": 28,
        "h": 10,
        "bridge": true,
        "name": "SALT ARCHIVE"
      },
      {
        "type": "bay",
        "dir": 150,
        "dist": 0.9,
        "width": 0.4,
        "depth": 0.3
      },
      {
        "type": "valley",
        "dir": 320,
        "dist": 0.45,
        "r": 12,
        "len": 70,
        "rot": 120
      }
    ],
    "colors": {
      "grass": "#c9a66b",
      "grass2": "#a8854f",
      "sand": "#e8cf8a",
      "rock": "#8a6a4f",
      "snow": "#f4f1e8",
      "camp": "#d9b97a",
      "shallow": "#4fd1c5",
      "deep": "#1d5f7a",
      "bush": "#8b7d5a"
    },
    "snowline": "",
    "trees": [
      "sulfurspire",
      "cinderpine",
      "obsidianoak",
      "basalt"
    ],
    "treeCount": 60,
    "treeW": {
      "sulfurspire": 1.2,
      "cinderpine": 0.8,
      "obsidianoak": 0.6,
      "basalt": 0.3
    },
    "allTiers": false,
    "economy": 4,
    "mats": [
      {
        "key": "m_dune_glass",
        "name": "Dune Glass",
        "color": "#e7f3f5",
        "glow": false
      },
      {
        "key": "m_mirage_salt",
        "name": "Mirage Salt",
        "color": "#f0e6c8",
        "glow": false
      },
      {
        "key": "m_scorchstone",
        "name": "Scorchstone",
        "color": "#8c4a2f",
        "glow": false
      },
      {
        "key": "m_plasma_quartz",
        "name": "Plasma Quartz",
        "color": "#5ff5ff",
        "glow": true
      },
      {
        "key": "m_null_crystal",
        "name": "Null Crystal",
        "color": "#b56cff",
        "glow": true
      }
    ],
    "axes": [
      {
        "key": "x_glassdune_hatchet",
        "name": "Glassdune Hatchet",
        "steel": "#cfe9ee",
        "edge": "#9ff3ff",
        "glow": "#2a7a8a",
        "ability": 1
      },
      {
        "key": "x_scorchstone_adze",
        "name": "Scorchstone Adze",
        "steel": "#7a4a33",
        "edge": "#ffb36b",
        "glow": "#c4551f",
        "ability": 5
      },
      {
        "key": "x_plasmaquartz_reaper",
        "name": "Plasmaquartz Reaper",
        "steel": "#3b2a6b",
        "edge": "#5ff5ff",
        "glow": "#7a3cff",
        "ability": 11
      }
    ],
    "animals": [
      {
        "kind": "lizard",
        "n": 12
      },
      {
        "kind": "beetle",
        "n": 10
      },
      {
        "kind": "eagle",
        "n": 3
      },
      {
        "kind": "fox",
        "n": 4
      },
      {
        "kind": "a_chromeback_skink",
        "n": 6
      },
      {
        "kind": "a_vaultfox",
        "n": 6
      }
    ],
    "cover": {
      "grass": 60,
      "flowers": 0,
      "berries": 0,
      "mush": 0,
      "glowshroom": 0,
      "rings": 0,
      "logs": 0,
      "stumps": 0,
      "crystals": 20,
      "cracks": 40,
      "bones": 10,
      "cairns": 8
    },
    "coverCol": {
      "mush": "#ffffff",
      "glowshroom": "#ffffff",
      "berries": "#ffffff",
      "flowers": "#ffffff",
      "crystals": "#8ff7ff",
      "cracks": "#8a6a4f"
    },
    "flies": "embers",
    "fliesCol": "#ffb347",
    "rebirth": {
      "cost": 25000000,
      "items": {
        "permafrost": 5
      }
    },
    "rideLine1": "Dunes of mirror-glass slide past, flashing like a heliograph.",
    "rideLine2": "A single chrome spire rises from the haze, and the sand sings beneath it.",
    "ferryLine": "Hold tight, traveller. The sand here remembers the sky, and it is getting louder.",
    "arrive": "Welcome to Glassdune Expanse. Chop well, and the dunes will hum your name.",
    "campName": "Glass Camp",
    "arrDir": 125,
    "nextDir": -35,
    "shape": {
      "kind": "lobed",
      "stretch": 1.6,
      "lobes": 5,
      "amount": 0.35,
      "angle": 70
    }
  },
  {
    "name": "Mega Town",
    "sub": "Walled neon metropolis of the endless skyways",
    "theme": "",
    "seed": 7.474,
    "radius": 190,
    "wobble": 0.13,
    "plateau": 5,
    "hills": 6,
    "hillSize": 0.8,
    "beach": 6,
    "cliffs": 0.7,
    "decor": 0.6,
    "features": [
      {
        "type": "plateau",
        "dir": 30,
        "dist": 0.55,
        "r": 40,
        "h": 10,
        "name": "THE UPTOWN DECK"
      },
      {
        "type": "plateau",
        "dir": 150,
        "dist": 0.55,
        "r": 35,
        "h": 7,
        "name": "THE NEON QUARTER"
      },
      {
        "type": "plateau",
        "dir": 220,
        "dist": 0.6,
        "r": 30,
        "h": 12,
        "name": "THE HOVERPORT"
      },
      {
        "type": "spire",
        "dir": 330,
        "dist": 0.6,
        "r": 12,
        "h": 70,
        "name": "THE MEGASPIRE"
      },
      {
        "type": "spire",
        "dir": 110,
        "dist": 0.7,
        "r": 8,
        "h": 50,
        "name": "THE ANTENNA"
      },
      {
        "type": "lake",
        "dir": 270,
        "dist": 0.45,
        "r": 20,
        "name": "THE COOLANT POOL"
      },
      {
        "type": "valley",
        "dir": 180,
        "dist": 0.4,
        "r": 10,
        "len": 90,
        "rot": 90,
        "name": "THE MAGLEV TRENCH"
      },
      {
        "type": "ridge",
        "dir": 60,
        "dist": 0.85,
        "r": 10,
        "h": 12,
        "len": 120,
        "rot": 150,
        "name": "THE NORTH BULWARK"
      },
      {
        "type": "isle",
        "dir": 0,
        "dist": 1.6,
        "r": 30,
        "bridge": true,
        "name": "THE ORBITAL DOCK"
      },
      {
        "type": "islet",
        "dir": 200,
        "dist": 1.4,
        "r": 10,
        "h": 20
      }
    ],
    "colors": {
      "grass": "#3a4a5c",
      "grass2": "#2f6f73",
      "sand": "#9aa3b5",
      "rock": "#4b4f63",
      "snow": "#7ef9ff",
      "camp": "#5c6478",
      "shallow": "#2be3e0",
      "deep": "#0b1438",
      "bush": "#1fa89a"
    },
    "snowline": 28,
    "trees": [
      "crystal",
      "voidspire",
      "starwisp",
      "silverbirch",
      "ironwood",
      "glowcap"
    ],
    "treeCount": 165,
    "treeW": {
      "crystal": 1.4,
      "voidspire": 1.2,
      "starwisp": 0.5,
      "silverbirch": 1,
      "ironwood": 1,
      "glowcap": 0.8
    },
    "allTiers": false,
    "economy": 6,
    "mats": [
      {
        "key": "m_alloy_bark",
        "name": "Alloy Bark",
        "color": "#9aa7b8",
        "glow": false
      },
      {
        "key": "m_circuit_sap",
        "name": "Circuit Sap",
        "color": "#2ef2c4",
        "glow": true
      },
      {
        "key": "m_neon_pulp",
        "name": "Neon Pulp",
        "color": "#ff3fb4",
        "glow": true
      },
      {
        "key": "m_chrome_resin",
        "name": "Chrome Resin",
        "color": "#d8e4f0",
        "glow": false
      },
      {
        "key": "m_plasma_heartwood",
        "name": "Plasma Heartwood",
        "color": "#8a5cff",
        "glow": true
      },
      {
        "key": "m_quantum_core",
        "name": "Quantum Core",
        "color": "#fff36b",
        "glow": true
      }
    ],
    "axes": [
      {
        "key": "x_circuit_cleaver",
        "name": "Circuit Cleaver",
        "steel": "#7f8ea3",
        "edge": "#2ef2c4",
        "glow": "#063b33",
        "ability": 1
      },
      {
        "key": "x_neon_hoverblade",
        "name": "Neon Hoverblade",
        "steel": "#3a2a5c",
        "edge": "#ff3fb4",
        "glow": "#3d0a2a",
        "ability": 6
      },
      {
        "key": "x_quantum_skybreaker",
        "name": "Quantum Skybreaker",
        "steel": "#d8e4f0",
        "edge": "#fff36b",
        "glow": "#2a1460",
        "ability": 14
      }
    ],
    "animals": [
      {
        "kind": "a_chromeback_skink",
        "n": 10
      },
      {
        "kind": "a_vaultfox",
        "n": 6
      },
      {
        "kind": "skycrow",
        "n": 8
      },
      {
        "kind": "moth",
        "n": 10
      },
      {
        "kind": "bat",
        "n": 6
      },
      {
        "kind": "squirrel",
        "n": 5
      },
      {
        "kind": "a_hover_pigeon",
        "n": 6
      },
      {
        "kind": "a_glitch_cat",
        "n": 6
      }
    ],
    "cover": {
      "grass": 60,
      "flowers": 15,
      "berries": 0,
      "mush": 0,
      "glowshroom": 25,
      "rings": 4,
      "logs": 5,
      "stumps": 10,
      "crystals": 35,
      "cracks": 40,
      "bones": 3,
      "cairns": 0
    },
    "coverCol": {
      "mush": "#8a5cff",
      "glowshroom": "#2ef2c4",
      "berries": "#ff5050",
      "flowers": "#ff3fb4",
      "crystals": "#7ef9ff",
      "cracks": "#2ef2c4"
    },
    "flies": "spores",
    "fliesCol": "#7ef9ff",
    "rebirth": {
      "cost": 50000000,
      "items": {
        "m_null_crystal": 5
      }
    },
    "rideLine1": "Glowing hover-lanes stripe the night sky, and little air cars zip overhead like fireflies.",
    "rideLine2": "A colossal chrome wall rises from the sea, crowned with neon, and towers glitter behind it.",
    "ferryLine": "Mega Town, eh? Keep your axe holstered at the gate, lad, their robots don't like splinters.",
    "arrive": "ACCESS GRANTED. Welcome to Mega Town, citizen lumberjack! Please chop responsibly.",
    "campName": "Hub Zero",
    "arrDir": 125,
    "nextDir": -35,
    "shape": {
      "kind": "round",
      "stretch": 1.6,
      "lobes": 3,
      "amount": 0.3,
      "angle": 0
    },
    "ui": {
      "accent": "#2ef2c4",
      "panel": "#0d1226",
      "ink": "#e6f4ff",
      "font": "Consolas",
      "corner": 4
    },
    "camp": {
      "post": "u_holo_trade_kiosk",
      "forge": "u_plasma_forge",
      "witch": "u_potion_capsule",
      "bedModel": "u_star_capsule"
    },
    "casino": {
      "wall": "#1a2140",
      "base": "#2a2f45",
      "trim": "#2ef2c4",
      "roof": "#0d1226",
      "glow": "#7ef9ff",
      "dim": "#141a33",
      "rock": "#3b4260",
      "sign": "#ff60e0",
      "name": "THE FUTURE CASINO",
      "tagline": "ALWAYS ONLINE",
      "roofKind": "spire",
      "hall": {
        "walls": "#121a3a",
        "carpet": "#2f1a5c",
        "trim": "#c0d4e8",
        "light": "#9ffcff"
      }
    }
  }
];
