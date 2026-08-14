// Every string the shop can show the player. Functional only: each line states
// what happened or what is blocking the purchase. Zero lore, zero personality --
// a refusal the player has to interpret is a bug.
//
// Keys are the `reason` codes returned by src/sim/shop.js. A code with no line
// here is a boot error, so a new refusal path can never ship as a blank message.

export const VENDOR_LINES = {
  ok:              'Purchased',
  unknown_item:    'No such item',
  not_for_sale:    'Not for sale',
  insufficient:    'Not enough funds',
  already_owned:   'Already owned',
  max_level:       'Max level',
  nothing_owned:   'Nothing to refund',
  // The shelf. `out_of_stock` is the one refusal that resolves itself by
  // waiting, so it says what the player is waiting for rather than just no.
  out_of_stock:    'Out of stock - restocks soon',
  no_stock:        'No stock this session',
  reroll_ok:       'Fresh stock delivered',
};

// Tab headers, in display order.
export const TAB_LABELS = {
  machines:  'Machines',
  buildings: 'Buildings',
  items:     'Items',
  upgrades:  'Upgrades',
};

// The same refusals, short enough to fit ON the button. A buy button is a
// column roughly eight characters wide, and "Out of stock - restocks soon" set
// in it either overflows or gets ellipsised into "Out of stock - res...", which
// is worse than saying less. The LONG line above is still what the message row
// and the button's tooltip say, so nothing is lost -- this is a second register
// of the same fact, not a second source of truth. A code with no short form
// falls back to the long one.
export const VENDOR_SHORT = {
  ok:              'Buy',
  unknown_item:    'Unknown',
  not_for_sale:    'Not sold',
  insufficient:    'Too dear',
  already_owned:   'Owned',
  max_level:       'Maxed',
  out_of_stock:    'Sold out',
  no_stock:        'Sold out',
};

export function lineFor(reason) {
  return Object.prototype.hasOwnProperty.call(VENDOR_LINES, reason)
    ? VENDOR_LINES[reason]
    : null;
}

export function shortFor(reason) {
  if (Object.prototype.hasOwnProperty.call(VENDOR_SHORT, reason)) return VENDOR_SHORT[reason];
  return lineFor(reason);
}

export default VENDOR_LINES;
