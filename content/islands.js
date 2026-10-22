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
  }
];
