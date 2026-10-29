// Cloak Premium: which features are part of it, and whether they're unlocked.
//
// Premium isn't launched yet, so every feature is unlocked for everyone and nothing is labelled "Premium".
// To launch: set LAUNCHED to true and decide how `unlocked()` learns that someone has Premium (a license key in
// config, a sign-in, ...). Cloak stays useful without it; the opacity slider is always free.
const LAUNCHED = false;

const FEATURES = {
  colors: "Custom accent and background colors",
  liquidGlass: "Liquid Glass appearance",
  watchlist: "Shopping watchlist (planned)",
  listen: "Listen (the widget and Listen mode)",
  talk: "Talk mode",
  memory: "Memory (facts and saved files)",
};

function unlocked(feature, config = {}) {
  if (!LAUNCHED) return true;
  if (!(feature in FEATURES)) return true;
  return !!config.premium;
}

module.exports = { LAUNCHED, FEATURES, unlocked };
