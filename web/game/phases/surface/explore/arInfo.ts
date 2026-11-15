// Field notes for the things around the lander. Short text here works offline; the API adds NASA pictures, more facts
// and SerpApi extras on top (see heritage.ts).
import type { ArInfo, ArFact } from "./arStore";

const f = (text: string, source_name: string, source_url: string): ArFact => ({ text, source_name, source_url, via: "curated" });
const ALSJ = (m: string) => ({ n: `Apollo Lunar Surface Journal: Apollo ${m}`, u: `https://www.hq.nasa.gov/alsj/a${m}/a${m}.html` });
const LM = "https://en.wikipedia.org/wiki/Apollo_Lunar_Module";

export const LOCAL: ArInfo[] = [
  {
    id: "lander", kind: "lander", title: "Lunar lander", blurb: "Your ride down, and the launch pad for the ride home.",
    facts: [
      f("Apollo's Lunar Module had two stages. The descent stage landed the crew and stayed behind; only the small ascent stage with the crew cabin flew back up.", "Apollo Lunar Module", LM),
      f("The Apollo crew cabin had about 6.7 cubic meters of living space for two people, roughly a small walk-in closet.", "Apollo Lunar Surface Journal: Lunar Module", "https://www.hq.nasa.gov/alsj/lm.html"),
    ],
  },
  {
    id: "descent", kind: "lander", title: "Descent stage", blurb: "Engine, tanks and legs. It stays on the Moon for good.",
    facts: [
      f("Apollo's descent engine could be throttled between about 10 and 60 percent of its 45 kN thrust so the crew could hover and pick a spot.", "Apollo Lunar Module", LM),
      f("After liftoff the descent stage became the launch platform. The ones from Apollo 11 to 17 are still where they were left.", ALSJ("11").n, ALSJ("11").u),
    ],
  },
  {
    id: "ladder", kind: "lander", title: "Ladder", blurb: "Nine rungs from the porch to the ground.",
    facts: [
      f("On Apollo 11 the lander legs did not compress as far as expected, so the bottom rung ended about a meter above the ground and Armstrong had to hop down.", ALSJ("11").n, ALSJ("11").u),
      f("Climbing back up is easier in lunar gravity (one sixth of Earth's), so the crew could jump to the first rung with a suit on.", ALSJ("11").n, ALSJ("11").u),
    ],
  },
  {
    id: "pad", kind: "lander", title: "Footpad", blurb: "A wide dish that keeps the lander from sinking.",
    facts: [
      f("Apollo's footpads were about 0.94 m across to spread the weight on soft soil. They sank only a few centimeters into the regolith.", "Apollo Lunar Module", LM),
      f("Long probes under the pads lit a contact light in the cabin so the crew knew when to cut the engine.", "Apollo Lunar Module", LM),
    ],
  },
  {
    id: "antenna", kind: "lander", title: "Comms antenna", blurb: "Your voice reaches Earth in about 1.3 seconds.",
    facts: [
      f("Radio travels at the speed of light, so a message takes about 1.3 seconds to cross the 384,400 km to Earth. Every reply from Houston is that late.", "Wikipedia: Moon", "https://en.wikipedia.org/wiki/Moon"),
      f("With no air to bend or absorb signals, the dish must have a clear line of sight to Earth. A hill in the way blocks the link.", "NASA PGDA illumination maps", "https://pgda.gsfc.nasa.gov/products/69"),
    ],
  },
  {
    id: "flag", kind: "flag", title: "Flag", blurb: "Held out by a rod, because there is no wind to wave it.",
    facts: [
      f("Apollo flags had a horizontal rod along the top edge so the cloth would hang open. The 'waving' in photos is wrinkles from being folded.", "Wikipedia: Flags on the Moon", "https://en.wikipedia.org/wiki/Flags_on_the_Moon"),
      f("The Apollo 11 crew saw their flag blown over by the ascent engine. Orbiter photos from 2012 show the shadows of flags still standing at the later Apollo sites.", "Wikipedia: Flags on the Moon", "https://en.wikipedia.org/wiki/Flags_on_the_Moon"),
    ],
  },
  {
    id: "crater", kind: "nature", title: "Shadowed crater", blurb: "Its floor may never have seen sunlight.", env: "psr",
    facts: [f("Craters like this one are bowl-shaped because impacts excavate material outward. Older craters are softer and shallower, worn down by later impacts.", "Wikipedia: Impact crater", "https://en.wikipedia.org/wiki/Impact_crater")],
  },
  {
    id: "boulder", kind: "nature", title: "Boulder", blurb: "A block of rock thrown out by an impact.", env: "boulder",
    facts: [f("Boulders on the Moon are ejecta from craters. With no weather to wear them, they can sit unchanged for hundreds of millions of years.", "NASA: Lunar Reconnaissance Orbiter", "https://science.nasa.gov/mission/lro/")],
  },
  {
    id: "earth", kind: "sky", title: "Earth", blurb: "Hangs near the horizon and hardly moves.", env: "earth",
    facts: [f("Earth is 384,400 km away and looks about 3.7 times wider than the Moon does from Earth. It shows phases just like the Moon does.", "Wikipedia: Moon", "https://en.wikipedia.org/wiki/Moon")],
  },
  {
    id: "sun", kind: "sky", title: "The Sun", blurb: "A hard white disc over a black sky.", env: "sun",
    facts: [f("With no atmosphere there is no blue sky and no soft shadows: sunlit ground is blinding, and anything in shadow is nearly black.", "Apollo Lunar Surface Journal", "https://www.hq.nasa.gov/alsj/")],
  },
  {
    id: "task:navigate_to", kind: "task", title: "Mapping marker", blurb: "The rim of the crater you surveyed.",
    facts: [f("Mapping the rim shows where ejected rock lies and where the slope is safe to walk, which is how crews planned traverses on later Apollo missions.", "Apollo Lunar Surface Journal", "https://www.hq.nasa.gov/alsj/")],
  },
  {
    id: "task:scan", kind: "task", title: "Ice scan area", blurb: "Where the scanner picked up a hydrogen signal.", env: "ice",
    facts: [f("Orbiters detect hydrogen from above; the buried ice itself is only confirmed by landers, rovers or samples on the ground.", "Wikipedia: Lunar water", "https://en.wikipedia.org/wiki/Lunar_water")],
  },
  {
    id: "task:collect_sample", kind: "task", title: "Sample site", blurb: "Rock and soil for the lab on Earth.", env: "regolith",
    facts: [f("The six Apollo missions brought back 382 kg of rock and soil. Labs still open new samples that were sealed for decades.", "Wikipedia: Apollo program", "https://en.wikipedia.org/wiki/Apollo_program")],
  },
  {
    id: "task:deploy_relay", kind: "task", title: "Relay site", blurb: "Open ground with a clear view of Earth.", env: "earth",
    facts: [f("A relay needs line of sight: Chang'e 4 landed on the far side with a relay satellite parked beyond the Moon to reach Earth.", "Wikipedia: Chang'e 4", "https://en.wikipedia.org/wiki/Chang%27e_4")],
  },
  {
    id: "task:repair", kind: "task", title: "Repair panel", blurb: "A damaged service panel on the lander.",
    facts: [f("Apollo crews carried only a few hand tools. Fixes were improvised: duct tape mended a fender on the Apollo 17 rover.", "Wikipedia: Apollo 17", "https://en.wikipedia.org/wiki/Apollo_17")],
  },
];
